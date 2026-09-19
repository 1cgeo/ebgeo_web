// Path: tests/integration/password-recovery-audit.test.js
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

describe('password recovery audit', () => {
  let app, db;
  before(async () => { ({ app, db } = await setupTestEnv()); });
  after(async () => { await teardownTestEnv(db); });
  const request = (email) => supertest(app).post('/api/v1/auth/forgot-password').send({ email });
  const redeem = (token, newPassword = 'New-secret-123') => supertest(app).post('/api/v1/auth/reset-password').send({ token, newPassword });
  async function account() {
    const username = `recovery_${randomUUID().slice(0, 8)}`;
    const email = `${username}@example.mil`;
    await supertest(app).post('/api/v1/auth/register').send({ username, email, nome: 'Recovery Test', password: 'Original-123' }).expect(201);
    const { rows } = await db.query('UPDATE users SET email_verified = TRUE WHERE username = $1 RETURNING id', [username]);
    return { id: rows[0].id, email, username };
  }
  async function codes(id) {
    return (await db.query("SELECT token FROM email_verification_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND consumed_at IS NULL", [id])).rows;
  }

  for (const change of ['email', 'confirmation', 'sessions']) {
    it(`rejects a code after changing ${change}`, async () => {
      const user = await account();
      await request(user.email).expect(200);
      const [code] = await codes(user.id);
      if (change === 'email') await db.query('UPDATE users SET email = $2 WHERE id = $1', [user.id, `new_${user.email}`]);
      if (change === 'confirmation') await db.query('UPDATE users SET email_verified = FALSE WHERE id = $1', [user.id]);
      if (change === 'sessions') await db.query('UPDATE users SET sessions_valid_from = clock_timestamp() WHERE id = $1', [user.id]);
      await redeem(code.token).expect(400);
    });
  }

  it('concurrent requests leave exactly one usable code', async () => {
    const user = await account();
    let requests;
    await db.query('BEGIN');
    try {
      await db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
      requests = [request(user.email).then((r) => r), request(user.email).then((r) => r)];
      let waiting = 0;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        await db.query('SELECT pg_stat_clear_snapshot()');
        const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE $1", [`%${user.id}%`]);
        waiting = rows[0].n;
        if (waiting === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(waiting, 2);
    } finally {
      await db.query('ROLLBACK');
    }
    assert.deepEqual((await Promise.all(requests)).map((r) => r.status), [200, 200]);
    const live = await codes(user.id);
    assert.equal(live.length, 1);
    const results = await Promise.all([redeem(live[0].token), redeem(live[0].token)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  it('failed token storage preserves the previous code and does not enumerate the account', async () => {
    const user = await account();
    await request(user.email).expect(200);
    const [previous] = await codes(user.id);
    await db.query(`CREATE FUNCTION recovery_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id = '${user.id}' AND NEW.purpose = 'reset_password' THEN RAISE EXCEPTION 'simulated token storage failure'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER recovery_audit_fail BEFORE INSERT ON email_verification_tokens FOR EACH ROW EXECUTE FUNCTION recovery_audit_fail()');
    try {
      const known = await request(user.email).expect(200);
      const unknown = await request(`missing_${user.email}`).expect(200);
      assert.deepEqual(known.body, unknown.body);
      assert.deepEqual(await codes(user.id), [previous]);
    } finally {
      await db.query('DROP TRIGGER recovery_audit_fail ON email_verification_tokens');
      await db.query('DROP FUNCTION recovery_audit_fail()');
    }
    await redeem(previous.token).expect(200);
  });

  it('rejects a password beyond bcrypt capacity without consuming the code', async () => {
    const user = await account();
    await request(user.email).expect(200);
    const [code] = await codes(user.id);
    await redeem(code.token, 'á'.repeat(37)).expect(422);
    await redeem(code.token).expect(200);
  });

  it('requires a fresh code after upgrading tokens without a recipient snapshot', async () => {
    const user = await account();
    await request(user.email).expect(200);
    const [old] = await codes(user.id);
    await db.query('UPDATE email_verification_tokens SET email_at_issue = NULL WHERE token = $1', [old.token]);
    await redeem(old.token).expect(400);
    await request(user.email).expect(200);
    const [fresh] = await codes(user.id);
    await redeem(fresh.token).expect(200);
  });
});

// Path: tests/integration/self-registration-audit.test.js
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

describe('self-registration audit: races and confirmation ownership', () => {
  let app, db;
  const prefix = `signup_${randomUUID().slice(0, 8)}`;
  const register = (body) => supertest(app).post('/api/v1/auth/register').send(body);
  const payload = (extra = {}) => {
    const username = `${prefix}_${randomUUID().slice(0, 8)}`;
    return { username, email: `${username}@example.mil`, nome: 'Teste Cadastro', password: 'Test@1234', ...extra };
  };
  const verify = (token) => supertest(app).post('/api/v1/auth/verify-email').send({ token });
  async function pending() {
    const body = payload();
    await register(body).expect(201);
    const { rows } = await db.query(`SELECT u.id, t.token FROM users u JOIN email_verification_tokens t ON t.user_id = u.id WHERE u.username = $1`, [body.username]);
    return { ...rows[0], body };
  }
  before(async () => { ({ app, db } = await setupTestEnv()); });
  after(async () => { await teardownTestEnv(db); });

  for (const collision of ['username', 'email']) {
    it(`concurrent ${collision} collision returns the same response and creates only one account`, async () => {
      const lock = 781039;
      const fn = `signup_barrier_${collision}`;
      await db.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF LOWER(NEW.username) LIKE '${prefix}_%' THEN PERFORM pg_advisory_xact_lock(${lock}); END IF; RETURN NEW; END $$`);
      await db.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      const first = payload();
      const second = payload({ [collision]: first[collision].toUpperCase() });
      let requests;
      try {
        await db.query('SELECT pg_advisory_lock($1)', [lock]);
        requests = [register(first).then((r) => r), register(second).then((r) => r)];
        const deadline = Date.now() + 10000;
        let waiting = 0;
        while (Date.now() < deadline) {
          const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event = 'advisory' AND query LIKE '%WITH new_user%'");
          waiting = rows[0].n;
          if (waiting === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(waiting, 2, 'both requests reached INSERT after passing the uniqueness pre-checks');
      } finally {
        await db.query('SELECT pg_advisory_unlock($1)', [lock]);
      }
      try {
        const responses = await Promise.all(requests);
        assert.deepEqual(responses.map((r) => r.status), [201, 201]);
        assert.deepEqual(responses[0].body, responses[1].body);
        const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM users WHERE LOWER(${collision}) = LOWER($1)`, [first[collision]]);
        assert.equal(rows[0].n, 1);
      } finally {
        await db.query(`DROP TRIGGER ${fn} ON users`);
        await db.query(`DROP FUNCTION ${fn}()`);
      }
    });
  }

  it('an old mailbox link cannot verify an address corrected by an administrator', async () => {
    const user = await pending();
    await db.query('UPDATE users SET email = $2, email_verified = FALSE WHERE id = $1', [user.id, `corrected_${user.body.email}`]);
    await verify(user.token).expect(400);
    assert.equal((await db.query('SELECT email_verified FROM users WHERE id = $1', [user.id])).rows[0].email_verified, false);
    await supertest(app).post('/api/v1/auth/resend-verification').send({ username: user.body.username }).expect(200);
    const { rows } = await db.query('SELECT token FROM email_verification_tokens WHERE user_id = $1 AND token <> $2 ORDER BY created_at DESC LIMIT 1', [user.id, user.token]);
    await verify(rows[0].token).expect(200);
  });

  it('a disabled account cannot be confirmed or receive another confirmation token', async () => {
    const user = await pending();
    await db.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.id]);
    await verify(user.token).expect(400);
    await supertest(app).post('/api/v1/auth/resend-verification').send({ email: user.body.email }).expect(200);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM email_verification_tokens WHERE user_id = $1', [user.id])).rows[0].n, 1);
  });

  it('legacy links without a recipient snapshot require resend', async () => {
    const user = await pending();
    await db.query('UPDATE email_verification_tokens SET email_at_issue = NULL WHERE token = $1', [user.token]);
    await verify(user.token).expect(400);
    await supertest(app).post('/api/v1/auth/resend-verification').send({ email: user.body.email }).expect(200);
    const { rows } = await db.query('SELECT token FROM email_verification_tokens WHERE user_id = $1 AND email_at_issue IS NOT NULL', [user.id]);
    await verify(rows[0].token).expect(200);
  });

  it('self-declared privileges cannot bypass confirmation or grant an administrative role', async () => {
    const body = payload({ role: 'admin', email_verified: true, producer_org_id: randomUUID(), is_active: true });
    await register(body).expect(201);
    const user = (await db.query('SELECT role, producer_org_id, email_verified FROM users WHERE username = $1', [body.username])).rows[0];
    assert.deepEqual(user, { role: 'user', producer_org_id: null, email_verified: false });
    const login = await supertest(app).post('/api/v1/auth/login').send({ username: body.username, password: body.password }).expect(401);
    assert.equal(login.body.error.code, 'EMAIL_NOT_VERIFIED');
  });

  it('rejects passwords exceeding bcrypt byte capacity, including multibyte text', async () => {
    for (const password of ['a'.repeat(73), 'á'.repeat(37)]) {
      const body = payload({ password });
      await register(body).expect(422);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM users WHERE username = $1', [body.username])).rows[0].n, 0);
    }
  });

  it('omitting the organization cannot bypass an inactive default organization', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    await db.query('UPDATE organizations SET is_active = FALSE WHERE id = $1', [id]);
    try {
      const body = payload();
      await register(body).expect(400);
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM users WHERE username = $1', [body.username])).rows[0].n, 0);
    } finally {
      await db.query('UPDATE organizations SET is_active = TRUE WHERE id = $1', [id]);
    }
  });

  it('an unknown rank is rejected equally for a free and an occupied username', async () => {
    const taken = await pending();
    const rank_id = randomUUID();
    const free = await register(payload({ rank_id }));
    const existing = await register({ ...taken.body, rank_id });
    assert.deepEqual([free.status, existing.status], [400, 400]);
    assert.deepEqual(existing.body, free.body);
  });
});

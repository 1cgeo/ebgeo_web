// Path: tests/integration/users-delete-session-revocation.test.js
// Items 56 and 141 — the two doors out of an account, and what each one closes.
//
// 56. `deleteUser` revokes every refresh token INSIDE the transaction
//     (Q.REVOKE_ALL_USER_TOKENS) and nothing asserted it. The obvious assertion is a
//     trap: `POST /auth/refresh -> 401` passes even with the revocation removed,
//     because FIND_USER_BY_ID already filters `is_active = true`. That is the exact
//     shape recorded in livro-razao.md:50. The proof has to come from the COLUMN.
//
// 141. `updateUser` used to be a back door with none of deleteUser's guarantees. It now
//     refuses the ACTIVE -> inactive transition, so the only route that deactivates is
//     the one that also demands a recipient for the atlases and kills the sessions.
//     Pinned here as the contrast that makes item 56 meaningful: it is no longer
//     possible to reach "deactivated with live refresh tokens" through the API.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('deactivating a user closes its sessions, transactionally', () => {
  let app, db, admin, adminToken;
  const tag = randomUUID().slice(0, 8);

  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  /** Logs in and returns the refresh token, so the row in `refresh_tokens` exists. */
  const openSession = async (user) => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);
    return res.body.data.refreshToken;
  };

  const tokenRows = async (userId) => {
    const { rows } = await db.query(
      'SELECT revoked_at FROM refresh_tokens WHERE user_id = $1', [userId]
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    admin = await createAdminUser(db, { username: `p56_admin_${tag}` });
    adminToken = await loginUser(app, admin.username, admin.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('every refresh_tokens row of the target ends up with revoked_at set', async () => {
    const target = await createUser(db, { username: `p56_target_${tag}` });
    await openSession(target);
    await openSession(target);

    const before = await tokenRows(target.id);
    assert.equal(before.length, 2, 'two live sessions to revoke');
    assert.ok(before.every((r) => r.revoked_at === null), 'none revoked yet');

    await asAdmin(supertest(app).delete(`/api/v1/users/${target.id}`)).expect(200);

    const after = await tokenRows(target.id);
    assert.equal(after.length, 2, 'the rows are revoked, not deleted');
    for (const row of after) {
      assert.notEqual(row.revoked_at, null, 'the column is the proof; the 401 below is only a symptom');
    }
  });

  it('SYMPTOM (not proof): the old refresh token is refused afterwards', async () => {
    const target = await createUser(db, { username: `p56_symptom_${tag}` });
    const refreshToken = await openSession(target);

    await asAdmin(supertest(app).delete(`/api/v1/users/${target.id}`)).expect(200);

    const res = await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken });
    // This would still pass with the revocation removed — `is_active = true` in
    // FIND_USER_BY_ID is enough to produce it. Recorded as a symptom, deliberately.
    assert.equal(res.status, 401);
  });

  it('ROLLBACK: a refused delete (atlas without a recipient) revokes nothing', async () => {
    const target = await createUser(db, { username: `p56_rollback_${tag}` });
    await createAtlas(db, target.id, { name: `P56 ${randomUUID().slice(0, 6)}` });
    await openSession(target);

    const res = await asAdmin(supertest(app).delete(`/api/v1/users/${target.id}`));
    assert.equal(res.status, 409, 'an owner of atlases needs ?transferTo');

    const rows = await tokenRows(target.id);
    assert.equal(rows.length, 1);
    for (const row of rows) {
      assert.equal(row.revoked_at, null, 'the revocation lives inside the tx and rolls back with it');
    }
    const { rows: user } = await db.query('SELECT is_active FROM users WHERE id = $1', [target.id]);
    assert.equal(user[0].is_active, true);
  });

  it('after reactivation the OLD refresh token stays dead — the session does not resurrect', async () => {
    const target = await createUser(db, { username: `p56_reactivate_${tag}` });
    const refreshToken = await openSession(target);

    await asAdmin(supertest(app).delete(`/api/v1/users/${target.id}`)).expect(200);
    await asAdmin(supertest(app).post(`/api/v1/users/${target.id}/reactivate`)).expect(200);

    const res = await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken });
    assert.equal(res.status, 401, 'revoked_at is permanent; reactivation does not undo it');

    // And a fresh login still works, so reactivation is not a lockout either.
    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: target.username, password: target.password })
      .expect(200);
  });

  it('the PUT door cannot reach that state at all: ACTIVE -> inactive is refused', async () => {
    // Item 141's "session resurrection" scenario needed a deactivation that skipped
    // the revocation. That door is closed: PUT refuses the transition, so there is no
    // path to "inactive with live tokens".
    const target = await createUser(db, { username: `p56_put_${tag}` });
    await openSession(target);

    const res = await asAdmin(supertest(app).put(`/api/v1/users/${target.id}`))
      .send({ is_active: false });
    assert.equal(res.status, 409);

    const { rows } = await db.query('SELECT is_active FROM users WHERE id = $1', [target.id]);
    assert.equal(rows[0].is_active, true);
    const tokens = await tokenRows(target.id);
    assert.equal(tokens.length, 1);
    for (const row of tokens) {
      assert.equal(row.revoked_at, null, 'nothing happened at all — not a half-deactivation');
    }
  });

  it('a successful transfer-delete still revokes, and writes exactly one USER_DELETE row', async () => {
    const target = await createUser(db, { username: `p56_xfer_${tag}` });
    const heir = await createUser(db, { username: `p56_heir_${tag}` });
    const atlas = await createAtlas(db, target.id, { name: `P56 x ${randomUUID().slice(0, 6)}` });
    await openSession(target);

    const res = await asAdmin(
      supertest(app).delete(`/api/v1/users/${target.id}?transferTo=${heir.id}`)
    ).expect(200);
    assert.equal(res.body.data.atlasTransferred, 1);

    const { rows: owner } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
    assert.equal(owner[0].owner_id, heir.id);

    const tokens = await tokenRows(target.id);
    assert.equal(tokens.length, 1);
    for (const row of tokens) {
      assert.notEqual(row.revoked_at, null);
    }

    const { rows: audit } = await db.query(
      "SELECT count(*)::int AS n FROM audit_trail WHERE action = 'USER_DELETE' AND target_id = $1",
      [target.id]
    );
    assert.equal(audit[0].n, 1);
  });

  it('a self-transfer is refused and leaves no USER_DELETE trail behind', async () => {
    const target = await createUser(db, { username: `p56_self_${tag}` });
    await createAtlas(db, target.id, { name: `P56 s ${randomUUID().slice(0, 6)}` });

    const res = await asAdmin(
      supertest(app).delete(`/api/v1/users/${target.id}?transferTo=${target.id}`)
    );
    assert.equal(res.status, 409);

    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM audit_trail WHERE action = 'USER_DELETE' AND target_id = $1",
      [target.id]
    );
    assert.equal(rows[0].n, 0, 'a refused deactivation must not leave an audit row claiming it happened');
  });
});

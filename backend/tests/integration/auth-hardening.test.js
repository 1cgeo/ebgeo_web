// Path: tests/integration/auth-hardening.test.js
// Tests for the Fase 0 auth hardening: timing-safe login (generic message),
// JWT algorithm allowlist, refresh-token reuse detection, and token
// revocation on password change.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

describe('Auth hardening', () => {
  let app, db, user;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'hardening_user', password: 'Test@1234' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('returns an identical generic message for unknown user and wrong password', async () => {
    const unknown = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: 'no_such_user_xyz', password: 'whatever123' })
      .expect(401);

    const wrongPw = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: 'wrong-password' })
      .expect(401);

    assert.equal(unknown.body.error.message, 'Usuário ou senha inválidos');
    assert.equal(wrongPw.body.error.message, 'Usuário ou senha inválidos');
  });

  it('rejects a token forged with alg:none (algorithm allowlist)', async () => {
    const header = b64url({ alg: 'none', typ: 'JWT' });
    const payload = b64url({ sub: user.id, username: user.username, role: 'user' });
    const forged = `${header}.${payload}.`; // empty signature

    await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('detects refresh-token reuse and revokes the whole family', async () => {
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: 'Test@1234' })
      .expect(200);
    const t1 = login.body.data.refreshToken;

    // Rotate once: T1 -> T2 (T1 becomes revoked)
    const rot = await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: t1 })
      .expect(200);
    const t2 = rot.body.data.refreshToken;

    // Age the rotation past the concurrency grace window (REFRESH_RACE_GRACE_MS in
    // auth.service.js). Since rotation became an atomic claim, a replay arriving
    // WITHIN a few seconds of the rotation is treated as one client double-submitting
    // — the shape a double F5 or a network retry produces — and is refused without
    // raising the theft alarm. Theft is what this test is about, so it has to place
    // the replay where a stolen token realistically gets used: later. The assertions
    // below are unchanged; only the timing is made explicit.
    // The window itself is covered from both sides in auth-refresh-race.repro.test.js.
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [user.id]
    );

    // Reusing the now-revoked T1 is detected -> 401
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: t1 })
      .expect(401);

    // ...and the reuse revokes the whole family, so even the valid T2 now fails
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: t2 })
      .expect(401);
  });

  it('revokes refresh tokens when the password changes', async () => {
    const u = await createUser(db, { username: 'pwchange_user', password: 'Test@1234' });
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: u.username, password: 'Test@1234' })
      .expect(200);
    const { accessToken, refreshToken } = login.body.data;

    await supertest(app)
      .put('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'Test@1234', newPassword: 'NewPass@123' })
      .expect(200);

    // The refresh token issued before the password change is now revoked
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('keeps self-registration enabled in the test environment', async () => {
    const username = `selfreg_${user.id.slice(0, 8)}`;
    await supertest(app)
      .post('/api/v1/auth/register')
      .send({ username, password: 'Test@1234', nome: 'Self Reg', email: `${username}@example.mil` })
      .expect(201);
    // The 201 body is account-free by design (it must not distinguish "created" from
    // "already existed"), so the row is what proves the route is mounted and working.
    const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    assert.ok(rows[0]?.id);
  });
});

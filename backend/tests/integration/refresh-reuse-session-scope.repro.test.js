// Path: tests/integration/refresh-reuse-session-scope.repro.test.js
// Regression (achado 35): the comment above the reuse-detection branch in
// auth.service.js claimed that revoking the family "forces a fresh login". It does
// not, and no test pinned what it actually does.
//
// The access token carries no jti / session id / version (issueAccessToken), and
// neither the strict `auth` middleware nor the sliding renewal in flexibleAuth ever
// reads `refresh_tokens` — the live reconciliation (getLiveAuthState) looks only at
// users.is_active / role / org. So REVOKE_ALL_USER_TOKENS ends exactly one thing:
// the ability to ROTATE. A principal already holding a valid access token keeps
// working for the rest of its lifetime and, because flexibleAuth re-issues the
// cookie whenever the token is <5 min from expiring, keeps renewing it forever
// without ever touching /auth/refresh. The same is true of `logout` and of the
// password-change revocation (users.service.js), which call the same query.
//
// This file states the real scope so the code and its comment cannot drift apart
// again. It is a characterization test, deliberately asserting the CURRENT
// guarantee. Whoever implements the durable fix (a per-user `sessions_valid_from`
// marker read by getLiveAuthState, refusing tokens issued before it — a schema
// migration plus a session-policy decision, out of scope here) will see the last
// two tests fail: that is the signal to update them AND the comment together.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars';
const uname = () => `reuse_${randomUUID().slice(0, 8)}`;

function tokenFromSetCookie(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const cookie = arr.find((c) => c.startsWith('token='));
  return cookie ? cookie.split(';')[0].slice('token='.length) : null;
}

describe('refresh-token reuse detection: what it does and does not revoke (repro)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  /** Logs in, rotates once, ages the rotation past the grace window and replays T1. */
  async function triggerReuseDetection() {
    const user = await createUser(db, { username: uname() });
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);

    const accessToken = login.body.data.accessToken;
    const t1 = login.body.data.refreshToken;

    await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: t1 }).expect(200);

    // Push the rotation outside REFRESH_RACE_GRACE_MS so the replay reads as theft,
    // not as a concurrent duplicate.
    await db.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() - INTERVAL '1 hour'
       WHERE user_id = $1 AND revoked_at IS NOT NULL`,
      [user.id]
    );

    await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken: t1 }).expect(401);

    return { user, accessToken };
  }

  it('revokes every refresh token of the user (the guarantee it DOES give)', async () => {
    const { user } = await triggerReuseDetection();

    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id]
    );
    assert.equal(rows[0].n, 0, 'no refresh token survives — rotation is dead');
  });

  it('does NOT end a session that already holds a live access token', async () => {
    const { accessToken } = await triggerReuseDetection();

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(
      res.status, 200,
      'the access token outlives the family revocation — this is why the comment '
      + 'must not promise a forced re-login'
    );
  });

  it('the sliding session still renews that access token indefinitely', async () => {
    const { user } = await triggerReuseDetection();

    // A token 4 min from expiry — inside flexibleAuth's 5-min renewal threshold.
    const nearExpiry = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        nome: user.nome,
        posto: user.posto_graduacao,
        role: 'user',
        organization_id: user.organization_id,
        org_role: 'viewer',
        org: user.organization_id,
        login: user.username,
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '4m' }
    );

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${nearExpiry}`)
      .expect(200);

    assert.ok(
      tokenFromSetCookie(res),
      'the renewal never consults refresh_tokens, so the revoked family does not stop it'
    );
  });

  it('deactivating the account IS effective — the only live-checked revocation', async () => {
    const { user, accessToken } = await triggerReuseDetection();

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    assert.equal(res.status, 401, 'is_active is what the strict path reconciles live');
  });
});

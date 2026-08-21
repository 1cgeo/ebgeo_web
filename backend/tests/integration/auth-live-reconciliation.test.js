// Path: tests/integration/auth-live-reconciliation.test.js
// P1 — a deactivated or demoted user loses access IMMEDIATELY, not merely when the
// current access token expires.
//
// Two holes were open before this:
//   1. The strict `auth` middleware only reconciled the ORG's status against the DB;
//      `users.is_active` and `role` were trusted straight from the JWT, so a
//      deactivated user (or a demoted admin) kept working for the whole ≤15min
//      token window — and `requireAdmin` kept honouring the stale `role: admin`.
//   2. Worse, the sliding-session renewal in `flexibleAuth` re-signed those same
//      stale claims without ever consulting the DB, turning the bounded 15min
//      window into an UNBOUNDED one: a deactivated user who kept a request in
//      flight renewed their session forever.
//
// `99-pendencias-e-desvios.md` documented (1) as accepted-by-design on the strength
// of the bounded window; since the sliding renewal removed that bound, the live
// reconciliation is now done on the strict path.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

// Mints a token that is inside the sliding-renewal window (<5min to expiry) so the
// renewal branch in flexibleAuth is exercised, without waiting in real time.
function nearExpiryToken(user, { role = 'user', orgId = null } = {}) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      nome: user.nome,
      role,
      organization_id: orgId,
      org: orgId,
      login: user.username,
    },
    config.jwt.secret,
    { expiresIn: '2m', algorithm: 'HS256' }
  );
}

describe('Live auth reconciliation (deactivation / demotion take effect immediately)', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('a token minted BEFORE deactivation stops working right away (401)', async () => {
    const user = await createUser(db, { username: `deact_${randomUUID().slice(0, 6)}` });
    const token = await loginUser(app, user.username, user.password);

    // GET /atlas (not /auth/me) on purpose: `auth.getMe` re-reads the user through
    // FIND_USER_BY_ID, which filters `is_active = true` on its own, so it would 401
    // even with the middleware check removed — it cannot prove anything here.
    // listAtlas only consumes req.user.id, so the gate under test is the middleware.
    await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    // The token is still cryptographically valid and unexpired — only the live DB
    // state changed. It must no longer be honoured.
    await supertest(app)
      .get('/api/v1/atlas')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('a demoted admin loses admin routes immediately, even with an `admin` claim', async () => {
    const admin = await createAdminUser(db, { username: `demoted_${randomUUID().slice(0, 6)}` });
    const token = await loginUser(app, admin.username, admin.password);

    await supertest(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [admin.id]);

    // The JWT still says role=admin; requireAdmin must act on the live role.
    await supertest(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('the sliding renewal does NOT re-issue a cookie for a deactivated user', async () => {
    const user = await createUser(db, { username: `slide_${randomUUID().slice(0, 6)}` });
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    // A near-expiry token is exactly what used to be renewed forever.
    const token = nearExpiryToken(user);
    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`token=${token}`]);

    assert.equal(res.status, 401, 'a deactivated user must not reach a strict route');

    // Any Set-Cookie present must be the CLEARING of the cookie, never a fresh token.
    const setCookie = res.headers['set-cookie'] || [];
    const renewed = setCookie.filter(
      (c) => c.startsWith('token=') && !/token=;/.test(c) && !/Expires=Thu, 01 Jan 1970/i.test(c)
    );
    assert.equal(
      renewed.length,
      0,
      `sliding renewal must not mint a token for a dead session (got: ${setCookie.join(' | ')})`
    );
  });

  it('the sliding renewal still works for a healthy user', async () => {
    // Guard against over-correcting: the feature must keep functioning.
    const user = await createUser(db, { username: `alive_${randomUUID().slice(0, 6)}` });
    const token = nearExpiryToken(user);

    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`token=${token}`])
      .expect(200);

    const setCookie = res.headers['set-cookie'] || [];
    assert.ok(
      setCookie.some((c) => c.startsWith('token=') && !/token=;/.test(c)),
      'an active user near expiry must still get a renewed cookie'
    );
  });

  it('the renewed token carries the CURRENT role, not the stale claim', async () => {
    // A user whose token still says admin, but who has since been demoted, must not
    // have `role: admin` copied forward into the renewed token.
    const admin = await createAdminUser(db, { username: `carry_${randomUUID().slice(0, 6)}` });
    await db.query(`UPDATE users SET role = 'user' WHERE id = $1`, [admin.id]);

    const staleToken = nearExpiryToken(admin, { role: 'admin' });
    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Cookie', [`token=${staleToken}`])
      .expect(200);

    const setCookie = res.headers['set-cookie'] || [];
    const fresh = setCookie.find((c) => c.startsWith('token=') && !/token=;/.test(c));
    assert.ok(fresh, 'expected a renewed cookie');

    const value = fresh.split(';')[0].slice('token='.length);
    const decoded = jwt.verify(value, config.jwt.secret);
    assert.equal(decoded.role, 'user', 'renewal must adopt the live role, not re-sign the stale one');
  });
});

// Path: tests/integration/auth-limiter-bucket-scope.repro.test.js
// Regression (achado 6): ONE `authLimiter` instance — one MemoryStore — guarded five
// routes, keyed by `${ip}:${req.body?.username}`. Only /login and /register declare a
// `username`; /refresh, /verify-email and /resend-verification do not. So all three
// keyed to the bare string `ip:` and drained a SINGLE 10-per-15-min bucket TOGETHER,
// per client address. Two opposite failures out of the same line:
//
//   (a) Denial of service to honest sessions. /refresh is the steady-state route of
//       every logged-in session (~1 request per 15-min access token). Behind a shared
//       egress address — the documented deployment is a military network behind nginx —
//       the 11th refresh in a window is a 429, and the frontend converts ANY refresh
//       error into a definitive logout (api-client.js `refresh()` catch → clearTokens
//       + _notifyAuthLost), so the user is thrown out for someone else's traffic.
//       Worse, unrelated routes share the drain: a burst of /resend-verification
//       spends the budget that /refresh needs.
//
//   (b) No limit at all for an attacker. The limiter runs BEFORE `validate`
//       (stripUnknown: true), so an unvalidated `username` injected into the body of
//       /resend-verification mints a brand-new bucket on every request — unlimited
//       e-mail sending and account enumeration from one address.
//
// Achado 13 (fixed 2026-07-19) made `req.ip` the real client via `trust proxy`; that
// changed the blast radius from global to per-address but not the collapse itself.
// These tests vary X-Forwarded-For precisely so a global limiter cannot pass them.
//
// Negative control: point /refresh, /verify-email and /resend-verification back at
// `authLimiter` in auth.routes.js and cases 1, 2 and 3 fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser } from '../helpers/fixtures.js';

describe('credential-route limiters do not share one bucket (repro)', () => {
  let app, db;
  const max = config.rateLimit.authMax;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    process.env.RATE_LIMIT_FORCE = '1';
  });

  after(async () => {
    delete process.env.RATE_LIMIT_FORCE;
    await teardownTestEnv(db);
  });

  const post = (path, body, ip) =>
    supertest(app).post(`/api/v1/auth${path}`).set('X-Forwarded-For', ip).send(body);

  it('a flood of /resend-verification does not throttle /refresh from the same client', async () => {
    const ip = '203.0.113.61';

    for (let i = 0; i < max + 5; i++) {
      await post('/resend-verification', { email: `ninguem_${i}@example.mil` }, ip);
    }

    // A session refreshing from the same address must still be served. The token is
    // bogus (401 expected), which is exactly what proves the request REACHED the
    // handler instead of being rejected by a throttler it never should have shared.
    const refreshed = await post('/refresh', { refreshToken: randomUUID() }, ip);
    assert.notEqual(
      refreshed.status, 429,
      'unrelated e-mail traffic must not spend the refresh budget of the same client'
    );
    assert.equal(refreshed.status, 401, 'the bogus refresh token is rejected on its own merits');
  });

  it('a chain of SUCCESSFUL refreshes is never throttled', async () => {
    // The reported outage, reproduced at its narrowest: legitimate sessions sharing
    // one egress address doing nothing but renewing their tokens. A ceiling sized for
    // credential guessing must not be spent by requests that prove they hold a valid
    // credential.
    const ip = '203.0.113.62';
    const user = await createUser(db, { username: `refr_${randomUUID().slice(0, 8)}` });
    const login = await supertest(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ username: user.username, password: user.password })
      .expect(200);

    let refreshToken = login.body.data.refreshToken;
    for (let i = 0; i < max * 2; i++) {
      const res = await post('/refresh', { refreshToken }, ip);
      assert.equal(res.status, 200, `refresh #${i + 1} must succeed, got ${res.status}`);
      refreshToken = res.body.data.refreshToken;
    }
  });

  it('an injected, unvalidated username does not mint a fresh bucket on /resend-verification', async () => {
    // The bypass: the limiter reads req.body BEFORE Joi strips unknown keys, so a
    // random `username` per request used to produce a random key per request.
    const ip = '203.0.113.63';

    let last;
    for (let i = 0; i < max + 1; i++) {
      last = await post(
        '/resend-verification',
        { email: `spam_${i}@example.mil`, username: randomUUID() },
        ip
      );
    }
    assert.equal(
      last.status, 429,
      'a body field the route does not declare must not buy a new rate-limit bucket'
    );
    assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
  });

  it('/verify-email keeps its own bucket, separate from /resend-verification', async () => {
    // Same client, different route: exhausting one must not pre-emptively lock the
    // other. This is the collapse itself, stated as an invariant.
    const ip = '203.0.113.64';

    for (let i = 0; i < max + 1; i++) {
      await post('/resend-verification', { email: `flood_${i}@example.mil` }, ip);
    }
    const verify = await post('/verify-email', { token: randomUUID() }, ip);
    assert.notEqual(verify.status, 429, '/verify-email must not inherit the resend bucket');
  });

  it('the limiters stay per client: another address is unaffected', async () => {
    // Guards the achado-13 fix from being undone by this one: a limiter that stopped
    // keying on the address would pass every test above and still be global.
    const heavy = '203.0.113.65';
    const bystander = '198.51.100.66';

    let last;
    for (let i = 0; i < max + 1; i++) {
      last = await post('/resend-verification', { email: `heavy_${i}@example.mil` }, heavy);
    }
    assert.equal(last.status, 429, 'the heavy client exhausted its own budget');

    const other = await post('/resend-verification', { email: 'quieto@example.mil' }, bystander);
    assert.notEqual(other.status, 429, 'an unrelated client must not inherit that bucket');
  });
});

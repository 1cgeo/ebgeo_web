// Path: tests/integration/rate-limit.test.js
// Verifies the auth rate limiter returns 429 after the configured number of
// attempts. The limiter is skipped in the test env by default; we force it on
// via RATE_LIMIT_FORCE (read live, per request) and use a unique username key
// so the in-memory counter cannot collide with other tests.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import config from '../../src/config.js';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

describe('Rate limiting — credential routes', () => {
  let app, db;

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

  it('returns 429 once the auth attempt limit is exceeded', async () => {
    const username = 'ratelimit_victim_unique';
    const max = config.rateLimit.authMax;

    let last;
    for (let i = 0; i < max + 1; i++) {
      last = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ username, password: 'wrong-password' });
    }

    assert.equal(last.status, 429);
    assert.equal(last.body.error.code, 'TOO_MANY_REQUESTS');
  });

  it('does not throttle distinct usernames from the same client', async () => {
    // A different username key must still be allowed (not blocked by the above).
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: 'ratelimit_other_unique', password: 'wrong-password' });
    assert.equal(res.status, 401); // wrong creds, but NOT rate-limited
  });
});

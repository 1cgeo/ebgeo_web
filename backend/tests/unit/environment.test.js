// Path: tests/unit/environment.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../../src/utils/environment.js';

describe('EnvironmentManager', () => {
  it('reflects the test environment', () => {
    assert.equal(env.isTest, true);
    assert.equal(env.isProduction, false);
    assert.equal(env.useHttps, false);
  });

  it('cookieOptions are non-secure / lax in dev/test, httpOnly always', () => {
    const opts = env.cookieOptions();
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.secure, false);
    assert.equal(opts.sameSite, 'lax');
  });

  // There was a third case here, `assert.ok(env.dbPoolMax() <= 5)`, and it was
  // tautological: the function it exercised returned `Math.min(poolMax, 5)` outside
  // production, so the assert could not fail for any configuration. Worse, it was the
  // only caller in the repo, which made a dead function look consumed. Function and
  // assert were removed together on 2026-07-25; the real pool size is
  // `config.db.poolMax`, applied in `src/database/index.js`.
});

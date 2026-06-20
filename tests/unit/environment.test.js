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

  it('dbPoolMax caps below the configured max in non-production', () => {
    assert.ok(env.dbPoolMax() <= 5);
  });
});

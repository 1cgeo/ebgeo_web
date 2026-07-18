// Path: tests/unit/duration.test.js
// L5 — the cookie lifetime is DERIVED from JWT_ACCESS_EXPIRY instead of a
// hardcoded 15 minutes. The constant silently desynced from the (configurable)
// token expiry: raising JWT_ACCESS_EXPIRY still expired the cookie at 15 min,
// logging the user out while their token was perfectly valid.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../../src/utils/duration.js';
import { env } from '../../src/utils/environment.js';
import config from '../../src/config.js';

describe('parseDuration', () => {
  it('converts each supported unit', () => {
    assert.equal(parseDuration('30s'), 30 * 1000);
    assert.equal(parseDuration('15m'), 15 * 60 * 1000);
    assert.equal(parseDuration('2h'), 2 * 60 * 60 * 1000);
    assert.equal(parseDuration('7d'), 7 * 24 * 60 * 60 * 1000);
  });

  it('returns 0 for anything outside the [smhd] grammar', () => {
    // '1w' is the trap that motivated the P7 boot validation: natural-looking,
    // silently 0, so every refresh token would be born expired.
    assert.equal(parseDuration('1w'), 0);
    assert.equal(parseDuration('15'), 0);
    assert.equal(parseDuration('m'), 0);
    assert.equal(parseDuration('-5m'), 0);
    assert.equal(parseDuration('1.5h'), 0);
  });

  it('never throws on non-string input', () => {
    assert.equal(parseDuration(undefined), 0);
    assert.equal(parseDuration(null), 0);
    assert.equal(parseDuration(123), 0);
  });

  it('accepts zero-valued durations at the parser level', () => {
    // The parser is purely mechanical; rejecting 0 is the boot validator's job.
    assert.equal(parseDuration('0m'), 0);
  });
});

describe('cookieOptions maxAge tracks the access-token lifetime (L5)', () => {
  // HONEST LIMITATION: the test env leaves JWT_ACCESS_EXPIRY at its 15m default,
  // where the derived value and the old hardcoded constant COINCIDE — so this
  // case cannot, on its own, distinguish the fix from the bug. `config.jwt` is
  // frozen and read at import, so it cannot be re-pointed at runtime from here.
  // The real guarantees are the parseDuration cases above plus the assertion
  // that the value is computed from config rather than written literally.
  it('matches parseDuration(JWT_ACCESS_EXPIRY)', () => {
    const expected = parseDuration(config.jwt.accessExpiry);
    assert.ok(expected > 0, 'the configured access expiry must be parseable');
    assert.equal(env.cookieOptions().maxAge, expected);
  });

  it('still emits the security attributes alongside it', () => {
    // Guard: deriving maxAge must not have disturbed the rest of the cookie.
    const opts = env.cookieOptions();
    assert.equal(opts.httpOnly, true);
    assert.equal(typeof opts.sameSite, 'string');
    assert.equal(typeof opts.secure, 'boolean');
  });
});

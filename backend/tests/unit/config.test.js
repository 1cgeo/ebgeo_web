// Path: tests/unit/config.test.js
// Unit tests for config helpers: env validation (fail-fast) and the
// self-registration gating logic.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvVariables, resolveAllowSelfRegistration } from '../../src/config.js';

describe('config — resolveAllowSelfRegistration', () => {
  it('defaults to false in production', () => {
    assert.equal(resolveAllowSelfRegistration('production', undefined), false);
  });

  it('defaults to true in development and test', () => {
    assert.equal(resolveAllowSelfRegistration('development', undefined), true);
    assert.equal(resolveAllowSelfRegistration('test', undefined), true);
  });

  it('honors an explicit override regardless of environment', () => {
    assert.equal(resolveAllowSelfRegistration('production', 'true'), true);
    assert.equal(resolveAllowSelfRegistration('development', 'false'), false);
    assert.equal(resolveAllowSelfRegistration('test', 'false'), false);
  });
});

describe('config — validateEnvVariables', () => {
  it('passes with the valid test environment', () => {
    assert.doesNotThrow(() => validateEnvVariables());
  });

  it('rejects production without CORS_ORIGIN (C1 fail-fast)', () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
      JWT_SECRET: process.env.JWT_SECRET,
    };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.CORS_ORIGIN;
      // A valid >=32-char secret so only the CORS rule fires in prod.
      process.env.JWT_SECRET = 'x'.repeat(40);

      let caught;
      try {
        validateEnvVariables();
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, 'prod without CORS_ORIGIN should throw');
      assert.match(caught.message, /CORS_ORIGIN/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('passes in production with a valid CORS_ORIGIN', () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
      JWT_SECRET: process.env.JWT_SECRET,
    };
    try {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGIN = 'https://ebgeo.example.mil.br';
      process.env.JWT_SECRET = 'x'.repeat(40);
      assert.doesNotThrow(() => validateEnvVariables());
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('does not require CORS_ORIGIN outside production', () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
    };
    try {
      process.env.NODE_ENV = 'development';
      delete process.env.CORS_ORIGIN;
      assert.doesNotThrow(() => validateEnvVariables());
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('accumulates ALL errors (does not stop at the first)', () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      PORT: process.env.PORT,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
    };
    try {
      delete process.env.DATABASE_URL;
      process.env.PORT = 'not-a-number';
      process.env.CORS_ORIGIN = 'not a url';

      let caught;
      try {
        validateEnvVariables();
      } catch (err) {
        caught = err;
      }

      assert.ok(caught, 'validateEnvVariables should throw');
      assert.match(caught.message, /DATABASE_URL/);
      assert.match(caught.message, /PORT/);
      assert.match(caught.message, /CORS_ORIGIN/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// P7 — numeric knobs and token lifetimes fail fast instead of becoming NaN.
//
// Every one of these is read with parseInt, which fails SILENTLY. The three
// observed consequences, each pinned below:
//   MAX_BULK_UPLOAD_MB=abc       → express.json({limit:'NaNmb'}) → NO body limit
//   WS_HEARTBEAT_INTERVAL_MS=abc → setInterval(NaN) ≈ every 1ms → query storm
//   JWT_REFRESH_EXPIRY=1w        → parseDuration=0 → every refresh born expired
// ---------------------------------------------------------------------------
describe('config — validateEnvVariables numeric/duration rules (P7)', () => {
  /** Runs validateEnvVariables with `vars` applied, always restoring the env. */
  function withEnv(vars, fn) {
    const saved = {};
    for (const k of Object.keys(vars)) saved[k] = process.env[k];
    try {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it('rejects a non-numeric MAX_BULK_UPLOAD_MB (would remove the body limit)', () => {
    withEnv({ MAX_BULK_UPLOAD_MB: 'abc' }, () => {
      assert.throws(() => validateEnvVariables(), /MAX_BULK_UPLOAD_MB/);
    });
  });

  it('rejects a partially-numeric value (parseInt would silently truncate)', () => {
    // parseInt('12abc') === 12 — accepting it would hide a real typo.
    withEnv({ MAX_IMAGE_SIZE_MB: '12abc' }, () => {
      assert.throws(() => validateEnvVariables(), /MAX_IMAGE_SIZE_MB/);
    });
  });

  it('rejects a WS heartbeat below the sane floor (setInterval storm)', () => {
    withEnv({ WS_HEARTBEAT_INTERVAL_MS: '5' }, () => {
      assert.throws(() => validateEnvVariables(), /WS_HEARTBEAT_INTERVAL_MS/);
    });
  });

  it('rejects a zero worker count / pool size', () => {
    withEnv({ SQLITE_BLOB_WORKERS: '0' }, () => {
      assert.throws(() => validateEnvVariables(), /SQLITE_BLOB_WORKERS/);
    });
    withEnv({ DATABASE_POOL_MAX: '0' }, () => {
      assert.throws(() => validateEnvVariables(), /DATABASE_POOL_MAX/);
    });
  });

  it('accepts valid numeric values and an unset variable', () => {
    withEnv({ MAX_BULK_UPLOAD_MB: '50', WS_HEARTBEAT_INTERVAL_MS: '30000' }, () => {
      assert.doesNotThrow(() => validateEnvVariables());
    });
    withEnv({ MAX_BULK_UPLOAD_MB: undefined }, () => {
      assert.doesNotThrow(() => validateEnvVariables(), 'an unset var must fall back to its default');
    });
  });

  it("rejects JWT_REFRESH_EXPIRY='1w' — parseDuration returns 0 for it", () => {
    // The classic trap: natural-looking, but the [smhd] grammar has no 'w', so
    // parseDuration yields 0 and every refresh token is expired on write.
    withEnv({ JWT_REFRESH_EXPIRY: '1w' }, () => {
      assert.throws(() => validateEnvVariables(), /JWT_REFRESH_EXPIRY/);
    });
  });

  it('rejects a zero-valued duration', () => {
    withEnv({ JWT_ACCESS_EXPIRY: '0m' }, () => {
      assert.throws(() => validateEnvVariables(), /JWT_ACCESS_EXPIRY/);
    });
  });

  it('accepts well-formed durations', () => {
    withEnv({ JWT_ACCESS_EXPIRY: '15m', JWT_REFRESH_EXPIRY: '7d' }, () => {
      assert.doesNotThrow(() => validateEnvVariables());
    });
  });

  it('reports ALL offending variables at once, not just the first', () => {
    withEnv({ MAX_BULK_UPLOAD_MB: 'abc', WS_HEARTBEAT_INTERVAL_MS: 'xyz' }, () => {
      try {
        validateEnvVariables();
        assert.fail('expected a throw');
      } catch (err) {
        assert.match(err.message, /MAX_BULK_UPLOAD_MB/);
        assert.match(err.message, /WS_HEARTBEAT_INTERVAL_MS/);
      }
    });
  });
});

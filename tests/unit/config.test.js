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

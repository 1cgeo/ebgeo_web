// Path: tests/unit/config-cors-origin.repro.test.js
// Regression (achado 39): CORS_ORIGIN was validated with `new URL(raw)` as a mere
// parseability test, and the parsed value was discarded.
//
// `new URL()` accepts plenty of strings that are NOT an Origin: a trailing slash
// (`https://host/`), a path (`https://host/app`), an explicit default port
// (`https://host:443`) and even a comma-separated list (`https://a,https://b`,
// which parses as the single hostname `a,https`). All of them passed the
// production fail-fast, and app.js hands the raw string to `cors()`. With a STRING
// origin the `cors` package compares nothing — it echoes the configured value
// verbatim into Access-Control-Allow-Origin. The browser then compares it against
// its own origin, which never has a trailing slash, and blocks the response. The
// backend answers 200 and looks healthy while the frontend, whose boot is
// fail-fast on GET /api/config, shows "EBGeo indisponível".
//
// The failure is fail-CLOSED (it breaks cross-origin, it does not loosen it), so
// the cost is availability plus a diagnosis that points nowhere near the cause.
// Boot is the cheap place to catch it.
//
// Negative control: revert the `raw !== parsed.origin` check in config.js
// (validateEnvVariables) and every "rejects" case below passes validation.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnvVariables } from '../../src/config.js';
import config from '../../src/config.js';

/** Runs validateEnvVariables in production with the given CORS_ORIGIN, restoring env. */
function validateInProd(corsOrigin) {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = corsOrigin;
    process.env.JWT_SECRET = 'x'.repeat(40); // so only the CORS rule can fire
    try {
      validateEnvVariables();
      return null;
    } catch (err) {
      return err;
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('CORS_ORIGIN must be a canonical origin, not just a parseable URL (repro)', () => {
  // The exact value a copy/paste from the browser address bar produces.
  it('rejects a trailing slash', () => {
    const err = validateInProd('https://ebgeo.example.mil.br/');
    assert.ok(err, 'a trailing slash must fail the boot check');
    assert.match(err.message, /CORS_ORIGIN/);
  });

  it('rejects a path', () => {
    const err = validateInProd('https://ebgeo.example.mil.br/app');
    assert.ok(err, 'a path must fail the boot check');
    assert.match(err.message, /CORS_ORIGIN/);
  });

  it('rejects a comma-separated list (parses as one bogus hostname)', () => {
    const err = validateInProd('https://a.mil.br,https://b.mil.br');
    assert.ok(err, 'a list must fail the boot check — `cors` gets a string, not an array');
    assert.match(err.message, /CORS_ORIGIN/);
  });

  it('rejects an explicit default port (the browser Origin never carries it)', () => {
    const err = validateInProd('https://ebgeo.example.mil.br:443');
    assert.ok(err, ':443 is dropped from the browser Origin, so it can never match');
    assert.match(err.message, /CORS_ORIGIN/);
  });

  it('rejects surrounding whitespace (config uses the RAW, untrimmed value)', () => {
    const err = validateInProd(' https://ebgeo.example.mil.br ');
    assert.ok(err, 'whitespace survives into the echoed header and never matches');
  });

  // Negative control: the well-formed shapes must keep booting, including the
  // non-default port that dev/E2E rely on.
  it('accepts a canonical https origin', () => {
    assert.equal(validateInProd('https://ebgeo.example.mil.br'), null);
  });

  it('accepts a canonical origin with a non-default port', () => {
    assert.equal(validateInProd('http://localhost:3000'), null);
    assert.equal(validateInProd('https://ebgeo.example.mil.br:8443'), null);
  });

  it('still rejects a value that is not a URL at all', () => {
    const err = validateInProd('not a url');
    assert.ok(err);
    assert.match(err.message, /CORS_ORIGIN/);
  });

  // The property the header contract depends on, asserted on the value actually
  // in use (default included) rather than on a fixture.
  it('the effective config.cors.origin is already canonical', () => {
    assert.equal(config.cors.origin, new URL(config.cors.origin).origin);
  });
});

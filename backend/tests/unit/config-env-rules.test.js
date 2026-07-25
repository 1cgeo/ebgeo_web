// Path: tests/unit/config-env-rules.test.js
// NUMERIC_ENV_RULES is a HAND-MAINTAINED list, and it is the whole antidote to
// the silent-parseInt trap config.js documents (`MAX_BULK_UPLOAD_MB=abc` →
// `express.json({limit:'NaNmb'})` → no body limit at all). A knob that enters
// config.js without an entry brings that trap back, and nothing fails.
//
// This file is the cross-check between the two independent places in config.js:
// the `parseInt(optional('X'…))` / `optionalInt('X')` CALL SITES and the RULE
// TABLE. Reading the file text is deliberate — it is the same technique
// docs-integridade uses — because the call sites cannot be enumerated at runtime.
//
// The drift this caught on its first run: TRUST_PROXY_HOPS,
// RATE_LIMIT_GAZETTEER_WINDOW_MS and RATE_LIMIT_GAZETTEER_MAX were read here and
// missing from the table (rules added), and SQLITE_BLOB_WORKERS sits in the table
// while being read somewhere else entirely (allowlisted below, with the file).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NUMERIC_ENV_RULES, validateEnvVariables } from '../../src/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(HERE, '../../src/config.js');
const SOURCE = readFileSync(CONFIG_PATH, 'utf8');

// Keys read numerically in config.js that legitimately have NO rule.
const CALLSITE_ALLOWLIST = new Map([
  ['PORT', 'validated on its own at config.js (range 1..65535), with its own message'],
  ['TERRAIN_MINZOOM', 'read via optionalInt: garbage yields undefined, never NaN (see config-defaults.test.js)'],
  ['TERRAIN_MAXZOOM', 'read via optionalInt: garbage yields undefined, never NaN'],
  ['HILLSHADE_MINZOOM', 'read via optionalInt: garbage yields undefined, never NaN'],
  ['HILLSHADE_MAXZOOM', 'read via optionalInt: garbage yields undefined, never NaN'],
]);

// Rules whose variable is consumed OUTSIDE config.js.
const RULE_ALLOWLIST = new Map([
  ['SQLITE_BLOB_WORKERS', 'src/utils/sqlite-blob-pool.js reads it directly'],
]);

/**
 * Strips comments, so that PROSE about a call site is never mistaken for one.
 * (Not cosmetic: the first run of this file reported a phantom key `X` picked up
 * from a comment in config.js that spells the pattern out.)
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Env keys read as integers in config.js: parseInt(optional(…)) and optionalInt(…). */
function extractNumericCallSites(rawSource) {
  const source = stripComments(rawSource);
  const keys = new Set();
  for (const m of source.matchAll(/parseInt\(\s*optional\('([A-Z0-9_]+)'/g)) keys.add(m[1]);
  for (const m of source.matchAll(/optionalInt\('([A-Z0-9_]+)'/g)) keys.add(m[1]);
  return keys;
}

describe('config — NUMERIC_ENV_RULES covers every numeric env read in config.js', () => {
  it('the extractor finds the call sites (guard: a regex that stops matching must fail loudly)', () => {
    const keys = extractNumericCallSites(SOURCE);
    assert.ok(
      keys.size >= 20,
      `guard: expected >= 20 numeric env call sites in config.js, extracted ${keys.size} — the regex stopped matching`
    );
    // Spot anchors from three different sections, so a partial match is visible.
    for (const anchor of ['DATABASE_POOL_MAX', 'WS_HEARTBEAT_INTERVAL_MS', 'SMTP_PORT', 'TERRAIN_MINZOOM']) {
      assert.ok(keys.has(anchor), `the extractor lost ${anchor}`);
    }
  });

  it('every numeric env read here has a rule (or a justified allowlist entry)', () => {
    const orphans = [];
    for (const key of extractNumericCallSites(SOURCE)) {
      if (key in NUMERIC_ENV_RULES) continue;
      if (CALLSITE_ALLOWLIST.has(key)) continue;
      orphans.push(key);
    }
    assert.deepEqual(
      orphans,
      [],
      `read with parseInt but absent from NUMERIC_ENV_RULES (silent NaN): ${orphans.join(', ')}`
    );
  });

  it('every rule points at a variable this file reads (or a justified allowlist entry)', () => {
    const callSites = extractNumericCallSites(SOURCE);
    const stale = [];
    for (const key of Object.keys(NUMERIC_ENV_RULES)) {
      if (callSites.has(key)) continue;
      if (RULE_ALLOWLIST.has(key)) continue;
      stale.push(key);
    }
    assert.deepEqual(
      stale,
      [],
      `rule with no call site in config.js and no allowlist justification: ${stale.join(', ')}`
    );
    assert.ok(Object.keys(NUMERIC_ENV_RULES).length >= 18, 'guard: the rule table must not be empty');
  });

  it('every rule has a numeric `min`, and `max` (when present) is above it', () => {
    const entries = Object.entries(NUMERIC_ENV_RULES);
    assert.ok(entries.length >= 18, `guard: expected >= 18 rules to inspect, found ${entries.length}`);

    // An inverted or non-numeric bound makes a rule that can never pass (or never
    // fail) without the table looking wrong. Collected rather than asserted
    // in-place so the failure names every offender at once.
    const badMin = entries.filter(([, r]) => !Number.isFinite(r.min)).map(([n]) => n);
    assert.deepEqual(badMin, [], `rules whose min is not a finite number: ${badMin.join(', ')}`);

    const bounded = entries.filter(([, r]) => r.max !== undefined);
    assert.ok(bounded.length >= 10, `guard: expected >= 10 rules to carry a ceiling, found ${bounded.length}`);
    const inverted = bounded.filter(([, r]) => !(r.max > r.min)).map(([n]) => n);
    assert.deepEqual(inverted, [], `rules whose max does not exceed min: ${inverted.join(', ')}`);
  });

  // The rules added because this cross-check found them missing. Asserting the
  // BEHAVIOUR (not just the table entry) is what makes their removal fail here.
  it('the newly covered knobs actually fail fast', () => {
    const cases = [
      ['TRUST_PROXY_HOPS', 'abc'],
      ['TRUST_PROXY_HOPS', '99'],
      ['RATE_LIMIT_GAZETTEER_MAX', '0'],
      ['RATE_LIMIT_GAZETTEER_WINDOW_MS', 'xyz'],
    ];
    let checked = 0;
    for (const [name, bad] of cases) {
      const saved = process.env[name];
      try {
        process.env[name] = bad;
        assert.throws(
          () => validateEnvVariables(),
          new RegExp(name),
          `${name}=${bad} must be refused at boot`
        );
        checked++;
      } finally {
        if (saved === undefined) delete process.env[name];
        else process.env[name] = saved;
      }
    }
    assert.equal(checked, cases.length, 'every case ran');
  });
});

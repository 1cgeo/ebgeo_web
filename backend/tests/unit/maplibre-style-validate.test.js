// Path: tests/unit/maplibre-style-validate.test.js
// Item 143 (testes-backend.md) — the backend half of the twin style validator.
//
// The frontend twin has its own unit suite (frontend/tests/unit/maplibre-style-validate.test.js);
// the backend one had ZERO, touched only by two extreme points in catalog.test.js
// ({version:7} -> 400 and the minimal valid style -> 201). The three genuinely
// treacherous guards were never exercised:
//   - Array.isArray on `sources` — typeof [] === 'object', so without that clause an
//     ARRAY of sources sails through;
//   - Array.isArray on `layers`;
//   - the STRICT `!== 8` on version — relaxing it to `!=` would let the string '8' pass.
// A malformed style that escapes is persisted and then served VERBATIM in the public
// GET /api/config, bricking the base map for every user (the file says so itself).
//
// The last describe is a cross-package MIRROR: the two validators must agree on the
// VERDICT for the same inputs. Their messages differ by language, deliberately; a
// divergence in ok/not-ok means the admin editor accepts what the server refuses (or
// worse, the reverse), and nothing else in either package would notice.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMapLibreStyle } from '../../src/utils/maplibre-style-validate.js';
import { validateMapLibreStyle as feValidate } from '../../../frontend/src/js/utilities/maplibre-style-validate.js';

/** [label, input, expectedOk] — the shared table, also replayed against the frontend twin. */
const TABLE = [
  ['minimal valid style', { version: 8, sources: {}, layers: [] }, true],
  [
    'realistic raster style',
    {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://x/{z}/{x}/{y}.png'], tileSize: 256 } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      glyphs: 'https://x/{fontstack}/{range}.pbf',
    },
    true,
  ],
  ["version as the STRING '8'", { version: '8', sources: {}, layers: [] }, false],
  ['version 7', { version: 7, sources: {}, layers: [] }, false],
  ['version absent', { sources: {}, layers: [] }, false],
  ['sources as an ARRAY', { version: 8, sources: [], layers: [] }, false],
  ['sources null', { version: 8, sources: null, layers: [] }, false],
  ['sources absent', { version: 8, layers: [] }, false],
  ['sources as a string', { version: 8, sources: 'osm', layers: [] }, false],
  ['layers as an OBJECT', { version: 8, sources: {}, layers: {} }, false],
  ['layers absent', { version: 8, sources: {} }, false],
  ['layers null', { version: 8, sources: {}, layers: null }, false],
  ['top-level null', null, false],
  ['top-level undefined', undefined, false],
  ['top-level array', [], false],
  ['top-level string', 'x', false],
  ['top-level number', 42, false],
];

describe('validateMapLibreStyle — the guards the two integration points never reached', () => {
  it('accepts the minimal and the realistic style with no errors', () => {
    assert.deepEqual(validateMapLibreStyle(TABLE[0][1]), { ok: true, errors: [] });
    assert.equal(validateMapLibreStyle(TABLE[1][1]).ok, true);
  });

  it("rejects version as the STRING '8' — the case that distinguishes !== from !=", () => {
    const r = validateMapLibreStyle({ version: '8', sources: {}, layers: [] });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /version/);
  });

  it('rejects an ARRAY of sources — typeof [] === "object" would otherwise pass', () => {
    const r = validateMapLibreStyle({ version: 8, sources: [], layers: [] });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /sources/);
  });

  it('rejects layers given as an object', () => {
    const r = validateMapLibreStyle({ version: 8, sources: {}, layers: {} });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /layers/);
  });

  it('a non-object at the top level yields ONE message and short-circuits', () => {
    // Note: `config.style === null` really does reach here — assertValidStyle only
    // skips when style === undefined (catalog.service.js:16).
    const inputs = [null, undefined, [], 'x', 42, true];
    assert.equal(inputs.length, 6, 'the table must not be empty');
    for (const input of inputs) {
      const r = validateMapLibreStyle(input);
      assert.equal(r.ok, false, `${JSON.stringify(input)} must be rejected`);
      assert.deepEqual(r.errors, ['Style must be a JSON object.']);
    }
  });

  it('ACCUMULATES errors instead of stopping at the first', () => {
    const r = validateMapLibreStyle({ version: 7 });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 3, `expected version+sources+layers errors, got ${JSON.stringify(r.errors)}`);
  });

  it('ok is exactly "no errors" for every entry of the shared table', () => {
    assert.equal(TABLE.length, 17, 'the shared table must not be empty');
    for (const [label, input, expectedOk] of TABLE) {
      const r = validateMapLibreStyle(input);
      assert.equal(r.ok, expectedOk, `${label}: expected ok=${expectedOk}, errors=${JSON.stringify(r.errors)}`);
      assert.equal(r.ok, r.errors.length === 0, `${label}: ok must mean "no errors"`);
    }
  });
});

describe('cross-package mirror — backend and frontend must reach the SAME verdict', () => {
  it('agrees with the frontend twin on every entry of the shared table', () => {
    assert.equal(TABLE.length, 17, 'the shared table must not be empty');
    for (const [label, input, expectedOk] of TABLE) {
      const be = validateMapLibreStyle(input);
      const fe = feValidate(input);
      assert.equal(be.ok, fe.ok, `${label}: backend=${be.ok} frontend=${fe.ok} — the validators diverged`);
      assert.equal(be.ok, expectedOk, `${label}: both agree, but on the wrong answer`);
      // The messages differ by language on purpose; the COUNT must not.
      assert.equal(
        be.errors.length,
        fe.errors.length,
        `${label}: the two validators disagree on how many rules were broken`,
      );
    }
  });
});

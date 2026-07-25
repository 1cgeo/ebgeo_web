// Path: tests/unit/sv360-validate-manifest.test.js
// validateManifest() — the ONLY gate between a studio-exported bundle and the sv360
// tables. It is exercised today only over HTTP (sv360-ingest.test.js), and only for
// three of its rules (lat/lon range, NaN, orphan target, db_filename separator).
// The two rules pinned here were never touched:
//
//   1. DUPLICATE sequence_number. The .custom() invariant is what keeps
//      UNIQUE(project_id, sequence_number) from firing as SQLSTATE 23505, which the
//      sv360ErrorHandler renders as 409 — a DIFFERENT contract than the 422 the
//      module promises for a malformed bundle. Delete the guard and the status code
//      silently changes for every studio export with a repeated sequence.
//   2. The DEFAULTS (schemaVersion / targets / deleted_photos). mergeProject reads
//      `manifest.targets ?? []`, so a missing default degrades into a silent no-op
//      rather than a crash: targets simply stop being written.
//
// Pure Joi — no Postgres, no filesystem.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../../src/modules/streetview360/sv360.ingest.js';
import { ValidationError } from '../../src/utils/errors.js';

// Real uuid v5 values (the schema pins version 5, so a v4 would be rejected for the
// wrong reason and make a "rejected" assertion prove nothing).
const P1 = '2b1e6b4e-5f8a-5c3d-9a1b-0f2e3d4c5b6a';
const P2 = '3c2f7c5f-6a9b-5d4e-8b2c-1a3f4e5d6c7b';
const P3 = '4d3a8d60-7b0c-5e5f-9c3d-2b4a5f6e7d8c';

function photo(id, seq, over = {}) {
  return {
    id,
    original_name: `${seq}.jpg`,
    sequence_number: seq,
    lat: -30.03,
    lon: -51.23,
    full_size_bytes: 1000,
    preview_size_bytes: 100,
    ...over,
  };
}

function manifest(over = {}) {
  return {
    project: { slug: 'proj-teste', name: 'Projeto Teste' },
    photos: [photo(P1, 1), photo(P2, 2)],
    ...over,
  };
}

describe('sv360 validateManifest — the cross-array invariants', () => {
  it('rejects a duplicate sequence_number with a 422 that NAMES the offending value', () => {
    // Without this guard the bundle reaches Postgres and comes back as 23505 → 409.
    // Asserting the status AND the message pins which contract the caller sees.
    const bad = manifest({ photos: [photo(P1, 7), photo(P2, 7)] });
    assert.throws(
      () => validateManifest(bad),
      (err) => {
        assert.ok(err instanceof ValidationError, 'must be the module 422, not a DB 409');
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /Duplicate sequence_number 7/);
        return true;
      }
    );
  });

  it('accepts non-contiguous and negative sequence numbers — only DUPLICATES are illegal', () => {
    // The contrast case: without it, the assertion above would still pass with a
    // guard that rejected every sequence set that was not 1..N.
    const ok = validateManifest(manifest({ photos: [photo(P1, -5), photo(P2, 900)] }));
    assert.deepEqual(ok.photos.map((p) => p.sequence_number), [-5, 900]);
  });

  it('rejects a target referencing an id absent from photos[] (intra-bundle integrity)', () => {
    const bad = manifest({ targets: [{ source_id: P1, target_id: P3 }] });
    assert.throws(() => validateManifest(bad), /not present in photos\[\]/);
  });
});

describe('sv360 validateManifest — the defaults mergeProject depends on', () => {
  it('applies targets: [] and deleted_photos: [] — arrays, never undefined', () => {
    const out = validateManifest(manifest());
    assert.deepEqual(out.targets, [], 'mergeProject iterates this list');
    assert.deepEqual(out.deleted_photos, []);
    assert.ok(Array.isArray(out.targets) && Array.isArray(out.deleted_photos));
  });

  it('defaults schemaVersion to 1 and preserves an explicit one', () => {
    assert.equal(validateManifest(manifest()).schemaVersion, 1);
    assert.equal(validateManifest(manifest({ schemaVersion: 3 })).schemaVersion, 3);
  });

  it('returns the COERCED value, not the input object (numeric strings become numbers)', () => {
    // convert: true is on. mergeProject binds these straight into the INSERT, so a
    // string reaching `lat` would be a type error at the driver, not here.
    const out = validateManifest(
      manifest({ photos: [photo(P1, '4', { lat: '-30.5', full_size_bytes: '2048' })] })
    );
    assert.equal(out.photos[0].sequence_number, 4);
    assert.equal(out.photos[0].lat, -30.5);
    assert.equal(out.photos[0].full_size_bytes, 2048);
  });
});

describe('sv360 validateManifest — the non-object and empty inputs', () => {
  // The explicit pre-check exists because Joi would report an unhelpful message for
  // a null/array/string manifest, and JSON.parse can legitimately yield all three.
  for (const bad of [null, undefined, [], 'texto', 42]) {
    it(`rejects ${JSON.stringify(bad) ?? 'undefined'} with 'Manifest must be a JSON object'`, () => {
      assert.throws(
        () => validateManifest(bad),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.message, 'Manifest must be a JSON object');
          return true;
        }
      );
    });
  }

  it('rejects photos: [] — a project with zero photos is not ingestible', () => {
    assert.throws(() => validateManifest(manifest({ photos: [] })), ValidationError);
  });

  it('rejects NaN and Infinity in a numeric field (`?? 0` would NOT have caught either)', () => {
    assert.throws(() => validateManifest(manifest({ photos: [photo(P1, 1, { lat: NaN })] })), ValidationError);
    assert.throws(
      () => validateManifest(manifest({ photos: [photo(P1, 1, { lon: Infinity })] })),
      ValidationError
    );
    assert.throws(
      () => validateManifest(manifest({ photos: [photo(P1, 1, { heading: -Infinity })] })),
      ValidationError
    );
  });

  it('rejects a db_filename carrying a path separator (traversal guard)', () => {
    assert.throws(
      () => validateManifest(manifest({ project: { slug: 'p', name: 'P', db_filename: '../other.db' } })),
      /basename/
    );
  });
});

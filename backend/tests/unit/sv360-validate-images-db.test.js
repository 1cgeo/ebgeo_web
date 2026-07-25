// Path: tests/unit/sv360-validate-images-db.test.js
// validateImagesDb() — PASSO 0 of the sv360 ingestion, and the ONLY guard against
// ingest→serve drift: it is what makes "every photo Postgres announces is servable
// from the installed {slug}.db" true. Nothing imported sv360.ingest.js directly; the
// single existing case (sv360-ingest.test.js:425) went over HTTP and covered ONE of
// the five rejection branches (blob size mismatch).
//
// DEFECT FOUND AND FIXED HERE (the report's suspicion, confirmed by probe): a file of
// random bytes SURVIVES `new Database(path, { readonly: true, fileMustExist: true })`
// — sqlite3_open() never reads the header — and the SQLITE_NOTADB surfaced only at
// the first `.prepare()`, INSIDE the try/finally that had no catch. The raw
// SqliteError is not an AppError, so sv360ErrorHandler rendered a 500: a server fault
// announced for a plainly malformed upload, and the one PASSO 0 branch that broke the
// module's "bad bundle ⇒ 4xx" contract. sv360.ingest.js now translates any
// non-AppError from that block into the intended 400.
//
// No Postgres and no HTTP: better-sqlite3 over tmp files.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { validateImagesDb } from '../../src/modules/streetview360/sv360.ingest.js';
import { AppError, BadRequestError } from '../../src/utils/errors.js';

const P1 = '2b1e6b4e-5f8a-5c3d-9a1b-0f2e3d4c5b6a';
const P2 = '3c2f7c5f-6a9b-5d4e-8b2c-1a3f4e5d6c7b';

let dir;

/** Manifest fragment: only `photos` is read by validateImagesDb. */
function manifestOf(photos) {
  return { photos };
}

function photo(id, full, preview) {
  return { id, full_size_bytes: full, preview_size_bytes: preview };
}

/**
 * Builds a {name}.db carrying an `images` table with the given rows.
 * @param {string} name - basename inside the tmp dir
 * @param {Array<{photo_id:string, full:Buffer|null, preview:Buffer|null}>} rows
 * @param {{ withTable?: boolean }} [opts]
 * @returns {string} absolute path
 */
function buildDb(name, rows, { withTable = true } = {}) {
  const file = path.join(dir, name);
  const db = new Database(file);
  if (withTable) {
    db.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = db.prepare('INSERT INTO images (photo_id, full_webp, preview_webp) VALUES (?, ?, ?)');
    for (const r of rows) ins.run(r.photo_id, r.full, r.preview);
  } else {
    db.exec('CREATE TABLE outra (x INTEGER)');
  }
  db.close();
  return file;
}

describe('sv360 validateImagesDb — the PASSO 0 rejection branches', () => {
  before(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'sv360-validate-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('happy path: sizes matching every manifest photo does NOT throw', () => {
    // The anchor. Without it, every rejection assertion below would stay green even
    // if the function had become "throw unconditionally".
    const file = buildDb('ok.db', [
      { photo_id: P1, full: Buffer.alloc(1000, 1), preview: Buffer.alloc(100, 2) },
      { photo_id: P2, full: Buffer.alloc(2000, 3), preview: Buffer.alloc(200, 4) },
    ]);
    assert.doesNotThrow(() =>
      validateImagesDb(file, manifestOf([photo(P1, 1000, 100), photo(P2, 2000, 200)]))
    );
  });

  it('a manifest photo with NO row in images.db → 400 naming the photo id', () => {
    // This is the branch that produces the drift the whole check exists to prevent:
    // Postgres would announce P2 and GET /photos/P2/image would 404 forever.
    const file = buildDb('missing-row.db', [
      { photo_id: P1, full: Buffer.alloc(10), preview: Buffer.alloc(5) },
    ]);
    assert.throws(
      () => validateImagesDb(file, manifestOf([photo(P1, 10, 5), photo(P2, 10, 5)])),
      (err) => {
        assert.ok(err instanceof BadRequestError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, new RegExp(`missing a row for photo ${P2}`));
        return true;
      }
    );
  });

  it('a valid SQLite file WITHOUT the `images` table → 400', () => {
    const file = buildDb('no-table.db', [], { withTable: false });
    assert.throws(
      () => validateImagesDb(file, manifestOf([photo(P1, 1, 1)])),
      (err) => {
        assert.ok(err instanceof BadRequestError);
        assert.match(err.message, /has no `images` table/);
        return true;
      }
    );
  });

  it('a file of RANDOM BYTES → 400 AppError, never a raw SqliteError (would be 500)', () => {
    // The regression this file was written for. The constructor accepts the file;
    // SQLITE_NOTADB only fires at the first statement. Asserting `instanceof
    // AppError` (not merely "it throws") is what discriminates 400 from 500: the
    // sv360ErrorHandler maps anything else to a server error.
    const file = path.join(dir, 'junk.db');
    writeFileSync(file, Buffer.from('nao sou um arquivo sqlite '.repeat(200)));
    assert.throws(
      () => validateImagesDb(file, manifestOf([photo(P1, 1, 1)])),
      (err) => {
        assert.ok(err instanceof AppError, `raw ${err.constructor.name} escaped → 500 for a bad upload`);
        assert.equal(err.statusCode, 400);
        assert.equal(err.constructor.name, 'BadRequestError');
        return true;
      }
    );
  });

  it('an EMPTY file → 400 (it opens and reads as a database with no tables)', () => {
    // Zero bytes is a legal empty SQLite database, so this lands on the
    // "no `images` table" branch — a different path from the random-bytes case,
    // and worth separating so a fix to one is not assumed to cover the other.
    const file = path.join(dir, 'empty.db');
    writeFileSync(file, Buffer.alloc(0));
    assert.throws(() => validateImagesDb(file, manifestOf([photo(P1, 1, 1)])), BadRequestError);
  });

  it('a path that does not exist → 400 `images.db is missing`', () => {
    assert.throws(
      () => validateImagesDb(path.join(dir, 'nao-existe.db'), manifestOf([photo(P1, 1, 1)])),
      (err) => {
        assert.ok(err instanceof BadRequestError);
        assert.equal(err.message, 'images.db is missing');
        return true;
      }
    );
  });

  it('a full_webp / preview_webp byte length that disagrees with the manifest → 400', () => {
    // The size IS the ETag source: a mismatch means the O(1) ETag served from
    // Postgres describes bytes the blobstore does not hold.
    const file = buildDb('drift.db', [
      { photo_id: P1, full: Buffer.alloc(999), preview: Buffer.alloc(100) },
    ]);
    assert.throws(
      () => validateImagesDb(file, manifestOf([photo(P1, 1000, 100)])),
      /full_webp size mismatch/
    );
    const file2 = buildDb('drift2.db', [
      { photo_id: P1, full: Buffer.alloc(1000), preview: Buffer.alloc(99) },
    ]);
    assert.throws(
      () => validateImagesDb(file2, manifestOf([photo(P1, 1000, 100)])),
      /preview_webp size mismatch/
    );
  });

  it('CHARACTERIZATION: a NULL preview_webp is accepted against preview_size_bytes 0', () => {
    // length(NULL) is NULL in SQLite and Number(null) === 0, so a row whose preview
    // blob was never written passes the check as long as the manifest claims 0
    // bytes. That is NOT obviously right — the serve path would return a null blob
    // and 404 — but it is the current behavior and it is reachable from a real
    // studio export. Pinned so a future strictness change is deliberate.
    const file = buildDb('null-preview.db', [
      { photo_id: P1, full: Buffer.alloc(10), preview: null },
    ]);
    assert.doesNotThrow(() => validateImagesDb(file, manifestOf([photo(P1, 10, 0)])));
    // And the discriminating half: a non-zero claim over a NULL blob IS rejected.
    assert.throws(
      () => validateImagesDb(file, manifestOf([photo(P1, 10, 1)])),
      /preview_webp size mismatch/
    );
  });
});

// Path: tests/unit/sqlite-blob-worker.test.js
// Item 145 (testes-backend.md) — the worker runs SQL it receives from the CALLER, and
// the only thing standing between that and a write is
// `new Database(path, { readonly: true, fileMustExist: true })` + `pragma query_only`.
//
// Nothing exercised the worker directly: assets3d-sqlite.test.js and the sv360 suites
// touch it sideways, always with a well-formed SELECT. Dropping `readonly: true` in a
// refactor would silently turn a read path into a write surface over the {slug}.db,
// with every existing test still green.
//
// The second half is about NOT HANGING: the pool has no request timeout (documented at
// sqlite-blob-pool.js:33-36), so a worker that stopped answering on an error path would
// leave the promise pending FOREVER and the symptom would be an HTTP handler that never
// responds. Every assertion below therefore races an explicit timer.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteBlobPool } from '../../src/utils/sqlite-blob-pool.js';

const SELECT = 'SELECT data FROM blobs WHERE id = ?';
const PAYLOAD = Buffer.from('RIFFxxxxWEBP-worker-payload-0123456789');

function withTimeout(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${message}`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

describe('sqlite-blob-worker — readonly enforcement over caller-supplied SQL', () => {
  let pool, tmpDir, dbPath;

  before(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'blobworker-'));
    dbPath = path.join(tmpDir, 'blobs.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)');
    db.prepare('INSERT INTO blobs VALUES (?,?)').run('a', PAYLOAD);
    db.close();
  });

  afterEach(async () => {
    if (pool) await pool.closeAll().catch(() => {});
    pool = null;
  });

  after(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Reads the row straight from disk, bypassing the pool. */
  function onDisk(id) {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT data FROM blobs WHERE id = ?').get(id);
    db.close();
    return row?.data ?? null;
  }

  it('round-trips a BLOB byte for byte through the zero-copy transfer', async () => {
    pool = new SqliteBlobPool(1);
    const buf = await withTimeout(pool.read(dbPath, SELECT, ['a']), 3000, 'a plain SELECT must answer');
    assert.ok(Buffer.isBuffer(buf), 'the pool hands back a Buffer');
    assert.equal(Buffer.compare(buf, PAYLOAD), 0, 'the bytes survive the transfer intact');
  });

  // A bare `DELETE FROM blobs` never reaches the readonly guard at all: the worker
  // calls `.prepare(sql).get(...)`, and better-sqlite3 refuses `.get()` on a statement
  // that returns no rows ("This statement does not return data"). That is a real second
  // layer, but it is NOT the one the module documents, and a refactor to `.all()` or
  // `.raw()` would remove it while leaving these tests green.
  //
  // `... RETURNING` is the discriminating probe: it DOES return rows, `.get()` accepts
  // it, and the only thing left refusing the write is
  // `{ readonly: true }` + `pragma query_only`. These are the cases that go red when
  // readonly is dropped.
  const WRITE_REFUSAL = /readonly|read-only|query_only|attempt to write/i;

  it('a DELETE ... RETURNING is refused by the READONLY guard and the row survives', async () => {
    pool = new SqliteBlobPool(1);
    await assert.rejects(
      withTimeout(pool.read(dbPath, 'DELETE FROM blobs RETURNING data', []), 3000, 'a DELETE must settle'),
      WRITE_REFUSAL,
    );
    // Asserting the ERROR alone would not prove the write did not happen.
    assert.equal(Buffer.compare(onDisk('a'), PAYLOAD), 0, 'nothing was deleted');
  });

  it('an UPDATE ... RETURNING is refused and the bytes are unchanged', async () => {
    pool = new SqliteBlobPool(1);
    await assert.rejects(
      withTimeout(
        pool.read(dbPath, "UPDATE blobs SET data = x'00' WHERE id = ? RETURNING data", ['a']),
        3000,
        'an UPDATE must settle',
      ),
      WRITE_REFUSAL,
    );
    assert.equal(Buffer.compare(onDisk('a'), PAYLOAD), 0, 'the payload is untouched');
  });

  it('an INSERT ... RETURNING is refused and no row appears', async () => {
    pool = new SqliteBlobPool(1);
    await assert.rejects(
      withTimeout(
        pool.read(dbPath, "INSERT INTO blobs VALUES ('b', x'01') RETURNING data", []),
        3000,
        'INSERT must settle',
      ),
      WRITE_REFUSAL,
    );

    const db = new Database(dbPath, { readonly: true });
    const n = db.prepare('SELECT count(*) AS n FROM blobs').get().n;
    db.close();
    assert.equal(n, 1, 'no row was inserted');
  });

  it('bare DML and DDL are refused too (by the .get() layer), and change nothing', async () => {
    pool = new SqliteBlobPool(1);
    const statements = [
      'DELETE FROM blobs',
      "UPDATE blobs SET data = x'00'",
      "INSERT INTO blobs VALUES ('c', x'02')",
      'CREATE TABLE evil (x TEXT)',
      'DROP TABLE blobs',
    ];
    assert.equal(statements.length, 5, 'the statement table must not be empty');
    for (const sql of statements) {
      await assert.rejects(
        withTimeout(pool.read(dbPath, sql, []), 3000, `${sql} must settle`),
        `${sql} must be refused`,
      );
    }

    const db = new Database(dbPath, { readonly: true });
    const n = db.prepare('SELECT count(*) AS n FROM blobs').get().n;
    const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'evil'").get().n;
    db.close();
    assert.equal(n, 1, 'the table still holds exactly the fixture row');
    assert.equal(tables, 0, 'no table was created');
  });

  it('a MISSING database file rejects instead of hanging (fileMustExist)', async () => {
    pool = new SqliteBlobPool(1);
    await assert.rejects(
      withTimeout(
        pool.read(path.join(tmpDir, 'does-not-exist.db'), 'SELECT 1', []),
        3000,
        'a missing file must produce an ERROR, not a pending promise',
      ),
    );
  });

  it('malformed SQL rejects instead of hanging', async () => {
    pool = new SqliteBlobPool(1);
    await assert.rejects(
      withTimeout(pool.read(dbPath, 'SELEKT nonsense', []), 3000, 'a syntax error must settle'),
    );
    // And the worker survives it: the next read still works on the same pool.
    const buf = await withTimeout(pool.read(dbPath, SELECT, ['a']), 3000, 'the worker must still serve reads');
    assert.equal(Buffer.compare(buf, PAYLOAD), 0);
  });

  it('a SELECT that matches no row resolves to null (not a rejection, not a hang)', async () => {
    pool = new SqliteBlobPool(1);
    const v = await withTimeout(pool.read(dbPath, SELECT, ['nope']), 3000, 'an empty result must settle');
    assert.equal(v, null);
  });
});

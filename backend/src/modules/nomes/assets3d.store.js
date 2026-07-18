// Path: src/modules/nomes/assets3d.store.js
// SQLite-backed store for 3D tile binaries (tileset.json/b3dm/glb/pnts/terrain).
// Read connection: readonly + mmap, singleton, lazy. ETag is O(1) (size/etag
// columns — the BLOB is only read on a 200/206, under the controller semaphore).
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import crypto from 'node:crypto';
import { blobPool } from '../../utils/sqlite-blob-pool.js';

// Read the path straight from env (matches config.assets3d.sqlitePath) so this
// store can be used by the standalone import CLI without loading the full config.
const DB_PATH = resolve(process.env.ASSETS_3D_SQLITE || './data/assets3d.sqlite');
const SELECT_DATA = 'SELECT data FROM assets WHERE rel_path = ?';

let _readDb = null;

function readDb() {
  if (_readDb) return _readDb;
  if (!existsSync(DB_PATH)) return null; // no store yet → caller falls back to FS
  try {
    _readDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    _readDb.pragma('query_only = true');
    _readDb.pragma('mmap_size = 268435456'); // 256 MB
    return _readDb;
  } catch {
    return null;
  }
}

/** O(1) metadata (no BLOB read): { size_bytes, content_type, etag } | null. */
export function getAssetMeta(relPath) {
  const db = readDb();
  if (!db) return null;
  return (
    db.prepare('SELECT size_bytes, content_type, etag FROM assets WHERE rel_path = ?').get(relPath) || null
  );
}

/**
 * Reads the BLOB (Buffer) on a WORKER THREAD (keeps the heavy read off the main
 * event loop). Call only on a 200/206, under the semaphore. Async.
 * @returns {Promise<Buffer|null>}
 */
export function getAssetData(relPath) {
  if (!existsSync(DB_PATH)) return Promise.resolve(null);
  return blobPool.read(DB_PATH, SELECT_DATA, [relPath]);
}

/** Opens (creating if needed) a writable connection for import/admin. */
export function openWritable() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      rel_path     TEXT PRIMARY KEY,
      data         BLOB NOT NULL,
      size_bytes   INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      etag         TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

/** Upserts an asset. Returns the (strong, content-derived) ETag. */
export function putAsset(db, relPath, buffer, contentType) {
  const etag = `"${crypto.createHash('sha1').update(buffer).digest('hex')}"`;
  db.prepare(
    `INSERT INTO assets (rel_path, data, size_bytes, content_type, etag)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(rel_path) DO UPDATE SET
       data = excluded.data, size_bytes = excluded.size_bytes,
       content_type = excluded.content_type, etag = excluded.etag`
  ).run(relPath, buffer, buffer.length, contentType, etag);
  return etag;
}

/** Closes the cached read connection (tests / graceful shutdown). */
export function closeReadDb() {
  if (_readDb) {
    try {
      _readDb.close();
    } catch {
      /* ignore */
    }
    _readDb = null;
  }
}

/** Closes the main read connection AND the worker pool (releases file handles). */
export async function closeStore() {
  closeReadDb();
  await blobPool.closeAll();
}

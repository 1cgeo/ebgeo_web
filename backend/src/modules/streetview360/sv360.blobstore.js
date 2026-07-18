// Path: src/modules/streetview360/sv360.blobstore.js
// BLOB access for the StreetView 360 module (Fase 9, stage 1). The WebP binaries
// (full/preview) live in per-project {slug}.db SQLite files under
// config.sv360.dbDir; metadata (incl. *_size_bytes for the O(1) ETag) is in
// Postgres. The heavy `SELECT <col>_webp` runs on a worker thread via the shared
// blobPool (same pattern as the assets3d store), keeping the read off the main
// event loop. The 304/Range/semaphore logic lives in the controller; here we
// only resolve the file path and fetch the Buffer.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { blobPool } from '../../utils/sqlite-blob-pool.js';
import config from '../../config.js';

// Fixed allowlist: the SQLite column is chosen from quality, never interpolated
// from raw user input.
const QUALITY_COLUMN = Object.freeze({
  full: 'full_webp',
  preview: 'preview_webp',
});

/**
 * Resolves the absolute path of a project's {slug}.db inside config.sv360.dbDir.
 * `dbFilename` ALWAYS comes from sv360.projects.db_filename (Postgres), never
 * from user input; path.basename strips any directory component as a traversal
 * defense.
 * @param {string} dbFilename - the project's db_filename (e.g. 'proj-test.db')
 * @returns {string} absolute path under config.sv360.dbDir
 */
export function resolveDbPath(dbFilename) {
  return path.resolve(config.sv360.dbDir, path.basename(dbFilename));
}

/**
 * Reads a photo's WebP BLOB from its project's {slug}.db on a worker thread.
 * @param {string} dbFile - absolute path from resolveDbPath()
 * @param {string} photoId - TEXT uuid v5 photo id (bound parameter)
 * @param {'full'|'preview'} quality - selects full_webp or preview_webp
 * @returns {Promise<Buffer|null>} the BLOB, or null if the db/row/blob is absent
 */
export function getImage(dbFile, photoId, quality) {
  const col = QUALITY_COLUMN[quality] || QUALITY_COLUMN.full;
  if (!existsSync(dbFile)) return Promise.resolve(null);
  return blobPool.read(dbFile, `SELECT ${col} FROM images WHERE photo_id = ?`, [photoId]);
}

/**
 * Terminates the worker pool, releasing every {slug}.db file handle. Required
 * before deleting a .db on Windows (EBUSY otherwise) — used in test teardown and
 * graceful shutdown. The pool is shared with the assets3d store.
 * @returns {Promise<void>}
 */
export async function closeStore() {
  await blobPool.closeAll();
}

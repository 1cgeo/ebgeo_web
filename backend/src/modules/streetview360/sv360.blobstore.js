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
 * Resolves the absolute path of a project's {slug}_tiles.db — o arquivo SQLite de
 * pixel do projeto, com as pirâmides de tile de cada panorâmica.
 *
 * É O ÚNICO ARQUIVO DE PIXEL do projeto no web desde 2026-08-29 (tiles-only): a
 * `{slug}.db` de blob full/preview e a rota de imagem inteira saíram, e toda foto
 * passou a ter pirâmide. `db_filename` continua sendo a chave LÓGICA `{slug}.db`
 * (nenhum arquivo com esse nome existe), de onde este caminho deriva o `_tiles.db`
 * e de onde a miniatura deriva o `.webp`. A origem (ebgeo_360) ainda escreve os dois
 * arquivos lado a lado, e é dela que o bundle vem.
 *
 * The name is DERIVED from db_filename, which always comes from Postgres, never from
 * user input; path.basename strips any directory component as a traversal defense —
 * same rule as resolveDbPath, applied BEFORE the suffix is appended so that a crafted
 * value cannot escape by hiding in the extension.
 * @param {string} dbFilename - the project's db_filename (e.g. 'org__proj.db')
 * @returns {string} absolute path of the tiles db under config.sv360.dbDir
 */
export function resolveTilesDbPath(dbFilename) {
  const base = path.basename(String(dbFilename));
  const semExtensao = base.endsWith('.db') ? base.slice(0, -3) : base;
  return path.resolve(config.sv360.dbDir, `${semExtensao}_tiles.db`);
}

/**
 * Reads ONE tile of a photo's pyramid from {slug}_tiles.db, on a worker thread.
 *
 * The four bound values are the table's PRIMARY KEY, so the lookup is a btree seek.
 * Range validation belongs to the CALLER: a tile outside the pyramid is a 404 here,
 * not a 400, because the client addresses tiles from a descriptor this server issued.
 *
 * Same swap-window guard as getImage: during an ingestion the destination file is
 * momentarily ABSENT (it lives under .bak while .tmp is renamed over it), and a bare
 * existsSync would report a live tile as missing.
 * @param {string} tilesDbFile - absolute path from resolveTilesDbPath()
 * @param {string} photoId - TEXT uuid v5 photo id (bound parameter)
 * @param {number} level - pyramid level (0 is the coarsest)
 * @param {number} x - column, origin at the left
 * @param {number} y - row, origin at the top
 * @returns {Promise<Buffer|null>} the WebP BLOB, or null if db/row is absent
 */
export async function getTile(tilesDbFile, photoId, level, x, y) {
  if (typeof blobPool.whenAvailable === 'function') await blobPool.whenAvailable(tilesDbFile);
  if (!existsSync(tilesDbFile)) return null;
  return blobPool.read(
    tilesDbFile,
    'SELECT webp FROM tiles WHERE photo_id = ? AND level = ? AND x = ? AND y = ?',
    [photoId, level, x, y]
  );
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

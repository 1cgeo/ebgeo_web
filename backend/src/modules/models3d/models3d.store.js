// Path: src/modules/models3d/models3d.store.js
// BYTE ACCESS FOR ONE-FILE-PER-MODEL 3D TILESETS ({slug}.3dtiles under
// config.models3d.dbDir). Ported from ebgeo_3d (src/db/{connection,tiles-queries}.js),
// keeping the two properties that were paid for there and dropping the parts the backend
// already owns (the LRU's own connections, replaced by the shared worker pool).
//
// THE FORMAT IS NOT OURS. Table `media(key, content)` is the Cesium 3d-tiles-tools
// `.3dtiles`, so a file the importer writes opens with `npx 3d-tiles-tools convert` and a
// file they write opens here. `key` is the path relative to the tileset root, forward
// slashes, no leading slash: "tileset.json", "Data/d000/c00.glb".
//
// THE FILE IS CHECKED (mtime + size) ON EVERY ACCESS, and that is not defensive
// decoration. A re-import SWAPS the file while the service is up; the pool's cached
// readonly connection stays bound to the OLD inode and would keep serving last
// generation's tiles under a one-year `immutable`. Size travels with mtime because mtime
// granularity reaches one second on some filesystems, and a swap inside the same second
// would pass unseen. The check costs a statSync, which the OS metadata cache answers
// without touching the disk.
//
// THE OPEN SET IS BOUNDED, and on Windows that is what makes a re-import possible at all:
// an open handle blocks the rename that publishes the new file. The worker pool caches a
// connection per dbPath with NO eviction of its own, so 74 models would mean 74 handles
// per worker. Here the least-recently-read model is evicted past `config.models3d.maxOpen`
// — approximate by construction (the next read reopens it), which is exactly what the
// bound is for.
import { statSync } from 'node:fs';
import path from 'node:path';
import { blobPool } from '../../utils/sqlite-blob-pool.js';
import config from '../../config.js';

// `normalizeKey` lives in models3d.service.js, which imports nothing: key hygiene is pure,
// and keeping it out of here is what lets a unit test exercise it without a database URL.

const SELECT_MEDIA = 'SELECT content FROM media WHERE key = ?';

/**
 * dbPath -> { mtimeMs, size } of the file the cached connection was opened on.
 * Insertion order IS the LRU order: a touch deletes and re-inserts.
 * @type {Map<string, {mtimeMs:number, size:number}>}
 */
const abertos = new Map();

/**
 * Absolute path of a model's file inside config.models3d.dbDir.
 *
 * `dbFilename` ALWAYS comes from a3d.models.db_filename (Postgres), never from the
 * request; `path.basename` strips any directory component as a traversal defense, the
 * same rule sv360.blobstore.js follows.
 * @param {string} dbFilename - e.g. 'ponte_quatis.3dtiles'
 * @returns {string}
 */
export function resolveDbPath(dbFilename) {
  return path.resolve(config.models3d.dbDir, path.basename(dbFilename));
}

/** Evicts the least-recently-read models past the cap. */
async function despejaExcedente() {
  while (abertos.size > config.models3d.maxOpen) {
    const maisVelho = abertos.keys().next().value;
    abertos.delete(maisVelho);
    await blobPool.evict(maisVelho);
  }
}

/**
 * Confirms the pool's cached connection still refers to the file on disk, evicting it
 * when it does not, and records the read for the LRU.
 * @param {string} dbPath
 * @returns {Promise<boolean>} false when the file is not there at all
 */
async function garanteFrescor(dbPath) {
  // A path mid-swap is momentarily ABSENT (the destination lives under .parcial while
  // the rename lands), and a stat taken inside that window reports a live model as
  // missing. `whenAvailable` resolves immediately in steady state.
  await blobPool.whenAvailable(dbPath);
  const info = statSync(dbPath, { throwIfNoEntry: false });
  if (!info) {
    if (abertos.delete(dbPath)) await blobPool.evict(dbPath);
    return false;
  }
  const visto = abertos.get(dbPath);
  if (visto && (visto.mtimeMs !== info.mtimeMs || visto.size !== info.size)) {
    abertos.delete(dbPath);
    await blobPool.evict(dbPath);
  } else {
    abertos.delete(dbPath); // re-inserted below: Map order is the LRU order
  }
  abertos.set(dbPath, { mtimeMs: info.mtimeMs, size: info.size });
  await despejaExcedente();
  return true;
}

/**
 * Reads one key of a model, on a worker thread.
 * @param {string} dbFilename - from a3d.models.db_filename
 * @param {string} chave - already normalized by normalizeKey()
 * @returns {Promise<Buffer|null>} null when the file or the key is absent
 */
export async function readMedia(dbFilename, chave) {
  const dbPath = resolveDbPath(dbFilename);
  if (!(await garanteFrescor(dbPath))) return null;
  return blobPool.read(dbPath, SELECT_MEDIA, [chave]);
}

/**
 * Forgets the LRU bookkeeping (tests, and the shutdown path). Does NOT close the pool:
 * the pool owns its workers and is torn down by its own close.
 * @returns {void}
 */
export function resetOpenModels() {
  abertos.clear();
}


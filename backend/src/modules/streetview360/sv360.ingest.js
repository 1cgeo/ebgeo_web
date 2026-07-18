// Path: src/modules/streetview360/sv360.ingest.js
// CORE ingestion orchestration for the StreetView 360 module (Fase 9, stage 3a).
// Validates a bundle and applies it as "last upload wins" by (organization_id,
// slug). Order is SWAP-FIRST-THEN-COMMIT (FIX-3): the new {slug}.db is INSTALLED
// first (keeping a .bak), THEN the Postgres merge tx runs — the Postgres commit is
// the single atomic commit point, so metadata never gets ahead of the BLOB store.
// A merge failure rolls the file install back (restore .bak / drop new file). This
// file owns the ORDER and the ROLLBACK of the swap protocol; the admin service /
// ETL call in via ingestBundle().
//
// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATOR NOTE — blobPool.evict(dbPath) (src/utils/sqlite-blob-pool.js):
//   The atomic rename of {slug}.db FAILS on Windows (EBUSY/EPERM) while a worker
//   holds a cached readonly handle to that file. This module needs a SURGICAL
//   eviction (close only that dbPath, keep assets3d/other projects alive) BEFORE
//   the rename. Required signature on the shared pool singleton:
//
//     blobPool.evict(dbPath: string): Promise<void>
//       - posts { type: 'evict', dbPath } to ALL workers (round-robin means any
//         worker may hold the cached conn);
//       - each worker: conns.get(dbPath)?.close(); conns.delete(dbPath);
//         postMessage({ type: 'evicted', dbPath });
//       - resolves once EVERY worker has acked 'evicted' (or immediately if the
//         pool has not spawned any worker yet).
//
//   Worker side (src/utils/sqlite-blob-worker.js): handle msg.type === 'evict'.
//
//   Until evict exists, evictDbPath() below degrades to blobPool.closeAll() (the
//   heavy hammer — drops ALL connections incl. assets3d). Prefer evict.
// ─────────────────────────────────────────────────────────────────────────────
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { task } from '../../database/index.js';
import { blobPool } from '../../utils/sqlite-blob-pool.js';
import { mergeProject, deriveDbFilename } from './sv360.merge.js';
import { manifestSchema } from './sv360.admin.schemas.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { BadRequestError, ValidationError } from '../../utils/errors.js';

// Namespace for the per-(orgId, slug) session advisory lock that serializes
// ingestion (P3). Distinct from the sync push namespace so the two lock spaces
// can never collide. Value is ASCII 'S360' read as int32.
const SV360_INGEST_LOCK_NAMESPACE = 0x53333630;

/**
 * Validates a manifest object against the frozen ingestion schema. Rejects:
 * NaN/Infinity in any numeric; lat∉[-90,90] / lon∉[-180,180]; missing required
 * NOT NULL columns; a db_filename with a path separator; duplicate
 * sequence_number; and a target referencing a photo id absent from photos[]
 * (intra-bundle referential integrity). Returns the COERCED/defaulted manifest
 * (defaults applied: schemaVersion, targets=[], deleted_photos=[]).
 * @param {Object} manifest - the parsed manifest.json object
 * @returns {Object} the validated + defaulted manifest
 * @throws {ValidationError} 422 with the first Joi message on failure
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new ValidationError('Manifest must be a JSON object');
  }
  const { value, error } = manifestSchema.validate(manifest, {
    abortEarly: true,
    convert: true,
  });
  if (error) {
    throw new ValidationError(error.details?.[0]?.message || 'Invalid manifest');
  }
  return value;
}

/**
 * Opens the uploaded images.db READONLY and verifies it carries the project's
 * BLOBs exactly as the manifest promises (PASSO 0 size-check, D9.7/Tarefa 6):
 *   - the `images` table exists with (photo_id, full_webp, preview_webp);
 *   - EVERY manifest photo id has a row;
 *   - full_webp / preview_webp byte lengths == the manifest's
 *     full_size_bytes / preview_size_bytes (the O(1) ETag source must match).
 * Pure validation — never written. Throws BadRequestError (400) on any mismatch
 * so PASSO 0 fails before anything is touched.
 * @param {string} imagesDbPath - tmp path of the uploaded images.db
 * @param {Object} manifest - the validated manifest
 * @throws {BadRequestError} on a missing table/row or size mismatch
 */
export function validateImagesDb(imagesDbPath, manifest) {
  if (!existsSync(imagesDbPath)) {
    throw new BadRequestError('images.db is missing');
  }
  let db;
  try {
    db = new Database(imagesDbPath, { readonly: true, fileMustExist: true });
  } catch {
    throw new BadRequestError('images.db is not a valid SQLite file');
  }
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='images'")
      .get();
    if (!table) throw new BadRequestError('images.db has no `images` table');

    const stmt = db.prepare(
      'SELECT length(full_webp) AS full_len, length(preview_webp) AS preview_len FROM images WHERE photo_id = ?'
    );
    for (const p of manifest.photos) {
      const row = stmt.get(p.id);
      if (!row) {
        throw new BadRequestError(`images.db is missing a row for photo ${p.id}`);
      }
      if (Number(row.full_len) !== Number(p.full_size_bytes)) {
        throw new BadRequestError(
          `full_webp size mismatch for photo ${p.id} (db=${row.full_len}, manifest=${p.full_size_bytes})`
        );
      }
      if (Number(row.preview_len) !== Number(p.preview_size_bytes)) {
        throw new BadRequestError(
          `preview_webp size mismatch for photo ${p.id} (db=${row.preview_len}, manifest=${p.preview_size_bytes})`
        );
      }
    }
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Surgically evicts the cached readonly handle for one dbPath across the worker
 * pool (so a rename over it succeeds on Windows). Falls back to closeAll() if the
 * pool does not yet expose evict() (see the INTEGRATOR NOTE at the top).
 * @param {string} dbPath
 * @returns {Promise<void>}
 */
async function evictDbPath(dbPath) {
  if (typeof blobPool.evict === 'function') {
    await blobPool.evict(dbPath);
  } else {
    // Hammer fallback: drops every connection (incl. assets3d). Still correct,
    // just heavier — releases the handle so the rename can proceed.
    await blobPool.closeAll();
  }
}

// Best-effort fsync. fsync requires a WRITABLE handle on Windows ('r' → EPERM)
// and is unsupported on some filesystems; the size-check guarantees integrity, so
// EPERM/EINVAL/ENOTSUP are swallowed (durability is non-critical here).
function fsyncQuiet(filePath) {
  let fd;
  try {
    fd = openSync(filePath, 'r+');
    fsyncSync(fd);
  } catch (err) {
    if (err && err.code !== 'EPERM' && err.code !== 'EINVAL' && err.code !== 'ENOTSUP') {
      throw err;
    }
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Resolves the absolute destination path of a project's {slug}.db inside
 * config.sv360.dbDir. db_filename ALWAYS comes from the manifest/Postgres;
 * path.basename strips any directory component as a traversal defense (the schema
 * already rejects separators, this is defense in depth).
 * @param {string} dbFilename
 * @returns {string} absolute path under config.sv360.dbDir
 */
export function resolveDbPath(dbFilename) {
  return path.resolve(config.sv360.dbDir, path.basename(dbFilename));
}

/**
 * Installs the new {slug}.db from a freshly uploaded images.db WITHOUT finalizing
 * — it PRESERVES the .bak safety net so the caller can still roll back AFTER this
 * returns (FIX-3: swap-first-then-commit). Use the returned handle with either
 * commitSwap() (drop .bak) on Postgres success or rollbackSwap() (restore .bak) on
 * Postgres failure.
 *
 *   1. write srcTmp -> dest + '.tmp' (copyFile) + fsync (best-effort durability);
 *   2. EVICT the cached readonly handle of dest across the worker pool — a rename
 *      OF/OVER an open SQLite file fails EBUSY/EPERM on Windows;
 *   3. if dest exists: rename dest -> dest + '.bak' (keep the current BLOB);
 *   4. EVICT the .tmp handle (defensive), then atomic rename .tmp -> dest (same
 *      directory => atomic on NTFS/ext4).
 *
 * FIX-2 (atomicity): `committed` flips to true the INSTANT the .tmp -> dest rename
 * succeeds. Any failure thereafter (there is none in the current body, but the
 * flag makes the invariant explicit) must NOT roll the new file back. If a failure
 * occurs BEFORE the commit, the .bak (if any) is restored here and the error is
 * re-thrown — the swap never half-installed.
 *
 * @param {string} destPath - resolved {slug}.db absolute path
 * @param {string} srcTmpPath - tmp path of the uploaded images.db
 * @returns {Promise<{ bakMade: boolean }>} pass bakMade to commit/rollbackSwap
 */
export async function installSwap(destPath, srcTmpPath) {
  mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = destPath + '.tmp';
  const bakPath = destPath + '.bak';
  let bakMade = false;
  let committed = false;

  // 1. Materialize .tmp from the multer tmp upload, then fsync for durability.
  copyFileSync(srcTmpPath, tmpPath);
  fsyncQuiet(tmpPath);

  try {
    // 2. EVICT the cached readonly handle of dest BEFORE touching it (Windows).
    await evictDbPath(destPath);

    // 3. Preserve the current BLOB under .bak (if any) — kept until commit.
    if (existsSync(destPath)) {
      if (existsSync(bakPath)) rmSync(bakPath, { force: true });
      renameSync(destPath, bakPath);
      bakMade = true;
    }

    // 4. Evict the .tmp handle too (defensive), then atomically rename over dest.
    await evictDbPath(tmpPath);
    renameSync(tmpPath, destPath);
    committed = true; // FIX-2: the new file is installed; never roll it back now.
  } catch (err) {
    // Failure BEFORE the new file was installed: restore the old BLOB from .bak so
    // reads keep working. Guarded by !committed so a post-install hiccup can never
    // clobber the freshly installed file.
    if (!committed && bakMade && existsSync(bakPath)) {
      try {
        if (existsSync(destPath)) rmSync(destPath, { force: true });
        renameSync(bakPath, destPath);
      } catch (restoreErr) {
        logger.error(
          { err: restoreErr, destPath },
          'sv360 installSwap rollback FAILED to restore .bak — manual reconcile required'
        );
      }
    }
    // Clean the leftover .tmp on failure.
    if (existsSync(tmpPath)) {
      try {
        rmSync(tmpPath, { force: true });
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  return { bakMade };
}

/**
 * Finalizes a successful install: drops the .bak safety net. The swap already
 * succeeded, so a .bak cleanup failure is merely LOGGED and swallowed (FIX-2 —
 * never undo a committed swap because cleanup hiccupped).
 * @param {string} destPath
 * @returns {void}
 */
export function commitSwap(destPath) {
  const bakPath = destPath + '.bak';
  if (existsSync(bakPath)) {
    try {
      rmSync(bakPath, { force: true });
    } catch (err) {
      logger.warn(
        { err, bakPath },
        'sv360 commitSwap: failed to remove .bak (swap already succeeded) — ignoring'
      );
    }
  }
}

/**
 * Compensates a failed Postgres merge AFTER the file was already installed
 * (FIX-3): restore the OLD BLOB from .bak so disk matches the (rolled-back)
 * Postgres state. When there was no prior file (bakMade=false), remove the
 * just-installed dest so nothing orphan remains.
 * @param {string} destPath
 * @param {boolean} bakMade - the flag returned by installSwap
 * @returns {void}
 */
export function rollbackSwap(destPath, bakMade) {
  const bakPath = destPath + '.bak';
  try {
    if (bakMade) {
      if (existsSync(bakPath)) {
        if (existsSync(destPath)) rmSync(destPath, { force: true });
        renameSync(bakPath, destPath);
      }
    } else {
      // No prior file existed — drop the newly installed dest so we leave nothing.
      if (existsSync(destPath)) rmSync(destPath, { force: true });
    }
  } catch (err) {
    logger.error(
      { err, destPath },
      'sv360 rollbackSwap FAILED — disk may be ahead of Postgres; manual reconcile required'
    );
  }
}

/**
 * @deprecated kept for compatibility — installSwap + commitSwap is the FIX-3
 * swap-first-then-commit protocol. This wrapper installs and immediately commits
 * (the old commit-then-swap behavior), used only if a caller still wants a single
 * atomic-looking swap with no external rollback hook.
 * @param {string} destPath
 * @param {string} srcTmpPath
 * @returns {Promise<void>}
 */
export async function swapProjectDb(destPath, srcTmpPath) {
  await installSwap(destPath, srcTmpPath);
  commitSwap(destPath);
}

/**
 * End-to-end ingestion of ONE project bundle, shared by the admin upload and the
 * ETL. Order is SWAP-FIRST-THEN-COMMIT (FIX-3) — the Postgres commit is the single
 * atomic commit point, so Postgres never gets ahead of the disk:
 *   PASSO 0 — validateManifest + validateImagesDb (size-check). Anything fails
 *             here => 4xx, NOTHING touched.
 *   PASSO 1 — installSwap(dest, imagesDb): install the new {slug}.db but PRESERVE
 *             the .bak (so it is still reversible). dest is derived from
 *             (orgId, slug) — the SAME server-derived name mergeProject writes.
 *   PASSO 2 — tx(t => mergeProject(...)): collision guard (409), upsert
 *             (status/created_at preserved), purge + reinsert. If it THROWS,
 *             rollbackSwap (restore .bak / drop the new file) then rethrow — disk
 *             and Postgres stay consistent. If it SUCCEEDS, commitSwap (drop .bak).
 *
 * Residual crash window (documented honestly): a process crash BETWEEN PASSO 1 and
 * the PASSO 2 commit leaves the NEW {slug}.db on disk with the OLD Postgres
 * metadata. This is BENIGN: every photo Postgres still announces is servable from
 * the new file (the new file is a superset for a re-upload / equal for a first
 * upload up to the announced rows); newly added photos simply do not appear yet.
 * Because photo ids are deterministic UUID v5 (namespaced per tenant), the 409
 * collision path is nearly impossible, so the cost of an install-then-rollback on
 * 409 is negligible.
 *
 * Accepts either a parsed `manifest` object or a `manifestPath` to read+parse.
 * Does NOT clean up the multer tmp files — the caller owns that.
 *
 * @param {Object} args
 * @param {string} [args.manifestPath] - path to manifest.json (read+parsed if no manifest)
 * @param {Object} [args.manifest] - already-parsed manifest object
 * @param {string} args.dbTmpPath - tmp path of the uploaded images.db (the swap source)
 * @param {string} args.orgId - resolved target organization_id (uuid)
 * @param {string} [args.source] - provenance tag ('upload' | 'etl'), informational
 * @returns {Promise<{projectId:string, slug:string, dbFilename:string, photoCount:number}>}
 */
export async function ingestBundle({ manifestPath, manifest, dbTmpPath, orgId, source } = {}) {
  if (!orgId) throw new BadRequestError('orgId is required for ingestion');
  if (!dbTmpPath) throw new BadRequestError('images.db (dbTmpPath) is required');

  // PASSO 0a — parse + validate the manifest (4xx, nothing touched).
  let raw = manifest;
  if (!raw) {
    if (!manifestPath) throw new BadRequestError('manifest or manifestPath is required');
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      throw new BadRequestError('manifest.json is not valid JSON');
    }
  }
  const validated = validateManifest(raw);

  // PASSO 0b — validate the images.db carries the BLOBs the manifest promises.
  validateImagesDb(dbTmpPath, validated);

  // The dest filename is DERIVED from (orgId, slug) — identical to the value
  // mergeProject persists, so the file and Postgres always agree (FIX-1/FIX-3).
  const dbFilename = deriveDbFilename(orgId, validated.project.slug);
  const destPath = resolveDbPath(dbFilename);

  // P3 — serialize ingestions of the same (orgId, slug).
  //
  // The file swap (PASSO 1) happens BEFORE the Postgres transaction (PASSO 2), so
  // a transaction-scoped lock would be taken too late to protect it. Two
  // concurrent uploads of the same project could otherwise interleave as:
  //
  //   A swaps its file  →  B swaps its file  →  A commits  →  B commits
  //
  // leaving B's bytes on disk with A's rollback able to restore the WRONG .bak,
  // or Postgres describing a bundle that is not the one installed.
  //
  // A SESSION-scoped lock on one dedicated connection spans both steps. It is
  // released in `finally`, and Postgres drops it automatically if the connection
  // dies, so a crash mid-ingest cannot wedge the slug permanently.
  return task(async (conn) => {
    const lockKey = `sv360:${orgId}:${validated.project.slug}`;
    await conn.one('SELECT pg_advisory_lock($1, hashtext($2))', [SV360_INGEST_LOCK_NAMESPACE, lockKey]);

    try {
      // PASSO 1 — install the new {slug}.db, KEEPING the .bak (reversible).
      const { bakMade } = await installSwap(destPath, dbTmpPath);

      // PASSO 2 — Postgres merge in a single tx. The commit is the atomic point.
      // Runs on the lock-holding connection, so the lock covers it.
      let merged;
      try {
        merged = await conn.tx((t) => mergeProject(t, validated, { orgId, source: source ?? 'upload' }));
      } catch (err) {
        // Merge failed (409 collision / orphan FK / I/O): undo the file install so
        // disk matches the rolled-back Postgres state, then rethrow the original 4xx/5xx.
        rollbackSwap(destPath, bakMade);
        throw err;
      }

      // Merge committed — finalize the swap (drop the .bak; failure here is logged,
      // never fatal: the new file is already installed and Postgres is consistent).
      commitSwap(destPath);

      return {
        projectId: merged.projectId,
        slug: validated.project.slug,
        dbFilename: merged.dbFilename,
        photoCount: merged.photoCount,
      };
    } finally {
      await conn
        .one('SELECT pg_advisory_unlock($1, hashtext($2))', [SV360_INGEST_LOCK_NAMESPACE, lockKey])
        .catch((err) => logger.warn({ err, lockKey }, 'Failed to release sv360 ingest lock'));
    }
  });
}

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
// INTEGRATOR NOTE — blobPool.withEvicted(dbPath, fn) (src/utils/sqlite-blob-pool.js):
//   The atomic rename of {slug}.db FAILS on Windows (EBUSY/EPERM) while a worker
//   holds a cached readonly handle to that file. Evicting the handle is necessary
//   but NOT sufficient: `evict()` guarantees an INSTANT with no open handle, and a
//   concurrent GET /photos/:uuid/image (which does NOT take the ingestion advisory
//   lock — that one only serializes ingestions against each other) reopens and
//   recaches the file right inside the window (achado 59/61).
//
//   So every rename/remove of a live {slug}.db goes through the pool's WINDOW:
//
//     blobPool.withEvicted(dbPath, fn): quarantines dbPath, evicts it on ALL
//       workers (round-robin means any worker may hold the cached conn), runs fn,
//       and releases in `finally`. Reads of that dbPath arriving during the window
//       are DEFERRED (never reopened) and dispatched right after.
//
//   Worker side (src/utils/sqlite-blob-worker.js): handle msg.type === 'evict'.
//   withDbPathEvicted() below degrades to blobPool.closeAll() + fn only if the pool
//   singleton is stubbed without withEvicted.
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
import {
  AppError,
  BadRequestError,
  ValidationError,
  ServiceUnavailableError,
} from '../../utils/errors.js';

// Namespace for the per-(orgId, slug) session advisory lock that serializes
// ingestion (P3). Distinct from the sync push namespace so the two lock spaces
// can never collide. Value is ASCII 'S360' read as int32.
const SV360_INGEST_LOCK_NAMESPACE = 0x53333630;

// Máximo que uma ingestão espera pelo lock do MESMO (org, slug) antes de desistir
// com 503 retentável. Ver acquireIngestLock() para o porquê de existir um teto.
const SV360_INGEST_LOCK_TIMEOUT = '5s';

/**
 * Takes the per-(orgId, slug) SESSION advisory lock with a BOUNDED wait.
 *
 * A espera acontece sobre uma conexão JÁ TOMADA DO POOL, então esperar sem teto
 * converte contenção num único projeto em ESGOTAMENTO DO POOL: com poolMax=10,
 * dez uploads concorrentes do mesmo (org, slug) travam o processo inteiro,
 * inclusive `GET /api/config` — que é fail-fast no boot do frontend. Mesma lição
 * já aplicada no push de sync (`sync.service.js`): limitar a espera e traduzir
 * SQLSTATE 55P03 (lock_not_available) num 503 que o cliente pode repetir.
 *
 * O `lock_timeout` é setado dentro de uma transação CURTA que envolve apenas a
 * aquisição: `SET LOCAL` é revertido no COMMIT, então o GUC nunca volta ao pool
 * grudado na conexão, enquanto o lock — que é de SESSÃO, não de transação —
 * sobrevive ao commit e segue valendo para os PASSOS 1 e 2.
 *
 * @param {Object} conn - the pooled connection the whole ingestion runs on
 * @param {string} lockKey - `sv360:${orgId}:${slug}`
 * @returns {Promise<void>}
 * @throws {ServiceUnavailableError} 503 when another ingestion holds the slug
 */
async function acquireIngestLock(conn, lockKey) {
  try {
    await conn.tx(async (t) => {
      // `SET` não aceita bind params; set_config(..., is_local=true) é o
      // equivalente parametrizável de `SET LOCAL`.
      await t.one('SELECT set_config($1, $2, true)', ['lock_timeout', SV360_INGEST_LOCK_TIMEOUT]);
      await t.one('SELECT pg_advisory_lock($1, hashtext($2))', [
        SV360_INGEST_LOCK_NAMESPACE,
        lockKey,
      ]);
    });
  } catch (err) {
    // Se o lock chegou a ser tomado e o COMMIT falhou depois, ele é de SESSÃO e
    // sobreviveria numa conexão devolvida ao pool — o slug ficaria travado para
    // sempre. Soltar é barato e no-op quando nada era detido.
    await conn
      .any('SELECT pg_advisory_unlock($1, hashtext($2))', [SV360_INGEST_LOCK_NAMESPACE, lockKey])
      .catch(() => {});
    // 55P03 = lock_not_available (o lock_timeout acima disparou).
    if (err && err.code === '55P03') {
      throw new ServiceUnavailableError(
        'Servidor ocupado processando outro envio deste projeto 360. Tente novamente.'
      );
    }
    throw err;
  }
}

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
    // The constructor is NOT where a non-SQLite upload is caught: sqlite3_open()
    // does not read the file header, so `new Database(junk.bin)` SUCCEEDS and the
    // SQLITE_NOTADB only surfaces on the FIRST STATEMENT. Left uncaught, that raw
    // SqliteError is not an AppError and the sv360ErrorHandler renders it as a 500
    // — a server fault for what is plainly a bad upload, and the one PASSO 0 branch
    // that did not honour the "anything wrong here is a 4xx" contract. Every failure
    // inside this block is a bundle problem, so a non-AppError is translated to the
    // intended 400; the BadRequestErrors thrown below pass through untouched, so
    // each keeps its specific message.
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
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new BadRequestError('images.db is not a valid SQLite file');
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Runs `fn` with the pool GUARANTEED to hold no handle on `dbPath` for the WHOLE
 * critical section — not just at one instant (achado 59/61).
 *
 * `blobPool.evict(dbPath)` alone resolves at an instant: the next concurrent
 * `GET /photos/:uuid/image` makes a worker reopen and recache the file (the read
 * path does NOT participate in the per-(org, slug) advisory lock, which only
 * serializes ingestions against each other), and the rename then fails EBUSY/EPERM
 * on Windows. `blobPool.withEvicted` quarantines the dbPath for the duration, so a
 * read arriving inside the window is DEFERRED instead of reopening the file.
 * @param {string} dbPath
 * @param {() => (Promise<T>|T)} fn - the critical section (rename/rm)
 * @returns {Promise<T>}
 */
async function withDbPathEvicted(dbPath, fn) {
  if (typeof blobPool.withEvicted === 'function') {
    return blobPool.withEvicted(dbPath, fn);
  }
  // Hammer fallback: drops every connection (incl. assets3d). Weaker — it releases
  // the handles but does not hold the window — and only reachable if the pool
  // singleton is stubbed without withEvicted.
  await blobPool.closeAll();
  return fn();
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
 *   2. OPEN THE SWAP WINDOW on dest (blobPool.withEvicted): every cached readonly
 *      handle is closed AND no concurrent read may reopen it until step 4 is done —
 *      a rename OF/OVER an open SQLite file fails EBUSY/EPERM on Windows, and the
 *      window also hides from readers the instant in which dest does not exist;
 *   3. if dest exists: rename dest -> dest + '.bak' (keep the current BLOB);
 *   4. evict the .tmp handle (defensive), then atomic rename .tmp -> dest (same
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

  // 2-4 run INSIDE the pool's swap window for dest: the handle is evicted AND no
  // concurrent read may reopen it until this returns. The rollback below is inside
  // the window too — restoring the .bak is itself a rename over dest.
  await withDbPathEvicted(destPath, async () => {
    try {
      // 3. Preserve the current BLOB under .bak (if any) — kept until commit.
      if (existsSync(destPath)) {
        if (existsSync(bakPath)) rmSync(bakPath, { force: true });
        renameSync(destPath, bakPath);
        bakMade = true;
      }

      // 4. Evict the .tmp handle too (defensive), then atomically rename over dest.
      await withDbPathEvicted(tmpPath, () => {
        renameSync(tmpPath, destPath);
      });
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
  });

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
 * Runs inside the pool's swap window (achado 59/61): by now the new file has been
 * serving reads for the duration of the merge tx, so a worker very likely holds a
 * handle on dest — replacing/removing it needs the same exclusion the install did.
 * @param {string} destPath
 * @param {boolean} bakMade - the flag returned by installSwap
 * @returns {Promise<void>}
 */
export async function rollbackSwap(destPath, bakMade) {
  const bakPath = destPath + '.bak';
  try {
    await withDbPathEvicted(destPath, () => {
      if (bakMade) {
        if (existsSync(bakPath)) {
          if (existsSync(destPath)) rmSync(destPath, { force: true });
          renameSync(bakPath, destPath);
        }
      } else {
        // No prior file existed — drop the newly installed dest so we leave nothing.
        if (existsSync(destPath)) rmSync(destPath, { force: true });
      }
    });
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
  // dies, so a crash mid-ingest cannot wedge the slug permanently. A espera é
  // LIMITADA (acquireIngestLock): a conexão é do pool, então contenção sem teto
  // esgotaria o pool e derrubaria a API inteira.
  return task(async (conn) => {
    const lockKey = `sv360:${orgId}:${validated.project.slug}`;
    await acquireIngestLock(conn, lockKey);

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
        await rollbackSwap(destPath, bakMade);
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
      // O lock é de SESSÃO e vive na conexão do pool: se o unlock falhar (ou
      // retornar false) sem derrubar a conexão, ela volta ao pool COM o lock preso
      // e o slug fica travado para sempre — toda ingestão futura espera
      // indefinidamente e acumula conexões. Inspecionamos o retorno (não só o
      // erro) e, no pior caso, liberamos tudo desta sessão.
      try {
        const row = await conn.one('SELECT pg_advisory_unlock($1, hashtext($2)) AS released', [
          SV360_INGEST_LOCK_NAMESPACE,
          lockKey,
        ]);
        if (row.released !== true) {
          logger.warn({ lockKey }, 'sv360 ingest lock was not held at unlock; clearing session locks');
          await conn.any('SELECT pg_advisory_unlock_all()');
        }
      } catch (err) {
        logger.warn({ err, lockKey }, 'Failed to release sv360 ingest lock; clearing session locks');
        await conn.any('SELECT pg_advisory_unlock_all()').catch(() => {});
      }
    }
  });
}

#!/usr/bin/env node
// Path: scripts/sv360-import.js
// Fase 9, STAGE 3a — OFFLINE ETL for the StreetView 360 module (Tarefa 2).
//
// Imports the legacy SQLite `index.db` (organizations/projects/photos/targets/
// deleted_photos — §4.3) into the Postgres `sv360` schema and COPIES each
// per-project `{slug}.db` (the WebP BLOB store) into config.sv360.dbDir.
//
// It is the offline twin of the admin multipart upload: BOTH reuse the SHARED
// core `mergeProject` (src/modules/streetview360/sv360.merge.js), so "último
// upload manda", the cross-OM collision guard and idempotency are defined
// exactly once. This script only orchestrates: read index.db -> build an
// in-memory manifest per project -> tx(mergeProject) -> copy {slug}.db with a
// size check.
//
// Properties (per the SPEC etlSignature + Tarefa 2 DoD):
//   - Idempotent: rerunning the same index.db reproduces the same state
//     (mergeProject purges + reinserts deterministically; UUID v5 ids are stable).
//   - Per-project isolation: a single corrupt/incomplete project is collected in
//     `skipped[]` and does NOT abort the others (each project gets its own tx()).
//   - Size-checked copy: the summed *_size_bytes (full + preview) of a project's
//     photos must be <= the destination {slug}.db file size, and the file must
//     exist and be non-empty. A failed copy/check rolls the project's row back
//     (the copy runs INSIDE the same tx callback, so a throw aborts the commit).
//   - Progress logging via the injected logger (defaults to console).
//
// ORDERING NOTE (vs. the online upload): the online path SWAPS THE FILE FIRST
// and only then runs the Postgres tx (PASSO 1 / PASSO 2 in `sv360.ingest.js:394`)
// under an evict/.bak/rename protocol, because the file is already being served
// and a tx-scoped lock would be taken too late to protect it. (This note used to
// state the reverse order.) The OFFLINE ETL has no live readers, so it keeps the
// copy INSIDE the tx callback (pg-promise commits only if the callback resolves):
// a failed copy throws -> the project's merge is rolled back -> nothing partial
// lands. This is the simplest consistent ordering for a cold import.
//
// Usage (CLI):
//   node scripts/sv360-import.js [--link] <index.db> [<dbDirSource>] [<dbDirDest>]
//     --link         hardlink the {slug}.db files instead of copying them (see below)
//     <index.db>     path to the legacy SQLite index.db (readonly)
//     <dbDirSource>  dir holding the source {slug}.db files (default: dir of index.db)
//     <dbDirDest>    dir to copy them into       (default: config.sv360.dbDir)
//
// TRANSFER MODE (`transfer`, default 'copy'): a real 360 corpus is tens of GB of
// WebP BLOBs, so duplicating it just to give each file its SERVER-DERIVED name
// ({orgId}__{slug}.db) can cost more disk than the machine has. `transfer: 'link'`
// creates a HARDLINK instead — same bytes, same volume, zero extra disk — which is
// what a local/dev import against an existing store wants. Constraints, because a
// hardlink is not a copy: source and dest MUST be on the same volume (EXDEV
// otherwise), and the dest is the SAME inode as the source, so anything that writes
// to it (the online swap protocol never does; it renames) writes THROUGH to the
// original. Use 'copy' for any store the server may re-ingest into.
//
// Testable entry point: importIndexDb(indexDbPath, { dbDirSource, dbDirDest, transfer, logger }).

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  linkSync,
  rmSync,
  statSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { tx } from '../src/database/index.js';
import { mergeProject, resolveOrgIdBySlug } from '../src/modules/streetview360/sv360.merge.js';
import { blobPool } from '../src/utils/sqlite-blob-pool.js';
import config from '../src/config.js';

// ---------------------------------------------------------------------------
// index.db -> manifest mapping (§4.3). The manifest shape is exactly what
// mergeProject consumes (project + photos[] + targets[] + deleted_photos[]).
// ---------------------------------------------------------------------------

// Map an index.db organizations row id (or null) to its slug, for the org
// backfill. The legacy schema keys projects by organization_id (the index.db's
// own org id); we resolve it to a slug here and let resolveOrgIdBySlug turn the
// slug into the public.organizations UUID (or the fixed default org).
function buildOrgSlugById(idb) {
  const map = new Map();
  let rows;
  try {
    rows = idb.prepare('SELECT id, slug FROM organizations').all();
  } catch {
    // No organizations table (older dumps) -> everything backfills to default.
    return map;
  }
  for (const r of rows) map.set(String(r.id), r.slug);
  return map;
}

// Read every project row. Tolerant of a missing center_long vs center_lng and of
// an absent status column (defaults applied by the DB on insert anyway).
function readProjects(idb) {
  return idb.prepare('SELECT * FROM projects').all();
}

// Build the photos[] slice of the manifest for one project, mapped 1:1 to the
// sv360.photos columns. better-sqlite3 returns the SQLite column names verbatim;
// we normalize lon/lat aliases defensively.
//
// NO capture_date HERE, deliberately. This function used to read
// `p.capture_date ?? null` off the photos row. The legacy schema
// (ebgeo_360 src/db/schema.sql) declares capture_date on `projects` and NEVER on
// `photos`, so better-sqlite3 handed back `undefined` on every single row and
// mergeProject wrote NULL into sv360.photos.capture_date every single time. The
// read looked like it carried the date over; it carried nothing, silently. The
// project-level date is read from the `projects` row in buildManifest and lands
// in sv360.projects.capture_date (migration 014). The per-photo instant the
// origin does have is `photos.captured_at`, which is NOT this column: it is
// still unwritten pending the capture_date/captured_at naming decision recorded
// in migration 013.
function readPhotos(idb, projectId) {
  const rows = idb.prepare('SELECT * FROM photos WHERE project_id = ?').all(projectId);
  return rows.map((p) => ({
    id: p.id,
    original_name: p.original_name,
    display_name: p.display_name ?? null,
    sequence_number: p.sequence_number,
    lat: p.lat,
    lon: p.lon ?? p.lng ?? p.long ?? null,
    ele: p.ele ?? null,
    heading: p.heading,
    camera_height: p.camera_height,
    mesh_rotation_x: p.mesh_rotation_x,
    mesh_rotation_y: p.mesh_rotation_y,
    mesh_rotation_z: p.mesh_rotation_z,
    distance_scale: p.distance_scale,
    marker_scale: p.marker_scale,
    floor_level: p.floor_level,
    full_size_bytes: p.full_size_bytes,
    preview_size_bytes: p.preview_size_bytes,
    calibration_reviewed: toBool(p.calibration_reviewed),
  }));
}

// Targets scoped to a project (by its photo ids). SQLite has no schema-level
// project scoping on targets, so we filter by the project's photo id set.
function readTargets(idb, photoIds) {
  if (photoIds.length === 0) return [];
  const inSet = new Set(photoIds);
  const rows = idb.prepare('SELECT * FROM targets').all();
  return rows
    .filter((t) => inSet.has(t.source_id) && inSet.has(t.target_id))
    .map((t) => ({
      source_id: t.source_id,
      target_id: t.target_id,
      distance_m: t.distance_m ?? null,
      bearing_deg: t.bearing_deg ?? null,
      is_next: toBool(t.is_next),
      is_original: toBool(t.is_original),
      override_bearing: t.override_bearing ?? null,
      override_distance: t.override_distance ?? null,
      override_height: t.override_height ?? null,
      hidden: toBool(t.hidden),
    }));
}

// Tombstones for the project's photos (carried over). deleted_photos has no
// project_id, so scope by the project's photo id set.
function readTombstones(idb, photoIds) {
  if (photoIds.length === 0) return [];
  const inSet = new Set(photoIds);
  let rows;
  try {
    rows = idb.prepare('SELECT photo_id, deleted_at FROM deleted_photos').all();
  } catch {
    return [];
  }
  return rows
    .filter((d) => inSet.has(d.photo_id))
    .map((d) => ({ photo_id: d.photo_id, deleted_at: d.deleted_at ?? null }));
}

// SQLite stores booleans as 0/1; normalize to real booleans for the columns.
function toBool(v) {
  return v === 1 || v === true || v === '1' || v === 'true';
}

// Capture tracks for a project. `project_tracks.coords` is a JSON array of
// [lon, lat] pairs — ONE ROW PER SEGMENT, and that is the whole point: a project
// is many separate runs (1pef has 34 for its 2.249 photos), so the trajectory is
// NOT derivable from the photo sequence. Older dumps have no such table; a project
// with no tracks simply gets none and the tile falls back to the synthesized line.
// A row whose coords are unparseable is skipped, never fatal — one bad segment
// must not cost the project its other 33.
function readTracks(idb, projectId, logger, slug) {
  let rows;
  try {
    rows = idb.prepare('SELECT coords, source FROM project_tracks WHERE project_id = ?').all(projectId);
  } catch {
    return [];
  }
  const tracks = [];
  let bad = 0;
  for (const r of rows) {
    let coords;
    try {
      coords = JSON.parse(r.coords);
    } catch {
      bad++;
      continue;
    }
    if (!Array.isArray(coords) || coords.length < 2) {
      bad++;
      continue;
    }
    tracks.push({ coords, source: r.source ?? 'geojson' });
  }
  if (bad > 0) {
    logger?.warn?.(`[sv360-import] project '${slug}': ${bad} track row(s) unusable — skipped`);
  }
  return tracks;
}

// Build the full in-memory manifest for one project row.
function buildManifest(idb, project, orgSlug, logger) {
  const photos = readPhotos(idb, project.id);
  const photoIds = photos.map((p) => p.id);
  const targets = readTargets(idb, photoIds);
  const deleted_photos = readTombstones(idb, photoIds);
  const tracks = readTracks(idb, project.id, logger, project.slug);

  const dbFilename = project.db_filename || `${project.slug}.db`;
  return {
    orgSlug,
    project: {
      slug: project.slug,
      name: project.name,
      orgSlug,
      center_lat: project.center_lat ?? null,
      center_long: project.center_long ?? project.center_lng ?? project.center_lon ?? null,
      entry_photo_id: project.entry_photo_id ?? null,
      // The campaign date, read from the LEGACY `projects` row where it actually
      // lives (TEXT 'YYYY-MM-DD'). Older dumps without the column yield undefined
      // -> null, which is the same value the field had before this existed.
      capture_date: project.capture_date ?? null,
      db_filename: path.basename(dbFilename),
    },
    photos,
    targets,
    deleted_photos,
    tracks,
  };
}

// ---------------------------------------------------------------------------
// {slug}.db copy + size verification
// ---------------------------------------------------------------------------

// Best-effort fsync for durability. fsync requires a WRITABLE handle on Windows
// (opening 'r' then fsync → EPERM) and is unsupported on some filesystems; for a
// cold file copy durability is non-critical, so EPERM/EINVAL are swallowed.
function fsyncQuiet(filePath) {
  let fd;
  try {
    fd = openSync(filePath, 'r+');
    fsyncSync(fd);
  } catch (err) {
    if (err && err.code !== 'EPERM' && err.code !== 'EINVAL' && err.code !== 'ENOTSUP') {
      // Unexpected errors still surface (e.g. the file vanished).
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

// Sum the per-photo full + preview byte counts: the lower bound the destination
// {slug}.db must satisfy (the SQLite file also carries page overhead/indexes, so
// it is always >= the summed BLOB bytes). A zero/absent dest fails the check.
function expectedMinBytes(photos) {
  let sum = 0;
  for (const p of photos) {
    sum += Number(p.full_size_bytes || 0) + Number(p.preview_size_bytes || 0);
  }
  return sum;
}

// Copy (or hardlink) {slug}.db from source to dest and verify by size, with fsync
// for durability. Throws on any problem so the caller's tx rolls back the merge.
//   - the SOURCE basename is the legacy {slug}.db name from the index.db;
//   - the DEST basename is the SERVER-DERIVED db_filename (FIX-1: org-scoped),
//     so the on-disk store matches what mergeProject wrote to Postgres and two
//     orgs sharing a slug never collide on one file.
//   - source file must exist;
//   - dest file size must be > 0 and >= the summed BLOB bytes of the manifest.
function copyDbWithSizeCheck(srcDir, destDir, srcDbFilename, destDbFilename, photos, transfer) {
  const srcBase = path.basename(srcDbFilename);
  const destBase = path.basename(destDbFilename);
  const src = path.resolve(srcDir, srcBase);
  const dest = path.resolve(destDir, destBase);

  if (!existsSync(src)) {
    throw new Error(`source {slug}.db not found: ${src}`);
  }
  const srcSize = statSync(src).size;
  if (srcSize <= 0) {
    throw new Error(`source {slug}.db is empty: ${src}`);
  }

  // Same path on both ends: a copy would truncate dest and then read the very file
  // it just emptied (dest IS src), destroying the store; a link would be a no-op.
  // Reachable whenever dbDirSource === dbDirDest and the legacy name already equals
  // the derived one, so it is a guard, not a theoretical branch.
  if (src === dest) {
    return { dest, destSize: srcSize, minBytes: expectedMinBytes(photos), skipped: true };
  }

  mkdirSync(destDir, { recursive: true });

  if (transfer === 'link') {
    // linkSync fails EEXIST on a live dest, so a rerun must clear it first — the
    // ETL is idempotent by contract. Removing the LINK never touches the source
    // inode's data (only this directory entry), unless dest IS src, excluded above.
    if (existsSync(dest)) rmSync(dest, { force: true });
    try {
      linkSync(src, dest);
    } catch (err) {
      if (err?.code === 'EXDEV') {
        throw new Error(
          `cannot hardlink across volumes (${src} -> ${dest}); use the default copy mode`,
          { cause: err }
        );
      }
      throw err;
    }
  } else {
    copyFileSync(src, dest);
    // fsync the copied file for durability before we let the tx commit. fsync needs
    // a writable handle on Windows ('r' → EPERM), and some filesystems reject fsync
    // outright — durability here is best-effort for a cold copy, so swallow EPERM.
    // A hardlink wrote no bytes, so there is nothing to flush.
    fsyncQuiet(dest);
  }

  const destSize = statSync(dest).size;
  const minBytes = expectedMinBytes(photos);
  if (destSize <= 0) {
    throw new Error(`copied {slug}.db is empty: ${dest}`);
  }
  if (destSize < minBytes) {
    throw new Error(
      `copied {slug}.db smaller than the summed photo BLOB bytes ` +
        `(${destSize} < ${minBytes}): ${dest}`
    );
  }
  return { dest, destSize, minBytes };
}

/**
 * Transfers a project's preview thumbnail, the OTHER file the serving path needs.
 *
 * `GET /sv360/thumbnails/:slug.webp` resolves `{orgId}__{slug}.webp` inside
 * config.sv360.dbDir (sv360.service.js) — org-keyed exactly like {slug}.db — while
 * the legacy store names it `{slug}.webp` in a `thumbnails/` sibling of the project
 * dbs. Without this step a migrated corpus lists and serves panoramas correctly but
 * every project card is a broken image, and nothing reports an error: the miss is a
 * 404 on an <img>, far from the import that caused it.
 *
 * Best-effort BY DESIGN, unlike the {slug}.db: a thumbnail is presentation, and a
 * project without one is fully usable (the real corpus has 6 of 28 missing). So a
 * miss is reported, never thrown — it must not roll back a good project merge.
 * @param {string} thumbDirSource - dir holding the legacy {slug}.webp files
 * @param {string} destDir - config.sv360.dbDir (same dir as the {slug}.db)
 * @param {string} slug - project slug (legacy source name)
 * @param {string} destDbFilename - the DERIVED `{orgId}__{slug}.db`, whose basename
 *                                  gives the org prefix the thumbnail must share
 * @param {'copy'|'link'} transfer
 * @returns {{ transferred: boolean, reason?: string }}
 */
function transferThumbnail(thumbDirSource, destDir, slug, destDbFilename, transfer) {
  const src = path.resolve(thumbDirSource, `${slug}.webp`);
  if (!existsSync(src)) return { transferred: false, reason: 'no source thumbnail' };

  // Derive the dest name from the DERIVED db filename so the two can never drift:
  // `{orgId}__{slug}.db` -> `{orgId}__{slug}.webp`.
  const destBase = path.basename(destDbFilename).replace(/\.db$/i, '.webp');
  const dest = path.resolve(destDir, destBase);
  if (src === dest) return { transferred: false, reason: 'source is the destination' };

  // Never throws: this runs AFTER the project's merge has committed, so letting an
  // I/O error escape would push an already-imported project into `skipped[]` and
  // report a successful migration as a failure.
  try {
    mkdirSync(destDir, { recursive: true });
    if (existsSync(dest)) rmSync(dest, { force: true });
    if (transfer === 'link') {
      try {
        linkSync(src, dest);
      } catch (err) {
        if (err?.code !== 'EXDEV') throw err;
        copyFileSync(src, dest); // a thumbnail is tiny; falling back to a copy is free
      }
    } else {
      copyFileSync(src, dest);
    }
  } catch (err) {
    return { transferred: false, reason: err?.message || String(err) };
  }
  return { transferred: true };
}

// ---------------------------------------------------------------------------
// Project capture_date (migration 014)
// ---------------------------------------------------------------------------

// Apply the legacy campaign date to the merged project, INSIDE the caller's tx.
//
// WHY A SEPARATE STATEMENT and not a column in UPSERT_PROJECT: that upsert lives
// in sv360.admin.queries.js and is shared with the online admin upload, whose
// manifest has no such field. Widening it is a change to the shared ingestion
// core; this script only owns the offline ETL. The UPDATE runs in the SAME tx as
// mergeProject, so a failure still rolls the whole project back.
//
// Unconditional (no `WHERE capture_date IS NULL`, no skip on null): the ETL is
// "last upload wins" for every other project field, and a conditional write
// would make a corrected/cleared date in the index.db unable to reach Postgres.
//   $1 = project id (uuid), $2 = capture_date (text, nullable)
const SET_PROJECT_CAPTURE_DATE = `
  UPDATE sv360.projects SET capture_date = $2, updated_at = now() WHERE id = $1
`;

// ---------------------------------------------------------------------------
// Public ETL entry point (testable)
// ---------------------------------------------------------------------------

/**
 * Import a legacy index.db into Postgres `sv360` and copy its {slug}.db stores.
 *
 * Per-project, atomically: open a tx, resolve the org (backfill orgSlug ->
 * public.organizations.id, default org when absent/legacy), run the shared
 * mergeProject (upsert + collision guard + purge + reinsert), then copy the
 * {slug}.db with a size check INSIDE the same tx callback so a copy failure
 * rolls the merge back. Idempotent (rerun = same state). Project errors are
 * isolated and collected in `skipped[]`.
 *
 * @param {string} indexDbPath - path to the legacy SQLite index.db (read readonly)
 * @param {Object} [opts]
 * @param {string} [opts.dbDirSource] - dir of the source {slug}.db files
 *                                      (default: the directory of index.db)
 * @param {string} [opts.dbDirDest]   - dir to copy them into
 *                                      (default: config.sv360.dbDir)
 * @param {'copy'|'link'} [opts.transfer='copy'] - 'link' hardlinks the {slug}.db
 *                                      instead of copying (same volume, zero disk)
 * @param {string} [opts.thumbDirSource] - dir of the legacy {slug}.webp thumbnails
 *                                      (default: `<dir of index.db>/thumbnails`)
 * @param {Object} [opts.logger]      - { info, warn, error } (default: console)
 * @returns {Promise<{imported: Array<{slug:string, photos:number, targets:number,
 *                                     thumbnail:boolean}>,
 *                    skipped: Array<{slug:string, error:string}>}>}
 */
export async function importIndexDb(indexDbPath, opts = {}) {
  const logger = opts.logger || console;
  const dbDirSource = opts.dbDirSource || path.dirname(path.resolve(indexDbPath));
  const dbDirDest = opts.dbDirDest || config.sv360.dbDir;
  const transfer = opts.transfer === 'link' ? 'link' : 'copy';
  const thumbDirSource =
    opts.thumbDirSource || path.join(path.dirname(path.resolve(indexDbPath)), 'thumbnails');

  if (!existsSync(indexDbPath)) {
    throw new Error(`index.db not found: ${indexDbPath}`);
  }

  const imported = [];
  const skipped = [];

  const idb = new Database(indexDbPath, { readonly: true, fileMustExist: true });
  try {
    const orgSlugById = buildOrgSlugById(idb);
    const projects = readProjects(idb);
    logger.info?.(
      `[sv360-import] index.db opened: ${projects.length} project(s) found ` +
        `(source=${dbDirSource} dest=${dbDirDest} transfer=${transfer})`
    );

    for (const project of projects) {
      const slug = project.slug;
      try {
        if (!slug) throw new Error('project row has no slug');

        const orgSlug = orgSlugById.get(String(project.organization_id)) ?? null;
        const manifest = buildManifest(idb, project, orgSlug, logger);

        logger.info?.(
          `[sv360-import] project '${slug}': ` +
            `${manifest.photos.length} photo(s), ${manifest.targets.length} target(s), ` +
            `${manifest.tracks.length} track(s), ` +
            `${manifest.deleted_photos.length} tombstone(s) — merging...`
        );

        // One tx per project: org resolve + merge + copy. A throw anywhere
        // (incl. the size-checked copy) rolls the whole project back.
        let derivedDbFilename;
        await tx(async (t) => {
          const orgId = await resolveOrgIdBySlug(t, manifest.orgSlug);
          // mergeProject returns the SERVER-DERIVED db_filename (org-scoped). Copy
          // the legacy source {slug}.db (manifest.project.db_filename) to that
          // DERIVED dest name so disk matches Postgres (FIX-1).
          const { dbFilename, projectId } = await mergeProject(t, manifest, {
            orgId,
            source: 'etl',
          });
          derivedDbFilename = dbFilename;
          // The campaign date the shared upsert does not carry (see above).
          await t.none(SET_PROJECT_CAPTURE_DATE, [projectId, manifest.project.capture_date]);
          const srcDbFilename = manifest.project.db_filename || `${manifest.project.slug}.db`;
          copyDbWithSizeCheck(
            dbDirSource,
            dbDirDest,
            srcDbFilename,
            dbFilename,
            manifest.photos,
            transfer
          );
        });

        // Thumbnail AFTER the commit and OUTSIDE the tx: it is presentation-only,
        // so a missing/unwritable one must never roll back a merged project.
        const thumb = transferThumbnail(
          thumbDirSource,
          dbDirDest,
          slug,
          derivedDbFilename,
          transfer
        );
        if (!thumb.transferred) {
          logger.warn?.(
            `[sv360-import] project '${slug}': no thumbnail transferred (${thumb.reason}) — ` +
              `the project card will render without a preview`
          );
        }

        imported.push({
          slug,
          photos: manifest.photos.length,
          targets: manifest.targets.length,
          tracks: manifest.tracks.length,
          thumbnail: thumb.transferred,
        });
        logger.info?.(`[sv360-import] project '${slug}': OK`);
      } catch (err) {
        const msg = err?.message || String(err);
        skipped.push({ slug: slug || '(no slug)', error: msg });
        logger.error?.(`[sv360-import] project '${slug || '(no slug)'}': SKIPPED — ${msg}`);
      }
    }
  } finally {
    idb.close();
  }

  logger.info?.(
    `[sv360-import] done: ${imported.length} imported, ${skipped.length} skipped.`
  );
  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// CLI wrapper (only when run directly, not when imported by tests)
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const transfer = argv.includes('--link') ? 'link' : 'copy';
  const flag = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const thumbDirSource = flag('thumbs');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const indexDbPath = positional[0];
  const dbDirSource = positional[1] || undefined;
  const dbDirDest = positional[2] || undefined;

  if (!indexDbPath) {
    console.error(
      'Usage: node scripts/sv360-import.js [--link] [--thumbs=<dir>] <index.db> [<dbDirSource>] [<dbDirDest>]\n' +
        '\n' +
        '  <index.db>      legacy SQLite index.db (opened readonly)\n' +
        '  <dbDirSource>   dir with the source {slug}.db files   (default: dir of index.db)\n' +
        '  <dbDirDest>     dir to install them into              (default: SV360_DB_DIR)\n' +
        '  --link          hardlink instead of copy (same volume, zero extra disk)\n' +
        '  --thumbs=<dir>  dir with the {slug}.webp thumbnails   (default: <index.db dir>/thumbnails)\n'
    );
    process.exit(1);
  }

  importIndexDb(indexDbPath, { dbDirSource, dbDirDest, transfer, thumbDirSource })
    .then(async ({ imported, skipped }) => {
      // Release the worker pool's SQLite handles (none opened by this path, but
      // keeps the process from lingering if a worker was spawned elsewhere).
      await blobPool.closeAll().catch(() => {});
      const noThumb = imported.filter((r) => !r.thumbnail);
      console.log(
        `\nsv360-import complete: ${imported.length} imported, ${skipped.length} skipped, ` +
          `${imported.length - noThumb.length}/${imported.length} with a thumbnail.`
      );
      if (noThumb.length > 0) {
        console.log(`  sem thumbnail: ${noThumb.map((r) => r.slug).join(', ')}`);
      }
      if (skipped.length > 0) {
        for (const s of skipped) console.error(`  SKIPPED ${s.slug}: ${s.error}`);
      }
      // A partial import is a non-zero exit so CI/operators notice.
      process.exit(skipped.length > 0 ? 2 : 0);
    })
    .catch(async (err) => {
      await blobPool.closeAll().catch(() => {});
      console.error('sv360-import failed:', err?.message || err);
      process.exit(1);
    });
}

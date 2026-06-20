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
// ORDERING NOTE (vs. the online upload): the online path commits Postgres first
// then swaps the live file under an evict/.bak/rename protocol because the file
// is already being served. The OFFLINE ETL has no live readers, so it keeps the
// copy INSIDE the tx callback (pg-promise commits only if the callback resolves):
// a failed copy throws -> the project's merge is rolled back -> nothing partial
// lands. This is the simplest consistent ordering for a cold import.
//
// Usage (CLI):
//   node scripts/sv360-import.js <index.db> [<dbDirSource>] [<dbDirDest>]
//     <index.db>     path to the legacy SQLite index.db (readonly)
//     <dbDirSource>  dir holding the source {slug}.db files (default: dir of index.db)
//     <dbDirDest>    dir to copy them into       (default: config.sv360.dbDir)
//
// Testable entry point: importIndexDb(indexDbPath, { dbDirSource, dbDirDest, logger }).

import { existsSync, mkdirSync, copyFileSync, statSync, openSync, fsyncSync, closeSync } from 'node:fs';
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
    capture_date: p.capture_date ?? null,
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

// Build the full in-memory manifest for one project row.
function buildManifest(idb, project, orgSlug) {
  const photos = readPhotos(idb, project.id);
  const photoIds = photos.map((p) => p.id);
  const targets = readTargets(idb, photoIds);
  const deleted_photos = readTombstones(idb, photoIds);

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
      db_filename: path.basename(dbFilename),
    },
    photos,
    targets,
    deleted_photos,
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

// Copy {slug}.db from source to dest and verify by size, with fsync for
// durability. Throws on any problem so the caller's tx rolls back the merge.
//   - the SOURCE basename is the legacy {slug}.db name from the index.db;
//   - the DEST basename is the SERVER-DERIVED db_filename (FIX-1: org-scoped),
//     so the on-disk store matches what mergeProject wrote to Postgres and two
//     orgs sharing a slug never collide on one file.
//   - source file must exist;
//   - dest file size must be > 0 and >= the summed BLOB bytes of the manifest.
function copyDbWithSizeCheck(srcDir, destDir, srcDbFilename, destDbFilename, photos) {
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

  mkdirSync(destDir, { recursive: true });
  copyFileSync(src, dest);

  // fsync the copied file for durability before we let the tx commit. fsync needs
  // a writable handle on Windows ('r' → EPERM), and some filesystems reject fsync
  // outright — durability here is best-effort for a cold copy, so swallow EPERM.
  fsyncQuiet(dest);

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
 * @param {Object} [opts.logger]      - { info, warn, error } (default: console)
 * @returns {Promise<{imported: Array<{slug:string, photos:number, targets:number}>,
 *                    skipped: Array<{slug:string, error:string}>}>}
 */
export async function importIndexDb(indexDbPath, opts = {}) {
  const logger = opts.logger || console;
  const dbDirSource = opts.dbDirSource || path.dirname(path.resolve(indexDbPath));
  const dbDirDest = opts.dbDirDest || config.sv360.dbDir;

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
        `(source=${dbDirSource} dest=${dbDirDest})`
    );

    for (const project of projects) {
      const slug = project.slug;
      try {
        if (!slug) throw new Error('project row has no slug');

        const orgSlug = orgSlugById.get(String(project.organization_id)) ?? null;
        const manifest = buildManifest(idb, project, orgSlug);

        logger.info?.(
          `[sv360-import] project '${slug}': ` +
            `${manifest.photos.length} photo(s), ${manifest.targets.length} target(s), ` +
            `${manifest.deleted_photos.length} tombstone(s) — merging...`
        );

        // One tx per project: org resolve + merge + copy. A throw anywhere
        // (incl. the size-checked copy) rolls the whole project back.
        await tx(async (t) => {
          const orgId = await resolveOrgIdBySlug(t, manifest.orgSlug);
          // mergeProject returns the SERVER-DERIVED db_filename (org-scoped). Copy
          // the legacy source {slug}.db (manifest.project.db_filename) to that
          // DERIVED dest name so disk matches Postgres (FIX-1).
          const { dbFilename } = await mergeProject(t, manifest, { orgId, source: 'etl' });
          const srcDbFilename = manifest.project.db_filename || `${manifest.project.slug}.db`;
          copyDbWithSizeCheck(dbDirSource, dbDirDest, srcDbFilename, dbFilename, manifest.photos);
        });

        imported.push({
          slug,
          photos: manifest.photos.length,
          targets: manifest.targets.length,
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
  const indexDbPath = process.argv[2];
  const dbDirSource = process.argv[3] || undefined;
  const dbDirDest = process.argv[4] || undefined;

  if (!indexDbPath) {
    console.error(
      'Usage: node scripts/sv360-import.js <index.db> [<dbDirSource>] [<dbDirDest>]'
    );
    process.exit(1);
  }

  importIndexDb(indexDbPath, { dbDirSource, dbDirDest })
    .then(async ({ imported, skipped }) => {
      // Release the worker pool's SQLite handles (none opened by this path, but
      // keeps the process from lingering if a worker was spawned elsewhere).
      await blobPool.closeAll().catch(() => {});
      console.log(
        `\nsv360-import complete: ${imported.length} imported, ${skipped.length} skipped.`
      );
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

#!/usr/bin/env node
// Path: scripts/sv360-import.js
// Fase 9, STAGE 3a — OFFLINE ETL for the StreetView 360 module (Tarefa 2).
//
// Imports the legacy SQLite `index.db` (organizations/projects/photos/targets/
// deleted_photos, §4.3, plus project_tracks and project_floors) into the
// Postgres `sv360` schema and COPIES each project's TWO on-disk files into
// config.sv360.dbDir: `{slug}.db` (the images store) and, when it exists,
// `{slug}_tiles.db` (the tile pyramids).
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
//   - Verified transfer, by ARCHIVE SHAPE. The source {slug}.db must exist, be
//     non-empty and carry the pixels the manifest promises. WHICH check proves
//     that depends on the shape, and the shape is read from the file itself (the
//     SHARED `validateImagesDb` of sv360.ingest.js, never a probe re-typed here):
//       COM BLOB (the historic archive): `images` has full_webp/preview_webp, the
//         per-photo byte lengths must match the manifest, AND the destination file
//         must be at least the summed *_size_bytes (full + preview) of the photos.
//       SO-TILES (the normal shape since the origin ran `aposentar-full.js`): the
//         blob columns are GONE, so there are no bytes to sum and the byte floor
//         does not apply. The guard is TRADED, not waived: the project must bring a
//         `{slug}_tiles.db` whose pyramid covers EVERY live photo of the manifest.
//     A failed transfer/check rolls the project's row back (the transfer runs
//     INSIDE the same tx callback, so a throw aborts the commit).
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
// The PIXEL-SOURCE guard, shared with the online upload. It is imported, never
// re-typed: it already knows the TWO shapes of archive (blob columns vs. só-tiles)
// and it owns the PRAGMA probe that tells them apart. A third copy of that rule
// would drift, and the symptom would be one path accepting what the other refuses.
// `resolveTilesDbPath` comes along for the same reason: whoever INSTALLS the tiles
// file and whoever READS it must derive the same name.
import { validateImagesDb, resolveTilesDbPath } from '../src/modules/streetview360/sv360.ingest.js';
// The floor-label rule, ported verbatim from ebgeo_360 scripts/lib/floors.js. It
// is imported rather than re-typed here: two copies of "what a level is called"
// diverge silently, and the symptom is a wrong name on screen, never an error.
import { defaultFloorLabel } from '../src/modules/streetview360/sv360.floors.js';
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
// in sv360.projects.capture_date. The per-photo instant the
// origin carries as `photos.captured_at` maps onto sv360.photos.capture_date,
// which already exists: one measurement, one column (see the note on
// `sv360.photos.capture_date` in `007_sv360.sql`). Wiring that mapping belongs to the capture-runs
// port, not here.
// `floor_level` in the legacy index.db comes from `INTEGER DEFAULT 1` (ebgeo_360
// src/db/schema.sql). In a FLAT project nobody ever chose that 1: the column was
// simply never written. The current model, the one the viewer and the floor
// selector speak, counts the GROUND floor as 0 (ebgeo_360 scripts/lib/floors.js,
// `defaultFloorLabel`: 0 -> 'Térreo', 1 -> '1º andar'). Importing the raw 1 would
// label ~98.6k street-level photos as "1º andar", which is not what the capture
// says; measured on the real corpus, 27 of 29 projects sat entirely on that
// untouched default.
//
// The normalization is deliberately NARROW: it fires only when the WHOLE project
// sits on a single level AND that level is the default 1, i.e. exactly when the
// value carries no information. A project with more than one distinct level was
// calibrated by a human and passes through untouched, so beira_rio (7 levels) and
// museu_cms (2) keep their level-1 photos, where 1 does mean the first indoor
// floor. Idempotent: rerunning finds the project already on 0 and does nothing.
//
// `hasFloors` NARROWS it further, and only in the safe direction: a project that
// DECLARES its floors in project_floors has had every level chosen by a human, so
// the "nobody ever wrote this column" premise no longer holds and the value must
// pass through untouched. Rewriting a declared level 1 to 0 would move every photo
// off the floor the floor list names, and the selector would show a floor with
// zero photos next to a level nothing declares. No project in the current corpus
// hits this branch (the two with floors both span several levels), so it changes
// no imported row today. It keeps the two sources of floor truth from diverging.
function normalizeFloorLevels(photos, hasFloors = false) {
  if (hasFloors) return photos;
  const niveis = new Set(photos.map((p) => p.floor_level ?? 1));
  if (niveis.size !== 1 || !niveis.has(1)) return photos;
  return photos.map((p) => ({ ...p, floor_level: 0 }));
}

/**
 * The FLOORS of a project (`project_floors` in the legacy index.db).
 *
 * This table is what DECLARES a project has floors: the interface draws the floor
 * selector because rows exist here, never because some photo carries a level
 * (`007_sv360.sql`). So a project absent from it is a street-level survey and gets
 * an empty list, which is the shape 27 of the 29 corpus projects have.
 *
 * `plan_coords` is TEXT-with-JSON in SQLite (it has no better type) and JSONB in
 * Postgres, so it is PARSED here and handed on as a real array; the merge
 * serializes it once for the `::jsonb` cast. A row whose plan is unparseable keeps
 * the floor and loses only the drawing: the level still has to appear in the
 * selector, and losing the whole floor over a broken polyline would hide photos
 * that are perfectly fine. Older dumps have no such table at all.
 * @param {Object} idb - the open better-sqlite3 index.db handle
 * @param {string|number} projectId - the legacy project id
 * @param {Object} [logger]
 * @param {string} [slug] - project slug, for the warning message
 * @returns {Array<{level:number, label:string, plan_coords:Array|null}>}
 */
function readFloors(idb, projectId, logger, slug) {
  let rows;
  try {
    rows = idb
      .prepare('SELECT level, label, plan_coords FROM project_floors WHERE project_id = ? ORDER BY level')
      .all(projectId);
  } catch (error) {
    // An OLD dump simply has no `project_floors` table, and that is the normal,
    // expected path: a flat survey has no floors. But this same catch would also
    // bury a real SQL error, so say which one happened. A silent [] here reads
    // downstream as "this project has no floors", and the floor selector then
    // never appears, with nothing anywhere pointing at the cause.
    const semTabela = /no such table/i.test(error?.message ?? '');
    if (!semTabela) {
      logger?.warn?.(
        `[sv360-import] project '${slug}': reading project_floors failed (${error.message}); importing it with NO floors`
      );
    }
    return [];
  }
  const floors = [];
  let bad = 0;
  for (const r of rows) {
    const level = Number(r.level);
    if (!Number.isInteger(level)) {
      bad++;
      continue;
    }
    let plan = null;
    if (r.plan_coords !== null && r.plan_coords !== undefined && String(r.plan_coords).trim() !== '') {
      try {
        const parsed = JSON.parse(r.plan_coords);
        plan = Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
      } catch {
        bad++;
      }
    }
    const label = typeof r.label === 'string' && r.label.trim() !== '' ? r.label.trim() : defaultFloorLabel(level);
    floors.push({ level, label, plan_coords: plan });
  }
  if (bad > 0) {
    logger?.warn?.(
      `[sv360-import] project '${slug}': ${bad} floor row(s) with an unusable level or plan`
    );
  }
  return floors;
}

function readPhotos(idb, projectId, hasFloors) {
  const rows = idb.prepare('SELECT * FROM photos WHERE project_id = ?').all(projectId);
  const photos = rows.map((p) => ({
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
    // The floor's LABEL for this photo (`photos.floor_label` in the origin, a
    // column here too). NOT derivable from the level: in
    // beira_rio level 0 carries 'Externo' on 86 photos and 'Campo' on 8: two
    // spaces of the SAME floor with different names on screen. A flat project
    // yields NULL, which is correct: there is no floor to name.
    floor_label: p.floor_label ?? null,
    full_size_bytes: p.full_size_bytes,
    preview_size_bytes: p.preview_size_bytes,
    calibration_reviewed: toBool(p.calibration_reviewed),
  }));
  return normalizeFloorLevels(photos, hasFloors);
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
  // Floors FIRST: their existence decides whether the legacy floor_level default
  // may be normalized away (see normalizeFloorLevels).
  const floors = readFloors(idb, project.id, logger, project.slug);
  const photos = readPhotos(idb, project.id, floors.length > 0);
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
    floors,
  };
}

// ---------------------------------------------------------------------------
// {slug}.db + {slug}_tiles.db transfer, with the pixel-source verification
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
//
// ONLY MEANINGFUL FOR AN ARCHIVE THAT STILL HAS BLOBS. On a só-tiles archive the
// legacy index.db keeps the *_size_bytes of the images it no longer stores (the
// origin's `aposentar-full.js` opens the index READONLY and never zeroes them), so
// this sum measures bytes that are not supposed to be in the file. The caller only
// applies it to the blob shape.
function expectedMinBytes(photos) {
  let sum = 0;
  for (const p of photos) {
    sum += Number(p.full_size_bytes || 0) + Number(p.preview_size_bytes || 0);
  }
  return sum;
}

// The basename of the tiles file that goes WITH a given {slug}.db, source or dest.
// The rule (strip `.db`, append `_tiles.db`, basename first as a traversal defense)
// belongs to `resolveTilesDbPath`; only the DIRECTORY differs here, because the ETL
// writes into an arbitrary dbDirDest and not necessarily into config.sv360.dbDir.
// Taking the basename of its result reuses the rule instead of re-stating it.
function tilesBasename(dbFilename) {
  return path.basename(resolveTilesDbPath(dbFilename));
}

// Copy (or hardlink) ONE file, with fsync for durability on the copy path.
function transferOne(src, dest, transfer) {
  if (transfer === 'link') {
    // linkSync fails EEXIST on a live dest, so a rerun must clear it first — the
    // ETL is idempotent by contract. Removing the LINK never touches the source
    // inode's data (only this directory entry), unless dest IS src, excluded by
    // the caller.
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
}

/**
 * Transfers a project's on-disk store — {slug}.db AND its {slug}_tiles.db — and
 * verifies that what landed really carries the project's pixels.
 *
 * THE TWO FILES TRAVEL TOGETHER, which is the half that was missing: the ETL used
 * to move only {slug}.db. Since the origin retired the blob columns, that file
 * alone is a bare list of photo ids, so an import that leaves the pyramids behind
 * installs a project with NO source of pixels at all — the exact state
 * `sv360.ingest.js` documents the validation as existing to prevent, and one that
 * surfaces far away, as a panorama that never paints.
 *
 * WHICH CHECK PROVES THE PIXELS ARE THERE depends on the shape of the archive, and
 * the shape is read from the file by the SHARED `validateImagesDb`:
 *   - COM BLOB: per-photo byte lengths must match the manifest, and the byte floor
 *     below still applies to the destination file, exactly as before.
 *   - SÓ-TILES: there are no blobs to size, so the floor is meaningless (see
 *     expectedMinBytes) and is NOT applied. In its place stands the pyramid
 *     coverage of every live photo, which validateImagesDb enforces. What remains
 *     from the old check is what still means something: the files exist and are
 *     non-empty.
 *
 * Naming, unchanged: the SOURCE basename is the legacy {slug}.db name from the
 * index.db; the DEST basename is the SERVER-DERIVED db_filename (FIX-1: org-scoped),
 * so the on-disk store matches what mergeProject wrote to Postgres and two orgs
 * sharing a slug never collide on one file. The tiles names are derived from those.
 *
 * Throws on any problem so the caller's tx rolls back the merge.
 * @param {string} srcDir - dir holding the legacy {slug}.db / {slug}_tiles.db
 * @param {string} destDir - dir to install them into
 * @param {string} srcDbFilename - legacy {slug}.db name
 * @param {string} destDbFilename - server-derived `{orgId}__{slug}.db`
 * @param {Object} manifest - the project manifest (photos[] is what gets verified)
 * @param {'copy'|'link'} transfer
 * @returns {{dest:string, destSize:number, tilesDest:string|null, temBlob:boolean}}
 */
function transferProjectStore(srcDir, destDir, srcDbFilename, destDbFilename, manifest, transfer) {
  const srcBase = path.basename(srcDbFilename);
  const destBase = path.basename(destDbFilename);
  const src = path.resolve(srcDir, srcBase);
  const dest = path.resolve(destDir, destBase);
  const srcTiles = path.resolve(srcDir, tilesBasename(srcBase));
  const destTiles = path.resolve(destDir, tilesBasename(destBase));

  if (!existsSync(src)) {
    throw new Error(`source {slug}.db not found: ${src}`);
  }
  const srcSize = statSync(src).size;
  if (srcSize <= 0) {
    throw new Error(`source {slug}.db is empty: ${src}`);
  }
  const temTiles = existsSync(srcTiles) && statSync(srcTiles).size > 0;

  // PASSO 0 of the offline path, the same one the upload runs. It is done on the
  // SOURCE, before anything is written: a project that cannot prove its pixels must
  // not leave a half-installed store behind.
  let temBlob;
  try {
    ({ temBlob } = validateImagesDb(src, manifest, temTiles ? srcTiles : null));
  } catch (err) {
    // Say WHERE we looked. The shared message names the cause ("só-tiles archive,
    // and no tiles db"), but it is written for an upload; the operator of the ETL
    // needs the two paths on disk to act on it.
    throw new Error(
      `${src} does not carry the pixels its index.db announces: ${err.message} ` +
        `(looked for the pyramids at ${srcTiles})`,
      { cause: err }
    );
  }

  mkdirSync(destDir, { recursive: true });

  // Same path on both ends: a copy would truncate dest and then read the very file
  // it just emptied (dest IS src), destroying the store; a link would be a no-op.
  // Reachable whenever dbDirSource === dbDirDest and the legacy name already equals
  // the derived one, so it is a guard, not a theoretical branch. Checked per FILE:
  // the images db and the tiles db can perfectly well differ on this.
  if (src !== dest) transferOne(src, dest, transfer);
  if (temTiles && srcTiles !== destTiles) transferOne(srcTiles, destTiles, transfer);

  const destSize = statSync(dest).size;
  if (destSize <= 0) {
    throw new Error(`copied {slug}.db is empty: ${dest}`);
  }
  if (temBlob) {
    const minBytes = expectedMinBytes(manifest.photos);
    if (destSize < minBytes) {
      throw new Error(
        `copied {slug}.db is smaller than the photo BLOBs it should contain ` +
          `(${destSize} < ${minBytes}): ${dest} — this archive DOES have the ` +
          `full_webp/preview_webp columns, so the copy is truncated`
      );
    }
  }
  if (temTiles && (!existsSync(destTiles) || statSync(destTiles).size <= 0)) {
    throw new Error(`copied {slug}_tiles.db is missing or empty: ${destTiles}`);
  }
  return { dest, destSize, tilesDest: temTiles ? destTiles : null, temBlob };
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
// Project capture_date
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
 * Import a legacy index.db into Postgres `sv360` and copy its on-disk stores.
 *
 * Per-project, atomically: open a tx, resolve the org (backfill orgSlug ->
 * public.organizations.id, default org when absent/legacy), run the shared
 * mergeProject (upsert + collision guard + purge + reinsert), then transfer the
 * {slug}.db AND its {slug}_tiles.db, verified against the archive's shape, INSIDE
 * the same tx callback so a transfer failure rolls the merge back. Idempotent
 * (rerun = same state). Project errors are isolated and collected in `skipped[]`.
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
 *                                     tracks:number, floors:number,
 *                                     thumbnail:boolean, tiles:boolean}>,
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
            `${manifest.tracks.length} track(s), ${manifest.floors.length} floor(s), ` +
            `${manifest.deleted_photos.length} tombstone(s) — merging...`
        );

        // One tx per project: org resolve + merge + transfer. A throw anywhere
        // (incl. the verified transfer) rolls the whole project back.
        let derivedDbFilename;
        let tilesTransferred = false;
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
          const store = transferProjectStore(
            dbDirSource,
            dbDirDest,
            srcDbFilename,
            dbFilename,
            manifest,
            transfer
          );
          tilesTransferred = store.tilesDest !== null;
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
          floors: manifest.floors.length,
          thumbnail: thumb.transferred,
          tiles: tilesTransferred,
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
      const comTiles = imported.filter((r) => r.tiles);
      console.log(
        `\nsv360-import complete: ${imported.length} imported, ${skipped.length} skipped, ` +
          `${imported.length - noThumb.length}/${imported.length} with a thumbnail, ` +
          `${comTiles.length}/${imported.length} with a tiles db.`
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

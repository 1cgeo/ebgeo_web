// Path: tests/integration/sv360-etl.test.js
// Fase 9 (stage 3a): StreetView 360 OFFLINE ETL (scripts/sv360-import.js).
// Builds a synthetic legacy index.db + a per-project {slug}.db with better-sqlite3
// in a tmp dir, runs importIndexDb(), and asserts the sv360.* rows landed (with
// geom from lon/lat), the {slug}.db was copied to the dest dir, and a rerun is
// idempotent (no duplication). Also checks per-project isolation: a project whose
// source {slug}.db is missing goes to skipped[] without aborting the rest.
//
// TEARDOWN: blobPool.closeAll() (release any worker handle) → rmSync tmp dirs →
// DELETE sv360 rows + the extra org → teardownTestEnv.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { importIndexDb } from '../../scripts/sv360-import.js';
import { blobPool } from '../../src/utils/sqlite-blob-pool.js';

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = 'proj-etl';
const SKIP_SLUG = 'proj-etl-missing-db';
const DB_FILENAME = `${SLUG}.db`;

const p1 = uuidv5('default/proj-etl/etl-foto001.jpg');
const p2 = uuidv5('default/proj-etl/etl-foto002.jpg');
const sp1 = uuidv5('default/proj-etl-missing-db/skip-foto001.jpg');

const full1 = Buffer.from('RIFFxxxxWEBPetl-full-001-payload-zzzzzz');
const prev1 = Buffer.from('RIFFxxxxWEBPetl-prev-001');
const full2 = Buffer.from('RIFFxxxxWEBPetl-full-002-payload-yyyyyy');
const prev2 = Buffer.from('RIFFxxxxWEBPetl-prev-002');

describe('StreetView 360 — offline ETL (importIndexDb)', () => {
  let db, tmpRoot, srcDir, destDir, indexDbPath;
  const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

  // Build the legacy index.db (organizations/projects/photos/targets/deleted_photos).
  function buildIndexDb() {
    const idb = new Database(indexDbPath);
    idb.exec(`
      CREATE TABLE organizations (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY, organization_id INTEGER, slug TEXT, name TEXT,
        center_lat REAL, center_long REAL, entry_photo_id TEXT, photo_count INTEGER,
        db_filename TEXT, status TEXT
      );
      CREATE TABLE photos (
        id TEXT PRIMARY KEY, project_id INTEGER, original_name TEXT, display_name TEXT,
        sequence_number INTEGER, lat REAL, lon REAL, ele REAL, heading REAL,
        camera_height REAL, mesh_rotation_x REAL, mesh_rotation_y REAL, mesh_rotation_z REAL,
        distance_scale REAL, marker_scale REAL, floor_level INTEGER,
        full_size_bytes INTEGER, preview_size_bytes INTEGER, calibration_reviewed INTEGER,
        capture_date TEXT
      );
      CREATE TABLE targets (
        source_id TEXT, target_id TEXT, distance_m REAL, bearing_deg REAL,
        is_next INTEGER, is_original INTEGER, override_bearing REAL,
        override_distance REAL, override_height REAL, hidden INTEGER
      );
      CREATE TABLE deleted_photos (photo_id TEXT PRIMARY KEY, deleted_at TEXT);
    `);

    idb.prepare('INSERT INTO organizations (id, slug, name) VALUES (?,?,?)').run(1, 'default', 'Default');

    // Project A (importable) + Project B (its {slug}.db will be missing → skipped).
    idb.prepare(
      `INSERT INTO projects (id, organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(1, 1, SLUG, 'Projeto ETL', -23.5, -46.6, DB_FILENAME, 'enabled', 2);
    idb.prepare(
      `INSERT INTO projects (id, organization_id, slug, name, db_filename, status, photo_count)
       VALUES (?,?,?,?,?,?,?)`
    ).run(2, 1, SKIP_SLUG, 'Projeto Skip', `${SKIP_SLUG}.db`, 'enabled', 1);

    const insP = idb.prepare(
      `INSERT INTO photos (id, project_id, original_name, sequence_number, lat, lon, ele,
        heading, camera_height, mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
        distance_scale, marker_scale, floor_level, full_size_bytes, preview_size_bytes,
        calibration_reviewed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    insP.run(p1, 1, 'etl-foto001.jpg', 1, -23.5, -46.6, 700, 0, 1.6, 0, 0, 0, 1, 1, 0, full1.length, prev1.length, 0);
    insP.run(p2, 1, 'etl-foto002.jpg', 2, -23.5005, -46.6005, 698, 0, 1.6, 0, 0, 0, 1, 1, 0, full2.length, prev2.length, 0);
    insP.run(sp1, 2, 'skip-foto001.jpg', 1, -10, -50, 100, 0, 0, 0, 0, 0, 1, 1, 0, 10, 10, 0);

    idb.prepare(
      `INSERT INTO targets (source_id, target_id, distance_m, bearing_deg, is_next, is_original, hidden)
       VALUES (?,?,?,?,?,?,?)`
    ).run(p1, p2, 12.5, 90, 1, 1, 0);

    idb.close();
  }

  // Build the source {slug}.db for Project A (the importable one).
  function buildSourceDb() {
    const p = path.join(srcDir, DB_FILENAME);
    const sdb = new Database(p);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    const ins = sdb.prepare('INSERT INTO images VALUES (?,?,?)');
    ins.run(p1, full1, prev1);
    ins.run(p2, full2, prev2);
    sdb.close();
    // Project B's {slug}.db is intentionally NOT created → it must be skipped.
  }

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    tmpRoot = path.join(os.tmpdir(), `sv360-etl-${crypto.randomUUID().slice(0, 8)}`);
    srcDir = path.join(tmpRoot, 'src');
    destDir = path.join(tmpRoot, 'dest');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    indexDbPath = path.join(tmpRoot, 'index.db');

    buildIndexDb();
    buildSourceDb();
  });

  after(async () => {
    await blobPool.closeAll();
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });

    await db.query(`DELETE FROM sv360.deleted_photos WHERE photo_id = ANY($1)`, [[p1, p2, sp1]]);
    await db.query(
      `DELETE FROM sv360.projects WHERE slug = ANY($1)`,
      [[SLUG, SKIP_SLUG]]
    );
    await teardownTestEnv(db);
  });

  it('imports a project, copies {slug}.db, fills geom; the project without a source db is skipped', async () => {
    const { imported, skipped } = await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: destDir,
      logger: silentLogger,
    });

    // Project A imported; Project B skipped (no source {slug}.db).
    assert.ok(imported.some((r) => r.slug === SLUG), 'proj-etl should import');
    assert.equal(imported.find((r) => r.slug === SLUG).photos, 2);
    assert.ok(skipped.some((r) => r.slug === SKIP_SLUG), 'proj-etl-missing-db should be skipped');

    // Rows in sv360 (default org backfill).
    const { rows: proj } = await db.query(
      `SELECT id FROM sv360.projects WHERE slug = $1
         AND organization_id = '00000000-0000-0000-0000-000000000001'`,
      [SLUG]
    );
    assert.equal(proj.length, 1);
    const pid = proj[0].id;

    const { rows: photos } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [pid]
    );
    assert.equal(photos[0].n, 2);

    const { rows: targets } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.targets WHERE source_id = $1`,
      [p1]
    );
    assert.equal(targets[0].n, 1);

    // geom filled from lon/lat by the trigger.
    const { rows: geo } = await db.query(
      `SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM sv360.photos WHERE id = $1`,
      [p1]
    );
    assert.equal(Number(geo[0].lon), -46.6);
    assert.equal(Number(geo[0].lat), -23.5);

    // {slug}.db copied to dest with both rows. FIX-1: the dest filename is the
    // SERVER-DERIVED org-scoped name (default org), NOT the legacy index.db name.
    const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
    const copied = path.join(destDir, `${DEFAULT_ORG_ID}__${SLUG}.db`);
    assert.ok(existsSync(copied), 'expected derived {slug}.db copied to dest');
    const cdb = new Database(copied, { readonly: true });
    const n = cdb.prepare('SELECT COUNT(*) AS n FROM images').get().n;
    cdb.close();
    assert.equal(n, 2);
  });

  it('is idempotent: a rerun reproduces the same state (no duplication)', async () => {
    await importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: destDir,
      logger: silentLogger,
    });

    const { rows: proj } = await db.query(
      `SELECT id FROM sv360.projects WHERE slug = $1
         AND organization_id = '00000000-0000-0000-0000-000000000001'`,
      [SLUG]
    );
    assert.equal(proj.length, 1, 'no duplicate project after rerun');

    const { rows: photos } = await db.query(
      `SELECT COUNT(*)::int AS n FROM sv360.photos WHERE project_id = $1`,
      [proj[0].id]
    );
    assert.equal(photos[0].n, 2, 'still exactly 2 photos after rerun');
  });
});

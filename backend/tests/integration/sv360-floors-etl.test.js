// Path: tests/integration/sv360-floors-etl.test.js
// StreetView 360 — the ANDARES leg of the offline ETL (scripts/sv360-import.js
// readFloors -> manifest.floors -> sv360.merge.js -> sv360.project_floors), plus
// `photos.floor_label`, which INSERT_PHOTO silently dropped before this port.
//
// Built on a synthetic legacy index.db (better-sqlite3) in a tmp dir, like
// sv360-etl.test.js, so the SQLite-side quirks are exercised for real:
//   - `plan_coords` is TEXT-with-JSON there and JSONB here;
//   - a row whose plan is unparseable keeps its floor and loses only the drawing;
//   - the merge PURGES and reinserts, so a level dropped upstream disappears.
//
// AND the regression that motivated the port: `normalizeFloorLevels` rewrites the
// legacy `floor_level DEFAULT 1` to 0 for a project that sits entirely on it. A
// project that DECLARES its floors must be exempt, otherwise every photo moves off
// the floor its own floor list names.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { importIndexDb } from '../../scripts/sv360-import.js';
import { buildTilesDb } from '../helpers/sv360-tiles.js';
import { blobPool } from '../../src/utils/sqlite-blob-pool.js';

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = 'proj-etl-floors';
const FLAT_SLUG = 'proj-etl-floors-flat';

// The legacy project id is a TEXT UUID, never an integer. ebgeo_360
// src/db/schema.sql declares `projects.id TEXT PRIMARY KEY`, and both
// `photos.project_id` and `project_floors.project_id` as
// `TEXT NOT NULL REFERENCES projects(id)`. Measured on the real data/index.db:
// all 9 project_floors rows carry typeof(project_id) = 'text', over the two
// projects '0148f085-...' and 'b708729a-...'.
//
// The fixture MUST keep that type, and one synthetic integer id is enough to
// break it. better-sqlite3 binds a plain JS number as REAL (only BigInt binds as
// INTEGER), so on a column with TEXT affinity the number 1 becomes the string
// '1.0', never '1'. A row inserted as the string '1' and looked up with the
// number 1 therefore never matches: readFloors returns [], the project imports
// with zero floors, and normalizeFloorLevels stops being exempted. Real UUID
// strings run no numeric conversion at all, which is why production works.
const PID = '4a4a4e2b-6d18-4b7c-9d1e-6f0a2c31ab77';
const PID_FLAT = 'c0b3f5a1-2e94-4d63-8a07-5b1e9c4d2f30';

const f0 = uuidv5('default/proj-etl-floors/terreo.jpg');
const f1 = uuidv5('default/proj-etl-floors/andar1.jpg');
const fl1 = uuidv5('default/proj-etl-floors-flat/rua001.jpg');
const fl2 = uuidv5('default/proj-etl-floors-flat/rua002.jpg');

const blob = (s) => Buffer.from(`RIFFxxxxWEBP${s}`);
const full0 = blob('floors-full-000');
const prev0 = blob('floors-prev-000');
const full1 = blob('floors-full-001');
const prev1 = blob('floors-prev-001');
const fullA = blob('flat-full-A');
const prevA = blob('flat-prev-A');
const fullB = blob('flat-full-B');
const prevB = blob('flat-prev-B');

const PLAN_L1 = [
  [
    [-51.2365, -30.0663],
    [-51.2361, -30.0663],
    [-51.2361, -30.0659],
  ],
];

describe('StreetView 360 — ETL dos andares (project_floors + floor_label)', () => {
  let db, tmpRoot, srcDir, destDir, indexDbPath;
  const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

  // The legacy index.db, with the two tables the ETL learned to read.
  function buildIndexDb() {
    const idb = new Database(indexDbPath);
    idb.exec(`
      CREATE TABLE organizations (id INTEGER PRIMARY KEY, slug TEXT, name TEXT);
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, organization_id INTEGER, slug TEXT, name TEXT,
        center_lat REAL, center_long REAL, entry_photo_id TEXT, photo_count INTEGER,
        db_filename TEXT, status TEXT, capture_date TEXT
      );
      CREATE TABLE photos (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, original_name TEXT, display_name TEXT,
        sequence_number INTEGER, lat REAL, lon REAL, ele REAL, heading REAL,
        camera_height REAL, mesh_rotation_x REAL, mesh_rotation_y REAL, mesh_rotation_z REAL,
        distance_scale REAL, marker_scale REAL, floor_level INTEGER DEFAULT 1,
        floor_label TEXT,
        full_size_bytes INTEGER, preview_size_bytes INTEGER, calibration_reviewed INTEGER
      );
      CREATE TABLE targets (
        source_id TEXT, target_id TEXT, distance_m REAL, bearing_deg REAL,
        is_next INTEGER, is_original INTEGER, override_bearing REAL,
        override_distance REAL, override_height REAL, hidden INTEGER
      );
      CREATE TABLE deleted_photos (photo_id TEXT PRIMARY KEY, deleted_at TEXT);
      CREATE TABLE project_floors (
        project_id TEXT NOT NULL, level INTEGER NOT NULL, label TEXT NOT NULL,
        plan_coords TEXT, PRIMARY KEY (project_id, level)
      );
    `);

    idb.prepare('INSERT INTO organizations (id, slug, name) VALUES (?,?,?)').run(1, 'default', 'Default');

    const insProj = idb.prepare(
      `INSERT INTO projects (id, organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES (?,?,?,?,?,?,?,?,?)`
    );
    insProj.run(PID, 1, SLUG, 'Projeto com andares', -30.0663, -51.2365, `${SLUG}.db`, 'enabled', 2);
    insProj.run(PID_FLAT, 1, FLAT_SLUG, 'Projeto plano', -30.05, -51.2, `${FLAT_SLUG}.db`, 'enabled', 2);

    const insP = idb.prepare(
      `INSERT INTO photos (id, project_id, original_name, sequence_number, lat, lon, ele,
        heading, camera_height, mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
        distance_scale, marker_scale, floor_level, floor_label,
        full_size_bytes, preview_size_bytes, calibration_reviewed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    // BOTH photos of the project with floors sit on level 1, exactly the legacy
    // default value — the trap normalizeFloorLevels must NOT spring here.
    insP.run(f0, PID, 'terreo.jpg', 1, -30.0663, -51.2365, 10, 0, 1.6, 0, 0, 0, 1, 1, 1, 'Térreo', full0.length, prev0.length, 0);
    insP.run(f1, PID, 'andar1.jpg', 2, -30.0661, -51.2361, 14, 0, 1.6, 0, 0, 0, 1, 1, 1, '1º andar', full1.length, prev1.length, 0);
    // The flat project: level 1 everywhere, no label, no floors declared.
    insP.run(fl1, PID_FLAT, 'rua001.jpg', 1, -30.05, -51.2, 8, 0, 1.6, 0, 0, 0, 1, 1, 1, null, fullA.length, prevA.length, 0);
    insP.run(fl2, PID_FLAT, 'rua002.jpg', 2, -30.0502, -51.2002, 8, 0, 1.6, 0, 0, 0, 1, 1, 1, null, fullB.length, prevB.length, 0);

    const insF = idb.prepare(
      'INSERT INTO project_floors (project_id, level, label, plan_coords) VALUES (?,?,?,?)'
    );
    insF.run(PID, 0, 'Térreo', null); // a level that exists with NO plan drawn
    insF.run(PID, 1, '1º andar', JSON.stringify(PLAN_L1));
    insF.run(PID, 2, '2º andar', '{nao e json'); // unparseable: keeps the floor, loses the plan

    idb.close();
  }

  function buildSourceDbs() {
    for (const [slug, rows] of [
      [SLUG, [[f0, full0, prev0], [f1, full1, prev1]]],
      [FLAT_SLUG, [[fl1, fullA, prevA], [fl2, fullB, prevB]]],
    ]) {
      // Tiles-only: o ETL instala o `{slug}_tiles.db`, entao a origem precisa dele com
      // a piramide de toda foto viva. A `{slug}.db` de blob nao viaja mais.
      buildTilesDb(path.join(srcDir, `${slug}_tiles.db`), rows.map((r) => r[0]));
    }
  }

  const runImport = () =>
    importIndexDb(indexDbPath, {
      dbDirSource: srcDir,
      dbDirDest: destDir,
      thumbDirSource: path.join(tmpRoot, 'thumbnails'),
      logger: silentLogger,
    });

  const floorsOf = async (slug) => {
    const { rows } = await db.query(
      `SELECT f.level, f.label, f.plan_coords
         FROM sv360.project_floors f
         JOIN sv360.projects p ON p.id = f.project_id
        WHERE p.slug = $1
        ORDER BY f.level`,
      [slug]
    );
    return rows;
  };

  before(async () => {
    const env = await setupTestEnv();
    db = env.db;

    tmpRoot = path.join(os.tmpdir(), `sv360-floors-etl-${crypto.randomUUID().slice(0, 8)}`);
    srcDir = path.join(tmpRoot, 'src');
    destDir = path.join(tmpRoot, 'dest');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(destDir, { recursive: true });
    indexDbPath = path.join(tmpRoot, 'index.db');

    buildIndexDb();
    buildSourceDbs();
  });

  after(async () => {
    await blobPool.closeAll();
    if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
    await db.query(`DELETE FROM sv360.projects WHERE slug = ANY($1)`, [[SLUG, FLAT_SLUG]]);
    await teardownTestEnv(db);
  });

  it('imports project_floors, parsing plan_coords into JSONB and keeping a floor whose plan is broken', async () => {
    const { imported, skipped } = await runImport();
    assert.deepEqual(skipped, [], 'no project should be skipped');
    assert.equal(imported.find((r) => r.slug === SLUG).floors, 3);
    assert.equal(imported.find((r) => r.slug === FLAT_SLUG).floors, 0);

    const floors = await floorsOf(SLUG);
    assert.deepEqual(
      floors.map((f) => [f.level, f.label]),
      [
        [0, 'Térreo'],
        [1, '1º andar'],
        [2, '2º andar'],
      ]
    );
    assert.equal(floors[0].plan_coords, null, 'a level with no plan stores NULL');
    // JSONB, so pg hands back a real array — not the TEXT the origin stored.
    assert.deepEqual(floors[1].plan_coords, PLAN_L1);
    assert.equal(floors[2].plan_coords, null, 'an unparseable plan loses the drawing, not the floor');
  });

  it('carries photos.floor_label over (INSERT_PHOTO used to drop it silently)', async () => {
    const { rows } = await db.query(
      `SELECT id, floor_level, floor_label FROM sv360.photos WHERE id = ANY($1) ORDER BY sequence_number`,
      [[f0, f1]]
    );
    assert.deepEqual(
      rows.map((r) => r.floor_label),
      ['Térreo', '1º andar']
    );
  });

  it('does NOT normalize the legacy level 1 away on a project that declares floors', async () => {
    const { rows } = await db.query(
      `SELECT DISTINCT floor_level FROM sv360.photos WHERE id = ANY($1)`,
      [[f0, f1]]
    );
    assert.deepEqual(rows.map((r) => r.floor_level), [1], 'the declared level 1 must survive');

    // The flat project keeps the old behaviour: level 1 carries no information
    // there, so it is normalized to the ground level, and floor_label stays null.
    const { rows: flat } = await db.query(
      `SELECT DISTINCT floor_level, floor_label FROM sv360.photos WHERE id = ANY($1)`,
      [[fl1, fl2]]
    );
    assert.deepEqual(flat, [{ floor_level: 0, floor_label: null }]);
  });

  it('is idempotent: a rerun leaves exactly the same three floors', async () => {
    await runImport();
    const floors = await floorsOf(SLUG);
    assert.equal(floors.length, 3, 'no duplication after the rerun');
    assert.deepEqual(floors[1].plan_coords, PLAN_L1);
  });

  it('PURGES a floor that disappeared upstream (a ghost floor would outlive its data)', async () => {
    const idb = new Database(indexDbPath);
    idb.prepare('DELETE FROM project_floors WHERE project_id = ? AND level = ?').run(PID, 2);
    idb.close();

    await runImport();
    const floors = await floorsOf(SLUG);
    assert.deepEqual(floors.map((f) => f.level), [0, 1], 'level 2 must be gone');
  });
});

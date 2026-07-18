// Path: tests/integration/sv360-image-drift.test.js
// Fase 9: the image serve path must stay protocol-correct even if Postgres
// `*_size_bytes` DIVERGES from the actual {slug}.db blob (the only residual
// effect of the ingest swap↔commit window, when a same-name image is replaced).
// Content-Length and Range MUST come from the served buffer, not the stale size.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import config from '../../src/config.js';
import { closeStore } from '../../src/modules/streetview360/sv360.blobstore.js';

const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = 'proj-drift-sv360';
const DB_FILENAME = `${SLUG}.db`;
const actualBlob = Buffer.from('RIFFxxxxWEBP-actual-30-bytes!!'); // real bytes in the {slug}.db
const STALE_SIZE = 999999; // deliberately WRONG size recorded in Postgres
const photoId = uuidv5('default/proj-drift-sv360/drift.jpg');

describe('StreetView 360 — image serve survives size drift (crash-window residual)', () => {
  let app, db, dbPath, projectId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    const proj = await db.query(
      `INSERT INTO sv360.projects (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Drift', -23, -46, $3, 'enabled', 1) RETURNING id`,
      [org.rows[0].id, SLUG, DB_FILENAME]
    );
    projectId = proj.rows[0].id;

    // Postgres records the WRONG size (simulates old metadata vs a replaced blob).
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, sequence_number, lat, lon, full_size_bytes, preview_size_bytes)
       VALUES ($1, $2, 'drift.jpg', 1, -23, -46, $3, $3)`,
      [photoId, projectId, STALE_SIZE]
    );

    mkdirSync(config.sv360.dbDir, { recursive: true });
    dbPath = path.join(config.sv360.dbDir, DB_FILENAME);
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
    const sdb = new Database(dbPath);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoId, actualBlob, actualBlob);
    sdb.close();
  });

  after(async () => {
    await closeStore();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      if (f && existsSync(f)) rmSync(f, { force: true });
    }
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1`, [projectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = $1`, [projectId]);
    await teardownTestEnv(db);
  });

  it('full image: Content-Length == ACTUAL blob length (not the stale Postgres size)', async () => {
    const res = await supertest(app).get(`/api/v1/sv360/photos/${photoId}/image`).expect(200);
    assert.equal(Number(res.headers['content-length']), actualBlob.length);
    assert.notEqual(Number(res.headers['content-length']), STALE_SIZE);
    assert.equal(res.body.length, actualBlob.length);
    assert.ok(res.body.equals(actualBlob), 'body is the real blob, intact');
  });

  it('range: 206 Content-Range is against the ACTUAL size', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${photoId}/image`)
      .set('Range', 'bytes=0-9')
      .expect(206);
    assert.equal(res.headers['content-range'], `bytes 0-9/${actualBlob.length}`);
    assert.equal(Number(res.headers['content-length']), 10);
    assert.ok(res.body.equals(actualBlob.subarray(0, 10)));
  });

  it('a range valid only against the stale size but past the real blob → 416', async () => {
    // STALE_SIZE is huge, so "bytes=50-60" would be valid against it but is past
    // the 30-byte real blob → must 416 (proves bounds use the real length).
    await supertest(app)
      .get(`/api/v1/sv360/photos/${photoId}/image`)
      .set('Range', `bytes=50-60`)
      .expect(416);
  });
});

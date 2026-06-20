// Path: tests/integration/sv360-contract.test.js
// Fase 9 (stage 1): StreetView 360 read-only contract. Covers:
//  (a) GET /sv360/projects — enabled visible to anon, disabled hidden from anon.
//  (b) GET /sv360/photos/:uuid — FROZEN photoMetadataShape (flat camera fields,
//      targets with bearing/distance, projectSlug, captureDate).
//  (c) GET /sv360/photos/:uuid/image — ETag "{uuid}-{quality}-{sizeBytes}", 200
//      Buffer, 304 (If-None-Match), 206 (Range), 416 (bad Range), Content-Type.
//  (d) error envelope { error: '...' } on a 404 (nonexistent uuid).
//
// Metadata is seeded in Postgres; the WebP BLOBs go into a small {slug}.db built
// with better-sqlite3 inside config.sv360.dbDir. full_size_bytes MUST equal the
// blob length so the ETag/Content-Length assertions hold.
//
// TEARDOWN ORDER (Windows EBUSY): closeStore() (terminates the blobPool workers,
// releasing their cached handle to {slug}.db) BEFORE deleting the .db, THEN the
// Postgres rows.

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

// Deterministic UUID v5 (node:crypto, no dependency), fixed namespace.
const NS = Buffer.from('1b671a64-40d5-491e-99b0-da01ff1f3341'.replace(/-/g, ''), 'hex');
function uuidv5(name) {
  const h = crypto.createHash('sha1').update(NS).update(Buffer.from(name, 'utf8')).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const SLUG = 'proj-test-sv360';
const DB_FILENAME = `${SLUG}.db`;
const DISABLED_SLUG = 'proj-disabled-sv360';

const fullBuf = Buffer.from('RIFFxxxxWEBPfakefull-0123456789ABCDEF'); // any bytes
const previewBuf = Buffer.from('RIFFxxxxWEBPfakeprev');

const photoId = uuidv5('default/proj-test-sv360/foto001.jpg');
const targetId = uuidv5('default/proj-test-sv360/foto002.jpg');

describe('StreetView 360 — read-only contract', () => {
  let app, db, dbPath, defaultOrgId, secondOrgId, enabledProjectId, disabledProjectId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // Default org (created by migration 012).
    const org = await db.query(`SELECT id FROM public.organizations WHERE slug = 'default'`);
    defaultOrgId = org.rows[0].id;

    // A second org so the disabled project is owned by someone other than anon.
    const org2 = await db.query(
      `INSERT INTO public.organizations (nome, slug, sigla) VALUES ('Outra OM', 'sv360-other-om', 'OUTRA')
       ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`
    );
    secondOrgId = org2.rows[0].id;

    // Enabled project (public).
    const proj = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, center_lat, center_long, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Test', -23.5, -46.6, $3, 'enabled', 2) RETURNING id`,
      [defaultOrgId, SLUG, DB_FILENAME]
    );
    enabledProjectId = proj.rows[0].id;

    // Disabled project owned by the OTHER org (hidden from anon).
    const dis = await db.query(
      `INSERT INTO sv360.projects
         (organization_id, slug, name, db_filename, status, photo_count)
       VALUES ($1, $2, 'Proj Disabled', 'disabled.db', 'disabled', 0) RETURNING id`,
      [secondOrgId, DISABLED_SLUG]
    );
    disabledProjectId = dis.rows[0].id;

    // Two photos (geom auto-filled by trg_sv360_photos_geom). full_size_bytes /
    // preview_size_bytes MUST match the blobs written into SQLite (ETag source).
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele,
          heading, camera_height, mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
          distance_scale, marker_scale, floor_level, full_size_bytes, preview_size_bytes,
          calibration_reviewed, capture_date)
       VALUES ($1, $2, 'foto001.jpg', 'Foto 001', 1, -23.5, -46.6, 720,
               12, 1.6, 0.1, 0.2, 0.3, 1.5, 2, 1, $3, $4, true, '2024-01-15T10:00:00Z')`,
      [photoId, enabledProjectId, fullBuf.length, previewBuf.length]
    );
    await db.query(
      `INSERT INTO sv360.photos
         (id, project_id, original_name, display_name, sequence_number, lat, lon, ele)
       VALUES ($1, $2, 'foto002.jpg', 'Foto 002', 2, -23.5005, -46.6005, 718)`,
      [targetId, enabledProjectId]
    );

    // Directed link foto001 -> foto002.
    await db.query(
      `INSERT INTO sv360.targets (source_id, target_id, distance_m, bearing_deg, is_next, is_original)
       VALUES ($1, $2, 12.5, 90, true, true)`,
      [photoId, targetId]
    );

    // Build the per-project {slug}.db with the WebP blobs.
    mkdirSync(config.sv360.dbDir, { recursive: true });
    dbPath = path.join(config.sv360.dbDir, DB_FILENAME);
    if (existsSync(dbPath)) rmSync(dbPath, { force: true });
    const sdb = new Database(dbPath);
    sdb.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    sdb.prepare('INSERT INTO images VALUES (?,?,?)').run(photoId, fullBuf, previewBuf);
    sdb.close();
  });

  after(async () => {
    // 1) release the blobPool's file handle to {slug}.db before deleting it.
    await closeStore();
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      if (f && existsSync(f)) rmSync(f, { force: true });
    }
    // 2) clean up Postgres rows (shared test DB).
    await db.query(`DELETE FROM sv360.targets WHERE source_id = $1`, [photoId]);
    await db.query(`DELETE FROM sv360.photos WHERE project_id = $1`, [enabledProjectId]);
    await db.query(`DELETE FROM sv360.projects WHERE id = ANY($1::uuid[])`, [
      [enabledProjectId, disabledProjectId],
    ]);
    await db.query(`DELETE FROM public.organizations WHERE id = $1`, [secondOrgId]);
    await teardownTestEnv(db);
  });

  // (a) projects listing
  it('lists an enabled project for an anonymous caller', async () => {
    const res = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    assert.ok(Array.isArray(res.body)); // bare array, not {data}
    const slugs = res.body.map((p) => p.slug);
    assert.ok(slugs.includes(SLUG));
  });

  it('hides a disabled project from an anonymous caller', async () => {
    const res = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    const slugs = res.body.map((p) => p.slug);
    assert.ok(!slugs.includes(DISABLED_SLUG));
  });

  // (b) frozen photo metadata shape
  it('returns the FROZEN photoMetadataShape for a photo', async () => {
    const res = await supertest(app).get(`/api/v1/sv360/photos/${photoId}`).expect(200);
    const b = res.body;

    // Bare object (not wrapped in {data}).
    assert.equal(b.data, undefined);

    // Flat camera fields.
    assert.equal(b.camera.id, photoId);
    assert.equal(b.camera.img, 'foto001.jpg');
    assert.equal(b.camera.display_name, 'Foto 001');
    assert.equal(b.camera.height, 1.6); // camera_height -> height
    assert.equal(b.camera.mesh_rotation_y, 0.2);
    assert.equal(b.camera.mesh_rotation_x, 0.1);
    assert.equal(b.camera.mesh_rotation_z, 0.3);
    assert.equal(b.camera.distance_scale, 1.5);
    assert.equal(b.camera.marker_scale, 2);
    assert.equal(b.camera.floor_level, 1);
    assert.equal(b.camera.calibration_reviewed, true);
    assert.ok(Math.abs(b.camera.lon - -46.6) < 1e-6);
    assert.ok(Math.abs(b.camera.lat - -23.5) < 1e-6);

    // projectSlug + captureDate.
    assert.equal(b.projectSlug, SLUG);
    assert.ok(b.captureDate); // ISO string

    // Internal column names must NOT leak.
    assert.equal(b.camera.bearing_deg, undefined);
    assert.equal(b.camera.distance_m, undefined);

    // Targets expose bearing/distance (not bearing_deg/distance_m), icon constant.
    assert.equal(b.targets.length, 1);
    const t = b.targets[0];
    assert.equal(t.id, targetId);
    assert.equal(t.img, 'foto002.jpg');
    assert.equal(t.bearing, 90);
    assert.equal(t.distance, 12.5);
    assert.equal(t.icon, 'next');
    assert.equal(t.next, true);
    assert.equal(t.is_original, true);
    assert.equal(t.bearing_deg, undefined);
    assert.equal(t.distance_m, undefined);
    assert.equal(t.override_bearing, null);
  });

  // (c) image serving
  it('serves the full image (200) with the O(1) ETag + Content-Type', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${photoId}/image?quality=full`)
      .expect(200);
    assert.equal(res.headers['content-type'], 'image/webp');
    assert.equal(res.headers['etag'], `"${photoId}-full-${fullBuf.length}"`);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.match(res.headers['cache-control'], /immutable/);
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(res.body.length, fullBuf.length);
    assert.ok(res.body.equals(fullBuf));
  });

  it('serves the preview image with a distinct ETag', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${photoId}/image?quality=preview`)
      .expect(200);
    assert.equal(res.headers['etag'], `"${photoId}-preview-${previewBuf.length}"`);
    assert.equal(res.body.length, previewBuf.length);
  });

  it('304s on a matching If-None-Match (no BLOB read)', async () => {
    const etag = `"${photoId}-full-${fullBuf.length}"`;
    await supertest(app)
      .get(`/api/v1/sv360/photos/${photoId}/image`)
      .set('If-None-Match', etag)
      .expect(304);
  });

  it('serves a Range (206) with Content-Range', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${photoId}/image`)
      .set('Range', 'bytes=0-3')
      .expect(206);
    assert.match(res.headers['content-range'], new RegExp(`^bytes 0-3/${fullBuf.length}$`));
    assert.equal(res.headers['content-length'], '4');
    assert.ok(res.body.equals(fullBuf.subarray(0, 4)));
  });

  it('rejects an invalid Range (416)', async () => {
    const res = await supertest(app)
      .get(`/api/v1/sv360/photos/${photoId}/image`)
      .set('Range', 'bytes=999999-')
      .expect(416);
    assert.match(res.headers['content-range'], new RegExp(`^bytes \\*/${fullBuf.length}$`));
  });

  // (d) error envelope
  it('returns the flat { error } envelope on a nonexistent photo (404)', async () => {
    const missing = uuidv5('default/proj-test-sv360/does-not-exist.jpg');
    const res = await supertest(app).get(`/api/v1/sv360/photos/${missing}`).expect(404);
    assert.equal(typeof res.body.error, 'string'); // flat { error: '...' }, NOT { error: { code } }
  });
});

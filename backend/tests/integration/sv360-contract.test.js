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

    // Default org (seeded by `001_identidade.sql`).
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
          heading, mesh_rotation_x, mesh_rotation_y, mesh_rotation_z,
          floor_level, full_size_bytes, preview_size_bytes,
          calibration_reviewed, capture_date)
       VALUES ($1, $2, 'foto001.jpg', 'Foto 001', 1, -23.5, -46.6, 720,
               12, 0.1, 0.2, 0.3, 1, $3, $4, true, '2024-01-15T10:00:00Z')`,
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

  // The shape, not just the slugs. This endpoint inherits the legacy service's
  // contract (`ebgeo_360/src/routes/projects.js` formatProject): camelCase, with
  // the coordinates NESTED under `center`. Returning the raw snake_case row passed
  // every assertion above while breaking all three frontend consumers at once —
  // `streetview_markers.js` throws on `p.center.lon`, so the 2D 360 layer silently
  // never renders. Asserting `slug`/`name` survived is not asserting the shape.
  it('returns the FROZEN project shape: camelCase + nested center + previewThumbnail', async () => {
    const res = await supertest(app).get('/api/v1/sv360/projects').expect(200);
    const p = res.body.find((x) => x.slug === SLUG);
    assert.ok(p, 'the enabled project is listed');

    assert.deepEqual(p.center, { lat: -23.5, lon: -46.6 }, 'coordinates nested under center');
    assert.equal(p.photoCount, 2, 'photoCount is camelCase');
    // ESTE FIXTURE NÃO ESCREVE MINIATURA EM DISCO, e por isso o campo é NULL.
    // A chave continua presente (a forma congelada perde VALOR, nunca CHAVE) e os
    // três consumidores caem no placeholder que já têm. Até 2026-08-21 esta linha
    // esperava a URL, e o que ela media era o defeito: o backend anunciava
    // `/thumbnails/{slug}.webp` para TODO projeto, arquivo em disco ou não, e o
    // catálogo pedia uma imagem que respondia 404. A forma da URL, quando o arquivo
    // existe, está pinada em `sv360-tiles.test.js`.
    assert.ok('previewThumbnail' in p, 'a chave nunca some da forma congelada');
    assert.equal(p.previewThumbnail, null, 'sem arquivo em disco, o campo não promete imagem');
    assert.ok('entryPhotoId' in p, 'entryPhotoId is camelCase');
    assert.ok('captureDate' in p, 'captureDate is present (null when unknown)');

    // The snake_case row names must NOT leak back in: a consumer reading
    // `p.center.lon` breaks the moment the flat pair reappears.
    assert.equal(p.center_lat, undefined, 'no flat center_lat');
    assert.equal(p.center_long, undefined, 'no flat center_long');
    assert.equal(p.photo_count, undefined, 'no snake_case photo_count');
    assert.equal(p.entry_photo_id, undefined, 'no snake_case entry_photo_id');

    // Storage-layout fields stay server-side for an anonymous caller.
    assert.equal(p.db_filename, undefined, 'the on-disk filename is not public');
    assert.equal(p.organization_id, undefined, 'nor the owning org UUID');
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
    // camera_height / distance_scale / marker_scale saíram do contrato em
    // 2026-08-29 (inertes, sem leitor no cliente, não existem no ebgeo_360).
    assert.equal(b.camera.height, undefined);
    assert.equal(b.camera.distance_scale, undefined);
    assert.equal(b.camera.marker_scale, undefined);
    assert.equal(b.camera.mesh_rotation_y, 0.2);
    assert.equal(b.camera.mesh_rotation_x, 0.1);
    assert.equal(b.camera.mesh_rotation_z, 0.3);
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

  // (d) error envelope
  it('returns the flat { error } envelope on a nonexistent photo (404)', async () => {
    const missing = uuidv5('default/proj-test-sv360/does-not-exist.jpg');
    const res = await supertest(app).get(`/api/v1/sv360/photos/${missing}`).expect(404);
    assert.equal(typeof res.body.error, 'string'); // flat { error: '...' }, NOT { error: { code } }
  });

  // (e) A UUID v4 photo id (the whole legacy corpus) must reach the lookup rather
  // than the format guard — pinned in sv360-gaps.test.js §sv360-07, not duplicated here.
});

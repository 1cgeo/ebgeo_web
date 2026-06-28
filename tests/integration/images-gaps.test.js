// Path: tests/integration/images-gaps.test.js
// Gap-coverage integration tests for the Images + Resources subsystem.
// Each test asserts the CURRENT behavior verified against src/modules/{images,catalog}.
//
// Findings covered: img-01, img-03, img-04, img-06, img-07, res-01, res-02,
// res-03, res-04, img-09. See StructuredOutput manifest for any skips.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, rmSync, unlinkSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, loginUser, createShare } from '../helpers/fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// unique username helper (mandatory: avoids collisions in the shared run)
const uname = (p) => `gap_${p}_${randomUUID().slice(0, 8)}`;

// Minimal valid 1x1 PNG (matches images.test.js)
const PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
  0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
  0x08, 0xd7, 0x63, 0xf8, 0xff, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

// Base64 fixtures whose magic bytes match the declared mime (verified via file-type)
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=';
// JPEG written to disk for the single-upload Content-Type test
const JPEG_BUFFER = Buffer.from(JPEG_B64, 'base64');
// Minimal valid lossless WebP (VP8L) 1x1, detected as image/webp by file-type
const WEBP_BUFFER = Buffer.from('524946461a000000574542505650384c0d0000002f0000000010071011118888080000', 'hex');

describe('Images + Resources — gap coverage', () => {
  let app, db;
  let owner, ownerToken, atlas;
  let reader;
  let admin, adminToken;
  let regular, regularToken;

  let pngPath, jpegPath, webpPath;
  const tmpFiles = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: uname('owner') });
    reader = await createUser(db, { username: uname('reader') });
    ownerToken = await loginUser(app, owner.username, owner.password);

    admin = await createAdminUser(db, { username: uname('admin') });
    regular = await createUser(db, { username: uname('reg') });
    adminToken = await loginUser(app, admin.username, admin.password);
    regularToken = await loginUser(app, regular.username, regular.password);

    atlas = await createAtlas(db, owner.id, { name: `Gaps Atlas ${randomUUID().slice(0, 6)}` });
    await createShare(db, atlas.id, reader.id, 'read', owner.id);

    const testDir = join(__dirname, '..', 'fixtures');
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });

    pngPath = join(testDir, `gap-${randomUUID().slice(0, 8)}.png`);
    jpegPath = join(testDir, `gap-${randomUUID().slice(0, 8)}.jpg`);
    webpPath = join(testDir, `gap-${randomUUID().slice(0, 8)}.webp`);
    writeFileSync(pngPath, PNG_BUFFER);
    writeFileSync(jpegPath, JPEG_BUFFER);
    writeFileSync(webpPath, WEBP_BUFFER);
    tmpFiles.push(pngPath, jpegPath, webpPath);
  });

  after(async () => {
    for (const f of tmpFiles) {
      try { if (existsSync(f)) rmSync(f); } catch { /* ignore */ }
    }
    await teardownTestEnv(db);
  });

  // Helper: upload a PNG via the single-upload route, return image id.
  async function uploadPng(token = ownerToken) {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', pngPath)
      .expect(201);
    return res.body.data.id;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // img-01 — anonymous (no token) must hit strict `auth` → 401 on every route
  // ─────────────────────────────────────────────────────────────────────────
  describe('img-01: anonymous request to images routes → 401 (no DB write)', () => {
    it('GET list without token → 401', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images`)
        .expect(401);
    });

    it('POST upload without token → 401 and no image row created', async () => {
      // No file is attached: `auth` rejects before multer reads the body, so a
      // multipart attach would race the 401 and surface as ECONNRESET. The 401
      // comes from the strict middleware regardless of body.
      const { rows: before } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .expect(401);
      const { rows: after } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
      assert.equal(after[0].n, before[0].n, 'anonymous upload must not create a row');
    });

    it('POST bulk without token → 401 and no image row created', async () => {
      const { rows: before } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .send({ images: [{ localId: randomUUID(), filename: 'a.png', mimeType: 'image/png', data: PNG_B64 }] })
        .expect(401);
      const { rows: after } = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
      assert.equal(after[0].n, before[0].n, 'anonymous bulk must not create a row');
    });

    it('GET download without token → 401', async () => {
      const id = await uploadPng();
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .expect(401);
    });

    it('DELETE without token → 401 (image survives)', async () => {
      const id = await uploadPng();
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .expect(401);
      const { rows } = await db.query('SELECT 1 FROM images WHERE id = $1', [id]);
      assert.equal(rows.length, 1, 'anonymous delete must not remove the image');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // img-03 — DB row present but file missing on disk → 404 (getImageFile branch)
  // ─────────────────────────────────────────────────────────────────────────
  describe('img-03: download with file missing on disk → 404', () => {
    it('returns 404 (NOT_FOUND envelope) when storage_path does not exist', async () => {
      const id = await uploadPng();
      // Point the row at a non-existent path; stat() fails → NotFoundError('Image file')
      await db.query(
        `UPDATE images SET storage_path = $1 WHERE id = $2`,
        ['./data/test-images/does-not-exist-' + randomUUID() + '.png', id]
      );

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      // clean 404 envelope, not a 500
      assert.ok(res.body.error, 'expected error envelope');
      assert.equal(res.body.error.code, 'NOT_FOUND');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // img-04 — download Content-Type fidelity + attachment Content-Disposition
  // ─────────────────────────────────────────────────────────────────────────
  describe('img-04: download Content-Type / Content-Disposition fidelity', () => {
    it('JPEG comes back as image/jpeg with attachment + original filename', async () => {
      const up = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', jpegPath, 'my-photo.jpg')
        .expect(201);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${up.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.equal(res.headers['content-type'], 'image/jpeg');
      const cd = res.headers['content-disposition'];
      assert.match(cd, /attachment/);
      assert.ok(!/inline/.test(cd), 'must not be served inline');
      assert.match(cd, /filename="my-photo\.jpg"/);
    });

    it('WebP comes back as image/webp (mime fidelity, not image/png)', async () => {
      const up = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', webpPath, 'pano.webp')
        .expect(201);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${up.body.data.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.equal(res.headers['content-type'], 'image/webp');
      assert.match(res.headers['content-disposition'], /attachment/);
      assert.match(res.headers['content-disposition'], /filename="pano\.webp"/);
    });

    it('Content-Disposition stays an attachment when the stored filename contains a quote', async () => {
      // busboy refuses a multipart filename containing a raw double-quote (the
      // file never reaches multer), so a crafted filename can only enter via the
      // DB (e.g. a restored dump / bulk import path). We inject it directly and
      // assert the download still emits a well-formed attachment header (Node
      // would throw on an invalid header value before sending the 200).
      const id = await uploadPng();
      await db.query(`UPDATE images SET filename = $1 WHERE id = $2`, ['ev"il.png', id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // The download still succeeds and is served as an attachment (the stored
      // XSS defense holds); the header value is accepted by the HTTP layer.
      assert.match(res.headers['content-disposition'], /attachment/);
      assert.ok(!/inline/.test(res.headers['content-disposition']));
      assert.equal(res.headers['content-type'], 'image/png');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // img-06 — duplicate localId in one bulk batch collapses mapping (last-wins)
  // ─────────────────────────────────────────────────────────────────────────
  describe('img-06: duplicate localId in bulk batch — last-wins mapping', () => {
    it('two items sharing a localId both upload but mapping has one entry', async () => {
      const dupLocalId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            { localId: dupLocalId, filename: 'a.png', mimeType: 'image/png', data: PNG_B64 },
            { localId: dupLocalId, filename: 'b.png', mimeType: 'image/png', data: PNG_B64 },
          ],
        })
        .expect(201);

      // Both rows are written (two distinct server ids)...
      assert.equal(res.body.data.uploaded.length, 2, 'both items upload');
      const serverIds = res.body.data.uploaded.map((u) => u.serverId);
      assert.notEqual(serverIds[0], serverIds[1]);

      // ...but the mapping keyed by localId collapses to a single (last) entry.
      const mappingKeys = Object.keys(res.body.data.mapping);
      assert.equal(mappingKeys.length, 1, 'duplicate localId collapses mapping to one key');
      assert.equal(res.body.data.mapping[dupLocalId], serverIds[1], 'mapping is last-wins');

      // Both rows really exist in the DB.
      const { rows } = await db.query(
        'SELECT COUNT(*)::int AS n FROM images WHERE id = ANY($1::uuid[])',
        [serverIds]
      );
      assert.equal(rows[0].n, 2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // img-07 — bulk per-item "File too large" + overall body cap behavior
  // ─────────────────────────────────────────────────────────────────────────
  describe('img-07: bulk size limits', () => {
    it('per-item oversized base64 → 201 with failed[].error /File too large/ and nothing uploaded', async () => {
      // maxSizeMb default 10MB → decoded must exceed it. Build > 10MB of base64.
      // The item has a valid PNG header so it passes the mime check; only the
      // size guard (buffer.length > maxBytes) should reject it.
      const padBytes = 11 * 1024 * 1024; // 11 MB decoded
      const big = Buffer.concat([PNG_BUFFER, Buffer.alloc(padBytes, 0)]);
      const bigB64 = big.toString('base64');

      const localId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ images: [{ localId, filename: 'huge.png', mimeType: 'image/png', data: bigB64 }] })
        .expect(201);

      assert.equal(res.body.data.uploaded.length, 0, 'oversized item must not upload');
      assert.equal(res.body.data.failed.length, 1);
      assert.equal(res.body.data.failed[0].localId, localId);
      assert.match(res.body.data.failed[0].error, /File too large/);
      assert.equal(Object.keys(res.body.data.mapping).length, 0);
    });

    it('a body between 10MB and 50MB is accepted by the dedicated bulk parser', async () => {
      // Proves the bulk parser (MAX_BULK_UPLOAD_MB) is in effect for this path:
      // a payload that exceeds the global 10mb JSON limit still parses (per-item
      // images stay small so they succeed). We assert it is NOT a 413/400.
      const smallB64 = PNG_B64; // ~100 bytes decoded each
      // ~12 MB of base64 padding inside a description-ish field is not allowed by
      // the schema; instead spread across many small valid items to grow the body.
      // Each item JSON ~ 250 bytes; 50 items is small. To exceed 10MB we inflate
      // a single item's base64 to ~12MB but keep DECODED size < maxSizeMb so it
      // is accepted by the service. 12MB base64 ≈ 9MB decoded → under the 10MB cap.
      const decodedTarget = 9 * 1024 * 1024; // 9 MB decoded (< 10MB per-item cap)
      const big = Buffer.concat([PNG_BUFFER, Buffer.alloc(decodedTarget, 0)]);
      const bigB64 = big.toString('base64'); // ~12 MB of JSON body (> global 10mb)

      const localId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ images: [{ localId, filename: 'mid.png', mimeType: 'image/png', data: bigB64 }] });

      // Must NOT be rejected by the body-parser limit (would be 413).
      assert.notEqual(res.status, 413, 'body between 10MB and 50MB must not be 413');
      assert.equal(res.status, 201, 'bulk parser accepts the >10MB body');
      assert.equal(res.body.data.uploaded.length, 1, 'decoded size under cap → uploaded');
      void smallB64;
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // img-09 — DELETE is a hard-delete; double-delete 404; unlink failure → 204
  // ─────────────────────────────────────────────────────────────────────────
  describe('img-09: delete semantics (hard-delete, idempotency, unlink failure)', () => {
    it('deleting twice → first 204, second 404', async () => {
      const id = await uploadPng();
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      // hard-delete: row is physically gone
      const { rows } = await db.query('SELECT 1 FROM images WHERE id = $1', [id]);
      assert.equal(rows.length, 0);

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('unlink failure is swallowed: DELETE still returns 204 when file already gone', async () => {
      const id = await uploadPng();
      // Find the real on-disk path and remove it BEFORE the API delete.
      const { rows } = await db.query('SELECT storage_path FROM images WHERE id = $1', [id]);
      const p = rows[0].storage_path;
      try { if (existsSync(p)) unlinkSync(p); } catch { /* ignore */ }

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      const { rows: after } = await db.query('SELECT 1 FROM images WHERE id = $1', [id]);
      assert.equal(after.length, 0, 'row removed despite missing file');
    });

    it('deleting the parent atlas cascades image rows (FK ON DELETE CASCADE)', async () => {
      const a2 = await createAtlas(db, owner.id, { name: `Cascade Atlas ${randomUUID().slice(0, 6)}` });
      const up = await supertest(app)
        .post(`/api/v1/atlas/${a2.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', pngPath)
        .expect(201);
      const imgId = up.body.data.id;

      // Hard-delete the atlas directly in the DB to exercise the FK cascade.
      await db.query('DELETE FROM atlas WHERE id = $1', [a2.id]);

      const { rows } = await db.query('SELECT 1 FROM images WHERE id = $1', [imgId]);
      assert.equal(rows.length, 0, 'image rows cascade-deleted with the atlas (files remain on disk)');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // res-01 — soft-deleted resource id can never be recreated (permanent 409)
  // ─────────────────────────────────────────────────────────────────────────
  describe('res-01: soft-deleted resource id → recreate is permanent 409', () => {
    it('create, delete (204, gone from list), recreate same id → 409', async () => {
      const rid = `gap-res-${randomUUID().slice(0, 8)}`;

      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: rid, name: 'Soft Delete Me', config: {} })
        .expect(201);

      await supertest(app)
        .delete(`/api/v1/basemaps/${rid}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // gone from listing
      const list = await supertest(app)
        .get('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      assert.ok(!list.body.data.map((r) => r.id).includes(rid));

      // but the row still exists (active=false), so recreate → 409 forever
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: rid, name: 'Resurrect?', config: {} })
        .expect(409);

      // confirm the persisted state: one inactive row
      const { rows } = await db.query('SELECT active FROM basemaps WHERE id = $1', [rid]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].active, false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // res-02 — description: null is a COALESCE no-op; '' is applied (asymmetry)
  // ─────────────────────────────────────────────────────────────────────────
  describe('res-02: update description null-vs-empty asymmetry', () => {
    it('PUT {description:null} is a no-op; PUT {description:""} clears to empty string', async () => {
      const rid = `gap-desc-${randomUUID().slice(0, 8)}`;
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ id: rid, name: 'Desc Test', description: 'foo', config: {} })
        .expect(201);

      // null → COALESCE keeps the old value
      const r1 = await supertest(app)
        .put(`/api/v1/basemaps/${rid}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: null })
        .expect(200);
      assert.equal(r1.body.data.description, 'foo', 'null description is ignored (COALESCE no-op)');

      // '' → applied (empty string is not COALESCE'd)
      const r2 = await supertest(app)
        .put(`/api/v1/basemaps/${rid}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ description: '' })
        .expect(200);
      assert.equal(r2.body.data.description, '', 'empty-string description is applied');

      const { rows } = await db.query('SELECT description FROM basemaps WHERE id = $1', [rid]);
      assert.equal(rows[0].description, '');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // res-03 — anonymous on GET /:id and writes → 401 (auth before requireAdmin)
  // ─────────────────────────────────────────────────────────────────────────
  describe('res-03: resources routes reject anonymous with 401 (auth before admin)', () => {
    it('GET /resources/:id without token → 401', async () => {
      await supertest(app).get('/api/v1/basemaps/basemap-osm').expect(401);
    });

    it('POST /resources without token → 401 (not 500 from requireAdmin)', async () => {
      const res = await supertest(app)
        .post('/api/v1/basemaps')
        .send({ id: 'x', name: 'x', config: {} })
        .expect(401);
      assert.notEqual(res.status, 500);
    });

    it('PUT /resources/:id without token → 401', async () => {
      await supertest(app)
        .put('/api/v1/basemaps/basemap-osm')
        .send({ name: 'x' })
        .expect(401);
    });

    it('DELETE /resources/:id without token → 401', async () => {
      await supertest(app)
        .delete('/api/v1/basemaps/basemap-osm')
        .expect(401);
    });

    it('non-admin write → 403 (auth passes, requireAdmin blocks)', async () => {
      await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ id: `gap-nonadmin-${randomUUID().slice(0, 8)}`, name: 'x', config: {} })
        .expect(403);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // res-04 — config JSONB is unbounded; large config is accepted and echoed in
  // GET /api/v1/config (public). Pins current behavior: NO size/depth guard.
  // ─────────────────────────────────────────────────────────────────────────
  describe('res-04: unbounded resource config blast radius into public /config', () => {
    it('large/deep basemap config is accepted (no limit) and round-trips into GET /config', async () => {
      const rid = `gap-bigcfg-${randomUUID().slice(0, 8)}`;

      // Deeply nested object (1000 levels) — no depth guard in the schema.
      let deep = { leaf: true };
      for (let i = 0; i < 1000; i++) deep = { nested: deep };

      // Plus a sizeable string payload (~1 MB) to probe the size dimension.
      const bigString = 'x'.repeat(1024 * 1024);

      const created = await supertest(app)
        .post('/api/v1/basemaps')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: rid,
          name: 'Big Config',
          config: { url: 'https://example.com/{z}/{x}/{y}.png', deep, blob: bigString },
        })
        .expect(201);
      assert.equal(created.body.data.id, rid);

      // Persisted verbatim.
      const { rows } = await db.query('SELECT config FROM basemaps WHERE id = $1', [rid]);
      assert.ok(rows[0].config.blob.length === bigString.length, 'config persisted unbounded');

      // Public, no-auth config endpoint echoes the basemap (keyed by id) — the
      // unbounded config is now in the anonymous payload (documents the blast radius).
      const cfg = await supertest(app).get('/api/v1/config').expect(200);
      assert.ok(cfg.body.data.basemaps[rid], 'big basemap appears in public /config');
      assert.equal(cfg.body.data.basemaps[rid].blob.length, bigString.length);
    });
  });
});

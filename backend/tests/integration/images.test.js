// Path: tests/integration/images.test.js
// Integration tests for the Images API (upload, download, delete)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Images API', () => {
  let app, db, owner, reader, stranger;
  let ownerToken, readerToken, strangerToken;
  let atlas;
  let testImagePath;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: 'images_owner' });
    reader = await createUser(db, { username: 'images_reader' });
    stranger = await createUser(db, { username: 'images_stranger' });

    ownerToken = await loginUser(app, owner.username, owner.password);
    readerToken = await loginUser(app, reader.username, reader.password);
    strangerToken = await loginUser(app, stranger.username, stranger.password);

    atlas = await createAtlas(db, owner.id, { name: 'Images Test Atlas' });

    // Share with reader
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
      [atlas.id, reader.id, owner.id]
    );

    // Create a test image file
    const testDir = join(__dirname, '..', 'fixtures');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testImagePath = join(testDir, 'test-image.png');

    // Create a minimal valid PNG (1x1 red pixel)
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, // IHDR length
      0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, // width = 1
      0x00, 0x00, 0x00, 0x01, // height = 1
      0x08, 0x02, // bit depth = 8, color type = 2 (RGB)
      0x00, 0x00, 0x00, // compression, filter, interlace
      0x90, 0x77, 0x53, 0xDE, // CRC
      0x00, 0x00, 0x00, 0x0C, // IDAT length
      0x49, 0x44, 0x41, 0x54, // IDAT
      0x08, 0xD7, 0x63, 0xF8, 0xFF, 0x00, 0x00, 0x00, // compressed data
      0x01, 0x00, 0x01, //
      0x00, 0x05, 0xFE, 0x02, 0xFE, 0xDC, // CRC
      0x00, 0x00, 0x00, 0x00, // IEND length
      0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82, // CRC
    ]);
    writeFileSync(testImagePath, pngBuffer);
  });

  after(async () => {
    // Clean up test image
    if (existsSync(testImagePath)) {
      rmSync(testImagePath);
    }
    await teardownTestEnv(db);
  });

  describe('POST /atlas/:atlasId/images — Upload Image', () => {
    it('owner can upload an image', async () => {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', testImagePath)
        .expect(201);

      assert.ok(res.body.data.id);
      assert.ok(res.body.data.filename);
      // The column is `size_bytes` (RETURNING *); there is no `size` alias.
      assert.ok(Number(res.body.data.size_bytes) > 0);
      assert.equal(res.body.data.size, undefined);

      // The absolute server filesystem path must never cross the API boundary.
      assert.equal(res.body.data.storage_path, undefined,
        'upload response must not leak the internal storage_path');

      // Verify in database
      const { rows } = await db.query('SELECT * FROM images WHERE id = $1', [res.body.data.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].atlas_id, atlas.id);
      // …but the column is still persisted server-side.
      assert.ok(rows[0].storage_path, 'storage_path must still be stored in the DB');
    });

    it('writer can upload an image', async () => {
      // Add writer share
      const writer = await createUser(db, { username: 'images_writer' });
      await db.query(
        `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
        [atlas.id, writer.id, owner.id]
      );
      const writerToken = await loginUser(app, writer.username, writer.password);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${writerToken}`)
        .attach('image', testImagePath)
        .expect(201);

      assert.ok(res.body.data.id);
    });

    it('reader cannot upload images', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${readerToken}`)
        .attach('image', testImagePath)
        .expect(403);
    });

    it('stranger cannot upload images', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .attach('image', testImagePath)
        .expect(403);
    });

    it('rejects upload without file', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });
  });

  describe('GET /atlas/:atlasId/images — List Images', () => {
    before(async () => {
      // Upload an image to list
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', testImagePath);
    });

    it('owner can list images', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length > 0);
    });

    it('reader can list images without seeing internal storage paths', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.data.length > 0);
      // A read-level viewer must not learn the deployment's filesystem layout.
      for (const img of res.body.data) {
        assert.equal(img.storage_path, undefined,
          'list response must not leak storage_path to a reader');
      }
    });

    it('stranger cannot list images', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });

  describe('GET /atlas/:atlasId/images/:imageId — Download Image', () => {
    let uploadedImageId;

    before(async () => {
      // Upload an image to download
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', testImagePath);
      uploadedImageId = res.body.data.id;
    });

    it('owner can download image', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${uploadedImageId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // Check content type
      assert.ok(res.headers['content-type'].includes('image'));
    });

    it('reader can download image', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${uploadedImageId}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);

      assert.ok(res.headers['content-type'].includes('image'));
    });

    it('stranger cannot download image from private atlas', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${uploadedImageId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('returns 404 for non-existent image', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('cannot reach an image of another atlas via a DIFFERENT atlas URL (cross-atlas IDOR)', async () => {
      // The attacker OWNS atlasB, so requireAtlasPermission passes for B; the image
      // belongs to `atlas` (A). The only tenant binding is `AND atlas_id = $2` in the
      // query, so addressing A's imageId through B's URL must 404 on GET and DELETE,
      // and must NOT cross-atlas-delete the image.
      const attacker = await createUser(db, { username: 'images_cross_atlas' });
      const atlasB = await createAtlas(db, attacker.id, { name: 'Attacker Atlas' });
      const attackerToken = await loginUser(app, attacker.username, attacker.password);

      await supertest(app)
        .get(`/api/v1/atlas/${atlasB.id}/images/${uploadedImageId}`)
        .set('Authorization', `Bearer ${attackerToken}`)
        .expect(404);

      await supertest(app)
        .delete(`/api/v1/atlas/${atlasB.id}/images/${uploadedImageId}`)
        .set('Authorization', `Bearer ${attackerToken}`)
        .expect(404);

      const { rows } = await db.query('SELECT 1 FROM images WHERE id = $1', [uploadedImageId]);
      assert.equal(rows.length, 1, 'cross-atlas image must survive the foreign-atlas delete attempt');
    });
  });

  describe('DELETE /atlas/:atlasId/images/:imageId — Delete Image', () => {
    it('owner can delete image', async () => {
      // Upload an image to delete
      const uploadRes = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', testImagePath);
      const imageId = uploadRes.body.data.id;

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      // Verify image is deleted
      const { rows } = await db.query('SELECT * FROM images WHERE id = $1', [imageId]);
      assert.equal(rows.length, 0);
    });

    it('writer can delete image', async () => {
      // Add writer
      const writer = await createUser(db, { username: 'images_writer2' });
      await db.query(
        `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
        [atlas.id, writer.id, owner.id]
      );
      const writerToken = await loginUser(app, writer.username, writer.password);

      // Upload an image
      const uploadRes = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${writerToken}`)
        .attach('image', testImagePath);
      const imageId = uploadRes.body.data.id;

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
        .set('Authorization', `Bearer ${writerToken}`)
        .expect(204);
    });

    it('reader cannot delete image', async () => {
      // Upload an image
      const uploadRes = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', testImagePath);
      const imageId = uploadRes.body.data.id;

      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(403);
    });

    it('returns 404 for non-existent image', async () => {
      await supertest(app)
        .delete(`/api/v1/atlas/${atlas.id}/images/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('Public Atlas Images', () => {
    let publicAtlas, publicLink, publicToken, publicImageId;

    before(async () => {
      // Create public atlas
      publicAtlas = await createAtlas(db, owner.id, { name: 'Public Images Atlas' });

      // Enable public sharing
      const res = await supertest(app)
        .post(`/api/v1/atlas/${publicAtlas.id}/sharing/public`)
        .set('Authorization', `Bearer ${ownerToken}`);
      publicLink = res.body.data.publicLink || res.body.data.public_link;

      // Get public token
      const publicRes = await supertest(app)
        .get(`/api/v1/atlas/public/${publicLink}`);
      publicToken = publicRes.body.data.publicToken;

      // Upload image to public atlas
      const uploadRes = await supertest(app)
        .post(`/api/v1/atlas/${publicAtlas.id}/images`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('image', testImagePath);
      publicImageId = uploadRes.body.data.id;
    });

    it('public user can list images with public token', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${publicAtlas.id}/images`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(200);

      assert.ok(Array.isArray(res.body.data));
    });

    it('public user can download image with public token', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${publicAtlas.id}/images/${publicImageId}`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(200);

      assert.ok(res.headers['content-type'].includes('image'));
    });

    it('public user cannot upload images', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${publicAtlas.id}/images`)
        .set('Authorization', `Bearer ${publicToken}`)
        .attach('image', testImagePath)
        .expect(403);
    });

    it('public user cannot delete images', async () => {
      await supertest(app)
        .delete(`/api/v1/atlas/${publicAtlas.id}/images/${publicImageId}`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
    });
  });

  describe('POST /atlas/:atlasId/images/bulk — Bulk Upload Images', () => {
    // Create a minimal valid PNG as base64 (1x1 red pixel)
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const jpegBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBEQCEAwEPwAB//9k=';

    it('owner can bulk upload images', async () => {
      const localId1 = '11111111-1111-1111-1111-111111111111';
      const localId2 = '22222222-2222-2222-2222-222222222222';

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            {
              localId: localId1,
              filename: 'test-image-1.png',
              mimeType: 'image/png',
              data: pngBase64,
            },
            {
              localId: localId2,
              filename: 'test-image-2.jpeg',
              mimeType: 'image/jpeg',
              data: jpegBase64,
            },
          ],
        })
        .expect(201);

      assert.ok(res.body.data.uploaded);
      assert.ok(res.body.data.mapping);
      assert.equal(res.body.data.uploaded.length, 2);
      assert.ok(res.body.data.mapping[localId1]);
      assert.ok(res.body.data.mapping[localId2]);

      // Verify images were created in database
      const { rows } = await db.query(
        'SELECT * FROM images WHERE id = $1 OR id = $2',
        [res.body.data.mapping[localId1], res.body.data.mapping[localId2]]
      );
      assert.equal(rows.length, 2);
    });

    it('returns mapping of localId to serverId', async () => {
      const localId = '33333333-3333-3333-3333-333333333333';

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            {
              localId: localId,
              filename: 'mapping-test.png',
              mimeType: 'image/png',
              data: pngBase64,
            },
          ],
        })
        .expect(201);

      assert.ok(res.body.data.mapping[localId]);
      assert.equal(typeof res.body.data.mapping[localId], 'string');
      // Verify serverId is a valid UUID
      assert.match(res.body.data.mapping[localId], /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('handles partial failures gracefully', async () => {
      const validLocalId = '44444444-4444-4444-4444-444444444444';
      const invalidLocalId = '55555555-5555-5555-5555-555555555555';

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            {
              localId: validLocalId,
              filename: 'valid.png',
              mimeType: 'image/png',
              data: pngBase64,
            },
            {
              localId: invalidLocalId,
              filename: 'invalid.txt',
              mimeType: 'text/plain', // Invalid mime type - will fail validation before reaching service
              data: 'not-valid-base64',
            },
          ],
        })
        .expect(422); // Validation error for invalid mimeType
    });

    it('handles invalid base64 data gracefully', async () => {
      const localId = '66666666-6666-6666-6666-666666666666';

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            {
              localId: localId,
              filename: 'bad-data.png',
              mimeType: 'image/png',
              data: 'not-valid-base64-!!!',
            },
          ],
        })
        .expect(201);

      // Base64 decode is lenient — invalid chars are ignored, so file is written
      // The service doesn't validate image content, just writes the decoded bytes
      const totalProcessed = (res.body.data.uploaded?.length || 0) + (res.body.data.failed?.length || 0);
      assert.equal(totalProcessed, 1);
    });

    it('accepts data URL format (data:image/png;base64,...)', async () => {
      const localId = '77777777-7777-7777-7777-777777777777';
      const dataUrl = `data:image/png;base64,${pngBase64}`;

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            {
              localId: localId,
              filename: 'data-url.png',
              mimeType: 'image/png',
              data: dataUrl,
            },
          ],
        })
        .expect(201);

      assert.equal(res.body.data.uploaded.length, 1);
      assert.ok(res.body.data.mapping[localId]);
    });

    it('reader cannot bulk upload images', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({
          images: [
            {
              localId: '88888888-8888-8888-8888-888888888888',
              filename: 'forbidden.png',
              mimeType: 'image/png',
              data: pngBase64,
            },
          ],
        })
        .expect(403);
    });

    it('stranger cannot bulk upload images', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .send({
          images: [
            {
              localId: '99999999-9999-9999-9999-999999999999',
              filename: 'forbidden.png',
              mimeType: 'image/png',
              data: pngBase64,
            },
          ],
        })
        .expect(403);
    });

    it('validates required fields', async () => {
      // Missing localId
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            {
              filename: 'no-local-id.png',
              mimeType: 'image/png',
              data: pngBase64,
            },
          ],
        })
        .expect(422);

      // Missing data
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [
            {
              localId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              filename: 'no-data.png',
              mimeType: 'image/png',
            },
          ],
        })
        .expect(422);
    });

    it('rejects empty images array', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          images: [],
        })
        .expect(422);
    });

    it('limits bulk upload to 50 images', async () => {
      const images = Array.from({ length: 51 }, (_, i) => ({
        localId: `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
        filename: `image-${i}.png`,
        mimeType: 'image/png',
        data: pngBase64,
      }));

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ images })
        .expect(422);
    });
  });
});

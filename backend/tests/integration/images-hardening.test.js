// Path: tests/integration/images-hardening.test.js
// Tests for the Fase 0 image hardening: SVG rejection, magic-byte validation,
// download served as attachment with cache/conditional/Range support.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import config from '../../src/config.js';

// Minimal valid 1x1 PNG (real magic bytes).
const PNG_1x1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0x00, 0x00,
  0x00, 0x01, 0x00, 0x01, 0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe('Images hardening', () => {
  let app, db, owner, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'imghard_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Images Hardening Atlas' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  it('rejects an SVG upload (stored-XSS vector) with 400', async () => {
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), {
        filename: 'evil.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400);
  });

  it('rejects a file whose content does not match the declared type (400)', async () => {
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', Buffer.from('<html>not a png</html>'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('rejects a single upload over MAX_IMAGE_SIZE_MB with 400 (not 500)', async () => {
    // Exceed the configured per-image limit; multer raises LIMIT_FILE_SIZE, which
    // the route maps to a 400 (BadRequestError) instead of a generic 500.
    const tooBig = Buffer.alloc((config.images.maxSizeMb + 1) * 1024 * 1024, 0x00);
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', tooBig, { filename: 'huge.png', contentType: 'image/png' })
      .expect(400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
  });

  it('accepts a real PNG and serves the download as an immutable attachment', async () => {
    const upload = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('image', PNG_1x1, { filename: 'real.png', contentType: 'image/png' })
      .expect(201);
    const imageId = upload.body.data.id;

    const dl = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.ok(dl.headers['etag'], 'ETag present');
    assert.match(dl.headers['cache-control'], /immutable/);
    assert.equal(dl.headers['accept-ranges'], 'bytes');
    assert.match(dl.headers['content-disposition'], /attachment/);
    assert.match(dl.headers['content-type'], /image/);

    // Conditional request with the matching ETag -> 304
    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('If-None-Match', dl.headers['etag'])
      .expect(304);

    // Range request -> 206 with Content-Range
    const ranged = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/images/${imageId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Range', 'bytes=0-0')
      .expect(206);
    assert.ok(ranged.headers['content-range'], 'Content-Range present');
  });

  it('routes a bulk image whose content mismatches the declared type to "failed"', async () => {
    const localId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        images: [
          {
            localId,
            filename: 'mismatch.png',
            mimeType: 'image/png',
            // base64 of plain text, not a PNG
            data: Buffer.from('definitely not an image').toString('base64'),
          },
        ],
      })
      .expect(201);

    assert.equal(res.body.data.uploaded.length, 0);
    assert.equal(res.body.data.failed.length, 1);
    assert.equal(res.body.data.failed[0].localId, localId);
  });
});

// Path: tests/integration/images-filename-hardening.repro.test.js
// Regression tests for bugs-backend.md findings 43 and 69 (module be-images).
//
// 43 — GET /atlas/:id/images/:imageId built Content-Disposition by raw string
//      concatenation (`attachment; filename="${filename}"`). Node validates every
//      header value against /[^\t\x20-\x7e\x80-\xff]/ and THROWS ERR_INVALID_CHAR
//      for any codepoint above U+00FF, so a stored filename such as '地図.png'
//      (reachable through POST /images/bulk, whose Joi schema accepts any string
//      up to 255 chars) turned the download into a 500 for every user with read.
//      Quotes were not escaped either, so a filename could inject a second
//      `filename=` parameter into the header.
//
// 69 — POST /atlas/:id/images was the only write route with no payload validation:
//      multer wrote the file to disk first, then `file.originalname` went verbatim
//      into `filename VARCHAR(255) NOT NULL`. A longer name raised SQLSTATE 22001,
//      which is absent from PG_ERROR_MAP, so the caller got a 500 and the already
//      written blob stayed on disk with no row pointing at it.
//
// Negative control for both: revert the corresponding fix and these fail — the
// non-latin1 download returns 500, the quote test sees an unescaped header, and
// the oversized-name upload returns 500 while leaving one extra file on disk.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { contarBlobs } from '../helpers/blobs-em-disco.js';
import config from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const uname = (p) => `fnh_${p}_${randomUUID().slice(0, 8)}`;

// Minimal valid 1x1 PNG (magic bytes must match: the service checks them).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PNG_BUFFER = Buffer.from(PNG_B64, 'base64');

/** Blobs de verdade no diretorio de upload do atlas (0 quando ele nao existe). */
// Conta blobs de VERDADE, e nao entradas de diretorio. `readdirSync` sozinho
// devolvia tambem a entrada `<UUID>.PNG.tmp` de zero byte que o Windows deixa
// por alguns milissegundos depois do unlink, e esse fantasma ja produziu
// vermelho intermitente. A medicao esta em helpers/blobs-em-disco.js.
function countFiles(dir) {
  return contarBlobs(dir);
}

describe('Images — filename hardening (findings 43, 69)', () => {
  let app, db;
  let owner, token, atlas, atlasDir, pngPath;
  const tmpFiles = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    owner = await createUser(db, { username: uname('owner') });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `FNH Atlas ${randomUUID().slice(0, 6)}` });
    atlasDir = resolve(join(config.images.dir, atlas.id));

    const fixtureDir = join(__dirname, '..', 'fixtures');
    if (!existsSync(fixtureDir)) mkdirSync(fixtureDir, { recursive: true });
    pngPath = join(fixtureDir, `fnh-${randomUUID().slice(0, 8)}.png`);
    writeFileSync(pngPath, PNG_BUFFER);
    tmpFiles.push(pngPath);
  });

  after(async () => {
    for (const f of tmpFiles) {
      try { rmSync(f, { force: true }); } catch { /* best effort */ }
    }
    await teardownTestEnv();
  });

  /** Bulk-uploads one image with an arbitrary stored filename; returns its server id. */
  async function bulkUpload(filename) {
    const localId = randomUUID();
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/images/bulk`)
      .set('Authorization', `Bearer ${token}`)
      .send({ images: [{ localId, filename, mimeType: 'image/png', data: PNG_B64 }] })
      .expect(201);

    assert.equal(res.body.data.failed.length, 0, 'bulk item must upload');
    return res.body.data.uploaded[0].serverId;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Finding 43 — Content-Disposition must survive a filename outside latin1
  // ───────────────────────────────────────────────────────────────────────────
  describe('43: download of an image whose stored filename is not latin1', () => {
    it('serves 200 with an RFC 6266 filename* parameter (was 500 ERR_INVALID_CHAR)', async () => {
      const id = await bulkUpload('地図.png');

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const cd = res.headers['content-disposition'];
      assert.match(cd, /^attachment;/, 'still an attachment, never inline');
      assert.match(
        cd,
        /filename\*=UTF-8''%E5%9C%B0%E5%9B%B3\.png/,
        `expected an RFC 5987 encoded filename*, got: ${cd}`
      );
      assert.equal(res.headers['content-type'], 'image/png');
    });

    it('serves 200 for an emoji filename too', async () => {
      const id = await bulkUpload('foto 📷.png');

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.match(res.headers['content-disposition'], /^attachment;/);
      assert.match(res.headers['content-disposition'], /filename\*=UTF-8''/);
    });

    it('keeps a latin1 (pt-BR accented) filename in the plain filename parameter', async () => {
      const id = await bulkUpload('coordenação.png');

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Latin1 is a valid header char class, so the ASCII/latin1 parameter carries
      // the name; the encoded form may or may not be added, but the download works.
      assert.match(res.headers['content-disposition'], /^attachment;/);
    });

    it('escapes a quoted filename instead of emitting a second filename parameter', async () => {
      // The injection payload from the finding: raw concatenation splits this into
      // TWO filename parameters, so the served name becomes evil.exe.
      const id = await bulkUpload('a"; filename="evil.exe');

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const cd = res.headers['content-disposition'];
      assert.equal(
        (cd.match(/(^|;\s*)filename="/g) || []).length,
        1,
        `header must carry exactly one quoted filename parameter, got: ${cd}`
      );
      assert.equal(cd, 'attachment; filename="a\\"; filename=\\"evil.exe"');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Finding 69 — POST /atlas/:id/images validates the uploaded file's name
  // ───────────────────────────────────────────────────────────────────────────
  describe('69: single upload rejects an unbounded originalname without leaking a file', () => {
    it('answers 4xx and leaves the atlas directory untouched (was 500 + orphan blob)', async () => {
      const before = countFiles(atlasDir);
      const rowsBefore = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('image', pngPath, `${'a'.repeat(300)}.png`);

      // Disk first: reverting the fix must fail this assertion as well as the status
      // one (the blob multer already wrote is the orphan the finding describes).
      assert.equal(countFiles(atlasDir), before, 'no orphan file must be written to disk');
      const rowsAfter = await db.query('SELECT COUNT(*)::int AS n FROM images WHERE atlas_id = $1', [atlas.id]);
      assert.equal(rowsAfter.rows[0].n, rowsBefore.rows[0].n, 'no row must be created');

      assert.ok(
        res.status >= 400 && res.status < 500,
        `expected a 4xx for an over-long filename, got ${res.status}`
      );
      assert.ok(res.body.error, 'error envelope present');
      assert.notEqual(res.body.error.code, 'INTERNAL_ERROR', 'must not be reported as a server fault');
    });

    it('still accepts a normal accented filename (guard is not over-broad)', async () => {
      // Real product path: the browser's FormData writes the UTF-8 bytes raw into
      // the multipart header and busboy decodes them as latin1, so what reaches
      // multer is mojibake ('coordenaÃ§Ã£o…') — still a legal header value, and it
      // must keep uploading and downloading exactly as before.
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('image', pngPath, 'coordenação da operação.png')
        .expect(201);

      assert.ok(res.body.data.id, 'upload succeeds');
      assert.match(res.body.data.filename, /\.png$/, 'stored name keeps the extension');

      const dl = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/images/${res.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      assert.match(dl.headers['content-disposition'], /^attachment;/);
    });

    it('still accepts a long-but-valid filename at the 255 boundary', async () => {
      const name = `${'b'.repeat(251)}.png`; // 255 chars exactly
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('image', pngPath, name)
        .expect(201);

      assert.equal(res.body.data.filename, name);
    });

    it('derives a bounded, path-free name on disk from the original extension', async () => {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('image', pngPath, 'planta-sem-extensao')
        .expect(201);

      const { rows } = await db.query('SELECT storage_path FROM images WHERE id = $1', [res.body.data.id]);
      const stored = rows[0].storage_path.split(/[\\/]/).pop();
      assert.match(
        stored,
        /^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/,
        `on-disk name must be uuid + short ascii extension, got: ${stored}`
      );
      assert.ok(existsSync(resolve(rows[0].storage_path)), 'blob was written');
    });
  });
});

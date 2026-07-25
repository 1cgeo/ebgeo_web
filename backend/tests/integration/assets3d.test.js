// Path: tests/integration/assets3d.test.js
// Fase 4 Tarefa 2: 3D asset serving with ETag/304/Range/416 + path-traversal block.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';

const ROOT = resolve('./data/assets3d');
const BODY = JSON.stringify({ asset: { version: '1.0' }, root: {} });

describe('3D assets serving', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    mkdirSync(join(ROOT, 'aman'), { recursive: true });
    writeFileSync(join(ROOT, 'aman', 'tileset.json'), BODY);
    writeFileSync(join(ROOT, 'aman', 'model.glb'), Buffer.from('glb-binary-bytes-here'));
  });

  after(async () => {
    if (existsSync(join(ROOT, 'aman'))) rmSync(join(ROOT, 'aman'), { recursive: true, force: true });
    await teardownTestEnv(db);
  });

  it('serves a tileset.json with immutable cache + ETag + Accept-Ranges (public)', async () => {
    const res = await supertest(app).get('/api/v1/assets3d/aman/tileset.json').expect(200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.match(res.headers['cache-control'], /immutable/);
    assert.ok(res.headers['etag']);
  });

  it('returns 304 for a matching If-None-Match', async () => {
    const first = await supertest(app).get('/api/v1/assets3d/aman/tileset.json').expect(200);
    await supertest(app)
      .get('/api/v1/assets3d/aman/tileset.json')
      .set('If-None-Match', first.headers['etag'])
      .expect(304);
  });

  it('returns 206 for a valid Range and 416 for an invalid one', async () => {
    // Use the binary .glb so supertest does not try to JSON-parse a partial body.
    const ranged = await supertest(app)
      .get('/api/v1/assets3d/aman/model.glb')
      .set('Range', 'bytes=0-9')
      .expect(206);
    assert.match(ranged.headers['content-range'], /^bytes 0-9\/\d+$/);
    assert.equal(ranged.headers['content-length'], '10');

    const bad = await supertest(app)
      .get('/api/v1/assets3d/aman/model.glb')
      .set('Range', 'bytes=999999-')
      .expect(416);
    assert.match(bad.headers['content-range'], /^bytes \*\/\d+$/);
  });

  it('serves .glb with model/gltf-binary content type', async () => {
    const res = await supertest(app).get('/api/v1/assets3d/aman/model.glb').expect(200);
    assert.equal(res.headers['content-type'], 'model/gltf-binary');
  });

  it('blocks path traversal and 404s missing files', async () => {
    const trav = await supertest(app).get('/api/v1/assets3d/%2e%2e/%2e%2e/package.json');
    // %2e%2e decodes to '..' and Express NORMALISES the URL path before routing,
    // so this request never reaches the assets3d handler: it resolves out of the
    // mount and falls through to the 404. (The handler's own out-of-ROOT refusal
    // is 403 — exercised in nomes-catalogo3d-gaps with %5C, which Express does
    // not normalise.) Either way no file is served, which is the invariant.
    assert.equal(trav.status, 404, `an encoded '..' escape must not be served, got ${trav.status}`);
    assert.notEqual(trav.status, 200, 'a path escaping ROOT must never be served');
    await supertest(app).get('/api/v1/assets3d/aman/missing.json').expect(404);
  });
});

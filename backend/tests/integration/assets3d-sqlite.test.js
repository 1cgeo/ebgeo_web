// Path: tests/integration/assets3d-sqlite.test.js
// 3D tiles served from the SQLite BLOB store (dual-mode: SQLite first). Covers
// ETag O(1)/304/Range/416 from SQLite + the filesystem fallback for misses.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { openWritable, putAsset, closeStore } from '../../src/modules/nomes/assets3d.store.js';

const SQLITE = resolve(process.env.ASSETS_3D_SQLITE || './data/assets3d.sqlite');
const BODY = JSON.stringify({ asset: { version: '1.0' }, root: {} });

async function cleanupStore() {
  await closeStore(); // closes main read conn + terminates worker threads (releases file locks)
  for (const f of [SQLITE, `${SQLITE}-wal`, `${SQLITE}-shm`, `${SQLITE}-journal`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

describe('3D assets — SQLite store', () => {
  let app, db;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    await cleanupStore(); // fresh store
    const w = openWritable();
    putAsset(w, 'sqlite/tileset.json', Buffer.from(BODY), 'application/json');
    putAsset(w, 'sqlite/model.glb', Buffer.from('glb-binary-bytes-here-0123456789'), 'model/gltf-binary');
    w.close();
  });

  after(async () => {
    await cleanupStore();
    await teardownTestEnv(db);
  });

  it('serves a JSON asset from SQLite with immutable cache + ETag', async () => {
    const res = await supertest(app).get('/api/v1/assets3d/sqlite/tileset.json').expect(200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.match(res.headers['cache-control'], /immutable/);
    assert.ok(res.headers['etag']);
    assert.deepEqual(JSON.parse(res.text), { asset: { version: '1.0' }, root: {} });
  });

  it('304s on a matching If-None-Match (no BLOB read)', async () => {
    const first = await supertest(app).get('/api/v1/assets3d/sqlite/tileset.json').expect(200);
    await supertest(app)
      .get('/api/v1/assets3d/sqlite/tileset.json')
      .set('If-None-Match', first.headers['etag'])
      .expect(304);
  });

  it('serves a Range (206) and rejects an invalid one (416) from SQLite', async () => {
    const ranged = await supertest(app)
      .get('/api/v1/assets3d/sqlite/model.glb')
      .set('Range', 'bytes=0-9')
      .expect(206);
    assert.match(ranged.headers['content-range'], /^bytes 0-9\/\d+$/);
    assert.equal(ranged.headers['content-length'], '10');
    assert.equal(ranged.headers['content-type'], 'model/gltf-binary');

    const bad = await supertest(app)
      .get('/api/v1/assets3d/sqlite/model.glb')
      .set('Range', 'bytes=999999-')
      .expect(416);
    assert.match(bad.headers['content-range'], /^bytes \*\/\d+$/);
  });

  it('falls back to the filesystem for assets not in SQLite (404 when neither has it)', async () => {
    await supertest(app).get('/api/v1/assets3d/sqlite/missing.json').expect(404);
  });
});

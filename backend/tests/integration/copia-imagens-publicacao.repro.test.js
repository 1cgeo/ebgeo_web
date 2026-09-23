// Path: tests/integration/copia-imagens-publicacao.repro.test.js
// A failed file copy must not publish a successful atlas/map with broken images.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

describe('image copies are complete before their entities become visible', () => {
  let app, db, owner, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    owner = await createUser(db);
    token = await loginUser(app, owner.username, owner.password);
  });
  after(async () => { await teardownTestEnv(db); });

  async function source() {
    const atlas = await createAtlas(db, owner.id);
    const map = await createMap(db, atlas.id);
    const id = randomUUID();
    const uploaded = await supertest(app).post(`/api/v1/atlas/${atlas.id}/images/bulk`)
      .set('Authorization', `Bearer ${token}`).send({ images: [{ localId: id,
        filename: 'keep.png', mimeType: 'image/png', data: PNG.toString('base64') }] }).expect(201);
    assert.deepEqual(uploaded.body.data.failed, []);
    await db.query(`INSERT INTO features (id, map_id, feature_type, geometry, properties)
      VALUES ($1, $2, 'image', $3::jsonb, $4::jsonb)`, [id, map.id,
      JSON.stringify({ type: 'Point', coordinates: [-43, -22] }), JSON.stringify({ id, nome: 'Original' })]);
    const { rows } = await db.query('SELECT * FROM images WHERE id=$1', [id]);
    return { atlas, map, image: rows[0] };
  }

  async function counts() {
    return (await db.query(`SELECT (SELECT count(*) FROM atlas) AS atlas,
      (SELECT count(*) FROM maps) AS maps, (SELECT count(*) FROM images) AS images,
      (SELECT count(*) FROM features) AS features, (SELECT count(*) FROM operations) AS operations`)).rows[0];
  }

  for (const kind of ['atlas', 'map']) {
    it(`${kind}: no SQL entity is visible while its image copy is still in flight`, { timeout: 15000 }, async () => {
      const original = await source();
      const beforeCounts = await counts();
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const copyFile = fs.promises.copyFile;
      let copiedPath;
      fs.promises.copyFile = async (...args) => {
        const result = await copyFile(...args);
        if (args[0] === original.image.storage_path) {
          copiedPath = args[1];
          entered.resolve();
          await release.promise;
        }
        return result;
      };
      syncBuiltinESMExports();
      let pending;
      try {
        const route = kind === 'atlas' ? `/api/v1/atlas/${original.atlas.id}/clone`
          : `/api/v1/atlas/${original.atlas.id}/maps/${original.map.id}/duplicate`;
        pending = supertest(app).post(route).set('Authorization', `Bearer ${token}`).send({}).then(result => result);
        await entered.promise;
        assert.deepEqual(await counts(), beforeCounts, 'pending bytes are not published as finished data');
        release.resolve();
        const response = await pending;
        assert.equal(response.status, 201);
        assert.deepEqual(await fs.promises.readFile(copiedPath), PNG);
        const { rows } = await db.query('SELECT id, atlas_id FROM images WHERE storage_path=$1', [copiedPath]);
        assert.equal(rows.length, 1);
        const download = await supertest(app).get(`/api/v1/atlas/${rows[0].atlas_id}/images/${rows[0].id}`)
          .set('Authorization', `Bearer ${token}`).expect(200);
        assert.deepEqual(download.body, PNG);
      } finally {
        release.resolve();
        await pending;
        fs.promises.copyFile = copyFile;
        syncBuiltinESMExports();
      }
    });

    it(`${kind}: source changes during staging roll back SQL and remove the private staged file`, { timeout: 15000 }, async () => {
      const original = await source();
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const copyFile = fs.promises.copyFile;
      let copiedPath;
      fs.promises.copyFile = async (...args) => {
        const result = await copyFile(...args);
        if (args[0] === original.image.storage_path) {
          copiedPath = args[1];
          entered.resolve();
          await release.promise;
        }
        return result;
      };
      syncBuiltinESMExports();
      let pending;
      try {
        const route = kind === 'atlas' ? `/api/v1/atlas/${original.atlas.id}/clone`
          : `/api/v1/atlas/${original.atlas.id}/maps/${original.map.id}/duplicate`;
        pending = supertest(app).post(route).set('Authorization', `Bearer ${token}`).send({}).then(result => result);
        await entered.promise;
        const id = randomUUID();
        await supertest(app).post(`/api/v1/atlas/${original.atlas.id}/images/bulk`)
          .set('Authorization', `Bearer ${token}`).send({ images: [{ localId: id,
            filename: 'later.png', mimeType: 'image/png', data: PNG.toString('base64') }] }).expect(201);
        await db.query(`INSERT INTO features (id, map_id, feature_type, geometry, properties)
          VALUES ($1, $2, 'image', $3::jsonb, $4::jsonb)`, [id, original.map.id,
          JSON.stringify({ type: 'Point', coordinates: [-43, -22] }), JSON.stringify({ id, nome: 'Later' })]);
        const changedCounts = await counts();
        release.resolve();
        const response = await pending;
        assert.equal(response.status, 409);
        assert.deepEqual(await counts(), changedCounts, 'only the source edit survives');
        await assert.rejects(fs.promises.readFile(copiedPath), { code: 'ENOENT' });
        assert.deepEqual(await fs.promises.readFile(original.image.storage_path), PNG);
      } finally {
        release.resolve();
        await pending;
        fs.promises.copyFile = copyFile;
        syncBuiltinESMExports();
      }
    });

    it(`${kind}: full disk leaves the source intact and publishes no incomplete copy`, async () => {
      const original = await source();
      const beforeCounts = await counts();
      const copyFile = fs.promises.copyFile;
      let attempted = 0;
      fs.promises.copyFile = async (...args) => {
        if (args[0] === original.image.storage_path) {
          attempted += 1;
          throw Object.assign(new Error('Injected full disk'), { code: 'ENOSPC' });
        }
        return copyFile(...args);
      };
      syncBuiltinESMExports();
      try {
        const route = kind === 'atlas' ? `/api/v1/atlas/${original.atlas.id}/clone`
          : `/api/v1/atlas/${original.atlas.id}/maps/${original.map.id}/duplicate`;
        const response = await supertest(app).post(route).set('Authorization', `Bearer ${token}`).send({});
        assert.equal(attempted, 1, 'the real copy path reached the injected disk failure');
        assert.equal(response.status, 503);
        assert.equal(JSON.stringify(response.body).includes(original.image.storage_path), false);
        assert.deepEqual(await counts(), beforeCounts);
        const download = await supertest(app).get(`/api/v1/atlas/${original.atlas.id}/images/${original.image.id}`)
          .set('Authorization', `Bearer ${token}`).expect(200);
        assert.deepEqual(download.body, PNG);
      } finally {
        fs.promises.copyFile = copyFile;
        syncBuiltinESMExports();
      }
    });
  }
});

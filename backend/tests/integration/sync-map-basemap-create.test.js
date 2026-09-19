// Path: tests/integration/sync-map-basemap-create.test.js
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

describe('map creation preserves an accessible base layer', () => {
  let app, db, token, atlas, originalAccess;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    const user = await createUser(db);
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    originalAccess = (await db.query("SELECT access_level FROM basemaps WHERE id='carta-topografica'")).rows[0].access_level;
    await db.query("UPDATE basemaps SET access_level='private' WHERE id='carta-topografica'");
  });
  after(async () => {
    await db.query("UPDATE basemaps SET access_level=$1 WHERE id='carta-topografica'", [originalAccess]);
    await teardownTestEnv(db);
  });

  async function create(data) {
    const id = randomUUID();
    const res = await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`).send({ operations: [{
        protocolVersion: 2, id: randomUUID(), entityType: 'map', operationType: 'create',
        entityId: id, data: { name: 'Mapa novo', ...data }, timestamp: Date.now(), clientId: 'basemap-create',
      }] }).expect(200);
    const row = (await db.query('SELECT base_layer FROM maps WHERE id=$1', [id])).rows[0];
    return { result: res.body.data.results[0], row };
  }

  for (const field of ['baseLayer', 'base_layer']) {
    it(`persists the authorized ${field} instead of silently restoring the private default`, async () => {
      const { result, row } = await create({ [field]: 'osm' });
      assert.equal(result.success, true);
      assert.equal(row.base_layer, 'osm');
    });

    it(`still refuses an explicit inaccessible ${field}`, async () => {
      const { result, row } = await create({ [field]: 'carta-topografica' });
      assert.equal(result.success, false);
      assert.match(result.reason, /camada de base/);
      assert.equal(row, undefined);
    });
  }

  for (const data of [{ baseLayer: '' }, { base_layer: '' }, {}]) {
    it(`does not inject an unauthorized implicit base: ${JSON.stringify(data)}`, async () => {
      const { result, row } = await create(data);
      assert.equal(result.success, true);
      assert.equal(row.base_layer, '');
    });
  }
});

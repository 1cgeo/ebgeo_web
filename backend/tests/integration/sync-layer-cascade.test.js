// Path: tests/integration/sync-layer-cascade.test.js
// §2.2 "Deletar camada (e todas as feições)": deleting a layer via sync must
// soft-delete all of that layer's features in the SAME transaction, leaving other
// layers and their features untouched, and the snapshot must omit them.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, loginUser } from '../helpers/fixtures.js';

describe('Sync layer-delete cascade (§2.2)', () => {
  let app, db, user, token, atlas, map, layerA, layerB, fA1, fA2, fB1;

  async function featureWithLayer(mapId, layerId) {
    const { rows } = await db.query(
      `INSERT INTO features (map_id, feature_type, geometry, properties, layer_id)
       VALUES ($1, 'point', '{"type":"Point","coordinates":[0,0]}'::jsonb, '{"source":"point"}'::jsonb, $2)
       RETURNING *`,
      [mapId, layerId]
    );
    return rows[0];
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'cascade_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    layerA = await createLayer(db, map.id);
    layerB = await createLayer(db, map.id);
    fA1 = await featureWithLayer(map.id, layerA.id);
    fA2 = await featureWithLayer(map.id, layerA.id);
    fB1 = await featureWithLayer(map.id, layerB.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const deletedAt = async (table, id) =>
    (await db.query(`SELECT deleted_at FROM ${table} WHERE id = $1`, [id])).rows[0].deleted_at;

  it('deleting a layer cascades to its features, atomically, leaving other layers intact', async () => {
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [{
        id: randomUUID(), entityType: 'layer', operationType: 'delete',
        entityId: layerA.id, mapId: map.id, timestamp: Date.now(), clientId: 'c',
      }] })
      .expect(200);

    assert.ok(await deletedAt('layers', layerA.id), 'layer A soft-deleted');
    assert.ok(await deletedAt('features', fA1.id), 'feature A1 cascade-deleted');
    assert.ok(await deletedAt('features', fA2.id), 'feature A2 cascade-deleted');
    assert.equal(await deletedAt('layers', layerB.id), null, 'layer B untouched');
    assert.equal(await deletedAt('features', fB1.id), null, 'feature B1 untouched');
  });

  it('the snapshot omits the deleted layer and its features but keeps the others', async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const snapMap = res.body.data.snapshot.maps.find((m) => m.id === map.id);
    const layerIds = snapMap.layers.map((l) => l.id);
    assert.ok(!layerIds.includes(layerA.id), 'deleted layer absent from snapshot');
    assert.ok(layerIds.includes(layerB.id), 'surviving layer present');

    const pointIds = snapMap.features.points.map((f) => f.properties.id);
    assert.ok(!pointIds.includes(fA1.id) && !pointIds.includes(fA2.id), 'cascade-deleted features absent');
    assert.ok(pointIds.includes(fB1.id), 'surviving feature present');
  });
});

// Path: tests/integration/sync-feature-map-move.test.js
// Integration tests for moving features between maps and duplicating maps

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature, createLayer, loginUser } from '../helpers/fixtures.js';

describe('Feature Map Move & Duplicate Map', () => {
  let app, db, user, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: `move_dup_${randomUUID().slice(0, 6)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function pushSync(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });
  }

  async function getSnapshot() {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot;
  }

  // ---------------------------------------------------------------------------
  // Feature map_id move tests
  // ---------------------------------------------------------------------------

  describe('Move feature between maps via sync update', () => {
    it('moves feature to another map via sync update', async () => {
      const map1 = await createMap(db, atlas.id);
      const map2 = await createMap(db, atlas.id);
      const feature = await createFeature(db, map1.id, {
        feature_type: 'point',
        geometry: { coordinates: [-43.2, -22.9] },
        properties: { name: 'Movable Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map1.id,
        changes: { map_id: map2.id },
        timestamp: Date.now(),
        clientId: 'move-client',
      }]).expect(200);

      // Verify in DB that the feature's map_id is now map2.id
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].map_id, map2.id);
    });

    it('moved feature appears in destination map snapshot, not in source', async () => {
      const map1 = await createMap(db, atlas.id);
      const map2 = await createMap(db, atlas.id);

      // Create feature via sync in map1
      const featureId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId: featureId,
        mapId: map1.id,
        data: {
          feature_type: 'point',
          geometry: { coordinates: [-43.1, -22.8] },
          properties: { name: 'Snapshot Move Point' },
        },
        timestamp: Date.now(),
        clientId: 'move-client',
      }]).expect(200);

      // Move it to map2 via sync update
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: featureId,
        mapId: map1.id,
        changes: { map_id: map2.id },
        timestamp: Date.now() + 1,
        clientId: 'move-client',
      }]).expect(200);

      // Get snapshot
      const snapshot = await getSnapshot();

      // Feature should NOT be in map1's features
      const map1Data = snapshot.maps.find(m => m.id === map1.id);
      assert.ok(map1Data, 'map1 should exist in snapshot');
      const map1FeatureIds = Object.values(map1Data.features)
        .flat()
        .map(f => f.properties.id);
      assert.ok(!map1FeatureIds.includes(featureId), 'feature should NOT be in map1');

      // Feature should BE in map2's features
      const map2Data = snapshot.maps.find(m => m.id === map2.id);
      assert.ok(map2Data, 'map2 should exist in snapshot');
      const map2FeatureIds = Object.values(map2Data.features)
        .flat()
        .map(f => f.properties.id);
      assert.ok(map2FeatureIds.includes(featureId), 'feature should be in map2');
    });

    it('moves feature with layer_id change in same operation', async () => {
      const map1 = await createMap(db, atlas.id);
      const map2 = await createMap(db, atlas.id);
      const layer1 = await createLayer(db, map1.id, { name: 'Layer in map1' });
      const layer2 = await createLayer(db, map2.id, { name: 'Layer in map2' });

      const feature = await createFeature(db, map1.id, {
        feature_type: 'point',
        geometry: { coordinates: [-43.0, -22.7] },
        properties: { name: 'Move with layer' },
      });

      // Assign layer1 to feature
      await db.query('UPDATE features SET layer_id = $1 WHERE id = $2', [layer1.id, feature.id]);

      // Move to map2 AND change layer_id to layer2 in one operation
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map1.id,
        changes: {
          map_id: map2.id,
          layer_id: layer2.id,
        },
        timestamp: Date.now(),
        clientId: 'move-client',
      }]).expect(200);

      // Verify both map_id and layer_id changed
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].map_id, map2.id);
      assert.equal(rows[0].layer_id, layer2.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Duplicate map tests
  // ---------------------------------------------------------------------------

  describe('POST /atlas/:atlasId/maps/:mapId/duplicate', () => {
    it('duplicates a map with all sub-entities', async () => {
      const map = await createMap(db, atlas.id, { name: 'Original Map' });
      const layer = await createLayer(db, map.id, { name: 'Test Layer' });
      await createFeature(db, map.id, {
        feature_type: 'point',
        geometry: { coordinates: [-43.2, -22.9] },
        properties: { name: 'Feature 1' },
      });
      await createFeature(db, map.id, {
        feature_type: 'line',
        geometry: { coordinates: [[-43.1, -22.8], [-43.0, -22.7]] },
        properties: { name: 'Feature 2' },
      });

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const newMap = res.body.data;

      // New map has different ID but name ending in "(cópia)"
      assert.ok(newMap.id);
      assert.notEqual(newMap.id, map.id);
      assert.ok(newMap.name.endsWith('(cópia)'), `name should end with "(cópia)", got "${newMap.name}"`);

      // Verify the new map exists in DB with same core fields
      const { rows: mapRows } = await db.query('SELECT * FROM maps WHERE id = $1', [newMap.id]);
      assert.equal(mapRows.length, 1);
      assert.equal(mapRows[0].center_lat, map.center_lat);
      assert.equal(mapRows[0].center_long, map.center_long);
      assert.equal(mapRows[0].zoom, map.zoom);

      // Verify the new map has cloned features (same count)
      const { rows: origFeatures } = await db.query(
        'SELECT count(*)::int AS cnt FROM features WHERE map_id = $1 AND deleted_at IS NULL', [map.id]
      );
      const { rows: newFeatures } = await db.query(
        'SELECT count(*)::int AS cnt FROM features WHERE map_id = $1 AND deleted_at IS NULL', [newMap.id]
      );
      assert.equal(newFeatures[0].cnt, origFeatures[0].cnt);
      assert.ok(newFeatures[0].cnt >= 2, 'should have at least 2 cloned features');

      // Verify the new map has cloned layers (same count)
      const { rows: origLayers } = await db.query(
        'SELECT count(*)::int AS cnt FROM layers WHERE map_id = $1 AND deleted_at IS NULL', [map.id]
      );
      const { rows: newLayers } = await db.query(
        'SELECT count(*)::int AS cnt FROM layers WHERE map_id = $1 AND deleted_at IS NULL', [newMap.id]
      );
      assert.equal(newLayers[0].cnt, origLayers[0].cnt);
      assert.ok(newLayers[0].cnt >= 1, 'should have at least 1 cloned layer');
    });

    it('duplicate map appends to map_order', async () => {
      const map = await createMap(db, atlas.id, { name: 'Order Test Map' });

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${map.id}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const newMapId = res.body.data.id;

      // Check atlas map_order contains both the original and the new map
      const { rows } = await db.query('SELECT map_order FROM atlas WHERE id = $1', [atlas.id]);
      const mapOrder = rows[0].map_order;
      assert.ok(mapOrder.includes(map.id), 'map_order should contain original map');
      assert.ok(mapOrder.includes(newMapId), 'map_order should contain duplicated map');
    });

    it('duplicate map returns 404 for non-existent map', async () => {
      const fakeMapId = randomUUID();

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/maps/${fakeMapId}/duplicate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});

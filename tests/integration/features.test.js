// Path: tests/integration/features.test.js
// Integration tests for Features via Sync API
// All feature operations (create, update, delete) are managed via POST /atlas/:id/sync

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature, loginUser } from '../helpers/fixtures.js';

describe('Features via Sync API', () => {
  let app, db, user, token, atlasId, mapId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db);
    token = await loginUser(app, user.username, user.password);
    const atlas = await createAtlas(db, user.id);
    const map = await createMap(db, atlas.id);
    atlasId = atlas.id;
    mapId = map.id;
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Create Features via Sync', () => {
    it('creates a point feature', async () => {
      const targetId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: targetId,
            mapId: mapId,
            data: {
              feature_type: 'point',
              geometry: { coordinates: [-43.2, -22.9] },
              properties: { name: 'HQ', color: '#ff0000' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
      assert.equal(res.body.data.acks.length, 1);

      // Verify feature was created
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].geometry, { coordinates: [-43.2, -22.9] });
      assert.equal(rows[0].properties.name, 'HQ');
      assert.equal(rows[0].feature_type, 'point');
    });

    // Regression: a feature in the implicit "default" layer must sync. The real
    // frontend GeoJSON carries the type + layer in `properties` (source / layerId),
    // and 'default' is a NON-UUID sentinel for the implicit layer. features.layer_id
    // is a UUID column, so without coercion the INSERT 22P02'd and rejected the WHOLE
    // push batch — blocking all sync for anyone drawing into the default layer. (The
    // numeric top-level GeoJSON `id` must also be ignored: the row id is the targetId.)
    it('accepts a feature in the implicit "default" layer (non-UUID layerId → layer_id null)', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId,
            mapId,
            data: {
              type: 'Feature',
              id: 1782053337250, // MapLibre's numeric top-level id — must NOT become the row id
              geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
              properties: { id: targetId, source: 'line', layerId: 'default', nome: 'Eixo' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1, 'the default-layer feature was persisted');
      assert.equal(rows[0].layer_id, null, "non-UUID 'default' layerId coerced to null");
      assert.equal(rows[0].feature_type, 'line', 'feature_type derived from properties.source');
      assert.equal(rows[0].properties.layerId, 'default', 'layerId preserved verbatim in the properties JSONB');
    });

    it('keeps a real UUID layerId on the feature row', async () => {
      const targetId = randomUUID();
      const layerId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(), type: 'create', target: 'feature', targetId, mapId,
            data: { geometry: { coordinates: [-43, -22] }, properties: { id: targetId, source: 'point', layerId } },
            timestamp: Date.now(), clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT layer_id FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].layer_id, layerId, 'a real UUID layerId is preserved on the row');
    });

    it('creates a polygon feature', async () => {
      const targetId = randomUUID();
      const coords = [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]];

      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: targetId,
            mapId: mapId,
            data: {
              feature_type: 'polygon',
              geometry: { coordinates: coords },
              properties: { name: 'Area', fillColor: '#00ff00' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.deepEqual(rows[0].geometry.coordinates, coords);
      assert.equal(rows[0].feature_type, 'polygon');
    });

    it('creates a circle feature (center + radius)', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: targetId,
            mapId: mapId,
            data: {
              feature_type: 'circle',
              geometry: { center: [-43.2, -22.9], radius: 500 },
              properties: { name: 'Defense Perimeter' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.deepEqual(rows[0].geometry.center, [-43.2, -22.9]);
      assert.equal(rows[0].geometry.radius, 500);
    });

    it('creates a line feature', async () => {
      const targetId = randomUUID();
      const coords = [[-43.1, -22.8], [-43.0, -22.7], [-42.9, -22.8]];

      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: targetId,
            mapId: mapId,
            data: {
              feature_type: 'line',
              geometry: { coordinates: coords },
              properties: { name: 'Route' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'line');
    });

    it('creates a rectangle feature', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: targetId,
            mapId: mapId,
            data: {
              feature_type: 'rectangle',
              geometry: { bounds: [[-43.3, -22.9], [-43.2, -22.8]] },
              properties: { name: 'Zone' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'rectangle');
    });

    it('creates a text feature', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: targetId,
            mapId: mapId,
            data: {
              feature_type: 'text',
              geometry: { coordinates: [-43.2, -22.9] },
              properties: { text: 'Label Text', fontSize: 14 },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'text');
      assert.equal(rows[0].properties.text, 'Label Text');
    });

    it('creates multiple features in batch', async () => {
      const ops = [];
      for (let i = 0; i < 3; i++) {
        ops.push({
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: mapId,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [-43 + i * 0.1, -22.9] },
            properties: { batch: true, index: i },
          },
          timestamp: Date.now() + i,
          clientId: 'batch-client',
        });
      }

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({ operations: ops })
        .expect(200);

      assert.equal(res.body.data.acks.length, 3);
    });
  });

  describe('Update Features via Sync', () => {
    let featureId;

    before(async () => {
      // Create a feature to update
      const feature = await createFeature(db, mapId, {
        feature_type: 'point',
        geometry: { coordinates: [0, 0] },
        properties: { name: 'Original', color: '#000000' },
      });
      featureId = feature.id;
    });

    it('updates feature geometry', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'feature',
            targetId: featureId,
            mapId: mapId,
            changes: {
              geometry: { coordinates: [10, 10] },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [featureId]);
      assert.deepEqual(rows[0].geometry.coordinates, [10, 10]);
    });

    it('updates feature properties', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'feature',
            targetId: featureId,
            mapId: mapId,
            changes: {
              properties: { name: 'Updated', color: '#ff0000', newProp: 'new' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [featureId]);
      assert.equal(rows[0].properties.name, 'Updated');
      assert.equal(rows[0].properties.newProp, 'new');
    });

    it('updates feature layer_id', async () => {
      // Create a layer
      const layerId = randomUUID();
      await db.query(
        `INSERT INTO layers (id, map_id, name, visible) VALUES ($1, $2, 'Test Layer', true)`,
        [layerId, mapId]
      );

      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'feature',
            targetId: featureId,
            mapId: mapId,
            changes: {
              layer_id: layerId,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [featureId]);
      assert.equal(rows[0].layer_id, layerId);
    });
  });

  describe('Delete Features via Sync', () => {
    it('soft-deletes a feature', async () => {
      // Create a feature to delete
      const feature = await createFeature(db, mapId);

      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'delete',
            target: 'feature',
            targetId: feature.id,
            mapId: mapId,
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify soft-delete
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.ok(rows[0].deleted_at);
    });
  });

  describe('Features in Snapshot', () => {
    before(async () => {
      // Create some features
      for (let i = 0; i < 3; i++) {
        await createFeature(db, mapId, {
          feature_type: 'point',
          geometry: { coordinates: [i, i] },
          properties: { snapshot: true, index: i },
        });
      }
    });

    it('features are included in sync snapshot organized by type', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlasId}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, true);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === mapId);
      assert.ok(mapData);
      // Features is an object organized by type (points, lines, polygons, etc.)
      assert.ok(typeof mapData.features === 'object' && !Array.isArray(mapData.features));
      assert.ok(Array.isArray(mapData.features.points));

      // Count total features across all types
      const totalFeatures = Object.values(mapData.features).reduce(
        (sum, arr) => sum + arr.length, 0
      );
      assert.ok(totalFeatures >= 3);

      // Check GeoJSON Feature structure
      const point = mapData.features.points[0];
      assert.ok(point);
      assert.equal(point.type, 'Feature');
      assert.ok(point.geometry);
      assert.ok(point.properties);
      assert.ok(point.properties.id, 'properties should include feature id');
      assert.ok(point.properties.source, 'properties should include source (feature_type)');
    });

    it('deleted features are NOT included in snapshot', async () => {
      // Create and delete a feature
      const feature = await createFeature(db, mapId, {
        feature_type: 'point',
        properties: { toBeDeleted: true },
      });

      await db.query('UPDATE features SET deleted_at = NOW() WHERE id = $1', [feature.id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlasId}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === mapId);
      // Check across all feature type collections
      const allFeatureIds = Object.values(mapData.features)
        .flat()
        .map(f => f.properties.id);
      assert.ok(!allFeatureIds.includes(feature.id));
    });
  });
});

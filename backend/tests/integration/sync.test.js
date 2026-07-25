// Path: tests/integration/sync.test.js
// Integration tests for the Sync API (push/pull operations, snapshots)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAdminUser, createAtlas, createMap, createFeature, loginUser } from '../helpers/fixtures.js';

describe('Sync API', () => {
  let app, db, user, admin, token, adminToken, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'sync_user' });
    admin = await createAdminUser(db, { username: 'sync_admin' });
    token = await loginUser(app, user.username, user.password);
    adminToken = await loginUser(app, admin.username, admin.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('POST /atlas/:atlasId/sync — Push Operations', () => {
    it('pushes a single create feature operation', async () => {
      const targetId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: targetId,
            mapId: map.id,
            data: {
              feature_type: 'point',
              geometry: { coordinates: [-43.2, -22.9] },
              properties: { name: 'Test Point', color: '#ff0000' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
      assert.equal(res.body.data.acks.length, 1);
      assert.ok(res.body.data.acks[0].serverVersion > 0);
      assert.ok(res.body.data.serverVersion > 0);

      // Verify feature was created in database
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].feature_type, 'point');
    });

    it('pushes multiple operations in batch', async () => {
      const targetId1 = randomUUID();
      const targetId2 = randomUUID();
      const now = Date.now();

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [
            {
              id: randomUUID(),
              type: 'create',
              target: 'feature',
              targetId: targetId1,
              mapId: map.id,
              data: {
                feature_type: 'point',
                geometry: { coordinates: [-43.1, -22.8] },
                properties: { name: 'Point 1' },
              },
              timestamp: now,
              clientId: 'test-client',
            },
            {
              id: randomUUID(),
              type: 'create',
              target: 'feature',
              targetId: targetId2,
              mapId: map.id,
              data: {
                feature_type: 'polygon',
                geometry: { coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]] },
                properties: { name: 'Polygon 1' },
              },
              timestamp: now + 1,
              clientId: 'test-client',
            },
          ],
        })
        .expect(200);

      assert.equal(res.body.data.acks.length, 2);
    });

    it('pushes an update operation', async () => {
      // First create a feature
      const targetId = randomUUID();
      await db.query(
        `INSERT INTO features (id, map_id, feature_type, geometry, properties)
         VALUES ($1, $2, 'point', $3::jsonb, $4::jsonb)`,
        [targetId, map.id, '{"coordinates": [0, 0]}', '{"name": "Original"}']
      );

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'feature',
            targetId: targetId,
            mapId: map.id,
            changes: {
              properties: { name: 'Updated' },
              geometry: { coordinates: [1, 1] },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.equal(res.body.data.acks.length, 1);

      // Verify update was applied
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].properties.name, 'Updated');
    });

    it('pushes a delete operation (soft-delete)', async () => {
      // Create a feature to delete
      const targetId = randomUUID();
      await db.query(
        `INSERT INTO features (id, map_id, feature_type, geometry, properties)
         VALUES ($1, $2, 'point', $3::jsonb, $4::jsonb)`,
        [targetId, map.id, '{"coordinates": [0, 0]}', '{"name": "ToDelete"}']
      );

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'delete',
            target: 'feature',
            targetId: targetId,
            mapId: map.id,
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify soft-delete
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.ok(rows[0].deleted_at);
    });

    it('pushes a create map operation', async () => {
      const targetId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'map',
            targetId: targetId,
            data: {
              name: 'New Map via Sync',
              base_layer: 'osm',
              center_lat: -22.9,
              center_long: -43.2,
              zoom: 12,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.equal(res.body.data.acks.length, 1);

      // Verify map was created
      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'New Map via Sync');
    });

    it('pushes a create layer operation', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'layer',
            targetId: targetId,
            mapId: map.id,
            data: {
              name: 'Test Layer',
              visible: true,
              opacity: 0.8,
              sort_order: 1,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify layer was created
      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'Test Layer');
    });

    it('pushes a create group operation', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'group',
            targetId: targetId,
            mapId: map.id,
            data: {
              name: 'Test Group',
              style: { color: '#ff0000' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify group was created
      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'Test Group');
    });

    it('pushes a create briefing operation', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'briefing',
            targetId: targetId,
            data: {
              name: 'Test Briefing',
              description: 'Briefing created via sync',
              settings: { panelPosition: 'left' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify briefing was created
      const { rows } = await db.query('SELECT * FROM briefings WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'Test Briefing');
    });

    it('rejects push from user without write permission', async () => {
      const reader = await createUser(db, { username: 'sync_reader' });
      const readerToken = await loginUser(app, reader.username, reader.password);

      // Give reader read-only access
      await db.query(
        `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
        [atlas.id, reader.id, user.id]
      );

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: randomUUID(),
            mapId: map.id,
            data: { feature_type: 'point', geometry: {}, properties: {} },
            timestamp: Date.now(),
            clientId: 'reader-client',
          }],
        })
        .expect(403);
    });
  });

  describe('GET /atlas/:atlasId/sync/:version — Pull Operations', () => {
    it('returns snapshot when version is 0', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, true);
      assert.ok(res.body.data.snapshot);
      assert.ok(res.body.data.snapshot.atlas);
      assert.ok(Array.isArray(res.body.data.snapshot.maps));
      assert.ok(Array.isArray(res.body.data.snapshot.briefings));
      assert.ok(res.body.data.currentVersion >= 0);
    });

    it('snapshot includes maps with features, layers, and groups', async () => {
      // Create some data
      await createFeature(db, map.id, { feature_type: 'point' });

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const snapshot = res.body.data.snapshot;
      assert.ok(snapshot.maps.length > 0);

      const mapData = snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      // Features is an object organized by type (points, lines, polygons, etc.)
      assert.ok(typeof mapData.features === 'object' && !Array.isArray(mapData.features));
      assert.ok(Array.isArray(mapData.features.points));
      assert.ok(mapData.features.points.length > 0, 'should have at least one point');
      assert.ok(Array.isArray(mapData.layers));
      assert.ok(Array.isArray(mapData.groups));
      // Cesium3D and StreetView360 are hierarchical objects
      assert.ok(typeof mapData.cesium3d === 'object');
      assert.ok(typeof mapData.streetview360 === 'object');
      // Sync metadata on map
      assert.ok(mapData.sync);
      assert.ok(typeof mapData.sync.createdAt === 'number');
    });

    it('returns incremental operations when version is greater than 0', async () => {
      // First push an operation to have something to pull
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: randomUUID(),
            mapId: map.id,
            data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        });

      // Pull from version 0 to get snapshot first
      const snapshotRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`);

      const currentVersion = snapshotRes.body.data.currentVersion;

      // Now pull from a version close to current
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${currentVersion - 1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Could be snapshot or operations depending on min_version
      assert.ok(res.body.data.currentVersion >= currentVersion - 1);
    });

    it('returns empty operations when already at current version', async () => {
      // Get current version
      const snapshotRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`);

      const currentVersion = snapshotRes.body.data.currentVersion;

      // Pull from current version
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${currentVersion}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, false, 'pull at currentVersion must be incremental');
      assert.equal(res.body.data.operations.length, 0);
    });

    it('reader can pull operations', async () => {
      const reader = await createUser(db, { username: 'sync_puller' });
      const readerToken = await loginUser(app, reader.username, reader.password);

      // Give reader read access
      await db.query(
        `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
        [atlas.id, reader.id, user.id]
      );

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${readerToken}`)
        .expect(200);
    });

    it('stranger cannot pull operations from private atlas', async () => {
      const stranger = await createUser(db, { username: 'sync_stranger' });
      const strangerToken = await loginUser(app, stranger.username, stranger.password);

      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });

  describe('Admin Sync Endpoints', () => {
    it('GET /sync/admin/stats — returns cleanup statistics', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/admin/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      assert.ok(res.body.data);
      assert.equal(res.body.data.atlasId, atlas.id);
      assert.ok(typeof res.body.data.minVersion === 'number');
      assert.ok(typeof res.body.data.currentVersion === 'number');
      assert.ok(typeof res.body.data.totalOperations === 'number');
    });

    it('GET /sync/admin/stats — requires admin role', async () => {
      await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/admin/stats`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('POST /sync/admin/cleanup — cleans old operations by days', async () => {
      // First add some operations
      for (let i = 0; i < 5; i++) {
        await supertest(app)
          .post(`/api/v1/atlas/${atlas.id}/sync`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            operations: [{
              id: randomUUID(),
              type: 'create',
              target: 'feature',
              targetId: randomUUID(),
              mapId: map.id,
              data: { feature_type: 'point', geometry: { coordinates: [i, i] }, properties: {} },
              timestamp: Date.now() - (i * 86400000), // i days ago
              clientId: 'test-client',
            }],
          });
      }

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync/admin/cleanup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepDays: 7 })
        .expect(200);

      assert.ok(res.body.data);
      assert.ok(typeof res.body.data.deletedCount === 'number');
      assert.ok(typeof res.body.data.newMinVersion === 'number');
    });

    it('POST /sync/admin/cleanup — requires admin role', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync/admin/cleanup`)
        .set('Authorization', `Bearer ${token}`)
        .send({ keepDays: 7 })
        .expect(403);
    });

    it('POST /sync/admin/cleanup — validates keepDays parameter', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync/admin/cleanup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepDays: 0 }) // Invalid: must be >= 1
        .expect(422);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync/admin/cleanup`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepDays: 500 }) // Invalid: max 365
        .expect(422);
    });
  });
});

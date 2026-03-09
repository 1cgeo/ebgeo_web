// Path: tests/integration/sync-map-ops.test.js
// Tests for map update/delete operations via Sync API
// Covers: §1 items 5,7,9,12,13 (lock, rename, delete, save/clear position)
// Also covers: map locked field in snapshot, base layer change (§13 item 2)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Map Operations via Sync', () => {
  let app, db, user, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'map_ops_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

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

  describe('Rename map (§1 item 7)', () => {
    it('renames map via sync update', async () => {
      const map = await createMap(db, atlas.id, { name: 'Original Map Name' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { name: 'Renamed Map' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].name, 'Renamed Map');
    });
  });

  describe('Lock/unlock map (§1 item 5)', () => {
    it('locks map via sync', async () => {
      const map = await createMap(db, atlas.id, { name: 'Map To Lock' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { locked: true },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].locked, true);
    });

    it('unlocks map via sync', async () => {
      const map = await createMap(db, atlas.id, { name: 'Locked Map', locked: true });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { locked: false },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].locked, false);
    });

    it('locked map shows locked=true in snapshot', async () => {
      const map = await createMap(db, atlas.id, { name: 'Locked In Snapshot' });
      // Set locked via sync since createMap fixture doesn't include locked column
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { locked: true },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const mapData = snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData, 'map should be in snapshot');
      assert.equal(mapData.locked, true);
    });
  });

  describe('Delete map (§1 item 9)', () => {
    it('soft-deletes map via sync', async () => {
      const map = await createMap(db, atlas.id, { name: 'Map To Delete' });

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'map',
        targetId: map.id,
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.ok(rows[0].deleted_at, 'map should be soft-deleted');
    });

    it('deleted map is excluded from snapshot', async () => {
      const mapId = randomUUID();
      const now = Date.now();

      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'map',
        targetId: mapId,
        data: { name: 'Temp Map To Delete' },
        timestamp: now,
        clientId: 'test-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'map',
        targetId: mapId,
        timestamp: now + 1,
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const found = snapshot.maps.find(m => m.id === mapId);
      assert.equal(found, undefined, 'deleted map should not appear in snapshot');
    });
  });

  describe('Update map direct fields via sync', () => {
    it('updates map center_lat and center_long', async () => {
      const map = await createMap(db, atlas.id, { name: 'Position Map' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { center_lat: -15.5, center_long: -47.8, zoom: 14 },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(Number(rows[0].center_lat), -15.5);
      assert.equal(Number(rows[0].center_long), -47.8);
      assert.equal(Number(rows[0].zoom), 14);
    });

    it('updates map bearing and pitch', async () => {
      const map = await createMap(db, atlas.id, { name: 'Bearing Map' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { bearing: 45.5, pitch: 30 },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(Number(rows[0].bearing), 45.5);
      assert.equal(Number(rows[0].pitch), 30);
    });

    it('updates map base_layer', async () => {
      const map = await createMap(db, atlas.id, { name: 'Base Layer Map' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { base_layer: 'satellite' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].base_layer, 'satellite');
    });

    it('updates map notes_title and notes_description', async () => {
      const map = await createMap(db, atlas.id, { name: 'Notes Map' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { notes_title: 'Map Notes Title', notes_description: '<p>Some HTML content</p>' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].notes_title, 'Map Notes Title');
      assert.equal(rows[0].notes_description, '<p>Some HTML content</p>');
    });

    it('updates map catalog_layers (JSONB)', async () => {
      const map = await createMap(db, atlas.id, { name: 'Catalog Map' });

      const catalogLayers = [{ id: 'wms-1', url: 'http://example.com/wms', visible: true }];

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { catalog_layers: catalogLayers },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.deepEqual(rows[0].catalog_layers, catalogLayers);
    });

    it('updates map analysis_layers (JSONB)', async () => {
      const map = await createMap(db, atlas.id, { name: 'Analysis Map' });

      const analysisLayers = { los_result_123: { visible: true, data: {} } };

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { analysis_layers: analysisLayers },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.deepEqual(rows[0].analysis_layers, analysisLayers);
    });
  });

  describe('Clear saved map position (§1 item 13)', () => {
    it('clears map position by nulling center/zoom and resetting bearing/pitch', async () => {
      const map = await createMap(db, atlas.id, {
        name: 'Clear Position Map',
        center_lat: -22.9,
        center_long: -43.2,
        zoom: 14,
        bearing: 45,
        pitch: 30,
      });

      // center_lat, center_long, zoom are nullable; bearing/pitch have NOT NULL DEFAULT 0
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { center_lat: null, center_long: null, zoom: null, bearing: 0, pitch: 0 },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].center_lat, null);
      assert.equal(rows[0].center_long, null);
      assert.equal(rows[0].zoom, null);
      assert.equal(Number(rows[0].bearing), 0);
      assert.equal(Number(rows[0].pitch), 0);
    });
  });

  describe('Remove catalog layers (§2 item 16)', () => {
    it('removes catalog layers by setting to empty array', async () => {
      const map = await createMap(db, atlas.id, { name: 'Catalog Remove Map' });

      // First add catalog layers
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { catalog_layers: [{ id: 'wms-1', url: 'http://example.com', visible: true }] },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      // Then remove all
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { catalog_layers: [] },
        timestamp: Date.now() + 1,
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.deepEqual(rows[0].catalog_layers, []);
    });
  });

  describe('Map snapshot fields', () => {
    it('snapshot includes all map fields (name, center, zoom, bearing, pitch, locked, base_layer)', async () => {
      const map = await createMap(db, atlas.id, {
        name: 'Full Fields Map',
        center_lat: -22.9,
        center_long: -43.2,
        zoom: 12,
        bearing: 10,
        pitch: 20,
      });
      // Set locked via sync since createMap fixture doesn't include locked column
      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'map',
        targetId: map.id,
        changes: { locked: true },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const mapData = snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      assert.equal(mapData.name, 'Full Fields Map');
      assert.equal(Number(mapData.center_lat), -22.9);
      assert.equal(Number(mapData.center_long), -43.2);
      assert.equal(Number(mapData.zoom), 12);
      assert.equal(Number(mapData.bearing), 10);
      assert.equal(Number(mapData.pitch), 20);
      assert.ok(mapData.base_layer, 'map should have base_layer');
      assert.equal(mapData.locked, true);
      assert.ok(mapData.sync, 'map should have sync metadata');
    });
  });

});

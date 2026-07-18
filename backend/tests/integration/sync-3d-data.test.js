// Path: tests/integration/sync-3d-data.test.js
// Integration tests for Cesium3D and StreetView360 data via Sync API

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAtlas,
  createMap,
  createCesium3dData,
  createStreetview360Data,
  loginUser,
} from '../helpers/fixtures.js';

describe('Cesium3D Data via Sync API', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'cesium3d_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Create Cesium3D Data via Sync', () => {
    it('creates a cesium3d marker via sync', async () => {
      const targetId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'cesium3d',
            targetId: targetId,
            mapId: map.id,
            data: {
              data_type: 'marker',
              tileset_id: 'PCL',
              data: {
                position: { longitude: -43.2, latitude: -22.9, height: 150 },
                properties: { name: 'Sync Marker', color: '#ff0000' },
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
      assert.equal(res.body.data.acks.length, 1);
      assert.ok(res.body.data.acks[0].serverVersion > 0);

      // Verify cesium3d data was created
      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].data_type, 'marker');
      assert.equal(rows[0].tileset_id, 'PCL');
      assert.equal(rows[0].data.position.height, 150);
    });

    it('creates a cesium3d measurement via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'cesium3d',
            targetId: targetId,
            mapId: map.id,
            data: {
              data_type: 'measurement',
              tileset_id: null,
              data: {
                start: { longitude: -43.2, latitude: -22.9, height: 0 },
                end: { longitude: -43.1, latitude: -22.8, height: 0 },
                distance: 15000,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [targetId]);
      assert.equal(rows[0].data_type, 'measurement');
      assert.equal(rows[0].data.distance, 15000);
    });

    it('creates a cesium3d viewshed via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'cesium3d',
            targetId: targetId,
            mapId: map.id,
            data: {
              data_type: 'viewshed',
              tileset_id: 'PCL',
              data: {
                observer: { longitude: -43.2, latitude: -22.9, height: 10 },
                radius: 5000,
                heading: 0,
                pitch: 0,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [targetId]);
      assert.equal(rows[0].data_type, 'viewshed');
    });

    it('creates a cesium3d camera_position via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'cesium3d',
            targetId: targetId,
            mapId: map.id,
            data: {
              data_type: 'camera_position',
              tileset_id: null,
              data: {
                position: { longitude: -43.2, latitude: -22.9, height: 5000 },
                orientation: { heading: 45, pitch: -30, roll: 0 },
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [targetId]);
      assert.equal(rows[0].data_type, 'camera_position');
    });
  });

  describe('Update Cesium3D Data via Sync', () => {
    let cesium3dId;

    before(async () => {
      const cesium3d = await createCesium3dData(db, map.id);
      cesium3dId = cesium3d.id;
    });

    it('updates cesium3d data property via sync', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'cesium3d',
            targetId: cesium3dId,
            mapId: map.id,
            changes: {
              data: {
                position: { longitude: -43.3, latitude: -22.8, height: 200 },
                properties: { name: 'Updated Marker' },
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [cesium3dId]);
      assert.equal(rows[0].data.position.height, 200);
      assert.equal(rows[0].data.properties.name, 'Updated Marker');
    });

    it('updates cesium3d tileset_id via sync', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'cesium3d',
            targetId: cesium3dId,
            mapId: map.id,
            changes: {
              tileset_id: 'NOVO_TILESET',
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [cesium3dId]);
      assert.equal(rows[0].tileset_id, 'NOVO_TILESET');
    });
  });

  describe('Delete Cesium3D Data via Sync', () => {
    it('soft-deletes cesium3d data via sync', async () => {
      const cesium3d = await createCesium3dData(db, map.id);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'delete',
            target: 'cesium3d',
            targetId: cesium3d.id,
            mapId: map.id,
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [cesium3d.id]);
      assert.ok(rows[0].deleted_at);
    });
  });

  describe('Batch delete all 3D entities of a tileset (§2 item 19)', () => {
    it('deletes all markers, measurements, and viewsheds for a tileset in batch', async () => {
      const tilesetId = 'TILESET_BATCH_DEL';
      const marker = await createCesium3dData(db, map.id, { data_type: 'marker', tileset_id: tilesetId, data: { name: 'M1' } });
      const measurement = await createCesium3dData(db, map.id, { data_type: 'measurement', tileset_id: tilesetId, data: { name: 'M2' } });
      const viewshed = await createCesium3dData(db, map.id, { data_type: 'viewshed', tileset_id: tilesetId, data: { name: 'M3' } });
      const now = Date.now();

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [
            { id: randomUUID(), type: 'delete', target: 'cesium3d', targetId: marker.id, mapId: map.id, timestamp: now, clientId: 'test-client' },
            { id: randomUUID(), type: 'delete', target: 'cesium3d', targetId: measurement.id, mapId: map.id, timestamp: now + 1, clientId: 'test-client' },
            { id: randomUUID(), type: 'delete', target: 'cesium3d', targetId: viewshed.id, mapId: map.id, timestamp: now + 2, clientId: 'test-client' },
          ],
        })
        .expect(200);

      for (const id of [marker.id, measurement.id, viewshed.id]) {
        const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
        assert.ok(rows[0].deleted_at, `cesium3d entry ${id} should be soft-deleted`);
      }
    });
  });

  describe('Cesium3D Data in Snapshot', () => {
    before(async () => {
      // Create some cesium3d data to be included in snapshot
      await createCesium3dData(db, map.id, {
        data_type: 'marker',
        data: { snapshot: true, index: 1 },
      });
      await createCesium3dData(db, map.id, {
        data_type: 'viewshed',
        data: { snapshot: true, index: 2 },
      });
    });

    it('cesium3d data is included in sync snapshot as hierarchical object', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, true);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      // cesium3d is a hierarchical object, not a flat array
      assert.ok(typeof mapData.cesium3d === 'object' && !Array.isArray(mapData.cesium3d));
      assert.ok(typeof mapData.cesium3d.cameraPositions === 'object');
      assert.ok(Array.isArray(mapData.cesium3d.markers));
      assert.ok(Array.isArray(mapData.cesium3d.measurements));
      assert.ok(Array.isArray(mapData.cesium3d.viewsheds));

      // Should have markers and/or viewsheds from setup
      const totalEntries = mapData.cesium3d.markers.length +
        mapData.cesium3d.measurements.length +
        mapData.cesium3d.viewsheds.length +
        Object.keys(mapData.cesium3d.cameraPositions).length;
      assert.ok(totalEntries >= 2, 'should have at least 2 cesium3d entries');

      // Check entry structure includes sync metadata
      if (mapData.cesium3d.markers.length > 0) {
        const marker = mapData.cesium3d.markers[0];
        assert.ok(marker.id);
        assert.ok(marker.sync);
        assert.ok(typeof marker.sync.createdAt === 'number');
      }
    });

    it('deleted cesium3d data is NOT included in snapshot', async () => {
      // Create and delete a cesium3d entry
      const cesium3d = await createCesium3dData(db, map.id, {
        data_type: 'marker',
        data: { toBeDeleted: true },
      });

      await db.query('UPDATE cesium3d_data SET deleted_at = NOW() WHERE id = $1', [cesium3d.id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      // Check that the deleted marker is not in any cesium3d collection
      const allMarkers = mapData.cesium3d.markers;
      const deleted = allMarkers.find(m => m.id === cesium3d.id);
      assert.ok(!deleted);
    });
  });
});

describe('StreetView360 Data via Sync API', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'streetview360_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Create StreetView360 Data via Sync', () => {
    it('creates a streetview360 orientation via sync', async () => {
      const targetId = randomUUID();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'streetview360',
            targetId: targetId,
            mapId: map.id,
            data: {
              data_type: 'orientation',
              photo_name: 'foto-sync-001',
              data: {
                heading: 90,
                pitch: 15,
                zoom: 1.5,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
      assert.equal(res.body.data.acks.length, 1);

      // Verify streetview360 data was created
      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].data_type, 'orientation');
      assert.equal(rows[0].photo_name, 'foto-sync-001');
      assert.equal(rows[0].data.heading, 90);
    });

    it('creates a streetview360 marker via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'streetview360',
            targetId: targetId,
            mapId: map.id,
            data: {
              data_type: 'marker',
              photo_name: 'foto-marker-001',
              data: {
                position: { x: 100, y: 200 },
                label: 'POI',
                color: '#00ff00',
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [targetId]);
      assert.equal(rows[0].data_type, 'marker');
      assert.equal(rows[0].data.label, 'POI');
    });
  });

  describe('Update StreetView360 Data via Sync', () => {
    let streetview360Id;

    before(async () => {
      const sv360 = await createStreetview360Data(db, map.id);
      streetview360Id = sv360.id;
    });

    it('updates streetview360 data property via sync', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'streetview360',
            targetId: streetview360Id,
            mapId: map.id,
            changes: {
              data: {
                heading: 180,
                pitch: -10,
                zoom: 2,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [streetview360Id]);
      assert.equal(rows[0].data.heading, 180);
      assert.equal(rows[0].data.pitch, -10);
    });

    it('updates streetview360 photo_name via sync', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'streetview360',
            targetId: streetview360Id,
            mapId: map.id,
            changes: {
              photo_name: 'foto-updated-002',
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [streetview360Id]);
      assert.equal(rows[0].photo_name, 'foto-updated-002');
    });
  });

  describe('Delete StreetView360 Data via Sync', () => {
    it('soft-deletes streetview360 data via sync', async () => {
      const sv360 = await createStreetview360Data(db, map.id);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'delete',
            target: 'streetview360',
            targetId: sv360.id,
            mapId: map.id,
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [sv360.id]);
      assert.ok(rows[0].deleted_at);
    });
  });

  describe('Batch delete all 360 entities of a photo (§2 item 23)', () => {
    it('deletes all markers and orientation for a photo in batch', async () => {
      const photoName = 'batch-del-photo';
      const orientation = await createStreetview360Data(db, map.id, { data_type: 'orientation', photo_name: photoName, data: { heading: 0 } });
      const marker1 = await createStreetview360Data(db, map.id, { data_type: 'marker', photo_name: photoName, data: { name: 'M1' } });
      const marker2 = await createStreetview360Data(db, map.id, { data_type: 'marker', photo_name: photoName, data: { name: 'M2' } });
      const now = Date.now();

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [
            { id: randomUUID(), type: 'delete', target: 'streetview360', targetId: orientation.id, mapId: map.id, timestamp: now, clientId: 'test-client' },
            { id: randomUUID(), type: 'delete', target: 'streetview360', targetId: marker1.id, mapId: map.id, timestamp: now + 1, clientId: 'test-client' },
            { id: randomUUID(), type: 'delete', target: 'streetview360', targetId: marker2.id, mapId: map.id, timestamp: now + 2, clientId: 'test-client' },
          ],
        })
        .expect(200);

      for (const id of [orientation.id, marker1.id, marker2.id]) {
        const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [id]);
        assert.ok(rows[0].deleted_at, `streetview360 entry ${id} should be soft-deleted`);
      }
    });
  });

  describe('StreetView360 Data in Snapshot', () => {
    before(async () => {
      // Create some streetview360 data to be included in snapshot
      await createStreetview360Data(db, map.id, {
        data_type: 'orientation',
        photo_name: 'snapshot-foto-1',
        data: { snapshot: true, index: 1 },
      });
      await createStreetview360Data(db, map.id, {
        data_type: 'marker',
        photo_name: 'snapshot-foto-2',
        data: { snapshot: true, index: 2 },
      });
    });

    it('streetview360 data is included in sync snapshot as hierarchical object', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, true);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      // streetview360 is a hierarchical object, not a flat array
      assert.ok(typeof mapData.streetview360 === 'object' && !Array.isArray(mapData.streetview360));
      assert.ok(typeof mapData.streetview360.orientations === 'object');
      assert.ok(Array.isArray(mapData.streetview360.markers));

      // Should have orientations and markers from setup
      const totalEntries = Object.keys(mapData.streetview360.orientations).length +
        mapData.streetview360.markers.length;
      assert.ok(totalEntries >= 2, 'should have at least 2 streetview360 entries');

      // Check entry structure includes sync metadata
      const orientationKeys = Object.keys(mapData.streetview360.orientations);
      if (orientationKeys.length > 0) {
        const orientation = mapData.streetview360.orientations[orientationKeys[0]];
        assert.ok(orientation.id);
        assert.ok(orientation.sync);
        assert.ok(typeof orientation.sync.createdAt === 'number');
      }
    });

    it('deleted streetview360 data is NOT included in snapshot', async () => {
      // Create and delete a streetview360 entry
      const sv360 = await createStreetview360Data(db, map.id, {
        data_type: 'marker',
        data: { toBeDeleted: true },
      });

      await db.query('UPDATE streetview360_data SET deleted_at = NOW() WHERE id = $1', [sv360.id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      // Check that the deleted marker is not in streetview360 markers
      const deleted = mapData.streetview360.markers.find(m => m.id === sv360.id);
      assert.ok(!deleted);
    });
  });
});

// Path: tests/integration/atlas-import.test.js
// Integration tests for Atlas Import API (offline-first sync)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, loginUser } from '../helpers/fixtures.js';

describe('Atlas Import API', () => {
  let app, db, user, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'import_user' });
    token = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('POST /atlas/import — Import Offline Atlas', () => {
    it('imports a simple atlas with one map', async () => {
      const mapId = randomUUID();
      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: {
            name: 'Imported Atlas',
            description: 'Atlas imported from offline',
          },
          maps: [{
            id: mapId,
            name: 'Main Map',
            base_layer: 'carta-topografica',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 12,
            features: [],
            layers: [],
            groups: [],
          }],
          briefings: [],
        })
        .expect(201);

      assert.ok(res.body.data.id);
      assert.equal(res.body.data.name, 'Imported Atlas');
      assert.ok(res.body.data.summary);
      assert.equal(res.body.data.summary.mapsImported, 1);

      // Verify atlas was created
      const { rows } = await db.query('SELECT * FROM atlas WHERE id = $1', [res.body.data.id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].owner_id, user.id);

      // Verify map was created with preserved ID
      const mapRows = await db.query('SELECT * FROM maps WHERE id = $1', [mapId]);
      assert.equal(mapRows.rows.length, 1);
    });

    it('imports atlas with features', async () => {
      const mapId = randomUUID();
      const featureId1 = randomUUID();
      const featureId2 = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: {
            name: 'Atlas with Features',
          },
          maps: [{
            id: mapId,
            name: 'Map with Features',
            base_layer: 'osm',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 10,
            features: [
              {
                id: featureId1,
                feature_type: 'point',
                geometry: { coordinates: [-43.2, -22.9] },
                properties: { name: 'Point 1' },
              },
              {
                id: featureId2,
                feature_type: 'polygon',
                geometry: { coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]] },
                properties: { name: 'Polygon 1' },
              },
            ],
            layers: [],
            groups: [],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.featuresImported, 2);

      // Verify features were created with preserved IDs
      const f1 = await db.query('SELECT * FROM features WHERE id = $1', [featureId1]);
      const f2 = await db.query('SELECT * FROM features WHERE id = $1', [featureId2]);
      assert.equal(f1.rows.length, 1);
      assert.equal(f2.rows.length, 1);
      assert.equal(f1.rows[0].feature_type, 'point');
      assert.equal(f2.rows[0].feature_type, 'polygon');
    });

    it('imports atlas with layers', async () => {
      const mapId = randomUUID();
      const layerId = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Atlas with Layers' },
          maps: [{
            id: mapId,
            name: 'Map with Layers',
            base_layer: 'osm',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 10,
            features: [],
            layers: [
              {
                id: layerId,
                name: 'Layer 1',
                visible: true,
                opacity: 0.8,
                sort_order: 0,
              },
            ],
            groups: [],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.layersImported, 1);

      // Verify layer was created
      const layer = await db.query('SELECT * FROM layers WHERE id = $1', [layerId]);
      assert.equal(layer.rows.length, 1);
      assert.equal(layer.rows[0].name, 'Layer 1');
    });

    it('imports atlas with groups', async () => {
      const mapId = randomUUID();
      const groupId = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Atlas with Groups' },
          maps: [{
            id: mapId,
            name: 'Map with Groups',
            base_layer: 'osm',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 10,
            features: [],
            layers: [],
            groups: [
              {
                id: groupId,
                name: 'Group 1',
                style: { color: '#ff0000' },
              },
            ],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.groupsImported, 1);

      // Verify group was created
      const group = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      assert.equal(group.rows.length, 1);
    });

    it('imports atlas with briefings and slides', async () => {
      const mapId = randomUUID();
      const briefingId = randomUUID();
      const slideId1 = randomUUID();
      const slideId2 = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Atlas with Briefings' },
          maps: [{
            id: mapId,
            name: 'Reference Map',
            base_layer: 'osm',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 10,
            features: [],
            layers: [],
            groups: [],
          }],
          briefings: [{
            id: briefingId,
            name: 'Ops Briefing',
            description: 'Operations briefing',
            settings: { panelPosition: 'right' },
            slides: [
              {
                id: slideId1,
                title: 'Situation',
                content: 'Current situation overview',
                mode: '2d',
                map_id: mapId,
                position: { lat: -22.9, lng: -43.2, zoom: 12 },
                orientation: { bearing: 0, pitch: 0 },
              },
              {
                id: slideId2,
                title: 'Mission',
                content: 'Mission details',
                mode: '2d',
                map_id: mapId,
                position: {},
                orientation: {},
              },
            ],
          }],
        })
        .expect(201);

      assert.equal(res.body.data.summary.briefingsImported, 1);
      assert.equal(res.body.data.summary.slidesImported, 2);

      // Verify briefing was created
      const briefing = await db.query('SELECT * FROM briefings WHERE id = $1', [briefingId]);
      assert.equal(briefing.rows.length, 1);

      // Verify slides were created
      const slides = await db.query('SELECT * FROM slides WHERE briefing_id = $1', [briefingId]);
      assert.equal(slides.rows.length, 2);
    });

    it('imports complete atlas with all entity types', async () => {
      const mapId = randomUUID();
      const featureId = randomUUID();
      const layerId = randomUUID();
      const groupId = randomUUID();
      const briefingId = randomUUID();
      const slideId = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: {
            name: 'Complete Atlas',
            description: 'Full import test',
            settings: { theme: 'dark' },
          },
          maps: [{
            id: mapId,
            name: 'Complete Map',
            base_layer: 'carta-topografica',
            center_lat: -15.8,
            center_long: -47.9,
            zoom: 14,
            bearing: 45,
            pitch: 30,
            notes_title: 'Map Notes',
            notes_description: 'Notes content',
            features: [{
              id: featureId,
              feature_type: 'point',
              geometry: { coordinates: [-47.9, -15.8] },
              properties: { name: 'HQ' },
              layer_id: layerId,
            }],
            layers: [{
              id: layerId,
              name: 'Main Layer',
              visible: true,
              opacity: 1,
              sort_order: 0,
              style: { lineWidth: 2 },
            }],
            groups: [{
              id: groupId,
              name: 'Main Group',
              style: {},
            }],
            groupFeatures: [{
              group_id: groupId,
              feature_id: featureId,
            }],
          }],
          briefings: [{
            id: briefingId,
            name: 'Complete Briefing',
            slides: [{
              id: slideId,
              title: 'Overview',
              mode: '2d',
              map_id: mapId,
              position: {},
              orientation: {},
            }],
          }],
        })
        .expect(201);

      assert.ok(res.body.data.id);
      assert.equal(res.body.data.summary.mapsImported, 1);
      assert.equal(res.body.data.summary.featuresImported, 1);
      assert.equal(res.body.data.summary.layersImported, 1);
      assert.equal(res.body.data.summary.groupsImported, 1);
      assert.equal(res.body.data.summary.briefingsImported, 1);
      assert.equal(res.body.data.summary.slidesImported, 1);
    });

    it('preserves client-generated UUIDs', async () => {
      const mapId = randomUUID();
      const featureId = randomUUID();

      await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'UUID Test' },
          maps: [{
            id: mapId,
            name: 'Test Map',
            base_layer: 'osm',
            center_lat: 0,
            center_long: 0,
            zoom: 1,
            features: [{
              id: featureId,
              feature_type: 'point',
              geometry: { coordinates: [0, 0] },
              properties: {},
            }],
            layers: [],
            groups: [],
          }],
          briefings: [],
        })
        .expect(201);

      // Verify IDs were preserved exactly
      const mapCheck = await db.query('SELECT id FROM maps WHERE id = $1', [mapId]);
      const featureCheck = await db.query('SELECT id FROM features WHERE id = $1', [featureId]);
      assert.equal(mapCheck.rows[0].id, mapId);
      assert.equal(featureCheck.rows[0].id, featureId);
    });

    it('rejects import without atlas name', async () => {
      await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: {}, // Missing name
          maps: [],
          briefings: [],
        })
        .expect(422);
    });

    it('requires authentication', async () => {
      await supertest(app)
        .post('/api/v1/atlas/import')
        .send({
          atlas: { name: 'Unauthorized' },
          maps: [],
          briefings: [],
        })
        .expect(401);
    });
  });

  describe('Import and Sync Flow', () => {
    it('imported atlas can be synced immediately', async () => {
      const mapId = randomUUID();
      const featureId = randomUUID();

      // Import atlas
      const importRes = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Sync Test Atlas' },
          maps: [{
            id: mapId,
            name: 'Sync Test Map',
            base_layer: 'osm',
            center_lat: 0,
            center_long: 0,
            zoom: 5,
            features: [{
              id: featureId,
              feature_type: 'point',
              geometry: { coordinates: [0, 0] },
              properties: { original: true },
            }],
            layers: [],
            groups: [],
          }],
          briefings: [],
        });

      const atlasId = importRes.body.data.id;

      // Sync should work
      const syncRes = await supertest(app)
        .get(`/api/v1/atlas/${atlasId}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.ok(syncRes.body.data.isSnapshot);
      assert.ok(syncRes.body.data.snapshot.maps.length > 0);
    });

    it('can add features to imported atlas via sync', async () => {
      const mapId = randomUUID();

      // Import atlas
      const importRes = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Editable Atlas' },
          maps: [{
            id: mapId,
            name: 'Editable Map',
            base_layer: 'osm',
            center_lat: 0,
            center_long: 0,
            zoom: 5,
            features: [],
            layers: [],
            groups: [],
          }],
          briefings: [],
        });

      const atlasId = importRes.body.data.id;
      const newFeatureId = randomUUID();

      // Add feature via sync
      await supertest(app)
        .post(`/api/v1/atlas/${atlasId}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: newFeatureId,
            mapId: mapId,
            data: {
              feature_type: 'point',
              geometry: { coordinates: [10, 10] },
              properties: { addedAfterImport: true },
            },
            timestamp: Date.now(),
            clientId: 'post-import',
          }],
        })
        .expect(200);

      // Verify feature was added
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [newFeatureId]);
      assert.equal(rows.length, 1);
    });
  });

  describe('Import Multiple Maps', () => {
    it('imports atlas with multiple maps', async () => {
      const map1Id = randomUUID();
      const map2Id = randomUUID();
      const map3Id = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Multi-Map Atlas' },
          maps: [
            {
              id: map1Id,
              name: 'Map 1',
              base_layer: 'osm',
              center_lat: -22.9,
              center_long: -43.2,
              zoom: 10,
              features: [],
              layers: [],
              groups: [],
            },
            {
              id: map2Id,
              name: 'Map 2',
              base_layer: 'satellite',
              center_lat: -23.5,
              center_long: -46.6,
              zoom: 12,
              features: [],
              layers: [],
              groups: [],
            },
            {
              id: map3Id,
              name: 'Map 3',
              base_layer: 'carta-topografica',
              center_lat: -15.8,
              center_long: -47.9,
              zoom: 14,
              features: [],
              layers: [],
              groups: [],
            },
          ],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.mapsImported, 3);

      // Verify all maps created
      const maps = await db.query('SELECT * FROM maps WHERE atlas_id = $1', [res.body.data.id]);
      assert.equal(maps.rows.length, 3);
    });
  });

  describe('Import with Cesium3D Data', () => {
    it('imports atlas with cesium3dData', async () => {
      const mapId = randomUUID();
      const cesium3dId1 = randomUUID();
      const cesium3dId2 = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Atlas with Cesium3D' },
          maps: [{
            id: mapId,
            name: 'Map with 3D Data',
            base_layer: 'osm',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 10,
            features: [],
            layers: [],
            groups: [],
            cesium3dData: [
              {
                id: cesium3dId1,
                data_type: 'marker',
                tileset_id: 'PCL',
                data: {
                  position: { longitude: -43.2, latitude: -22.9, height: 100 },
                  properties: { name: 'Imported 3D Marker' },
                },
              },
              {
                id: cesium3dId2,
                data_type: 'viewshed',
                tileset_id: 'PCL',
                data: {
                  observer: { longitude: -43.1, latitude: -22.8, height: 10 },
                  radius: 5000,
                },
              },
            ],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.cesium3dImported, 2);

      // Verify cesium3d data was created with preserved IDs
      const c1 = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [cesium3dId1]);
      const c2 = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [cesium3dId2]);
      assert.equal(c1.rows.length, 1);
      assert.equal(c2.rows.length, 1);
      assert.equal(c1.rows[0].data_type, 'marker');
      assert.equal(c2.rows[0].data_type, 'viewshed');
      assert.equal(c1.rows[0].map_id, mapId);
    });

    it('imports atlas with all cesium3d data types', async () => {
      const mapId = randomUUID();
      const cesiumIds = {
        marker: randomUUID(),
        measurement: randomUUID(),
        viewshed: randomUUID(),
        camera_position: randomUUID(),
      };

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Atlas All Cesium3D Types' },
          maps: [{
            id: mapId,
            name: 'Map All Types',
            base_layer: 'osm',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 10,
            features: [],
            layers: [],
            groups: [],
            cesium3dData: [
              { id: cesiumIds.marker, data_type: 'marker', tileset_id: 'PCL', data: { test: true } },
              { id: cesiumIds.measurement, data_type: 'measurement', tileset_id: null, data: { test: true } },
              { id: cesiumIds.viewshed, data_type: 'viewshed', tileset_id: 'PCL', data: { test: true } },
              { id: cesiumIds.camera_position, data_type: 'camera_position', tileset_id: null, data: { test: true } },
            ],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.cesium3dImported, 4);

      // Verify all types were created
      for (const [type, id] of Object.entries(cesiumIds)) {
        const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].data_type, type);
      }
    });
  });

  describe('Import with StreetView360 Data', () => {
    it('imports atlas with streetview360Data', async () => {
      const mapId = randomUUID();
      const sv360Id1 = randomUUID();
      const sv360Id2 = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Atlas with StreetView360' },
          maps: [{
            id: mapId,
            name: 'Map with 360 Data',
            base_layer: 'osm',
            center_lat: -22.9,
            center_long: -43.2,
            zoom: 10,
            features: [],
            layers: [],
            groups: [],
            streetview360Data: [
              {
                id: sv360Id1,
                data_type: 'orientation',
                photo_name: 'imported-foto-001',
                data: { heading: 45, pitch: 0, zoom: 1 },
              },
              {
                id: sv360Id2,
                data_type: 'marker',
                photo_name: 'imported-foto-001',
                data: { position: { x: 100, y: 200 }, label: 'POI' },
              },
            ],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.streetview360Imported, 2);

      // Verify streetview360 data was created with preserved IDs
      const s1 = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [sv360Id1]);
      const s2 = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [sv360Id2]);
      assert.equal(s1.rows.length, 1);
      assert.equal(s2.rows.length, 1);
      assert.equal(s1.rows[0].data_type, 'orientation');
      assert.equal(s2.rows[0].data_type, 'marker');
      assert.equal(s1.rows[0].photo_name, 'imported-foto-001');
    });

    it('imports atlas with both cesium3d and streetview360 data', async () => {
      const mapId = randomUUID();
      const cesium3dId = randomUUID();
      const sv360Id = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: { name: 'Atlas with All 3D Data' },
          maps: [{
            id: mapId,
            name: 'Complete 3D Map',
            base_layer: 'carta-topografica',
            center_lat: -15.8,
            center_long: -47.9,
            zoom: 14,
            features: [],
            layers: [],
            groups: [],
            cesium3dData: [
              {
                id: cesium3dId,
                data_type: 'marker',
                tileset_id: 'PCL',
                data: { position: { longitude: -47.9, latitude: -15.8, height: 50 } },
              },
            ],
            streetview360Data: [
              {
                id: sv360Id,
                data_type: 'orientation',
                photo_name: 'brasilia-001',
                data: { heading: 180, pitch: -5, zoom: 1.2 },
              },
            ],
          }],
          briefings: [],
        })
        .expect(201);

      assert.equal(res.body.data.summary.cesium3dImported, 1);
      assert.equal(res.body.data.summary.streetview360Imported, 1);

      // Verify both were created
      const cesium3d = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [cesium3dId]);
      const sv360 = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [sv360Id]);
      assert.equal(cesium3d.rows.length, 1);
      assert.equal(sv360.rows.length, 1);
    });
  });

  describe('Import Complete Atlas with All Entity Types', () => {
    it('imports atlas with all entity types including 3D data', async () => {
      const mapId = randomUUID();
      const featureId = randomUUID();
      const layerId = randomUUID();
      const groupId = randomUUID();
      const cesium3dId = randomUUID();
      const sv360Id = randomUUID();
      const briefingId = randomUUID();
      const slideId = randomUUID();

      const res = await supertest(app)
        .post('/api/v1/atlas/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          atlas: {
            name: 'Complete Atlas All Types',
            description: 'Full import test with all entity types',
            settings: { theme: 'dark' },
          },
          maps: [{
            id: mapId,
            name: 'Complete Map',
            base_layer: 'carta-topografica',
            center_lat: -15.8,
            center_long: -47.9,
            zoom: 14,
            bearing: 45,
            pitch: 30,
            notes_title: 'Map Notes',
            notes_description: 'Notes content',
            features: [{
              id: featureId,
              feature_type: 'point',
              geometry: { coordinates: [-47.9, -15.8] },
              properties: { name: 'HQ' },
              layer_id: layerId,
            }],
            layers: [{
              id: layerId,
              name: 'Main Layer',
              visible: true,
              opacity: 1,
              sort_order: 0,
              style: { lineWidth: 2 },
            }],
            groups: [{
              id: groupId,
              name: 'Main Group',
              style: {},
            }],
            groupFeatures: [{
              group_id: groupId,
              feature_id: featureId,
            }],
            cesium3dData: [{
              id: cesium3dId,
              data_type: 'marker',
              tileset_id: 'PCL',
              data: { position: { longitude: -47.9, latitude: -15.8, height: 100 } },
            }],
            streetview360Data: [{
              id: sv360Id,
              data_type: 'orientation',
              photo_name: 'foto-complete',
              data: { heading: 0, pitch: 0, zoom: 1 },
            }],
          }],
          briefings: [{
            id: briefingId,
            name: 'Complete Briefing',
            slides: [{
              id: slideId,
              title: 'Overview',
              mode: '2d',
              map_id: mapId,
              position: {},
              orientation: {},
            }],
          }],
        })
        .expect(201);

      // Verify all counts
      assert.equal(res.body.data.summary.mapsImported, 1);
      assert.equal(res.body.data.summary.featuresImported, 1);
      assert.equal(res.body.data.summary.layersImported, 1);
      assert.equal(res.body.data.summary.groupsImported, 1);
      assert.equal(res.body.data.summary.cesium3dImported, 1);
      assert.equal(res.body.data.summary.streetview360Imported, 1);
      assert.equal(res.body.data.summary.briefingsImported, 1);
      assert.equal(res.body.data.summary.slidesImported, 1);

      // Verify all entities exist
      const map = await db.query('SELECT * FROM maps WHERE id = $1', [mapId]);
      const feature = await db.query('SELECT * FROM features WHERE id = $1', [featureId]);
      const layer = await db.query('SELECT * FROM layers WHERE id = $1', [layerId]);
      const group = await db.query('SELECT * FROM groups WHERE id = $1', [groupId]);
      const cesium3d = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [cesium3dId]);
      const sv360 = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [sv360Id]);
      const briefing = await db.query('SELECT * FROM briefings WHERE id = $1', [briefingId]);
      const slide = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);

      assert.equal(map.rows.length, 1);
      assert.equal(feature.rows.length, 1);
      assert.equal(layer.rows.length, 1);
      assert.equal(group.rows.length, 1);
      assert.equal(cesium3d.rows.length, 1);
      assert.equal(sv360.rows.length, 1);
      assert.equal(briefing.rows.length, 1);
      assert.equal(slide.rows.length, 1);
    });
  });
});

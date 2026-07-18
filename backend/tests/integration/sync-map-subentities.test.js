// Path: tests/integration/sync-map-subentities.test.js
// Integration tests for map sub-entity operations via sync:
// - mapPosition, baseLayer, mapNotes, gridStyle, catalogLayer
// - Frontend field aliases
// - Permission checks (reader vs writer)
// - Batch sub-entity updates

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';

describe('Sync Map Sub-entities', () => {
  let app, db, owner, ownerToken, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'subentity_owner' });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id, {
      center_lat: -22.9,
      center_long: -43.2,
      zoom: 10,
      bearing: 0,
      pitch: 0,
      base_layer: 'carta-topografica',
    });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('mapPosition update', () => {
    it('pushes mapPosition update and verifies in snapshot', async () => {
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'mapPosition',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              center_lat: -15.8,
              center_long: -47.9,
              zoom: 14,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
      assert.equal(res.body.data.acks.length, 1);

      // Verify via snapshot
      const snapshot = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const mapData = snapshot.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      assert.equal(mapData.center_lat, -15.8);
      assert.equal(mapData.center_long, -47.9);
      assert.equal(mapData.zoom, 14);
    });

    it('pushes mapPosition with bearing and pitch', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'mapPosition',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              bearing: 45,
              pitch: 30,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify in DB
      const { rows } = await db.query('SELECT bearing, pitch FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].bearing, 45);
      assert.equal(rows[0].pitch, 30);
    });
  });

  describe('baseLayer update', () => {
    it('pushes baseLayer update and verifies in snapshot', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'baseLayer',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              base_layer: 'satellite',
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify via snapshot
      const snapshot = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const mapData = snapshot.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.equal(mapData.base_layer, 'satellite');
    });

    it('accepts frontend alias baseLayer (camelCase) in data', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'baseLayer',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              baseLayer: 'openstreetmap',
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT base_layer FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].base_layer, 'openstreetmap');
    });
  });

  describe('mapNotes update', () => {
    it('pushes mapNotes update with notes_title and notes_description', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'mapNotes',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              notes_title: 'Briefing Notes',
              notes_description: 'Detailed map description here.',
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query(
        'SELECT notes_title, notes_description FROM maps WHERE id = $1',
        [map.id]
      );
      assert.equal(rows[0].notes_title, 'Briefing Notes');
      assert.equal(rows[0].notes_description, 'Detailed map description here.');
    });

    it('accepts frontend aliases title/description for mapNotes', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'mapNotes',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              title: 'Frontend Title',
              description: 'Frontend Description',
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query(
        'SELECT notes_title, notes_description FROM maps WHERE id = $1',
        [map.id]
      );
      assert.equal(rows[0].notes_title, 'Frontend Title');
      assert.equal(rows[0].notes_description, 'Frontend Description');
    });
  });

  describe('gridStyle update', () => {
    it('pushes gridStyle update and verifies map was updated', async () => {
      // gridStyle maps to a map update via the sub-entity mechanism.
      // The actual grid style may be stored in analysis_layers or a similar field.
      // The key test: the operation goes through without error.
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'gridStyle',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              analysis_layers: { gridType: 'utm', gridColor: '#333333', gridSpacing: 1000 },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
      assert.equal(res.body.data.acks.length, 1);

      // Verify the map was updated
      const { rows } = await db.query('SELECT analysis_layers FROM maps WHERE id = $1', [map.id]);
      assert.ok(rows[0].analysis_layers);
      assert.equal(rows[0].analysis_layers.gridType, 'utm');
    });
  });

  describe('catalogLayer update', () => {
    it('pushes catalogLayer update and verifies map was updated', async () => {
      const catalogData = [
        { id: 'wms-layer-1', url: 'https://example.com/wms', visible: true },
        { id: 'wms-layer-2', url: 'https://example.com/wms2', visible: false },
      ];

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'catalogLayer',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: {
              catalog_layers: catalogData,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT catalog_layers FROM maps WHERE id = $1', [map.id]);
      assert.ok(Array.isArray(rows[0].catalog_layers));
      assert.equal(rows[0].catalog_layers.length, 2);
      assert.equal(rows[0].catalog_layers[0].id, 'wms-layer-1');
    });
  });

  describe('Permission checks', () => {
    it('reader cannot push sub-entity updates', async () => {
      const reader = await createUser(db, { username: 'subentity_reader' });
      const readerToken = await loginUser(app, reader.username, reader.password);

      // Give reader read-only access
      await createShare(db, atlas.id, reader.id, 'read', owner.id);

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${readerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'mapPosition',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: { center_lat: -10, center_long: -50, zoom: 5 },
            timestamp: Date.now(),
            clientId: 'reader-client',
          }],
        })
        .expect(403);
    });

    it('writer can push sub-entity updates', async () => {
      const writer = await createUser(db, { username: 'subentity_writer' });
      const writerToken = await loginUser(app, writer.username, writer.password);

      // Give writer write access
      await createShare(db, atlas.id, writer.id, 'write', owner.id);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${writerToken}`)
        .send({
          operations: [{
            id: randomUUID(),
            entityType: 'mapPosition',
            operationType: 'update',
            entityId: randomUUID(),
            mapId: map.id,
            data: { center_lat: -20, center_long: -40, zoom: 8 },
            timestamp: Date.now(),
            clientId: 'writer-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
      assert.equal(res.body.data.acks.length, 1);
    });
  });

  describe('Batch sub-entity updates', () => {
    it('multiple sub-entity updates in a single batch are all applied', async () => {
      // Create a second map for testing
      const map2 = await createMap(db, atlas.id, { name: 'Batch Sub Map' });

      const now = Date.now();
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [
            {
              id: randomUUID(),
              entityType: 'mapPosition',
              operationType: 'update',
              entityId: randomUUID(),
              mapId: map2.id,
              data: { center_lat: -5.0, center_long: -35.0, zoom: 6 },
              timestamp: now,
              clientId: 'batch-client',
            },
            {
              id: randomUUID(),
              entityType: 'baseLayer',
              operationType: 'update',
              entityId: randomUUID(),
              mapId: map2.id,
              data: { base_layer: 'terrain' },
              timestamp: now + 1,
              clientId: 'batch-client',
            },
            {
              id: randomUUID(),
              entityType: 'mapNotes',
              operationType: 'update',
              entityId: randomUUID(),
              mapId: map2.id,
              data: { notes_title: 'Batch Title', notes_description: 'Batch Desc' },
              timestamp: now + 2,
              clientId: 'batch-client',
            },
          ],
        })
        .expect(200);

      assert.equal(res.body.data.acks.length, 3);

      // Verify all changes were applied
      const { rows } = await db.query(
        'SELECT center_lat, center_long, zoom, base_layer, notes_title, notes_description FROM maps WHERE id = $1',
        [map2.id]
      );
      assert.equal(rows[0].center_lat, -5);
      assert.equal(rows[0].center_long, -35);
      assert.equal(rows[0].zoom, 6);
      assert.equal(rows[0].base_layer, 'terrain');
      assert.equal(rows[0].notes_title, 'Batch Title');
      assert.equal(rows[0].notes_description, 'Batch Desc');
    });
  });
});

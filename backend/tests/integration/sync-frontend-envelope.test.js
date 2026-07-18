// Path: tests/integration/sync-frontend-envelope.test.js
// Regression for the envelope reconciliation with the REAL frontend store/sync
// layer (ebgeo_web/src/js/store/*). The frontend's shared operation factory emits:
//   - 3D/360 entities FLAT + camelCase ({ id, tilesetId, position, ... }), not the
//     nested { data_type, tileset_id, data } shape the older tests used;
//   - features as raw GeoJSON Features (type in properties.source, layer in
//     properties.layerId), not flat { feature_type, layer_id };
//   - the UPDATE payload in `data` (never `changes`);
//   - a load-bearing `lamportTimestamp` that must round-trip on incremental pull.
// Slides also carry a v2.2 `temporal_cursor`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createBriefing, loginUser } from '../helpers/fixtures.js';

describe('Sync envelope reconciliation (real frontend store shapes)', () => {
  let app, db, user, token, atlas, map, briefing;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'envelope_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    briefing = await createBriefing(db, atlas.id, { name: 'Envelope Briefing' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const pushSync = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });

  describe('3D/360 entities emitted FLAT (camelCase, fields at top level)', () => {
    it('cesium3d marker: tilesetId + flat fields land in tileset_id + data (not NULL/{})', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'marker3d',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { id, tilesetId: 'aman', position: { x: 1, y: 2, z: 3 }, properties: { name: 'M' }, style: { color: '#f00' }, sync: { dirty: true } },
        timestamp: Date.now(),
        lamportTimestamp: 1,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'marker');
      assert.equal(rows[0].tileset_id, 'aman', 'tilesetId (camelCase) must map to tileset_id');
      assert.equal(rows[0].data.position.x, 1, 'flat fields must be wrapped into the JSONB data');
      assert.equal(rows[0].data.properties.name, 'M');
      assert.equal(rows[0].data.style.color, '#f00');
      assert.equal(rows[0].data.id, undefined, 'meta keys (id/sync/tilesetId) must not leak into data');
      assert.equal(rows[0].data.sync, undefined);
    });

    it('streetview360 orientation: photoName + flat fields land in photo_name + data', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'orientation360',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { id, photoName: 'foto-Z', lon: -43.2, lat: -22.9, fov: 80, savedAt: 123, sync: {} },
        timestamp: Date.now(),
        lamportTimestamp: 2,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'orientation');
      assert.equal(rows[0].photo_name, 'foto-Z', 'photoName (camelCase) must map to photo_name');
      assert.equal(rows[0].data.fov, 80);
      assert.equal(rows[0].data.lon, -43.2);
    });

    it('3D marker UPDATE with payload in `data` (no changes) applies', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(), entityType: 'marker3d', operationType: 'create', entityId: id, mapId: map.id,
        data: { id, tilesetId: 'aman', position: { x: 0 }, sync: {} }, timestamp: Date.now(), lamportTimestamp: 3, clientId: 'c',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(), entityType: 'marker3d', operationType: 'update', entityId: id, mapId: map.id,
        data: { id, tilesetId: 'aman', position: { x: 99 }, sync: {} }, timestamp: Date.now() + 1, lamportTimestamp: 4, clientId: 'c',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.equal(rows[0].data.position.x, 99, 'update payload carried in data must apply');
    });
  });

  describe('Features as raw GeoJSON (type in properties.source, layer in properties.layerId)', () => {
    it('create derives feature_type/layer_id from properties', async () => {
      const id = randomUUID();
      const layerId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
          properties: { id, source: 'point', layerId, name: 'GeoJSON Point' },
        },
        timestamp: Date.now(),
        lamportTimestamp: 5,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [id]);
      assert.equal(rows[0].feature_type, 'point', 'feature_type derived from properties.source');
      assert.equal(rows[0].layer_id, layerId, 'layer_id derived from properties.layerId');
      assert.equal(rows[0].properties.name, 'GeoJSON Point');
    });

    it('update with payload in `data` (no changes) applies (data→changes fallback)', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId: map.id,
        data: { type: 'Feature', geometry: {}, properties: { id, source: 'point', name: 'Before' } },
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(), entityType: 'feature', operationType: 'update', entityId: id, mapId: map.id,
        data: { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id, source: 'point', name: 'After' } },
        timestamp: Date.now() + 1, clientId: 'c',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [id]);
      assert.equal(rows[0].properties.name, 'After', 'update via data must not be a silent no-op');
      assert.deepEqual(rows[0].geometry.coordinates, [1, 2]);
    });
  });

  describe('lamportTimestamp round-trips on incremental pull', () => {
    it('echoes lamportTimestamp on the pulled op', async () => {
      // Two ops so currentVersion >= 2 and a pull from currentVersion-1 is incremental.
      await pushSync([{
        id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(), mapId: map.id,
        data: { type: 'Feature', geometry: {}, properties: { source: 'point' } }, timestamp: Date.now(), lamportTimestamp: 40, clientId: 'c',
      }]).expect(200);
      await pushSync([{
        id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(), mapId: map.id,
        data: { type: 'Feature', geometry: {}, properties: { source: 'point' } }, timestamp: Date.now() + 1, lamportTimestamp: 41, clientId: 'c',
      }]).expect(200);

      const head = await supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/0`).set('Authorization', `Bearer ${token}`).expect(200);
      const currentVersion = head.body.data.currentVersion;

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${currentVersion - 1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, false, 'pull from currentVersion-1 should be incremental');
      const op = res.body.data.operations[res.body.data.operations.length - 1];
      assert.equal(op.lamportTimestamp, 41, 'pulled op must carry lamportTimestamp');
    });
  });

  describe('Slide temporal_cursor (v2.2) round-trips', () => {
    it('persists temporal_cursor on create and update, and surfaces temporalCursor in the snapshot', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(), entityType: 'slide', operationType: 'create', entityId: id,
        data: { briefing_id: briefing.id, title: 'Temporal Slide', mode: '2d', temporal_cursor: 1718900000000 },
        timestamp: Date.now(), clientId: 'c',
      }]).expect(200);

      let { rows } = await db.query('SELECT temporal_cursor FROM slides WHERE id = $1', [id]);
      assert.equal(rows[0].temporal_cursor, 1718900000000, 'temporal_cursor must persist on create');

      await pushSync([{
        id: randomUUID(), entityType: 'slide', operationType: 'update', entityId: id,
        changes: { temporal_cursor: 999 }, timestamp: Date.now() + 1, clientId: 'c',
      }]).expect(200);

      ({ rows } = await db.query('SELECT temporal_cursor FROM slides WHERE id = $1', [id]));
      assert.equal(rows[0].temporal_cursor, 999, 'temporal_cursor must update');

      const snap = await supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/0`).set('Authorization', `Bearer ${token}`).expect(200);
      const b = snap.body.data.snapshot.briefings.find((x) => x.id === briefing.id);
      const slide = b.slides.find((s) => s.id === id);
      assert.equal(slide.temporalCursor, 999, 'snapshot must surface temporalCursor (camelCase)');
      assert.ok(slide.sync, 'snapshot slide must carry sync metadata');
      assert.equal(typeof slide.order, 'number', 'snapshot slide must carry order');
    });
  });
});

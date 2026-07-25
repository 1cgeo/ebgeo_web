// Path: tests/integration/sync-frontend-format.test.js
// Tests that all entity types work with the frontend format (entityType/operationType/entityId)
// AND with frontend aliases (marker3d, measurement3d, orientation360, etc.)
// Covers compatibility requirements from CLAUDE.md "Compatibilidade com Frontend"

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createBriefing, loginUser } from '../helpers/fixtures.js';

describe('Frontend Format Compatibility (entityType/operationType/entityId)', () => {
  let app, db, user, token, atlas, map, briefing;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'frontend_fmt_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    briefing = await createBriefing(db, atlas.id, { name: 'Frontend Briefing' });
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

  describe('Feature CRUD with frontend format', () => {
    it('creates feature using entityType/operationType/entityId', async () => {
      const id = randomUUID();
      const res = await pushSync([{
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
          properties: { name: 'Frontend Point' },
        },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      assert.ok(res.body.data.acks.length === 1);
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [id]);
      assert.equal(rows[0].properties.name, 'Frontend Point');
    });

    it('updates feature using frontend format', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { feature_type: 'point', geometry: {}, properties: { name: 'Before' } },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'update',
        entityId: id,
        mapId: map.id,
        changes: { properties: { name: 'After' } },
        timestamp: Date.now() + 1,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [id]);
      assert.equal(rows[0].properties.name, 'After');
    });

    it('deletes feature using frontend format', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { feature_type: 'point', geometry: {}, properties: {} },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'delete',
        entityId: id,
        mapId: map.id,
        timestamp: Date.now() + 1,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [id]);
      assert.ok(rows[0].deleted_at);
    });
  });

  describe('Map CRUD with frontend format', () => {
    it('creates map using frontend format', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'map',
        operationType: 'create',
        entityId: id,
        data: { name: 'Frontend Map' },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [id]);
      assert.equal(rows[0].name, 'Frontend Map');
    });
  });

  describe('Slide CRUD with frontend format', () => {
    it('creates slide using frontend format', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'slide',
        operationType: 'create',
        entityId: id,
        data: { briefing_id: briefing.id, title: 'Frontend Slide', mode: '2d' },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [id]);
      assert.equal(rows[0].title, 'Frontend Slide');
    });
  });

  describe('3D Aliases — marker3d, measurement3d, viewshed3d, cameraPosition3d', () => {
    it('creates marker3d (mapped to cesium3d with data_type=marker)', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'marker3d',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          tileset_id: 'tileset-test',
          data: { name: 'My Marker', position: { x: 1, y: 2, z: 3 } },
        },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'marker');
      assert.equal(rows[0].tileset_id, 'tileset-test');
    });

    it('creates measurement3d (mapped to cesium3d with data_type=measurement)', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'measurement3d',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          tileset_id: 'tileset-test',
          data: { type: 'distance', value: 150.5 },
        },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'measurement');
    });

    it('creates viewshed3d (mapped to cesium3d with data_type=viewshed)', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'viewshed3d',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          tileset_id: 'tileset-test',
          data: { height: 2, radius: 500, fov: 120 },
        },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'viewshed');
    });

    it('creates cameraPosition3d (mapped to cesium3d with data_type=camera_position)', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'cameraPosition3d',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          tileset_id: 'tileset-test',
          data: { longitude: -43.2, latitude: -22.9, altitude: 1000, heading: 0, pitch: -45 },
        },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'camera_position');
    });

    it('updates marker3d using frontend alias', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'marker3d',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { tileset_id: 'tileset-test', data: { name: 'Old Name' } },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        entityType: 'marker3d',
        operationType: 'update',
        entityId: id,
        mapId: map.id,
        changes: { data: { name: 'New Name' } },
        timestamp: Date.now() + 1,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.equal(rows[0].data.name, 'New Name');
    });

    it('deletes viewshed3d using frontend alias', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'viewshed3d',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { tileset_id: 'tileset-test', data: {} },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        entityType: 'viewshed3d',
        operationType: 'delete',
        entityId: id,
        mapId: map.id,
        timestamp: Date.now() + 1,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM cesium3d_data WHERE id = $1', [id]);
      assert.ok(rows[0].deleted_at);
    });
  });

  describe('360 Aliases — orientation360, marker360', () => {
    it('creates orientation360 (mapped to streetview360 with data_type=orientation)', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'orientation360',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          photo_name: 'foto-001',
          data: { longitude: -43.2, latitude: -22.9, fov: 80, heading: 180 },
        },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'orientation');
      assert.equal(rows[0].photo_name, 'foto-001');
    });

    it('creates marker360 (mapped to streetview360 with data_type=marker)', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'marker360',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: {
          photo_name: 'foto-002',
          data: { name: '360 Marker', position: { yaw: 45, pitch: -10 } },
        },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [id]);
      assert.equal(rows[0].data_type, 'marker');
    });

    it('updates orientation360 using frontend alias', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'orientation360',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { photo_name: 'foto-003', data: { fov: 80 } },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        entityType: 'orientation360',
        operationType: 'update',
        entityId: id,
        mapId: map.id,
        changes: { data: { fov: 60, heading: 90 } },
        timestamp: Date.now() + 1,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [id]);
      assert.equal(rows[0].data.fov, 60);
    });

    it('deletes marker360 using frontend alias', async () => {
      const id = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'marker360',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        data: { photo_name: 'foto-004', data: {} },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        entityType: 'marker360',
        operationType: 'delete',
        entityId: id,
        mapId: map.id,
        timestamp: Date.now() + 1,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM streetview360_data WHERE id = $1', [id]);
      assert.ok(rows[0].deleted_at);
    });
  });

  describe('Map sub-entity aliases (mapPosition, baseLayer, mapNotes, gridStyle, catalogLayer)', () => {
    it('updates mapPosition via frontend alias', async () => {
      await pushSync([{
        id: randomUUID(),
        entityType: 'mapPosition',
        operationType: 'update',
        entityId: randomUUID(),
        mapId: map.id,
        data: { center_lat: -15.5, center_long: -47.8, zoom: 14 },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(Number(rows[0].center_lat), -15.5);
      assert.equal(Number(rows[0].center_long), -47.8);
    });

    it('updates baseLayer via frontend alias', async () => {
      await pushSync([{
        id: randomUUID(),
        entityType: 'baseLayer',
        operationType: 'update',
        entityId: randomUUID(),
        mapId: map.id,
        data: { baseLayer: 'satellite-imagery' },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].base_layer, 'satellite-imagery');
    });

    it('updates mapNotes via frontend alias', async () => {
      await pushSync([{
        id: randomUUID(),
        entityType: 'mapNotes',
        operationType: 'update',
        entityId: randomUUID(),
        mapId: map.id,
        data: { title: 'Notes Title', description: '<p>Notes content</p>' },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].notes_title, 'Notes Title');
    });

    it('updates gridStyle via frontend alias', async () => {
      await pushSync([{
        id: randomUUID(),
        entityType: 'gridStyle',
        operationType: 'update',
        entityId: randomUUID(),
        mapId: map.id,
        data: { analysis_layers: { grid: { type: 'utm', visible: true } } },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.ok(rows[0].analysis_layers.grid);
    });

    it('updates catalogLayer via frontend alias', async () => {
      const catalogData = [{ id: 'wms-layer', url: 'http://geo.example.com/wms', visible: true }];
      await pushSync([{
        id: randomUUID(),
        entityType: 'catalogLayer',
        operationType: 'update',
        entityId: randomUUID(),
        mapId: map.id,
        data: { catalog_layers: catalogData },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM maps WHERE id = $1', [map.id]);
      assert.deepEqual(rows[0].catalog_layers, catalogData);
    });
  });

  describe('Group-Feature with frontend format', () => {
    it('creates group_feature association using frontend format', async () => {
      const groupId = randomUUID();
      const featureId = randomUUID();
      const now = Date.now();

      await pushSync([
        {
          id: randomUUID(),
          entityType: 'group',
          operationType: 'create',
          entityId: groupId,
          mapId: map.id,
          data: { name: 'Frontend Group' },
          timestamp: now,
          clientId: 'frontend-client',
        },
        {
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: featureId,
          mapId: map.id,
          data: { feature_type: 'point', geometry: {}, properties: {} },
          timestamp: now + 1,
          clientId: 'frontend-client',
        },
        {
          id: randomUUID(),
          entityType: 'group_feature',
          operationType: 'create',
          entityId: randomUUID(),
          mapId: map.id,
          data: { group_id: groupId, feature_id: featureId },
          timestamp: now + 2,
          clientId: 'frontend-client',
        },
      ]).expect(200);

      const { rows } = await db.query(
        'SELECT * FROM group_features WHERE group_id = $1 AND feature_id = $2',
        [groupId, featureId]
      );
      assert.equal(rows.length, 1);
    });

    it('deletes group_feature association using frontend format', async () => {
      const groupId = randomUUID();
      const featureId = randomUUID();
      const now = Date.now();

      await pushSync([
        {
          id: randomUUID(),
          entityType: 'group',
          operationType: 'create',
          entityId: groupId,
          mapId: map.id,
          data: { name: 'Del Assoc Group' },
          timestamp: now,
          clientId: 'frontend-client',
        },
        {
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: featureId,
          mapId: map.id,
          data: { feature_type: 'point', geometry: {}, properties: {} },
          timestamp: now + 1,
          clientId: 'frontend-client',
        },
        {
          id: randomUUID(),
          entityType: 'group_feature',
          operationType: 'create',
          entityId: randomUUID(),
          mapId: map.id,
          data: { group_id: groupId, feature_id: featureId },
          timestamp: now + 2,
          clientId: 'frontend-client',
        },
      ]).expect(200);

      // Delete the association (hard delete for group_feature)
      await pushSync([{
        id: randomUUID(),
        entityType: 'group_feature',
        operationType: 'delete',
        entityId: randomUUID(),
        mapId: map.id,
        data: { group_id: groupId, feature_id: featureId },
        timestamp: now + 3,
        clientId: 'frontend-client',
      }]).expect(200);

      const { rows } = await db.query(
        'SELECT * FROM group_features WHERE group_id = $1 AND feature_id = $2',
        [groupId, featureId]
      );
      assert.equal(rows.length, 0);
    });
  });

  describe('Incremental operations returned in frontend format', () => {
    it('pull returns operations with entityType/operationType/entityId fields', async () => {
      // Push an operation
      const featureId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: featureId,
        mapId: map.id,
        data: { feature_type: 'point', geometry: {}, properties: { name: 'Pull Test' } },
        timestamp: Date.now(),
        clientId: 'frontend-client',
      }]).expect(200);

      // Get current version
      const snapshotRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const currentVersion = snapshotRes.body.data.currentVersion;

      // Pull incremental from version - 1
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${currentVersion - 1}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // A pull from currentVersion-1 IS the incremental branch: that is the
      // branch this test exists to exercise, so assert it instead of tolerating
      // either outcome.
      assert.equal(res.body.data.isSnapshot, false, 'pull from currentVersion-1 must be incremental');
      assert.ok(res.body.data.operations.length > 0, 'incremental pull should return operations');
      const op = res.body.data.operations[0];
      // `toFrontendOperation` emits the frontend names only, never the legacy
      // target/type/targetId trio (that trio is INBOUND-only, see sync.schemas.js).
      assert.equal(typeof op.entityType, 'string', 'the pulled op carries entityType');
      assert.equal(typeof op.operationType, 'string', 'the pulled op carries operationType');
      assert.equal(typeof op.entityId, 'string', 'the pulled op carries entityId');
      assert.equal(op.target, undefined, 'the legacy `target` name must not leak into a response');
      assert.equal(op.targetId, undefined, 'the legacy `targetId` name must not leak into a response');

      // The whole outbound envelope, as a set. Asserting field by field catches a
      // RENAME but never a field LEAKING OUT (a stray column, an internal flag),
      // and the frozen contract is about the object the frontend reads, not about
      // three of its properties. `lamportTimestamp` is deliberately allowed to be
      // absent: toFrontendOperation emits it as undefined for legacy rows, and
      // JSON drops undefined keys.
      const FROZEN_KEYS = [
        'changes', 'clientId', 'data', 'entityId', 'entityType', 'id',
        'mapId', 'operationType', 'serverVersion', 'timestamp',
      ];
      const seen = Object.keys(op).sort();
      const extra = seen.filter((k) => !FROZEN_KEYS.includes(k) && k !== 'lamportTimestamp');
      const missing = FROZEN_KEYS.filter((k) => !seen.includes(k));
      assert.deepEqual(extra, [], `unexpected field(s) in the outbound sync envelope: ${extra.join(', ')}`);
      assert.deepEqual(missing, [], `missing field(s) from the frozen envelope: ${missing.join(', ')}`);
    });
  });
});

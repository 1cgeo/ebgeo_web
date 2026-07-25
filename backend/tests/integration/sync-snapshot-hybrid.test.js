// Path: tests/integration/sync-snapshot-hybrid.test.js
// Integration tests for hybrid snapshot/operations sync system:
// - Snapshot (isSnapshot: true) when version=0
// - Incremental operations (isSnapshot: false) when version >= min_version
// - Snapshot structure: atlas, maps, briefings, features by type, layers, groups
// - Soft-deleted entities excluded from snapshot
// - Incremental operations in frontend format

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAtlas,
  createMap,
  createFeature,
  createLayer,
  createGroup,
  createBriefing,
  createSlide,
  loginUser,
} from '../helpers/fixtures.js';

describe('Sync Snapshot/Hybrid System', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'snapshot_hybrid_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id, { name: 'Snapshot Test Atlas' });
    map = await createMap(db, atlas.id, {
      name: 'Test Map',
      center_lat: -22.9,
      center_long: -43.2,
      zoom: 10,
    });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Snapshot response (version=0)', () => {
    it('pull version=0 returns snapshot with isSnapshot: true', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, true);
      assert.ok(res.body.data.snapshot);
      assert.ok(res.body.data.snapshot.atlas);
      assert.ok(Array.isArray(res.body.data.snapshot.maps));
      assert.ok(Array.isArray(res.body.data.snapshot.briefings));
      assert.ok(typeof res.body.data.currentVersion === 'number');
    });

    it('snapshot still returned after pushing operations when version=0', async () => {
      // Push some operations
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
            data: {
              feature_type: 'point',
              geometry: { coordinates: [-43.0, -22.5] },
              properties: { name: 'Snapshot Point' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Pull with version=0 should still return snapshot
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, true);
      assert.ok(res.body.data.snapshot);
    });

    it('snapshot atlas has mapOrder, settings, and sync metadata', async () => {
      // Update atlas to have settings
      await db.query(
        `UPDATE atlas SET settings = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ theme: 'dark', language: 'pt-BR' }), atlas.id]
      );

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const snapshotAtlas = res.body.data.snapshot.atlas;
      assert.ok(snapshotAtlas.id);
      assert.equal(snapshotAtlas.name, 'Snapshot Test Atlas');
      assert.ok(Array.isArray(snapshotAtlas.mapOrder));
      assert.ok(snapshotAtlas.settings);
      assert.equal(snapshotAtlas.settings.theme, 'dark');

      // Sync metadata
      assert.ok(snapshotAtlas.sync);
      assert.ok(typeof snapshotAtlas.sync.createdAt === 'number');
      assert.ok(typeof snapshotAtlas.sync.updatedAt === 'number');
      assert.ok(typeof snapshotAtlas.sync.version === 'number');
      assert.equal(snapshotAtlas.sync.dirty, false);
      assert.equal(snapshotAtlas.sync.deleted, false);
    });
  });

  describe('Snapshot structure: features by type', () => {
    before(async () => {
      // Create features of different types
      await createFeature(db, map.id, {
        feature_type: 'point',
        geometry: { coordinates: [-43.1, -22.85] },
        properties: { name: 'Snapshot Point' },
      });
      await createFeature(db, map.id, {
        feature_type: 'line',
        geometry: { coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
        properties: { name: 'Snapshot Line' },
      });
      await createFeature(db, map.id, {
        feature_type: 'polygon',
        geometry: { coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]] },
        properties: { name: 'Snapshot Polygon' },
      });
    });

    it('snapshot includes maps with features organized by type', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);

      // Features is an object keyed by collection name
      assert.ok(typeof mapData.features === 'object' && !Array.isArray(mapData.features));
      assert.ok(Array.isArray(mapData.features.points));
      assert.ok(Array.isArray(mapData.features.lines));
      assert.ok(Array.isArray(mapData.features.polygons));

      // Verify at least one of each was created
      assert.ok(mapData.features.points.length > 0, 'should have points');
      assert.ok(mapData.features.lines.length > 0, 'should have lines');
      assert.ok(mapData.features.polygons.length > 0, 'should have polygons');

      // Check GeoJSON Feature structure
      const point = mapData.features.points[0];
      assert.equal(point.type, 'Feature');
      assert.ok(point.geometry);
      assert.ok(point.properties);
      assert.ok(point.properties.id, 'properties should include id');
      assert.ok(point.properties.source, 'properties should include source (feature_type)');
      assert.equal(point.properties.source, 'point');
    });
  });

  describe('Snapshot structure: layers with order field', () => {
    before(async () => {
      await createLayer(db, map.id, { name: 'Layer A', sort_order: 0 });
      await createLayer(db, map.id, { name: 'Layer B', sort_order: 1 });
    });

    it('snapshot includes layers with order field (mapped from sort_order)', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      assert.ok(Array.isArray(mapData.layers));
      assert.ok(mapData.layers.length >= 2);

      // Check that layers have 'order' field (frontend name), not 'sort_order'
      const layerA = mapData.layers.find(l => l.name === 'Layer A');
      assert.ok(layerA);
      assert.equal(layerA.order, 0);

      const layerB = mapData.layers.find(l => l.name === 'Layer B');
      assert.ok(layerB);
      assert.equal(layerB.order, 1);

      // Verify other layer fields
      assert.ok(typeof layerA.id === 'string');
      assert.ok(typeof layerA.visible === 'boolean');
      assert.ok(typeof layerA.createdAt === 'number');
      assert.ok(typeof layerA.updatedAt === 'number');
    });
  });

  describe('Snapshot structure: groups with features references', () => {
    before(async () => {
      const group = await createGroup(db, map.id, { name: 'Snapshot Group' });
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Grouped Point' },
      });
      // Associate feature to group
      await db.query(
        'INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)',
        [group.id, feature.id]
      );
    });

    it('snapshot includes groups with features array', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      assert.ok(Array.isArray(mapData.groups));

      const group = mapData.groups.find(g => g.name === 'Snapshot Group');
      assert.ok(group);
      assert.ok(Array.isArray(group.features));
      assert.ok(group.features.length > 0, 'group should have at least one feature reference');

      // Each feature reference should have type and id
      const ref = group.features[0];
      assert.ok(ref.type, 'feature reference should have type');
      assert.ok(ref.id, 'feature reference should have id');

      // Group should have sync metadata
      assert.ok(group.sync);
      assert.ok(typeof group.sync.createdAt === 'number');
    });
  });

  describe('Snapshot excludes deleted entities', () => {
    it('snapshot does NOT include soft-deleted features', async () => {
      // Create and delete a feature
      const deletedFeature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Deleted Feature', markerForTest: 'deleted_snapshot_test' },
      });

      await db.query('UPDATE features SET deleted_at = NOW() WHERE id = $1', [deletedFeature.id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      const allFeatureIds = Object.values(mapData.features)
        .flat()
        .map(f => f.properties.id);

      assert.ok(!allFeatureIds.includes(deletedFeature.id),
        'deleted feature should not appear in snapshot');
    });

    it('snapshot does NOT include soft-deleted maps', async () => {
      // Create and delete a map
      const deletedMap = await createMap(db, atlas.id, { name: 'Deleted Map' });
      await db.query('UPDATE maps SET deleted_at = NOW() WHERE id = $1', [deletedMap.id]);

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const mapIds = res.body.data.snapshot.maps.map(m => m.id);
      assert.ok(!mapIds.includes(deletedMap.id),
        'deleted map should not appear in snapshot');
    });
  });

  describe('Snapshot includes briefings with slides', () => {
    before(async () => {
      const briefing = await createBriefing(db, atlas.id, { name: 'Snapshot Briefing' });
      await createSlide(db, briefing.id, {
        title: 'Slide 1',
        content: 'First slide content',
        mode: '2d',
        map_id: map.id,
      });
      await createSlide(db, briefing.id, {
        title: 'Slide 2',
        content: 'Second slide content',
        mode: '2d',
      });
    });

    it('snapshot includes briefings with slides', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const briefings = res.body.data.snapshot.briefings;
      assert.ok(Array.isArray(briefings));

      const briefing = briefings.find(b => b.name === 'Snapshot Briefing');
      assert.ok(briefing);
      assert.ok(Array.isArray(briefing.slides));
      assert.ok(briefing.slides.length >= 2, 'briefing should have at least 2 slides');

      // Verify slide structure
      const slide = briefing.slides.find(s => s.title === 'Slide 1');
      assert.ok(slide);
      assert.equal(slide.content, 'First slide content');
      assert.equal(slide.mode, '2d');

      // Briefing should have sync metadata
      assert.ok(briefing.sync);
      assert.ok(typeof briefing.sync.createdAt === 'number');
    });
  });

  describe('Incremental operations', () => {
    it('push operations, pull with correct version returns incremental (isSnapshot: false)', async () => {
      // Get current version via snapshot
      const snapshotRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const versionBeforePush = snapshotRes.body.data.currentVersion;

      // Push a new operation
      const featureId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: featureId,
            mapId: map.id,
            data: {
              feature_type: 'point',
              geometry: { coordinates: [-42.0, -21.0] },
              properties: { name: 'Incremental Test' },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Pull from the version before the push
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${versionBeforePush}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // This suite never prunes the oplog, so min_version stays 0 and a pull
      // from versionBeforePush IS the incremental branch. Asserting it (instead
      // of guarding on it) is what makes the assertions below run at all.
      assert.equal(res.body.data.isSnapshot, false, 'pull from versionBeforePush must be incremental');
      assert.ok(Array.isArray(res.body.data.operations));
      assert.ok(res.body.data.operations.length > 0, 'should have at least one operation');
    });

    it('pull with current version returns empty operations array', async () => {
      // Get current version
      const snapshotRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`);

      const currentVersion = snapshotRes.body.data.currentVersion;

      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${currentVersion}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, false, 'pull at currentVersion must be incremental');
      assert.equal(res.body.data.operations.length, 0,
        'pulling at current version should return no operations');
    });

    it('incremental operations are in frontend format (entityType, operationType, entityId)', async () => {
      // Get current version
      const snapshotRes = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`);

      const versionBefore = snapshotRes.body.data.currentVersion;

      // Push an operation
      const featureId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'feature',
            targetId: featureId,
            mapId: map.id,
            data: {
              feature_type: 'polygon',
              geometry: { coordinates: [[[-43, -22], [-42, -22], [-42, -21], [-43, -22]]] },
              properties: { name: 'Format Test' },
            },
            timestamp: Date.now(),
            clientId: 'format-client',
          }],
        })
        .expect(200);

      // Pull incremental
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/${versionBefore}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, false, 'pull from versionBefore must be incremental');
      const ops = res.body.data.operations;
      assert.ok(ops.length > 0);

      // Count what was actually inspected, rather than trusting `find` to have
      // found the right one: exactly ONE op for this feature must come back. A
      // duplicate (the same op replayed twice by the log) and a zero (the pull
      // silently dropping it) are both bugs `assert.ok(op)` cannot see.
      const mine = ops.filter(o => o.entityId === featureId);
      assert.equal(mine.length, 1, `expected exactly one op for the pushed feature, got ${mine.length}`);
      const op = mine[0];

      // Verify frontend format fields
      assert.equal(op.entityType, 'feature');
      assert.equal(op.operationType, 'create');
      assert.equal(op.entityId, featureId);
      assert.ok(typeof op.timestamp === 'number', 'timestamp should be a number');
      assert.ok(op.clientId, 'should have clientId');
      assert.ok(typeof op.serverVersion === 'number', 'serverVersion should be a number');
    });

    it('a pull from BELOW min_version falls back to a snapshot (the other branch, forced)', async () => {
      // The incremental cases above hold `min_version = 0` steady, so the
      // fallback that protects a client whose requested version was pruned away
      // was never exercised on purpose — it only ever appeared as the `if` this
      // suite used to hide its assertions behind. Raising min_version above the
      // requested version is the deterministic way to reach it.
      const snap = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const currentVersion = snap.body.data.currentVersion;
      assert.ok(currentVersion > 1, 'guard: this suite must have pushed operations by now');

      const { rows: before } = await db.query('SELECT min_version FROM atlas WHERE id = $1', [atlas.id]);
      try {
        await db.query('UPDATE atlas SET min_version = $2 WHERE id = $1', [atlas.id, currentVersion]);

        const res = await supertest(app)
          .get(`/api/v1/atlas/${atlas.id}/sync/1`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        assert.equal(res.body.data.isSnapshot, true,
          'a version older than min_version cannot be served incrementally');
        assert.ok(res.body.data.snapshot, 'and the snapshot payload must actually be there');
        assert.ok(
          res.body.data.snapshot.maps.some((m) => m.id === map.id),
          'the fallback snapshot carries the atlas content, it is not an empty envelope'
        );
      } finally {
        await db.query('UPDATE atlas SET min_version = $2 WHERE id = $1', [atlas.id, before[0].min_version]);
      }
    });
  });
});

// Path: tests/integration/sync-advanced.test.js
// Integration tests for advanced Sync features:
// - group_feature associations
// - military feature types
// - analysis feature types
// - slide operations via sync

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
  createGroup,
  createBriefing,
  loginUser,
} from '../helpers/fixtures.js';

describe('Group-Feature Association via Sync', () => {
  let app, db, user, token, atlas, map, group, feature;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'group_feature_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    group = await createGroup(db, map.id);
    feature = await createFeature(db, map.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Create group_feature via Sync', () => {
    it('creates group_feature association via sync', async () => {
      const newFeature = await createFeature(db, map.id);

      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'group_feature',
            targetId: randomUUID(),
            mapId: map.id,
            data: {
              group_id: group.id,
              feature_id: newFeature.id,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);

      // Verify association was created
      const { rows } = await db.query(
        'SELECT * FROM group_features WHERE group_id = $1 AND feature_id = $2',
        [group.id, newFeature.id]
      );
      assert.equal(rows.length, 1);
    });

    it('handles duplicate group_feature gracefully', async () => {
      // Create association first
      await db.query(
        'INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [group.id, feature.id]
      );

      // Try to create same association via sync - should not fail
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'group_feature',
            targetId: randomUUID(),
            mapId: map.id,
            data: {
              group_id: group.id,
              feature_id: feature.id,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);
    });
  });

  describe('Delete group_feature via Sync', () => {
    it('deletes group_feature association via sync', async () => {
      const newFeature = await createFeature(db, map.id);

      // Create association
      await db.query(
        'INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2)',
        [group.id, newFeature.id]
      );

      // Delete via sync
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'delete',
            target: 'group_feature',
            targetId: randomUUID(),
            mapId: map.id,
            data: {
              group_id: group.id,
              feature_id: newFeature.id,
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      // Verify association was removed
      const { rows } = await db.query(
        'SELECT * FROM group_features WHERE group_id = $1 AND feature_id = $2',
        [group.id, newFeature.id]
      );
      assert.equal(rows.length, 0);
    });
  });

  describe('group_feature in Snapshot', () => {
    before(async () => {
      // Create some features and associations
      const f1 = await createFeature(db, map.id, { properties: { snapshot_gf: true } });
      const f2 = await createFeature(db, map.id, { properties: { snapshot_gf: true } });
      await db.query(
        'INSERT INTO group_features (group_id, feature_id) VALUES ($1, $2), ($1, $3)',
        [group.id, f1.id, f2.id]
      );
    });

    it('group_features are included in sync snapshot', async () => {
      const res = await supertest(app)
        .get(`/api/v1/atlas/${atlas.id}/sync/0`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      assert.equal(res.body.data.isSnapshot, true);

      const mapData = res.body.data.snapshot.maps.find(m => m.id === map.id);
      assert.ok(mapData);
      assert.ok(Array.isArray(mapData.groupFeatures));
      assert.ok(mapData.groupFeatures.length >= 2);

      // Verify structure
      const gf = mapData.groupFeatures[0];
      assert.ok(gf.group_id);
      assert.ok(gf.feature_id);
    });
  });
});

describe('Military Feature Types via Sync', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'military_features_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Create Military Features', () => {
    it('creates an arrow feature via sync', async () => {
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
              feature_type: 'arrow',
              geometry: {
                coordinates: [[-43.2, -22.9], [-43.1, -22.8], [-43.0, -22.7]],
              },
              properties: {
                name: 'Attack Arrow',
                direction: 'forward',
                color: '#ff0000',
                strokeWidth: 3,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      assert.ok(res.body.data.acks);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'arrow');
    });

    it('creates a boundary feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'boundary',
              geometry: {
                coordinates: [[-43.3, -22.9], [-43.2, -22.9], [-43.1, -22.8]],
              },
              properties: {
                name: 'Unit Boundary',
                boundaryType: 'FEBA',
                echelon: 'division',
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'boundary');
      assert.equal(rows[0].properties.boundaryType, 'FEBA');
    });

    it('creates an occupied_front feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'occupied_front',
              geometry: {
                coordinates: [[-43.5, -22.9], [-43.4, -22.85], [-43.3, -22.9]],
              },
              properties: {
                name: 'Enemy Line',
                hostility: 'enemy',
                strength: 'reinforced',
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'occupied_front');
    });

    it('creates a military_symbol feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'military_symbol',
              geometry: {
                coordinates: [-43.2, -22.9],
              },
              properties: {
                sidc: 'SFGPUCII---E---', // Infantry unit
                name: 'Alpha Company',
                echelon: 'company',
                affiliation: 'friend',
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'military_symbol');
      assert.equal(rows[0].properties.sidc, 'SFGPUCII---E---');
    });

    it('creates a coordination_measure feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'coordination_measure',
              geometry: {
                coordinates: [[[-43.3, -22.95], [-43.2, -22.95], [-43.2, -22.85], [-43.3, -22.85], [-43.3, -22.95]]],
              },
              properties: {
                name: 'Phase Line Alpha',
                measureType: 'phase_line',
                time: '0600Z',
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'coordination_measure');
    });
  });
});

describe('Analysis Feature Types via Sync', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'analysis_features_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Create Analysis Features', () => {
    it('creates a los (line of sight) feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'los',
              geometry: {
                observer: [-43.2, -22.9],
                target: [-43.1, -22.8],
              },
              properties: {
                name: 'LOS Analysis 1',
                observerHeight: 1.8,
                targetHeight: 2.5,
                status: 'pending',
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'los');
    });

    it('creates a visibility feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'visibility',
              geometry: {
                center: [-43.2, -22.9],
                radius: 5000,
              },
              properties: {
                name: 'Visibility Analysis',
                observerHeight: 10,
                status: 'pending',
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'visibility');
    });

    it('creates a processed_los feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'processed_los',
              geometry: {
                observer: [-43.2, -22.9],
                target: [-43.1, -22.8],
                profile: [[0, 100], [500, 105], [1000, 98], [1500, 120]],
              },
              properties: {
                name: 'Processed LOS Result',
                result: 'visible',
                processedAt: new Date().toISOString(),
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'processed_los');
      assert.equal(rows[0].properties.result, 'visible');
    });

    it('creates a processed_visibility feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'processed_visibility',
              geometry: {
                center: [-43.2, -22.9],
                visibleArea: [[[-43.25, -22.95], [-43.15, -22.95], [-43.15, -22.85], [-43.25, -22.85], [-43.25, -22.95]]],
              },
              properties: {
                name: 'Visibility Result',
                coverage: 0.75,
                processedAt: new Date().toISOString(),
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'processed_visibility');
    });
  });
});

describe('Additional Feature Types via Sync', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'additional_features_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Shape Feature Types', () => {
    it('creates an ellipse feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'ellipse',
              geometry: {
                center: [-43.2, -22.9],
                semiMajorAxis: 1000,
                semiMinorAxis: 500,
                rotation: 45,
              },
              properties: {
                name: 'Ellipse Area',
                fillColor: '#00ff00',
                opacity: 0.5,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'ellipse');
    });

    it('creates a brush feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'brush',
              geometry: {
                coordinates: [
                  [-43.20, -22.90], [-43.19, -22.89], [-43.18, -22.90],
                  [-43.17, -22.89], [-43.16, -22.90], [-43.15, -22.89],
                ],
              },
              properties: {
                name: 'Free Draw',
                strokeColor: '#0000ff',
                strokeWidth: 2,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'brush');
    });

    it('creates an image feature via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
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
              feature_type: 'image',
              geometry: {
                coordinates: [-43.2, -22.9],
              },
              properties: {
                name: 'Photo Marker',
                imageId: randomUUID(), // Reference to uploaded image
                rotation: 0,
                scale: 1,
              },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows[0].feature_type, 'image');
    });
  });
});

describe('Slide Operations via Sync', () => {
  let app, db, user, token, atlas, map, briefing;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'slide_sync_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    briefing = await createBriefing(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  describe('Create Slide via Sync', () => {
    it('creates a 2d slide via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'slide',
            targetId: targetId,
            data: {
              briefing_id: briefing.id,
              title: 'Situacao Atual',
              content: 'Descricao da situacao',
              mode: '2d',
              map_id: map.id,
              position: { lat: -22.9, lng: -43.2, zoom: 12 },
              orientation: { bearing: 0, pitch: 0 },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].title, 'Situacao Atual');
      assert.equal(rows[0].mode, '2d');
    });

    it('creates a 3d slide via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'slide',
            targetId: targetId,
            data: {
              briefing_id: briefing.id,
              title: 'Vista 3D',
              content: 'Visao tridimensional',
              mode: '3d',
              model_id: randomUUID(),
              position: { longitude: -43.2, latitude: -22.9, height: 5000 },
              orientation: { heading: 45, pitch: -30, roll: 0 },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [targetId]);
      assert.equal(rows[0].mode, '3d');
    });

    it('creates a 360 slide via sync', async () => {
      const targetId = randomUUID();
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'create',
            target: 'slide',
            targetId: targetId,
            data: {
              briefing_id: briefing.id,
              title: 'Vista 360',
              content: 'Foto panoramica',
              mode: '360',
              photo_id: randomUUID(),
              position: {},
              orientation: { heading: 180, pitch: 0 },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [targetId]);
      assert.equal(rows[0].mode, '360');
    });
  });

  describe('Update Slide via Sync', () => {
    let slideId;

    before(async () => {
      const { rows } = await db.query(
        `INSERT INTO slides (briefing_id, title, content, mode, position, orientation)
         VALUES ($1, 'Original Title', 'Original content', '2d', '{}'::jsonb, '{}'::jsonb)
         RETURNING *`,
        [briefing.id]
      );
      slideId = rows[0].id;
    });

    it('updates slide title and content via sync', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'slide',
            targetId: slideId,
            changes: {
              title: 'Updated Title',
              content: 'Updated content',
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
      assert.equal(rows[0].title, 'Updated Title');
      assert.equal(rows[0].content, 'Updated content');
    });

    it('updates slide position via sync', async () => {
      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'update',
            target: 'slide',
            targetId: slideId,
            changes: {
              position: { lat: -15.8, lng: -47.9, zoom: 14 },
            },
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
      assert.equal(rows[0].position.lat, -15.8);
    });
  });

  describe('Delete Slide via Sync', () => {
    it('soft-deletes slide via sync', async () => {
      const { rows: inserted } = await db.query(
        `INSERT INTO slides (briefing_id, title, mode, position, orientation)
         VALUES ($1, 'To Delete', '2d', '{}'::jsonb, '{}'::jsonb)
         RETURNING *`,
        [briefing.id]
      );
      const slideId = inserted[0].id;

      await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          operations: [{
            id: randomUUID(),
            type: 'delete',
            target: 'slide',
            targetId: slideId,
            timestamp: Date.now(),
            clientId: 'test-client',
          }],
        })
        .expect(200);

      const { rows } = await db.query('SELECT * FROM slides WHERE id = $1', [slideId]);
      assert.ok(rows[0].deleted_at);
    });
  });
});

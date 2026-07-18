// Path: tests/integration/sync-feature-moves.test.js
// Tests for feature property updates via Sync API
// Covers: §2 items 11-12 (feature visibility, feature lock)
// Covers: §14 item 6 (move feature to layer — layer_id change)
// Covers: §14 item 9 (duplicate feature)
// Covers: §15 items 9-10 (move feature, edit vertices)
// Covers: §17 items 1-19 (feature panel — name, description, color, style, etc.)
// Covers: §16 items 4-5 (paste, delete selection)
// Covers: §18 items 5-7 (attribute table edit, add/delete column)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, createFeature, loginUser } from '../helpers/fixtures.js';

describe('Feature Property Updates via Sync', () => {
  let app, db, user, token, atlas, map, layer1, layer2;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'feat_moves_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    layer1 = await createLayer(db, map.id, { name: 'Layer A' });
    layer2 = await createLayer(db, map.id, { name: 'Layer B' });
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

  describe('Move feature to layer — §14 item 6', () => {
    it('changes feature layer_id via sync update', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        layer_id: layer1.id,
        properties: { name: 'Movable Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { layer_id: layer2.id },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].layer_id, layer2.id);
    });

    it('moves feature to null layer (unassign)', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'polygon',
        layer_id: layer1.id,
        properties: { name: 'Unassign Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { layer_id: null },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].layer_id, null);
    });
  });

  describe('Feature visibility toggle — §2 item 11, §17 item 7', () => {
    it('hides feature by setting visible:false in properties', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Visible Point', visible: true },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { properties: { ...feature.properties, name: 'Visible Point', visible: false } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.visible, false);
    });
  });

  describe('Feature lock toggle — §2 item 12, §17 item 8', () => {
    it('locks feature by setting locked:true in properties', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Lockable Point', locked: false },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { properties: { ...feature.properties, name: 'Lockable Point', locked: true } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.locked, true);
    });
  });

  describe('Feature name edit — §17 item 1', () => {
    it('updates feature name in properties via sync', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Old Name' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { properties: { name: 'New Name' } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.name, 'New Name');
    });
  });

  describe('Feature style edits — §17 items 3-6,9 (color, opacity, width, hatch)', () => {
    it('updates feature fill color', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'polygon',
        properties: { name: 'Styled Polygon', fillColor: '#ff0000' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { properties: { ...feature.properties, fillColor: '#00ff00' } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.fillColor, '#00ff00');
    });

    it('updates feature stroke color, opacity, and width in single operation', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'line',
        properties: { name: 'Styled Line', strokeColor: '#000', opacity: 1, lineWidth: 2 },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { properties: { name: 'Styled Line', strokeColor: '#0000ff', opacity: 0.5, lineWidth: 5 } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.strokeColor, '#0000ff');
      assert.equal(rows[0].properties.opacity, 0.5);
      assert.equal(rows[0].properties.lineWidth, 5);
    });
  });

  describe('Feature geometry move — §15 item 9', () => {
    it('moves point by updating geometry coordinates', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { name: 'Moving Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { geometry: { type: 'Point', coordinates: [-43.3, -22.8] } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.deepEqual(rows[0].geometry.coordinates, [-43.3, -22.8]);
    });
  });

  describe('Feature vertex editing — §15 item 10', () => {
    it('updates polygon vertices via geometry update', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'polygon',
        geometry: {
          type: 'Polygon',
          coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]],
        },
        properties: { name: 'Editable Polygon' },
      });

      const newCoords = [[[-43.4, -22.95], [-43.1, -22.95], [-43.1, -22.75], [-43.4, -22.75], [-43.4, -22.95]]];

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { geometry: { type: 'Polygon', coordinates: newCoords } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.deepEqual(rows[0].geometry.coordinates, newCoords);
    });
  });

  describe('Feature custom attributes — §17 items 11-13', () => {
    it('adds custom attribute to feature properties', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Attribute Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { properties: { name: 'Attribute Point', customField: 'custom value', population: 15000 } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.customField, 'custom value');
      assert.equal(rows[0].properties.population, 15000);
    });
  });

  describe('Feature photos — §17 items 14-16 (reference in properties)', () => {
    it('adds photo references to feature properties', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Photo Point', photos: [] },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: {
          properties: {
            name: 'Photo Point',
            photos: [{ id: 'img-001', caption: 'Front view' }, { id: 'img-002', caption: 'Side view' }],
          },
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.photos.length, 2);
      assert.equal(rows[0].properties.photos[0].id, 'img-001');
    });
  });

  describe('Feature type change', () => {
    it('changes feature_type via sync', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Type Change' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { feature_type: 'military_symbol' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].feature_type, 'military_symbol');
    });
  });

  describe('Duplicate feature — §14 item 9', () => {
    it('creates a copy of feature with new UUID', async () => {
      const original = await createFeature(db, map.id, {
        feature_type: 'polygon',
        geometry: { type: 'Polygon', coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]] },
        properties: { name: 'Original Polygon', color: '#ff0000' },
        layer_id: layer1.id,
      });

      const duplicateId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId: duplicateId,
        mapId: map.id,
        data: {
          feature_type: 'polygon',
          geometry: original.geometry,
          properties: { ...original.properties, name: 'Original Polygon (copy)' },
          layer_id: layer1.id,
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [duplicateId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].properties.name, 'Original Polygon (copy)');
      assert.deepEqual(rows[0].geometry, original.geometry);
    });
  });

  describe('Delete feature — §16 item 5, §17 item 17', () => {
    it('soft-deletes feature via sync', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'To Delete Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.ok(rows[0].deleted_at, 'feature should be soft-deleted');
    });
  });

  describe('Batch feature operations — §2 items 13-14, §16 item 5', () => {
    it('deletes multiple features in a single batch', async () => {
      const f1 = await createFeature(db, map.id, { feature_type: 'point', properties: { name: 'Batch1' } });
      const f2 = await createFeature(db, map.id, { feature_type: 'point', properties: { name: 'Batch2' } });
      const f3 = await createFeature(db, map.id, { feature_type: 'point', properties: { name: 'Batch3' } });
      const now = Date.now();

      await pushSync([
        { id: randomUUID(), type: 'delete', target: 'feature', targetId: f1.id, mapId: map.id, timestamp: now, clientId: 'test-client' },
        { id: randomUUID(), type: 'delete', target: 'feature', targetId: f2.id, mapId: map.id, timestamp: now + 1, clientId: 'test-client' },
        { id: randomUUID(), type: 'delete', target: 'feature', targetId: f3.id, mapId: map.id, timestamp: now + 2, clientId: 'test-client' },
      ]).expect(200);

      for (const f of [f1, f2, f3]) {
        const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [f.id]);
        assert.ok(rows[0].deleted_at, `feature ${f.id} should be soft-deleted`);
      }
    });

    it('creates multiple features in batch (paste) — §16 item 4', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const now = Date.now();

      await pushSync(ids.map((id, i) => ({
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId: id,
        mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-43.2 + i * 0.01, -22.9] },
          properties: { name: `Pasted Point ${i + 1}` },
        },
        timestamp: now + i,
        clientId: 'test-client',
      }))).expect(200);

      for (const id of ids) {
        const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [id]);
        assert.equal(rows.length, 1);
      }
    });
  });

  describe('Point label configuration — §17 item 19, §7 item 4a', () => {
    it('updates point label properties (show, text, color, size, outline)', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Labeled Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: {
          properties: {
            name: 'Labeled Point',
            labelShow: true,
            labelText: 'Custom Label',
            labelColor: '#ffffff',
            labelSize: 14,
            labelOutline: true,
            labelZoomCorrection: true,
            labelReferenceZoom: 12,
          },
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.equal(rows[0].properties.labelShow, true);
      assert.equal(rows[0].properties.labelText, 'Custom Label');
      assert.equal(rows[0].properties.labelSize, 14);
    });
  });

  describe('Feature description (rich text) — §17 item 2', () => {
    it('updates feature description in properties', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        properties: { name: 'Described Point', description: '' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { properties: { name: 'Described Point', description: '<p>Rich <strong>text</strong> description</p>' } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.ok(rows[0].properties.description.includes('<strong>text</strong>'));
    });
  });

  describe('Feature coordinate editing — §17 item 10', () => {
    it('updates coordinates via geometry change (modal edit)', async () => {
      const feature = await createFeature(db, map.id, {
        feature_type: 'point',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { name: 'Coord Edit Point' },
      });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'feature',
        targetId: feature.id,
        mapId: map.id,
        changes: { geometry: { type: 'Point', coordinates: [-47.8, -15.5] } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [feature.id]);
      assert.deepEqual(rows[0].geometry.coordinates, [-47.8, -15.5]);
    });
  });

  describe('Move feature between maps — §14 item 7 (create+delete workaround)', () => {
    it('moves feature to another map by creating in destination and deleting from source', async () => {
      const map2 = await createMap(db, atlas.id, { name: 'Destination Map' });

      const original = await createFeature(db, map.id, {
        feature_type: 'polygon',
        geometry: { type: 'Polygon', coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]] },
        properties: { name: 'Feature to Move', color: '#ff0000' },
        layer_id: layer1.id,
      });

      const newId = randomUUID();
      const now = Date.now();

      // Atomic create+delete in a single batch
      await pushSync([
        {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: newId,
          mapId: map2.id,
          data: {
            feature_type: original.feature_type,
            geometry: original.geometry,
            properties: original.properties,
          },
          timestamp: now,
          clientId: 'test-client',
        },
        {
          id: randomUUID(),
          type: 'delete',
          target: 'feature',
          targetId: original.id,
          mapId: map.id,
          timestamp: now + 1,
          clientId: 'test-client',
        },
      ]).expect(200);

      // Original should be soft-deleted
      const { rows: oldRows } = await db.query('SELECT * FROM features WHERE id = $1', [original.id]);
      assert.ok(oldRows[0].deleted_at, 'original feature should be soft-deleted');

      // New feature should exist in destination map
      const { rows: newRows } = await db.query('SELECT * FROM features WHERE id = $1', [newId]);
      assert.equal(newRows.length, 1);
      assert.equal(newRows[0].map_id, map2.id);
      assert.equal(newRows[0].properties.name, 'Feature to Move');
    });
  });

  describe('Batch feature lock/unlock — §2 item 14', () => {
    it('locks multiple features in a single batch', async () => {
      const f1 = await createFeature(db, map.id, { feature_type: 'point', properties: { name: 'Lock1', locked: false } });
      const f2 = await createFeature(db, map.id, { feature_type: 'line', properties: { name: 'Lock2', locked: false } });
      const f3 = await createFeature(db, map.id, { feature_type: 'polygon', properties: { name: 'Lock3', locked: false } });
      const now = Date.now();

      await pushSync([
        { id: randomUUID(), type: 'update', target: 'feature', targetId: f1.id, mapId: map.id, changes: { properties: { name: 'Lock1', locked: true } }, timestamp: now, clientId: 'test-client' },
        { id: randomUUID(), type: 'update', target: 'feature', targetId: f2.id, mapId: map.id, changes: { properties: { name: 'Lock2', locked: true } }, timestamp: now + 1, clientId: 'test-client' },
        { id: randomUUID(), type: 'update', target: 'feature', targetId: f3.id, mapId: map.id, changes: { properties: { name: 'Lock3', locked: true } }, timestamp: now + 2, clientId: 'test-client' },
      ]).expect(200);

      for (const f of [f1, f2, f3]) {
        const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [f.id]);
        assert.equal(rows[0].properties.locked, true, `feature ${f.id} should be locked`);
      }
    });
  });

  describe('Batch feature visibility toggle — §2 item 13', () => {
    it('hides multiple features in a single batch', async () => {
      const f1 = await createFeature(db, map.id, { feature_type: 'point', properties: { name: 'Vis1', visible: true } });
      const f2 = await createFeature(db, map.id, { feature_type: 'point', properties: { name: 'Vis2', visible: true } });
      const now = Date.now();

      await pushSync([
        { id: randomUUID(), type: 'update', target: 'feature', targetId: f1.id, mapId: map.id, changes: { properties: { name: 'Vis1', visible: false } }, timestamp: now, clientId: 'test-client' },
        { id: randomUUID(), type: 'update', target: 'feature', targetId: f2.id, mapId: map.id, changes: { properties: { name: 'Vis2', visible: false } }, timestamp: now + 1, clientId: 'test-client' },
      ]).expect(200);

      for (const f of [f1, f2]) {
        const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [f.id]);
        assert.equal(rows[0].properties.visible, false, `feature ${f.id} should be hidden`);
      }
    });
  });

  describe('Feature in snapshot with all properties', () => {
    it('snapshot feature includes properties, geometry, layer_id, and sync metadata', async () => {
      const featureId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId: featureId,
        mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
          properties: { name: 'Snapshot Feature', color: '#ff0000', visible: true },
          layer_id: layer1.id,
        },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const mapData = snapshot.maps.find(m => m.id === map.id);
      // Snapshot wraps features in GeoJSON format: { type: 'Feature', geometry, properties: { id, ... } }
      const point = mapData.features.points.find(f => f.properties.id === featureId);
      assert.ok(point, 'feature should be in snapshot');
      assert.equal(point.properties.name, 'Snapshot Feature');
      assert.ok(point.geometry);
      assert.ok(point.properties.createdAt, 'feature should have sync metadata (createdAt)');
    });
  });
});

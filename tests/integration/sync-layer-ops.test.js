// Path: tests/integration/sync-layer-ops.test.js
// Tests for layer update/delete operations via Sync API
// Covers: §2 items 2-5,7 (rename, visibility, lock, reorder, delete)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, loginUser } from '../helpers/fixtures.js';

describe('Layer Operations via Sync', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'layer_ops_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  // Helper to push sync operations
  function pushSync(operations) {
    return supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations });
  }

  // Helper to get snapshot
  async function getSnapshot() {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot;
  }

  describe('Update layer name (§2 item 3 — rename)', () => {
    it('renames layer via sync update', async () => {
      const layer = await createLayer(db, map.id, { name: 'Original Layer' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { name: 'Renamed Layer' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].name, 'Renamed Layer');
    });
  });

  describe('Update layer visibility (§2 item 4)', () => {
    it('toggles layer visibility off via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'Visible Layer', visible: true });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { visible: false },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].visible, false);
    });

    it('toggles layer visibility on via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'Hidden Layer', visible: false });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { visible: true },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].visible, true);
    });
  });

  describe('Lock/unlock layer (§2 item 5)', () => {
    it('locks layer via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'Unlocked Layer', locked: false });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { locked: true },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].locked, true);
    });

    it('unlocks layer via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'Locked Layer', locked: true });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { locked: false },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].locked, false);
    });
  });

  describe('Reorder layers (§2 item 7)', () => {
    it('updates layer sort_order via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'Layer Order', sort_order: 0 });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { sort_order: 5 },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].sort_order, 5);
    });

    it('accepts frontend alias "order" for sort_order', async () => {
      const layer = await createLayer(db, map.id, { name: 'Layer Order Alias', sort_order: 0 });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { order: 3 },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].sort_order, 3);
    });
  });

  describe('Update layer opacity', () => {
    it('updates layer opacity via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'Opacity Layer', opacity: 1 });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { opacity: 0.5 },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(Number(rows[0].opacity), 0.5);
    });
  });

  describe('Update layer style (JSONB)', () => {
    it('updates layer style via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'Style Layer' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        changes: { style: { color: '#00ff00', lineWidth: 2 } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.deepEqual(rows[0].style, { color: '#00ff00', lineWidth: 2 });
    });
  });

  describe('Delete layer (§2 item 2)', () => {
    it('soft-deletes layer via sync', async () => {
      const layer = await createLayer(db, map.id, { name: 'To Delete Layer' });

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'layer',
        targetId: layer.id,
        mapId: map.id,
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.ok(rows[0].deleted_at, 'layer should be soft-deleted');
    });

    it('deleted layer is excluded from snapshot', async () => {
      const layerId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'layer',
        targetId: layerId,
        mapId: map.id,
        data: { name: 'Temp Layer To Delete' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'layer',
        targetId: layerId,
        mapId: map.id,
        timestamp: Date.now() + 1,
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const mapData = snapshot.maps.find(m => m.id === map.id);
      const found = mapData.layers.find(l => l.id === layerId);
      assert.equal(found, undefined, 'deleted layer should not appear in snapshot');
    });
  });

  describe('Multiple layer updates in batch', () => {
    it('updates name, visibility, and sort_order in a single batch', async () => {
      const layer = await createLayer(db, map.id, { name: 'Batch Layer', visible: true, sort_order: 0 });
      const now = Date.now();

      await pushSync([
        {
          id: randomUUID(),
          type: 'update',
          target: 'layer',
          targetId: layer.id,
          mapId: map.id,
          changes: { name: 'Batch Updated' },
          timestamp: now,
          clientId: 'test-client',
        },
        {
          id: randomUUID(),
          type: 'update',
          target: 'layer',
          targetId: layer.id,
          mapId: map.id,
          changes: { visible: false, sort_order: 10 },
          timestamp: now + 1,
          clientId: 'test-client',
        },
      ]).expect(200);

      const { rows } = await db.query('SELECT * FROM layers WHERE id = $1', [layer.id]);
      assert.equal(rows[0].name, 'Batch Updated');
      assert.equal(rows[0].visible, false);
      assert.equal(rows[0].sort_order, 10);
    });
  });

  describe('Layer in snapshot', () => {
    it('snapshot includes layer with all fields including order alias', async () => {
      const layerId = randomUUID();
      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'layer',
        targetId: layerId,
        mapId: map.id,
        data: { name: 'Snapshot Check Layer', visible: true, locked: false, opacity: 0.7, sort_order: 2 },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const mapData = snapshot.maps.find(m => m.id === map.id);
      const layer = mapData.layers.find(l => l.id === layerId);
      assert.ok(layer, 'layer should be in snapshot');
      assert.equal(layer.name, 'Snapshot Check Layer');
      assert.equal(layer.visible, true);
      assert.equal(layer.locked, false);
      assert.ok(typeof layer.order === 'number', 'should have order field (mapped from sort_order)');
    });
  });

});

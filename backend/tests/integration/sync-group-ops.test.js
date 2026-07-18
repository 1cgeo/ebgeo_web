// Path: tests/integration/sync-group-ops.test.js
// Tests for group update/delete operations via Sync API
// Covers: §14 items 3-5 (create group, combine/modify group, ungroup/delete)
// Also covers: group visibility, lock, hierarchy (parent_id), style

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createGroup, loginUser } from '../helpers/fixtures.js';

describe('Group Operations via Sync', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'group_ops_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
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

  describe('Update group name (§14 item 3 — rename)', () => {
    it('renames group via sync update', async () => {
      const group = await createGroup(db, map.id, { name: 'Original Group' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: group.id,
        mapId: map.id,
        changes: { name: 'Renamed Group' },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [group.id]);
      assert.equal(rows[0].name, 'Renamed Group');
    });
  });

  describe('Update group visibility', () => {
    it('hides group via sync', async () => {
      const group = await createGroup(db, map.id, { name: 'Visible Group', visible: true });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: group.id,
        mapId: map.id,
        changes: { visible: false },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [group.id]);
      assert.equal(rows[0].visible, false);
    });

    it('shows group via sync', async () => {
      const group = await createGroup(db, map.id, { name: 'Hidden Group', visible: false });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: group.id,
        mapId: map.id,
        changes: { visible: true },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [group.id]);
      assert.equal(rows[0].visible, true);
    });
  });

  describe('Lock/unlock group', () => {
    it('locks group via sync', async () => {
      const group = await createGroup(db, map.id, { name: 'Unlocked Group', locked: false });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: group.id,
        mapId: map.id,
        changes: { locked: true },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [group.id]);
      assert.equal(rows[0].locked, true);
    });

    it('unlocks group via sync', async () => {
      const group = await createGroup(db, map.id, { name: 'Locked Group', locked: true });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: group.id,
        mapId: map.id,
        changes: { locked: false },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [group.id]);
      assert.equal(rows[0].locked, false);
    });
  });

  describe('Update group style (JSONB)', () => {
    it('updates group style via sync', async () => {
      const group = await createGroup(db, map.id, { name: 'Style Group' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: group.id,
        mapId: map.id,
        changes: { style: { color: '#ff0000', borderWidth: 3 } },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [group.id]);
      assert.deepEqual(rows[0].style, { color: '#ff0000', borderWidth: 3 });
    });
  });

  describe('Group hierarchy (parent_id)', () => {
    it('sets group parent_id via sync update', async () => {
      const parent = await createGroup(db, map.id, { name: 'Parent Group' });
      const child = await createGroup(db, map.id, { name: 'Child Group' });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: child.id,
        mapId: map.id,
        changes: { parent_id: parent.id },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [child.id]);
      assert.equal(rows[0].parent_id, parent.id);
    });

    it('creates nested group via sync with parent_id', async () => {
      const parentId = randomUUID();
      const childId = randomUUID();
      const now = Date.now();

      await pushSync([
        {
          id: randomUUID(),
          type: 'create',
          target: 'group',
          targetId: parentId,
          mapId: map.id,
          data: { name: 'Sync Parent' },
          timestamp: now,
          clientId: 'test-client',
        },
        {
          id: randomUUID(),
          type: 'create',
          target: 'group',
          targetId: childId,
          mapId: map.id,
          data: { name: 'Sync Child', parent_id: parentId },
          timestamp: now + 1,
          clientId: 'test-client',
        },
      ]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [childId]);
      assert.equal(rows[0].parent_id, parentId);
    });

    it('removes parent (ungroup) by setting parent_id to null', async () => {
      const parent = await createGroup(db, map.id, { name: 'Parent For Ungroup' });
      const child = await createGroup(db, map.id, { name: 'Child For Ungroup', parent_id: parent.id });

      await pushSync([{
        id: randomUUID(),
        type: 'update',
        target: 'group',
        targetId: child.id,
        mapId: map.id,
        changes: { parent_id: null },
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [child.id]);
      assert.equal(rows[0].parent_id, null);
    });
  });

  describe('Delete group — §14 item 5 (ungroup)', () => {
    it('soft-deletes group via sync', async () => {
      const group = await createGroup(db, map.id, { name: 'To Delete Group' });

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'group',
        targetId: group.id,
        mapId: map.id,
        timestamp: Date.now(),
        clientId: 'test-client',
      }]).expect(200);

      const { rows } = await db.query('SELECT * FROM groups WHERE id = $1', [group.id]);
      assert.ok(rows[0].deleted_at, 'group should be soft-deleted');
    });

    it('deleted group is excluded from snapshot', async () => {
      const groupId = randomUUID();
      const now = Date.now();

      await pushSync([{
        id: randomUUID(),
        type: 'create',
        target: 'group',
        targetId: groupId,
        mapId: map.id,
        data: { name: 'Temp Group' },
        timestamp: now,
        clientId: 'test-client',
      }]).expect(200);

      await pushSync([{
        id: randomUUID(),
        type: 'delete',
        target: 'group',
        targetId: groupId,
        mapId: map.id,
        timestamp: now + 1,
        clientId: 'test-client',
      }]).expect(200);

      const snapshot = await getSnapshot();
      const mapData = snapshot.maps.find(m => m.id === map.id);
      const found = mapData.groups.find(g => g.id === groupId);
      assert.equal(found, undefined, 'deleted group should not appear in snapshot');
    });
  });

  describe('Group with features in snapshot', () => {
    it('snapshot includes group with associated features', async () => {
      const groupId = randomUUID();
      const featureId = randomUUID();
      const now = Date.now();

      // Create group, feature, and association
      await pushSync([
        {
          id: randomUUID(),
          type: 'create',
          target: 'group',
          targetId: groupId,
          mapId: map.id,
          data: { name: 'Group With Features' },
          timestamp: now,
          clientId: 'test-client',
        },
        {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: featureId,
          mapId: map.id,
          data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: 'Grouped Point' } },
          timestamp: now + 1,
          clientId: 'test-client',
        },
        {
          id: randomUUID(),
          type: 'create',
          target: 'group_feature',
          targetId: randomUUID(),
          mapId: map.id,
          data: { group_id: groupId, feature_id: featureId },
          timestamp: now + 2,
          clientId: 'test-client',
        },
      ]).expect(200);

      const snapshot = await getSnapshot();
      const mapData = snapshot.maps.find(m => m.id === map.id);
      const group = mapData.groups.find(g => g.id === groupId);
      assert.ok(group, 'group should exist in snapshot');
      assert.ok(Array.isArray(group.features), 'group should have features array');
      // Snapshot group.features is [{ type, id }], not plain IDs
      assert.ok(group.features.some(f => f.id === featureId), 'group features should include the associated feature');
    });
  });

});

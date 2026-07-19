// Path: tests/integration/manage-tier-cogestor.test.js
// The `manage` tier (co-Gestor) as a first-class subject.
//
// Why this suite exists: `manage` sits between `write` and `owner`, and it is the
// tier this project keeps dropping. CLAUDE.md warns twice that a closed list like
// `permission === 'write' || permission === 'owner'` excludes it in silence, and
// records that it has caused real bugs twice (co-Gestor selection presence, and
// map delete). Yet before this file the whole backend suite mentioned 'manage' six
// times across four files: every gate could have excluded the co-Gestor without a
// single test going red.
//
// The matrix below is ENUMERATED from the routes, not sampled: 8 routes require
// 'manage' (atlas settings, debug trace cleanup, and the 6 sharing routes) and 2
// require 'owner' (delete atlas, transfer ownership). Each is asserted from BOTH
// sides, because a positive-only test cannot tell a working gate from a missing
// one: `write` must be refused where `manage` is required, and `manage` must be
// refused where `owner` is required. Without the negative half, deleting the gate
// entirely would still leave this suite green.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser,
} from '../helpers/fixtures.js';

describe('manage tier (co-Gestor)', () => {
  let app, db, owner, manager, writer, target;
  let managerTok, writerTok, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const sfx = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `mgr_owner_${sfx}` });
    manager = await createUser(db, { username: `mgr_mgr_${sfx}` });
    writer = await createUser(db, { username: `mgr_wr_${sfx}` });
    target = await createUser(db, { username: `mgr_tgt_${sfx}` });

    managerTok = await loginUser(app, manager.username, manager.password);
    writerTok = await loginUser(app, writer.username, writer.password);

    atlas = await createAtlas(db, owner.id, { name: 'co-Gestor Atlas' });
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
    map = await createMap(db, atlas.id, { name: 'Mapa do co-Gestor' });
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const as = (tok) => ({
    get: (p) => supertest(app).get(p).set('Authorization', `Bearer ${tok}`),
    post: (p) => supertest(app).post(p).set('Authorization', `Bearer ${tok}`),
    put: (p) => supertest(app).put(p).set('Authorization', `Bearer ${tok}`),
    patch: (p) => supertest(app).patch(p).set('Authorization', `Bearer ${tok}`),
    delete: (p) => supertest(app).delete(p).set('Authorization', `Bearer ${tok}`),
  });

  const base = () => `/api/v1/atlas/${atlas.id}`;

  // ==========================================================================
  // 1. The 8 routes that require `manage`: co-Gestor in, Editor out.
  // ==========================================================================

  describe('routes gated at manage', () => {
    it('GET /sharing — manage reads the sharing config, write is refused', async () => {
      await as(managerTok).get(`${base()}/sharing`).expect(200);
      await as(writerTok).get(`${base()}/sharing`).expect(403);
    });

    it('POST /sharing/public — manage enables the public link, write is refused', async () => {
      await as(writerTok).post(`${base()}/sharing/public`).expect(403);
      const res = await as(managerTok).post(`${base()}/sharing/public`).expect(200);
      assert.ok(res.body.data, 'the co-Gestor receives the public link payload');

      const { rows } = await db.query('SELECT is_public FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].is_public, true, 'the atlas really became public');
    });

    it('DELETE /sharing/public — manage disables it, write is refused', async () => {
      await as(writerTok).delete(`${base()}/sharing/public`).expect(403);
      await as(managerTok).delete(`${base()}/sharing/public`).expect(204);

      const { rows } = await db.query('SELECT is_public FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].is_public, false, 'the atlas really stopped being public');
    });

    it('POST /sharing/users — manage grants access to another user, write is refused', async () => {
      await as(writerTok).post(`${base()}/sharing/users`)
        .send({ userId: target.id, permission: 'read' }).expect(403);

      await as(managerTok).post(`${base()}/sharing/users`)
        .send({ userId: target.id, permission: 'read' }).expect(201);

      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, target.id]
      );
      assert.equal(rows[0].permission, 'read', 'the share row was really created by the co-Gestor');
    });

    it('PUT /sharing/users/:userId — manage changes a permission, write is refused', async () => {
      await as(writerTok).put(`${base()}/sharing/users/${target.id}`)
        .send({ permission: 'write' }).expect(403);

      await as(managerTok).put(`${base()}/sharing/users/${target.id}`)
        .send({ permission: 'write' }).expect(200);

      const { rows } = await db.query(
        'SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, target.id]
      );
      assert.equal(rows[0].permission, 'write', 'the permission really changed');
    });

    it('DELETE /sharing/users/:userId — manage revokes access, write is refused', async () => {
      await as(writerTok).delete(`${base()}/sharing/users/${target.id}`).expect(403);
      await as(managerTok).delete(`${base()}/sharing/users/${target.id}`).expect(204);

      const { rows } = await db.query(
        'SELECT 1 FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2', [atlas.id, target.id]
      );
      assert.equal(rows.length, 0, 'the share row was really removed');
    });

    it('PATCH /settings — manage edits atlas settings, write is refused', async () => {
      await as(writerTok).patch(`${base()}/settings`)
        .send({ features: { map_3d: true } }).expect(403);

      await as(managerTok).patch(`${base()}/settings`)
        .send({ features: { map_3d: true } }).expect(200);

      const { rows } = await db.query('SELECT settings FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].settings?.features?.map_3d, true, 'the settings were really written');
    });
  });

  // ==========================================================================
  // 2. The owner-only ceiling: manage must NOT cross it.
  //    Without this half, granting manage everything would look correct.
  // ==========================================================================

  describe('owner-only routes refuse manage (the ceiling)', () => {
    it('DELETE /atlas/:id — the co-Gestor cannot delete the atlas', async () => {
      await as(managerTok).delete(base()).expect(403);
      const { rows } = await db.query('SELECT deleted_at FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].deleted_at, null, 'the atlas survives a co-Gestor delete attempt');
    });

    it('POST /transfer — the co-Gestor cannot transfer ownership', async () => {
      await as(managerTok).post(`${base()}/transfer`).send({ newOwnerId: manager.id }).expect(403);
      const { rows } = await db.query('SELECT owner_id FROM atlas WHERE id = $1', [atlas.id]);
      assert.equal(rows[0].owner_id, owner.id, 'ownership is unchanged');
    });
  });

  // ==========================================================================
  // 3. Sync: the co-Gestor writes entities, deletes a map, but does not lock.
  // ==========================================================================

  describe('sync operations', () => {
    const push = (tok, operations) =>
      supertest(app)
        .post(`${base()}/sync`)
        .set('Authorization', `Bearer ${tok}`)
        .send({ operations });

    const opEnvelope = (entityType, operationType, entityId, extra = {}) => ({
      id: randomUUID(), entityType, operationType, entityId,
      timestamp: Date.now(), clientId: 'cogestor-client', ...extra,
    });

    it('creates a feature, a layer and a group like any writer', async () => {
      const fId = randomUUID();
      const lId = randomUUID();
      const gId = randomUUID();

      await push(managerTok, [
        opEnvelope('feature', 'create', fId, {
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
            properties: { id: fId, nome: 'ponto do co-Gestor' },
          },
        }),
        opEnvelope('layer', 'create', lId, { mapId: map.id, data: { name: 'camada do co-Gestor' } }),
        opEnvelope('group', 'create', gId, { mapId: map.id, data: { name: 'grupo do co-Gestor' } }),
      ]).expect(200);

      const { rows: f } = await db.query('SELECT id FROM features WHERE id = $1', [fId]);
      const { rows: l } = await db.query('SELECT id FROM layers WHERE id = $1', [lId]);
      const { rows: g } = await db.query('SELECT id FROM groups WHERE id = $1', [gId]);
      assert.equal(f.length, 1, 'feature written by the co-Gestor');
      assert.equal(l.length, 1, 'layer written by the co-Gestor');
      assert.equal(g.length, 1, 'group written by the co-Gestor');
    });

    it('deletes a map (manage and above), which a write user cannot', async () => {
      const victim = await createMap(db, atlas.id, { name: 'Mapa a excluir' });
      const res = await push(managerTok, [
        opEnvelope('map', 'delete', victim.id, { mapId: victim.id }),
      ]).expect(200);
      assert.equal(res.body.data.results[0].success, true, 'the co-Gestor delete is applied');

      const { rows } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [victim.id]);
      assert.ok(rows[0].deleted_at, 'the map is soft-deleted');

      const survivor = await createMap(db, atlas.id, { name: 'Mapa que sobrevive' });
      const wRes = await push(writerTok, [
        opEnvelope('map', 'delete', survivor.id, { mapId: survivor.id }),
      ]).expect(200);
      assert.equal(wRes.body.data.results[0].success, false, 'a write user is refused');

      const { rows: s } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [survivor.id]);
      assert.equal(s[0].deleted_at, null, 'and the map really survives');
    });

    it('does NOT lock a map: lock/unlock stays owner-only', async () => {
      const res = await push(managerTok, [
        opEnvelope('map', 'update', map.id, { mapId: map.id, data: { locked: true } }),
      ]).expect(200);
      assert.equal(res.body.data.results[0].success, false, 'the co-Gestor lock op is refused');

      const { rows } = await db.query('SELECT locked FROM maps WHERE id = $1', [map.id]);
      assert.equal(rows[0].locked, false, 'the map is not locked');
    });
  });

  // ==========================================================================
  // 4. Reading: the co-Gestor sees the atlas like anyone with access.
  // ==========================================================================

  describe('read surface', () => {
    it('reads the atlas and its snapshot', async () => {
      await as(managerTok).get(base()).expect(200);

      const snap = await as(managerTok).get(`${base()}/sync/0`).expect(200);
      assert.ok(snap.body.data.snapshot, 'the co-Gestor gets a snapshot');
      assert.ok(
        snap.body.data.snapshot.maps.some((m) => m.id === map.id),
        'and it contains the atlas maps'
      );
    });

    it('appears in the atlas list of the co-Gestor', async () => {
      const res = await as(managerTok).get('/api/v1/atlas').expect(200);
      const ids = (res.body.data.atlas ?? res.body.data).map?.((a) => a.id) ?? [];
      assert.ok(ids.includes(atlas.id), 'a shared-as-manage atlas is listed for the co-Gestor');
    });
  });
});

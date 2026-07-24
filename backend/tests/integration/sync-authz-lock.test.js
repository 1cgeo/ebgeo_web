// Path: tests/integration/sync-authz-lock.test.js
// Per-operation authorization + map-lock enforcement on the sync push (multiuser
// spec §1.4/§1.5/§1.9/§2.5/§17.8). Since 2026-07-19 map-delete is gated by HIERARCHY
// at manage and above (owner + co-Gestor), not by equality against 'owner', which had
// been excluding the co-Gestor in silence; lock/unlock stays owner-only on purpose.
// A locked map must still block writes to its child entities.
// Every access filter gets a NEGATIVE (no-permission) test per CLAUDE.md.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createFeature, createShare, loginUser } from '../helpers/fixtures.js';

describe('Sync authorization + map-lock enforcement', () => {
  let app, db, owner, editor, ownerTok, editorTok, atlas, map, feat;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'authz_owner' });
    editor = await createUser(db, { username: 'authz_editor' });
    ownerTok = await loginUser(app, owner.username, owner.password);
    editorTok = await loginUser(app, editor.username, editor.password);
    atlas = await createAtlas(db, owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id); // editor = write share
    map = await createMap(db, atlas.id);
    feat = await createFeature(db, map.id); // seeded while unlocked, for the lock-delete test
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (token, op, expectStatus) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [op] })
      .expect(expectStatus);

  const op = (entityType, operationType, entityId, extra = {}) => ({
    id: randomUUID(), entityType, operationType, entityId,
    timestamp: Date.now(), clientId: 'authz-client', ...extra,
  });

  const mapRow = async () => (await db.query('SELECT locked, deleted_at FROM maps WHERE id = $1', [map.id])).rows[0];

  // ---- Authorization: map-delete is owner-only ----

  it('OWNER can delete a map', async () => {
    const m2 = await createMap(db, atlas.id);
    await push(ownerTok, op('map', 'delete', m2.id), 200);
    const { rows } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [m2.id]);
    assert.ok(rows[0].deleted_at, 'owner soft-deletes the map');
  });

  // The refusal is now reported PER OPERATION (200 + success:false) instead of
  // failing the whole batch with 403. The authorization itself is unchanged and is
  // still asserted below: what changed is that one denied op no longer rolls back
  // its siblings, which used to freeze the client's queue forever. Tier violations
  // (read/comment) still 403 the batch. See sync-denied-op-poison.repro.test.js.

  it('a WRITE user CANNOT delete a map (refused per-op, map untouched) — negative', async () => {
    const res = await push(editorTok, op('map', 'delete', map.id), 200);
    assert.equal((await mapRow()).deleted_at, null, 'map must NOT be soft-deleted by a write user');
    const ack = res.body.data.results[0];
    assert.equal(ack.success, false, 'the op is acked as refused, never as applied');
    assert.match(ack.reason, /co-Gestor/i, 'the ack names the required tier, so the client can surface it');
  });

  // The co-Gestor (manage tier) is the whole point of gating by hierarchy instead of
  // by equality against 'owner'. `permission !== 'owner'` excluded manage in silence,
  // which is the closed-list trap the constitution forbids in two places.
  it('a MANAGE user CAN delete a map (hierarchy, not equality to owner)', async () => {
    const manager = await createUser(db, { username: `authz_mgr_${randomUUID().slice(0, 8)}` });
    const managerTok = await loginUser(app, manager.username, manager.password);
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);
    const victim = await createMap(db, atlas.id, { name: 'Manager Deletes This' });

    const res = await push(managerTok, op('map', 'delete', victim.id), 200);
    assert.equal(res.body.data.results[0].success, true, 'the co-Gestor op is applied, not refused');

    const { rows } = await db.query('SELECT deleted_at FROM maps WHERE id = $1', [victim.id]);
    assert.ok(rows[0].deleted_at, 'the map is soft-deleted by the co-Gestor');
  });

  // ---- Authorization: map lock/unlock is owner-only ----

  it('a WRITE user CANNOT lock a map (refused per-op, locked unchanged) — negative', async () => {
    const res = await push(editorTok, op('map', 'update', map.id, { data: { locked: true } }), 200);
    assert.equal((await mapRow()).locked, false, 'a write user must NOT flip locked');
    assert.equal(res.body.data.results[0].success, false, 'the op is acked as refused');
  });

  it('OWNER can lock a map', async () => {
    await push(ownerTok, op('map', 'update', map.id, { data: { locked: true } }), 200);
    assert.equal((await mapRow()).locked, true);
  });

  // ---- Lock enforcement: a locked map blocks child writes ----

  const geoFeature = (id) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
    properties: { id, source: 'point', nome: 'X' },
  });

  // Locked-map refusal moved to the SAME per-op shape as the map-delete refusal
  // above (200 + success:false), and for the same reason: a ConflictError thrown
  // inside the batch transaction rolled back its siblings and returned 409, which
  // the client never dequeues — one locked map froze the whole outbound queue,
  // including ops for other maps. The authorization is unchanged and still
  // asserted: nothing is written while the map is locked.
  it('a write user CANNOT CREATE a feature on a locked map (refused per-op) — negative', async () => {
    const fId = randomUUID();
    const res = await push(editorTok, op('feature', 'create', fId, { mapId: map.id, data: geoFeature(fId) }), 200);
    assert.equal(res.body.data.results[0].success, false, 'the op is acked as refused, never as applied');
    const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [fId]);
    assert.equal(rows.length, 0, 'no feature is created on a locked map');
  });

  it('a write user CANNOT DELETE a feature on a locked map (refused per-op) — negative', async () => {
    const res = await push(editorTok, op('feature', 'delete', feat.id, { mapId: map.id }), 200);
    assert.equal(res.body.data.results[0].success, false, 'the op is acked as refused, never as applied');
    const { rows } = await db.query('SELECT deleted_at FROM features WHERE id = $1', [feat.id]);
    assert.equal(rows[0].deleted_at, null, 'the feature is NOT deleted while the map is locked');
  });

  it('OWNER unlocks the map and writes resume', async () => {
    await push(ownerTok, op('map', 'update', map.id, { data: { locked: false } }), 200);
    assert.equal((await mapRow()).locked, false);

    const fId = randomUUID();
    await push(editorTok, op('feature', 'create', fId, { mapId: map.id, data: geoFeature(fId) }), 200);
    const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [fId]);
    assert.equal(rows.length, 1, 'writes succeed again after unlock');
  });
});

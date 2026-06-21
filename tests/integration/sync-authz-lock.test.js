// Path: tests/integration/sync-authz-lock.test.js
// Per-operation authorization + map-lock enforcement on the sync push (multiuser
// spec §1.4/§1.5/§1.9/§2.5/§17.8). The doc reserves map-delete and map lock/unlock
// for the atlas OWNER, and a locked map must block writes to its child entities.
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

  it('a WRITE user CANNOT delete a map (403, map untouched) — negative', async () => {
    await push(editorTok, op('map', 'delete', map.id), 403);
    assert.equal((await mapRow()).deleted_at, null, 'map must NOT be soft-deleted by a write user');
  });

  // ---- Authorization: map lock/unlock is owner-only ----

  it('a WRITE user CANNOT lock a map (403, locked unchanged) — negative', async () => {
    await push(editorTok, op('map', 'update', map.id, { data: { locked: true } }), 403);
    assert.equal((await mapRow()).locked, false, 'a write user must NOT flip locked');
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

  it('a write user CANNOT CREATE a feature on a locked map (409) — negative', async () => {
    const fId = randomUUID();
    await push(editorTok, op('feature', 'create', fId, { mapId: map.id, data: geoFeature(fId) }), 409);
    const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [fId]);
    assert.equal(rows.length, 0, 'no feature is created on a locked map');
  });

  it('a write user CANNOT DELETE a feature on a locked map (409) — negative', async () => {
    await push(editorTok, op('feature', 'delete', feat.id, { mapId: map.id }), 409);
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

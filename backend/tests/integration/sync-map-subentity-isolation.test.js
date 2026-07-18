// Path: tests/integration/sync-map-subentity-isolation.test.js
// A sub-typed map update (mapPosition/baseLayer/mapNotes/gridStyle/mapTemporal)
// must ONLY touch its own column(s). A sibling column smuggled in the payload
// (e.g. a `name` riding alongside a temporal_config) must be DROPPED, not applied.
// Regression for the sibling-column-smuggling gap found in the FE↔BE integration audit.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Sync map sub-entity isolation (no sibling-column smuggling)', () => {
  let app, db, user, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    user = await createUser(db, { username: 'subentity_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
    // Pin a known name + base_layer + unlocked state to detect any overwrite.
    await db.query(
      "UPDATE maps SET name = 'Original', base_layer = 'carta-topografica', locked = false WHERE id = $1",
      [map.id]
    );
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (op) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [op] });

  const mapRow = async () => (await db.query('SELECT * FROM maps WHERE id = $1', [map.id])).rows[0];

  const subOp = (entityType, data) => ({
    id: randomUUID(),
    entityType,
    operationType: 'update',
    entityId: map.id,
    mapId: map.id,
    data,
    timestamp: Date.now(),
    clientId: 'iso-client',
  });

  it('mapTemporal applies temporal_config but DROPS a smuggled name/base_layer', async () => {
    await push(subOp('mapTemporal', { ativo: true, unidade: 'DIA', name: 'HACK', base_layer: 'evil' })).expect(200);
    const m = await mapRow();
    assert.equal(m.name, 'Original', 'name must NOT be overwritten by a temporal sub-op');
    assert.equal(m.base_layer, 'carta-topografica', 'base_layer must NOT be overwritten');
    assert.equal(m.temporal_config.ativo, true);
    assert.equal(m.temporal_config.unidade, 'DIA');
  });

  it('gridStyle applies grid_style but DROPS a smuggled name', async () => {
    await push(subOp('gridStyle', { format: 'utm', visible: true, name: 'HACK2' })).expect(200);
    const m = await mapRow();
    assert.equal(m.name, 'Original');
    assert.equal(m.grid_style.format, 'utm');
  });

  it('mapNotes applies notes but DROPS a smuggled name/locked', async () => {
    await push(subOp('mapNotes', { title: 'Notas', description: '<p>x</p>', name: 'HACK3', locked: true })).expect(200);
    const m = await mapRow();
    assert.equal(m.name, 'Original');
    assert.equal(m.notes_title, 'Notas');
    assert.equal(m.locked, false, 'a notes sub-op must NOT flip locked');
  });

  it('baseLayer applies base_layer but DROPS a smuggled name', async () => {
    await push(subOp('baseLayer', { baseLayer: 'carta-ortoimagem', name: 'HACK4' })).expect(200);
    const m = await mapRow();
    assert.equal(m.name, 'Original');
    assert.equal(m.base_layer, 'carta-ortoimagem');
  });

  it('mapPosition applies the viewport but DROPS a smuggled name', async () => {
    await push(subOp('mapPosition', { center_lat: -15.5, center_long: -47.8, zoom: 12, name: 'HACK5' })).expect(200);
    const m = await mapRow();
    assert.equal(m.name, 'Original');
    assert.equal(Number(m.center_lat), -15.5);
    assert.equal(Number(m.zoom), 12);
  });

  it('a PLAIN map update (no sub-type) CAN still change the name', async () => {
    await push({
      id: randomUUID(),
      entityType: 'map',
      operationType: 'update',
      entityId: map.id,
      data: { name: 'Renamed' },
      timestamp: Date.now(),
      clientId: 'iso-client',
    }).expect(200);
    const m = await mapRow();
    assert.equal(m.name, 'Renamed', 'a plain map update still updates the name');
  });
});

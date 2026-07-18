// Path: tests/integration/sync-catalog-layer.test.js
// Fase 1 Tarefa 4: catalogLayer as a per-layer entity (dedicated table), with
// backward-compatible support for the legacy whole-array form.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Sync — catalogLayer (per-layer)', () => {
  let app, db, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    owner = await createUser(db, { username: 'catlayer_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Catalog Layer Atlas' });
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (operations) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations })
      .expect(200);

  const op = (operationType, entityId, data) => ({
    id: randomUUID(),
    entityType: 'catalogLayer',
    operationType,
    entityId,
    mapId: map.id,
    data,
    timestamp: Date.now(),
    clientId: 'c1',
  });

  it('create/update/delete per-layer and exposes survivors in the snapshot', async () => {
    const layer1 = randomUUID();
    const layer2 = randomUUID();

    await push([op('create', layer1, { type: 'wms', name: 'Layer 1', visible: true })]);
    await push([op('create', layer2, { type: 'wms', name: 'Layer 2', visible: true })]);

    // Both rows exist in the dedicated table
    let rows = await db.query('SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL', [map.id]);
    assert.equal(rows.rows.length, 2);

    // Update layer1; delete layer2
    await push([op('update', layer1, { type: 'wms', name: 'Layer 1 (edited)', visible: false })]);
    await push([op('delete', layer2, {})]);

    rows = await db.query('SELECT id, data FROM catalog_layers WHERE map_id = $1 AND deleted_at IS NULL', [map.id]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].id, layer1);
    assert.equal(rows.rows[0].data.name, 'Layer 1 (edited)');
    assert.equal(rows.rows[0].data.visible, false);

    // Snapshot exposes map.catalogLayers (per-id) with the survivor
    const snap = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const snapMap = snap.body.data.snapshot.maps.find((m) => m.id === map.id);
    assert.ok(Array.isArray(snapMap.catalogLayers));
    assert.equal(snapMap.catalogLayers.length, 1);
    assert.equal(snapMap.catalogLayers[0].id, layer1);
    assert.equal(snapMap.catalogLayers[0].name, 'Layer 1 (edited)');
  });

  it('still supports the legacy whole-array form (writes maps.catalog_layers)', async () => {
    const arr = [{ id: 'wms-a', visible: true }, { id: 'wms-b', visible: false }];
    await push([op('update', randomUUID(), { catalog_layers: arr })]);

    const { rows } = await db.query('SELECT catalog_layers FROM maps WHERE id = $1', [map.id]);
    assert.deepEqual(rows[0].catalog_layers, arr);
  });
});

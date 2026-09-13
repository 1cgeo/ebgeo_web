import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';

describe('Catalog replay preserves textual identities', () => {
  let app, db, token, atlas, map;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    const owner = await createUser(db, { username: 'catalog_replay_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id);
  });
  after(async () => teardownTestEnv(db));
  const op = (operationType, entityId, data = null) => ({
    protocolVersion: 2, id: randomUUID(), entityType: 'catalogLayer', operationType,
    entityId, mapId: map.id, data, timestamp: Date.now(), clientId: 'catalog-replay-test'
  });
  const push = operations => supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
    .set('Authorization', `Bearer ${token}`).send({ operations }).expect(200);
  const pull = cursor => supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/${cursor}`)
    .set('Authorization', `Bearer ${token}`).expect(200);

  it('create, update and payload-free delete replay with the original layer and operation IDs', async () => {
    const baseline = await push([op('create', 'control', { type: 'hillshade' })]);
    const edits = [op('create', 'hillshade', { id: 'hillshade', type: 'hillshade', opacity: 0.8 }),
      op('update', 'hillshade', { id: 'hillshade', type: 'hillshade', opacity: 0.3 }), op('delete', 'hillshade')];
    await push(edits);
    const { body } = await pull(baseline.body.data.serverVersion);
    assert.equal(body.data.isSnapshot, false);
    assert.deepEqual(body.data.operations.map(item => item.id), edits.map(item => item.id));
    assert.deepEqual(body.data.operations.map(item => item.entityId), ['hillshade', 'hillshade', 'hillshade']);
    assert.ok(body.data.operations.every(item => item.mapId === map.id));
    const rows = await db.query('SELECT client_entity_id FROM operations WHERE op_id=ANY($1::text[])', [edits.map(item => item.id)]);
    assert.ok(rows.rows.every(row => row.client_entity_id === 'hillshade'));
  });

  it('an old deletion with a lost textual identity requires an authoritative snapshot', async () => {
    const baseline = await push([op('create', 'control-legacy', { type: 'hillshade' })]);
    const edits = [op('create', 'hillshade', { id: 'hillshade', type: 'hillshade' }), op('delete', 'hillshade')];
    await push(edits);
    await db.query('UPDATE operations SET client_entity_id=NULL WHERE op_id=ANY($1::text[])', [edits.map(item => item.id)]);
    const { body } = await pull(baseline.body.data.serverVersion);
    assert.equal(body.data.isSnapshot, true);
    const restored = body.data.snapshot.maps.find(item => item.id === map.id);
    assert.ok(!restored.catalogLayers.some(layer => layer.id === 'hillshade'));
  });

  it('a history row with a lost target cannot confirm a different deletion under the same operation ID', async () => {
    const deletion = op('delete', 'hillshade');
    await push([deletion]);
    await db.query('DELETE FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2', [atlas.id, deletion.id]);
    await db.query('UPDATE operations SET client_entity_id=NULL WHERE atlas_id=$1 AND op_id=$2', [atlas.id, deletion.id]);
    const result = await push([{ ...deletion, entityId: 'another-layer' }]);
    assert.equal(result.body.data.results[0].rejected, true);
    const receipt = await db.query('SELECT result FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2', [atlas.id, deletion.id]);
    assert.equal(receipt.rows[0].result.status, 'rejected');
  });

  it('a preserved target can still confirm the original deletion when only its history exists', async () => {
    const deletion = op('delete', 'known-layer');
    await push([deletion]);
    await db.query('DELETE FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2', [atlas.id, deletion.id]);
    const result = await push([deletion]);
    assert.equal(result.body.data.results[0].rejected, undefined);
    const receipt = await db.query('SELECT result FROM sync_receipts WHERE atlas_id=$1 AND op_id=$2', [atlas.id, deletion.id]);
    assert.equal(receipt.rows[0].result.status, 'applied');
  });
});

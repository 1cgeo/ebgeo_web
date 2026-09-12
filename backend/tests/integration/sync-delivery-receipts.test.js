// Path: tests/integration/sync-delivery-receipts.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { cleanupOldOperations } from '../../src/modules/sync/sync.service.js';

describe('Durable delivery receipts', () => {
  let app, db, user, atlas, map, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    user = await createUser(db, { username: 'audit_sync_review' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });
  after(async () => { await teardownTestEnv(db); });
  const op = (type, entity, data) => ({
    id: randomUUID(), type, target: 'feature', targetId: entity,
    mapId: map.id, data, timestamp: Date.now(), clientId: 'audit-client',
  });
  const push = async (...operations) => (await supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/sync`).set('Authorization', `Bearer ${token}`)
    .send({ operations }).expect(200)).body.data;
  const row = async id => (await db.query('SELECT * FROM features WHERE id=$1', [id])).rows[0];
  const data = x => ({ feature_type: 'point', geometry: { type: 'Point', coordinates: [x, 0] }, properties: { name: 'original' } });

  it('changed payload under same op id is rejected', async () => {
    const id = randomUUID();
    const original = op('create', id, data(1));
    await push(original);
    const result = await push({ ...original, data: data(2) });
    assert.equal(result.results[0].rejected, true);
    assert.deepEqual((await row(id)).geometry.coordinates, [1, 0]);
  });

  it('cleanup preserves deduplication and a retry preserves the newer value', async () => {
    const id = randomUUID();
    await push(op('create', id, data(1)));
    const old = { ...op('update', id, null), changes: { properties: { name: 'old' } } };
    await push(old);
    const latest = await push({ ...op('update', id, null), changes: { properties: { name: 'latest' } } });
    await cleanupOldOperations(atlas.id, { keepFromVersion: latest.results[0].currentVersion });
    const retry = await push(old);
    assert.equal(retry.results[0].idempotent, true);
    assert.equal((await row(id)).properties.name, 'latest');
  });

  it('create referencing absent map is rejected', async () => {
    const id = randomUUID();
    const result = await push({ ...op('create', id, data(1)), mapId: randomUUID() });
    assert.equal(result.results[0].success, false);
    assert.equal(await row(id), undefined);
  });

  it('a refused operation remains refused when its missing parent is later created', async () => {
    const id = randomUUID();
    const missingMapId = randomUUID();
    const original = { ...op('create', id, data(1)), mapId: missingMapId };
    const first = await push(original);
    assert.equal(first.results[0].status, 'rejected');
    assert.equal(first.results[0].currentVersion, null);
    await db.query('INSERT INTO maps (id, atlas_id, name) VALUES ($1, $2, $3)',
      [missingMapId, atlas.id, 'Destino posterior']);
    const retry = await push(original);
    assert.equal(retry.results[0].status, 'rejected');
    assert.equal(retry.results[0].reason, first.results[0].reason);
    assert.equal(retry.results[0].idempotent, true);
    assert.equal(await row(id), undefined);
    const corrected = await push({ ...original, id: randomUUID() });
    assert.equal(corrected.results[0].status, 'applied');
    assert.ok(await row(id));
  });
});

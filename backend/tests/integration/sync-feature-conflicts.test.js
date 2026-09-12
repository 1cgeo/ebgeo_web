import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { cleanupOldOperations } from '../../src/modules/sync/sync.service.js';

describe('Feature field conflicts with durable server revisions', () => {
  let app, db, user, atlas, map, token;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    user = await createUser(db, { username: 'field_conflict_user' });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });
  after(async () => teardownTestEnv(db));
  const operation = (entityId, operationType, extra = {}) => ({ id: randomUUID(), protocolVersion: 2,
    entityType: 'feature', entityId, operationType, mapId: map.id,
    timestamp: Date.now(), clientId: 'field-client', ...extra });
  const push = async (...operations) => (await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
    .set('Authorization', `Bearer ${token}`).send({ operations }).expect(200)).body.data;
  const create = async () => {
    const id = randomUUID();
    const op = operation(id, 'create', { data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { id, source: 'point', name: 'Inicial', color: 'blue' } } });
    const result = await push(op);
    assert.equal(result.results[0].status, 'applied');
    return { id, op, version: result.results[0].entityVersion };
  };
  const change = (id, baseVersion, path, value) => operation(id, 'update', { baseVersion, patch: [{ op: 'set', path, value }] });
  const row = async id => (await db.query('SELECT * FROM features WHERE id=$1', [id])).rows[0];

  it('merges independent name and geometry edits from the same base', async () => {
    const { id, version } = await create();
    await push(change(id, version, ['properties', 'name'], 'Nome atualizado'));
    const accepted = await push(change(id, version, ['geometry'], { type: 'Point', coordinates: [5, 6] }));
    assert.equal(accepted.results[0].status, 'applied');
    const stored = await row(id);
    assert.equal(stored.properties.name, 'Nome atualizado');
    assert.deepEqual(stored.geometry.coordinates, [5, 6]);
    assert.equal(accepted.results[0].canonicalOperation.data.properties.name, 'Nome atualizado');
    assert.equal(accepted.results[0].canonicalOperation.data.properties.confirmedVersion, accepted.results[0].entityVersion);
  });

  it('keeps the server value on same-field conflict even after replay cleanup', async () => {
    const { id, version } = await create();
    const winner = await push(change(id, version, ['properties', 'name'], 'Servidor'));
    await cleanupOldOperations(atlas.id, { keepFromVersion: winner.serverVersion + 1 });
    const stale = change(id, version, ['properties', 'name'], 'Antigo');
    const rejected = await push(stale);
    assert.equal(rejected.results[0].status, 'conflict');
    assert.deepEqual(rejected.results[0].conflict.fields, [['properties', 'name']]);
    assert.equal(rejected.results[0].conflict.serverData.properties.name, 'Servidor');
    assert.equal(rejected.events.length, 0);
    assert.equal((await row(id)).properties.name, 'Servidor');
    const repeated = await push(stale);
    assert.equal(repeated.results[0].status, 'conflict');
    assert.equal(repeated.results[0].idempotent, true);
  });

  it('does not resurrect a tombstone through stale create or edit', async () => {
    const { id, op, version } = await create();
    await push(operation(id, 'delete', { baseVersion: version }));
    const results = await push({ ...op, id: randomUUID() }, change(id, version, ['properties', 'name'], 'Ressuscitado'));
    assert.deepEqual(results.results.map(result => result.status), ['conflict', 'conflict']);
    assert.ok((await row(id)).deleted_at);
  });

  it('uses a confirmed predecessor for sequential offline edits but still checks concurrent changes', async () => {
    const { id, op } = await create();
    const first = { ...change(id, null, ['properties', 'name'], 'Primeira'), baseOperationId: op.id };
    assert.equal((await push(first)).results[0].status, 'applied');
    const second = { ...change(id, null, ['properties', 'name'], 'Segunda'), baseOperationId: first.id };
    assert.equal((await push(second)).results[0].status, 'applied');
    const delayed = { ...change(id, null, ['properties', 'name'], 'Atrasada'), baseOperationId: first.id };
    assert.equal((await push(delayed)).results[0].status, 'conflict');
    assert.equal((await row(id)).properties.name, 'Segunda');
  });

  it('does not invent a base for legacy work or trust a frontier after external mutation', async () => {
    const { id, version } = await create();
    assert.equal((await push(change(id, null, ['properties', 'name'], 'Sem base'))).results[0].status, 'conflict');
    await db.query('UPDATE features SET version=version+1 WHERE id=$1', [id]);
    assert.equal((await push(change(id, version, ['properties', 'color'], 'red'))).results[0].status, 'conflict');
  });
});

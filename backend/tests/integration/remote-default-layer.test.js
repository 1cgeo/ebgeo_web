import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createLayer, loginUser } from '../helpers/fixtures.js';

describe('Server-owned default layers', () => {
  let app, db, user, token, atlas;
  before(async () => {
    ({ app, db } = await setupTestEnv());
    user = await createUser(db);
    token = await loginUser(app, user.username, user.password);
    atlas = (await supertest(app).post('/api/v1/atlas').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Camadas reais' }).expect(201)).body.data;
  });
  after(async () => teardownTestEnv(db));
  const op = (entityType, operationType, entityId, mapId, data) => ({ protocolVersion: 2,
    id: randomUUID(), entityType, operationType, entityId, mapId, data,
    timestamp: Date.now(), clientId: 'default-layer-test',
  });
  const push = async (...operations) => (await supertest(app).post(`/api/v1/atlas/${atlas.id}/sync`)
    .set('Authorization', `Bearer ${token}`).send({ operations }).expect(200)).body.data;
  const snapshot = async () => (await supertest(app).get(`/api/v1/atlas/${atlas.id}/sync/0`)
    .set('Authorization', `Bearer ${token}`).expect(200)).body.data.snapshot;
  const layers = async (mapId) => (await db.query('SELECT * FROM layers WHERE map_id=$1 AND deleted_at IS NULL', [mapId])).rows;
  const newMap = async () => {
    const id = randomUUID();
    const command = op('map', 'create', id, null, { id, name: 'Novo mapa' });
    const result = await push(command);
    assert.equal(result.results[0].status, 'applied');
    return { id, command, result };
  };

  it('API atlas creation commits its initial map and UUID layer before opening a browser', async () => {
    const snap = await snapshot();
    assert.equal(snap.maps.length, 1);
    assert.equal(snap.maps[0].name, 'Mapa 1');
    assert.equal(snap.maps[0].layers.length, 1);
    assert.equal(snap.maps[0].layers[0].name, 'Padrão');
    assert.match(snap.maps[0].layers[0].id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(atlas.map_order, [snap.maps[0].id]);
  });

  it('map CREATE returns the persisted layer identically in ACK, retry, replay and snapshot', async () => {
    const { id, command, result } = await newMap();
    const canonical = result.results[0].canonicalOperation;
    const stored = await layers(id);
    assert.equal(stored.length, 1);
    assert.equal(canonical.data.layers[0].id, stored[0].id);
    const retry = await push(command);
    assert.deepEqual(retry.results[0].canonicalOperation, canonical);
    assert.equal((await layers(id)).length, 1);
    const logged = (await db.query('SELECT data FROM operations WHERE atlas_id=$1 AND op_id=$2', [atlas.id, command.id])).rows[0];
    assert.deepEqual(logged.data.layers, canonical.data.layers);
    assert.equal((await snapshot()).maps.find(m => m.id === id).layers[0].id, stored[0].id);
  });

  it('default layer configuration survives sync and reopening', async () => {
    const { id } = await newMap();
    const [layer] = await layers(id);
    const result = await push(op('layer', 'update', layer.id, id,
      { name: 'Planejamento', locked: true, visible: false, opacity: 0.4 }));
    assert.equal(result.results[0].status, 'applied');
    const saved = (await snapshot()).maps.find(m => m.id === id).layers[0];
    assert.equal(saved.name, 'Planejamento');
    assert.equal(saved.locked, true);
    assert.equal(saved.visible, false);
    assert.equal(saved.opacity, 0.4);
  });

  it('resolving an implicit layer does not change the receipt identity of flat v2 create/update envelopes', async () => {
    const { id } = await newMap();
    const featureId = randomUUID();
    const create = op('feature', 'create', featureId, id, { feature_type: 'point',
      geometry: { type: 'Point', coordinates: [2, 3] }, properties: { name: 'Legado' } });
    const first = await push(create);
    const replay = await push(create);
    assert.equal(replay.results[0].status, 'already_applied');
    assert.equal(replay.results[0].currentVersion, first.results[0].currentVersion);
    const update = { ...op('feature', 'update', featureId, id),
      baseVersion: first.results[0].entityVersion,
      patch: [{ op: 'set', path: ['properties', 'layerId'], value: null },
        { op: 'set', path: ['properties', 'name'], value: 'Legado atualizado' }],
      changes: { layer_id: null, properties: { name: 'Legado atualizado' } } };
    const changed = await push(update);
    const repeated = await push(update);
    assert.equal(repeated.results[0].status, 'already_applied');
    assert.equal(repeated.results[0].currentVersion, changed.results[0].currentVersion);
    assert.equal((await db.query('SELECT version FROM features WHERE id=$1', [featureId])).rows[0].version, 2);
  });

  it('legacy default feature becomes a real layer member and follows its deletion cascade', async () => {
    const { id } = await newMap();
    const [layer] = await layers(id);
    const featureId = randomUUID();
    const create = op('feature', 'create', featureId, id, { type: 'Feature',
      geometry: { type: 'Point', coordinates: [2, 3] }, properties: { id: featureId, source: 'point', layerId: 'default' } });
    create.protocolVersion = 2;
    const result = await push(create);
    assert.equal(result.results[0].canonicalOperation.data.properties.layerId, layer.id);
    assert.equal((await db.query('SELECT layer_id FROM features WHERE id=$1', [featureId])).rows[0].layer_id, layer.id);
    const command = op('layer', 'delete', layer.id, id);
    const deleted = await push(command);
    const [replacement] = await layers(id);
    assert.notEqual(replacement.id, layer.id);
    assert.equal(deleted.results[0].canonicalOperation.data.replacementLayers[0].id, replacement.id);
    assert.ok((await db.query('SELECT deleted_at FROM features WHERE id=$1', [featureId])).rows[0].deleted_at);
    await push(command);
    assert.deepEqual((await layers(id)).map(l => l.id), [replacement.id]);
  });

  it('two concurrent last-layer deletions serialize to one replacement', async () => {
    const { id } = await newMap();
    const [first] = await layers(id);
    const second = await createLayer(db, id);
    const results = await Promise.all([
      push(op('layer', 'delete', first.id, id)), push(op('layer', 'delete', second.id, id)),
    ]);
    assert.equal((await layers(id)).length, 1);
    assert.equal(results.flatMap(r => r.results[0].canonicalOperation.data.replacementLayers).length, 1);
  });

  it('an offline creation naming the deleted layer is refused instead of becoming invisible or changing layers', async () => {
    const { id } = await newMap();
    const [layer] = await layers(id);
    await push(op('layer', 'delete', layer.id, id));
    const featureId = randomUUID();
    const result = await push(op('feature', 'create', featureId, id, { type: 'Feature',
      geometry: { type: 'Point', coordinates: [1, 2] },
      properties: { id: featureId, source: 'point', layerId: layer.id } }));
    assert.equal(result.results[0].rejected, true);
    assert.match(result.results[0].reason, /camada de destino/);
    assert.equal((await db.query('SELECT id FROM features WHERE id=$1', [featureId])).rows.length, 0);
  });

  it('cross-atlas deletion cannot create layers or delete the foreign layer', async () => {
    const other = await createAtlas(db, user.id);
    const map = await createMap(db, other.id);
    const layer = await createLayer(db, map.id);
    const result = await push(op('layer', 'delete', layer.id, map.id));
    assert.equal(result.results[0].canonicalOperation, undefined);
    assert.deepEqual((await layers(map.id)).map(l => l.id), [layer.id]);
  });

  it('upgrade keeps legacy features/configuration, creates missing layers once and invalidates old cursors', async () => {
    const old = await createAtlas(db, user.id);
    const empty = await createMap(db, old.id);
    const configured = await createMap(db, old.id);
    const existing = await createLayer(db, configured.id, { name: 'Conservar', locked: true, opacity: 0.3 });
    const feature = (await db.query(`INSERT INTO features (map_id, feature_type, geometry, properties)
      VALUES ($1,'point','{"type":"Point","coordinates":[3,4]}','{"source":"point","name":"Preservar","layerId":"default"}') RETURNING *`, [empty.id])).rows[0];
    const dir = new URL('../../src/database/migrations/', import.meta.url);
    const filename = (await readdir(dir)).find(name => name.endsWith('_camadas_remotas.sql'));
    const sql = await readFile(new URL(filename, dir), 'utf8');
    await db.query(sql);
    const [defaultLayer] = await layers(empty.id);
    const saved = (await db.query('SELECT * FROM features WHERE id=$1', [feature.id])).rows[0];
    assert.equal(saved.layer_id, defaultLayer.id);
    assert.equal(saved.properties.name, 'Preservar');
    assert.deepEqual(saved.geometry, feature.geometry);
    assert.equal(saved.deleted_at, null);
    assert.equal(saved.version, feature.version + 1);
    assert.deepEqual(await layers(configured.id), [existing]);
    const frontier = (await db.query('SELECT current_version, min_version FROM atlas WHERE id=$1', [old.id])).rows[0];
    assert.ok(Number(frontier.min_version) > 0);
    assert.equal(frontier.current_version, frontier.min_version);
    await db.query(sql);
    assert.deepEqual((await layers(empty.id)).map(l => l.id), [defaultLayer.id]);
  });
});

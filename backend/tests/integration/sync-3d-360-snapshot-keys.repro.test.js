// Path: tests/integration/sync-3d-360-snapshot-keys.repro.test.js
// Regression: the snapshot transform used to KEY camera positions by tileset_id and orientations by
// photo_name, and SILENTLY DROP any row whose keying column was null (transformCesium3dToFrontend /
// transformStreetview360ToFrontend). Such a row persisted in Postgres but never appeared in a fresh
// client's snapshot — silent data loss. The normal app always sets the key, so this was a latent
// trap; the fix falls back to the row `id` so a persisted row is NEVER dropped. We also pin that the
// normal keyed case is unchanged.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, loginUser, seedCatalogRefs, dropCatalogRefs,
} from '../helpers/fixtures.js';

// ============================================================================================
// AS REFERÊNCIAS DE CATÁLOGO QUE AS OPS DESTE ARQUIVO CARREGAM.
//
// Desde que `unseenResourceDenialReason` cobre as CINCO superfícies (e não só a camada de
// catálogo), uma op cujo `tilesetId`/`photoName`/`modelId`/`photoId`/`baseLayer` não resolve
// para um recurso que o autor ENXERGA é recusada POR OPERAÇÃO — e "não existe" conta como "não
// posso ver", para que o ack não vire oráculo de existência sobre o acervo privado.
//
// Este arquivo mede outra coisa (envelope, alias, snapshot, isolamento), então a referência aqui
// é só CENÁRIO: ela existe e é pública. Quem mede o gate em si é
// `tests/integration/sync-referencia-privada.test.js`.
//
// O gancho é de RAIZ (fora de qualquer `describe`) porque o arquivo tem vários blocos e a
// semeadura é do arquivo inteiro; a limpeza é obrigatória porque as tabelas de catálogo e o
// schema `sv360` são compartilhados pela suíte.
// ============================================================================================
const REFS_DE_CATALOGO = { tilesets: ['PCL'] };

before(async () => {
  const env = await setupTestEnv();
  await seedCatalogRefs(env.db, REFS_DE_CATALOGO);
  await teardownTestEnv(env.db);
});

after(async () => {
  const env = await setupTestEnv();
  await dropCatalogRefs(env.db, REFS_DE_CATALOGO);
  await teardownTestEnv(env.db);
});

describe('Snapshot keying for 3D camera positions / 360 orientations (no silent drop)', () => {
  let app, db, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    const user = await createUser(db, { username: `keys_user_${randomUUID().slice(0, 6)}` });
    token = await loginUser(app, user.username, user.password);
    atlas = await createAtlas(db, user.id);
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await teardownTestEnv(db);
  });

  const push = (op) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [op] })
      .expect(200);

  const snapshotMap = async () => {
    const res = await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.data.snapshot.maps.find((m) => m.id === map.id);
  };

  it('a camera_position WITH a tileset_id is keyed by tilesetId (unchanged)', async () => {
    const id = randomUUID();
    await push({
      id: randomUUID(), type: 'create', target: 'cesium3d', targetId: id, mapId: map.id,
      data: { data_type: 'camera_position', tileset_id: 'PCL', data: { position: { longitude: -43.2, latitude: -22.9, height: 5000 }, orientation: { heading: 45, pitch: -30, roll: 0 } } },
      timestamp: Date.now(), clientId: 'repro-client',
    });

    const m = await snapshotMap();
    assert.ok(m.cesium3d.cameraPositions.PCL, 'camera keyed by tilesetId');
    assert.equal(m.cesium3d.cameraPositions.PCL.id, id);
  });

  it('a camera_position with NULL tileset_id still appears in the snapshot (keyed by id)', async () => {
    const id = randomUUID();
    await push({
      id: randomUUID(), type: 'create', target: 'cesium3d', targetId: id, mapId: map.id,
      data: { data_type: 'camera_position', tileset_id: null, data: { position: { longitude: -43.1, latitude: -22.8, height: 1000 }, orientation: { heading: 0, pitch: 0, roll: 0 } } },
      timestamp: Date.now(), clientId: 'repro-client',
    });

    const m = await snapshotMap();
    // Persisted in Postgres...
    const { rows } = await db.query('SELECT id FROM cesium3d_data WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'row persisted');
    // ...and NOT silently dropped from the snapshot (it falls back to the row id as the key).
    assert.ok(m.cesium3d.cameraPositions[id], 'null-tileset camera preserved under its id');
    assert.equal(m.cesium3d.cameraPositions[id].id, id);
  });

  it('an orientation with NULL photo_name is rejected at write — never materialized, never in the snapshot', async () => {
    const id = randomUUID();
    await push({
      id: randomUUID(), type: 'create', target: 'streetview360', targetId: id, mapId: map.id,
      data: { data_type: 'orientation', photo_name: null, data: { heading: 45, pitch: 0, zoom: 1 } },
      timestamp: Date.now(), clientId: 'repro-client',
    });

    const m = await snapshotMap();
    const { rows } = await db.query('SELECT id FROM streetview360_data WHERE id = $1', [id]);
    // An orientation is keyed by photoName — a saved view for ONE panorama — and the frontend ONLY
    // looks them up that way, so a photoName-less orientation is invalid. applyOperation rejects it at
    // the write boundary: it stays in the append-only operations log (history) but is NEVER
    // materialized into streetview360_data, so it can never become real data nor reach the snapshot.
    // (camera_position above keeps its id fallback — that id IS a usable lookup key.)
    assert.equal(rows.length, 0, 'orphan orientation NOT materialized into streetview360_data');
    assert.ok(!m.streetview360.orientations[id], 'orphan NOT keyed under its id in the snapshot');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(m.streetview360.orientations, 'undefined'),
      'orphan NOT keyed under "undefined"',
    );
  });
});

// Path: tests/integration/sync-3d-360-authz.test.js
// Authorization for 3D/360 ops. The per-op gate (assertOperationAllowed) is generic, but it was
// only ever exercised against feature targets — never a cesium3d/streetview360 target against a
// viewer/commenter. 3D/360 are non-comment entities, so a viewer (read) and a commenter (comment)
// must BOTH be blocked from writing them (403), and nothing persists. A writer is the positive control.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser, seedCatalogRefs, dropCatalogRefs,
} from '../helpers/fixtures.js';

// O tileset que a op 3D referencia. Ele precisa EXISTIR e ser visível ao autor: desde que
// `unseenResourceDenialReason` cobre as cinco superfícies, uma op cujo `tileset_id` não resolve
// é recusada POR OPERAÇÃO — e o caso positivo deste arquivo (o WRITER escreve) media o eixo de
// permissão por ATLAS sobre um id que não era recurso nenhum, ou seja, passava por cima do
// buraco que aquele gate fechou. A fixture é o conserto; afrouxar o gate seria o contrário.
const TILESET = { tilesets: ['PCL'] };

describe('3D/360 sync — write authorization (viewer & commenter blocked)', () => {
  let app, db, viewerTok, commenterTok, writerTok, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    const owner = await createUser(db, { username: `az3d_owner_${randomUUID().slice(0, 6)}` });
    const viewer = await createUser(db, { username: `az3d_viewer_${randomUUID().slice(0, 6)}` });
    const commenter = await createUser(db, { username: `az3d_commenter_${randomUUID().slice(0, 6)}` });
    const writer = await createUser(db, { username: `az3d_writer_${randomUUID().slice(0, 6)}` });
    viewerTok = await loginUser(app, viewer.username, viewer.password);
    commenterTok = await loginUser(app, commenter.username, commenter.password);
    writerTok = await loginUser(app, writer.username, writer.password);

    atlas = await createAtlas(db, owner.id);
    map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, viewer.id, 'read', owner.id);
    await createShare(db, atlas.id, commenter.id, 'comment', owner.id);
    await createShare(db, atlas.id, writer.id, 'write', owner.id);

    await seedCatalogRefs(db, TILESET);
  });

  after(async () => {
    await dropCatalogRefs(db, TILESET);
    await teardownTestEnv(db);
  });

  const cesium3dOp = (id) => ({
    id: randomUUID(), type: 'create', target: 'cesium3d', targetId: id, mapId: map.id,
    data: { data_type: 'marker', tileset_id: 'PCL', data: { position: { longitude: -43.2, latitude: -22.9, height: 150 }, properties: { name: 'x' } } },
    timestamp: Date.now(), clientId: 'az-client',
  });
  const streetview360Op = (id) => ({
    id: randomUUID(), type: 'create', target: 'streetview360', targetId: id, mapId: map.id,
    data: { data_type: 'orientation', photo_name: 'p.jpg', data: { heading: 45, pitch: 0, zoom: 1 } },
    timestamp: Date.now(), clientId: 'az-client',
  });

  const push = (token, op, status) =>
    supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operations: [op] })
      .expect(status);

  const cesium3dRows = (id) => db.query('SELECT id FROM cesium3d_data WHERE id = $1', [id]);
  const sv360Rows = (id) => db.query('SELECT id FROM streetview360_data WHERE id = $1', [id]);

  it('a VIEWER cannot push a cesium3d op (403, nothing persists)', async () => {
    const id = randomUUID();
    await push(viewerTok, cesium3dOp(id), 403);
    assert.equal((await cesium3dRows(id)).rows.length, 0);
  });

  it('a VIEWER cannot push a streetview360 op (403, nothing persists)', async () => {
    const id = randomUUID();
    await push(viewerTok, streetview360Op(id), 403);
    assert.equal((await sv360Rows(id)).rows.length, 0);
  });

  it('a COMMENTER cannot push a cesium3d op (3D is non-comment) (403, nothing persists)', async () => {
    const id = randomUUID();
    await push(commenterTok, cesium3dOp(id), 403);
    assert.equal((await cesium3dRows(id)).rows.length, 0);
  });

  it('a COMMENTER cannot push a streetview360 op (403, nothing persists)', async () => {
    const id = randomUUID();
    await push(commenterTok, streetview360Op(id), 403);
    assert.equal((await sv360Rows(id)).rows.length, 0);
  });

  it('a WRITER CAN push a cesium3d op (positive control, persisted)', async () => {
    const id = randomUUID();
    await push(writerTok, cesium3dOp(id), 200);
    assert.equal((await cesium3dRows(id)).rows.length, 1);
  });
});

// Path: tests/integration/sync-comment-visibility-incremental.test.js
// Item 50 — filtro de visibilidade de comentário no PULL INCREMENTAL.
//
// A regra (o Visualizador nunca vê comentário espacial) tinha teste só no caminho
// SNAPSHOT (comments.test.js, que pulla com versão 0). O caminho incremental tem o
// SEU PRÓPRIO filtro (sync.service.js:1237-1239), e ele não tinha teste nenhum:
// removendo aquela linha nada ficava vermelho, e um leitor que já tem cursor > 0
// passava a receber toda op de comentário — incluindo o TEXTO dentro de `data` —
// tanto pelo pull HTTP quanto pelo `sync_request` do WS (collab.handlers.js chama o
// mesmo pullOperations com ws.permission). É vazamento de dado privado.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `cvi_${randomUUID().slice(0, 8)}`;

describe('visibilidade de comentário no pull INCREMENTAL', () => {
  let app, db, server;
  let owner, ownerTok, leitor, leitorTok, escritor, escritorTok, comentarista, comentaristaTok;
  let atlas, map;
  let cursor; // versão anterior às duas ops observadas
  let comentarioOpId, featureOpId;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    leitor = await createUser(db, { username: U() });
    escritor = await createUser(db, { username: U() });
    comentarista = await createUser(db, { username: U() });
    ownerTok = await loginUser(app, owner.username, owner.password);
    leitorTok = await loginUser(app, leitor.username, leitor.password);
    escritorTok = await loginUser(app, escritor.username, escritor.password);
    comentaristaTok = await loginUser(app, comentarista.username, comentarista.password);

    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, leitor.id, 'read', owner.id);
    await createShare(db, atlas.id, escritor.id, 'write', owner.id);
    await createShare(db, atlas.id, comentarista.id, 'comment', owner.id);

    // Uma op de base, para que o cursor seja > 0 e o pull NÃO caia em snapshot.
    const base = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${ownerTok}`)
      .send({ operations: [featureOp('base')] })
      .expect(200);
    cursor = Number(base.body.data.results[0].currentVersion);

    // Uma op de comentário e uma de feição DEPOIS do cursor.
    const c = commentOp();
    comentarioOpId = c.id;
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${comentaristaTok}`)
      .send({ operations: [c] })
      .expect(200);

    const f = featureOp('depois');
    featureOpId = f.id;
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${escritorTok}`)
      .send({ operations: [f] })
      .expect(200);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  function featureOp(nome) {
    return {
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
      mapId: map.id,
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: [-43, -22] }, properties: { source: 'point', name: nome } },
      timestamp: Date.now(), clientId: 'cvi-client',
    };
  }

  function commentOp() {
    const id = randomUUID();
    return {
      id: randomUUID(), entityType: 'comment', operationType: 'create', entityId: id, mapId: map.id,
      data: { id, mapId: map.id, lng: -43.2, lat: -22.9, text: 'texto privado', status: 'open' },
      timestamp: Date.now(), clientId: 'cvi-client',
    };
  }

  const pull = (token, since) =>
    supertest(app)
      .get(`/api/v1/atlas/${atlas.id}/sync/${since}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  it("o pull incremental do 'read' não traz NENHUMA op de comentário", async () => {
    const res = await pull(leitorTok, cursor);
    const d = res.body.data;

    assert.equal(d.isSnapshot, false, 'este é o caminho INCREMENTAL, não o snapshot');
    assert.ok(d.operations.length > 0, 'guarda de lista não-vazia: o filtro não pode esvaziar tudo');
    assert.equal(
      d.operations.filter((o) => o.entityType === 'comment').length,
      0,
      'o Visualizador não recebe op de comentário'
    );
    // Nem o texto pela porta dos fundos de `data`.
    assert.equal(
      JSON.stringify(d.operations).includes('texto privado'),
      false,
      'o conteúdo do comentário não vaza dentro de nenhum payload'
    );
  });

  it('o MESMO pull do read AINDA contém a op de feição (o filtro poda, não esvazia)', async () => {
    const res = await pull(leitorTok, cursor);
    const feats = res.body.data.operations.filter((o) => o.entityType === 'feature');
    assert.equal(feats.length, 1, 'a op de feição posterior ao cursor continua entregue');
  });

  it("controle positivo: o 'write' do mesmo cursor recebe AS DUAS ops", async () => {
    const res = await pull(escritorTok, cursor);
    const d = res.body.data;

    assert.equal(d.isSnapshot, false);
    assert.equal(d.operations.filter((o) => o.entityType === 'comment').length, 1, 'o editor vê o comentário');
    assert.equal(d.operations.filter((o) => o.entityType === 'feature').length, 1);
    // Sem este controle, o teste anterior passaria mesmo se o pull incremental
    // estivesse quebrado para TODO MUNDO.
    assert.notEqual(comentarioOpId, featureOpId);
  });

  it('o mesmo filtro vale no `sync_request` do WebSocket (mesmo pullOperations)', async () => {
    const client = await createWsClient(server, atlas.id, leitorTok);
    await client.waitForType('connected');
    client.clearMessages();

    client.send({ type: 'sync_request', lastVersion: cursor });
    const resp = await client.waitForType('sync_response');

    assert.equal(resp.isSnapshot, false, 'lastVersion > 0 é incremental');
    assert.ok(resp.ops.length > 0, 'guarda de lista não-vazia');
    assert.equal(
      resp.ops.filter((o) => o.entityType === 'comment').length,
      0,
      'a mesma regra vale no caminho WS'
    );

    client.close();
  });
});

// Path: tests/ws/collab-comment-fanout.test.js
// Item 21 — regra de visibilidade do comentário espacial no FAN-OUT WS:
// `broadcastToRoom(..., { skipReadOnly: isComment })` em handleOperation e a divisão
// do lote em `broadcastOperations`.
//
// collab-commenter-authz.test.js cobre o lado da ESCRITA do comentarista; ninguém
// cobria o lado da ENTREGA. O gate é `client.permission === 'read'`, uma igualdade
// sobre nível de permissão — a forma exata que a constituição proíbe. Aqui a
// igualdade está CORRETA (só o piso `read` fica de fora; `comment` para cima vê),
// mas nada prendia essa fronteira: virar `permission !== 'write'` ou
// `['write','owner'].includes(...)` calaria o Comentarista e o co-Gestor em
// silêncio, sem erro nem log. Por isso cada caso prende as DUAS bordas: quem é
// excluído e quem NÃO pode ser excluído.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `cfan_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Janela de silêncio: tempo dado ao servidor para (não) entregar um frame proibido.
// Os casos positivos do mesmo teste já provaram que a entrega é bem mais rápida.
const JANELA_SILENCIO_MS = 400;

describe('fan-out WS de comentário espacial — quem recebe e quem não pode deixar de receber', () => {
  let app, db, server;
  let owner, ownerToken, atlas, map;
  let comentarista, comentaristaToken;
  let leitor, leitorToken;
  let gestor, gestorToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    map = await createMap(db, atlas.id);

    comentarista = await createUser(db, { username: U() });
    leitor = await createUser(db, { username: U() });
    gestor = await createUser(db, { username: U() });
    await createShare(db, atlas.id, comentarista.id, 'comment', owner.id);
    await createShare(db, atlas.id, leitor.id, 'read', owner.id);
    await createShare(db, atlas.id, gestor.id, 'manage', owner.id);

    comentaristaToken = await loginUser(app, comentarista.username, comentarista.password);
    leitorToken = await loginUser(app, leitor.username, leitor.password);
    gestorToken = await loginUser(app, gestor.username, gestor.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  const commentOp = () => ({
    id: randomUUID(), entityType: 'comment', operationType: 'create', entityId: randomUUID(),
    mapId: map.id,
    data: { lng: -43.2, lat: -22.9, text: 'segredo', status: 'open' },
    timestamp: Date.now(), clientId: 'cfan-owner',
  });

  const featureOp = () => ({
    id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(),
    mapId: map.id,
    data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: 'pub' } },
    timestamp: Date.now(), clientId: 'cfan-owner',
  });

  /** Abre a sala com os quatro papéis e devolve os clientes já conectados e limpos. */
  async function sala() {
    const autor = await createWsClient(server, atlas.id, ownerToken);
    const cComment = await createWsClient(server, atlas.id, comentaristaToken);
    const cRead = await createWsClient(server, atlas.id, leitorToken);
    const cManage = await createWsClient(server, atlas.id, gestorToken);
    for (const c of [autor, cComment, cRead, cManage]) await c.waitForType('connected');
    for (const c of [autor, cComment, cRead, cManage]) c.clearMessages();
    return { autor, cComment, cRead, cManage, fechar: () => [autor, cComment, cRead, cManage].forEach((c) => c.close()) };
  }

  it("op de comentário: 'comment' e 'manage' recebem; 'read' NÃO recebe nada", async () => {
    const { autor, cComment, cRead, cManage, fechar } = await sala();

    const op = commentOp();
    autor.send({ type: 'operation', op });
    await autor.waitForType('ack');

    const recebidoComment = await cComment.waitForType('operation');
    assert.equal(recebidoComment.op.id, op.id, 'o Comentarista recebe o comentário');
    const recebidoManage = await cManage.waitForType('operation');
    assert.equal(recebidoManage.op.id, op.id, 'o co-Gestor (nível do meio) NÃO pode sumir do fan-out');

    await sleep(JANELA_SILENCIO_MS);
    assert.deepEqual(
      cRead.getMessagesOfType('operation'),
      [],
      'o Visualizador nunca vê comentário espacial'
    );

    fechar();
  });

  it('op de FEIÇÃO: os três tiers recebem (o skip é específico de comentário)', async () => {
    const { autor, cComment, cRead, cManage, fechar } = await sala();

    const op = featureOp();
    autor.send({ type: 'operation', op });
    await autor.waitForType('ack');

    for (const [nome, c] of [['comment', cComment], ['read', cRead], ['manage', cManage]]) {
      const msg = await c.waitForType('operation');
      assert.equal(msg.op.id, op.id, `o tier ${nome} recebe a op de feição`);
    }

    fechar();
  });

  it('lote MISTO: o read recebe UM frame só com a op não-comentário; o comment recebe as duas', async () => {
    const { autor, cComment, cRead, fechar } = await sala();

    const feat = featureOp();
    const com = commentOp();
    autor.send({ type: 'operations', ops: [feat, com] });
    await autor.waitForType('ack_batch');

    const doRead = await cRead.waitForType('operations');
    assert.equal(doRead.ops.length, 1, 'o Visualizador recebe o lote PODADO, não o lote inteiro');
    assert.equal(doRead.ops[0].id, feat.id, 'e o que sobra é exatamente a op de feição');

    const doComment = await cComment.waitForType('operations');
    assert.equal(doComment.ops.length, 2, 'o Comentarista recebe o lote completo');
    assert.deepEqual(
      doComment.ops.map((o) => o.id).sort(),
      [feat.id, com.id].sort()
    );

    // E o lote podado é UM frame, não dois.
    await sleep(JANELA_SILENCIO_MS);
    assert.equal(cRead.getMessagesOfType('operations').length, 1);

    fechar();
  });

  it('lote 100% de comentário: o read não recebe frame `operations` algum; o comment recebe', async () => {
    const { autor, cComment, cRead, fechar } = await sala();

    const ops = [commentOp(), commentOp()];
    autor.send({ type: 'operations', ops });
    await autor.waitForType('ack_batch');

    const doComment = await cComment.waitForType('operations');
    assert.equal(doComment.ops.length, 2);

    await sleep(JANELA_SILENCIO_MS);
    assert.deepEqual(
      cRead.getMessagesOfType('operations'),
      [],
      'lote só de comentário não produz frame vazio para o Visualizador'
    );

    fechar();
  });
});

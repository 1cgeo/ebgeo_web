// Path: tests/ws/collab-erro-atribuivel.test.js
//
// O FRAME DE ERRO DO SOCKET TEM DE DIZER O QUE FALHOU.
//
// O DEFEITO QUE ESTE ARQUIVO PRENDE, medido antes de existir. Sob contencao, o caminho REST
// responde 503 e o cliente sabe que nada foi aplicado. O socket colapsava todo throw num
// `{ type, code, message }` sem `opIds` e sem referencia ao lote. Com mais de um lote em voo, a
// falha era INATRIBUIVEL: o cliente nao tinha como saber o que reenviar. A bancada
// `tests/bench/escrita-caminho.bench.mjs`, com 16 escritores e lote de 250, mediu 750 operacoes
// nesse limbo numa unica janela.
//
// O QUE ESTE TESTE PROVA, e o que ele deliberadamente NAO prova:
//
//   PROVA que o frame carrega os `opIds` do lote que falhou, na ordem, tanto no caminho de lote
//   (`operations`) quanto no de op unica (`operation`).
//
//   PROVA que `code` e `message` NAO mudaram. Dois testes vizinhos fixam
//   `code === 'OPERATION_FAILED'` (`collab-error-leak.repro` e `collab-commenter-authz`), e a
//   mudanca e aditiva justamente para nao os quebrar. Se alguem "melhorar" o codigo do frame para
//   `err.code`, uma recusa de permissao vira `FORBIDDEN` no fio, que e mudanca de contrato.
//
//   PROVA que `retryable` e FALSO para falha permanente. A recusa por papel e definitiva, e
//   reenvia-la so gasta a fila do cliente.
//
//   NAO prova `retryable === true`, porque a unica falha retentavel deste caminho e o 503 do
//   `lock_timeout` do advisory lock, e provoca-lo exige contencao real de varios escritores. Quem
//   cobre isso e a bancada E3 forcada, que produz o 503 de verdade. Um teste que fingisse esse
//   estado com um dublê estaria provando o dublê.
//
// A CONTENCAO E A MESMA DO `collab-commenter-authz`: um Comentarista passa pelo portao de leitura
// (que so bloqueia `read`) e e parado por `assertOperationAllowed` DENTRO de `pushOperations`, que
// lanca `ForbiddenError` de dentro da transacao. Rollback completo, nada persistido.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('frame de erro do socket: atribuivel e com sinal de re-tentativa', () => {
  let app;
  let db;
  let server;
  let dono;
  let comentarista;
  let tokenComentarista;
  let atlas;
  let mapa;
  let abertos;

  const opDeFeicao = () => ({
    id: randomUUID(),
    entityType: 'feature',
    operationType: 'create',
    entityId: randomUUID(),
    mapId: mapa.id,
    data: {
      feature_type: 'point',
      geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
      properties: { nome: 'nao deve persistir' },
    },
    timestamp: Date.now(),
    clientId: `atribuivel-${randomUUID().slice(0, 8)}`,
  });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    dono = await createUser(db, { username: `ea_dono_${randomUUID().slice(0, 6)}` });
    comentarista = await createUser(db, { username: `ea_com_${randomUUID().slice(0, 6)}` });
    tokenComentarista = await loginUser(app, comentarista.username, comentarista.password);

    atlas = await createAtlas(db, dono.id, { name: 'Atlas do erro atribuivel' });
    mapa = await createMap(db, atlas.id);
    await createShare(db, atlas.id, comentarista.id, 'comment', dono.id);
  });

  beforeEach(() => { abertos = []; });

  afterEach(() => {
    for (const c of abertos) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.ws.terminate();
      } catch { /* ja foi */ }
    }
    abertos = [];
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  it('o lote recusado volta com os opIds do lote inteiro, na ordem', async () => {
    const cliente = await createWsClient(server, atlas.id, tokenComentarista, randomUUID());
    abertos.push(cliente);

    const ops = [opDeFeicao(), opDeFeicao(), opDeFeicao()];
    cliente.send({ type: 'operations', ops });

    const frame = await cliente.waitForType('error');

    assert.deepEqual(
      frame.opIds,
      ops.map((o) => o.id),
      'os opIds do frame tem de ser os do lote, na mesma ordem'
    );
  });

  it('a op unica recusada volta com o proprio id', async () => {
    const cliente = await createWsClient(server, atlas.id, tokenComentarista, randomUUID());
    abertos.push(cliente);

    const op = opDeFeicao();
    cliente.send({ type: 'operation', op });

    const frame = await cliente.waitForType('error');

    assert.deepEqual(frame.opIds, [op.id]);
  });

  it('falha permanente NAO e marcada como retentavel', async () => {
    const cliente = await createWsClient(server, atlas.id, tokenComentarista, randomUUID());
    abertos.push(cliente);

    cliente.send({ type: 'operations', ops: [opDeFeicao()] });
    const frame = await cliente.waitForType('error');

    // A recusa por papel e definitiva. Reenviar so gasta a fila do cliente.
    assert.equal(frame.retryable, false);
  });

  it('code e message continuam os mesmos, porque a mudanca e aditiva', async () => {
    const cliente = await createWsClient(server, atlas.id, tokenComentarista, randomUUID());
    abertos.push(cliente);

    cliente.send({ type: 'operations', ops: [opDeFeicao()] });
    const frame = await cliente.waitForType('error');

    // Se este par mudar, dois testes vizinhos quebram junto, e por bom motivo: seria contrato
    // novo no fio, nao conserto de atribuicao.
    assert.equal(frame.code, 'OPERATION_FAILED');
    assert.match(frame.message.toLowerCase(), /coment/);
  });

  it('nada do lote recusado chega ao ledger', async () => {
    const cliente = await createWsClient(server, atlas.id, tokenComentarista, randomUUID());
    abertos.push(cliente);

    const ops = [opDeFeicao(), opDeFeicao()];
    cliente.send({ type: 'operations', ops });
    const frame = await cliente.waitForType('error');

    // GUARDA CONTRA VERDE VAZIO, e ela nao e paranoia: no controle negativo deste arquivo, com o
    // conserto revertido, `frame.opIds` vinha `undefined`, a consulta virava `ANY(null)` e devolvia
    // zero linhas. O caso passava sem verificar nada. A pergunta que a guarda responde e a de
    // sempre: o que este verde estaria provando se o codigo estivesse errado?
    assert.ok(Array.isArray(frame.opIds) && frame.opIds.length === ops.length,
      `o frame precisa nomear as ${ops.length} ops antes de a consulta significar algo`);

    // A prova que o `opIds` promete ao cliente: as ops nomeadas ali nao foram aplicadas. Sem esta
    // assercao, o frame poderia listar ops que FORAM gravadas, e o reenvio viraria trabalho dobrado
    // apoiado apenas na idempotencia.
    const { rows } = await db.query(
      'SELECT op_id FROM operations WHERE atlas_id = $1 AND op_id = ANY($2::text[])',
      [atlas.id, frame.opIds]
    );
    assert.equal(rows.length, 0, 'op recusada nao pode estar no ledger');
  });
});

// Path: tests/ws/sync-request-ordem-dos-quadros.repro.test.js
//
// A RESPOSTA DO `sync_request` E UM RETRATO DO PASSADO, e ela nao pode chegar DEPOIS de uma op
// mais nova que ela nao contem.
//
// O cliente aplica os quadros do socket NA ORDEM EM QUE CHEGAM (`_queueApply`,
// `frontend/src/js/store/sync/ws-client.js`), e so as entidades de `CONVERGENCE_GUARDED` descartam
// op mais velha que a ja aplicada. Mapa, membresia de grupo, comentario, slide e camada de catalogo
// nao descartam: a ultima que chega vence.
//
// O servidor montava a resposta assim: le as ops `> lastVersion` (`pullOperations`), faz mais uma
// leitura, e so entao envia. Uma op que COMITA depois da leitura e e DIFUNDIDA antes do envio
// chega ao par ANTES da resposta, e a resposta, que traz a op anterior da mesma entidade, e
// aplicada POR CIMA. No reconectar (perda de conexao, socket derrubado por contrapressao) com um
// colega editando, o par termina com o nome antigo do mapa, e fica assim ate um retrato completo.
//
// A intercalacao perdedora e forcada, nao sorteada: `db.query` e embrulhado para PARAR a segunda
// leitura do pull (a que vem depois da consulta das ops), e o colega renomeia o mapa durante a
// pausa.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';
import { db } from '../../src/database/index.js';
import * as SQ from '../../src/modules/sync/sync.queries.js';

const U = () => `sro_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('sync_request: a resposta chega antes das ops que ela nao contem', () => {
  let app, dbTeste, server, dono, tokenDono, par, tokenPar;
  const clientes = [];

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    dbTeste = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    dono = await createUser(dbTeste, { username: U() });
    tokenDono = await loginUser(app, dono.username, dono.password);
    par = await createUser(dbTeste, { username: U() });
    tokenPar = await loginUser(app, par.username, par.password);
  });

  after(async () => {
    for (const c of clientes) c.close?.();
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(dbTeste);
  });

  const renomear = async (atlasId, mapId, nome) => {
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlasId}/sync`)
      .set('Authorization', `Bearer ${tokenDono}`)
      .send({ operations: [{
        protocolVersion: 2, id: randomUUID(), entityType: 'map', operationType: 'update',
        entityId: mapId, mapId, timestamp: Date.now(), clientId: 'cli-dono', changes: { name: nome },
      }] })
      .expect(200);
    assert.equal(res.body.data.results[0].status, 'applied');
  };

  /** O nome do mapa que um cliente teria depois de aplicar os quadros NA ORDEM de chegada. */
  const nomeAplicadoEmOrdem = (quadros, mapId) => {
    let nome = null;
    const aplicar = (op) => {
      const payload = op?.data ?? op?.changes;
      if (op?.entityType === 'map' && op.entityId === mapId && typeof payload?.name === 'string') nome = payload.name;
    };
    for (const q of quadros) {
      if (q.type === 'operation') aplicar(q.op);
      if (q.type === 'operations') for (const op of q.ops ?? []) aplicar(op);
      if (q.type === 'sync_response') for (const op of q.ops ?? []) aplicar(op);
    }
    return nome;
  };

  it('o par que reconecta durante a edicao de um colega termina com o nome que o servidor tem', async () => {
    const atlas = await createAtlas(dbTeste, dono.id, { name: `SRO ${U()}` });
    const mapa = await createMap(dbTeste, atlas.id, { name: 'Nome 0' });
    await createShare(dbTeste, atlas.id, par.id, 'write', dono.id);

    // O par ja tinha visto ate aqui.
    await renomear(atlas.id, mapa.id, 'Nome 0a');
    const cursor = Number((await dbTeste.query('SELECT current_version FROM atlas WHERE id = $1', [atlas.id]))
      .rows[0].current_version);
    // O que o par perdeu enquanto estava fora.
    await renomear(atlas.id, mapa.id, 'Nome 1');

    const cliente = await createWsClient(server, atlas.id, tokenPar, 'cli-par');
    clientes.push(cliente);
    await cliente.waitForType('connected');

    // A PAUSA: a segunda leitura de `atlas` que `pullOperations` faz DEPOIS da consulta das ops.
    const original = db.query;
    let viuOps = false;
    let soltar;
    const portao = new Promise((resolve) => { soltar = resolve; });
    let parado;
    const chegouNoPortao = new Promise((resolve) => { parado = resolve; });
    db.query = function consultaComPortao(...args) {
      const [sql, valores] = args;
      if (!viuOps && sql === SQ.GET_OPERATIONS_SINCE_VERSION && valores?.[0] === atlas.id) viuOps = true;
      else if (viuOps && sql === SQ.GET_ATLAS_SYNC_INFO && valores?.[0] === atlas.id) {
        db.query = original;
        parado();
        return portao.then(() => original.apply(this, args));
      }
      return original.apply(this, args);
    };

    try {
      const inicio = cliente.messages.length;
      cliente.send({ type: 'sync_request', lastVersion: cursor, haveSnapshot: true });
      await chegouNoPortao;

      // O colega renomeia DURANTE a pausa: comita depois da leitura das ops e e difundido ja.
      await renomear(atlas.id, mapa.id, 'Nome 2');
      // Da ao quadro a chance de atravessar o socket antes da resposta (e o que acontecia).
      await sleep(300);

      soltar();
      await cliente.waitForType('sync_response');
      const limite = Date.now() + 3000;
      while (Date.now() < limite
        && nomeAplicadoEmOrdem(cliente.messages.slice(inicio), mapa.id) !== 'Nome 2'
        && !cliente.messages.slice(inicio).some((q) => q.type === 'operations' && q.ops?.some((o) => o.data?.name === 'Nome 2' || o.changes?.name === 'Nome 2')
          && cliente.messages.slice(inicio).findIndex((m) => m.type === 'sync_response') < cliente.messages.slice(inicio).indexOf(q))) {
        await sleep(20);
      }

      const quadros = cliente.messages.slice(inicio);
      const noServidor = (await dbTeste.query('SELECT name FROM maps WHERE id = $1', [mapa.id])).rows[0].name;
      assert.equal(noServidor, 'Nome 2');
      assert.equal(nomeAplicadoEmOrdem(quadros, mapa.id), noServidor,
        `ordem de chegada: ${quadros.map((q) => q.type).join(', ')}`);
    } finally {
      db.query = original;
      soltar();
    }
  });
});

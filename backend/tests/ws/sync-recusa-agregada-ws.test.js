// Path: tests/ws/sync-recusa-agregada-ws.test.js
// A MESMA linha de recusa, pela porta do socket.
//
// A recusa por operação não tem gêmeo dentro de `collab.handlers.js`: as seis (atlas
// alheio, alvo desconhecido, política, mapa travado, recurso invisível, violação de
// integridade) são todas decididas em `pushOperations`, que é o único caminho de escrita
// das duas portas. Escrever ali uma segunda montagem da linha daria duas gramáticas para o
// mesmo fato, e uma investigação não pode pagar isso. O que a porta do socket acrescenta é
// a sua IDENTIDADE, e é ela que este arquivo prende: sem `via`, a linha não distingue uma
// fila congelada no socket de uma congelada no HTTP, que é a primeira pergunta de quem
// recebe "a fila dele congelou".
//
// A PROPRIEDADE DECLARADA, e testada aqui porque declaração sem teste envelhece: o frame
// `operation` carrega UMA op, logo o lote é de um, logo naquela porta a agregação não
// agrega. Quem quer o agrupamento manda `operations`, e é o que o caso do lote misto
// mostra. O terceiro caso existe para que a assimetria fique medida e não prometida.
//
// CONTROLE NEGATIVO (2026-09-01), como observado: tirar o `{ via: 'ws' }` das duas chamadas
// de `syncService.pushOperations` em collab.handlers.js deixa 3 dos 3 casos vermelhos,
// todos em «a linha nomeia a porta do socket», com `actual: 'rest'` e `expected: 'ws'`. Não
// há nada na resposta do socket que denuncie isso: os acks são idênticos nos dois casos.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import logger from '../../src/utils/logger.js';
import { MSG_RECUSA_DE_LOTE } from '../../src/modules/sync/sync.service.js';

describe('WS: a recusa por operação também é registrada, e nomeia a porta', () => {
  let app, db, server, owner, ownerToken, atlas, mapaTravado, mapaLivre;
  let openClients, linhas, warnOriginal;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `wsr_own_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Atlas da Recusa WS' });
    mapaTravado = await createMap(db, atlas.id, { name: 'Bloqueado' });
    mapaLivre = await createMap(db, atlas.id, { name: 'Livre' });
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [mapaTravado.id]);

    warnOriginal = logger.warn.bind(logger);
    logger.warn = (obj, msg) => {
      if (msg === MSG_RECUSA_DE_LOTE) linhas.push(obj);
      return warnOriginal(obj, msg);
    };
  });

  beforeEach(() => { openClients = []; linhas = []; });

  afterEach(() => {
    for (const c of openClients) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.ws.terminate();
      } catch {
        /* already gone */
      }
    }
    openClients = [];
  });

  after(async () => {
    logger.warn = warnOriginal;
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  async function connect(clientId) {
    const client = await createWsClient(server, atlas.id, ownerToken, clientId);
    openClients.push(client);
    await client.waitForType('connected');
    return client;
  }

  const featureOp = (mapId) => {
    const id = randomUUID();
    return {
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId,
      data: {
        type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
        properties: { id, source: 'point', nome: 'PC do Batalhao' },
      },
      timestamp: Date.now(), clientId: 'cli-ws',
    };
  };

  it('o frame `operations` recusado produz UMA linha, e ela nomeia a porta do socket', async () => {
    const a = await connect('cli-ws');
    a.send({
      type: 'operations',
      ops: [featureOp(mapaTravado.id), featureOp(mapaTravado.id), featureOp(mapaLivre.id)],
    });
    const ack = await a.waitForType('ack_batch');

    assert.equal(ack.results.length, 3, 'o contrato do ack não muda');
    assert.equal(ack.results.filter((r) => r.success === false).length, 2, 'duas recusadas');

    assert.equal(linhas.length, 1, 'uma linha por lote, também no socket');
    assert.equal(linhas[0].via, 'ws', 'a linha nomeia a porta do socket');
    assert.equal(linhas[0].recusadas, 2);
    assert.equal(linhas[0].doLote, 3, 'e o denominador é o frame inteiro');
    assert.equal(linhas[0].grupos.length, 1, 'mesmo motivo: um grupo');
    assert.equal(linhas[0].grupos[0].total, 2, 'com a contagem no lugar de duas linhas');
    assert.equal(linhas[0].atlasId, atlas.id);
    assert.equal(linhas[0].userId, owner.id);
  });

  it('o frame `operation` é um lote de UM, e a linha diz isso em vez de fingir agregação', async () => {
    const a = await connect('cli-ws');
    a.send({ type: 'operation', op: featureOp(mapaTravado.id) });
    const ack = await a.waitForType('ack');
    assert.equal(ack.result.success, false, 'a op é recusada');

    assert.equal(linhas.length, 1, 'uma linha');
    assert.equal(linhas[0].via, 'ws', 'a linha nomeia a porta do socket');
    assert.equal(linhas[0].doLote, 1, 'o denominador é 1: nesta porta a agregação não agrega');
    assert.equal(linhas[0].recusadas, 1);
  });

  it('o frame limpo não escreve nada, e a linha nunca carrega payload', async () => {
    const a = await connect('cli-ws');
    a.send({ type: 'operations', ops: [featureOp(mapaLivre.id), featureOp(mapaLivre.id)] });
    await a.waitForType('ack_batch');
    assert.equal(linhas.length, 0, 'sem recusa, sem linha');

    a.send({ type: 'operation', op: featureOp(mapaTravado.id) });
    await a.waitForType('ack');
    assert.equal(linhas.length, 1, 'e a de recusa continua saindo');
    assert.equal(linhas[0].via, 'ws', 'a linha nomeia a porta do socket');
    const serializado = JSON.stringify(linhas[0]);
    assert.equal(serializado.includes('PC do Batalhao'), false, 'nome de feição não vai ao log');
    assert.equal(serializado.includes('coordinates'), false, 'geometria não vai ao log');
  });
});

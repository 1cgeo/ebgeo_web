// Path: tests/ws/collab-message-serialization.test.js
// Item 20 — serialização de mensagens POR SOCKET (`ws._messageChain`).
//
// Regressão registrada em livro-razao.md (2026-07-18, `regressao-propria`): o
// advisory lock era tomado depois de abrir a transação e o dispatcher WS disparava
// `handleMessage` sem await, então um cliente SOZINHO em rajada abria N pushes
// concorrentes no mesmo atlas e, como cada um retém uma conexão do pool enquanto
// espera o lock, esgotava o pool (poolMax=10) → lock_timeout.
//
// A metade do fix que vive no lock está coberta por
// tests/integration/sync-push-serialization.test.js. A metade que vive no
// encadeamento por socket não tinha teste em suíte nenhuma, porque TODOS os testes de
// collab enviam UMA op e esperam o ack antes da próxima: ninguém faz rajada. Voltar o
// `.then(() => handleMessage(...))` a ser fire-and-forget deixaria tudo verde.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `ser_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera até haver `n` mensagens do tipo, ou estoura. */
async function waitForCount(client, type, n, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (client.getMessagesOfType(type).length >= n) return client.getMessagesOfType(type);
    await sleep(25);
  }
  throw new Error(
    `Timeout: esperava ${n} frames "${type}", chegaram ${client.getMessagesOfType(type).length}`
  );
}

const RAJADA = 20;

describe('serialização por socket — rajada sem esperar ack', () => {
  let app, db, server, owner, token, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: U() });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('20 ops em rajada: 20 acks, na ORDEM de envio, sem erro, e server_version crescente', async () => {
    const client = await createWsClient(server, atlas.id, token);
    await client.waitForType('connected');
    client.clearMessages();

    const enviadas = [];
    for (let seq = 0; seq < RAJADA; seq++) {
      const op = {
        id: randomUUID(),
        entityType: 'feature',
        operationType: 'create',
        entityId: randomUUID(),
        mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { coordinates: [-43.2, -22.9] },
          properties: { name: `p${seq}`, seq },
        },
        timestamp: Date.now(),
        clientId: 'ser-burst',
      };
      enviadas.push(op);
      client.send({ type: 'operation', op }); // SEM esperar o ack
    }

    const acks = await waitForCount(client, 'ack', RAJADA);
    assert.equal(acks.length, RAJADA, 'chegam exatamente 20 acks');

    // A ordem dos acks acompanha a ordem de envio.
    assert.deepEqual(
      acks.map((a) => a.opId),
      enviadas.map((o) => o.id),
      'a ordem dos acks tem de ser IDÊNTICA à ordem de envio'
    );

    // Nenhum OPERATION_FAILED por exaustão de pool / lock_timeout.
    assert.deepEqual(client.getMessagesOfType('error'), [], 'nenhum frame de erro na rajada');

    // A ordem do cliente é preservada na AUTORIDADE, não só nos acks.
    const { rows } = await db.query(
      `SELECT op_id, server_version FROM operations WHERE atlas_id = $1 AND op_id = ANY($2::text[])
       ORDER BY server_version ASC`,
      [atlas.id, enviadas.map((o) => o.id)]
    );
    assert.equal(rows.length, RAJADA, 'as 20 ops estão no log');
    assert.deepEqual(
      rows.map((r) => r.op_id),
      enviadas.map((o) => o.id),
      'server_version cresce na mesma ordem em que o cliente enviou'
    );
    for (let i = 1; i < rows.length; i++) {
      assert.ok(
        Number(rows[i].server_version) > Number(rows[i - 1].server_version),
        `server_version estritamente crescente entre ${i - 1} e ${i}`
      );
    }

    // O socket sobrevive à rajada.
    client.send({ type: 'ping' });
    const pong = await client.waitForType('pong');
    assert.equal(pong.type, 'pong');

    client.close();
  });

  it('create-então-update na MESMA entidade sem esperar ack: o estado final é o do update', async () => {
    const client = await createWsClient(server, atlas.id, token);
    await client.waitForType('connected');
    client.clearMessages();

    const featureId = randomUUID();
    client.send({
      type: 'operation',
      op: {
        id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: featureId,
        mapId: map.id,
        data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: { name: 'orig' } },
        timestamp: Date.now(), clientId: 'ser-co',
      },
    });
    // Sem serialização, o UPDATE pode chegar antes de o CREATE existir e afetar ZERO
    // linhas — sumindo em silêncio, com ack de sucesso.
    client.send({
      type: 'operation',
      op: {
        id: randomUUID(), entityType: 'feature', operationType: 'update', entityId: featureId,
        mapId: map.id,
        changes: { properties: { name: 'depois' } },
        timestamp: Date.now(), clientId: 'ser-co',
      },
    });

    await waitForCount(client, 'ack', 2);
    assert.deepEqual(client.getMessagesOfType('error'), []);

    const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [featureId]);
    assert.equal(rows.length, 1, 'a feição existe');
    assert.equal(rows[0].properties.name, 'depois', 'o update pegou a feição já criada');

    client.close();
  });
});

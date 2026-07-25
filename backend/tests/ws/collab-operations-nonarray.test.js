// Path: tests/ws/collab-operations-nonarray.test.js
// Item 161 — `handleOperations` com `data.ops` NÃO-array:
// `if (!Array.isArray(data.ops) || !validateOps(...)) return;` retorna SEM enviar
// frame de erro.
//
// É uma assimetria de contrato que TRAVA cliente: `operation` malformado devolve
// VALIDATION_ERROR, `operations` com ops não-array devolve SILÊNCIO. Um cliente que
// dequeue por ack fica esperando para sempre um frame que nunca vem, e o operador não
// vê erro nenhum. Não há perda nem vazamento de dado, então o valor deste teste é
// fixar QUAL dos dois comportamentos é o contrato — sem ele, a diferença entre os dois
// ramos é invisível. O que segue documenta o comportamento VIGENTE (silêncio); se a
// decisão virar "emitir erro", este teste é o repro pronto.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const U = () => `nonarr_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JANELA_SILENCIO_MS = 500;

describe('handleOperations — ramo não-array cala, array vazio fala', () => {
  let app, db, server, owner, token, atlas;

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
    await createMap(db, atlas.id);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it("ops:'não-é-array' → nenhum frame na janela, e o socket segue vivo", async () => {
    const client = await createWsClient(server, atlas.id, token);
    await client.waitForType('connected');
    client.clearMessages();

    client.send({ type: 'operations', ops: 'nao-e-array' });
    await sleep(JANELA_SILENCIO_MS);

    assert.deepEqual(client.messages, [], 'o ramo não-array retorna em SILÊNCIO (contrato vigente)');

    client.send({ type: 'ping' });
    const pong = await client.waitForType('pong');
    assert.equal(pong.type, 'pong', 'o socket não é derrubado pelo frame inválido');

    client.close();
  });

  it('{type:"operations"} sem a chave ops → mesmo silêncio, socket vivo', async () => {
    const client = await createWsClient(server, atlas.id, token);
    await client.waitForType('connected');
    client.clearMessages();

    client.send({ type: 'operations' });
    await sleep(JANELA_SILENCIO_MS);

    assert.deepEqual(client.messages, []);

    client.send({ type: 'ping' });
    assert.equal((await client.waitForType('pong')).type, 'pong');

    client.close();
  });

  it('ops:[] (array VAZIO) → VALIDATION_ERROR: o array vazio FALA, o não-array cala', async () => {
    const client = await createWsClient(server, atlas.id, token);
    await client.waitForType('connected');
    client.clearMessages();

    client.send({ type: 'operations', ops: [] });
    const err = await client.waitForType('error');
    assert.equal(err.code, 'VALIDATION_ERROR', 'pushSchema exige min(1)');

    client.close();
  });

  it('{type:"operation"} sem op → VALIDATION_ERROR (contraste direto com o ramo silencioso)', async () => {
    const client = await createWsClient(server, atlas.id, token);
    await client.waitForType('connected');
    client.clearMessages();

    client.send({ type: 'operation' });
    const err = await client.waitForType('error');
    assert.equal(err.code, 'VALIDATION_ERROR');

    client.close();
  });

  it('nenhuma linha em operations para o atlas depois dos quatro envios', async () => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM operations WHERE atlas_id = $1',
      [atlas.id]
    );
    assert.equal(rows[0].n, 0, 'frame inválido não persiste nada, cale ou fale');
  });
});

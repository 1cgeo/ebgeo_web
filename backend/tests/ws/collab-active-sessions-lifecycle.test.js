// Path: tests/ws/collab-active-sessions-lifecycle.test.js
// Item 100 — ciclo de vida da linha em `active_sessions`.
//
// `active_sessions` é o ÚNICO registro durável de um socket, e não há reaper (um grep
// de `active_sessions` em src/ só acha collab.service.js e a migração). ws-10
// (collab-gaps.test.js) verifica apenas a CRIAÇÃO da linha e a ausência dela para o
// visitante público; a REMOÇÃO nunca foi afirmada, então uma `deleteSession` quebrada
// (nome de coluna, chave composta errada) deixaria a suíte verde enquanto o banco
// acumula sessão morta indefinidamente.
//
// Há ainda uma corrida real: `createSession`/`deleteSession` são chamadas SEM await,
// então um connect seguido de close rápido pode executar o DELETE antes do INSERT e
// deixar órfã uma linha que ninguém mais limpa.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, setAwayGraceMs } from '../../src/modules/collab/collab.gateway.js';

const U = () => `sess_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACA_MS = 600;

describe('ciclo de vida de active_sessions', () => {
  let app, db, server;
  let owner, atlas;
  let user, token;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    setAwayGraceMs(GRACA_MS);

    owner = await createUser(db, { username: U() });
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);

    user = await createUser(db, { username: U() });
    await createShare(db, atlas.id, user.id, 'write', owner.id);
    token = await loginUser(app, user.username, user.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  async function contarSessoes(clientId) {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM active_sessions WHERE user_id = $1 AND atlas_id = $2 AND client_id = $3',
      [user.id, atlas.id, clientId]
    );
    return rows[0].n;
  }

  /** Poll até a contagem bater, ou devolve o último valor observado. */
  async function aguardarContagem(clientId, esperado, timeoutMs = 3000) {
    const t0 = Date.now();
    let n = await contarSessoes(clientId);
    while (n !== esperado && Date.now() - t0 < timeoutMs) {
      await sleep(30);
      n = await contarSessoes(clientId);
    }
    return n;
  }

  it('close limpo (1000): a linha aparece e some', async () => {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const client = await createWsClient(server, atlas.id, token, cid);
    await client.waitForType('connected');

    assert.equal(await aguardarContagem(cid, 1), 1, 'a sessão é criada no connect');

    client.ws.close(1000, 'bye');
    assert.equal(await aguardarContagem(cid, 0), 0, 'a sessão é apagada no close limpo');
  });

  it('queda anormal (1006): a linha PERMANECE durante a graça e some depois', async () => {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const client = await createWsClient(server, atlas.id, token, cid);
    await client.waitForType('connected');
    assert.equal(await aguardarContagem(cid, 1), 1);

    client.ws.terminate();

    // Dentro da graça a sessão está SUSPENSA, não encerrada.
    await sleep(Math.floor(GRACA_MS / 3));
    assert.equal(await contarSessoes(cid), 1, 'a sessão sobrevive à janela de graça');

    assert.equal(await aguardarContagem(cid, 0, 4000), 0, 'e é encerrada quando a graça expira');
  });

  it('reconexão com o MESMO clientId dentro da graça mantém EXATAMENTE uma linha', async () => {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const primeiro = await createWsClient(server, atlas.id, token, cid);
    await primeiro.waitForType('connected');
    assert.equal(await aguardarContagem(cid, 1), 1);

    primeiro.ws.terminate();
    await sleep(Math.floor(GRACA_MS / 4)); // ainda dentro da graça

    const segundo = await createWsClient(server, atlas.id, token, cid);
    await segundo.waitForType('connected');

    // Nem o ON CONFLICT DO UPDATE pode duplicar, nem o cancelamento do timer pode
    // apagar a sessão recém-criada.
    await sleep(GRACA_MS + 400); // a graça do socket velho já teria expirado
    assert.equal(await contarSessoes(cid), 1, 'exatamente uma linha após a reconexão');
    assert.equal(segundo.ws.readyState, 1, 'e o socket vivo continua vivo');

    segundo.ws.close(1000);
    assert.equal(await aguardarContagem(cid, 0), 0);
  });

  it('corrida connect→close imediato: nenhuma linha órfã sobra', async () => {
    const cid = `c-${randomUUID().slice(0, 8)}`;
    const addr = server.address();
    const port = typeof addr === 'object' ? addr.port : addr;
    const url = `ws://localhost:${port}/api/v1/collab?atlasId=${atlas.id}&token=${token}&clientId=${cid}`;

    // Fecha no PRÓPRIO handler de 'open', sem esperar o frame `connected`: o DELETE
    // pode correr antes do INSERT e deixar órfã uma linha que ninguém mais limpa.
    await new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on('open', () => {
        ws.close(1000, 'imediato');
        resolve();
      });
      ws.on('error', () => resolve());
      setTimeout(resolve, 4000);
    });

    assert.equal(await aguardarContagem(cid, 0, 4000), 0, 'o ciclo fecha mesmo no caminho mais curto');
  });

  it('duas abas (clientIds distintos) → 2 linhas; fechar uma deixa exatamente 1', async () => {
    const cidA = `a-${randomUUID().slice(0, 8)}`;
    const cidB = `b-${randomUUID().slice(0, 8)}`;
    const abaA = await createWsClient(server, atlas.id, token, cidA);
    await abaA.waitForType('connected');
    const abaB = await createWsClient(server, atlas.id, token, cidB);
    await abaB.waitForType('connected');

    assert.equal(await aguardarContagem(cidA, 1), 1);
    assert.equal(await aguardarContagem(cidB, 1), 1);

    abaA.ws.close(1000);
    assert.equal(await aguardarContagem(cidA, 0), 0, 'a aba fechada some');
    assert.equal(await contarSessoes(cidB), 1, 'e a aba viva permanece (a chave é composta)');

    abaB.ws.close(1000);
    assert.equal(await aguardarContagem(cidB, 0), 0);
  });
});

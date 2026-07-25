// Path: tests/ws/collab-logout-keeps-socket.test.js
//
// Item 9 (invariante I10). `auth.logout` revoga SÓ o refresh token: não fecha o socket
// de colaboração nem limpa presença. Isso é CONTRATO CONGELADO com o frontend — o
// lifecycle de socket é client-driven (backend/CLAUDE.md) — e a palavra "logout" não
// aparecia uma única vez em `backend/tests/ws/` (grep = zero). Ou seja: se alguém
// "consertasse" o logout acrescentando teardown de socket, nada ficaria vermelho aqui e
// o frontend passaria a perder a sala de colaboração no logout, divergindo os peers.
// É exatamente a classe de bug que o guarda de fronteira deveria pegar.
//
// A afirmação forte não é "o socket TCP continua vivo" — isso passaria mesmo com o
// cliente já removido da sala. É "o socket ainda RECEBE o fan-out da sala": um peer faz
// push e o socket do usuário deslogado recebe o broadcast `operations`. Pertencimento à
// sala, não apenas conectividade.
//
// E o controle negativo que impede o teste de passar por um logout que não faz nada: o
// refresh token apresentado precisa estar de fato revogado.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createShare, createMap } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { getRoomUsers, getRoomSize } from '../../src/modules/collab/collab.rooms.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SFX = randomUUID().slice(0, 8);

describe('I10 — auth.logout does NOT tear down the collab socket (9)', () => {
  let app, db, server;
  let owner, peer, atlas, map;
  let openClients;

  /** Logs in and returns the full token pair (the refresh token is the point here). */
  async function loginPair(user) {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: user.password })
      .expect(200);
    return res.body.data;
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gateway = await import('../../src/modules/collab/collab.gateway.js');
    gateway.attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `lo_own_${SFX}` });
    peer = await createUser(db, { username: `lo_peer_${SFX}` });
    atlas = await createAtlas(db, owner.id, { name: `Logout Atlas ${SFX}` });
    await createShare(db, atlas.id, peer.id, 'write', owner.id);
    map = await createMap(db, atlas.id, { name: `Logout Map ${SFX}` });
  });

  beforeEach(() => { openClients = []; });

  afterEach(() => {
    for (const c of openClients) {
      try { if (c.ws && c.ws.readyState <= 1) c.ws.terminate(); } catch { /* já foi */ }
    }
    openClients = [];
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  async function connect(token, clientId) {
    const c = await createWsClient(server, atlas.id, token, clientId);
    openClients.push(c);
    await c.waitForType('connected');
    return c;
  }

  it('o socket segue OPEN e sem frame de close ~1s depois do logout', async () => {
    const a = await loginPair(owner);
    const ws = await connect(a.accessToken, `lo-a-${SFX}`);

    let closed = null;
    ws.ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ refreshToken: a.refreshToken })
      .expect(204);

    await sleep(1000);

    assert.equal(ws.ws.readyState, 1, 'o socket precisa continuar OPEN (lifecycle client-driven)');
    assert.equal(closed, null, `chegou um frame de close: ${JSON.stringify(closed)}`);
  });

  it('e ainda PERTENCE à sala: um push do peer chega no socket do usuário deslogado', async () => {
    // Esta é a asserção que distingue "TCP vivo" de "membro da sala". Sem ela, remover o
    // cliente da sala sem fechar o socket passaria despercebido.
    const a = await loginPair(owner);
    const ws = await connect(a.accessToken, `lo-b-${SFX}`);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ refreshToken: a.refreshToken })
      .expect(204);

    ws.clearMessages();

    const peerTokens = await loginPair(peer);
    const res = await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/sync`)
      .set('Authorization', `Bearer ${peerTokens.accessToken}`)
      .send({
        operations: [{
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: randomUUID(),
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [-43.5, -23.0] },
            properties: { name: `pos-logout ${SFX}` },
          },
          timestamp: Date.now(),
          clientId: `lo-peer-${SFX}`,
        }],
      });
    assert.equal(res.status, 200, 'o push do peer precisa passar, senão o teste é vacuous');

    const ops = await ws.waitForType('operations', 3000);
    assert.equal(ops.userId, peer.id);
    assert.equal(ops.ops.length, 1);
  });

  it('o roster de presença ainda lista o usuário depois do logout', async () => {
    const a = await loginPair(owner);
    await connect(a.accessToken, `lo-c-${SFX}`);

    const antes = getRoomUsers(atlas.id).map((u) => u.userId ?? u.id ?? u);
    assert.ok(antes.includes(owner.id), 'guard: o dono precisa estar no roster antes do logout');
    const tamanhoAntes = getRoomSize(atlas.id);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ refreshToken: a.refreshToken })
      .expect(204);

    await sleep(300);

    const depois = getRoomUsers(atlas.id).map((u) => u.userId ?? u.id ?? u);
    assert.ok(depois.includes(owner.id), 'a presença não é limpa pelo logout');
    assert.equal(getRoomSize(atlas.id), tamanhoAntes, 'nenhum socket saiu da sala');
  });

  it('controle negativo: o refresh token apresentado FOI de fato revogado', async () => {
    // Sem isto, todos os asserts acima passariam também com um logout que não faz nada.
    const a = await loginPair(owner);
    await connect(a.accessToken, `lo-d-${SFX}`);

    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ refreshToken: a.refreshToken })
      .expect(204);

    const res = await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: a.refreshToken });
    assert.equal(res.status, 401, 'o logout precisa ter revogado o refresh token');
  });

  it('o access token continua abrindo rota estrita (o logout não carrega jti/versão)', async () => {
    // Consequência declarada do modelo: `issueAccessToken` não carrega jti nem versão de
    // sessão, então revogar o refresh não invalida o access. Documentado aqui porque é o
    // que explica por que o socket segue autorizado até o sweep de heartbeat.
    const a = await loginPair(owner);
    await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ refreshToken: a.refreshToken })
      .expect(204);

    await supertest(app)
      .get(`/api/v1/atlas/${atlas.id}`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
  });

  it('contraste: o CLIENTE fechando o socket é que o tira da sala', async () => {
    // O outro lado do contrato: o teardown existe, ele é apenas client-driven. Sem este
    // caso, "o socket sobrevive ao logout" poderia estar medindo um teardown quebrado.
    const a = await loginPair(owner);
    const ws = await connect(a.accessToken, `lo-e-${SFX}`);
    const antes = getRoomSize(atlas.id);

    ws.close();
    await sleep(300);

    assert.equal(getRoomSize(atlas.id), antes - 1, 'fechar pelo cliente remove da sala');
  });
});

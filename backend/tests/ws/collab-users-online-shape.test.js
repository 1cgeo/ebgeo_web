// Path: tests/ws/collab-users-online-shape.test.js
// Item 162 — shape de `usersOnline` no frame `connected`.
//
// `onConnection` chama `joinRoom` ANTES de `getRoomUsers`, então o cliente SEMPRE se vê
// na própria lista; e um usuário com duas abas aparece DUAS VEZES com o mesmo `id`
// (podendo uma estar 'away' e a outra 'online'), porque `getRoomUsers` monta uma
// entrada por CLIENTE, não por usuário. Isso é contrato de presença consumido pelo
// roster do frontend e não estava afirmado em lugar nenhum — ws-04 (collab-gaps) só
// procura o PEER na lista. Inverter a ordem de joinRoom/getRoomUsers, ou "consertar" a
// duplicata deduplicando por userId, mudaria a forma do roster sem nenhum teste falhar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser, makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, setAwayGraceMs } from '../../src/modules/collab/collab.gateway.js';

const U = () => `ushape_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACA_MS = 3000; // longa de propósito: o caso 'away' precisa da janela aberta

// Campos congelados de CADA entrada do roster (o frontend indexa por eles).
const CAMPOS = [
  'clientId', 'cursorPosition', 'id', 'mapId', 'nome', 'posto_graduacao',
  'selectedFeatures', 'selectionContext', 'status', 'temporalState',
];

describe('shape de usersOnline no frame `connected`', () => {
  let app, db, server;
  let owner, ownerToken;
  let peerUser, peerToken;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    setAwayGraceMs(GRACA_MS);

    owner = await createUser(db, { username: U() });
    ownerToken = await loginUser(app, owner.username, owner.password);
    peerUser = await createUser(db, { username: U() });
    peerToken = await loginUser(app, peerUser.username, peerUser.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /** Atlas vazio novo, com o peer já compartilhado. */
  async function atlasVazio() {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    await createShare(db, atlas.id, peerUser.id, 'write', owner.id);
    return atlas;
  }

  it('o conectante SE VÊ na própria lista (joinRoom roda antes de getRoomUsers)', async () => {
    const atlas = await atlasVazio();
    const client = await createWsClient(server, atlas.id, ownerToken);
    const conn = await client.waitForType('connected');

    assert.equal(conn.usersOnline.length, 1, 'atlas vazio + 1 conexão = 1 entrada');
    assert.equal(conn.usersOnline[0].id, conn.userId, 'e essa entrada é a do próprio conectante');
    assert.equal(conn.usersOnline[0].clientId, conn.sessionId);

    client.close();
  });

  it('toda entrada carrega os campos congelados do roster', async () => {
    const atlas = await atlasVazio();
    const a = await createWsClient(server, atlas.id, ownerToken);
    await a.waitForType('connected');
    const b = await createWsClient(server, atlas.id, peerToken);
    const conn = await b.waitForType('connected');

    assert.equal(conn.usersOnline.length, 2, 'as duas conexões aparecem');
    for (const entrada of conn.usersOnline) {
      assert.deepEqual(
        Object.keys(entrada).sort(),
        CAMPOS,
        `entrada com shape inesperado: ${JSON.stringify(Object.keys(entrada).sort())}`
      );
    }

    a.close();
    b.close();
  });

  it('MESMO usuário em duas abas aparece DUAS vezes com o mesmo id, ambas online', async () => {
    const atlas = await atlasVazio();
    const cidA = `A-${randomUUID().slice(0, 8)}`;
    const cidB = `B-${randomUUID().slice(0, 8)}`;

    const abaA = await createWsClient(server, atlas.id, peerToken, cidA);
    await abaA.waitForType('connected');
    const abaB = await createWsClient(server, atlas.id, peerToken, cidB);
    const conn = await abaB.waitForType('connected');

    const doPeer = conn.usersOnline.filter((u) => u.id === peerUser.id);
    assert.equal(doPeer.length, 2, 'o roster é por CLIENTE, não por usuário: duas abas = duas entradas');
    assert.deepEqual(doPeer.map((u) => u.clientId).sort(), [cidA, cidB].sort());
    for (const e of doPeer) {
      assert.equal(e.status, 'online');
    }

    abaA.close();
    abaB.close();
  });

  it("visitante público entra como nome 'Visitante' e posto_graduacao null", async () => {
    const atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);
    const link = await makeAtlasPublic(db, atlas.id);
    const publicToken = await getPublicToken(app, link);

    const dono = await createWsClient(server, atlas.id, ownerToken);
    await dono.waitForType('connected');
    const visitante = await createWsClient(server, atlas.id, publicToken);
    const conn = await visitante.waitForType('connected');

    const eu = conn.usersOnline.find((u) => u.id === conn.userId);
    assert.ok(eu, 'o visitante também se vê na lista');
    assert.equal(eu.nome, 'Visitante');
    assert.equal(eu.posto_graduacao, null);
    assert.equal(conn.permission, 'read');

    dono.close();
    visitante.close();
  });

  it("dentro da graça, um terceiro vê as duas abas do mesmo id com status 'away' e 'online'", async () => {
    const atlas = await atlasVazio();
    const cidA = `A2-${randomUUID().slice(0, 8)}`;
    const cidB = `B2-${randomUUID().slice(0, 8)}`;

    const abaA = await createWsClient(server, atlas.id, peerToken, cidA);
    await abaA.waitForType('connected');
    const abaB = await createWsClient(server, atlas.id, peerToken, cidB);
    await abaB.waitForType('connected');

    abaA.ws.terminate(); // 1006 → away, mantido na sala durante a graça
    await sleep(250);

    const terceiro = await createWsClient(server, atlas.id, ownerToken);
    const conn = await terceiro.waitForType('connected');

    const doPeer = conn.usersOnline.filter((u) => u.id === peerUser.id);
    assert.equal(doPeer.length, 2, 'a aba away segue listada durante a graça');
    const porCliente = new Map(doPeer.map((u) => [u.clientId, u.status]));
    assert.equal(porCliente.get(cidA), 'away');
    assert.equal(porCliente.get(cidB), 'online');

    terceiro.close();
    abaB.close();
  });
});

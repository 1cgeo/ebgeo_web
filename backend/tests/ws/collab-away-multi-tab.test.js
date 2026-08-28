// Path: tests/ws/collab-away-multi-tab.test.js
// Item 97 — `user_away` e o seu SINAL TERMINADOR quando o mesmo usuário tem outro
// socket vivo.
//
// O invariante: TODO `user_away` termina em `user_back` (reconexão dentro da graça)
// ou em `user_left` (graça expirada). Um `away` sem terminador fica pendurado no
// roster dos pares para sempre, embora a pessoa esteja online — vazamento de estado
// de presença que emerge de TRÊS pontos (broadcast incondicional em onClose + guarda
// P8 de removeConnection + o timer), invisível lendo qualquer um deles sozinho.
//
// REFUTAÇÃO REGISTRADA: o relatório de auditoria (2026-07-19, sobre `e1bb74e`) previa
// que o caso central FALHARIA, porque a guarda P8 suprimia `user_left` quando restava
// qualquer socket do mesmo USUÁRIO. O commit a358a6e trocou a guarda para comparar
// `clientId` (collab.gateway.js:515-520), então com duas abas de clientIds distintos
// o `user_left` da aba que caiu É emitido e o invariante se mantém. O teste abaixo é
// o prendedor desse comportamento, não o repro de um defeito.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, setAwayGraceMs } from '../../src/modules/collab/collab.gateway.js';

const U = () => `away_${randomUUID().slice(0, 8)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GRACA_MS = 400;

/** Espera um frame do tipo cujo clientId case, ou devolve null ao expirar. */
async function esperarPorCliente(client, type, clientId, timeoutMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const m = client.getMessagesOfType(type).find((x) => x.clientId === clientId);
    if (m) return m;
    await sleep(25);
  }
  return null;
}

describe('presença: `user_away` sempre termina em back ou left', () => {
  let app, db, server;
  let owner, ownerToken, atlas;
  let bUser, bToken;

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
    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    await createMap(db, atlas.id);

    bUser = await createUser(db, { username: U() });
    await createShare(db, atlas.id, bUser.id, 'write', owner.id);
    bToken = await loginUser(app, bUser.username, bUser.password);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('duas abas do mesmo usuário: a queda de UMA gera away e, passada a graça, left DAQUELE clientId', async () => {
    const observador = await createWsClient(server, atlas.id, ownerToken);
    await observador.waitForType('connected');

    const cidA = `A-${randomUUID().slice(0, 8)}`;
    const cidB = `B-${randomUUID().slice(0, 8)}`;
    const abaA = await createWsClient(server, atlas.id, bToken, cidA);
    await abaA.waitForType('connected');
    const abaB = await createWsClient(server, atlas.id, bToken, cidB);
    await abaB.waitForType('connected');
    observador.clearMessages();

    abaA.ws.terminate(); // queda anormal (1006)

    const away = await esperarPorCliente(observador, 'user_away', cidA);
    assert.ok(away, 'o par recebe user_away da aba que caiu');
    assert.equal(away.userId, bUser.id);

    // Passada a graça, o terminador TEM de chegar para AQUELE clientId.
    const left = await esperarPorCliente(observador, 'user_left', cidA, GRACA_MS + 2000);
    assert.ok(left, 'todo user_away termina em user_left quando a graça expira');
    assert.equal(left.userId, bUser.id);

    // E a aba viva NÃO pode ser derrubada junto.
    assert.equal(
      observador.getMessagesOfType('user_left').filter((m) => m.clientId === cidB).length,
      0,
      'a limpeza do socket away não anuncia a saída da aba viva'
    );
    assert.equal(abaB.ws.readyState, 1, 'a aba viva segue aberta');

    // ...e continua recebendo broadcast normal.
    abaB.clearMessages();
    observador.send({ type: 'cursor', position: { lng: -43.2, lat: -22.9 }, mapId: null });
    const cursor = await abaB.waitForCursor();
    assert.equal(cursor.userId, owner.id, 'a aba viva segue na sala e recebendo');

    observador.close();
    abaB.close();
  });

  it('controle positivo, socket único: away seguido de left (âncora do contraste)', async () => {
    const observador = await createWsClient(server, atlas.id, ownerToken);
    await observador.waitForType('connected');

    const cid = `S-${randomUUID().slice(0, 8)}`;
    const solo = await createWsClient(server, atlas.id, bToken, cid);
    await solo.waitForType('connected');
    observador.clearMessages();

    solo.ws.terminate();

    const away = await esperarPorCliente(observador, 'user_away', cid);
    assert.ok(away, 'user_away emitido');
    const left = await esperarPorCliente(observador, 'user_left', cid, GRACA_MS + 2000);
    assert.ok(left, 'user_left emitido depois da graça');

    observador.close();
  });

  it('quem entra DEPOIS da graça não vê a aba caída, e vê a aba viva como online', async () => {
    const cidA = `A2-${randomUUID().slice(0, 8)}`;
    const cidB = `B2-${randomUUID().slice(0, 8)}`;
    const abaA = await createWsClient(server, atlas.id, bToken, cidA);
    await abaA.waitForType('connected');
    const abaB = await createWsClient(server, atlas.id, bToken, cidB);
    await abaB.waitForType('connected');

    abaA.ws.terminate();
    await sleep(GRACA_MS + 500); // graça expirada

    const tardio = await createWsClient(server, atlas.id, ownerToken);
    const conn = await tardio.waitForType('connected');

    const doB = conn.usersOnline.filter((u) => u.id === bUser.id);
    assert.equal(doB.length, 1, 'só a aba viva permanece no roster');
    assert.equal(doB[0].clientId, cidB);
    assert.equal(
      doB[0].status,
      'online',
      'nenhum marcador `away` pendurado num usuário que tem socket aberto'
    );

    tardio.close();
    abaB.close();
  });
});

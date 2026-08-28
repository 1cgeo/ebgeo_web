// Path: tests/ws/collab-awareness-clientid.repro.test.js
//
// Regressão de `a358a6e`, que pôs `clientId` nos frames de ENTRADA/SAÍDA de presença
// (`collab.rooms.js`, `collab.service.js`, `collab.gateway.js`) e não nos de
// AWARENESS (`cursor`, `selection`, `temporal`, em `collab.handlers.js`).
//
// Por que isso quebra o produto e não só o formato: o roster do frontend é KEYED por
// `clientId` (`resolveKey` prefere `clientId` e só cai para `userId` quando ele falta).
// Um frame de awareness sem `clientId` portanto NÃO atualiza a entrada existente, ele
// CRIA UMA SEGUNDA. O par vira duas linhas no roster assim que mexe o mouse, uma com
// nome e sem cursor, outra sem nome e com o rótulo caindo para o UUID cru.
//
// Por que a suíte não pegou, e esta é a lição que vale mais: o teste do lado cliente
// (`presence-store.test.js`) injetava `clientId` dentro do payload de `setCursor`, um
// campo que o backend nunca emitia. A fixture era mais generosa que o formato de fio,
// então cada lado passava sozinho e o par estava quebrado. É o ponto cego estrutural
// nº 5 de `testes-backend.md`: a fronteira entre os pacotes afirmada em comentário e
// nunca exercitada. Este arquivo afirma o CONTRATO DE FIO, que é o lado que o cliente
// não pode inventar.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser, createShare } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('WS awareness — clientId no frame (regressão a358a6e)', () => {
  let app, db, server;
  let owner, peer, ownerToken, peerToken, atlas, map;
  const ownerClientId = randomUUID();

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: 'awc_owner' });
    peer = await createUser(db, { username: 'awc_peer' });
    ownerToken = await loginUser(app, owner.username, owner.password);
    peerToken = await loginUser(app, peer.username, peer.password);
    atlas = await createAtlas(db, owner.id, { name: 'Awareness ClientId Atlas' });
    map = await createMap(db, atlas.id, { name: 'Awareness Map' });
    await createShare(db, atlas.id, peer.id, 'write');
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /**
   * Abre emissor (com clientId estável) e receptor, e devolve o frame recebido.
   * @param {object} payload - mensagem enviada pelo emissor
   * @param {string} tipo - type esperado no receptor
   */
  async function trocar(payload, tipo) {
    const emissor = await createWsClient(server, atlas.id, ownerToken, ownerClientId);
    const receptor = await createWsClient(server, atlas.id, peerToken);
    try {
      await emissor.waitForType('connected');
      await receptor.waitForType('connected');
      receptor.clearMessages();
      emissor.send(payload);
      // O cursor tem DOIS regimes no fio (relay imediato ou lote por sala, conforme
      // `WS_CURSOR_BATCH_MS`), e o que este arquivo prende nao e o formato: e que a chave do
      // roster e a do awareness sao a MESMA. `waitForCursor` diz isso nos dois. Os outros
      // frames de presenca (selection, temporal) nao sao agrupados e seguem por tipo.
      return tipo === 'cursor'
        ? await receptor.waitForCursor()
        : await receptor.waitForType(tipo);
    } finally {
      emissor.close();
      receptor.close();
    }
  }

  it('cursor carrega o clientId do emissor, não só o userId', async () => {
    const frame = await trocar(
      { type: 'cursor', position: { lat: -15.7, lng: -47.9 }, mapId: map.id },
      'cursor'
    );
    assert.equal(frame.userId, owner.id, 'userId continua no frame (não é substituição)');
    assert.equal(
      frame.clientId,
      ownerClientId,
      'sem clientId o roster do peer cria uma SEGUNDA entrada para a mesma pessoa'
    );
  });

  it('selection carrega o clientId do emissor', async () => {
    const frame = await trocar(
      { type: 'selection', surface: '2d', featureIds: [randomUUID()], mapId: map.id },
      'selection'
    );
    assert.equal(frame.userId, owner.id);
    assert.equal(frame.clientId, ownerClientId);
  });

  it('temporal carrega o clientId do emissor', async () => {
    const frame = await trocar(
      { type: 'temporal', state: { cursor: 1000 }, mapId: map.id },
      'temporal'
    );
    assert.equal(frame.userId, owner.id);
    assert.equal(frame.clientId, ownerClientId);
  });

  it('a chave do roster e a do awareness são a MESMA para o mesmo socket', async () => {
    // O defeito não é "falta um campo", é "duas chaves para uma pessoa". Este caso
    // afirma a igualdade diretamente, para que trocar a origem do clientId em um dos
    // dois caminhos (roster ou awareness) e esquecer o outro reprove aqui.
    // O receptor entra PRIMEIRO: `user_joined` é emitido na entrada de um peer, então
    // quem já está na sala é que o recebe. Invertido, o teste falha por timeout e a
    // mensagem não diz isso.
    const receptor = await createWsClient(server, atlas.id, peerToken);
    await receptor.waitForType('connected');
    const emissor = await createWsClient(server, atlas.id, ownerToken, ownerClientId);
    try {
      await emissor.waitForType('connected');
      const entrada = await receptor.waitForType('user_joined');
      receptor.clearMessages();
      emissor.send({ type: 'cursor', position: { lat: 1, lng: 1 }, mapId: map.id });
      const awareness = await receptor.waitForCursor();

      assert.ok(entrada.clientId, 'o frame de entrada precisa trazer clientId');
      assert.equal(
        awareness.clientId,
        entrada.clientId,
        'roster e awareness precisam concordar na chave, senão o peer conta duas pessoas'
      );
    } finally {
      emissor.close();
      receptor.close();
    }
  });
});

// Path: tests/ws/collab-shutdown-presence.test.js
// P4 — closeAllSockets() lets a graceful shutdown finish.
// P8 — `user_left` is announced only for a user's LAST socket.
//
// P4: collab sockets are long-lived BY DESIGN, so `server.close()` (which waits
// for every connection to end) never fired its callback while one was open —
// blobPool.closeAll(), pgp.end() and process.exit(0) were all skipped and the
// process hung until SIGKILL.
//
// P8: `user_left` carries only userId, so it was broadcast even when the same
// user still had another socket in the room (a second tab, or a reconnect with a
// fresh clientId racing the old socket's close). Peers dropped a user who was
// still online.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket — graceful shutdown (P4) and last-socket user_left (P8)', () => {
  let app, db, server, gateway;
  let owner, ownerToken, atlas;
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    gateway = await import('../../src/modules/collab/collab.gateway.js');
    gateway.attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `sd_owner_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);

    atlas = await createAtlas(db, owner.id, { name: 'Shutdown Atlas' });
  });

  beforeEach(() => {
    openClients = [];
  });

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
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  async function connect(token, clientId) {
    const client = await createWsClient(server, atlas.id, token, clientId);
    openClients.push(client);
    await client.waitForType('connected');
    return client;
  }

  // ── P8 ────────────────────────────────────────────────────────────────────
  //
  // Each case uses its OWN user. `afterEach` tears clients down with terminate(),
  // which is an ABNORMAL close (1006) → the away-grace path deliberately KEEPS
  // the socket in the room. A shared user would therefore carry a lingering
  // socket into the next case and mask the result.
  async function freshPeer(label) {
    const u = await createUser(db, { username: `sd_${label}_${randomUUID().slice(0, 6)}` });
    const { createShare } = await import('../helpers/fixtures.js');
    await createShare(db, atlas.id, u.id, 'write', owner.id);
    return { user: u, token: await loginUser(app, u.username, u.password) };
  }

  // A presença é POR CLIENTE, não por usuário: o roster do par é chaveado pelo
  // `clientId` (o `resolveKey` do frontend o prefere, e `userLeft` apaga UMA
  // chave). Este caso afirmava que fechar uma de duas abas NÃO anunciava nada —
  // o que era coerente enquanto o roster era chaveado por usuário, e virou
  // vazamento quando passou a ser por cliente: a entrada da aba fechada ficaria
  // no roster dos pares para sempre, porque só o ÚLTIMO socket anunciava, e
  // anunciava o clientId dele, não o da aba que saiu.
  //
  // O que o caso protege continua o mesmo — não derrubar quem segue online — só
  // que agora na granularidade certa.
  it('fechar UMA de duas abas anuncia a saída DAQUELA aba, e a outra sobrevive', async () => {
    const observer = await connect(ownerToken);
    const twoTabs = await freshPeer('tabs');
    const idA = `tab-a-${randomUUID().slice(0, 8)}`;
    const idB = `tab-b-${randomUUID().slice(0, 8)}`;
    const tabA = await connect(twoTabs.token, idA);
    await connect(twoTabs.token, idB);

    observer.clearMessages();
    tabA.ws.close(1000, 'tab closed'); // clean close → immediate removal path
    await sleep(300);

    const left = observer.getMessagesOfType('user_left').filter((m) => m.userId === twoTabs.user.id);
    assert.equal(left.length, 1, 'a aba fechada precisa anunciar a própria saída');
    assert.equal(left[0].clientId, idA, 'e o anúncio identifica QUAL aba saiu');
    assert.notEqual(left[0].clientId, idB, 'a aba viva não pode ser removida do roster');
  });

  it('closing the LAST socket does announce user_left', async () => {
    // Guard against over-correcting P8 into never announcing a departure.
    const observer = await connect(ownerToken);
    const solo = await freshPeer('solo');
    const only = await connect(solo.token, `solo-${randomUUID().slice(0, 8)}`);

    observer.clearMessages();
    only.ws.close(1000, 'bye');

    const left = await observer.waitForType('user_left');
    assert.equal(left.userId, solo.user.id, 'the last socket must announce the departure');
  });

  // ── P4 ────────────────────────────────────────────────────────────────────
  it('closeAllSockets() closes live collab sockets so server.close() can finish', async () => {
    // A dedicated server, so closing it cannot disturb the shared one above.
    const httpServer = createServer(app);
    gateway.attachWebSocket(httpServer);
    await new Promise((resolve) => httpServer.listen(0, () => resolve()));

    const client = await createWsClient(httpServer, atlas.id, ownerToken);
    await client.waitForType('connected');

    const closed = new Promise((resolve) => client.ws.once('close', (code) => resolve(code)));

    // Without closeAllSockets this promise never settles — the open WebSocket
    // keeps server.close() waiting forever.
    const finished = (async () => {
      await gateway.closeAllSockets();
      await new Promise((resolve) => httpServer.close(resolve));
      return 'closed';
    })();

    const result = await Promise.race([finished, sleep(5000).then(() => 'TIMEOUT')]);
    assert.equal(result, 'closed', 'server.close() must complete once sockets are closed');

    // 1001 "going away" tells the client this is a shutdown, not an error.
    assert.equal(await closed, 1001, 'clients are closed with 1001 going-away');

    // Re-attach the shared server's gateway: closeAllSockets cleared the module's
    // reference, and later tests in this file rely on it.
    gateway.attachWebSocket(server);
  });

  it('closeAllSockets() is safe to call when nothing is attached', async () => {
    await gateway.closeAllSockets();
    await gateway.closeAllSockets(); // idempotent — must not throw
    gateway.attachWebSocket(server);
  });
});

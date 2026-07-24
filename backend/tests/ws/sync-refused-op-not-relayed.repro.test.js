// Path: tests/ws/sync-refused-op-not-relayed.repro.test.js
// Companion guard to the locked-map fix (achado 22).
//
// Turning a policy refusal from "throw and 409 the batch" into "refuse this op and answer 200"
// unfreezes the client's queue, but it also means the push no longer fails — so the WS relay,
// which used to be skipped by the thrown error, would happily broadcast an op the server just
// REFUSED. The peer would then apply an edit that exists nowhere on the server (no entity row, no
// operations row, no server_version) and that no snapshot will ever bring back: silent divergence
// until a full resync.
//
// So a refused op is acked to its author and relayed to nobody, while its accepted siblings in the
// same batch still reach the peer.
//
// Negative control: drop the `success === false` guards in collab.handlers.js and the two
// "peer never sees it" assertions fail.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('WS relay: a refused operation never reaches the peers (repro)', () => {
  let app, db, server;
  let owner, ownerToken, peer, peerToken, atlas, lockedMap, freeMap;
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `rlx_own_${randomUUID().slice(0, 6)}` });
    peer = await createUser(db, { username: `rlx_peer_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    peerToken = await loginUser(app, peer.username, peer.password);

    atlas = await createAtlas(db, owner.id, { name: 'Refused Relay Atlas' });
    await createShare(db, atlas.id, peer.id, 'write', owner.id);
    lockedMap = await createMap(db, atlas.id, { name: 'Bloqueado' });
    freeMap = await createMap(db, atlas.id, { name: 'Livre' });
    await db.query('UPDATE maps SET locked = true WHERE id = $1', [lockedMap.id]);
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

  const featureOp = (id, mapId) => ({
    id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId,
    data: {
      type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
      properties: { id, source: 'point', nome: 'x' },
    },
    timestamp: Date.now(), clientId: 'a-relay',
  });

  /** Collects every op id the peer received across `operation` and `operations` frames. */
  const receivedIds = (client) => [
    ...client.getMessagesOfType('operation').map((m) => m.op?.entityId ?? m.op?.targetId),
    ...client.getMessagesOfType('operations').flatMap((m) => (m.ops || []).map((o) => o.entityId ?? o.targetId)),
  ];

  it('single op refused (locked map): the author is acked, the peer is told nothing', async () => {
    const a = await connect(ownerToken, 'a-relay');
    const b = await connect(peerToken, 'b-relay');
    b.clearMessages();

    const blockedId = randomUUID();
    a.clearMessages();
    a.send({ type: 'operation', op: featureOp(blockedId, lockedMap.id) });
    const ack = await a.waitForType('ack');
    assert.equal(ack.result.success, false, 'the author learns the op was refused');

    // A follow-up op that IS accepted gives the peer's inbox something to arrive, so
    // "the refused op never came" is a real observation instead of a race with the network.
    const okId = randomUUID();
    a.clearMessages();
    a.send({ type: 'operation', op: featureOp(okId, freeMap.id) });
    await a.waitForType('ack');
    await b.waitForType('operation');

    const ids = receivedIds(b);
    assert.ok(ids.includes(okId), 'the accepted op reaches the peer');
    assert.ok(!ids.includes(blockedId), 'the refused op must never reach the peer');
  });

  it('mixed batch: the accepted op is relayed, the refused one is filtered out', async () => {
    const a = await connect(ownerToken, 'a-relay');
    const b = await connect(peerToken, 'b-relay');
    b.clearMessages();

    const blockedId = randomUUID();
    const okId = randomUUID();
    a.clearMessages();
    a.send({ type: 'operations', ops: [featureOp(blockedId, lockedMap.id), featureOp(okId, freeMap.id)] });

    const ack = await a.waitForType('ack_batch');
    assert.equal(ack.results.length, 2, 'one ack per op, so the client can dequeue both');
    assert.equal(ack.results[0].success, false);
    assert.equal(ack.results[1].success, true);

    await b.waitForType('operations');
    const ids = receivedIds(b);
    assert.ok(ids.includes(okId), 'the accepted op reaches the peer');
    assert.ok(!ids.includes(blockedId), 'the refused op is filtered out of the batch relay');
  });
});

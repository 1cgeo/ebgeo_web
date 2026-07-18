// Path: tests/ws/collab-commenter-authz.test.js
// WS-layer authorization for the Comentarista (comment) tier. The REST push path is
// covered by tests/integration/comments.test.js; the WebSocket path was NOT. A commenter
// has permission 'comment', so it passes the `read` gate in handleOperation (which only
// blocks permission === 'read'); a non-comment op is then stopped deep inside
// pushOperations by assertOperationAllowed, which throws a ForbiddenError surfaced over WS
// as an `error`/OPERATION_FAILED frame with NOTHING persisted (the throw happens before the
// INSERT, inside the tx → full rollback). We assert both the rejection (feature op) and the
// positive (comment op acked + persisted).

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket collab — Comentarista (comment tier) authorization', () => {
  let app, db, server;
  let owner, commenter, commenterToken;
  let atlas, map;

  // Track every opened client so afterEach can force-close leaks (a hung socket
  // would block server.close() in after()).
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `cw_owner_${randomUUID().slice(0, 6)}` });
    commenter = await createUser(db, { username: `cw_commenter_${randomUUID().slice(0, 6)}` });
    commenterToken = await loginUser(app, commenter.username, commenter.password);

    atlas = await createAtlas(db, owner.id, { name: 'Commenter WS Authz Atlas' });
    map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, commenter.id, 'comment', owner.id);
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

  it('a commenter pushing a FEATURE op over WS is rejected and nothing persists', async () => {
    const client = await connect(commenterToken);

    // Same well-formed feature op the owner uses successfully elsewhere, so the ONLY
    // reason it must not persist is the comment-tier authorization gate.
    const opId = randomUUID();
    const entityId = randomUUID();
    const marker = `cw_forbidden_${randomUUID().slice(0, 8)}`;

    client.send({
      type: 'operation',
      op: {
        id: opId,
        type: 'create',
        target: 'feature',
        targetId: entityId,
        mapId: map.id,
        data: {
          feature_type: 'point',
          geometry: { coordinates: [0, 0] },
          properties: { name: marker },
        },
        timestamp: Date.now(),
        clientId: 'cw-commenter',
      },
    });

    const err = await client.waitForType('error');
    // The read gate let the comment tier through; assertOperationAllowed then threw a
    // ForbiddenError, caught by handleOperation → OPERATION_FAILED with the spec message.
    assert.equal(err.code, 'OPERATION_FAILED');
    assert.match(err.message.toLowerCase(), /coment/);

    // Give any (buggy) async write time to land, then assert nothing persisted.
    await sleep(300);

    const { rows: byOpId } = await db.query(
      'SELECT count(*)::int AS n FROM operations WHERE op_id = $1',
      [opId]
    );
    assert.equal(byOpId[0].n, 0, 'forbidden feature op must not reach the operations log');

    const { rows: feat } = await db.query(
      `SELECT count(*)::int AS n FROM features WHERE properties->>'name' = $1`,
      [marker]
    );
    assert.equal(feat[0].n, 0, 'no feature row written by a commenter');
  });

  it('a commenter pushing a COMMENT op over WS is accepted and persisted', async () => {
    const client = await connect(commenterToken);

    const id = randomUUID();
    const opId = randomUUID();
    client.send({
      type: 'operation',
      op: {
        id: opId,
        entityType: 'comment',
        operationType: 'create',
        entityId: id,
        mapId: map.id,
        timestamp: Date.now(),
        clientId: 'cw-commenter',
        data: { id, mapId: map.id, lng: -43.2, lat: -22.9, text: 'Olá', status: 'open', authorId: commenter.id },
      },
    });

    const ack = await client.waitForType('ack');
    assert.equal(ack.opId, opId, 'the comment op is acked');

    const { rows } = await db.query('SELECT id, status FROM comments WHERE id = $1', [id]);
    assert.equal(rows.length, 1, 'comment row created by the commenter over WS');
    assert.equal(rows[0].status, 'open');
  });

  it("a commenter's selection presence is NOT broadcast to peers (editor-gated)", async () => {
    // The only thing a Comentarista does to shared state is comment. Live selection
    // presence is gated to editors (owner/write), so a commenter — like a viewer —
    // sees peers' selections but never broadcasts its own.
    const ownerTok = await loginUser(app, owner.username, owner.password);
    const ownerClient = await connect(ownerTok);
    const commenterClient = await connect(commenterToken);

    ownerClient.clearMessages();
    commenterClient.send({ type: 'selection', featureIds: [randomUUID()], mapId: map.id });
    await sleep(300);

    assert.equal(
      ownerClient.getMessagesOfType('selection').length,
      0,
      'a comment-tier user must not broadcast selection to peers'
    );
  });
});

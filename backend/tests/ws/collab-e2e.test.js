// Path: tests/ws/collab-e2e.test.js
// Fase 8 (Tarefa 7): end-to-end multi-client collaboration over WebSocket.
// Covers the backend-guaranteed hard cases: idempotent resend, LWW-by-arrival
// convergence, read-only enforcement, sync reconciliation, and the away-vs-remove
// presence lifecycle (Tarefa 2) including reconnect cancellation.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser,
  makeAtlasPublic, getPublicToken,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const GRACE_MS = 500;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket collaboration — e2e (Fase 8)', () => {
  let app, db, server, owner, ownerTok, writer, writerTok, setAwayGraceMs;

  // A fresh shared atlas (owner + writer with write) per test — isolates
  // presence broadcasts so abnormal-close timers from one test never bleed into
  // another.
  async function freshAtlas() {
    const atlas = await createAtlas(db, owner.id, { name: `E2E ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
    return { atlasId: atlas.id, mapId: map.id };
  }

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const gateway = await import('../../src/modules/collab/collab.gateway.js');
    gateway.attachWebSocket(server);
    setAwayGraceMs = gateway.setAwayGraceMs;
    setAwayGraceMs(GRACE_MS); // short grace so the removal path is observable
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: 'e2e_owner' });
    ownerTok = await loginUser(app, owner.username, owner.password);
    writer = await createUser(db, { username: 'e2e_writer' });
    writerTok = await loginUser(app, writer.username, writer.password);
  });

  after(async () => {
    if (server) {
      // Force-drop any leaked sockets so server.close() can resolve.
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  it('idempotent resend of the same op.id does not duplicate (ack idempotent)', async () => {
    const { atlasId, mapId } = await freshAtlas();
    const client = await createWsClient(server, atlasId, writerTok);
    await client.waitForType('connected');

    const featureId = randomUUID();
    const op = {
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: featureId,
      mapId,
      data: { feature_type: 'point', geometry: { coordinates: [-43.5, -23.0] }, properties: { name: 'Idem' } },
      timestamp: Date.now(),
      clientId: 'e2e-idem',
    };

    client.send({ type: 'operation', op });
    const ack1 = await client.waitForType('ack');
    assert.equal(ack1.opId, op.id);
    assert.ok(!ack1.result.idempotent);

    client.clearMessages();
    client.send({ type: 'operation', op }); // resend SAME op.id
    const ack2 = await client.waitForType('ack');
    assert.equal(ack2.result.idempotent, true);

    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM features WHERE id = $1', [featureId]);
    assert.equal(rows[0].n, 1);
    client.close();
  });

  it('LWW-by-arrival: the last update applied wins and peers converge', async () => {
    const { atlasId, mapId } = await freshAtlas();
    const ownerClient = await createWsClient(server, atlasId, ownerTok);
    const writerClient = await createWsClient(server, atlasId, writerTok);
    await ownerClient.waitForType('connected');
    await writerClient.waitForType('connected');

    const featureId = randomUUID();
    writerClient.send({
      type: 'operation',
      op: {
        id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: featureId, mapId,
        data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: { name: 'orig' } },
        timestamp: Date.now(), clientId: 'e2e-w',
      },
    });
    await writerClient.waitForType('ack');

    const mkUpdate = (name, clientId) => ({
      id: randomUUID(), entityType: 'feature', operationType: 'update', entityId: featureId, mapId,
      changes: { properties: { name } }, timestamp: Date.now(), clientId,
    });

    ownerClient.clearMessages();
    ownerClient.send({ type: 'operation', op: mkUpdate('A', 'e2e-o') });
    await ownerClient.waitForType('ack');

    writerClient.clearMessages(); // drop the create ack so we wait for B's ack
    writerClient.send({ type: 'operation', op: mkUpdate('B', 'e2e-w') });
    const lastAck = await writerClient.waitForType('ack');

    const { rows } = await db.query('SELECT properties FROM features WHERE id = $1', [featureId]);
    assert.equal(rows[0].properties.name, 'B'); // last writer by arrival wins

    // Both clients can reconcile to the same authoritative version.
    ownerClient.clearMessages();
    ownerClient.send({ type: 'sync_request', lastVersion: 0 });
    const syncMsg = await ownerClient.waitForType('sync_response');
    assert.ok(syncMsg.currentVersion >= lastAck.serverVersion);

    ownerClient.close();
    writerClient.close();
  });

  it('read-only (public) client cannot send operations (FORBIDDEN)', async () => {
    const pubAtlas = await createAtlas(db, owner.id, { name: 'E2E Public' });
    await createMap(db, pubAtlas.id);
    const link = await makeAtlasPublic(db, pubAtlas.id);
    const pubToken = await getPublicToken(app, link);

    const client = await createWsClient(server, pubAtlas.id, pubToken);
    await client.waitForType('connected');
    client.send({
      type: 'operation',
      op: {
        id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: randomUUID(), mapId: null,
        data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
        timestamp: Date.now(), clientId: 'e2e-pub',
      },
    });
    const err = await client.waitForType('error');
    assert.equal(err.code, 'FORBIDDEN');
    client.close();
  });

  it('sync_request from version 0 reconciles state', async () => {
    const { atlasId } = await freshAtlas();
    const fresh = await createWsClient(server, atlasId, writerTok);
    await fresh.waitForType('connected');
    fresh.send({ type: 'sync_request', lastVersion: 0 });
    const res = await fresh.waitForType('sync_response');
    assert.ok('currentVersion' in res);
    assert.ok(res.isSnapshot ? res.snapshot : Array.isArray(res.ops));
    fresh.close();
  });

  describe('away vs remove (Tarefa 2)', () => {
    it('network drop marks the user away (not left), then removes after grace', async () => {
      const { atlasId } = await freshAtlas();
      const observer = await createWsClient(server, atlasId, ownerTok);
      const target = await createWsClient(server, atlasId, writerTok, randomUUID());
      await observer.waitForType('connected');
      await target.waitForType('connected');
      observer.clearMessages();

      target.ws.terminate(); // abnormal close (1006) → away

      const away = await observer.waitForType('user_away', 2000);
      assert.equal(away.userId, writer.id);
      assert.equal(observer.getMessagesOfType('user_left').length, 0); // not removed yet

      // after the grace window with no reconnect → user_left
      const left = await observer.waitForType('user_left', GRACE_MS + 1500);
      assert.equal(left.userId, writer.id);
      observer.close();
    });

    it('reconnect with the same clientId within the grace window cancels removal', async () => {
      const { atlasId } = await freshAtlas();
      const stableId = randomUUID();
      const observer = await createWsClient(server, atlasId, ownerTok);
      let target = await createWsClient(server, atlasId, writerTok, stableId);
      await observer.waitForType('connected');
      await target.waitForType('connected');
      observer.clearMessages();

      target.ws.terminate();
      await observer.waitForType('user_away', 2000);

      // reconnect promptly with the SAME clientId → cancels the away timer
      target = await createWsClient(server, atlasId, writerTok, stableId);
      await target.waitForType('connected');
      const back = await observer.waitForType('user_back', 2000);
      assert.equal(back.userId, writer.id);

      // wait past the grace window and assert NO user_left fired
      await wait(GRACE_MS + 400);
      assert.equal(observer.getMessagesOfType('user_left').length, 0);

      observer.close();
      target.close();
    });

    it('clean close (code 1000) removes immediately (user_left)', async () => {
      const { atlasId } = await freshAtlas();
      const observer = await createWsClient(server, atlasId, ownerTok);
      const target = await createWsClient(server, atlasId, writerTok);
      await observer.waitForType('connected');
      await target.waitForType('connected');
      observer.clearMessages();

      target.ws.close(1000, 'bye'); // clean close → immediate removal
      // arrives well before the grace window would elapse
      const left = await observer.waitForType('user_left', GRACE_MS - 100);
      assert.equal(left.userId, writer.id);
      observer.close();
    });

    it('explicit leave message removes immediately', async () => {
      const { atlasId } = await freshAtlas();
      const observer = await createWsClient(server, atlasId, ownerTok);
      const target = await createWsClient(server, atlasId, writerTok, randomUUID());
      await observer.waitForType('connected');
      await target.waitForType('connected');
      observer.clearMessages();

      target.send({ type: 'leave' });
      const left = await observer.waitForType('user_left', GRACE_MS - 100);
      assert.equal(left.userId, writer.id);
      observer.close();
    });
  });
});

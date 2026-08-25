// Path: tests/ws/collab-lifecycle-coverage.test.js
// Connection-lifecycle coverage for the collab WS gateway/handlers/rooms/service.
// These fill genuine gaps left by the existing ws/ suite (collab*.test.js):
//   - the malformed-clientId fallback branch of CLIENT_ID_RE (not the valid/absent
//     paths already in collab-clientid.test.js);
//   - a read-only `operation` rejected with FORBIDDEN asserting NOTHING reached the
//     `operations` log (existing tests only check the `features` projection);
//   - handleSyncRequest's INCREMENTAL `ops` branch (every existing sync test uses
//     lastVersion:0 → snapshot only; the else-branch was untested);
//   - the documented 4001 close CODE on closeRoom (atlas delete) — collab-broadcasts
//     only asserts the socket left OPEN state, never the code;
//   - handleConnectionQuality on the `critical` band with the full settings payload
//     and the "different rtt, SAME band → no re-emit" guard on a fresh socket.
//
// Every test asserts a real observable (a received frame, a DB row count, or a close
// code). Sockets are tracked and force-closed in teardown so the run never hangs.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket collab — connection-lifecycle coverage', () => {
  let app, db, server;
  let owner, ownerToken, reader, readerToken;
  let atlas, map;

  // Track every client opened in a test so afterEach can force-close leaks
  // (a hung socket would block server.close() in after()).
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `lc_owner_${randomUUID().slice(0, 6)}` });
    reader = await createUser(db, { username: `lc_reader_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    readerToken = await loginUser(app, reader.username, reader.password);

    atlas = await createAtlas(db, owner.id, { name: 'Lifecycle Coverage Atlas' });
    map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, reader.id, 'read', owner.id);
  });

  beforeEach(() => {
    openClients = [];
  });

  afterEach(() => {
    // Force-drop anything a test forgot to close so the suite can't hang.
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

  // Opens a tracked client and waits for `connected`. Returns { client, connected }.
  async function connect(token, clientId) {
    const client = await createWsClient(server, atlas.id, token, clientId);
    openClients.push(client);
    const connected = await client.waitForType('connected');
    return { client, connected };
  }

  // ── clientId validation ────────────────────────────────────────────────────
  describe('clientId handshake validation', () => {
    it('a malformed clientId (too short) is rejected and a stable id is generated instead', async () => {
      // "ab" fails CLIENT_ID_RE (min length 8) → gateway falls back to a server id.
      const { connected } = await connect(ownerToken, 'ab');
      assert.ok(connected.sessionId, 'a sessionId is always returned');
      assert.notEqual(connected.sessionId, 'ab', 'the malformed clientId must NOT be echoed back as the session id');
      // The generated id is a UUID (the crypto.randomUUID fallback).
      assert.match(connected.sessionId, /^[0-9a-f-]{36}$/i);
    });

    it('a malformed clientId (illegal chars) is rejected and a stable id is generated instead', async () => {
      // "bad id!" contains a space and "!" → fails the regex → server fallback.
      const { connected } = await connect(ownerToken, encodeURIComponent('bad id!'));
      assert.ok(connected.sessionId);
      assert.notEqual(connected.sessionId, 'bad id!');
      assert.match(connected.sessionId, /^[0-9a-f-]{36}$/i);
    });

    it('a well-formed clientId at the 8-char boundary is honored verbatim', async () => {
      // Exactly 8 chars of the allowed alphabet → passes the regex, used as-is.
      const stable = 'abc12345';
      const { connected } = await connect(ownerToken, stable);
      assert.equal(connected.sessionId, stable);
    });
  });

  // ── read-only write rejection (operations log untouched) ────────────────────
  describe('read-only operation rejection persists nothing', () => {
    it('a reader sending an operation gets FORBIDDEN and writes no row to the operations log', async () => {
      const { client } = await connect(readerToken);

      // A marker we can search the operations log for. The op is well-formed so
      // the ONLY reason it must not persist is the read permission gate.
      const opId = randomUUID();
      const entityId = randomUUID();
      const marker = `lc_forbidden_${randomUUID().slice(0, 8)}`;

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
          clientId: 'lc-reader',
        },
      });

      const err = await client.waitForType('error');
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.message, 'Seu acesso a este atlas é somente leitura.');

      // Give any (buggy) async write time to land, then assert the log is clean.
      await sleep(300);

      const { rows: byOpId } = await db.query(
        'SELECT count(*)::int AS n FROM operations WHERE op_id = $1',
        [opId]
      );
      assert.equal(byOpId[0].n, 0, 'forbidden op must not appear in the operations log by op_id');

      const { rows: byEntity } = await db.query(
        'SELECT count(*)::int AS n FROM operations WHERE entity_id = $1',
        [entityId]
      );
      assert.equal(byEntity[0].n, 0, 'forbidden op must not appear in the operations log by entity_id');

      // And the feature projection stays empty too (belt and suspenders).
      const { rows: feat } = await db.query(
        `SELECT count(*)::int AS n FROM features WHERE properties->>'name' = $1`,
        [marker]
      );
      assert.equal(feat[0].n, 0);
    });
  });

  // ── handleSyncRequest incremental branch ────────────────────────────────────
  describe('sync_request incremental (ops) branch', () => {
    it('a non-zero lastVersion returns isSnapshot:false with the ops applied after that version', async () => {
      // Use a fresh atlas so version numbering is deterministic for this test.
      const a = await createAtlas(db, owner.id, { name: `Incr Sync ${randomUUID().slice(0, 6)}` });
      const m = await createMap(db, a.id);

      const c = await createWsClient(server, a.id, ownerToken);
      openClients.push(c);
      await c.waitForType('connected');

      // Op #1 → bumps the atlas to version 1.
      c.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: m.id,
          data: { feature_type: 'point', geometry: { coordinates: [1, 1] }, properties: { tag: 'v1' } },
          timestamp: Date.now(),
          clientId: 'lc-incr',
        },
      });
      const ack1 = await c.waitForType('ack');
      const v1 = ack1.serverVersion;
      assert.ok(v1 >= 1);

      // Op #2 → version 2; this is the one an incremental pull from v1 must return.
      // Clear first so waitForType('ack') resolves on op#2's ack, not the buffered op#1 ack.
      c.clearMessages();
      const entity2 = randomUUID();
      c.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: entity2,
          mapId: m.id,
          data: { feature_type: 'point', geometry: { coordinates: [2, 2] }, properties: { tag: 'v2' } },
          timestamp: Date.now(),
          clientId: 'lc-incr',
        },
      });
      const ack2 = await c.waitForType('ack');
      assert.ok(ack2.serverVersion > v1);

      // Pull from v1 (non-zero, >= min_version 0) → incremental, NOT a snapshot.
      c.clearMessages();
      c.send({ type: 'sync_request', lastVersion: v1 });
      const res = await c.waitForType('sync_response');

      assert.equal(res.isSnapshot, false, 'a non-zero lastVersion must take the incremental branch');
      assert.ok(Array.isArray(res.ops), 'incremental response carries an `ops` array');
      assert.equal(res.snapshot, undefined, 'incremental response must NOT carry a snapshot');
      assert.ok(res.currentVersion >= ack2.serverVersion);

      // The op created after v1 (entity2) is present in the incremental delta.
      const ids = res.ops.map((o) => o.entityId ?? o.entity_id ?? o.targetId);
      assert.ok(ids.includes(entity2), 'the op applied after lastVersion must be in the delta');
    });
  });

  // ── closeRoom 4001 close code on atlas delete ───────────────────────────────
  describe('atlas delete closes connected sockets with code 4001', () => {
    it('a connected client receives the documented 4001 close code when its atlas is deleted', async () => {
      // Dedicated atlas so deleting it does not disturb the shared fixtures.
      const delAtlas = await createAtlas(db, owner.id, { name: `Del ${randomUUID().slice(0, 6)}` });
      await createMap(db, delAtlas.id);

      const port = server.address().port;
      const ws = new WebSocket(
        `ws://localhost:${port}/api/v1/collab?atlasId=${delAtlas.id}&token=${ownerToken}`
      );
      openClients.push({ ws });

      // Capture the raw close code (the ws-client helper does not expose it).
      const closePromise = new Promise((resolve) => {
        ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      });

      await new Promise((resolve, reject) => {
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'connected') resolve();
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('connect timeout')), 3000);
      });

      // Delete the atlas via REST → controller calls closeRoom(atlasId, ...).
      const res = await supertest(app)
        .delete(`/api/v1/atlas/${delAtlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      assert.equal(res.status, 204);

      const closed = await closePromise;
      assert.equal(closed.code, 4001, 'atlas delete must close the socket with the documented 4001 code');
    });
  });

  // ── handleConnectionQuality: critical band + same-band guard ─────────────────
  describe('adaptive-settings: critical band and same-band guard', () => {
    let qClient;

    beforeEach(async () => {
      ({ client: qClient } = await connect(ownerToken));
      qClient.clearMessages();
    });

    it('a critical-latency sample pushes the full critical settings payload', async () => {
      qClient.send({ type: 'connection-quality', rttMs: 3000 }); // >= 800 → critical
      const settings = await qClient.waitForType('adaptive-settings');
      assert.equal(settings.quality, 'critical');
      assert.equal(settings.batchIntervalMs, 3000);
      assert.equal(settings.geometryPrecision, 4);
      assert.equal(settings.viewportOnly, true);
    });

    it('a second sample in the SAME band does not re-emit; only a band change does', async () => {
      // First "good" sample (100..299) → one emit.
      qClient.send({ type: 'connection-quality', rttMs: 150 });
      const first = await qClient.waitForType('adaptive-settings');
      assert.equal(first.quality, 'good');

      // Different rtt, still "good" → NO new adaptive-settings frame.
      qClient.clearMessages();
      qClient.send({ type: 'connection-quality', rttMs: 250 });
      await sleep(300);
      assert.equal(qClient.getMessagesOfType('adaptive-settings').length, 0, 'same band must not re-emit');

      // Now cross into "critical" → exactly one new frame.
      qClient.send({ type: 'connection-quality', rttMs: 1200 });
      const next = await qClient.waitForType('adaptive-settings');
      assert.equal(next.quality, 'critical');
      assert.equal(qClient.getMessagesOfType('adaptive-settings').length, 1);
    });
  });
});

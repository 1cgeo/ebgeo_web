// Path: tests/ws/multiuser-session-e2e.test.js
// ONE realistic end-to-end multiuser WebSocket SESSION told as a single story:
// owner A and editor B (write share) collaborate live over real `ws` clients.
// The value is the full sequence working together — at every step we assert the
// REAL observables: the frames each client receives (including excluding-sender
// broadcast semantics) AND the persisted DB / snapshot state. A second, shorter
// story covers the abnormal-drop -> away -> reconnect -> back presence lifecycle.
//
// Reuses the existing ws harness (createWsClient / fixtures / setupTestEnv) — see
// tests/ws/collab.test.js and collab-e2e.test.js for the same scaffolding.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const GRACE_MS = 500; // short away-grace so the away/back path is observable & fast
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket multiuser session — e2e', () => {
  let app, db, server, setAwayGraceMs;
  let A, aTok; // owner
  let B, bTok; // editor (write share)

  // Every socket opened by a test is tracked here and force-closed in afterEach,
  // so a leaked client never keeps the run (or server.close) hanging.
  const sockets = [];
  function track(client) {
    sockets.push(client);
    return client;
  }

  // A fresh atlas+map per story isolates presence broadcasts and the operations
  // log so one test's frames/timers never bleed into another's assertions.
  async function freshAtlas() {
    const atlas = await createAtlas(db, A.id, { name: `Session ${randomUUID().slice(0, 6)}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, B.id, 'write', A.id);
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
    setAwayGraceMs(GRACE_MS);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    A = await createUser(db, { username: 'session_owner_a' });
    aTok = await loginUser(app, A.username, A.password);
    B = await createUser(db, { username: 'session_editor_b' });
    bTok = await loginUser(app, B.username, B.password);
  });

  afterEach(() => {
    // terminate() (not close()) so an abnormal-drop test leaves nothing pending.
    for (const c of sockets) {
      try { c.ws.terminate(); } catch { /* already gone */ }
    }
    sockets.length = 0;
  });

  after(async () => {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  it('A and B co-edit: ack+broadcast, bidirectional ops, presence round-trip, shared snapshot', async () => {
    const { atlasId, mapId } = await freshAtlas();

    // ── STEP 1: both users connect to the SAME atlas as real ws clients ────────
    // B uses a STABLE clientId for the whole story so the later drop+reconnect
    // (STEP 5) resumes the same session rather than orphaning an away timer.
    const bClientId = randomUUID();
    const a = track(await createWsClient(server, atlasId, aTok));
    const b = track(await createWsClient(server, atlasId, bTok, bClientId));

    const aConn = await a.waitForType('connected');
    const bConn = await b.waitForType('connected');
    assert.equal(aConn.permission, 'owner');           // A owns the atlas
    assert.equal(bConn.permission, 'write');            // B has a write share
    // B's connection makes A aware of the peer (user_joined excludes the sender,
    // so it lands on A, the already-present client).
    const joined = await a.waitForType('user_joined');
    assert.equal(joined.user.id, B.id);

    // ── STEP 2: A creates a feature → A gets ack(serverVersion); B gets the op ─
    // Proves: writer ack carries an authoritative serverVersion, AND the op is
    // broadcast with excluding-sender semantics (A must NOT receive its own echo).
    a.clearMessages();
    b.clearMessages();
    const featA = randomUUID();
    const opA = {
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: featA,
      mapId,
      data: { feature_type: 'point', geometry: { coordinates: [-43.1, -22.8] }, properties: { name: 'A-point' } },
      timestamp: Date.now(),
      clientId: 'A-client',
    };
    a.send({ type: 'operation', op: opA });

    const ackA = await a.waitForType('ack');
    assert.equal(ackA.opId, opA.id);
    assert.ok(Number.isInteger(ackA.serverVersion) && ackA.serverVersion > 0); // real authoritative version
    assert.ok(!ackA.result.idempotent);                                        // genuinely applied

    const bGotOpA = await b.waitForType('operation');
    assert.equal(bGotOpA.userId, A.id);
    assert.equal(bGotOpA.op.entityId, featA);
    // Excluding-sender: A only ever saw its own `ack`, never an `operation` echo.
    assert.equal(a.getMessagesOfType('operation').length, 0);

    // ── STEP 3: B creates another feature → A receives it; both ops persisted ──
    a.clearMessages();
    b.clearMessages();
    const featB = randomUUID();
    const opB = {
      id: randomUUID(),
      entityType: 'feature',
      operationType: 'create',
      entityId: featB,
      mapId,
      data: { feature_type: 'point', geometry: { coordinates: [-43.2, -22.9] }, properties: { name: 'B-point' } },
      timestamp: Date.now(),
      clientId: 'B-client',
    };
    b.send({ type: 'operation', op: opB });

    const ackB = await b.waitForType('ack');
    assert.equal(ackB.opId, opB.id);
    assert.ok(ackB.serverVersion > ackA.serverVersion); // version advanced past A's op

    const aGotOpB = await a.waitForType('operation');
    assert.equal(aGotOpB.userId, B.id);
    assert.equal(aGotOpB.op.entityId, featB);
    assert.equal(b.getMessagesOfType('operation').length, 0); // B never echoes to itself

    // Both writes really landed in the features table for this map…
    const { rows: featRows } = await db.query(
      'SELECT id FROM features WHERE map_id = $1 ORDER BY id', [mapId]
    );
    const featIds = featRows.map((r) => r.id).sort();
    assert.deepEqual(featIds, [featA, featB].sort());
    // …and both are recorded in the per-atlas operations log (CRDT history).
    const { rows: opRows } = await db.query(
      'SELECT entity_id FROM operations WHERE atlas_id = $1 AND entity_type = $2',
      [atlasId, 'feature']
    );
    const loggedIds = opRows.map((r) => r.entity_id).sort();
    assert.deepEqual(loggedIds, [featA, featB].sort());

    // ── STEP 4: presence round-trip (cursor + selection), both directions ──────
    // Proves the live-presence channel carries the right userId/mapId to peers and
    // is strictly excluding-sender (the originator never sees its own presence).
    a.clearMessages();
    b.clearMessages();
    a.send({ type: 'cursor', position: { lat: -22.85, lng: -43.15 }, mapId });
    const bCursor = await b.waitForType('cursor');
    assert.equal(bCursor.userId, A.id);
    assert.equal(bCursor.mapId, mapId);
    assert.deepEqual(bCursor.position, { lat: -22.85, lng: -43.15 });

    a.send({ type: 'selection', featureIds: [featA], mapId });
    const bSelection = await b.waitForType('selection');
    assert.equal(bSelection.userId, A.id);
    assert.deepEqual(bSelection.featureIds, [featA]);
    assert.equal(a.getMessagesOfType('cursor').length, 0);     // A saw none of its own presence
    assert.equal(a.getMessagesOfType('selection').length, 0);

    // …and the reverse direction: B's cursor reaches A.
    b.send({ type: 'cursor', position: { lat: -23.0, lng: -43.3 }, mapId });
    const aCursor = await a.waitForType('cursor');
    assert.equal(aCursor.userId, B.id);
    assert.deepEqual(aCursor.position, { lat: -23.0, lng: -43.3 });

    // ── STEP 5: B drops abnormally (1006) → A sees user_away; B reconnects with
    // the SAME clientId within grace → A sees user_back (NOT user_left). ────────
    a.clearMessages();
    b.ws.terminate(); // abnormal close (1006) → away, NOT removed yet
    const away = await a.waitForType('user_away', 2000);
    assert.equal(away.userId, B.id);
    assert.equal(away.clientId, bClientId);
    assert.equal(a.getMessagesOfType('user_left').length, 0); // still inside grace

    // Reconnect promptly with the SAME clientId → cancels the away timer.
    const b2 = track(await createWsClient(server, atlasId, bTok, bClientId));
    await b2.waitForType('connected');
    const back = await a.waitForType('user_back', 2000);
    assert.equal(back.userId, B.id);
    assert.equal(back.clientId, bClientId);
    // Past the grace window, the resumed session must NOT have been removed.
    await wait(GRACE_MS + 300);
    assert.equal(a.getMessagesOfType('user_left').length, 0);

    // ── STEP 6: B issues sync_request(lastVersion 0) → snapshot has BOTH features
    // Proves both peers share one consistent authoritative state. ──────────────
    b2.clearMessages();
    b2.send({ type: 'sync_request', lastVersion: 0 });
    const sync = await b2.waitForType('sync_response');
    assert.equal(sync.isSnapshot, true);
    assert.ok(sync.currentVersion >= ackB.serverVersion); // at least as new as B's last write

    const snapMap = sync.snapshot.maps.find((m) => m.id === mapId);
    assert.ok(snapMap, 'snapshot includes the shared map');
    // Snapshot is the frozen GeoJSON-Feature shape (identical to IndexedDB): the
    // feature id lives under properties.id, not at the top level.
    const pointIds = snapMap.features.points.map((p) => p.properties.id).sort();
    assert.deepEqual(pointIds, [featA, featB].sort()); // both A's and B's features present
  });

  it('clean close removes the peer immediately (user_left, no grace)', async () => {
    // Sanity counterpart to STEP 5: a clean 1000 close is intentional, so the peer
    // is removed at once — distinguishing it from the abnormal-drop away path.
    const { atlasId } = await freshAtlas();
    const a = track(await createWsClient(server, atlasId, aTok));
    const b = track(await createWsClient(server, atlasId, bTok));
    await a.waitForType('connected');
    await b.waitForType('connected');
    a.clearMessages();

    b.ws.close(1000, 'bye');
    const left = await a.waitForType('user_left', GRACE_MS - 100); // arrives before grace would elapse
    assert.equal(left.userId, B.id);
    assert.equal(a.getMessagesOfType('user_away').length, 0); // never treated as away
  });
});

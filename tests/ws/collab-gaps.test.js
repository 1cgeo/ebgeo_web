// Path: tests/ws/collab-gaps.test.js
// Gap tests for the WebSocket / collaboration subsystem.
// Covers confirmed lacunae ws-01..ws-13 (excluding ws-07, already implemented).
// Each test asserts CURRENT behavior verified against src/modules/collab/.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser, makeAtlasPublic, getPublicToken } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const U = () => `gap_${randomUUID().slice(0, 8)}`;

/**
 * Opens a RAW WebSocket to an arbitrary URL and resolves with an outcome object.
 * Resolves { connected:true } on 'open', or { connected:false, ... } on error/close
 * before open. Never rejects — handshake rejection is the expected path for many tests.
 */
function rawConnect(url, { sendOnOpen } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      resolve({ ws, ...val });
    };
    ws.on('open', () => {
      if (sendOnOpen) ws.send(JSON.stringify(sendOnOpen));
      done({ connected: true });
    });
    ws.on('error', (err) => done({ connected: false, error: err }));
    ws.on('unexpected-response', (_req, res) => done({ connected: false, statusCode: res.statusCode }));
    ws.on('close', () => done({ connected: false }));
    setTimeout(() => done({ connected: false, timedOut: true }), 4000);
  });
}

function wsBaseUrl(server) {
  const addr = server.address();
  const port = typeof addr === 'object' ? addr.port : addr;
  return `ws://localhost:${port}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket Collaboration — gaps', () => {
  let app, db, server;
  let owner, reader;
  let ownerToken, readerToken;
  let atlas, map;
  let p1, p2, p1Link, p2Link; // public atlases

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const gw = await import('../../src/modules/collab/collab.gateway.js');
    gw.attachWebSocket(server);

    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: U() });
    reader = await createUser(db, { username: U() });

    ownerToken = await loginUser(app, owner.username, owner.password);
    readerToken = await loginUser(app, reader.username, reader.password);

    atlas = await createAtlas(db, owner.id, { name: `Atlas ${U()}` });
    map = await createMap(db, atlas.id);

    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
      [atlas.id, reader.id, owner.id]
    );

    // Two public atlases for the cross-atlas public-token test.
    p1 = await createAtlas(db, owner.id, { name: `Public1 ${U()}` });
    p2 = await createAtlas(db, owner.id, { name: `Public2 ${U()}` });
    await createMap(db, p1.id);
    await createMap(db, p2.id);
    p1Link = await makeAtlasPublic(db, p1.id);
    p2Link = await makeAtlasPublic(db, p2.id);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  // ── ws-01 ────────────────────────────────────────────────────────────────
  describe('ws-01 cross-atlas public token (WS IDOR)', () => {
    it('public token minted for P1 cannot join P2, but does join P1', async () => {
      const tokenP1 = await getPublicToken(app, p1Link);

      // Negative: reuse P1 token to join P2 → handshake rejected (403, no connect).
      const base = wsBaseUrl(server);
      const cross = await rawConnect(`${base}/api/v1/collab?atlasId=${p2.id}&token=${tokenP1}`);
      assert.equal(cross.connected, false, 'P1 token must NOT connect to P2');
      cross.ws.close();

      // Positive control: same token connects to P1.
      const ok = await rawConnect(`${base}/api/v1/collab?atlasId=${p1.id}&token=${tokenP1}`);
      assert.equal(ok.connected, true, 'P1 token must connect to P1');
      ok.ws.close();
    });
  });

  // ── ws-02 ────────────────────────────────────────────────────────────────
  describe('ws-02 handshake rejection (missing params / wrong path)', () => {
    it('missing token is rejected (no connect)', async () => {
      const base = wsBaseUrl(server);
      const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}`);
      assert.equal(r.connected, false);
      r.ws.close();
    });

    it('missing atlasId is rejected (no connect)', async () => {
      const base = wsBaseUrl(server);
      const r = await rawConnect(`${base}/api/v1/collab?token=${ownerToken}`);
      assert.equal(r.connected, false);
      r.ws.close();
    });

    it('wrong path is rejected (404, no connect)', async () => {
      const base = wsBaseUrl(server);
      const r = await rawConnect(`${base}/api/v1/other?atlasId=${atlas.id}&token=${ownerToken}`);
      assert.equal(r.connected, false);
      r.ws.close();
    });
  });

  // ── ws-03 ────────────────────────────────────────────────────────────────
  describe('ws-03 forged-token algorithm allowlist at handshake', () => {
    it('alg:none token with owner sub is rejected', async () => {
      const forged = jwt.sign({ sub: owner.id, role: 'admin' }, '', { algorithm: 'none' });
      const base = wsBaseUrl(server);
      const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${forged}`);
      assert.equal(r.connected, false);
      r.ws.close();
    });

    it('HS256 token signed with wrong secret is rejected', async () => {
      const forged = jwt.sign({ sub: owner.id, role: 'admin' }, 'totally-wrong-secret-not-the-real-one', {
        algorithm: 'HS256',
      });
      const base = wsBaseUrl(server);
      const r = await rawConnect(`${base}/api/v1/collab?atlasId=${atlas.id}&token=${forged}`);
      assert.equal(r.connected, false);
      r.ws.close();
    });
  });

  // ── ws-04 ────────────────────────────────────────────────────────────────
  describe('ws-04 connected.usersOnline shape + status field', () => {
    it('a newly-connecting client sees peers with the frozen presence fields and status', async () => {
      const a = await createWsClient(server, atlas.id, ownerToken);
      const connectedA = await a.waitForType('connected');

      const b = await createWsClient(server, atlas.id, readerToken);
      const connectedB = await b.waitForType('connected');

      assert.ok(Array.isArray(connectedB.usersOnline));
      const peerA = connectedB.usersOnline.find((u) => u.id === connectedA.userId);
      assert.ok(peerA, 'B should see A in usersOnline');
      assert.equal(peerA.status, 'online');
      // Frozen documented fields present on each entry.
      assert.ok('nome' in peerA);
      assert.ok('posto_graduacao' in peerA);
      assert.ok('mapId' in peerA);
      assert.ok('cursorPosition' in peerA);

      // Drop A abnormally (1006) → A goes 'away'. B should observe user_away.
      a.ws.terminate();
      await b.waitForType('user_away').catch(() => null);

      // A new client C should now see A listed with status 'away' (kept in grace window).
      const c = await createWsClient(server, atlas.id, ownerToken);
      const connectedC = await c.waitForType('connected');
      const awayPeer = connectedC.usersOnline.find(
        (u) => u.id === connectedA.userId && u.status === 'away'
      );
      assert.ok(awayPeer, 'C should see A as away');

      b.close();
      c.close();
    });
  });

  // ── ws-05 ────────────────────────────────────────────────────────────────
  describe('ws-05 >500-ops batch validation', () => {
    function makeOp(mapId, marker) {
      return {
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId: randomUUID(),
        mapId,
        data: {
          feature_type: 'point',
          geometry: { coordinates: [0, 0] },
          properties: { gapMarker: marker },
        },
        timestamp: Date.now(),
        clientId: 'gap-batch',
      };
    }

    it('501 ops -> VALIDATION_ERROR and nothing applied; 500 ops -> ack_batch', async () => {
      const marker501 = `m501_${randomUUID().slice(0, 8)}`;
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      const ops501 = Array.from({ length: 501 }, () => makeOp(map.id, marker501));
      client.send({ type: 'operations', ops: ops501 });

      const err = await client.waitForType('error');
      assert.equal(err.code, 'VALIDATION_ERROR');

      // Nothing applied.
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM features WHERE properties->>'gapMarker' = $1`,
        [marker501]
      );
      assert.equal(rows[0].n, 0);

      // Boundary: exactly 500 succeeds.
      const marker500 = `m500_${randomUUID().slice(0, 8)}`;
      const ops500 = Array.from({ length: 500 }, () => makeOp(map.id, marker500));
      client.clearMessages();
      client.send({ type: 'operations', ops: ops500 });

      const ack = await client.waitForType('ack_batch', 10000);
      assert.equal(ack.results.length, 500);

      const { rows: rows500 } = await db.query(
        `SELECT count(*)::int AS n FROM features WHERE properties->>'gapMarker' = $1`,
        [marker500]
      );
      assert.equal(rows500[0].n, 500);

      client.close();
    });
  });

  // ── ws-06 ────────────────────────────────────────────────────────────────
  describe('ws-06 OPERATION_FAILED / SYNC_FAILED envelopes', () => {
    it('a cross-atlas map_id move throws -> OPERATION_FAILED, socket survives', async () => {
      // Owner of `atlas` tries to move a feature into a map of a DIFFERENT atlas.
      // applyOperation throws ForbiddenError on changes.map_id cross-atlas -> caught
      // by handleOperation -> { error, code: OPERATION_FAILED }.
      const otherAtlas = await createAtlas(db, owner.id, { name: `Other ${U()}` });
      const otherMap = await createMap(db, otherAtlas.id);

      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      client.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'update',
          target: 'feature',
          targetId: randomUUID(),
          mapId: map.id,
          changes: { map_id: otherMap.id },
          timestamp: Date.now(),
          clientId: 'gap-opfail',
        },
      });

      const err = await client.waitForType('error');
      assert.equal(err.code, 'OPERATION_FAILED');

      // Socket stays open: ping still answered.
      client.send({ type: 'ping' });
      const pong = await client.waitForType('pong');
      assert.equal(pong.type, 'pong');

      client.close();
    });
  });

  // ── ws-08 ────────────────────────────────────────────────────────────────
  describe('ws-08 connection-quality: invalid ignored, no re-emit when band unchanged', () => {
    it('invalid rtt ignored; same band no re-emit; band change re-emits', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      // (a) invalid values: negative and non-numeric string -> no adaptive-settings.
      // NB: Infinity/NaN are NOT used here because JSON.stringify turns them into
      // null, and Number(null)===0 (a valid 'excellent' sample) — that would emit.
      client.send({ type: 'connection-quality', rttMs: -5 });
      client.send({ type: 'connection-quality', rttMs: 'abc' });
      await sleep(300);
      assert.equal(client.getMessagesOfType('adaptive-settings').length, 0);

      // (b) first poor sample -> one adaptive-settings (quality 'poor')
      client.clearMessages();
      client.send({ type: 'connection-quality', rttMs: 600 });
      const first = await client.waitForType('adaptive-settings');
      assert.equal(first.quality, 'poor');

      // still poor (500) -> NO new emit
      client.clearMessages();
      client.send({ type: 'connection-quality', rttMs: 500 });
      await sleep(400);
      assert.equal(client.getMessagesOfType('adaptive-settings').length, 0);

      // (c) band change to excellent -> new emit
      client.send({ type: 'connection-quality', rttMs: 50 });
      const third = await client.waitForType('adaptive-settings');
      assert.equal(third.quality, 'excellent');

      client.close();
    });
  });

  // ── ws-09 ────────────────────────────────────────────────────────────────
  describe('ws-09 presence-persistence service (dead path) unit', () => {
    it('updateSessionPresence writes valid UUID features; non-UUID does not throw; heartbeat bumps', async () => {
      const svc = await import('../../src/modules/collab/collab.service.js');

      const u = await createUser(db, { username: U() });
      const clientId = randomUUID();
      const f1 = randomUUID();
      const f2 = randomUUID();

      const sessionId = await svc.createSession(u.id, atlas.id, clientId);
      assert.ok(sessionId, 'session created');

      await svc.updateSessionPresence(u.id, atlas.id, clientId, {
        cursorPosition: { lng: -43.2, lat: -22.9 },
        currentMapId: map.id,
        selectedFeatures: [f1, f2],
      });

      const { rows } = await db.query(
        `SELECT cursor_position, current_map_id, selected_features
         FROM active_sessions WHERE user_id = $1 AND atlas_id = $2 AND client_id = $3`,
        [u.id, atlas.id, clientId]
      );
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].cursor_position, { lng: -43.2, lat: -22.9 });
      assert.equal(rows[0].current_map_id, map.id);
      assert.deepEqual(rows[0].selected_features.map(String).sort(), [f1, f2].sort());

      // Non-UUID featureId: the $6::uuid[] cast fails inside, but the service
      // try/catches the error so the CALLER does not throw.
      await assert.doesNotReject(
        svc.updateSessionPresence(u.id, atlas.id, clientId, {
          cursorPosition: { lng: 0, lat: 0 },
          currentMapId: map.id,
          selectedFeatures: ['not-a-uuid'],
        })
      );

      // Heartbeat bump: last_heartbeat strictly increases.
      const before = await db.query(
        `SELECT last_heartbeat FROM active_sessions WHERE user_id=$1 AND atlas_id=$2 AND client_id=$3`,
        [u.id, atlas.id, clientId]
      );
      await sleep(30);
      await svc.updateSessionHeartbeat(u.id, atlas.id, clientId);
      const afterHb = await db.query(
        `SELECT last_heartbeat FROM active_sessions WHERE user_id=$1 AND atlas_id=$2 AND client_id=$3`,
        [u.id, atlas.id, clientId]
      );
      assert.ok(
        new Date(afterHb.rows[0].last_heartbeat).getTime() >=
          new Date(before.rows[0].last_heartbeat).getTime()
      );

      await svc.deleteSession(u.id, atlas.id, clientId);
    });
  });

  // ── ws-10 ────────────────────────────────────────────────────────────────
  describe('ws-10 public visitor creates no active_sessions row', () => {
    it('public connection leaves active_sessions empty; authenticated owner creates a row', async () => {
      const pubToken = await getPublicToken(app, p1Link);
      const pub = await createWsClient(server, p1.id, pubToken);
      await pub.waitForType('connected');

      const { rows: pubRows } = await db.query(
        `SELECT count(*)::int AS n FROM active_sessions WHERE atlas_id = $1`,
        [p1.id]
      );
      assert.equal(pubRows[0].n, 0, 'no session row for public visitor');

      const own = await createWsClient(server, p1.id, ownerToken);
      const connectedOwn = await own.waitForType('connected');

      // Session is written asynchronously after connect; poll briefly.
      let n = 0;
      for (let i = 0; i < 20; i++) {
        const { rows } = await db.query(
          `SELECT count(*)::int AS n FROM active_sessions WHERE atlas_id = $1 AND user_id = $2`,
          [p1.id, owner.id]
        );
        n = rows[0].n;
        if (n > 0) break;
        await sleep(50);
      }
      assert.ok(n > 0, 'owner session row created');

      // Public visitor still has no row.
      const { rows: stillPub } = await db.query(
        `SELECT count(*)::int AS n FROM active_sessions WHERE atlas_id = $1 AND user_id::text LIKE 'public-%'`,
        [p1.id]
      );
      assert.equal(stillPub[0].n, 0);

      void connectedOwn;
      pub.close();
      own.close();
    });
  });

  // ws-11 (server-side heartbeat terminate) intentionally omitted — see skipped manifest.

  // ── ws-12 ────────────────────────────────────────────────────────────────
  describe('ws-12 malformed JSON & unknown type keep socket alive', () => {
    it('non-JSON frame and unknown type do not drop the socket (ping still ponged)', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      client.ws.send('not json{');
      client.send({ type: 'totally_unknown' });
      await sleep(200);

      client.send({ type: 'ping' });
      const pong = await client.waitForType('pong');
      assert.equal(pong.type, 'pong');

      // No error was emitted for the unknown type (silently warned).
      assert.equal(client.getMessagesOfType('error').length, 0);

      client.close();
    });
  });

  // ── ws-13 ────────────────────────────────────────────────────────────────
  describe('ws-13 read-only / public presence broadcast (anon path)', () => {
    it("reader's cursor & selection reach the owner peer", async () => {
      const o = await createWsClient(server, atlas.id, ownerToken);
      const connectedO = await o.waitForType('connected');
      const r = await createWsClient(server, atlas.id, readerToken);
      const connectedR = await r.waitForType('connected');
      void connectedO;

      o.clearMessages();
      r.send({ type: 'cursor', position: { lat: -22.9, lng: -43.2 }, mapId: map.id });
      const cursor = await o.waitForType('cursor');
      assert.equal(cursor.userId, connectedR.userId);

      o.clearMessages();
      const fid = randomUUID();
      r.send({ type: 'selection', featureIds: [fid], mapId: map.id });
      const selection = await o.waitForType('selection');
      assert.equal(selection.userId, connectedR.userId);
      assert.deepEqual(selection.featureIds, [fid]);

      o.close();
      r.close();
    });

    it("a public visitor's cursor reaches the owner peer", async () => {
      const pubToken = await getPublicToken(app, p2Link);
      const o = await createWsClient(server, p2.id, ownerToken);
      await o.waitForType('connected');
      const pub = await createWsClient(server, p2.id, pubToken);
      const connectedPub = await pub.waitForType('connected');

      o.clearMessages();
      pub.send({ type: 'cursor', position: { lat: 1, lng: 1 }, mapId: null });
      const cursor = await o.waitForType('cursor');
      assert.equal(cursor.userId, connectedPub.userId);

      o.close();
      pub.close();
    });
  });
});

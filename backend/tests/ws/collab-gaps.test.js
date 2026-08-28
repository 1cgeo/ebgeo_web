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
  // B-be1: presence is in-memory by design — no DB write at all, per cursor or per
  // connection. The `updateSessionPresence`/`updateSessionHeartbeat` dead helpers were
  // removed in 2026-07-25, and the table they wrote to left the baseline in 2026-08-23
  // (it never had a reader). The property is asserted, without depending on any table,
  // by tests/ws/collab-presenca-sem-banco.test.js.

  // ── caso E + B-be2 ───────────────────────────────────────────────────────
  // Isolated atlas + users so no presence from earlier tests (e.g. an `away`
  // owner kept in the room during the grace window) bleeds into the snapshot.
  describe('temporal presence (caso E) + selectedFeatures in snapshot (B-be2)', () => {
    let tAtlas, tMap, tOwnerTok, tReaderTok, tOwner, tReader;

    before(async () => {
      tOwner = await createUser(db, { username: U() });
      tReader = await createUser(db, { username: U() });
      tOwnerTok = await loginUser(app, tOwner.username, tOwner.password);
      tReaderTok = await loginUser(app, tReader.username, tReader.password);
      tAtlas = await createAtlas(db, tOwner.id, { name: `Atlas ${U()}` });
      tMap = await createMap(db, tAtlas.id);
      await db.query(
        `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
        [tAtlas.id, tReader.id, tOwner.id]
      );
    });

    it('a temporal update is broadcast to peers and NOT echoed back to the sender', async () => {
      const o = await createWsClient(server, tAtlas.id, tOwnerTok);
      await o.waitForType('connected');
      const r = await createWsClient(server, tAtlas.id, tReaderTok);
      const connectedR = await r.waitForType('connected');

      o.clearMessages();
      r.clearMessages();

      const state = { mode: 'play', t: 1718900000000, speed: 2 };
      r.send({ type: 'temporal', state, mapId: tMap.id });

      const temporal = await o.waitForType('temporal');
      assert.equal(temporal.userId, connectedR.userId);
      assert.deepEqual(temporal.state, state);
      assert.equal(temporal.mapId, tMap.id);

      // Not echoed back to the sender.
      await sleep(200);
      assert.equal(r.getMessagesOfType('temporal').length, 0, 'sender must not receive its own temporal');

      o.close();
      r.close();
    });

    it('temporalState AND selectedFeatures appear in a late-joiner snapshot (usersOnline)', async () => {
      // A is the owner (editor): selection is editor-gated, so the publisher must be
      // a write-capable role for it to land in-memory and reach the snapshot. The
      // late-joiner B is the reader (a Visualizador still RECEIVES peers' selections).
      const a = await createWsClient(server, tAtlas.id, tOwnerTok);
      const connectedA = await a.waitForType('connected');

      // A publishes temporal state and a selection (in-memory on its ws).
      const state = { mode: 'pause', t: 1718900001234 };
      const fid = randomUUID();
      a.send({ type: 'temporal', state, mapId: tMap.id });
      a.send({ type: 'selection', featureIds: [fid], mapId: tMap.id });
      await sleep(150);

      // Late-joiner B gets A in its join snapshot WITH both fields populated.
      const b = await createWsClient(server, tAtlas.id, tReaderTok);
      const connectedB = await b.waitForType('connected');

      const peerA = connectedB.usersOnline.find((u) => u.id === connectedA.userId);
      assert.ok(peerA, 'B should see A in usersOnline');
      assert.ok('temporalState' in peerA, 'snapshot entry exposes temporalState');
      assert.ok('selectedFeatures' in peerA, 'snapshot entry exposes selectedFeatures');
      assert.deepEqual(peerA.temporalState, state);
      assert.deepEqual(peerA.selectedFeatures, [fid]);

      a.close();
      b.close();
    });
  });

  // ── ws-10 ────────────────────────────────────────────────────────────────
  // Reescrito DUAS vezes, e as duas por decisão registrada. O caso original afirmava a
  // assimetria "visitante público NÃO cria linha em active_sessions, dono CRIA", que
  // existia por causa da FK para `users` (o `sub` do visitante é `public-<uuid>`, sem
  // linha lá). Em 2026-07-25 os dois escritores saíram e o caso passou a afirmar a
  // simetria: nem um nem outro escrevia. Em 2026-08-23 a própria tabela saiu da baseline,
  // porque nunca teve leitor, e o que sobra é a propriedade que importava desde sempre.
  //
  // O QUE ELE MEDE AGORA: as duas conexões funcionam, e o caminho do visitante público é
  // igual ao do autenticado no que diz respeito ao banco. A afirmação forte ("um ciclo de
  // socket não emite escrita nenhuma") tem arquivo próprio, com contador de pool e caso de
  // discriminação: tests/ws/collab-presenca-sem-banco.test.js.
  describe('ws-10 o visitante público conecta como leitor, e o dono como owner', () => {
    it('as duas conexões abrem, e cada uma com a permissão que lhe cabe', async () => {
      const pubToken = await getPublicToken(app, p1Link);
      const pub = await createWsClient(server, p1.id, pubToken);
      const connectedPub = await pub.waitForType('connected');
      assert.equal(connectedPub.permission, 'read', 'o visitante entra como leitor');

      const own = await createWsClient(server, p1.id, ownerToken);
      const connectedOwn = await own.waitForType('connected');
      assert.equal(connectedOwn.permission, 'owner', 'e o dono como owner');

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
    it("reader's cursor reaches the owner peer, but its selection is editor-gated", async () => {
      const o = await createWsClient(server, atlas.id, ownerToken);
      const connectedO = await o.waitForType('connected');
      const r = await createWsClient(server, atlas.id, readerToken);
      const connectedR = await r.waitForType('connected');
      void connectedO;

      // Cursor presence stays ungated — a reader's cursor still reaches peers.
      o.clearMessages();
      r.send({ type: 'cursor', position: { lat: -22.9, lng: -43.2 }, mapId: map.id });
      const cursor = await o.waitForCursor();
      assert.equal(cursor.userId, connectedR.userId);

      // Selection IS gated: a Visualizador (read) only sees peers' selections, it
      // never broadcasts its own — the owner must receive nothing.
      o.clearMessages();
      const fid = randomUUID();
      r.send({ type: 'selection', featureIds: [fid], mapId: map.id });
      await sleep(300);
      assert.equal(
        o.getMessagesOfType('selection').length,
        0,
        'a read-only user must not broadcast selection to peers'
      );

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
      const cursor = await o.waitForCursor();
      assert.equal(cursor.userId, connectedPub.userId);

      o.close();
      pub.close();
    });
  });
});

// Path: tests/ws/collab-presence-payload-bound.repro.test.js
//
// Achado #9 — the presence payload (cursor / temporal / selection) was stored RAW on the
// `ws` object (collab.handlers.js: `ws.temporalState = data.state`, `ws.cursorPosition =
// data.position`, `ws.selectedFeatures = data.featureIds`) with no schema and no size
// ceiling, and `getRoomUsers` re-serializes it into the `connected` frame of EVERY new
// join. A single socket could therefore retain up to the frame ceiling (10 MB,
// COLLAB_MAX_PAYLOAD_BYTES) per slot and make every subsequent join cost that much
// JSON.stringify. `cursor` and `temporal` have NO permission gate, so a read-only public
// visitor reaches the vector.
//
// These tests pin (a) that no client can inflate the join snapshot, and (b) the
// radius of effect: every payload the REAL frontend emits
// (frontend/src/js/presence/presence-bridge.js) still round-trips intact, and
// read/comment still never emit a selection.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser,
  createAtlas,
  createMap,
  createShare,
  loginUser,
  makeAtlasPublic,
  getPublicToken,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

/**
 * Ceiling for the whole `connected` frame in the abuse tests. Measured from the real
 * client (frontend/src/js/presence/presence-bridge.js): a cursor frame is ~128 B, a
 * temporal frame ~141 B, and a selection frame ~115 B per selected feature. A snapshot
 * holding a handful of peers is therefore a few KB; 64 KB is two orders of magnitude of
 * headroom, and ~150x below the multi-MB blobs the abuse frames carry.
 */
const SNAPSHOT_CEILING_BYTES = 64 * 1024;

/** Size of the abusive blob: comfortably under the 10 MB frame ceiling, fast to build. */
const HUGE = 'A'.repeat(2 * 1024 * 1024);

describe('WebSocket collab — presence payload is validated and bounded (achado #9)', () => {
  let app, db, server;
  let owner, ownerToken, viewer, viewerToken, commenter, commenterToken, editor, editorToken;
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `pb_own_${randomUUID().slice(0, 6)}` });
    viewer = await createUser(db, { username: `pb_view_${randomUUID().slice(0, 6)}` });
    commenter = await createUser(db, { username: `pb_cmt_${randomUUID().slice(0, 6)}` });
    editor = await createUser(db, { username: `pb_edit_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    viewerToken = await loginUser(app, viewer.username, viewer.password);
    commenterToken = await loginUser(app, commenter.username, commenter.password);
    editorToken = await loginUser(app, editor.username, editor.password);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  beforeEach(() => {
    openClients = [];
  });

  afterEach(async () => {
    // Clean close (code 1000) so the socket leaves the room immediately instead of
    // lingering in the `away` grace window and polluting a later snapshot.
    for (const c of openClients) {
      try {
        if (c.ws && c.ws.readyState <= 1) c.close();
      } catch {
        /* already gone */
      }
    }
    openClients = [];
  });

  /** Creates a fresh atlas + map so each test gets its own (empty) collab room. */
  async function freshAtlas() {
    const atlas = await createAtlas(db, owner.id, { name: `Presence Bound ${randomUUID().slice(0, 8)}` });
    const map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, viewer.id, 'read', owner.id);
    await createShare(db, atlas.id, commenter.id, 'comment', owner.id);
    await createShare(db, atlas.id, editor.id, 'write', owner.id);
    return { atlas, map };
  }

  async function connect(atlasId, token, clientId) {
    const client = await createWsClient(server, atlasId, token, clientId);
    openClients.push(client);
    await client.waitForType('connected');
    return client;
  }

  /**
   * Round-trips a ping so the previously sent presence frame is guaranteed processed
   * (per-socket messages are handled in series by the gateway's message chain).
   */
  async function settle(client) {
    client.send({ type: 'ping' });
    await client.waitForType('pong');
  }

  async function snapshotOf(atlasId, token) {
    const joiner = await createWsClient(server, atlasId, token, `joiner-${randomUUID().slice(0, 8)}`);
    openClients.push(joiner);
    const connected = await joiner.waitForType('connected');
    return { connected, bytes: Buffer.byteLength(JSON.stringify(connected)) };
  }

  // ---------------------------------------------------------------- abuse vectors

  it('a public read-only visitor cannot inflate the join snapshot via `temporal`', async () => {
    const { atlas } = await freshAtlas();
    const publicLink = await makeAtlasPublic(db, atlas.id);
    const publicToken = await getPublicToken(app, publicLink);

    const visitor = await connect(atlas.id, publicToken, `visitor-${randomUUID().slice(0, 8)}`);
    visitor.send({ type: 'temporal', state: HUGE, mapId: HUGE });
    await settle(visitor);

    const { bytes } = await snapshotOf(atlas.id, ownerToken);
    assert.ok(
      bytes < SNAPSHOT_CEILING_BYTES,
      `join snapshot grew to ${bytes} bytes — a visitor's temporal blob is retained and re-serialized`
    );
  });

  it('a read-only viewer cannot inflate the join snapshot via `cursor`', async () => {
    const { atlas } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v-${randomUUID().slice(0, 8)}`);
    v.send({ type: 'cursor', position: { lng: -43.2, lat: -22.9, junk: HUGE }, mapId: HUGE });
    await settle(v);

    const { bytes } = await snapshotOf(atlas.id, ownerToken);
    assert.ok(
      bytes < SNAPSHOT_CEILING_BYTES,
      `join snapshot grew to ${bytes} bytes — the raw cursor payload is retained`
    );
  });

  it('an editor cannot retain an unbounded selection', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e-${randomUUID().slice(0, 8)}`);
    const featureIds = Array.from({ length: 60000 }, () => randomUUID());
    e.send({
      type: 'selection',
      surface: '2d',
      featureIds,
      featureMeta: featureIds.map((id) => ({ id, type: 'point' })),
      mapId: map.name,
    });
    await settle(e);

    const { bytes } = await snapshotOf(atlas.id, ownerToken);
    assert.ok(
      bytes < SNAPSHOT_CEILING_BYTES,
      `join snapshot grew to ${bytes} bytes — the raw selection array is retained`
    );
  });

  it('answers an over-sized selection with VALIDATION_ERROR (and keeps the socket open)', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e2-${randomUUID().slice(0, 8)}`);
    e.send({
      type: 'selection',
      surface: '2d',
      featureIds: Array.from({ length: 60000 }, () => randomUUID()),
      mapId: map.name,
    });

    const err = await e.waitForType('error');
    assert.equal(err.code, 'VALIDATION_ERROR');
    await settle(e); // socket still usable
  });

  // ------------------------------------------------------- radius of effect (regression)

  it('keeps a real 2D selection frame intact: peer relay + join snapshot', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e3-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p3-${randomUUID().slice(0, 8)}`);

    const ids = [randomUUID(), randomUUID()];
    e.send({
      type: 'selection',
      surface: '2d',
      featureIds: ids,
      featureMeta: [
        { id: ids[0], type: 'military_symbol' },
        { id: ids[1], type: 'coordination_measure' },
      ],
      mapId: map.name,
    });

    const relayed = await peer.waitForType('selection');
    assert.deepEqual(relayed.featureIds, ids);
    assert.equal(relayed.surface, '2d');
    assert.equal(relayed.mapId, map.name);
    assert.deepEqual(relayed.featureMeta, [
      { id: ids[0], type: 'military_symbol' },
      { id: ids[1], type: 'coordination_measure' },
    ]);

    const { connected } = await snapshotOf(atlas.id, viewerToken);
    const entry = connected.usersOnline.find((u) => u.id === editor.id);
    assert.ok(entry, 'editor missing from the join snapshot');
    assert.deepEqual(entry.selectedFeatures, ids);
    assert.equal(entry.selectionContext.surface, '2d');
    assert.equal(entry.selectionContext.mapId, map.name);
    assert.deepEqual(entry.selectionContext.featureIds, ids);
    assert.equal(entry.selectionContext.featureMeta.length, 2);
  });

  it('keeps 3D and 360 scoped selections intact (tilesetId / photoName)', async () => {
    const { atlas, map } = await freshAtlas();

    const e = await connect(atlas.id, editorToken, `e4-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p4-${randomUUID().slice(0, 8)}`);

    const markerId = randomUUID();
    e.send({ type: 'selection', surface: '3d', featureIds: [markerId], mapId: map.name, tilesetId: '3d-PCL' });
    const r3d = await peer.waitForType('selection');
    assert.equal(r3d.surface, '3d');
    assert.equal(r3d.tilesetId, '3d-PCL');
    assert.deepEqual(r3d.featureIds, [markerId]);

    peer.clearMessages();
    const poiId = randomUUID();
    e.send({
      type: 'selection',
      surface: '360',
      featureIds: [poiId],
      mapId: map.name,
      photoName: 'IMG_20240712_143201.jpg',
    });
    const r360 = await peer.waitForType('selection');
    assert.equal(r360.surface, '360');
    assert.equal(r360.photoName, 'IMG_20240712_143201.jpg');
    assert.deepEqual(r360.featureIds, [poiId]);

    // Deselect (empty list) must still travel — it is what clears the peer's highlight.
    peer.clearMessages();
    e.send({ type: 'selection', surface: '3d', featureIds: [], mapId: map.name, tilesetId: '3d-PCL' });
    const cleared = await peer.waitForType('selection');
    assert.deepEqual(cleared.featureIds, []);
  });

  it('keeps real cursor and temporal frames intact (relay + snapshot)', async () => {
    const { atlas, map } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v5-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p5-${randomUUID().slice(0, 8)}`);

    // Exactly what presence-bridge.js emits: a float lng/lat pair + the map NAME.
    v.send({ type: 'cursor', position: { lng: -43.20991234567891, lat: -22.90112345678912 }, mapId: map.name });
    const cur = await peer.waitForCursor();
    assert.deepEqual(cur.position, { lng: -43.20991234567891, lat: -22.90112345678912 });
    assert.equal(cur.mapId, map.name);

    // A map switch piggybacks on a POSITIONLESS cursor frame (broadcastCurrentMap).
    peer.clearMessages();
    v.send({ type: 'cursor', position: null, mapId: map.name });
    const noPos = await peer.waitForCursor();
    assert.equal(noPos.position, null);
    assert.equal(noPos.mapId, map.name);

    // Temporal presence: { cursor, label, playing } (broadcastTemporal).
    peer.clearMessages();
    const tState = { cursor: 1763647200000, label: 'D+3', playing: true };
    v.send({ type: 'temporal', state: tState, mapId: map.name });
    const tmp = await peer.waitForType('temporal');
    assert.deepEqual(tmp.state, tState);
    assert.equal(tmp.mapId, map.name);

    // Re-send a positioned cursor (the positionless map-switch frame above legitimately
    // clears the retained position) and check what a late joiner actually receives.
    v.send({ type: 'cursor', position: { lng: -43.20991234567891, lat: -22.90112345678912 }, mapId: map.name });
    await settle(v);

    const { connected } = await snapshotOf(atlas.id, ownerToken);
    const entry = connected.usersOnline.find((u) => u.id === viewer.id);
    assert.ok(entry, 'viewer missing from the join snapshot');
    assert.deepEqual(entry.cursorPosition, { lng: -43.20991234567891, lat: -22.90112345678912 });
    assert.deepEqual(entry.temporalState, tState);
    assert.equal(entry.mapId, map.name);
  });

  it('a longitude past the antimeridian is still accepted (MapLibre does not clamp)', async () => {
    const { atlas, map } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v6-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p6-${randomUUID().slice(0, 8)}`);

    v.send({ type: 'cursor', position: { lng: 197.5, lat: -22.9 }, mapId: map.name });
    const cur = await peer.waitForCursor();
    assert.deepEqual(cur.position, { lng: 197.5, lat: -22.9 });
  });

  it('read and comment still never emit a selection', async () => {
    const { atlas, map } = await freshAtlas();

    const v = await connect(atlas.id, viewerToken, `v7-${randomUUID().slice(0, 8)}`);
    const c = await connect(atlas.id, commenterToken, `c7-${randomUUID().slice(0, 8)}`);
    const peer = await connect(atlas.id, ownerToken, `p7-${randomUUID().slice(0, 8)}`);

    v.send({ type: 'selection', surface: '2d', featureIds: [randomUUID()], mapId: map.name });
    c.send({ type: 'selection', surface: '2d', featureIds: [randomUUID()], mapId: map.name });
    await settle(v);
    await settle(c);
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(peer.getMessagesOfType('selection').length, 0);

    const { connected } = await snapshotOf(atlas.id, ownerToken);
    for (const id of [viewer.id, commenter.id]) {
      const entry = connected.usersOnline.find((u) => u.id === id);
      // Both sockets are still open, so both users MUST be in the roster: a
      // missing entry used to make the two assertions below silently vanish.
      assert.ok(entry, `user ${id} must appear in the presence roster`);
      assert.deepEqual(entry.selectedFeatures, [], 'read/comment must not retain a selection');
      // Era `undefined` — a AUSÊNCIA da chave no fio — e isso congelava um defeito de
      // shape, não a regra que este teste existe para provar: `ws.selectionContext`
      // nunca era inicializado, então `JSON.stringify` removia a chave e o frame
      // `connected` mudava de FORMA conforme o par já ter emitido uma seleção ou não
      // (os vizinhos `selectedFeatures` e `temporalState` já tinham default). Desde
      // 2026-07-25 o campo é inicializado a `null` em onConnection; a regra afirmada
      // aqui — read/comment não retêm seleção — é a mesma, agora com shape estável.
      // Shape completo do roster em tests/ws/collab-users-online-shape.test.js.
      assert.equal(entry.selectionContext, null);
    }
  });
});

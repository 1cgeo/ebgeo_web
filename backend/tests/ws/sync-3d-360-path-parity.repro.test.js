// Path: tests/ws/sync-3d-360-path-parity.repro.test.js
// Regression (achados 20 + 25): the SAME 3D/360 operation reached a peer with two
// different payload shapes depending on how it arrived.
//
//  - LIVE (broadcast): the server echoes the client's op verbatim, so the peer gets the
//    FLAT camelCase entity the frontend actually emits ({ id, tilesetId, position, sync, … }).
//  - REPLAY (sync_request after a reconnect / incremental REST pull): `normalizeOperation`
//    rewrote `data` into the backend envelope { data_type, tileset_id, data:{…} } BEFORE the
//    INSERT, so that envelope is what `operations.data` holds and what `toFrontendOperation`
//    echoed back, un-reversed.
//
// The peer only speaks the flat shape (frontend/src/js/store/sync/remote-operation-handler.js):
//   applyRemoteCameraOp gates on `data?.tilesetId`, applyRemoteOrientation360Op on
//   `data?.photoName` (nested → both undefined → the op is silently DROPPED), and
//   applyRemoteCesium3dEntityOp/applyRemoteMarker360Op push `data` straight into the
//   markers/measurements/viewsheds array and match by `e.id === entityId` (nested → an item
//   with no `id`, so no later update/delete ever matches it).
//
// The VALUE matters as much as the shape: `reshape3d360Payload` also strips `id` and `sync`
// (ENTITY_3D360_META), and EVERY frontend read path for these entities filters by
// `isActive(item.sync)` — `isActive(undefined)` is falsy (frontend sync-metadata.js:150), so an
// item delivered without `sync` is invisible to the 3D/360 viewers even once it is stored.
// That is why this test compares the two paths with deepEqual instead of just probing keys.
//
// Negative control: restore the un-reversed `data: op.data` in toFrontendOperation (or drop the
// flat log payload in normalizeOperation) and every subtype below fails on the deepEqual.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

/** The sync metadata the real frontend attaches to every 3D/360 entity (createSyncMetadata). */
const syncMeta = () => ({
  createdAt: 1718900000000,
  updatedAt: 1718900000000,
  version: 1,
  ownerId: null,
  dirty: true,
  deleted: false,
  deletedAt: null,
});

// The six mapped sub-types, in the FLAT camelCase shape the real frontend store emits
// (cesium3d.operations.js / streetview360.operations.js).
const SUBTYPES = [
  {
    label: 'marker3d',
    keyField: 'tilesetId',
    payload: (id) => ({
      id, tilesetId: 'PCL',
      position: { longitude: -43.2, latitude: -22.9, height: 150 },
      properties: { nome: 'Ponto #1', descricao: '' },
      style: { color: '#ff0000', size: 12 },
      sync: syncMeta(),
    }),
  },
  {
    label: 'measurement3d',
    keyField: 'tilesetId',
    payload: (id) => ({
      id, tilesetId: 'PCL',
      type: 'distance',
      positions: [{ longitude: -43.2, latitude: -22.9 }, { longitude: -43.1, latitude: -22.8 }],
      sync: syncMeta(),
    }),
  },
  {
    label: 'viewshed3d',
    keyField: 'tilesetId',
    payload: (id) => ({
      id, tilesetId: 'PCL',
      position: { longitude: -43.2, latitude: -22.9, height: 80 },
      radius: 1200,
      sync: syncMeta(),
    }),
  },
  {
    label: 'cameraPosition3d',
    keyField: 'tilesetId',
    payload: (id) => ({
      id, tilesetId: 'PCL',
      position: { longitude: -43.2, latitude: -22.9, height: 5000 },
      orientation: { heading: 45, pitch: -30, roll: 0 },
      savedAt: 1718900000000,
      sync: syncMeta(),
    }),
  },
  {
    label: 'orientation360',
    keyField: 'photoName',
    payload: (id) => ({
      id, photoName: 'foto-001.jpg',
      heading: 45, pitch: 0, zoom: 1,
      savedAt: 1718900000000,
      sync: syncMeta(),
    }),
  },
  {
    label: 'marker360',
    keyField: 'photoName',
    payload: (id) => ({
      id, photoName: 'foto-001.jpg',
      position: { heading: 45, pitch: 0, distance: 5 },
      properties: { nome: 'Marcador 360' },
      sync: syncMeta(),
    }),
  },
];

describe('3D/360 op: live broadcast and replay must deliver the SAME payload (repro)', () => {
  let app, db, server;
  let owner, ownerToken, peer, peerToken, atlas, map;
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `par_own_${randomUUID().slice(0, 6)}` });
    peer = await createUser(db, { username: `par_peer_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    peerToken = await loginUser(app, peer.username, peer.password);

    atlas = await createAtlas(db, owner.id, { name: '3D/360 Path Parity Atlas' });
    map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, peer.id, 'write', owner.id);
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

  /** Sends one op from `client` and resolves with its ack. */
  async function sendOp(client, op) {
    client.clearMessages();
    client.send({ type: 'operation', op });
    return client.waitForType('ack');
  }

  /**
   * Waits for the peer's broadcast of ONE specific entity. Matching by id (instead of
   * "the next `operation` message") keeps the assertions honest: a broadcast still in
   * flight from an earlier send cannot be mistaken for the op under test.
   */
  async function waitForPeerOp(client, entityId, opType = null, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const msg = client
        .getMessagesOfType('operation')
        .find((m) => (m.op?.entityId ?? m.op?.targetId) === entityId
          && (!opType || (m.op?.operationType ?? m.op?.type) === opType));
      if (msg) return msg;
      if (Date.now() > deadline) throw new Error(`Timeout waiting for the peer broadcast of ${entityId}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** A throwaway op, only to move `currentVersion` past 0 so the next pull is INCREMENTAL. */
  const fillerOp = () => {
    const id = randomUUID();
    return {
      id: randomUUID(), entityType: 'feature', operationType: 'create', entityId: id, mapId: map.id,
      data: {
        type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id, source: 'point', nome: 'filler' },
      },
      timestamp: Date.now(), clientId: 'a-parity',
    };
  };

  for (const st of SUBTYPES) {
    it(`${st.label}: the replayed op is identical to the live broadcast`, async () => {
      const a = await connect(ownerToken, 'a-parity');
      const b = await connect(peerToken, 'b-parity');

      // Baseline version, so B's sync_request takes the INCREMENTAL branch (not the snapshot,
      // which has its own — correct — transformers and hides this bug).
      const fillerAck = await sendOp(a, fillerOp());
      const baseVersion = fillerAck.serverVersion;
      assert.ok(baseVersion > 0, 'baseline version must be > 0 so the replay is incremental');

      const entityId = randomUUID();
      const data = st.payload(entityId);
      const op = {
        id: randomUUID(), entityType: st.label, operationType: 'create', entityId, mapId: map.id,
        data, timestamp: Date.now(), lamportTimestamp: 7, clientId: 'a-parity',
      };

      await sendOp(a, op);

      // Path 1 — LIVE: what a connected peer gets right now.
      const live = await waitForPeerOp(b, entityId);
      assert.equal(live.op.entityType, st.label);

      // Path 2 — REPLAY: what the same peer gets after a reconnect (ws-client.js requestSync).
      b.clearMessages();
      b.send({ type: 'sync_request', lastVersion: baseVersion });
      const replay = await b.waitForType('sync_response');
      assert.equal(replay.isSnapshot, false, 'the replay must be incremental, not a snapshot');

      const replayed = (replay.ops || []).find((o) => o.entityId === entityId);
      assert.ok(replayed, 'the op must come back on the incremental replay');

      // The frontend routes by entityType: `cesium3d`/`streetview360` hit the `default:`
      // branch of applyRemoteOperation (a console.warn and nothing else).
      assert.equal(replayed.entityType, st.label, 'the replayed op must carry the frontend entity type');

      // THE contract: one operation, one payload, whichever path delivered it.
      assert.deepEqual(replayed.data, live.op.data, 'replay and broadcast must deliver the same data');

      // Spelled out, because each of these is a distinct way the peer breaks:
      assert.equal(replayed.data.id, entityId, 'without a top-level id no later update/delete matches');
      assert.equal(replayed.data[st.keyField], data[st.keyField], `the ${st.keyField} gate must pass`);
      assert.deepEqual(replayed.data.sync, data.sync, 'without sync, isActive() filters the entity out of every read');
    });
  }

  it('an UPDATE replays flat too (the client sends the payload in `data`, never in `changes`)', async () => {
    const a = await connect(ownerToken, 'a-parity');
    const b = await connect(peerToken, 'b-parity');

    const entityId = randomUUID();
    await sendOp(a, {
      id: randomUUID(), entityType: 'marker3d', operationType: 'create', entityId, mapId: map.id,
      data: SUBTYPES[0].payload(entityId), timestamp: Date.now(), clientId: 'a-parity',
    });

    const fillerAck = await sendOp(a, fillerOp());
    const baseVersion = fillerAck.serverVersion;

    const moved = { ...SUBTYPES[0].payload(entityId), position: { longitude: -44, latitude: -23, height: 900 } };
    await sendOp(a, {
      id: randomUUID(), entityType: 'marker3d', operationType: 'update', entityId, mapId: map.id,
      data: moved, timestamp: Date.now() + 1, clientId: 'a-parity',
    });

    const live = await waitForPeerOp(b, entityId, 'update');

    b.clearMessages();
    b.send({ type: 'sync_request', lastVersion: baseVersion });
    const replay = await b.waitForType('sync_response');
    const replayed = (replay.ops || []).find((o) => o.entityId === entityId);

    assert.ok(replayed, 'the update must come back on the replay');
    assert.equal(replayed.entityType, 'marker3d');
    assert.deepEqual(replayed.data, live.op.data, 'an update must replay in the same shape it was broadcast');
  });

  it('a DELETE keeps its frontend entity type on the replay', async () => {
    const a = await connect(ownerToken, 'a-parity');
    const b = await connect(peerToken, 'b-parity');

    const entityId = randomUUID();
    await sendOp(a, {
      id: randomUUID(), entityType: 'orientation360', operationType: 'create', entityId, mapId: map.id,
      data: SUBTYPES[4].payload(entityId), timestamp: Date.now(), clientId: 'a-parity',
    });

    const fillerAck = await sendOp(a, fillerOp());
    const baseVersion = fillerAck.serverVersion;

    await sendOp(a, {
      id: randomUUID(), entityType: 'orientation360', operationType: 'delete', entityId, mapId: map.id,
      data: null, timestamp: Date.now() + 1, clientId: 'a-parity',
    });
    const live = await waitForPeerOp(b, entityId, 'delete');

    b.send({ type: 'sync_request', lastVersion: baseVersion });
    const replay = await b.waitForType('sync_response');
    const replayed = (replay.ops || []).find((o) => o.entityId === entityId);

    assert.ok(replayed, 'the delete must come back on the replay');
    assert.equal(replayed.entityType, 'orientation360');
    assert.equal(replayed.operationType, 'delete');
    assert.deepEqual(replayed.data, live.op.data, 'a delete carries no payload on either path');
  });

  // Rows written BEFORE this fix still hold the backend envelope, and the operations log keeps
  // 7 days of them (cleanupOldOperations). A deploy must not hand those to a peer in the shape
  // the peer cannot read, so the read path un-nests them too — and, since `sync` was stripped at
  // write time and cannot be recovered, rebuilds one (like the snapshot does) so the entity is
  // not filtered out by isActive().
  it('a LEGACY row (nested envelope, written before the fix) is un-nested on the replay', async () => {
    const a = await connect(ownerToken, 'a-parity');
    const b = await connect(peerToken, 'b-parity');

    const fillerAck = await sendOp(a, fillerOp());
    const baseVersion = fillerAck.serverVersion;

    const entityId = randomUUID();
    await db.query(
      `INSERT INTO operations (atlas_id, op_type, entity_type, entity_id, map_id, data, client_timestamp, client_id, user_id, op_id)
       VALUES ($1, 'create', 'cesium3d', $2, $3, $4::jsonb, $5, 'legacy-client', $6, $7)`,
      [
        atlas.id, entityId, map.id,
        JSON.stringify({
          data_type: 'marker',
          tileset_id: 'PCL',
          data: { position: { longitude: -43.2, latitude: -22.9, height: 10 }, properties: { nome: 'antigo' } },
        }),
        1718900000000, owner.id, randomUUID(),
      ]
    );

    b.clearMessages();
    b.send({ type: 'sync_request', lastVersion: baseVersion });
    const replay = await b.waitForType('sync_response');
    const replayed = (replay.ops || []).find((o) => o.entityId === entityId);

    assert.ok(replayed, 'the legacy op must come back on the replay');
    assert.equal(replayed.entityType, 'marker3d', 'the legacy row still resolves its frontend type');
    assert.equal(replayed.data.id, entityId, 'the id is restored from the entity_id column');
    assert.equal(replayed.data.tilesetId, 'PCL', 'tileset_id becomes the camelCase tilesetId');
    assert.equal(replayed.data.position.height, 10, 'the inner payload is hoisted to the top level');
    assert.equal(replayed.data.data_type, undefined, 'the backend discriminator never reaches the client');
    assert.equal(replayed.data.sync.deleted, false, 'a sync is rebuilt so isActive() keeps the entity');
  });
});

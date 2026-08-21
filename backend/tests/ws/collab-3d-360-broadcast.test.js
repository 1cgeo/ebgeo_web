// Path: tests/ws/collab-3d-360-broadcast.test.js
// The "signal → peers" leg for 3D/360 had NO coverage: nothing asserted that a cesium3d /
// streetview360 op sent by client A is delivered to a connected peer B (collab-broadcasts.test.js
// only covers features/atlas/sharing). The broadcast path is entity-agnostic, so it SHOULD carry
// them — this pins it for every sub-type so a regression there can't pass silently.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createShare, loginUser,
  seedCatalogRefs, dropCatalogRefs, seedPublic360Photos, drop360Fixture,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

// AS REFERÊNCIAS DE CATÁLOGO QUE AS OPS DESTE ARQUIVO CARREGAM.
//
// Desde que `unseenResourceDenialReason` cobre as CINCO superfícies (e não só a camada de
// catálogo), uma op cujo `tileset_id`/`photo_name` não resolve para um recurso que o autor
// ENXERGA é recusada POR OPERAÇÃO — e "não existe" conta como "não posso ver", para que o ack
// não vire oráculo de existência sobre o acervo privado. Uma op recusada não é retransmitida,
// então sem estas linhas este arquivo mediria o silêncio da recusa em vez do broadcast.
const REFS_DE_CATALOGO = { tilesets: ['PCL'] };
const FOTO_360 = 'p.jpg';

describe('WebSocket collab — 3D/360 op broadcast to peers', () => {
  let app, db, server;
  let owner, ownerToken, peer, peerToken, atlas, map;
  let openClients;
  let refs360Semeadas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `b3d_owner_${randomUUID().slice(0, 6)}` });
    peer = await createUser(db, { username: `b3d_peer_${randomUUID().slice(0, 6)}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    peerToken = await loginUser(app, peer.username, peer.password);

    atlas = await createAtlas(db, owner.id, { name: '3D/360 Broadcast Atlas' });
    map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, peer.id, 'write', owner.id);

    await seedCatalogRefs(db, REFS_DE_CATALOGO);
    refs360Semeadas = await seedPublic360Photos(db, [FOTO_360]);
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
    await dropCatalogRefs(db, REFS_DE_CATALOGO);
    await drop360Fixture(db, refs360Semeadas);
    await teardownTestEnv(db);
  });

  async function connect(token, clientId) {
    const client = await createWsClient(server, atlas.id, token, clientId);
    openClients.push(client);
    await client.waitForType('connected');
    return client;
  }

  // Every 3D/360 sub-type, in the legacy on-the-wire shape the sync push accepts.
  const SUBTYPES = [
    { label: 'marker3d', target: 'cesium3d', data: { data_type: 'marker', tileset_id: 'PCL', data: { position: { longitude: -43.2, latitude: -22.9, height: 150 }, properties: { name: 'm' } } } },
    { label: 'measurement3d', target: 'cesium3d', data: { data_type: 'measurement', tileset_id: 'PCL', data: { type: 'distance', positions: [] } } },
    { label: 'viewshed3d', target: 'cesium3d', data: { data_type: 'viewshed', tileset_id: 'PCL', data: { position: { longitude: -43, latitude: -22 } } } },
    { label: 'cameraPosition3d', target: 'cesium3d', data: { data_type: 'camera_position', tileset_id: 'PCL', data: { position: { longitude: -43, latitude: -22, height: 5000 }, orientation: { heading: 0, pitch: -30, roll: 0 } } } },
    { label: 'orientation360', target: 'streetview360', data: { data_type: 'orientation', photo_name: 'p.jpg', data: { heading: 45, pitch: 0, zoom: 1 } } },
    { label: 'marker360', target: 'streetview360', data: { data_type: 'marker', photo_name: 'p.jpg', data: { position: { heading: 45, pitch: 0, distance: 5 }, properties: { nome: 'm' } } } },
  ];

  for (const st of SUBTYPES) {
    it(`a ${st.label} op sent by A is acked and broadcast to peer B`, async () => {
      const a = await connect(ownerToken, 'a-3d-360');
      const b = await connect(peerToken, 'b-3d-360');
      b.clearMessages();

      const targetId = randomUUID();
      a.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: st.target,
          targetId,
          mapId: map.id,
          data: st.data,
          timestamp: Date.now(),
          clientId: 'a-3d-360',
        },
      });

      await a.waitForType('ack'); // A's op was accepted...
      const bcast = await b.waitForType('operation'); // ...and delivered to the peer.
      assert.equal(bcast.op.targetId, targetId);
      assert.equal(bcast.op.target, st.target);
      assert.equal(bcast.op.data.data_type, st.data.data_type, 'the exact sub-type reaches the peer');
    });
  }
});

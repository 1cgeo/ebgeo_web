// Path: tests/ws/collab-manage-selection.test.js
// Regression: live selection presence is gated to editors-and-above. A `manage`
// (co-Gestor) share sits ABOVE `write` in the permission hierarchy and can edit
// features, but handleSelection previously allowed only 'owner'/'write' — so a
// manager's selection was silently dropped and never reached peers. This pins
// that a manager DOES broadcast selection, while a read-only viewer does NOT.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('WebSocket collab — manage-tier selection presence', () => {
  let app, db, server;
  let owner, manager, managerToken, viewer, viewerToken;
  let atlas, map;
  let openClients;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: `ms_owner_${randomUUID().slice(0, 6)}` });
    manager = await createUser(db, { username: `ms_mgr_${randomUUID().slice(0, 6)}` });
    viewer = await createUser(db, { username: `ms_view_${randomUUID().slice(0, 6)}` });
    managerToken = await loginUser(app, manager.username, manager.password);
    viewerToken = await loginUser(app, viewer.username, viewer.password);

    atlas = await createAtlas(db, owner.id, { name: 'Manage Selection Atlas' });
    map = await createMap(db, atlas.id);
    await createShare(db, atlas.id, manager.id, 'manage', owner.id);
    await createShare(db, atlas.id, viewer.id, 'read', owner.id);
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

  it("a manager's selection presence IS broadcast to peers (editor-and-above)", async () => {
    const ownerTok = await loginUser(app, owner.username, owner.password);
    const ownerClient = await connect(ownerTok);
    const managerClient = await connect(managerToken);

    ownerClient.clearMessages();
    const fid = randomUUID();
    managerClient.send({ type: 'selection', featureIds: [fid], mapId: map.id });

    const sel = await ownerClient.waitForType('selection');
    assert.equal(sel.userId, manager.id, 'the broadcast is attributed to the manager');
    assert.deepEqual(sel.featureIds, [fid]);
  });

  it("a read-only viewer's selection presence is NOT broadcast", async () => {
    const ownerTok = await loginUser(app, owner.username, owner.password);
    const ownerClient = await connect(ownerTok);
    const viewerClient = await connect(viewerToken);

    ownerClient.clearMessages();
    viewerClient.send({ type: 'selection', featureIds: [randomUUID()], mapId: map.id });
    await sleep(300);

    assert.equal(
      ownerClient.getMessagesOfType('selection').length,
      0,
      'a read-tier viewer must not broadcast selection to peers'
    );
  });
});

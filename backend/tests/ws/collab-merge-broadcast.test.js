// Path: tests/ws/collab-merge-broadcast.test.js
// Item 29. `broadcastToRoom({type:'maps_merged'})` (maps.controller.js:21-25) had ZERO
// tests in either package: grep for 'maps_merged' in backend/ found exactly one hit,
// the source line itself. Deleting it would keep all 20+ merge tests green.
//
// It matters because it is the LIVE convergence path for a merge. The marker
// operation added later (MAP_MERGE_ENTITY_TYPE) covers the peer that reconnects and
// replays; this broadcast covers the peer that is connected right now. Both, or the
// merge is invisible to somebody.
//
// The four cases pin: the payload (all three fields, not just the type), the
// self-echo, the absence of a broadcast when the merge FAILS, and the no-op merge
// that broadcasts anyway.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import {
  createUser, createAtlas, createMap, createFeature, createShare, loginUser,
} from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

/** Lets any pending broadcast arrive before asserting its ABSENCE. */
const settle = () => new Promise((r) => setTimeout(r, 600));

describe('maps_merged is broadcast to the room', () => {
  let app, db, server, owner, ownerToken, peer, peerToken, atlas;

  const merge = (destId, sourceMapIds) => supertest(app)
    .post(`/api/v1/atlas/${atlas.id}/maps/${destId}/merge`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ sourceMapIds });

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));

    const tag = randomUUID().slice(0, 8);
    owner = await createUser(db, { username: `wsmerge_owner_${tag}` });
    ownerToken = await loginUser(app, owner.username, owner.password);
    peer = await createUser(db, { username: `wsmerge_peer_${tag}` });
    peerToken = await loginUser(app, peer.username, peer.password);

    atlas = await createAtlas(db, owner.id, { name: `WS merge ${tag}` });
    await createShare(db, atlas.id, peer.id, 'write', owner.id);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('a connected peer receives destMapId and sourceMapIds, not just the type', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    await createFeature(db, src.id);

    const peerClient = await createWsClient(server, atlas.id, peerToken);
    await peerClient.waitForType('connected');
    peerClient.clearMessages();

    await merge(dest.id, [src.id]).expect(200);

    const msg = await peerClient.waitForType('maps_merged', 3000);
    assert.equal(msg.destMapId, dest.id);
    assert.deepEqual(msg.sourceMapIds, [src.id]);

    peerClient.close();
  });

  it('the author of the merge gets the echo too (broadcastToRoom is called without excludeWs)', async () => {
    const dest = await createMap(db, atlas.id);
    const src = await createMap(db, atlas.id);
    await createFeature(db, src.id);

    const authorClient = await createWsClient(server, atlas.id, ownerToken);
    await authorClient.waitForType('connected');
    authorClient.clearMessages();

    await merge(dest.id, [src.id]).expect(200);

    const msg = await authorClient.waitForType('maps_merged', 3000);
    assert.equal(msg.destMapId, dest.id);

    authorClient.close();
  });

  it('a FAILED merge broadcasts nothing (the emit lives after the service call)', async () => {
    const peerClient = await createWsClient(server, atlas.id, peerToken);
    await peerClient.waitForType('connected');
    peerClient.clearMessages();

    const src = await createMap(db, atlas.id);
    await supertest(app)
      .post(`/api/v1/atlas/${atlas.id}/maps/${randomUUID()}/merge`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ sourceMapIds: [src.id] })
      .expect(404);

    await settle();
    assert.equal(
      peerClient.getMessagesOfType('maps_merged').length, 0,
      'no broadcast may escape a merge that did not happen'
    );

    peerClient.close();
  });

  it('CHARACTERIZATION: a no-op self-merge still broadcasts, costing every peer a full resync', async () => {
    const dest = await createMap(db, atlas.id);

    const peerClient = await createWsClient(server, atlas.id, peerToken);
    await peerClient.waitForType('connected');
    peerClient.clearMessages();

    const res = await merge(dest.id, [dest.id]).expect(200);
    assert.deepEqual(res.body.data.moved, {}, 'the service early-returns with nothing moved');

    const msg = await peerClient.waitForType('maps_merged', 3000);
    assert.deepEqual(
      msg.sourceMapIds, [],
      'the controller emits after the early return; the frontend answers this with a full resync'
    );

    peerClient.close();
  });
});

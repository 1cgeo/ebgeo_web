// Path: tests/ws/collab-broadcasts.test.js
// Tests for WebSocket broadcasts triggered by REST API calls
// Verifies that mutations via REST (atlas update/delete, settings, sharing, sync push)
// are broadcast to connected WebSocket clients in real-time.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import supertest from 'supertest';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, createBriefing, createShare, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('WebSocket Broadcasts from REST', function () {
  let app, db, server;
  let owner, ownerToken, writer, writerToken, atlas, map, briefing;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    server = createServer(app);

    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);

    await new Promise((resolve) => {
      server.listen(0, () => resolve());
    });

    // Create test users
    owner = await createUser(db, { username: 'bcast_owner' });
    ownerToken = await loginUser(app, owner.username, owner.password);
    writer = await createUser(db, { username: 'bcast_writer' });
    writerToken = await loginUser(app, writer.username, writer.password);

    // Create shared atlas, map and briefing
    atlas = await createAtlas(db, owner.id, { name: 'Broadcast Test Atlas' });
    map = await createMap(db, atlas.id, { name: 'Broadcast Test Map' });
    briefing = await createBriefing(db, atlas.id, { name: 'Broadcast Test Briefing' });
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  describe('Atlas Delete Broadcast', function () {
    it('broadcasts atlas_deleted and closes connections when atlas is deleted', async () => {
      // Create a separate atlas for this test so we don't affect others
      const deleteAtlas = await createAtlas(db, owner.id, { name: 'Atlas To Delete' });
      await createMap(db, deleteAtlas.id);
      await createShare(db, deleteAtlas.id, writer.id, 'write', owner.id);

      // Both users connect via WS
      const ownerClient = await createWsClient(server, deleteAtlas.id, ownerToken);
      const writerClient = await createWsClient(server, deleteAtlas.id, writerToken);

      await ownerClient.waitForType('connected');
      await writerClient.waitForType('connected');

      writerClient.clearMessages();

      // Owner deletes the atlas via REST
      const res = await supertest(app)
        .delete(`/api/v1/atlas/${deleteAtlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      assert.equal(res.status, 204);

      // Writer should receive atlas_deleted message
      const deletedMsg = await writerClient.waitForType('atlas_deleted', 3000);
      assert.ok(deletedMsg);
      assert.equal(deletedMsg.type, 'atlas_deleted');
      assert.equal(deletedMsg.atlasId, deleteAtlas.id);

      // Wait a bit for the WS connection to close
      await new Promise((r) => setTimeout(r, 500));

      // Writer's WS should be closed
      assert.notEqual(writerClient.ws.readyState, 1); // 1 = OPEN

      ownerClient.close();
    });
  });

  describe('Atlas Update Broadcast', function () {
    it('broadcasts atlas_updated when atlas is updated via REST', async () => {
      const writerClient = await createWsClient(server, atlas.id, writerToken);
      await writerClient.waitForType('connected');

      writerClient.clearMessages();

      // Owner updates atlas via REST
      const res = await supertest(app)
        .put(`/api/v1/atlas/${atlas.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Updated Name' });

      assert.equal(res.status, 200);

      // Writer should receive atlas_updated
      const updatedMsg = await writerClient.waitForType('atlas_updated', 3000);
      assert.ok(updatedMsg);
      assert.equal(updatedMsg.type, 'atlas_updated');
      assert.ok(updatedMsg.data);
      assert.equal(updatedMsg.data.name, 'Updated Name');

      writerClient.close();
    });
  });

  describe('Atlas Settings Update Broadcast', function () {
    it('broadcasts atlas_settings_updated when settings are changed via REST', async () => {
      const writerClient = await createWsClient(server, atlas.id, writerToken);
      await writerClient.waitForType('connected');

      writerClient.clearMessages();

      // Owner updates settings via REST
      const res = await supertest(app)
        .patch(`/api/v1/atlas/${atlas.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ min_zoom: 5, max_zoom: 18 });

      assert.equal(res.status, 200);

      // Writer should receive atlas_settings_updated
      const settingsMsg = await writerClient.waitForType('atlas_settings_updated', 3000);
      assert.ok(settingsMsg);
      assert.equal(settingsMsg.type, 'atlas_settings_updated');
      assert.ok(settingsMsg.settings);

      writerClient.close();
    });
  });

  describe('Sharing Change Broadcast', function () {
    it('broadcasts sharing_updated when a user is shared via REST', async () => {
      const writerClient = await createWsClient(server, atlas.id, writerToken);
      await writerClient.waitForType('connected');

      writerClient.clearMessages();

      // Create a 3rd user to share with
      const thirdUser = await createUser(db, { username: 'bcast_third' });

      // Owner shares atlas with 3rd user via REST
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sharing/users`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: thirdUser.id, permission: 'read' });

      assert.equal(res.status, 201);

      // Writer should receive sharing_updated
      const sharingMsg = await writerClient.waitForType('sharing_updated', 3000);
      assert.ok(sharingMsg);
      assert.equal(sharingMsg.type, 'sharing_updated');
      assert.equal(sharingMsg.action, 'user_added');
      assert.equal(sharingMsg.userId, thirdUser.id);
      assert.equal(sharingMsg.permission, 'read');

      writerClient.close();
    });
  });

  describe('REST Sync Push Broadcast', function () {
    it('broadcasts operations to WS clients when sync push is done via REST', async () => {
      const writerClient = await createWsClient(server, atlas.id, writerToken);
      await writerClient.waitForType('connected');

      writerClient.clearMessages();

      const featureId = randomUUID();

      // Owner pushes operations via REST sync endpoint
      const res = await supertest(app)
        .post(`/api/v1/atlas/${atlas.id}/sync`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          operations: [
            {
              id: randomUUID(),
              entityType: 'feature',
              operationType: 'create',
              entityId: featureId,
              mapId: map.id,
              data: {
                feature_type: 'point',
                geometry: { coordinates: [-43.5, -23.0] },
                properties: { name: 'REST Sync Feature' },
              },
              timestamp: Date.now(),
              clientId: 'rest-sync-client',
            },
          ],
        });

      assert.equal(res.status, 200);

      // Writer should receive operations broadcast
      const opsMsg = await writerClient.waitForType('operations', 3000);
      assert.ok(opsMsg);
      assert.equal(opsMsg.type, 'operations');
      assert.equal(opsMsg.userId, owner.id);
      assert.ok(Array.isArray(opsMsg.ops));
      assert.equal(opsMsg.ops.length, 1);

      writerClient.close();
    });
  });

  describe('Briefing Edit Awareness', function () {
    it('broadcasts briefing_edit_started when a user starts editing', async () => {
      const ownerClient = await createWsClient(server, atlas.id, ownerToken);
      const writerClient = await createWsClient(server, atlas.id, writerToken);

      await ownerClient.waitForType('connected');
      await writerClient.waitForType('connected');

      ownerClient.clearMessages();

      // Writer sends briefing_edit_start via WS
      writerClient.send({
        type: 'briefing_edit_start',
        briefingId: briefing.id,
      });

      // Owner should receive briefing_edit_started
      const editStartMsg = await ownerClient.waitForType('briefing_edit_started', 3000);
      assert.ok(editStartMsg);
      assert.equal(editStartMsg.type, 'briefing_edit_started');
      assert.equal(editStartMsg.userId, writer.id);
      assert.equal(editStartMsg.userName, writer.nome);
      assert.equal(editStartMsg.briefingId, briefing.id);

      ownerClient.close();
      writerClient.close();
    });

    it('broadcasts briefing_edit_ended when a user stops editing', async () => {
      const ownerClient = await createWsClient(server, atlas.id, ownerToken);
      const writerClient = await createWsClient(server, atlas.id, writerToken);

      await ownerClient.waitForType('connected');
      await writerClient.waitForType('connected');

      ownerClient.clearMessages();

      // Writer sends briefing_edit_end via WS
      writerClient.send({
        type: 'briefing_edit_end',
        briefingId: briefing.id,
      });

      // Owner should receive briefing_edit_ended
      const editEndMsg = await ownerClient.waitForType('briefing_edit_ended', 3000);
      assert.ok(editEndMsg);
      assert.equal(editEndMsg.type, 'briefing_edit_ended');
      assert.equal(editEndMsg.userId, writer.id);
      assert.equal(editEndMsg.userName, writer.nome);
      assert.equal(editEndMsg.briefingId, briefing.id);

      ownerClient.close();
      writerClient.close();
    });
  });
});

// Path: tests/ws/collab-advanced.test.js
// Advanced WebSocket collaboration tests: cursor/selection details, broadcast isolation,
// batch ack, read-only enforcement, sync_request, concurrent writes, frontend format, invalid atlasId

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser, createShare } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('WebSocket Collaboration — Advanced', () => {
  let app, db, server;
  let owner, writer, reader;
  let ownerToken, writerToken, readerToken;
  let atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    // Create HTTP server from Express app
    server = createServer(app);

    // Import and attach WebSocket
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);

    // Start server on random port
    await new Promise((resolve) => {
      server.listen(0, () => resolve());
    });

    // Create test users
    owner = await createUser(db, { username: 'wsadv_owner' });
    writer = await createUser(db, { username: 'wsadv_writer' });
    reader = await createUser(db, { username: 'wsadv_reader' });

    // Get tokens
    ownerToken = await loginUser(app, owner.username, owner.password);
    writerToken = await loginUser(app, writer.username, writer.password);
    readerToken = await loginUser(app, reader.username, reader.password);

    // Create atlas with shares
    atlas = await createAtlas(db, owner.id, { name: 'WS Advanced Atlas' });
    map = await createMap(db, atlas.id, { name: 'WS Advanced Map' });

    // Set up shares
    await createShare(db, atlas.id, writer.id, 'write', owner.id);
    await createShare(db, atlas.id, reader.id, 'read', owner.id);
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  describe('Cursor Updates', () => {
    it('cursor update includes mapId and is broadcast to others', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      client2.clearMessages();

      // Client 1 sends cursor update with mapId
      client1.send({
        type: 'cursor',
        position: { lat: -15.7, lng: -47.9 },
        mapId: map.id,
      });

      // Client 2 should receive cursor update with mapId
      const cursorMsg = await client2.waitForType('cursor');
      assert.ok(cursorMsg);
      assert.equal(cursorMsg.mapId, map.id);
      assert.ok(cursorMsg.position);
      assert.equal(cursorMsg.position.lat, -15.7);
      assert.equal(cursorMsg.position.lng, -47.9);
      assert.equal(cursorMsg.userId, owner.id);

      client1.close();
      client2.close();
    });

    it('cursor update is NOT echoed back to sender', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      await client1.waitForType('connected');

      client1.clearMessages();

      client1.send({
        type: 'cursor',
        position: { lat: -10.0, lng: -50.0 },
        mapId: map.id,
      });

      // Wait a bit and check no cursor message was received
      await new Promise(r => setTimeout(r, 500));
      const cursorMessages = client1.getMessagesOfType('cursor');
      assert.equal(cursorMessages.length, 0);

      client1.close();
    });
  });

  describe('Selection Updates', () => {
    it('selection update includes featureIds and is broadcast to others', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      client2.clearMessages();

      const featureId1 = randomUUID();
      const featureId2 = randomUUID();

      // Client 1 sends selection with featureIds
      client1.send({
        type: 'selection',
        featureIds: [featureId1, featureId2],
        mapId: map.id,
      });

      const selectionMsg = await client2.waitForType('selection');
      assert.ok(selectionMsg);
      assert.ok(Array.isArray(selectionMsg.featureIds));
      assert.equal(selectionMsg.featureIds.length, 2);
      assert.ok(selectionMsg.featureIds.includes(featureId1));
      assert.ok(selectionMsg.featureIds.includes(featureId2));
      assert.equal(selectionMsg.userId, owner.id);

      client1.close();
      client2.close();
    });
  });

  describe('Operation Broadcast Isolation', () => {
    it('operation via WS is received by others but NOT the sender', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      // Clear messages on both clients
      client1.clearMessages();
      client2.clearMessages();

      const targetId = randomUUID();
      client1.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: targetId,
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [-43.5, -23.0] },
            properties: { name: 'Broadcast Isolation Test' },
          },
          timestamp: Date.now(),
          clientId: 'sender-client',
        },
      });

      // Sender should get ack, not operation
      const ack = await client1.waitForType('ack');
      assert.ok(ack);

      // Receiver should get operation
      const opMsg = await client2.waitForType('operation');
      assert.ok(opMsg);
      assert.ok(opMsg.op);

      // Sender should NOT get operation type message
      const senderOps = client1.getMessagesOfType('operation');
      assert.equal(senderOps.length, 0);

      client1.close();
      client2.close();
    });
  });

  describe('Batch Operations', () => {
    it('sender receives ack_batch after batch operations', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      const ops = [];
      for (let i = 0; i < 4; i++) {
        ops.push({
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [i * 0.1, i * 0.1] },
            properties: { batch: true, index: i },
          },
          timestamp: Date.now() + i,
          clientId: 'batch-test-client',
        });
      }

      client.send({
        type: 'operations',
        ops: ops,
      });

      const ackBatch = await client.waitForType('ack_batch');
      assert.ok(ackBatch);
      assert.ok(Array.isArray(ackBatch.opIds));
      assert.equal(ackBatch.opIds.length, 4);
      assert.ok(ackBatch.serverVersion > 0);

      // Verify the opIds match what was sent
      assert.equal(ops.length, 4, 'four ops were actually built and sent');
      for (const op of ops) {
        assert.ok(ackBatch.opIds.includes(op.id));
      }

      client.close();
    });

    it('batch operations are broadcast to other clients', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      client2.clearMessages();

      const ops = [
        {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: map.id,
          data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
          timestamp: Date.now(),
          clientId: 'batch-sender',
        },
        {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: map.id,
          data: { feature_type: 'line', geometry: { coordinates: [[0, 0], [1, 1]] }, properties: {} },
          timestamp: Date.now() + 1,
          clientId: 'batch-sender',
        },
      ];

      client1.send({ type: 'operations', ops });

      // Client2 should receive the operations broadcast
      const opsMsg = await client2.waitForType('operations');
      assert.ok(opsMsg);
      assert.ok(Array.isArray(opsMsg.ops));
      assert.equal(opsMsg.ops.length, 2);

      client1.close();
      client2.close();
    });
  });

  describe('Read-Only Enforcement', () => {
    it('reader cannot push single operation — receives error', async () => {
      const client = await createWsClient(server, atlas.id, readerToken);
      await client.waitForType('connected');

      client.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [5, 5] },
            properties: { unauthorized: true },
          },
          timestamp: Date.now(),
          clientId: 'reader-test-client',
        },
      });

      // Should receive an error message
      const errorMsg = await client.waitForType('error');
      assert.ok(errorMsg);
      assert.equal(errorMsg.code, 'FORBIDDEN');
      assert.ok(errorMsg.message.toLowerCase().includes('read'));

      client.close();
    });

    it('reader cannot push batch operations — receives error', async () => {
      const client = await createWsClient(server, atlas.id, readerToken);
      await client.waitForType('connected');

      client.send({
        type: 'operations',
        ops: [{
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: map.id,
          data: { feature_type: 'point', geometry: { coordinates: [6, 6] }, properties: {} },
          timestamp: Date.now(),
          clientId: 'reader-batch-client',
        }],
      });

      const errorMsg = await client.waitForType('error');
      assert.ok(errorMsg);
      assert.equal(errorMsg.code, 'FORBIDDEN');

      client.close();
    });
  });

  describe('Sync Request via WebSocket', () => {
    it('sync_request returns sync_response with snapshot data', async () => {
      // First push some data via WS so there is something to sync
      const ownerClient = await createWsClient(server, atlas.id, ownerToken);
      await ownerClient.waitForType('connected');

      const featureId = randomUUID();
      ownerClient.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: featureId,
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [-43.1, -22.8] },
            properties: { name: 'Sync Test Feature' },
          },
          timestamp: Date.now(),
          clientId: 'sync-test',
        },
      });

      await ownerClient.waitForType('ack');
      ownerClient.clearMessages();

      // Request sync from version 0 (should get snapshot)
      ownerClient.send({
        type: 'sync_request',
        lastVersion: 0,
      });

      const syncResponse = await ownerClient.waitForType('sync_response');
      assert.ok(syncResponse);
      assert.equal(syncResponse.isSnapshot, true);
      assert.ok(syncResponse.snapshot);
      assert.ok(syncResponse.currentVersion >= 0);
      assert.ok(syncResponse.snapshot.atlas);
      assert.ok(Array.isArray(syncResponse.snapshot.maps));

      ownerClient.close();
    });
  });

  describe('Concurrent Writers', () => {
    it('two writers pushing conflicting operations — both get acks', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      // Both writers create a feature targeting the same entity ID (simulating a conflict)
      const sharedTargetId = randomUUID();
      const now = Date.now();

      client1.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: sharedTargetId,
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [10, 10] },
            properties: { name: 'Writer 1 version' },
          },
          timestamp: now,
          clientId: 'writer1',
        },
      });

      // Wait for first ack before sending the second (it's a create on the same ID)
      const ack1 = await client1.waitForType('ack');
      assert.ok(ack1);

      // Second writer sends an update to the same entity
      client2.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'update',
          target: 'feature',
          targetId: sharedTargetId,
          mapId: map.id,
          changes: {
            properties: { name: 'Writer 2 version' },
          },
          timestamp: now + 1, // Later timestamp wins in LWW
          clientId: 'writer2',
        },
      });

      const ack2 = await client2.waitForType('ack');
      assert.ok(ack2);

      // Both should have received acks with valid server versions
      assert.ok(ack1.serverVersion > 0);
      assert.ok(ack2.serverVersion > 0);

      // LWW: the later timestamp should win
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [sharedTargetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].properties.name, 'Writer 2 version');

      client1.close();
      client2.close();
    });
  });

  describe('Frontend Format Operations', () => {
    it('operations using entityType/operationType format work via WS', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      const targetId = randomUUID();

      // Use frontend format: entityType, operationType, entityId
      client.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          entityType: 'feature',
          operationType: 'create',
          entityId: targetId,
          mapId: map.id,
          data: {
            feature_type: 'polygon',
            geometry: { coordinates: [[[-43.3, -22.9], [-43.2, -22.9], [-43.2, -22.8], [-43.3, -22.9]]] },
            properties: { name: 'Frontend Format Feature' },
          },
          timestamp: Date.now(),
          clientId: 'frontend-client',
        },
      });

      const ack = await client.waitForType('ack');
      assert.ok(ack);
      assert.ok(ack.serverVersion > 0);

      // Verify the feature was created
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].feature_type, 'polygon');
      assert.equal(rows[0].properties.name, 'Frontend Format Feature');

      client.close();
    });
  });

  describe('Connection with Invalid Atlas', () => {
    it('connection with nonexistent atlasId fails', async () => {
      const fakeAtlasId = randomUUID();

      try {
        const client = await createWsClient(server, fakeAtlasId, ownerToken);
        // If we get here, wait for a connected message (should not arrive)
        await client.waitForType('connected', 2000);
        assert.fail('Should not have connected to nonexistent atlas');
      } catch (err) {
        // The upgrade is refused BEFORE the socket opens: resolvePermission finds no
        // atlas → the gateway answers HTTP 403 → `ws` rejects with
        // "Unexpected server response: 403". Anything else (a timeout, an open
        // socket) means the refusal moved, which is what this test guards.
        assert.match(err.message, /403/, `expected an HTTP 403 upgrade refusal, got: ${err.message}`);
      }
    });

    it('connection with invalid (non-UUID) atlasId is rejected with an HTTP status, not a timeout', async () => {
      // `assert.ok(err)` accepted every failure mode there is — a helper typo, a
      // closed port, a timeout — so it could not tell "the server refused this"
      // from "the connection never happened". The refusal is a real HTTP status
      // on the upgrade, and pinning WHICH one also pins where the refusal comes
      // from: 'not-a-uuid' reaches the atlas lookup, whose ::uuid cast fails, and
      // the gateway's outer catch answers 500. That is the CURRENT behaviour, and
      // it is arguably the wrong status for a malformed client parameter — pinned
      // so that tightening it to 400 is a deliberate, visible change rather than
      // a silent one.
      await assert.rejects(
        () => createWsClient(server, 'not-a-uuid', ownerToken),
        (err) => {
          assert.match(
            err.message,
            /Unexpected server response: \d{3}/,
            `the upgrade must be refused with a status, got: ${err.message}`
          );
          assert.doesNotMatch(
            err.message,
            /Timeout|ECONNREFUSED/,
            'a timeout means the refusal never happened — that is not a rejection test'
          );
          assert.match(err.message, /Unexpected server response: 500/, 'current behaviour: the uuid cast fails server-side');
          return true;
        }
      );
    });
  });
});

// Path: tests/ws/collab.test.js
// WebSocket collaboration tests for real-time functionality

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser, makeAtlasPublic, getPublicToken } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import jwt from 'jsonwebtoken';

describe('WebSocket Collaboration', () => {
  let app, db, server;
  let owner, writer, reader, stranger, manager, commenter;
  let ownerToken, writerToken, readerToken, managerToken, commenterToken;
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
    owner = await createUser(db, { username: 'ws_owner' });
    writer = await createUser(db, { username: 'ws_writer' });
    reader = await createUser(db, { username: 'ws_reader' });
    stranger = await createUser(db, { username: 'ws_stranger' });
    manager = await createUser(db, { username: 'ws_manager' });
    commenter = await createUser(db, { username: 'ws_commenter' });

    // Get tokens
    ownerToken = await loginUser(app, owner.username, owner.password);
    writerToken = await loginUser(app, writer.username, writer.password);
    readerToken = await loginUser(app, reader.username, reader.password);
    managerToken = await loginUser(app, manager.username, manager.password);
    commenterToken = await loginUser(app, commenter.username, commenter.password);

    // Create atlas with shares
    atlas = await createAtlas(db, owner.id, { name: 'WS Test Atlas' });
    map = await createMap(db, atlas.id);

    // Set up shares
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'write', $3)`,
      [atlas.id, writer.id, owner.id]
    );
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'read', $3)`,
      [atlas.id, reader.id, owner.id]
    );
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'manage', $3)`,
      [atlas.id, manager.id, owner.id]
    );
    await db.query(
      `INSERT INTO atlas_shares (atlas_id, user_id, permission, added_by) VALUES ($1, $2, 'comment', $3)`,
      [atlas.id, commenter.id, owner.id]
    );
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestEnv(db);
  });

  describe('Connection', () => {
    it('owner can connect to atlas', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);

      // Wait for connected message
      const connected = await client.waitForType('connected');
      assert.ok(connected);
      assert.ok(connected.sessionId);
      assert.equal(connected.permission, 'owner');

      client.close();
    });

    it('writer can connect to atlas', async () => {
      const client = await createWsClient(server, atlas.id, writerToken);

      const connected = await client.waitForType('connected');
      assert.ok(connected);
      assert.equal(connected.permission, 'write');

      client.close();
    });

    it('reader can connect to atlas', async () => {
      const client = await createWsClient(server, atlas.id, readerToken);

      const connected = await client.waitForType('connected');
      assert.ok(connected);
      assert.equal(connected.permission, 'read');

      client.close();
    });

    it('manage share connects and is told it is manage (not flattened to write)', async () => {
      // The tier the frontend reads to gate its UI. collab-manage-selection.test.js
      // creates a 'manage' share but never looks at the value handed back in
      // `connected`, so the co-Gestor could arrive as 'write' — or as 'read' —
      // with the whole suite green.
      const client = await createWsClient(server, atlas.id, managerToken);
      const connected = await client.waitForType('connected');
      assert.equal(connected.permission, 'manage');
      client.close();
    });

    it('comment share connects and is told it is comment (not flattened to read)', async () => {
      const client = await createWsClient(server, atlas.id, commenterToken);
      const connected = await client.waitForType('connected');
      assert.equal(connected.permission, 'comment');
      client.close();
    });

    // ---------------------------------------------------------------------
    // Refusals. These four used to be `catch (err) { assert.ok(err) }`, which
    // any failure satisfies: a typo in the helper URL, a port that is not
    // listening, a TypeError inside createWsClient, a plain timeout. That is
    // precisely the distinction the tests exist to make — "the server refused
    // this principal" versus "the connection never happened" — so each one now
    // names the HTTP status the upgrade was refused with, and proves that no
    // session was left behind.
    // ---------------------------------------------------------------------

    it('stranger is refused with HTTP 403 and leaves no session row', async () => {
      const strangerToken = await loginUser(app, stranger.username, stranger.password);

      await assert.rejects(
        () => createWsClient(server, atlas.id, strangerToken),
        (err) => {
          assert.match(
            err.message,
            /Unexpected server response: 403/,
            `expected a 403 upgrade refusal, got: ${err.message}`
          );
          return true;
        }
      );

      // A metade "e não deixa linha de sessão" saiu em 2026-08-23, junto com a tabela
      // `active_sessions`: sem tabela não há rastro possível, e uma contagem sobre uma
      // relação inexistente seria erro de SQL, não verificação. Que NENHUM caminho de
      // socket escreva no banco (aceito ou recusado) é asserido em
      // tests/ws/collab-presenca-sem-banco.test.js, com contador de pool.
    });

    it('an invalid token is refused with HTTP 401, not 403 (authentication, not authorization)', async () => {
      // The status distinction is the assertion: 401 means the token never
      // verified; a 403 here would mean the gateway accepted the identity and
      // then weighed permissions on it.
      await assert.rejects(
        () => createWsClient(server, atlas.id, 'invalid-token'),
        (err) => {
          assert.match(
            err.message,
            /Unexpected server response: 401/,
            `expected a 401 upgrade refusal, got: ${err.message}`
          );
          return true;
        }
      );
    });

    it('a token signed with another secret is refused with 401 as well', async () => {
      const forged = jwt.sign(
        { sub: owner.id, username: owner.username },
        'um-segredo-que-este-servidor-nao-conhece'
      );
      await assert.rejects(
        () => createWsClient(server, atlas.id, forged),
        /Unexpected server response: 401/
      );
    });
  });

  describe('Ping/Pong Heartbeat', () => {
    it('server responds to ping with pong', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      client.send({ type: 'ping' });

      const pong = await client.waitForType('pong');
      assert.ok(pong);
      assert.equal(pong.type, 'pong');

      client.close();
    });
  });

  describe('Cursor Updates', () => {
    it('cursor updates are broadcast to other clients', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      // Clear messages
      client2.clearMessages();

      // Client 1 sends cursor update
      client1.send({
        type: 'cursor',
        position: { lat: -22.9, lng: -43.2 },
        mapId: map.id,
      });

      // Client 2 should receive cursor update
      const cursorMsg = await client2.waitForCursor();
      assert.ok(cursorMsg);
      // The relay frame is FLAT (collab.handlers.js): `position` at the top level,
      // never nested under `data`.
      assert.deepEqual(cursorMsg.position, { lat: -22.9, lng: -43.2 });
      assert.equal(cursorMsg.data, undefined);

      client1.close();
      client2.close();
    });
  });

  describe('Selection Updates', () => {
    it('selection updates are broadcast to other clients', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      client2.clearMessages();

      // Client 1 sends selection
      client1.send({
        type: 'selection',
        featureIds: [randomUUID()],
      });

      // Client 2 should receive selection
      const selectionMsg = await client2.waitForType('selection');
      assert.ok(selectionMsg);
      // Flat frame here too: `featureIds` at the top level, never under `data`.
      assert.ok(Array.isArray(selectionMsg.featureIds));
      assert.equal(selectionMsg.featureIds.length, 1);
      assert.equal(selectionMsg.data, undefined);

      client1.close();
      client2.close();
    });
  });

  describe('Operation Handling', () => {
    it('owner can push operation via WebSocket', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      const targetId = randomUUID();
      client.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: targetId,
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [0, 0] },
            properties: { name: 'WS Created' },
          },
          timestamp: Date.now(),
          clientId: 'ws-test-client',
        },
      });

      // Should receive ack
      const ack = await client.waitForType('ack');
      assert.ok(ack);
      // The ack carries BOTH: opId identifies the op, serverVersion advances the cursor.
      assert.ok(ack.opId, 'the ack identifies the acked op');
      assert.ok(ack.serverVersion > 0, 'the ack advances the server version');

      client.close();

      // Verify feature was created
      const { rows } = await db.query('SELECT * FROM features WHERE id = $1', [targetId]);
      assert.equal(rows.length, 1);
    });

    it('writer can push operation via WebSocket', async () => {
      const client = await createWsClient(server, atlas.id, writerToken);
      await client.waitForType('connected');

      const targetId = randomUUID();
      client.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: targetId,
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [1, 1] },
            properties: { name: 'Writer Created' },
          },
          timestamp: Date.now(),
          clientId: 'ws-writer-client',
        },
      });

      const ack = await client.waitForType('ack');
      assert.ok(ack);

      client.close();
    });

    it('reader cannot push operations', async () => {
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
            geometry: { coordinates: [2, 2] },
            properties: {},
          },
          timestamp: Date.now(),
          clientId: 'reader-client',
        },
      });

      // Should receive error
      await client.waitForType('error').catch(() => null);
      // If no error message type, the operation should be silently rejected
      // Check that feature was NOT created
      const { rows } = await db.query(
        `SELECT * FROM features WHERE properties->>'clientId' = 'reader-client'`
      );
      assert.equal(rows.length, 0);

      client.close();
    });

    it('operations are broadcast to other clients', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      client2.clearMessages();

      // Client 1 sends operation
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
            geometry: { coordinates: [3, 3] },
            properties: { name: 'Broadcast Test' },
          },
          timestamp: Date.now(),
          clientId: 'broadcast-test',
        },
      });

      // Client 2 should receive the operation
      const opMsg = await client2.waitForType('operation');
      assert.ok(opMsg);

      client1.close();
      client2.close();
    });
  });

  describe('Batch Operations', () => {
    it('can push multiple operations in batch', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      const ops = [];
      for (let i = 0; i < 3; i++) {
        ops.push({
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: map.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [i, i] },
            properties: { batch: true, index: i },
          },
          timestamp: Date.now() + i,
          clientId: 'batch-client',
        });
      }

      client.send({
        type: 'operations',
        ops: ops,
      });

      // Should receive ack_batch or multiple acks
      const ack = await client.waitForType('ack_batch').catch(() => client.waitForType('ack'));
      assert.ok(ack);

      client.close();
    });
  });

  describe('Sync Request', () => {
    it('can request sync via WebSocket', async () => {
      const client = await createWsClient(server, atlas.id, ownerToken);
      await client.waitForType('connected');

      client.send({
        type: 'sync_request',
        lastVersion: 0,
      });

      const syncResponse = await client.waitForType('sync_response');
      // `'isSnapshot' in x` and `x.currentVersion !== undefined` accepted null,
      // NaN, '' and the string 'false' — i.e. they asserted that two property
      // names exist. The contract is about their TYPES and, for a pull from
      // version 0, about which branch answered.
      assert.equal(typeof syncResponse.isSnapshot, 'boolean');
      assert.equal(syncResponse.isSnapshot, true, 'a sync_request from version 0 is answered with a snapshot');
      assert.equal(typeof syncResponse.currentVersion, 'number');
      assert.ok(Number.isFinite(syncResponse.currentVersion), 'the version must be a real number, not NaN');

      // And the snapshot really carries this atlas's map, which is what the peer
      // rebuilds its store from.
      const mapIds = (syncResponse.snapshot?.maps ?? []).map((m) => m.id);
      assert.ok(mapIds.includes(map.id), 'the snapshot must contain the atlas maps');

      client.close();
    });
  });

  describe('Public Atlas WebSocket', () => {
    let publicAtlas, publicMap, publicLink;

    before(async () => {
      publicAtlas = await createAtlas(db, owner.id, { name: 'Public WS Atlas' });
      publicMap = await createMap(db, publicAtlas.id);
      publicLink = await makeAtlasPublic(db, publicAtlas.id);
    });

    it('public user can connect with public token', async () => {
      const publicToken = await getPublicToken(app, publicLink);

      const client = await createWsClient(server, publicAtlas.id, publicToken);
      const connected = await client.waitForType('connected');

      assert.ok(connected);
      assert.equal(connected.permission, 'read');

      client.close();
    });

    it('public user receives operations but cannot push', async () => {
      const publicToken = await getPublicToken(app, publicLink);

      const publicClient = await createWsClient(server, publicAtlas.id, publicToken);
      const ownerClient = await createWsClient(server, publicAtlas.id, ownerToken);

      await publicClient.waitForType('connected');
      await ownerClient.waitForType('connected');

      publicClient.clearMessages();

      // Owner pushes an operation
      ownerClient.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: publicMap.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [10, 10] },
            properties: {},
          },
          timestamp: Date.now(),
          clientId: 'owner-client',
        },
      });

      // Public client should receive the operation
      const opMsg = await publicClient.waitForType('operation');
      assert.ok(opMsg);

      // Public client tries to push (should fail/be ignored)
      publicClient.send({
        type: 'operation',
        op: {
          id: randomUUID(),
          type: 'create',
          target: 'feature',
          targetId: randomUUID(),
          mapId: publicMap.id,
          data: {
            feature_type: 'point',
            geometry: { coordinates: [11, 11] },
            properties: { unauthorized: true },
          },
          timestamp: Date.now(),
          clientId: 'public-client',
        },
      });

      // Wait a bit and verify no feature was created
      await new Promise(r => setTimeout(r, 500));

      const { rows } = await db.query(
        `SELECT * FROM features WHERE properties->>'unauthorized' = 'true'`
      );
      assert.equal(rows.length, 0);

      publicClient.close();
      ownerClient.close();
    });
  });

  describe('User Presence', () => {
    it('user_joined is broadcast when user connects', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      await client1.waitForType('connected');

      client1.clearMessages();

      // Second user connects
      const client2 = await createWsClient(server, atlas.id, writerToken);
      await client2.waitForType('connected');

      // Client 1 receives user_joined for client 2 (the joining client is excluded from its own event).
      const joined = await client1.waitForType('user_joined');
      assert.equal(joined.user.id, writer.id);

      client1.close();
      client2.close();
    });

    it('user_left is broadcast when user disconnects', async () => {
      const client1 = await createWsClient(server, atlas.id, ownerToken);
      const client2 = await createWsClient(server, atlas.id, writerToken);

      await client1.waitForType('connected');
      await client2.waitForType('connected');

      client1.clearMessages();

      // Client 2 disconnects
      client2.close();

      // Client 1 receives user_left carrying the departed user's id.
      const left = await client1.waitForType('user_left');
      assert.equal(left.userId, writer.id);

      client1.close();
    });
  });
});

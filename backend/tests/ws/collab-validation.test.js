// Path: tests/ws/collab-validation.test.js
// The WebSocket path does not go through the REST validate middleware, so the
// handlers validate operations against the shared push schema. Malformed ops
// must yield an `error` (VALIDATION_ERROR) without dropping the connection.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, createMap, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('WebSocket — operation validation', () => {
  let app, db, server, owner, ownerToken, atlas, map;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: 'wsval_owner' });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'WS Validation Atlas' });
    map = await createMap(db, atlas.id);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('rejects a malformed batch (missing op id) with VALIDATION_ERROR', async () => {
    const client = await createWsClient(server, atlas.id, ownerToken);
    await client.waitForType('connected');

    client.send({ type: 'operations', ops: [{ target: 'feature', type: 'create', targetId: randomUUID() }] });

    const err = await client.waitForType('error');
    assert.equal(err.code, 'VALIDATION_ERROR');
    client.close();
  });

  it('rejects a malformed single operation with VALIDATION_ERROR', async () => {
    const client = await createWsClient(server, atlas.id, ownerToken);
    await client.waitForType('connected');

    client.send({ type: 'operation', op: { target: 'feature' } }); // missing id, type, targetId

    const err = await client.waitForType('error');
    assert.equal(err.code, 'VALIDATION_ERROR');
    client.close();
  });

  it('still accepts a well-formed operation (regression)', async () => {
    const client = await createWsClient(server, atlas.id, ownerToken);
    await client.waitForType('connected');

    client.send({
      type: 'operation',
      op: {
        id: randomUUID(),
        type: 'create',
        target: 'feature',
        targetId: randomUUID(),
        mapId: map.id,
        data: { feature_type: 'point', geometry: { coordinates: [0, 0] }, properties: {} },
        timestamp: Date.now(),
        clientId: 'ws1',
      },
    });

    const ack = await client.waitForType('ack');
    assert.ok(ack);
    client.close();
  });
});

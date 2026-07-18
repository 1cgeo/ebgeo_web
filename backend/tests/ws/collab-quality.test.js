// Path: tests/ws/collab-quality.test.js
// Fase 1 Tarefa 9: the server reacts to client-reported connection quality and
// pushes adaptive-settings when the quality band changes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';

describe('WebSocket — adaptive quality', () => {
  let app, db, server, owner, ownerToken, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));

    owner = await createUser(db, { username: 'quality_owner' });
    ownerToken = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'Quality Atlas' });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('emits adaptive-settings for a poor connection', async () => {
    const client = await createWsClient(server, atlas.id, ownerToken);
    await client.waitForType('connected');

    client.send({ type: 'connection-quality', rttMs: 600 }); // -> poor

    const settings = await client.waitForType('adaptive-settings');
    assert.equal(settings.quality, 'poor');
    assert.ok(settings.viewportOnly);
    assert.equal(settings.geometryPrecision, 5);
    client.close();
  });
});

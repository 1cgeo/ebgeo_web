// Path: tests/ws/collab-clientid.test.js
// Fase 8: the WS handshake accepts a stable ?clientId= (idempotency/presence
// across reconnects); old clients that omit it still get a generated one.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import WebSocket from 'ws';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';

function connect(server, atlasId, token, clientId) {
  const port = server.address().port;
  const q = clientId ? `&clientId=${clientId}` : '';
  const ws = new WebSocket(`ws://localhost:${port}/api/v1/collab?atlasId=${atlasId}&token=${token}${q}`);
  return new Promise((resolve, reject) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'connected') {
        ws.close();
        resolve(msg);
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 3000);
  });
}

describe('WebSocket — stable clientId handshake', () => {
  let app, db, server, owner, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    const { attachWebSocket } = await import('../../src/modules/collab/collab.gateway.js');
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, () => resolve()));
    owner = await createUser(db, { username: 'cid_owner' });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id, { name: 'ClientId Atlas' });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('uses the provided clientId as the session id', async () => {
    const stable = randomUUID();
    const connected = await connect(server, atlas.id, token, stable);
    assert.equal(connected.sessionId, stable);
  });

  it('generates a session id when none is provided (back-compat)', async () => {
    const connected = await connect(server, atlas.id, token, null);
    assert.ok(connected.sessionId && connected.sessionId.length > 0);
  });
});

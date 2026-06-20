// Path: tests/ws/collab-heartbeat-gaps.test.js
// ws-11: the server-initiated heartbeat reap. Each sweep terminates sockets that
// did not pong since the previous sweep (isAlive=false), otherwise flips isAlive
// to false; a client `ping` re-arms it. Driven deterministically via the exported
// heartbeatSweep (the 30s interval is too slow / frozen to test through).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket, heartbeatSweep } from '../../src/modules/collab/collab.gateway.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls until the client socket is CLOSING(2)/CLOSED(3), or times out.
async function waitClosed(client, timeoutMs = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (client.ws.readyState >= 2) return true;
    await sleep(20);
  }
  return false;
}

describe('WebSocket heartbeat reap (ws-11)', () => {
  let app, db, server, wss, owner, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    wss = attachWebSocket(server); // returns the live WebSocketServer for tests
    await new Promise((resolve) => server.listen(0, resolve));

    owner = await createUser(db, { username: `gap_hb_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  it('reaps a socket that never pongs (two sweeps -> terminate)', async () => {
    const victim = await createWsClient(server, atlas.id, token);
    await victim.waitForType('connected');

    heartbeatSweep(wss); // sweep 1: isAlive true -> false
    heartbeatSweep(wss); // sweep 2: isAlive false -> terminate()

    assert.equal(await waitClosed(victim), true, 'un-ponged socket must be terminated by the server');
    victim.close();
  });

  it('a client ping between sweeps prevents the reap (socket stays open)', async () => {
    const alive = await createWsClient(server, atlas.id, token);
    await alive.waitForType('connected');

    heartbeatSweep(wss);          // isAlive -> false
    alive.send({ type: 'ping' }); // server handlePing sets isAlive=true and replies pong
    await alive.waitForType('pong');
    heartbeatSweep(wss);          // isAlive true -> flipped to false (NOT terminated)

    await sleep(150);
    assert.equal(alive.ws.readyState, 1, 'a pinging socket must survive the sweep (OPEN)');
    alive.close();
  });
});

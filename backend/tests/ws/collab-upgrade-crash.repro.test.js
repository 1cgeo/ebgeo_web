// Path: tests/ws/collab-upgrade-crash.repro.test.js
// Regression for the collab upgrade handler crashing the whole process.
//
// Root cause: Node removes its own 'error' listener from the socket before emitting
// 'upgrade' (_http_server.js does `socket.removeListener('error', socketOnError)` on
// the upgrade path). The collab handler then performs TWO awaited DB round-trips
// (orgIsActive, resolvePermission) before calling wss.handleUpgrade, without ever
// installing an 'error' listener of its own. An 'error' emitted on an EventEmitter
// with no listener is thrown as an uncaught exception, and the surrounding try/catch
// cannot catch it because the emission is asynchronous. There is no
// process.on('uncaughtException') anywhere in the package, so the process dies.
//
// Impact: any authenticated client whose TCP connection resets during that window
// (ordinary flaky mobile network hitting the ws-client reconnect backoff) takes the
// backend down for EVERYONE, since the frontend boot is fail-fast on GET /api/config.
//
// The test captures uncaughtException instead of letting it kill the runner, so the
// failure is a clean assertion rather than a dead process. Negative control: revert
// the socket.on('error') in collab.gateway.js and this test fails with ECONNRESET.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { randomBytes, randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas, loginUser } from '../helpers/fixtures.js';
import { createWsClient } from '../helpers/ws-client.js';
import { attachWebSocket } from '../../src/modules/collab/collab.gateway.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('collab upgrade: client RST during the authorization window (repro)', () => {
  let app, db, server, port, owner, token, atlas;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;
    server = createServer(app);
    attachWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;

    owner = await createUser(db, { username: `rst_${randomUUID().slice(0, 8)}` });
    token = await loginUser(app, owner.username, owner.password);
    atlas = await createAtlas(db, owner.id);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await teardownTestEnv(db);
  });

  /**
   * Opens a raw TCP connection, sends a well-formed collab upgrade request (valid
   * JWT, so it reaches the awaited DB calls) and then hard-resets the connection
   * after `delayMs`, landing inside the authorization window.
   */
  const upgradeThenReset = (delayMs) => new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1', () => {
      const key = randomBytes(16).toString('base64');
      sock.write(
        `GET /api/v1/collab?atlasId=${atlas.id}&token=${token} HTTP/1.1\r\n`
        + `Host: 127.0.0.1:${port}\r\n`
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Key: ${key}\r\n`
        + 'Sec-WebSocket-Version: 13\r\n'
        + '\r\n'
      );
      setTimeout(() => {
        // RST (not FIN): this is what makes the peer socket emit 'error' ECONNRESET.
        sock.resetAndDestroy();
        resolve();
      }, delayMs);
    });
    // The reset is the point of the test; errors on our own client side are expected.
    sock.on('error', () => resolve());
  });

  it('does not crash the process, and the gateway keeps serving afterwards', async () => {
    const captured = [];
    const onUncaught = (err) => captured.push(err);
    process.on('uncaughtException', onUncaught);

    try {
      // Sweep the delay across the window: the two DB round-trips take a few ms, so
      // a spread of offsets makes hitting the gap reliable instead of lucky.
      for (const delay of [0, 0, 1, 1, 2, 2, 3, 3, 5, 5, 8, 8]) {
        await upgradeThenReset(delay);
      }
      // Give any asynchronously emitted 'error' time to surface as uncaught.
      await sleep(300);
    } finally {
      process.off('uncaughtException', onUncaught);
    }

    assert.deepEqual(
      captured.map((e) => e.code ?? e.message),
      [],
      'a client reset during the upgrade authorization window must not raise an uncaught exception'
    );

    // The process surviving is only half of it: the gateway must still be healthy.
    const client = await createWsClient(server, atlas.id, token);
    const connected = await client.waitForType('connected');
    assert.ok(connected, 'a normal client still completes the handshake after the resets');
    client.close();
  });
});

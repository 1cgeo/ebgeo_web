// Path: tests/integration/assets3d-semaphore-leak.repro.test.js
// Regression (bugs-backend #15 / #24 — same structural defect): the semaphore
// permit that bounds the in-heap SQLite BLOB path leaked whenever `res` closed
// between `await sem.acquire()` and the registration of the release listeners.
//
// serveAsset used to do `await sem.acquire()` FIRST and only then
// `res.on('finish'|'close', release)`. That await is exactly the contention
// window: with every permit taken, `acquire()` parks the resolve in the
// semaphore queue (utils/semaphore.js:13) for an unbounded time. A client that
// aborts while parked makes `res` emit 'close' right there, with no listener —
// and the event is never replayed. When a permit is finally handed over, the
// listeners are attached to a corpse: `res.end(buf)` on a destroyed socket
// returns early inside `_writeRaw` without emitting 'finish' either. Neither
// event ever fires, `release()` never runs, and `active` stays incremented.
//
// `createSemaphore` has no timeout and no watchdog, and `release()` hands the
// slot straight to the next waiter without decrementing `active`, so each lost
// event burns one slot permanently. After `maxInflight` occurrences (default 8,
// ASSETS_3D_MAX_INFLIGHT) every later request parks in `acquire()` for good:
// no 429, no 503, no log and no timeout — 3D tiles simply stop loading while
// /health stays green (it checks the Postgres pool, not this semaphore). The
// route is public and unauthenticated, and Cesium mass-cancels tile requests on
// every camera move, so "abort while queued" is the common case, not the rare
// one.
//
// The suite runs with ASSETS_3D_MAX_INFLIGHT=1 so a single leak is fatal and
// the proof needs no repetition. Contention is produced by the test itself
// taking the permit from the exported semaphore instead of by a slow client:
// backpressure cannot hold a response open on Windows (libuv completes the
// write into the kernel buffer, so 'finish' fires while the peer has read only
// 64 KB), which would make a client-timing repro silently vacuous.
//
// Negative control (run): move the two `res.on(...)` registrations back below
// `await sem.acquire()` in assets3d.controller.js and both tests fail — the
// first on its last assertion (the route never answers again, 8 s deadline),
// the second as the downstream proof that the capacity never comes back.
//
// NOTE: sv360.controller.js:158 (`getPhotoImage`) has the identical
// acquire-then-attach construction on its own semaphore and the identical
// defect. It is outside the edit scope of this change and is NOT covered here.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

// The semaphore is built at module load from config, and the store resolves its
// path from env at module load too — so both env vars must be set BEFORE the
// app (and its config) is imported. Static ESM imports are hoisted, hence the
// dynamic imports below.
const RID = crypto.randomUUID().slice(0, 8);
const SQLITE = resolve(`./data/test-assets3d-semleak-${RID}.sqlite`);
process.env.ASSETS_3D_SQLITE = SQLITE;
process.env.ASSETS_3D_MAX_INFLIGHT = '1';

const { setupTestEnv, teardownTestEnv } = await import('../helpers/setup.js');
const supertest = (await import('supertest')).default;
const store = await import('../../src/modules/nomes/assets3d.store.js');
// Same module instance the route uses (ESM cache), so acquiring here really
// starves the handler.
const { sem } = await import('../../src/modules/nomes/assets3d.controller.js');

const BODY = Buffer.from('semaphore-leak-asset-body');

/** Raw HTTP GET whose socket the test can destroy mid-request. */
function rawGet(port, path) {
  const socket = net.connect(port, '127.0.0.1');
  const state = { bytes: 0, gotBytes: false };
  socket.on('data', (chunk) => {
    state.bytes += chunk.length;
    state.gotBytes = true;
  });
  socket.on('error', () => {}); // an aborted socket must not throw
  const sent = once(socket, 'connect').then(() => {
    socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  });
  return { socket, state, sent };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rejects instead of hanging forever, which is precisely the bug's symptom. */
function withDeadline(promise, ms, what) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then((v) => {
      clearTimeout(timer);
      return v;
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms);
    }),
  ]);
}

async function cleanupStore() {
  await store.closeStore(); // closes read conn + worker threads (frees the file)
  for (const f of [SQLITE, `${SQLITE}-wal`, `${SQLITE}-shm`, `${SQLITE}-journal`]) {
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

describe('3D assets — an aborted client must not leak the BLOB semaphore permit', () => {
  let app, db, server, port;

  before(async () => {
    const env = await setupTestEnv();
    app = env.app;
    db = env.db;

    await cleanupStore();
    const w = store.openWritable();
    store.putAsset(w, 'semleak/asset.bin', BODY, 'application/octet-stream');
    w.close();

    // A real listening server: supertest cannot abort a socket mid-request.
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await cleanupStore();
    await teardownTestEnv(db);
  });

  it('a client that aborts while queued must not burn the permit', async () => {
    // 1) Occupy the only permit, exactly as an in-flight download would.
    await sem.acquire();

    // 2) This request reaches `await sem.acquire()` and parks there.
    const queued = rawGet(port, '/api/v1/assets3d/semleak/asset.bin');
    await queued.sent;
    await sleep(400);
    assert.equal(
      queued.state.gotBytes,
      false,
      'precondition: the request is parked in the semaphore queue (nothing sent back yet)'
    );

    // 3) Abort while queued: `res` emits 'close' inside the acquire window.
    queued.socket.destroy();
    await sleep(200);

    // 4) Release: the slot is handed to the parked waiter, whose handler now
    //    resumes against a destroyed response.
    sem.release();
    await sleep(400);

    // 5) The permit must be back in the pool. Without the fix `active` is stuck
    //    at 1 == maxInflight and this request parks forever: no response, no
    //    error, no timeout of its own.
    const res = await withDeadline(
      supertest(app).get('/api/v1/assets3d/semleak/asset.bin'),
      8000,
      'the route is hung — the aborted client leaked the only semaphore permit'
    );
    assert.equal(res.status, 200);
    assert.equal(Buffer.from(res.body).toString(), BODY.toString());
  });

  it('an abort during the read still releases, and a normal request still does', async () => {
    // Same window, later edge: the client dies AFTER the permit was granted
    // (during the BLOB read). This path was already handled before the fix by
    // the 'close' listener; it is asserted here so the reordering does not
    // regress it. In the negative control it fails too, because the permit
    // burned by the previous test never came back — which is the ratchet.
    const inflight = rawGet(port, '/api/v1/assets3d/semleak/asset.bin');
    await inflight.sent;
    inflight.socket.destroy();
    await sleep(300);

    const res = await withDeadline(
      supertest(app).get('/api/v1/assets3d/semleak/asset.bin'),
      8000,
      'the route is hung after an abort during the read'
    );
    assert.equal(res.status, 200);
  });
});

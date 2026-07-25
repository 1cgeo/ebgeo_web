// Path: tests/unit/sqlite-blob-pool.test.js
// P5 — a worker that dies is dropped and replaced, and only ITS requests fail.
//
// Before this, a worker that emitted 'error' (Node terminates it) stayed in
// `this.workers`. Round-robin kept posting ~1/N of all reads to a dead thread,
// where `postMessage` silently no-ops — so those promises stayed pending FOREVER
// (there is no request timeout). The same handler also rejected the in-flight
// requests of every OTHER, perfectly healthy, worker.

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteBlobPool } from '../../src/utils/sqlite-blob-pool.js';

// A pool of 2 makes "one dies, the other must survive" observable.
const POOL_SIZE = 2;

// Fails (instead of hanging the whole suite) when a promise never settles — the
// failure mode these tests are about.
function withTimeout(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${message}`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

const sleep = (ms) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

describe('SqliteBlobPool — dead worker handling (P5)', () => {
  let pool;

  afterEach(async () => {
    if (pool) await pool.closeAll().catch(() => {});
    pool = null;
  });

  /** Forces the pool to spawn, returning its worker array. */
  function spawnedWorkers(p) {
    p._ensure();
    return p.workers;
  }

  it('replaces a dead worker so the pool keeps its configured size', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const workers = spawnedWorkers(pool);
    assert.equal(workers.length, POOL_SIZE);
    const dead = workers[0];

    // Node emits 'error' on a worker it is tearing down; drive that path directly.
    dead.emit('error', new Error('worker exploded'));

    assert.equal(pool.workers.length, POOL_SIZE, 'pool must be replenished');
    assert.ok(!pool.workers.includes(dead), 'the dead worker must be evicted from rotation');
  });

  it('rejects ONLY the dead worker\'s in-flight requests', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const workers = spawnedWorkers(pool);
    const [w0, w1] = workers;

    // Two in-flight requests, one owned by each worker. They are registered
    // directly so the test does not depend on a real SQLite file.
    let survivorSettled = false;
    const victim = new Promise((resolve, reject) => {
      pool.pending.set(101, { resolve, reject, worker: w0 });
    });
    const survivor = new Promise((resolve, reject) => {
      pool.pending.set(102, {
        resolve: (v) => { survivorSettled = true; resolve(v); },
        reject: (e) => { survivorSettled = true; reject(e); },
        worker: w1,
      });
    });
    survivor.catch(() => {}); // avoid an unhandled rejection if the guard fails

    w0.emit('error', new Error('worker exploded'));

    await assert.rejects(victim, /worker exploded/, "the dead worker's request must fail");
    assert.equal(survivorSettled, false, "a healthy worker's request must NOT be collateral");
    assert.ok(pool.pending.has(102), 'the survivor stays in flight');
  });

  it('does not leave a pending evict hanging when a worker dies mid-evict', async () => {
    // evict() waits for one confirmation per worker. A worker that dies will never
    // confirm, so without accounting for it the promise would never resolve.
    //
    // The dead worker must really be UNABLE to confirm, or this test does not
    // discriminate: emit('error') alone only synthesizes the event on the Worker
    // OBJECT — the underlying thread stays alive, processes the {type:'evict'}
    // already posted to it and ACKs on the HEALTHY path, so the evict resolved with
    // or without the guard in _replaceWorker (achado 60). Dropping the pool's
    // 'message' listener makes the pool DEAF to that worker (a terminated thread
    // likewise never posts back; terminate() cannot be used here because Node clears
    // a Worker's listeners on exit, taking the pool's 'error' handler with them).
    // _settleEvict(evictId, dead) is then the ONLY way the pending Set can empty.
    pool = new SqliteBlobPool(POOL_SIZE);
    const workers = spawnedWorkers(pool);
    workers[0].removeAllListeners('message');

    const evicting = pool.evict('/tmp/does-not-matter.db');
    const evictId = [...pool.evicts.keys()][0];
    assert.equal(
      pool.evicts.get(evictId).pending.size,
      POOL_SIZE,
      'both workers start out pending (the terminated one can never ACK)'
    );

    workers[0].emit('error', new Error('died mid-evict')); // Node's teardown signal

    // Resolves (rather than hanging) — the assertion is that this await returns.
    await withTimeout(evicting, 3000, 'evict must not hang on a dead worker');
    assert.equal(pool.evicts.size, 0, 'the evict bookkeeping must be cleared');
  });

  it('a replaced worker still serves subsequent reads (round-robin stays valid)', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const workers = spawnedWorkers(pool);
    workers[0].emit('error', new Error('worker exploded'));

    // Every slot must hold a live worker, or round-robin would post into the void.
    assert.equal(pool.workers.length, POOL_SIZE, 'the pool still holds every slot');
    for (const w of pool.workers) {
      assert.ok(w, 'no empty slot in the pool');
      assert.equal(typeof w.postMessage, 'function');
    }
  });
});

// Achado 59/61 — evict() alone only promises an INSTANT with no open handle, not
// an INTERVAL: a read dispatched between the evict and the caller's rename makes
// the worker REOPEN and recache the file (sqlite-blob-worker conn()), so the
// atomic swap fails EBUSY/EPERM on Windows. withEvicted() must hold the whole
// window: quarantine the dbPath, evict, run the critical section, release.
describe('SqliteBlobPool — withEvicted holds the swap window (achado 59/61)', () => {
  const SQL = 'SELECT full_webp FROM images WHERE photo_id = ?';
  let pool;
  let tmpDir;

  function makeDb(name) {
    const p = path.join(tmpDir, name);
    const db = new Database(p);
    db.exec('CREATE TABLE images (photo_id TEXT PRIMARY KEY, full_webp BLOB, preview_webp BLOB)');
    db.prepare('INSERT INTO images VALUES (?,?,?)').run(
      'p1',
      Buffer.from('RIFFxxxxWEBP-full'),
      Buffer.from('RIFFxxxxWEBP-prev')
    );
    db.close();
    return p;
  }

  // Makes EVERY worker hold a cached readonly handle to dbPath (round-robin means
  // any of them may be the one that reopens it during the window).
  async function warmAllWorkers(p, dbPath) {
    for (let i = 0; i < p.size * 2; i++) {
      assert.ok(await p.read(dbPath, SQL, ['p1']), 'the fixture row must be readable');
    }
  }

  before(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'blobpool-quarantine-'));
  });

  afterEach(async () => {
    if (pool) await pool.closeAll().catch(() => {});
    pool = null;
  });

  after(() => {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defers a concurrent read for the whole window and lets the rename succeed', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const dbPath = makeDb('quarantine-a.db');
    await warmAllWorkers(pool, dbPath);

    let settled = false;
    let deferred;

    await pool.withEvicted(dbPath, async () => {
      deferred = pool.read(dbPath, SQL, ['p1']).then((v) => {
        settled = true;
        return v;
      });
      await sleep(60); // plenty of event-loop turns for a dispatch to happen

      assert.equal(settled, false, 'the read must NOT run while the path is in swap');
      assert.equal(pool.pending.size, 0, 'nothing may be dispatched to a worker inside the window');

      // The invariant the window exists for: with no handle open (and none able to
      // reopen), the atomic rename the swap depends on succeeds. On Windows this
      // throws EBUSY/EPERM the moment a worker reopened the file.
      renameSync(dbPath, dbPath + '.bak');
      renameSync(dbPath + '.bak', dbPath);
    });

    assert.ok(
      await withTimeout(deferred, 3000, 'the deferred read must resolve once released'),
      'the read resolves normally after the window closes'
    );
  });

  it('does not block reads of OTHER dbPaths during a quarantine', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const held = makeDb('quarantine-held.db');
    const other = makeDb('quarantine-other.db');
    await warmAllWorkers(pool, other);

    await pool.withEvicted(held, async () => {
      const v = await withTimeout(
        pool.read(other, SQL, ['p1']),
        3000,
        'an unrelated dbPath must stay readable during a swap'
      );
      assert.ok(v, 'the unrelated read is served normally');
    });
  });

  it('releases the window even when the critical section throws', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const dbPath = makeDb('quarantine-throw.db');
    await warmAllWorkers(pool, dbPath);

    await assert.rejects(
      pool.withEvicted(dbPath, async () => {
        throw new Error('rename blew up');
      }),
      /rename blew up/
    );

    const v = await withTimeout(
      pool.read(dbPath, SQL, ['p1']),
      3000,
      'a failed swap must not wedge the dbPath forever'
    );
    assert.ok(v, 'reads resume after a failed critical section');
  });

  it('closeAll releases waiters instead of leaving them pending forever', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const dbPath = makeDb('quarantine-close.db');
    await warmAllWorkers(pool, dbPath);

    let deferred;
    await pool.withEvicted(dbPath, async () => {
      deferred = pool.read(dbPath, SQL, ['p1']);
      deferred.catch(() => {}); // either outcome is fine; hanging is not
      await pool.closeAll();
    });

    await withTimeout(
      deferred.catch(() => 'rejected'),
      3000,
      'closeAll must not strand a quarantined read'
    );
  });
});

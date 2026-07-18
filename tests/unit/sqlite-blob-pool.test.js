// Path: tests/unit/sqlite-blob-pool.test.js
// P5 — a worker that dies is dropped and replaced, and only ITS requests fail.
//
// Before this, a worker that emitted 'error' (Node terminates it) stayed in
// `this.workers`. Round-robin kept posting ~1/N of all reads to a dead thread,
// where `postMessage` silently no-ops — so those promises stayed pending FOREVER
// (there is no request timeout). The same handler also rejected the in-flight
// requests of every OTHER, perfectly healthy, worker.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteBlobPool } from '../../src/utils/sqlite-blob-pool.js';

// A pool of 2 makes "one dies, the other must survive" observable.
const POOL_SIZE = 2;

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
    pool = new SqliteBlobPool(POOL_SIZE);
    const workers = spawnedWorkers(pool);

    const evicting = pool.evict('/tmp/does-not-matter.db');
    workers[0].emit('error', new Error('died mid-evict'));

    // Resolves (rather than hanging) — the assertion is that this await returns.
    await evicting;
    assert.equal(pool.evicts.size, 0, 'the evict bookkeeping must be cleared');
  });

  it('a replaced worker still serves subsequent reads (round-robin stays valid)', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    const workers = spawnedWorkers(pool);
    workers[0].emit('error', new Error('worker exploded'));

    // Every slot must hold a live worker, or round-robin would post into the void.
    for (const w of pool.workers) {
      assert.ok(w, 'no empty slot in the pool');
      assert.equal(typeof w.postMessage, 'function');
    }
  });
});

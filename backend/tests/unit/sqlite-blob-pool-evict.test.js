// Path: tests/unit/sqlite-blob-pool-evict.test.js
// Item 144 (testes-backend.md) — evict() bookkeeping must be IDEMPOTENT PER WORKER.
//
// sqlite-blob-pool.js:63-72 records the outstanding workers of an evict as a Set
// precisely because the earlier counter double-counted a worker that ACKed and THEN
// died: once via the 'evicted' message, once via _replaceWorker. The evict then
// resolved while ANOTHER worker still held the SQLite handle — right before an atomic
// rename, which on Windows becomes EBUSY/EPERM, or worse, replaces a {slug}.db that
// is open mid-ingestion (swap-then-commit).
//
// sqlite-blob-pool.test.js covers the worker that dies WITHOUT acking, and the old
// counter handled that case correctly too — so that test passes with and without the
// fix, which is the definition of a test that does not hold.
//
// The pool is made DEAF (removeAllListeners('message')) so real worker ACKs cannot
// race the test: _settleEvict is then the ONLY path that can empty the pending set.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteBlobPool } from '../../src/utils/sqlite-blob-pool.js';

const POOL_SIZE = 2;

function withTimeout(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${message}`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** Resolves after a few event-loop turns, so a premature resolution is observable. */
const settleTurns = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
};

describe('SqliteBlobPool.evict — one worker, one confirmation (idempotent per worker)', () => {
  let pool;

  afterEach(async () => {
    if (pool) await pool.closeAll().catch(() => {});
    pool = null;
  });

  it('an ACK followed by the DEATH of the SAME worker does not complete the evict', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    pool._ensure();
    for (const w of pool.workers) w.removeAllListeners('message');
    const [w0, w1] = pool.workers;

    let resolved = false;
    const evicting = pool.evict('/tmp/blobpool-evict-idem.db').then(() => {
      resolved = true;
    });

    const evictId = [...pool.evicts.keys()][0];
    assert.equal(pool.evicts.get(evictId).pending.size, POOL_SIZE, 'both workers start pending');

    // 1. w0 confirms.
    pool._settleEvict(evictId, w0);
    await settleTurns();
    assert.equal(resolved, false, 'w1 still holds the handle — the evict must NOT be done');
    assert.equal(pool.evicts.get(evictId).pending.size, 1);

    // 2. w0 then dies. With a numeric counter this second decrement would empty it
    //    and resolve the evict while w1 still holds the file open. THIS is the
    //    assertion the Set exists for.
    pool._replaceWorker(w0, new Error('died after acking'));
    await settleTurns();
    assert.equal(resolved, false, 'a dead worker that already acked must not count twice');
    assert.equal(pool.evicts.get(evictId).pending.size, 1, 'w1 is still outstanding');

    // 3. w1 confirms — now, and only now, the window is really clear.
    pool._settleEvict(evictId, w1);
    await withTimeout(evicting, 3000, 'the evict must resolve once every worker confirmed');
    assert.equal(resolved, true);
    assert.equal(pool.evicts.size, 0, 'the bookkeeping is cleared');
  });

  it('a DUPLICATE ack from the same worker is likewise ignored', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    pool._ensure();
    for (const w of pool.workers) w.removeAllListeners('message');
    const [w0, w1] = pool.workers;

    let resolved = false;
    const evicting = pool.evict('/tmp/blobpool-evict-dup.db').then(() => {
      resolved = true;
    });
    const evictId = [...pool.evicts.keys()][0];

    pool._settleEvict(evictId, w0);
    pool._settleEvict(evictId, w0);
    pool._settleEvict(evictId, w0);
    await settleTurns();
    assert.equal(resolved, false, 'three acks from one worker are still one worker');

    pool._settleEvict(evictId, w1);
    await withTimeout(evicting, 3000, 'evict resolves after the real second confirmation');
  });

  it('evict() BEFORE any spawn resolves immediately and posts nothing', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    assert.equal(pool.workers.length, 0, 'the pool is lazy — nothing spawned yet');

    await withTimeout(pool.evict('/tmp/never-opened.db'), 1000, 'evict with no workers must resolve at once');
    assert.equal(pool.evicts.size, 0, 'and it must not register bookkeeping to be settled later');
    assert.equal(pool.workers.length, 0, 'evict must not spawn the pool as a side effect');
  });

  it('closeAll() resolves an in-flight evict and rejects the pending reads', async () => {
    pool = new SqliteBlobPool(POOL_SIZE);
    pool._ensure();
    for (const w of pool.workers) w.removeAllListeners('message');

    const evicting = pool.evict('/tmp/blobpool-evict-close.db');
    const pendingRead = new Promise((resolve, reject) => {
      pool.pending.set(9001, { resolve, reject, worker: pool.workers[0] });
    });
    pendingRead.catch(() => {}); // rejection is the expected outcome

    await pool.closeAll();

    await withTimeout(evicting, 3000, 'closeAll must not strand an in-flight evict');
    await assert.rejects(pendingRead, /pool closing/, 'pending reads are failed, never left hanging');
    assert.equal(pool.evicts.size, 0);
    assert.equal(pool.pending.size, 0);
    pool = null; // already closed
  });
});

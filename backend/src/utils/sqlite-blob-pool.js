// Path: src/utils/sqlite-blob-pool.js
// Pool of worker threads that read BLOBs from SQLite off the main event loop.
// Generic over dbPath, so it serves both the 3D asset store and (Fase 9) the
// per-project {slug}.db of the 360. Lazy spawn; workers are unref'd.
import { Worker } from 'node:worker_threads';
import os from 'node:os';

const WORKER_URL = new URL('./sqlite-blob-worker.js', import.meta.url);

export class SqliteBlobPool {
  constructor(size) {
    this.size = Math.max(1, size);
    this.workers = [];
    this.pending = new Map();
    this.evicts = new Map(); // evictId -> { remaining, resolve }
    this.nextId = 1;
    this.nextEvictId = 1;
    this.rr = 0;
  }

  _ensure() {
    if (this.workers.length) return;
    for (let i = 0; i < this.size; i++) {
      this.workers.push(this._spawn());
    }
  }

  /**
   * Creates one pool worker with its lifecycle handlers attached.
   *
   * A worker that emits 'error' is terminated by Node. Previously it stayed in
   * `this.workers`, so round-robin kept posting ~1/N of all reads to a dead
   * thread — `postMessage` silently no-ops there, leaving those promises pending
   * FOREVER (there is no request timeout). The same handler also rejected the
   * in-flight requests of every OTHER (healthy) worker. Now the dead worker is
   * dropped and replaced, and only its own requests are failed.
   */
  _spawn() {
    const w = new Worker(WORKER_URL);

    w.on('message', (msg) => {
      if (msg.type === 'closed') return;
      if (msg.type === 'evicted') {
        this._settleEvict(msg.evictId);
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(msg.data ? Buffer.from(msg.data) : null);
    });

    w.on('error', (err) => this._replaceWorker(w, err));

    w.unref(); // never keep the process alive
    return w;
  }

  /** Counts one confirmation toward an in-flight evict, resolving it when complete. */
  _settleEvict(evictId) {
    const e = this.evicts.get(evictId);
    if (!e) return;
    e.remaining -= 1;
    if (e.remaining <= 0) {
      this.evicts.delete(evictId);
      e.resolve();
    }
  }

  /**
   * Drops a dead worker, rejects ONLY the requests it owned, and spawns a
   * replacement so the pool keeps its configured size.
   */
  _replaceWorker(dead, err) {
    const idx = this.workers.indexOf(dead);
    if (idx === -1) return; // already replaced, or the pool is closing

    // Reject only this worker's in-flight requests — its peers are healthy.
    for (const [id, p] of this.pending) {
      if (p.worker === dead) {
        this.pending.delete(id);
        p.reject(err);
      }
    }

    // A dead worker will never confirm a pending evict; count it as done so
    // `evict()` cannot hang waiting on a thread that no longer exists.
    for (const evictId of [...this.evicts.keys()]) this._settleEvict(evictId);

    this.workers[idx] = this._spawn();
  }

  /**
   * @param {string} dbPath - readonly SQLite file
   * @param {string} sql - SELECT of exactly one BLOB column, with placeholders
   * @param {Array} params
   * @returns {Promise<Buffer|null>}
   */
  read(dbPath, sql, params) {
    this._ensure();
    const id = this.nextId++;
    const worker = this.workers[this.rr++ % this.workers.length];
    return new Promise((resolve, reject) => {
      // `worker` is recorded so a crash fails exactly this request's owner set
      // (see _replaceWorker) instead of every in-flight read in the pool.
      this.pending.set(id, { resolve, reject, worker });
      worker.postMessage({ id, dbPath, sql, params });
    });
  }

  /**
   * Surgically closes the cached readonly connection to `dbPath` on EVERY worker
   * (each worker may hold it, given round-robin), WITHOUT tearing down the pool or
   * touching other dbPaths. Required before an atomic rename over an open SQLite
   * file on Windows (rename over an open handle → EBUSY/EPERM). Resolves once all
   * workers have confirmed ('evicted'). If the pool has not spawned yet, there is
   * nothing to evict → resolves immediately.
   * @param {string} dbPath - the {slug}.db (or any db) to release everywhere
   * @returns {Promise<void>}
   */
  evict(dbPath) {
    if (!this.workers.length) return Promise.resolve();
    const evictId = this.nextEvictId++;
    return new Promise((resolve) => {
      this.evicts.set(evictId, { remaining: this.workers.length, resolve });
      for (const w of this.workers) w.postMessage({ type: 'evict', evictId, dbPath });
    });
  }

  /** Terminates all workers (releasing their SQLite file handles). */
  async closeAll() {
    const workers = this.workers;
    this.workers = [];
    for (const [, p] of this.pending) p.reject(new Error('pool closing'));
    this.pending.clear();
    // Any in-flight evict resolves (the handles are released by terminate anyway).
    for (const [, e] of this.evicts) e.resolve();
    this.evicts.clear();
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

const size = Number(process.env.SQLITE_BLOB_WORKERS) || Math.min(4, Math.max(1, os.cpus().length - 1));
export const blobPool = new SqliteBlobPool(size);

/** Convenience binding of blobPool.evict (closes a single dbPath everywhere). */
export const evict = (dbPath) => blobPool.evict(dbPath);

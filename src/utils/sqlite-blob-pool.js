// Path: src/utils/sqlite-blob-pool.js
// Pool of worker threads that read BLOBs from SQLite off the main event loop.
// Generic over dbPath, so it serves both the 3D asset store and (Fase 9) the
// per-project {slug}.db of the 360. Lazy spawn; workers are unref'd.
import { Worker } from 'node:worker_threads';
import os from 'node:os';

const WORKER_URL = new URL('./sqlite-blob-worker.js', import.meta.url);

class SqliteBlobPool {
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
      const w = new Worker(WORKER_URL);
      w.on('message', (msg) => {
        if (msg.type === 'closed') return;
        if (msg.type === 'evicted') {
          const e = this.evicts.get(msg.evictId);
          if (!e) return;
          e.remaining -= 1;
          if (e.remaining <= 0) {
            this.evicts.delete(msg.evictId);
            e.resolve();
          }
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.data ? Buffer.from(msg.data) : null);
      });
      w.on('error', (err) => {
        // Fail any in-flight requests; the worker is gone.
        for (const [, p] of this.pending) p.reject(err);
        this.pending.clear();
      });
      w.unref(); // never keep the process alive
      this.workers.push(w);
    }
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
      this.pending.set(id, { resolve, reject });
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

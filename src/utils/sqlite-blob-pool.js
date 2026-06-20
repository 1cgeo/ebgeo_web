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
    this.nextId = 1;
    this.rr = 0;
  }

  _ensure() {
    if (this.workers.length) return;
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(WORKER_URL);
      w.on('message', (msg) => {
        if (msg.type === 'closed') return;
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

  /** Terminates all workers (releasing their SQLite file handles). */
  async closeAll() {
    const workers = this.workers;
    this.workers = [];
    for (const [, p] of this.pending) p.reject(new Error('pool closing'));
    this.pending.clear();
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

const size = Number(process.env.SQLITE_BLOB_WORKERS) || Math.min(4, Math.max(1, os.cpus().length - 1));
export const blobPool = new SqliteBlobPool(size);

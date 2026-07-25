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
    this.evicts = new Map(); // evictId -> { pending: Set<Worker>, resolve }
    // dbPath -> { depth, released: Promise<void>, release } — see withEvicted().
    this.quarantine = new Map();
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
        this._settleEvict(msg.evictId, w);
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
  _settleEvict(evictId, worker) {
    const e = this.evicts.get(evictId);
    if (!e) return;
    // Idempotente por worker: um ack duplicado (ou um ack seguido da morte do
    // mesmo worker) não pode adiantar a conclusão.
    e.pending.delete(worker);
    if (e.pending.size === 0) {
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

    // Um worker morto nunca confirmará um evict pendente; retira-o do conjunto
    // para que `evict()` não espere por uma thread que não existe mais.
    for (const evictId of [...this.evicts.keys()]) this._settleEvict(evictId, dead);

    this.workers[idx] = this._spawn();
  }

  /**
   * @param {string} dbPath - readonly SQLite file
   * @param {string} sql - SELECT of exactly one BLOB column, with placeholders
   * @param {Array} params
   * @returns {Promise<Buffer|null>}
   */
  read(dbPath, sql, params) {
    // A dbPath held by withEvicted() is mid-swap: dispatching now would make the
    // worker REOPEN the file (conn() recaches) right under the caller's rename.
    // Defer instead of reopening — the window is a couple of syscalls long.
    const held = this.quarantine.get(dbPath);
    if (held) return held.released.then(() => this.read(dbPath, sql, params));

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
   *
   * It guarantees an INSTANT with no open handle, NOT an interval: the very next
   * read reopens the file. A caller that then renames/removes the file must use
   * withEvicted(), which holds the whole window.
   * @param {string} dbPath - the {slug}.db (or any db) to release everywhere
   * @returns {Promise<void>}
   */
  evict(dbPath) {
    if (!this.workers.length) return Promise.resolve();
    const evictId = this.nextEvictId++;
    return new Promise((resolve) => {
      // Conjunto de workers PENDENTES (não um contador): um worker que acka e
      // depois morre era contado DUAS vezes — uma pelo ack, outra pelo
      // _replaceWorker — e o evict resolvia com outro worker ainda segurando o
      // handle SQLite, justo antes de um rename atômico.
      this.evicts.set(evictId, { pending: new Set(this.workers), resolve });
      for (const w of this.workers) w.postMessage({ type: 'evict', evictId, dbPath });
    });
  }

  /**
   * Resolves once `dbPath` is not being swapped, i.e. once no withEvicted() window
   * holds it. Callers that touch the FILE directly before reading (an existsSync
   * probe, a stat) use this so they do not observe the mid-swap instant in which
   * the destination briefly does not exist. No-op (already-resolved) when free.
   * @param {string} dbPath
   * @returns {Promise<void>}
   */
  whenAvailable(dbPath) {
    const held = this.quarantine.get(dbPath);
    return held ? held.released.then(() => this.whenAvailable(dbPath)) : Promise.resolve();
  }

  /**
   * Runs `fn` with `dbPath` GUARANTEED to have no open handle anywhere in the pool
   * — the exclusion evict() alone never provided (achado 59/61).
   *
   * evict() resolves at an INSTANT: any read dispatched between it and the caller's
   * rename makes a worker reopen and recache the file (sqlite-blob-worker conn()),
   * and the atomic rename then fails EBUSY/EPERM on Windows. Here the dbPath is
   * QUARANTINED first, so reads that arrive during the window are DEFERRED (not
   * rejected — an ingestion swap lasts a couple of syscalls) and can only be
   * dispatched after the window closes. Reads already posted to a worker are
   * unaffected: they sit ahead of the evict in that worker's FIFO, so the 'evicted'
   * ACK already implies they finished.
   *
   * Re-entrant per dbPath (depth-counted) and ALWAYS releases, including when `fn`
   * throws — a failed swap must not wedge the path forever.
   * @param {string} dbPath - the {slug}.db about to be renamed/removed
   * @param {() => (Promise<T>|T)} fn - the critical section (rename/rm)
   * @returns {Promise<T>} whatever `fn` returns
   */
  async withEvicted(dbPath, fn) {
    this._acquireQuarantine(dbPath);
    try {
      await this.evict(dbPath);
      return await fn();
    } finally {
      this._releaseQuarantine(dbPath);
    }
  }

  /** Marks dbPath as being swapped (re-entrant). */
  _acquireQuarantine(dbPath) {
    const held = this.quarantine.get(dbPath);
    if (held) {
      held.depth++;
      return;
    }
    let release;
    const released = new Promise((resolve) => {
      release = resolve;
    });
    this.quarantine.set(dbPath, { depth: 1, released, release });
  }

  /** Ends one swap window; the last one out wakes the deferred reads. */
  _releaseQuarantine(dbPath) {
    const held = this.quarantine.get(dbPath);
    if (!held) return; // already cleared (closeAll)
    if (--held.depth > 0) return;
    this.quarantine.delete(dbPath);
    held.release();
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
    // Ditto for swap windows: a deferred read must never outlive the pool it is
    // waiting on (it re-dispatches against a freshly spawned worker).
    for (const [, q] of this.quarantine) q.release();
    this.quarantine.clear();
    await Promise.all(workers.map((w) => w.terminate()));
  }
}

const size = Number(process.env.SQLITE_BLOB_WORKERS) || Math.min(4, Math.max(1, os.cpus().length - 1));
export const blobPool = new SqliteBlobPool(size);

/** Convenience binding of blobPool.evict (closes a single dbPath everywhere). */
export const evict = (dbPath) => blobPool.evict(dbPath);

// Path: src/utils/sqlite-blob-worker.js
// Worker thread: opens readonly SQLite connections (cached per dbPath) and runs
// a single-column BLOB SELECT off the main event loop. The result ArrayBuffer is
// transferred back (zero-copy on the main side).
import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';

const conns = new Map();

function conn(dbPath) {
  let db = conns.get(dbPath);
  if (!db) {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = true');
    db.pragma('mmap_size = 268435456'); // 256 MB
    conns.set(dbPath, db);
  }
  return db;
}

parentPort.on('message', (msg) => {
  if (msg.type === 'close') {
    for (const db of conns.values()) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    conns.clear();
    parentPort.postMessage({ type: 'closed' });
    return;
  }

  const { id, dbPath, sql, params } = msg;
  try {
    const row = conn(dbPath).prepare(sql).get(...params);
    const buf = row ? Object.values(row)[0] : null; // SQL selects exactly the BLOB column
    if (buf && Buffer.isBuffer(buf)) {
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      parentPort.postMessage({ id, data: ab }, [ab]); // transfer (zero-copy)
    } else {
      parentPort.postMessage({ id, data: null });
    }
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});

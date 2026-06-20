// Path: src/utils/semaphore.js
// Minimal async counting semaphore. Used to cap the number of in-heap BLOB
// buffers served concurrently (RSS protection for the SQLite asset path).
export function createSemaphore(max) {
  let active = 0;
  const queue = [];

  function acquire() {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => queue.push(resolve));
  }

  function release() {
    const next = queue.shift();
    if (next) {
      next(); // hand the slot directly to a waiter (active unchanged)
    } else {
      active--;
    }
  }

  return { acquire, release };
}

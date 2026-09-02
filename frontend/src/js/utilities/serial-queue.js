// Path: js/utilities/serial-queue.js

/**
 * @fileoverview Minimal serial task queue (pure, zero imports, node-testable).
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE GEOJSON DISPATCHER. A MapLibre GeoJSON
 * source is read with an ASYNCHRONOUS `getData()` (a round trip to the worker
 * that answers with a clone) and written with a synchronous `setData()`. Every
 * `getData -> mutate -> setData` therefore has a window in which a second caller
 * can read the pre-mutation clone and, when it writes, silently drop the first
 * caller's changes: last write wins, no error anywhere.
 *
 * `layers/geojson-dispatcher.js` already closes that window for the sources it
 * owns, by turning the write into a coalesced diff. The boundary tool's own
 * `boundarys` is one of those. Its TWO DERIVED sources are not, and cannot be:
 * `boundary-circles` and `boundary-texts` carry a stable TOP-LEVEL id
 * (`<parentId>-circle-<i>-<j>`) and `properties` WITHOUT any `id`, so the
 * `promoteId: 'id'` a diffable source needs would resolve every key to null.
 * They are declared without it (see `layers/styles/layer.helpers.js`) and every
 * writer of theirs still does a full read-modify-write. With several such call
 * sites on the same pair the losing interleaving is not rare, it is the normal
 * case on boot, where a restore pass and a zoom pass share a frame: the restore
 * of a map with N boundaries used to keep the labels of ONE of them.
 *
 * Running those read-modify-write cycles through one queue makes the pair atomic
 * with respect to each other. A `dispatcher.flush()` INSIDE a task is fine (it is
 * a different mechanism); a `run()` inside a task is not.
 *
 * REENTRANCY IS NOT SUPPORTED, and it deadlocks rather than warning: a task that
 * awaits `run()` waits for itself, because the chain only advances when the
 * current task settles. Split any serialized method into a public wrapper that
 * calls `run` and an internal `_xxxUnlocked` body, and let the internals call
 * only internals.
 */

/**
 * Create a queue that runs tasks one at a time, in call order.
 *
 * @returns {(task: () => (Promise<*>|*)) => Promise<*>} `run(task)`: schedules
 *   `task` after every task scheduled before it and resolves (or rejects) with
 *   its outcome. A rejected task never breaks the chain for the next one.
 */
export function createSerialQueue() {
    // Settled tail of the chain: it NEVER rejects, which is what keeps a failing
    // task from cancelling everything queued behind it.
    let tail = Promise.resolve();

    return function run(task) {
        // `then` (not `finally`) so a task that throws synchronously still
        // rejects the promise handed to the caller instead of the chain.
        const result = tail.then(() => task());
        tail = result.then(() => undefined, () => undefined);
        return result;
    };
}

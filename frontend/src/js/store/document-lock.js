// Path: js/store/document-lock.js

/**
 * @fileoverview Per-document write serialization for the store.
 *
 * Almost every store write is a read-modify-write of a WHOLE document:
 * `getMapDataCompat(map)` -> mutate -> `updateMapDataCompat(map, doc)`. IndexedDB hands
 * each reader its own structured clone, so two overlapping writers both read the same
 * snapshot and the second save overwrites the first: last-write-wins over the entire
 * document, silently. Measured before this module existed: 20 concurrent `addFeature`
 * calls persisted 1 feature.
 *
 * `runTransaction` does NOT help here: it orders persistence before side effects, it
 * does not order writers. This module is the missing half, and the two are orthogonal.
 *
 * @description
 * Contract:
 * - One section per key runs at a time; queued sections run in FIFO order.
 * - A rejecting section releases the key (the next waiter still runs) and the rejection
 *   propagates to its own caller only.
 * - Keys are independent: a write to map A never waits on a write to map B.
 *
 * DEADLOCK, the one hazard: the queue is strictly FIFO and has NO reentrancy. A section
 * that awaits another section on the same key waits for itself, forever. Hence the rule:
 * only LEAF read-modify-writes take the lock. A composite that awaits a locked operation
 * must not take it. The known composites, all verified unlocked: `moveFeaturesToMap`,
 * `addFeatureToMap`, `removeFeatureFromMap`'s caller, `toggleCatalogLayerVisibility`,
 * `updateCatalogLayerStatus`, `batchUpdateLOSFeatures` / `batchUpdateVisibilityFeatures`,
 * `transferLayerToMap`, `drainPendingFeatureOps` and the two inbound paths that drain it.
 *
 * `transferLayerToMap` is the one that touches TWO map documents, and it still takes
 * neither key: it awaits `addFeatures` on the destination and `deleteLayerFeatures` on the
 * source, and each of those takes its own key. Wrapping the composite in the SOURCE key
 * would deadlock on the removal step, which is the last thing it does, so the freeze would
 * arrive after the destination already held the data.
 *
 * Deferred effects are exempt by construction: `runTransaction`'s commit runs `deferSync`
 * synchronously (it cannot await) and starts `deferAsync` without awaiting it, so an
 * effect that reaches back into the store cannot wedge the queue.
 *
 * A contended acquisition still waiting after DEADLOCK_WARN_MS reports both labels. That
 * is what turns a frozen UI into a diagnosable message instead of a mystery.
 *
 * THE SLOWNESS IS THE PRICE, NOT THE DEFECT, and this note exists because the asymmetry
 * invites someone to "optimize" the queue away. A burst of N single-entity writes now
 * costs N round trips: measured, 100 concurrent `addFeature` calls take about 3 s, where
 * before they took 32 ms. What the 32 ms bought was 99 lost features. The cost is visible
 * and the benefit is invisible, which is exactly the shape of a guard that gets removed a
 * year later by someone reading a flame graph.
 *
 * The fast path is free (an uncontended acquisition adds no scheduling hop, measured at
 * 1,00x over 200 sequential writes), so the only thing that pays is the burst. If a burst
 * ever becomes a real call site, the answer is a BULK operation that writes the document
 * once (`addFeatures` already does this, at 31 ms for 100), never removing the queue.
 */

import { mapResolver } from './services/map-resolver.service.js';

/** Milliseconds a waiter tolerates before reporting a suspected reentrant call. */
const DEADLOCK_WARN_MS = 5000;

/** Key suffix for a write whose document identifier is missing. */
const UNNAMED = '__sem_nome__';

/**
 * @typedef {Object} LockState
 * @property {Promise<void>|null} tail - Settles when the last queued section finishes.
 * @property {string|null} active - Label of the section currently holding the key.
 * @property {number} waiting - Sections queued behind the holder.
 */

/** @type {Map<string, LockState>} */
const queues = new Map();

/**
 * Runs `fn` with exclusive access to `key`, queueing behind any section already
 * holding it.
 *
 * @param {string} key - Document key. Sections sharing a key are mutually exclusive.
 * @param {string} label - Operation name, used only in the deadlock report.
 * @param {function(): (Promise<*>|*)} fn - The critical section (read-modify-write).
 * @returns {Promise<*>} Resolves with `fn`'s result, rejects with its error.
 */
export function withDocumentLock(key, label, fn) {
    if (typeof fn !== 'function') {
        throw new Error('withDocumentLock requires a critical-section function');
    }

    const lockKey = key || UNNAMED;
    let state = queues.get(lockKey);
    if (!state) {
        state = { tail: null, active: null, waiting: 0 };
        queues.set(lockKey, state);
    }

    const previous = state.tail;
    let timer = null;

    if (previous) {
        state.waiting += 1;
        timer = setTimeout(() => {
            console.error(
                `[document-lock] "${label}" aguarda ha ${DEADLOCK_WARN_MS} ms pelo documento ` +
                `"${lockKey}", em uso por "${state.active}". Chamada reentrante (uma secao ` +
                'que espera por outra secao da mesma chave) trava a fila para sempre.'
            );
        }, DEADLOCK_WARN_MS);
        // Node keeps the process alive for a pending timer; a diagnostic must never do that.
        timer?.unref?.();
    }

    // The tail is published BEFORE `fn` runs, and it must never reject (a failing section
    // would otherwise reject everything queued behind it, in the wrong caller). Publishing
    // it first is what makes the queue honest: deriving the tail from the running promise
    // left a hole where a section that acquired the key SYNCHRONOUSLY inside another one
    // (before the outer's first await) found `tail` still unset and ran straight through,
    // so nesting sometimes deadlocked and sometimes silently overlapped. Now it always
    // deadlocks, which is the rule this module documents and the guard tests probe.
    let release;
    const tail = new Promise((resolve) => { release = resolve; });
    state.tail = tail;
    tail.then(() => {
        if (state.tail === tail && queues.get(lockKey) === state) {
            queues.delete(lockKey);
        }
    });

    // The async IIFE runs synchronously up to its first await, so an UNCONTENDED
    // acquisition starts `fn` in the same tick: the fast path costs no scheduling hop.
    return (async () => {
        if (previous) {
            await previous;
            clearTimeout(timer);
            timer = null;
            state.waiting -= 1;
        }
        state.active = label;
        try {
            return await fn();
        } finally {
            state.active = null;
            release();
        }
    })();
}

/**
 * Builds the lock key for a map document.
 *
 * Callers name the same map in two ways: local operations pass the display NAME, the
 * inbound sync path passes the map UUID. Both must land on the same key or they do not
 * exclude each other, so a registered name is folded into the id the repository stores it
 * under (the same resolution `LocalRepository._resolveMapKey` performs). A UUID and an
 * unregistered name both key on themselves, which is also what the repository does for a
 * name-keyed local map.
 *
 * `getIdForName` and not `resolveToId`: the latter calls `isValidUUID`, and reaching for
 * it from here would pull the uuid module into the import graph of every write operation,
 * where it is neither needed nor wanted. The two agree on every input that matters (a
 * UUID is never a registered NAME, so it falls through to itself either way).
 *
 * @param {string} mapNameOrId - Map display name or UUID.
 * @returns {string} Lock key for that map document.
 */
export function mapDocumentKey(mapNameOrId) {
    if (!mapNameOrId) return `map:${UNNAMED}`;
    return `map:${mapResolver.getIdForName(mapNameOrId) || mapNameOrId}`;
}

/**
 * Runs `fn` with exclusive access to one map document.
 *
 * @param {string} mapNameOrId - Map display name or UUID.
 * @param {string} label - Operation name, used only in the deadlock report.
 * @param {function(): (Promise<*>|*)} fn - The critical section (read-modify-write).
 * @returns {Promise<*>} Resolves with `fn`'s result.
 */
export function withMapDocument(mapNameOrId, label, fn) {
    return withDocumentLock(mapDocumentKey(mapNameOrId), label, fn);
}

/**
 * Builds the lock key for a per-map SIDE document.
 *
 * The map document is not the only read-modify-write target: comments, 3D, 360, layers,
 * groups and the per-map settings each live in their own store, keyed by map, and each has
 * the same last-write-wins hazard (measured: 20 concurrent `addComment` calls persisted 1).
 *
 * They get a key of their own on purpose. Folding them into `map:<id>` would serialize
 * writes that never touch the same document, so drawing a feature would wait on a 360
 * marker for no reason. Independent documents, independent keys.
 *
 * @param {string} kind - Side-store discriminator, e.g. 'comments', 'cesium3d', 'sv360'.
 * @param {string} mapNameOrId - Map display name or UUID.
 * @returns {string} Lock key for that side document.
 */
export function sideDocumentKey(kind, mapNameOrId) {
    if (!mapNameOrId) return `${kind}:${UNNAMED}`;
    return `${kind}:${mapResolver.getIdForName(mapNameOrId) || mapNameOrId}`;
}

/**
 * Runs `fn` with exclusive access to one per-map side document.
 *
 * Same reentrancy rule as {@link withMapDocument}: only LEAF read-modify-writes take it. A
 * composite that awaits a locked operation on the same key waits for itself, forever.
 *
 * @param {string} kind - Side-store discriminator, e.g. 'comments'.
 * @param {string} mapNameOrId - Map display name or UUID.
 * @param {string} label - Operation name, used only in the deadlock report.
 * @param {function(): (Promise<*>|*)} fn - The critical section (read-modify-write).
 * @returns {Promise<*>} Resolves with `fn`'s result.
 */
export function withSideDocument(kind, mapNameOrId, label, fn) {
    return withDocumentLock(sideDocumentKey(kind, mapNameOrId), label, fn);
}

/**
 * Snapshot of the live queues, for tests and diagnostics.
 * @returns {{keys: number, busy: string[]}}
 */
export function getDocumentLockStats() {
    const busy = [];
    for (const [key, state] of queues) {
        if (state.active) busy.push(`${key}:${state.active}`);
    }
    return { keys: queues.size, busy };
}

/**
 * Drops every queue. Test-only: it does NOT cancel sections already running, it only
 * stops future acquisitions from waiting on them.
 * @returns {void}
 */
export function resetDocumentLocks() {
    queues.clear();
}

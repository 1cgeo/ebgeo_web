// Path: js/store/sync/operation-queue.js

/**
 * @fileoverview Outbound operation queue: what this machine has written and the server
 * has not acknowledged yet. It is the only place in the store where the user's work
 * exists as an INTENTION rather than as data, which is why every rule below leans towards
 * keeping an operation nobody can place over discarding it.
 *
 * ONE DATABASE PER ATLAS, AND THE ADDRESS ALSO TRAVELS IN THE OPERATION.
 * The queue is `perAtlas: true` (`atlas-namespace.js`, Decision 2b): atlas X writes into
 * `ebgeo__<suffix of X>` and cannot see, drain or empty the queue of atlas Y, because it
 * never opens that database. The envelope keeps its stamp (`createOperation` writes
 * `scopeSuffix`, the address of the scope it was born in, and `atlasId`, the server atlas
 * when there is one) and every READ here is still filtered by it, but the roles have
 * swapped: the SEPARATION is now structural and the filter is an assertion over it. A
 * filter is a rule a future caller can forget; a separate database is a fact of the browser.
 *
 * The two defects this closed were both reachable by an ordinary gesture: a flush pushing
 * work born in another atlas, and `clear()` on a switch of project destroying the pending
 * work of another tab, i.e. the feature the user drew and had not uploaded.
 *
 * THE LEGACY SUFFIX KEEPS THE NAME `ebgeo`, so local slot #1 and the pre-namespace queue are
 * the same database and the ordinary installation moves zero bytes. Everything else is routed
 * once, by address, in `operation-queue-migration.js`.
 *
 * THE QUEUE IS PER ATLAS BUT IT IS NOT ATLAS DATA, and that is why `clearAllAtlasStores`
 * does not reach it. `openRemoteAtlas` activates the namespace of the atlas it is opening and
 * wipes three lines later; a queue inside that wipe would be the pending work OF THE ATLAS
 * BEING OPENED, destroyed immediately before the `connect` that would have drained it.
 * Emptying the queue on a wipe is a decision of the caller (`clearAllDataStore`), and
 * destroying it is part of destroying the namespace (`dropAtlasDatabases`).
 *
 * AN UNSTAMPED OPERATION BELONGS TO WHOEVER IS LOOKING (`operationBelongsToScope`).
 * Operations written before the stamp existed carry no address at all. Refusing them would
 * strand real, un-pushed work forever; there is exactly one such generation of them, and the
 * migration places them by the documented rule ("they belong to the atlas mounted at the time
 * of the upgrade"). The same permissiveness covers the window before any atlas is mounted,
 * where the queue resolves to `UNMOUNTED_QUEUE_SCOPE` and there is nothing to compare against.
 *
 * NO REVERSE INDEX. There used to be a module-level `opId -> key` Map, and it was two bugs
 * in one: it was built from the scope that happened to be active when the module first
 * touched storage, and `dequeue` counted removals through it while `peek` read the disk. So
 * an operation enqueued by ANOTHER TAB was peeked, pushed, and then not removed (the id was
 * absent from this tab's index), which re-peeked and re-pushed it forever without the queue
 * ever draining. Keys are now resolved from disk on every path that removes; the only cached
 * number left is the total key count, and it is used for nothing but the compaction
 * threshold, where being stale costs nothing.
 *
 * Resolved on every call on purpose (the factory caches, so it is a Map lookup): a handle
 * captured at module load is the exact bug the factory exists to remove.
 */

import {
    StoreName,
    getStoreFor,
    getActiveScope,
    UNMOUNTED_QUEUE_SCOPE
} from '@store/atlas-namespace.js';
import { OperationType } from './operation-types.js';

/**
 * The scope this queue reads and writes right now: the mounted atlas, or the legacy
 * (pre-namespace) address while nothing is mounted.
 *
 * IT NEVER RETURNS NULL, and that is deliberate. `getStore()` throws without an active
 * scope, and the queue is reachable before `initLocalAtlases()` (the boot enables operation
 * logging first) and after a destroyed scope is cleared. Throwing there would turn a
 * harmless read into a boot failure; falling back to the legacy address keeps exactly the
 * database the pre-namespace build used.
 * @returns {{ kind: string, atlasId: string|null, dbSuffix: string }}
 */
function queueScope() {
    return getActiveScope() ?? UNMOUNTED_QUEUE_SCOPE;
}

/**
 * @returns {import('localforage').default} The queue's localforage instance for the scope
 *   mounted right now. Resolved on every call: a handle captured at module load is the exact
 *   bug the namespace factory exists to remove.
 */
function queueStore() {
    return getStoreFor(StoreName.OPERATION_QUEUE, queueScope());
}

/**
 * Key prefix for queue entries.
 * Format: op_{timestamp}_{id} for chronological ordering.
 */
const KEY_PREFIX = 'op_';

/** Maximum operations before compaction triggers */
const MAX_QUEUE_SIZE = 10000;

/**
 * The address (database suffix) the queue is reading right now. The empty string is a real
 * address (the legacy slot, database `ebgeo`), never "no address".
 * @returns {string}
 */
function activeScopeSuffix() {
    return queueScope().dbSuffix;
}

/**
 * Whether an operation may be read back by a tab that has `scopeSuffix` mounted.
 *
 * Pure, and exported because it is the assertion over the physical split: a test that pins
 * it directly cannot be fooled by a caller that forgot to apply it, and a test that pins
 * only the callers cannot tell a correct rule from an absent one. Since the split it can
 * only ever refuse an operation that is in the WRONG database (a migration that could not
 * finish), which is why refusing means "leave it alone", never "delete it".
 *
 * @param {{scopeSuffix?: string|null}|null} operation
 * @param {string|null} scopeSuffix - Address of the reading scope. `null` means "no address
 *   to compare against" and accepts everything; the queue itself no longer passes null (it
 *   falls back to the legacy address), but the predicate keeps the case because a caller
 *   reading a raw database has no scope of its own.
 * @returns {boolean}
 */
export function operationBelongsToScope(operation, scopeSuffix) {
    if (scopeSuffix === null) return true;
    const born = operation?.scopeSuffix;
    if (born === null || born === undefined) return true;
    return born === scopeSuffix;
}

/**
 * The operation id carried by a queue key, or null when the key is not a queue entry.
 *
 * Splits on the FIRST separator after the prefix, not the last: the timestamp can never
 * contain an underscore but an id can, and the previous parse (`lastIndexOf`) truncated
 * such an id to its final segment, so it could not be dequeued after a reload.
 *
 * @param {string} key
 * @returns {string|null}
 */
function operationIdFromKey(key) {
    if (typeof key !== 'string' || !key.startsWith(KEY_PREFIX)) return null;
    const rest = key.slice(KEY_PREFIX.length);
    const cut = rest.indexOf('_');
    if (cut === -1) return null;
    const id = rest.slice(cut + 1);
    return id.length > 0 ? id : null;
}

/**
 * Operation queue for sync operations.
 * Operations are persisted to IndexedDB and can be:
 * - Enqueued: Added for later sync
 * - Peeked: Viewed without removing (ACTIVE SCOPE ONLY)
 * - Dequeued: Removed after successful sync (by explicit id, from disk)
 */
class OperationQueue {
    constructor() {
        /**
         * Cached number of entries in the queue database of {@link _countedSuffix}, or null
         * when unknown. Feeds the compaction threshold and nothing else: a stale value delays
         * or anticipates a compaction, which is a heuristic either way.
         * @type {number|null}
         * @private
         */
        this._totalKeys = null;

        /**
         * Which address {@link _totalKeys} was counted at. Without it a switch of atlas
         * carries the previous atlas's count into a different database, and a count inflated
         * by ten thousand would call compaction on every single enqueue of the new one.
         * @type {string|null}
         * @private
         */
        this._countedSuffix = null;

        /**
         * Whether compaction is currently running (prevent re-entrancy).
         * @type {boolean}
         * @private
         */
        this._compacting = false;
    }

    // ===== CORE OPERATIONS =====

    /**
     * Builds the storage key for an operation.
     * @private
     * @param {import('./operation-factory.js').Operation} operation
     * @returns {string}
     */
    _buildKey(operation) {
        return `${KEY_PREFIX}${operation.timestamp}_${operation.id}`;
    }

    /**
     * Enqueues an operation for later sync.
     * Triggers compaction if the queue exceeds MAX_QUEUE_SIZE.
     * @param {import('./operation-factory.js').Operation} operation - Operation to queue
     * @returns {Promise<void>}
     */
    async enqueue(operation) {
        await queueStore().setItem(this._buildKey(operation), operation);
        await this._growAndMaybeCompact(1);
    }

    /**
     * Enqueues multiple operations.
     * @param {import('./operation-factory.js').Operation[]} operations - Operations to queue
     * @returns {Promise<void>}
     */
    async enqueueAll(operations) {
        for (const operation of operations) {
            await queueStore().setItem(this._buildKey(operation), operation);
        }
        await this._growAndMaybeCompact(operations.length);
    }

    /**
     * Peeks at operations of the ACTIVE SCOPE without removing them.
     * @param {number} [count=10] - Maximum number to return
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Operations
     */
    async peek(count = 10) {
        const keys = await this._getOrderedKeys();
        return this._loadOperations(keys, { limit: count, scopeSuffix: activeScopeSuffix() });
    }

    /**
     * Dequeues operations by their IDs.
     *
     * NOT scope-filtered, and deliberately so: the caller names exact ids, and those ids
     * came from a scoped {@link peek}. Filtering again here would let an operation the
     * server has already accepted survive on disk and be pushed a second time.
     *
     * @param {string[]} operationIds - IDs of operations to remove
     * @returns {Promise<number>} Number of operations removed
     */
    async dequeue(operationIds) {
        if (!Array.isArray(operationIds) || operationIds.length === 0) return 0;
        const wanted = new Set(operationIds);

        let removed = 0;
        for (const key of await queueStore().keys()) {
            const opId = operationIdFromKey(key);
            if (opId === null || !wanted.has(opId)) continue;
            await queueStore().removeItem(key);
            removed++;
        }
        if (removed > 0) this._totalKeys = null;
        return removed;
    }

    /**
     * Counts the pending operations OF THE ACTIVE SCOPE.
     *
     * It reads the values rather than counting keys, because the stamp lives in the
     * envelope and an operation in the wrong database must not be counted as flushable.
     * That cost is only ever paid on a non-empty queue, and the caller that polls it
     * (`sync-flush.js`) checks the connection first and flushes immediately afterwards,
     * which reads the same values.
     * @returns {Promise<number>} Number of pending operations
     */
    async count() {
        const keys = await this._getOrderedKeys();
        const ops = await this._loadOperations(keys, { scopeSuffix: activeScopeSuffix() });
        return ops.length;
    }

    /**
     * Alias for count().
     * @returns {Promise<number>} Number of pending operations
     */
    async size() {
        return this.count();
    }

    /**
     * Clears the operations OF THE ACTIVE SCOPE, and only its own database.
     *
     * IT IS NOT PART OF THE ATLAS WIPE, and the caller decides (`clearAllDataStore`,
     * `clearQueue`). A wipe that ends in a blank local store abandons the data those
     * operations describe, so keeping them would push ghosts of deleted entities on the next
     * connect; a wipe that is the PREAMBLE to mounting a remote atlas is aimed at the
     * namespace of the atlas being opened, and emptying its queue there destroys pending work
     * seconds before the `connect` that would have drained it.
     *
     * The stamp filter survives the physical split as an assertion: an operation of another
     * address found in this database is a migration that did not finish, and it is left alone
     * rather than deleted.
     * @returns {Promise<void>}
     */
    async clear() {
        const scopeSuffix = activeScopeSuffix();
        const store = queueStore();

        for (const key of await this._getOrderedKeys()) {
            const operation = await store.getItem(key);
            if (operation && !operationBelongsToScope(operation, scopeSuffix)) continue;
            await store.removeItem(key);
        }
        this._totalKeys = null;
    }

    /**
     * Gets the pending operations OF THE ACTIVE SCOPE, in chronological order.
     * @returns {Promise<import('./operation-factory.js').Operation[]>} All operations
     */
    async getAll() {
        const keys = await this._getOrderedKeys();
        return this._loadOperations(keys, { scopeSuffix: activeScopeSuffix() });
    }

    /**
     * Gets operations filtered by entity type (within the active scope).
     * @param {string} entityType - Entity type to filter by
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Filtered operations
     */
    async getByEntityType(entityType) {
        const all = await this.getAll();
        return all.filter(op => op.entityType === entityType);
    }

    /**
     * Gets operations filtered by map ID (within the active scope).
     * @param {string} mapId - Map ID to filter by
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Filtered operations
     */
    async getByMapId(mapId) {
        const all = await this.getAll();
        return all.filter(op => op.mapId === mapId);
    }

    // ===== PRIVATE HELPERS =====

    /**
     * Gets queue keys in chronological order.
     * @private
     * @returns {Promise<string[]>} Ordered keys
     */
    async _getOrderedKeys() {
        const keys = await queueStore().keys();
        return keys
            .filter(k => k.startsWith(KEY_PREFIX))
            .sort(); // Lexicographic sort works since keys are timestamp-prefixed
    }

    /**
     * Loads operations from IndexedDB by their keys, skipping nulls.
     * @private
     * @param {string[]} keys - IndexedDB keys to load, already ordered.
     * @param {Object} [options]
     * @param {number} [options.limit] - Stop after this many MATCHING operations.
     * @param {string|null} [options.scopeSuffix=null] - Keep only operations of this scope.
     * @returns {Promise<import('./operation-factory.js').Operation[]>}
     */
    async _loadOperations(keys, { limit = Infinity, scopeSuffix = null } = {}) {
        const operations = [];
        if (limit <= 0) return operations;

        for (const key of keys) {
            const op = await queueStore().getItem(key);
            if (!op) continue;
            if (!operationBelongsToScope(op, scopeSuffix)) continue;
            operations.push(op);
            if (operations.length >= limit) break;
        }
        return operations;
    }

    /**
     * Accounts for newly written entries and compacts when the queue outgrows its bound.
     * @private
     * @param {number} added - How many entries were just written.
     * @returns {Promise<void>}
     */
    async _growAndMaybeCompact(added) {
        const suffix = activeScopeSuffix();
        if (this._totalKeys === null || this._countedSuffix !== suffix) {
            this._totalKeys = (await this._getOrderedKeys()).length;
            this._countedSuffix = suffix;
        } else {
            this._totalKeys += added;
        }
        if (this._totalKeys > MAX_QUEUE_SIZE && !this._compacting) {
            await this._compact();
        }
    }

    // ===== COMPACTION =====

    /**
     * Compacts the queue by merging redundant operations for the same entity.
     *
     * Rules:
     * - Multiple UPDATEs for the same entity -> keep only the last one
     * - CREATE followed by UPDATEs -> merge into single CREATE with latest data
     * - CREATE followed by DELETE -> remove both (entity never needs to sync)
     * - UPDATE followed by DELETE -> keep only DELETE
     *
     * Runs over the queue of the MOUNTED atlas, which since the physical split is the only
     * one this process can open. The group key still carries the address, and it stays:
     * within one database an unstamped operation and a stamped one can describe the same
     * entity id, and collapsing those two into one would merge work from two owners.
     *
     * @private
     * @returns {Promise<void>}
     */
    async _compact() {
        if (this._compacting) return;
        this._compacting = true;

        try {
            const keys = await this._getOrderedKeys();
            // Re-anchors the cached count on the disk before deciding anything. Without
            // this, a count inflated by another tab's dequeue would call compaction on
            // EVERY enqueue, and each call reads the whole queue to decide it has nothing
            // to do.
            this._totalKeys = keys.length;
            this._countedSuffix = activeScopeSuffix();

            const allOps = await this._loadOperations(keys);
            if (allOps.length <= MAX_QUEUE_SIZE) return;

            const keyById = new Map();
            for (const key of keys) {
                const opId = operationIdFromKey(key);
                if (opId !== null) keyById.set(opId, key);
            }

            // Group operations by scope+entityType+entityId (preserving chronological order)
            /** @type {Map<string, import('./operation-factory.js').Operation[]>} */
            const groups = new Map();
            for (const op of allOps) {
                const groupKey = `${op.scopeSuffix ?? ''}:${op.entityType}:${op.entityId}`;
                if (!groups.has(groupKey)) {
                    groups.set(groupKey, []);
                }
                groups.get(groupKey).push(op);
            }

            /** @type {string[]} */
            const keysToRemove = [];
            /** @type {Array<{key: string, op: import('./operation-factory.js').Operation}>} */
            const opsToUpdate = [];

            for (const [, ops] of groups) {
                if (ops.length <= 1) continue;

                const compacted = this._compactEntityOps(ops);
                const keptIds = new Set(compacted.map(op => op.id));

                for (const op of ops) {
                    if (!keptIds.has(op.id)) {
                        const key = keyById.get(op.id);
                        if (key) keysToRemove.push(key);
                    }
                }

                for (const op of compacted) {
                    const key = keyById.get(op.id);
                    if (key) opsToUpdate.push({ key, op });
                }
            }

            for (const key of keysToRemove) {
                await queueStore().removeItem(key);
            }
            for (const { key, op } of opsToUpdate) {
                await queueStore().setItem(key, op);
            }

            this._totalKeys = null;
        } finally {
            this._compacting = false;
        }
    }

    /**
     * Compacts operations for a single entity.
     * @private
     * @param {import('./operation-factory.js').Operation[]} ops - Chronologically ordered ops for one entity
     * @returns {import('./operation-factory.js').Operation[]} Compacted ops
     */
    _compactEntityOps(ops) {
        if (ops.length === 0) return ops;

        const firstOp = ops[0];
        const lastOp = ops[ops.length - 1];

        // CREATE + ... + DELETE -> remove all (entity was created and deleted locally)
        if (firstOp.operationType === OperationType.CREATE && lastOp.operationType === OperationType.DELETE) {
            return [];
        }

        // CREATE + UPDATEs -> merge into single CREATE with latest data
        if (firstOp.operationType === OperationType.CREATE) {
            const mergedCreate = { ...firstOp };
            for (let i = ops.length - 1; i > 0; i--) {
                if (ops[i].data) {
                    mergedCreate.data = ops[i].data;
                    break;
                }
            }
            return [mergedCreate];
        }

        // UPDATEs + DELETE -> keep only DELETE
        // Multiple UPDATEs -> keep only the last one
        return [lastOp];
    }

    // ===== AUTO-PURGE =====

    /**
     * Purges operations older than maxAgeMs from the queue OF THE MOUNTED ATLAS.
     *
     * It used to sweep every atlas at once, and it no longer can: since the physical split
     * this process only ever opens one queue database. The consequence is written down
     * rather than worked around, because working around it means enumerating databases the
     * browser will not enumerate: a stale operation of an unmounted atlas survives until
     * that atlas is mounted again (where this collects it) or destroyed (where
     * `dropAtlasDatabases` takes the whole database). Neither leaves it flushable, which is
     * the property that mattered.
     *
     * It ignores the stamp on purpose: age is a property of the entry, and an operation of
     * a foreign address sitting in this database is exactly the residue worth collecting.
     * @param {number} [maxAgeMs=604800000] - Max age in milliseconds (default: 7 days)
     * @returns {Promise<number>} Number of operations purged
     */
    async purgeOldOperations(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - maxAgeMs;
        const allOps = await this._loadOperations(await this._getOrderedKeys());
        const toPurge = allOps
            .filter(op => op.timestamp < cutoff)
            .map(op => op.id);

        if (toPurge.length > 0) {
            await this.dequeue(toPurge);
        }
        return toPurge.length;
    }

    /**
     * Starts periodic auto-purge of old operations.
     * Runs every 6 hours. Safe to call multiple times (idempotent).
     *
     * `initServices()` starts it BEFORE any atlas is mounted, which is why the queue falls
     * back to the legacy address instead of throwing: a timer that dies on its first tick
     * with "no active atlas scope" is a collector that silently never collects. Every tick
     * after the boot lands on whatever atlas is mounted then.
     */
    startAutoPurge() {
        if (this._purgeInterval) return;

        const SIX_HOURS = 6 * 60 * 60 * 1000;
        this._purgeInterval = setInterval(async () => {
            try {
                const purged = await this.purgeOldOperations();
                if (purged > 0) {
                    console.info(`Operation queue: purged ${purged} old operations`);
                }
            } catch (error) {
                console.warn('Operation queue purge error:', error);
            }
        }, SIX_HOURS);
    }

    /**
     * Stops the auto-purge interval (for testing/cleanup).
     */
    stopAutoPurge() {
        if (this._purgeInterval) {
            clearInterval(this._purgeInterval);
            this._purgeInterval = null;
        }
    }
}

/** Singleton operation queue instance. */
export const operationQueue = new OperationQueue();

// Export class for testing
export { OperationQueue };

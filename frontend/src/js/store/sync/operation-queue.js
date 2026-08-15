// Path: js/store/sync/operation-queue.js

/**
 * @fileoverview Operation queue for sync system.
 * Persists operations to IndexedDB for eventual sync with backend.
 *
 * Features:
 * - Configurable max queue size with automatic compaction
 * - In-memory reverse index (opId -> key) for O(1) dequeue
 * - Compaction merges redundant operations (multiple UPDATEs, CREATE+DELETE)
 */

import { StoreName, getStore } from '@store/atlas-namespace.js';
import { OperationType } from './operation-types.js';

/**
 * Dedicated IndexedDB store for the operation queue, resolved through the namespace
 * factory instead of being created here.
 *
 * The queue is one of the two GLOBAL (`perAtlas: false`) databases: the operation
 * envelope carries no atlas id, so a per-atlas queue would record the atlas where nobody
 * reads it, would leave up to 10 local queues that never drain, and keyed by remote atlas
 * id it would be exactly the persistent, editable server residue the store-origin marker
 * forbids. Being global also means this accessor never needs an active scope, which is
 * what lets the queue be touched at boot, before `initLocalAtlases()` picks one.
 *
 * Resolved on every call on purpose (the factory caches, so it is a Map lookup): a handle
 * captured at module load is the exact bug the factory exists to remove.
 *
 * The price of a global queue is that a SWITCH of local atlas must clear it, or an
 * operation born in atlas A survives into atlas B and a later connect pushes it to the
 * wrong atlas. Today that comes for free inside `clearAllDataStore`.
 *
 * @returns {import('localforage').default} The queue's localforage instance.
 */
function queueStore() {
    return getStore(StoreName.OPERATION_QUEUE);
}

/**
 * Key prefix for queue entries.
 * Format: op_{timestamp}_{id} for chronological ordering.
 */
const KEY_PREFIX = 'op_';

/** Maximum operations before compaction triggers */
const MAX_QUEUE_SIZE = 10000;

/**
 * Operation queue for sync operations.
 * Operations are persisted to IndexedDB and can be:
 * - Enqueued: Added for later sync
 * - Peeked: Viewed without removing
 * - Dequeued: Removed after successful sync
 */
class OperationQueue {
    constructor() {
        /**
         * Reverse index: opId -> IndexedDB key.
         * Built lazily on first use, kept in sync on enqueue/dequeue/clear.
         * @type {Map<string, string>|null}
         * @private
         */
        this._index = null;

        /**
         * Whether compaction is currently running (prevent re-entrancy).
         * @type {boolean}
         * @private
         */
        this._compacting = false;
    }

    // ===== INDEX MANAGEMENT =====

    /**
     * Ensures the reverse index is built.
     * Called lazily on first operation that needs the index.
     * @private
     * @returns {Promise<void>}
     */
    async _ensureIndex() {
        if (this._index) return;
        this._index = new Map();

        const keys = await queueStore().keys();
        for (const key of keys) {
            if (!key.startsWith(KEY_PREFIX)) continue;
            const lastUnderscore = key.lastIndexOf('_');
            const opId = key.substring(lastUnderscore + 1);
            this._index.set(opId, key);
        }
    }

    /**
     * Builds the storage key for an operation.
     * @private
     * @param {import('./operation-factory.js').Operation} operation
     * @returns {string}
     */
    _buildKey(operation) {
        return `${KEY_PREFIX}${operation.timestamp}_${operation.id}`;
    }

    // ===== CORE OPERATIONS =====

    /**
     * Enqueues an operation for later sync.
     * Triggers compaction if queue exceeds MAX_QUEUE_SIZE.
     * @param {import('./operation-factory.js').Operation} operation - Operation to queue
     * @returns {Promise<void>}
     */
    async enqueue(operation) {
        await this._ensureIndex();

        const key = this._buildKey(operation);
        await queueStore().setItem(key, operation);
        this._index.set(operation.id, key);

        if (this._index.size > MAX_QUEUE_SIZE && !this._compacting) {
            await this._compact();
        }
    }

    /**
     * Enqueues multiple operations.
     * @param {import('./operation-factory.js').Operation[]} operations - Operations to queue
     * @returns {Promise<void>}
     */
    async enqueueAll(operations) {
        await this._ensureIndex();

        for (const operation of operations) {
            const key = this._buildKey(operation);
            await queueStore().setItem(key, operation);
            this._index.set(operation.id, key);
        }

        if (this._index.size > MAX_QUEUE_SIZE && !this._compacting) {
            await this._compact();
        }
    }

    /**
     * Peeks at operations without removing them.
     * @param {number} [count=10] - Maximum number to return
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Operations
     */
    async peek(count = 10) {
        const keys = await this._getOrderedKeys();
        return this._loadOperations(keys.slice(0, count));
    }

    /**
     * Dequeues operations by their IDs.
     * Uses reverse index for O(1) key lookup per operation.
     * @param {string[]} operationIds - IDs of operations to remove
     * @returns {Promise<number>} Number of operations removed
     */
    async dequeue(operationIds) {
        await this._ensureIndex();
        let removed = 0;

        for (const opId of operationIds) {
            const key = this._index.get(opId);
            if (key) {
                await queueStore().removeItem(key);
                this._index.delete(opId);
                removed++;
            }
        }
        return removed;
    }

    /**
     * Gets the count of pending operations.
     * @returns {Promise<number>} Number of pending operations
     */
    async count() {
        await this._ensureIndex();
        return this._index.size;
    }

    /**
     * Alias for count().
     * @returns {Promise<number>} Number of pending operations
     */
    async size() {
        return this.count();
    }

    /**
     * Clears all operations from the queue.
     * @returns {Promise<void>}
     */
    async clear() {
        const keys = await queueStore().keys();
        for (const key of keys) {
            if (key.startsWith(KEY_PREFIX)) {
                await queueStore().removeItem(key);
            }
        }
        this._index = new Map();
    }

    /**
     * Gets all pending operations in chronological order.
     * @returns {Promise<import('./operation-factory.js').Operation[]>} All operations
     */
    async getAll() {
        const keys = await this._getOrderedKeys();
        return this._loadOperations(keys);
    }

    /**
     * Gets operations filtered by entity type.
     * @param {string} entityType - Entity type to filter by
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Filtered operations
     */
    async getByEntityType(entityType) {
        const all = await this.getAll();
        return all.filter(op => op.entityType === entityType);
    }

    /**
     * Gets operations filtered by map ID.
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
     * @param {string[]} keys - IndexedDB keys to load
     * @returns {Promise<import('./operation-factory.js').Operation[]>}
     */
    async _loadOperations(keys) {
        const operations = [];
        for (const key of keys) {
            const op = await queueStore().getItem(key);
            if (op) operations.push(op);
        }
        return operations;
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
     * @private
     * @returns {Promise<void>}
     */
    async _compact() {
        if (this._compacting) return;
        this._compacting = true;

        try {
            const allOps = await this.getAll();
            if (allOps.length <= MAX_QUEUE_SIZE) return;

            // Group operations by entityType+entityId (preserving chronological order)
            /** @type {Map<string, import('./operation-factory.js').Operation[]>} */
            const groups = new Map();
            for (const op of allOps) {
                const groupKey = `${op.entityType}:${op.entityId}`;
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
                        const key = this._index.get(op.id);
                        if (key) keysToRemove.push(key);
                    }
                }

                for (const op of compacted) {
                    const key = this._index.get(op.id);
                    if (key) opsToUpdate.push({ key, op });
                }
            }

            for (const key of keysToRemove) {
                await queueStore().removeItem(key);
            }
            for (const { key, op } of opsToUpdate) {
                await queueStore().setItem(key, op);
            }

            // Rebuild index after compaction
            this._index = null;
            await this._ensureIndex();
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
     * Purges operations older than maxAgeMs from the queue.
     * Prevents unbounded queue growth when no backend is consuming operations.
     * @param {number} [maxAgeMs=604800000] - Max age in milliseconds (default: 7 days)
     * @returns {Promise<number>} Number of operations purged
     */
    async purgeOldOperations(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
        await this._ensureIndex();
        const cutoff = Date.now() - maxAgeMs;
        const allOps = await this.getAll();
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

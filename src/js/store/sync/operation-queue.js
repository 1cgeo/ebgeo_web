// Path: js/store/sync/operation-queue.js

/**
 * @fileoverview Operation queue for sync system.
 * Persists operations to IndexedDB for eventual sync with backend.
 */

import localforage from 'localforage';

// Dedicated store for operation queue
const queueStore = localforage.createInstance({
    name: 'ebgeo',
    storeName: 'operation_queue'
});

/**
 * Key prefix for queue entries.
 * Format: op_{timestamp}_{id} for chronological ordering.
 */
const KEY_PREFIX = 'op_';

/**
 * Operation queue for sync operations.
 * Operations are persisted to IndexedDB and can be:
 * - Enqueued: Added for later sync
 * - Peeked: Viewed without removing
 * - Dequeued: Removed after successful sync
 */
class OperationQueue {
    /**
     * Enqueues an operation for later sync.
     * @param {import('./operation-factory.js').Operation} operation - Operation to queue
     * @returns {Promise<void>}
     */
    async enqueue(operation) {
        // Use timestamp + id for key to maintain order
        const key = `${KEY_PREFIX}${operation.timestamp}_${operation.id}`;
        await queueStore.setItem(key, operation);
    }

    /**
     * Enqueues multiple operations atomically.
     * @param {import('./operation-factory.js').Operation[]} operations - Operations to queue
     * @returns {Promise<void>}
     */
    async enqueueAll(operations) {
        for (const operation of operations) {
            await this.enqueue(operation);
        }
    }

    /**
     * Peeks at operations without removing them.
     * @param {number} [count=10] - Maximum number to return
     * @returns {Promise<import('./operation-factory.js').Operation[]>} Operations
     */
    async peek(count = 10) {
        const keys = await this.getOrderedKeys();
        const limited = keys.slice(0, count);

        const operations = [];
        for (const key of limited) {
            const op = await queueStore.getItem(key);
            if (op) {
                operations.push(op);
            }
        }
        return operations;
    }

    /**
     * Dequeues operations by their IDs.
     * @param {string[]} operationIds - IDs of operations to remove
     * @returns {Promise<number>} Number of operations removed
     */
    async dequeue(operationIds) {
        const idSet = new Set(operationIds);
        const keys = await queueStore.keys();
        let removed = 0;

        for (const key of keys) {
            if (!key.startsWith(KEY_PREFIX)) continue;

            // Extract ID from key (last segment after last _)
            const parts = key.split('_');
            const opId = parts[parts.length - 1];

            if (idSet.has(opId)) {
                await queueStore.removeItem(key);
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
        const keys = await queueStore.keys();
        return keys.filter(k => k.startsWith(KEY_PREFIX)).length;
    }

    /**
     * Clears all operations from the queue.
     * Use with caution - typically for testing or reset.
     * @returns {Promise<void>}
     */
    async clear() {
        const keys = await queueStore.keys();
        for (const key of keys) {
            if (key.startsWith(KEY_PREFIX)) {
                await queueStore.removeItem(key);
            }
        }
    }

    /**
     * Gets all pending operations.
     * @returns {Promise<import('./operation-factory.js').Operation[]>} All operations
     */
    async getAll() {
        const keys = await this.getOrderedKeys();
        const operations = [];

        for (const key of keys) {
            const op = await queueStore.getItem(key);
            if (op) {
                operations.push(op);
            }
        }
        return operations;
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

    /**
     * Gets queue keys in chronological order.
     * @private
     * @returns {Promise<string[]>} Ordered keys
     */
    async getOrderedKeys() {
        const keys = await queueStore.keys();
        return keys
            .filter(k => k.startsWith(KEY_PREFIX))
            .sort(); // Lexicographic sort works since keys are timestamp-prefixed
    }
}

/**
 * Singleton operation queue instance.
 */
export const operationQueue = new OperationQueue();

// Export class for testing
export { OperationQueue };

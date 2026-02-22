// Path: js/store/sync/sync-gateway.js

/**
 * @fileoverview Sync gateway abstraction for operation transmission.
 * Defines the interface for sending local operations to a backend
 * and applying remote operations locally.
 *
 * Current implementation: OFFLINE (no-op).
 * Future: replace with WebSocket-based implementation.
 *
 * @dependencies operation-queue.js, operation-factory.js, connection-state.js
 */

import { operationQueue } from './operation-queue.js';
import { advanceLamportClock } from './operation-factory.js';
import { connectionState } from './connection-state.js';

// ============================================================================
// SYNC GATEWAY CLASS
// ============================================================================

/**
 * Gateway for synchronizing operations between client and server.
 * In offline mode, all operations are no-ops.
 * When online, subclasses or replacements handle WebSocket transmission.
 */
class SyncGateway {
    constructor() {
        /** @type {Function|null} */
        this._remoteOperationHandler = null;
    }

    /**
     * Attempts to send pending operations from the queue.
     * Offline: returns immediately with { sent: 0 }.
     * Online: peeks queue, sends via transport, dequeues confirmed.
     *
     * @param {number} [batchSize=50] - Max operations to send per call
     * @returns {Promise<{ sent: number, failed: number, remaining: number }>}
     */
    async sendPendingOperations(_batchSize = 50) {
        if (!connectionState.isOnline()) {
            const size = await operationQueue.size();
            return { sent: 0, failed: 0, remaining: size };
        }

        // Future: implement WebSocket send here
        // const pending = await operationQueue.peek(batchSize);
        // const confirmed = await this._transport.send(pending);
        // await operationQueue.dequeue(confirmed.map(op => op.id));
        // return { sent: confirmed.length, failed: pending.length - confirmed.length, remaining: ... };

        const size = await operationQueue.size();
        return { sent: 0, failed: 0, remaining: size };
    }

    /**
     * Applies a remote operation to the local store.
     * Called when receiving operations from other clients via WebSocket.
     * Offline: no-op (no remote operations expected).
     *
     * @param {import('./operation-factory.js').Operation} operation - Remote operation
     * @returns {Promise<void>}
     */
    async applyRemoteOperation(operation) {
        if (!connectionState.isOnline()) return;

        // Advance Lamport clock to maintain causal ordering
        if (operation.lamportTimestamp) {
            advanceLamportClock(operation.lamportTimestamp);
        }

        // Delegate to registered handler
        if (this._remoteOperationHandler) {
            await this._remoteOperationHandler(operation);
        }
    }

    /**
     * Registers a handler for applying remote operations to the local store.
     * The handler is responsible for:
     * 1. Writing to LocalRepository
     * 2. Emitting appropriate events (FEATURE_MODIFIED, etc.)
     * 3. Updating in-memory caches
     *
     * @param {Function} handler - async (operation) => void
     */
    setRemoteOperationHandler(handler) {
        if (typeof handler !== 'function') {
            throw new Error('handler must be a function');
        }
        this._remoteOperationHandler = handler;
    }

    /**
     * Returns the current queue size.
     * @returns {Promise<number>}
     */
    async getPendingCount() {
        return operationQueue.size();
    }

    /**
     * Resets the gateway state (for testing).
     */
    _reset() {
        this._remoteOperationHandler = null;
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

/**
 * Singleton SyncGateway instance.
 * @type {SyncGateway}
 */
export const syncGateway = new SyncGateway();

// Export class for testing
export { SyncGateway };

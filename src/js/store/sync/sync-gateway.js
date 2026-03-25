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
     * Online (future): peeks queue, sends via transport, dequeues confirmed.
     *
     * @param {number} [_batchSize=50] - Max operations to send per call
     * @returns {Promise<{ sent: number, failed: number, remaining: number }>}
     */
    async sendPendingOperations(_batchSize = 50) {
        const remaining = await operationQueue.size();

        // Future: when online, peek queue, send via WebSocket, dequeue confirmed
        if (!connectionState.isOnline()) {
            return { sent: 0, failed: 0, remaining };
        }

        return { sent: 0, failed: 0, remaining };
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

        if (operation.lamportTimestamp) {
            advanceLamportClock(operation.lamportTimestamp);
        }

        if (this._remoteOperationHandler) {
            await this._remoteOperationHandler(operation);
        }
    }

    /**
     * Registers a handler for applying remote operations to the local store.
     * The handler writes to LocalRepository, emits events, and updates caches.
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

/** @type {SyncGateway} */
export const syncGateway = new SyncGateway();

export { SyncGateway };

// Path: js/store/sync/sync-gateway.js

/**
 * @fileoverview Sync gateway for inbound remote operations.
 * Holds the remote-operation handler and dispatches operations
 * received from other clients to the local store.
 *
 * Note: outbound sending lives in sync-engine.flush() →
 * apiClient.pushOperations(); the gateway is not on the send path.
 *
 * @dependencies operation-queue.js, operation-factory.js, connection-state.js
 */

import { operationQueue } from './operation-queue.js';
import { advanceLamportClock } from './operation-factory.js';
import { connectionState } from './connection-state.js';
import { record } from './diag/trace-core.js';
import { TraceStage, TraceOutcome, DropReason } from './diag/trace-stages.js';

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
     * Applies a remote operation to the local store.
     * Called when receiving operations from other clients via WebSocket.
     * Offline: no-op (no remote operations expected).
     *
     * @param {import('./operation-factory.js').Operation} operation - Remote operation
     * @returns {Promise<void>}
     */
    async applyRemoteOperation(operation) {
        if (!connectionState.isOnline()) {
            record(TraceStage.GATEWAY_GATE, {
                opId: operation?.id, traceId: operation?.traceId,
                outcome: TraceOutcome.DROPPED, reason: DropReason.OFFLINE,
            });
            return;
        }

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

// Path: js/store/sync/sync-scheduler.js

/**
 * @fileoverview Sync scheduler (no-op).
 *
 * Historically this module debounced entity lifecycle events and triggered
 * `syncGateway.sendPendingOperations()`. That gateway method was a dead no-op
 * (always returned { sent: 0 }) and has been removed. Outbound sending is now
 * driven entirely by the sync-flush auto-flush driver
 * (sync-flush.js → sync-engine.flush() → apiClient.pushOperations()).
 *
 * `initSyncScheduler` is retained as a no-op so existing call sites
 * (store/services.js, sync/index.js) keep working without change.
 */

/**
 * Initializes the sync scheduler.
 *
 * No-op: outbound flushing is owned by sync-flush.js / sync-engine.js.
 * Kept as a stable entry point for existing callers.
 *
 * @param {import('../../events/event_bus.js').EventBus} _eventBus
 */
export function initSyncScheduler(_eventBus) {
    // Intentionally empty. See file overview.
}

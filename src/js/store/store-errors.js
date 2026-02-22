// Path: js/store/store-errors.js

/**
 * @module store/store-errors
 * @description Error conventions and helpers for store operations.
 *
 * CONVENTION TABLE:
 * | Scenario                          | Pattern                              |
 * |-----------------------------------|--------------------------------------|
 * | Invalid argument (developer bug)  | throw new Error(msg)                 |
 * | Expected failure (locked, etc.)   | return existing type + emit event    |
 * | Background non-critical           | console.warn (no change)             |
 * | Possible data loss (IndexedDB)    | throw + emit STORE_PERSIST_ERROR     |
 * | Sync queue failure                | emit STORE_SYNC_ERROR + retry        |
 *
 * @dependencies events/event_bus (injected via setStoreErrorEventBus)
 */

// ============================================================================
// ERROR EVENT TYPES
// ============================================================================

/**
 * Store error event constants.
 * These are also mirrored in EventTypes for discoverability.
 * @readonly
 * @enum {string}
 */
export const StoreErrorEvents = Object.freeze({
    /**
     * IndexedDB write failure (data may not be saved).
     * Payload: { operation: string, error: string, timestamp: number }
     */
    STORE_PERSIST_ERROR: 'store:persistError',

    /**
     * Sync queue write failure (operation may not sync to backend).
     * Payload: { operation: string, entityId: string, error: string, consecutiveFailures: number }
     */
    STORE_SYNC_ERROR: 'store:syncError',

    /**
     * Operation blocked by locked map.
     * Payload: { operation: string, mapName: string }
     */
    STORE_OPERATION_BLOCKED: 'store:operationBlocked',
});

// ============================================================================
// EVENT BUS INJECTION
// ============================================================================

/** @type {import('../events/event_bus.js').EventBus|null} */
let _eventBus = null;

/**
 * Injects the EventBus dependency.
 * Called once from initStoreEvents() in store.js.
 * @param {import('../events/event_bus.js').EventBus} eventBus
 */
export function setStoreErrorEventBus(eventBus) {
    _eventBus = eventBus;
}

// ============================================================================
// EMIT HELPER
// ============================================================================

/**
 * Emits a store error event for UI notification.
 * Safe to call even before EventBus is initialized (falls back to console).
 *
 * @param {string} eventType - One of StoreErrorEvents values
 * @param {Object} payload - Event-specific data
 */
export function emitStoreError(eventType, payload) {
    if (_eventBus) {
        _eventBus.emit(eventType, payload);
    } else {
        console.error('[store-errors] EventBus not available, error:', eventType, payload);
    }
}

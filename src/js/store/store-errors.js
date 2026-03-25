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
 */

/** Canonical store error event constants (not duplicated in EventTypes). */
export const StoreErrorEvents = Object.freeze({
    /** IndexedDB write failure. Payload: { operation, error, timestamp } */
    STORE_PERSIST_ERROR: 'store:persistError',

    /** Sync queue write failure. Payload: { operation, entityId, error, consecutiveFailures } */
    STORE_SYNC_ERROR: 'store:syncError',

    /** Operation blocked by locked map. Payload: { operation, mapName } */
    STORE_OPERATION_BLOCKED: 'store:operationBlocked',
});

/** @type {import('../events/event_bus.js').EventBus | null} */
let _eventBus = null;

/**
 * Injects the EventBus dependency.
 * Called once from initStoreEvents() in store.js.
 * @param {import('../events/event_bus.js').EventBus} eventBus
 */
export function setStoreErrorEventBus(eventBus) {
    _eventBus = eventBus;
}

/**
 * Emits a store error event for UI notification.
 * Falls back to console if EventBus is not yet initialized.
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

// Path: js/store/sync/sync-scheduler.js

/**
 * @fileoverview Sync scheduler for online operation transmission.
 * Listens to entity lifecycle events and triggers sync attempts
 * when connection state is ONLINE.
 *
 * Offline: no-op (events are emitted but scheduler exits early).
 * Online: debounced sync attempts via SyncGateway.
 *
 * @dependencies services.js, event_types.js, connection-state.js, sync-gateway.js
 */

import { EventTypes } from '../../events/event_types.js';
import { connectionState } from './connection-state.js';
import { syncGateway } from './sync-gateway.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Debounce delay for sync attempts (ms).
 * Coalesces rapid operations (e.g., bulk import) into a single sync batch.
 * @type {number}
 */
const SYNC_DEBOUNCE_MS = 1000;

/**
 * Entity lifecycle events that should trigger a sync attempt when online.
 * @type {string[]}
 */
const SYNC_TRIGGER_EVENTS = [
    EventTypes.FEATURE_CREATED,
    EventTypes.FEATURE_MODIFIED,
    EventTypes.FEATURE_DELETED,
    EventTypes.LAYER_CREATED,
    EventTypes.LAYER_MODIFIED,
    EventTypes.LAYER_DELETED,
    EventTypes.GROUP_CREATED,
    EventTypes.GROUP_MODIFIED,
    EventTypes.GROUP_DELETED,
    EventTypes.MAP_CREATED,
    EventTypes.MAP_MODIFIED,
    EventTypes.MAP_DELETED,
    EventTypes.BRIEFING_CREATED,
    EventTypes.BRIEFING_UPDATED,
    EventTypes.BRIEFING_DELETED,
];

// ============================================================================
// MODULE STATE
// ============================================================================

/** @type {ReturnType<typeof setTimeout>|null} */
let _syncTimer = null;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initializes the sync scheduler.
 * Subscribes to entity lifecycle events and connection state changes.
 * Must be called after EventBus is available.
 *
 * @param {import('../../events/event_bus.js').EventBus} eventBus
 */
export function initSyncScheduler(eventBus) {
    // Subscribe to entity lifecycle events
    for (const eventType of SYNC_TRIGGER_EVENTS) {
        eventBus.on(eventType, () => {
            scheduleSyncAttempt();
        });
    }

    // Flush queue immediately when connection goes ONLINE
    connectionState.onStateChanged(({ currentState }) => {
        if (currentState === 'online') {
            scheduleSyncAttempt(0);
        }
    });
}

// ============================================================================
// PRIVATE
// ============================================================================

/**
 * Schedules a debounced sync attempt via SyncGateway.
 * No-op when offline (exits before scheduling).
 *
 * @param {number} [delayMs=SYNC_DEBOUNCE_MS] - Delay before sync
 */
function scheduleSyncAttempt(delayMs = SYNC_DEBOUNCE_MS) {
    if (!connectionState.isOnline()) {
        return;
    }

    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
        try {
            const result = await syncGateway.sendPendingOperations();
            if (result.sent > 0) {
                console.log(`[sync-scheduler] Synced ${result.sent} operations, ${result.remaining} remaining`);
            }
        } catch (error) {
            console.warn('[sync-scheduler] Sync attempt failed:', error);
        }
    }, delayMs);
}

// Path: js/store/sync/sync-scheduler.js

/**
 * @fileoverview Sync scheduler for online operation transmission.
 * Listens to entity lifecycle events and triggers sync attempts
 * when connection state is ONLINE.
 *
 * Offline: no-op (events are emitted but scheduler exits early).
 * Online: debounced sync attempts via SyncGateway.
 */

import { EventTypes } from '../../events/event_types.js';
import { connectionState, ConnectionStates } from './connection-state.js';
import { syncGateway } from './sync-gateway.js';

/** Debounce delay (ms). Coalesces rapid operations into a single sync batch. */
const SYNC_DEBOUNCE_MS = 1000;

/** Entity lifecycle events that trigger a sync attempt when online. */
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

/** @type {number|null} */
let _syncTimer = null;

/**
 * Initializes the sync scheduler.
 * Subscribes to entity lifecycle events and connection state changes.
 * Must be called after EventBus is available.
 *
 * @param {import('../../events/event_bus.js').EventBus} eventBus
 */
export function initSyncScheduler(eventBus) {
    for (const eventType of SYNC_TRIGGER_EVENTS) {
        eventBus.on(eventType, () => scheduleSyncAttempt());
    }

    connectionState.onStateChanged(({ currentState }) => {
        if (currentState === ConnectionStates.ONLINE) {
            scheduleSyncAttempt(0);
        }
    });
}

/**
 * Schedules a debounced sync attempt via SyncGateway.
 * No-op when offline.
 *
 * @param {number} [delayMs=SYNC_DEBOUNCE_MS]
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

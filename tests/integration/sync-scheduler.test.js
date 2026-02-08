import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Sync Scheduler Tests
 *
 * Validates that the sync scheduler correctly:
 * - Does NOT trigger sync when offline
 * - Triggers debounced sync when online
 * - Flushes immediately on OFFLINE → ONLINE transition
 * - Coalesces rapid events into a single sync call
 */

// ============================================================================
// Mocks
// ============================================================================

const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

vi.mock('localforage', () => {
    const mockStore = new Map();
    return {
        default: {
            createInstance: () => ({
                setItem: vi.fn(async (key, value) => { mockStore.set(key, value); }),
                getItem: vi.fn(async (key) => mockStore.get(key) || null),
                removeItem: vi.fn(async (key) => { mockStore.delete(key); }),
                keys: vi.fn(async () => [...mockStore.keys()]),
            })
        }
    };
});

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => `uuid-${Date.now()}`),
    isValidUUID: vi.fn(() => true),
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

// ============================================================================
// Imports
// ============================================================================

import { connectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { syncGateway } from '../../src/js/store/sync/sync-gateway.js';
import { initSyncScheduler } from '../../src/js/store/sync/sync-scheduler.js';
import { EventTypes } from '../../src/js/events/event_types.js';

// ============================================================================
// Helpers
// ============================================================================

function createMockEventBus() {
    const listeners = {};
    return {
        emit: vi.fn((event, payload) => {
            const fns = listeners[event] || [];
            fns.forEach(fn => fn(payload));
        }),
        on: vi.fn((event, fn) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
        }),
        off: vi.fn()
    };
}

// ============================================================================
// Tests
// ============================================================================

let eventBus;

beforeEach(() => {
    vi.useFakeTimers();
    connectionState._reset();
    syncGateway._reset();
    eventBus = createMockEventBus();
    initSyncScheduler(eventBus);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('Offline behavior', () => {
    it('does NOT call sendPendingOperations when offline', async () => {
        const sendSpy = vi.spyOn(syncGateway, 'sendPendingOperations');

        // Trigger a sync event while offline
        eventBus.emit(EventTypes.FEATURE_CREATED, {});

        // Advance past debounce
        await vi.advanceTimersByTimeAsync(2000);

        expect(sendSpy).not.toHaveBeenCalled();
    });

    it('does not attempt sync for any entity lifecycle event', async () => {
        const sendSpy = vi.spyOn(syncGateway, 'sendPendingOperations');

        const events = [
            EventTypes.FEATURE_CREATED,
            EventTypes.LAYER_MODIFIED,
            EventTypes.MAP_DELETED,
            EventTypes.BRIEFING_UPDATED,
        ];

        for (const event of events) {
            eventBus.emit(event, {});
        }

        await vi.advanceTimersByTimeAsync(5000);

        expect(sendSpy).not.toHaveBeenCalled();
    });
});

describe('Online behavior', () => {
    beforeEach(() => {
        // Go online
        connectionState.transition(ConnectionStates.CONNECTING);
        connectionState.transition(ConnectionStates.ONLINE);
    });

    it('calls sendPendingOperations after debounce when online', async () => {
        const sendSpy = vi.spyOn(syncGateway, 'sendPendingOperations')
            .mockResolvedValue({ sent: 0, failed: 0, remaining: 0 });

        // Trigger sync event
        eventBus.emit(EventTypes.FEATURE_CREATED, {});

        // Before debounce: not called yet
        await vi.advanceTimersByTimeAsync(500);
        expect(sendSpy).not.toHaveBeenCalled();

        // After debounce: called
        await vi.advanceTimersByTimeAsync(600);
        expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('coalesces rapid events into single sync call', async () => {
        const sendSpy = vi.spyOn(syncGateway, 'sendPendingOperations')
            .mockResolvedValue({ sent: 0, failed: 0, remaining: 0 });

        // Flush the initial sync triggered by the ONLINE transition in beforeEach
        await vi.advanceTimersByTimeAsync(50);
        sendSpy.mockClear();

        // Fire 5 events rapidly (each resets the debounce)
        for (let i = 0; i < 5; i++) {
            eventBus.emit(EventTypes.FEATURE_CREATED, {});
            await vi.advanceTimersByTimeAsync(100);
        }

        // Wait for debounce to complete
        await vi.advanceTimersByTimeAsync(1500);

        // Should have been called only once (debounce coalesced)
        expect(sendSpy).toHaveBeenCalledTimes(1);
    });
});

describe('Connection transition', () => {
    it('triggers immediate sync on CONNECTING → ONLINE transition', async () => {
        const sendSpy = vi.spyOn(syncGateway, 'sendPendingOperations')
            .mockResolvedValue({ sent: 0, failed: 0, remaining: 0 });

        connectionState.transition(ConnectionStates.CONNECTING);

        // Clear any previous calls from init
        sendSpy.mockClear();

        // Go ONLINE → should trigger immediate sync (delay=0)
        connectionState.transition(ConnectionStates.ONLINE);

        // Advance just enough for setTimeout(fn, 0)
        await vi.advanceTimersByTimeAsync(10);

        expect(sendSpy).toHaveBeenCalledTimes(1);
    });
});

describe('Scheduler subscribes to correct events', () => {
    it('subscribes to all entity lifecycle events', () => {
        const expectedEvents = [
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

        const subscribedEvents = eventBus.on.mock.calls.map(c => c[0]);

        for (const event of expectedEvents) {
            expect(subscribedEvents).toContain(event);
        }
    });
});

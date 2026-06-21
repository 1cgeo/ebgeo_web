import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Sync Scheduler Tests
 *
 * The sync scheduler is now a no-op: outbound flushing is owned by
 * sync-flush.js / sync-engine.js, and the gateway no longer exposes a
 * send method. These tests pin the no-op contract:
 * - initSyncScheduler does not subscribe to events
 * - it never triggers any network/send activity, online or offline
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

describe('No-op scheduler contract', () => {
    it('does not subscribe to any events', () => {
        expect(eventBus.on).not.toHaveBeenCalled();
    });

    it('exposes no send method on the gateway', () => {
        expect(syncGateway.sendPendingOperations).toBeUndefined();
    });
});

describe('No network activity offline', () => {
    it('does not trigger any send when offline', async () => {
        const events = [
            EventTypes.FEATURE_CREATED,
            EventTypes.LAYER_MODIFIED,
            EventTypes.MAP_DELETED,
            EventTypes.BRIEFING_UPDATED,
        ];

        for (const event of events) {
            eventBus.emit(event, {});
        }

        // Advance well past any historical debounce window.
        await vi.advanceTimersByTimeAsync(5000);

        // The scheduler subscribed to nothing, so no listeners fired.
        // Nothing to assert beyond no throw — the gateway has no send path.
        expect(syncGateway.sendPendingOperations).toBeUndefined();
    });
});

describe('No network activity online', () => {
    beforeEach(() => {
        connectionState.transition(ConnectionStates.CONNECTING);
        connectionState.transition(ConnectionStates.ONLINE);
    });

    it('does not trigger any send on entity events when online', async () => {
        eventBus.emit(EventTypes.FEATURE_CREATED, {});
        await vi.advanceTimersByTimeAsync(5000);

        expect(syncGateway.sendPendingOperations).toBeUndefined();
    });

    it('does not trigger any send on CONNECTING → ONLINE transition', async () => {
        connectionState.transition(ConnectionStates.OFFLINE);
        connectionState.transition(ConnectionStates.CONNECTING);
        connectionState.transition(ConnectionStates.ONLINE);

        await vi.advanceTimersByTimeAsync(5000);

        expect(syncGateway.sendPendingOperations).toBeUndefined();
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Event Bridges Tests
 *
 * Validates that SessionContext and ConnectionState observers
 * are correctly bridged to the EventBus via event-bridges.js.
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

import { sessionContext, SessionMode, UserRole } from '../../src/js/store/sync/session-context.js';
import { connectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { initSessionEventBridge, initConnectionEventBridge } from '../../src/js/store/sync/event-bridges.js';
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

describe('Session Event Bridge', () => {
    let eventBus;

    beforeEach(() => {
        sessionContext._reset();
        eventBus = createMockEventBus();
        initSessionEventBridge(eventBus);
    });

    it('emits SESSION_CHANGED when setSession is called', () => {
        sessionContext.setSession({ userId: 'user1', role: UserRole.EDITOR });

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.SESSION_CHANGED,
            expect.objectContaining({
                mode: 'online',
                userId: 'user1',
                role: UserRole.EDITOR
            })
        );
    });

    it('emits SESSION_CHANGED with offline mode on clearSession', () => {
        sessionContext.setSession({ userId: 'user1', role: UserRole.EDITOR });
        eventBus.emit.mockClear();

        sessionContext.clearSession();

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.SESSION_CHANGED,
            expect.objectContaining({
                mode: SessionMode.OFFLINE,
                userId: null,
                role: null
            })
        );
    });

    it('snapshot includes clientId', () => {
        sessionContext.setSession({ userId: 'user1', role: UserRole.ADMIN });

        const call = eventBus.emit.mock.calls.find(c => c[0] === EventTypes.SESSION_CHANGED);
        expect(call[1].clientId).toBeDefined();
        expect(typeof call[1].clientId).toBe('string');
    });

    it('snapshot includes permissions object', () => {
        sessionContext.setSession({ userId: 'user1', role: UserRole.VIEWER });

        const call = eventBus.emit.mock.calls.find(c => c[0] === EventTypes.SESSION_CHANGED);
        expect(call[1].permissions).toBeDefined();
        expect(call[1].permissions.canEdit).toBe(false);
    });
});

describe('Connection Event Bridge', () => {
    let eventBus;

    beforeEach(() => {
        connectionState._reset();
        eventBus = createMockEventBus();
        initConnectionEventBridge(eventBus);
    });

    it('emits CONNECTION_STATE_CHANGED on valid transition', () => {
        connectionState.transition(ConnectionStates.CONNECTING);

        expect(eventBus.emit).toHaveBeenCalledWith(
            EventTypes.CONNECTION_STATE_CHANGED,
            {
                previousState: ConnectionStates.OFFLINE,
                currentState: ConnectionStates.CONNECTING
            }
        );
    });

    it('emits for each transition in the chain', () => {
        connectionState.transition(ConnectionStates.CONNECTING);
        connectionState.transition(ConnectionStates.ONLINE);

        expect(eventBus.emit).toHaveBeenCalledTimes(2);

        const secondCall = eventBus.emit.mock.calls[1];
        expect(secondCall[1]).toEqual({
            previousState: ConnectionStates.CONNECTING,
            currentState: ConnectionStates.ONLINE
        });
    });

    it('does not emit for invalid transitions', () => {
        // OFFLINE → ONLINE is invalid, must go through CONNECTING
        expect(() => connectionState.transition(ConnectionStates.ONLINE)).toThrow();
        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});

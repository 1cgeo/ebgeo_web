import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Offline Regression Test
 *
 * Smoke test that validates all new sync infrastructure modules
 * work correctly in offline mode (the default state).
 * When the backend is eventually implemented, the app must
 * function identically with the user not logged in.
 */

// ============================================================================
// Mocks
// ============================================================================

// Mock localStorage
const localStorageMock = (() => {
    const store = {};
    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock localforage (operation-queue dependency)
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

// Mock uuid
vi.mock('../../src/js/utilities/uuid.js', () => {
    let counter = 0;
    return {
        generateUUID: vi.fn(() => `uuid-${++counter}`),
        isValidUUID: vi.fn(() => true),
    };
});

// Mock store-errors
vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_SYNC_ERROR: 'store:syncError' },
    emitStoreError: vi.fn()
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { sessionContext, SessionMode } from '../../src/js/store/sync/session-context.js';
import { connectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { checkPermission, GuardAction } from '../../src/js/store/sync/permission-guard.js';
import { SyncGateway, syncGateway } from '../../src/js/store/sync/sync-gateway.js';
import { getClientId, createOperation } from '../../src/js/store/sync/operation-factory.js';
import { OperationQueue } from '../../src/js/store/sync/operation-queue.js';
import { EntityType, OperationType } from '../../src/js/store/sync/operation-types.js';
import { memoryStore, resetMemoryStore } from '../../src/js/store/memory-store.js';
import { initSessionEventBridge, initConnectionEventBridge } from '../../src/js/store/sync/event-bridges.js';
import { initSyncScheduler } from '../../src/js/store/sync/sync-scheduler.js';
import { EventTypes } from '../../src/js/events/event_types.js';

beforeEach(() => {
    sessionContext._reset();
    connectionState._reset();
    resetMemoryStore();
});

// ============================================================================
// 1. SessionContext defaults to offline with full permissions
// ============================================================================

describe('SessionContext offline defaults', () => {
    it('starts in offline mode', () => {
        expect(sessionContext.mode).toBe(SessionMode.OFFLINE);
    });

    it('is not authenticated', () => {
        expect(sessionContext.isAuthenticated()).toBe(false);
    });

    it('is offline', () => {
        expect(sessionContext.isOffline()).toBe(true);
    });

    it('getUserId returns clientId when offline', () => {
        const userId = sessionContext.getUserId();
        const clientId = getClientId();
        expect(userId).toBe(clientId);
    });

    it('has full permissions offline', () => {
        expect(sessionContext.canPerformAction('canEdit')).toBe(true);
        expect(sessionContext.canPerformAction('canDelete')).toBe(true);
        expect(sessionContext.canPerformAction('canManageUsers')).toBe(true);
        expect(sessionContext.canPerformAction('canLockMaps')).toBe(true);
    });

    it('clearSession is safe when already offline (idempotent)', () => {
        sessionContext.clearSession();
        expect(sessionContext.mode).toBe(SessionMode.OFFLINE);
        expect(sessionContext.canPerformAction('canEdit')).toBe(true);
    });
});

// ============================================================================
// 2. ConnectionState defaults to OFFLINE
// ============================================================================

describe('ConnectionState offline defaults', () => {
    it('starts in OFFLINE state', () => {
        expect(connectionState.getState()).toBe(ConnectionStates.OFFLINE);
    });

    it('isOnline returns false', () => {
        expect(connectionState.isOnline()).toBe(false);
    });

    it('isConnected returns false', () => {
        expect(connectionState.isConnected()).toBe(false);
    });
});

// ============================================================================
// 3. PermissionGuard allows all actions offline
// ============================================================================

describe('PermissionGuard offline behavior', () => {
    const allActions = Object.values(GuardAction);

    it('allows every guard action when offline', () => {
        for (const action of allActions) {
            const result = checkPermission(action);
            expect(result.allowed).toBe(true);
        }
    });
});

// ============================================================================
// 4. SyncGateway is no-op offline
// ============================================================================

describe('SyncGateway offline behavior', () => {
    let gateway;

    beforeEach(() => {
        gateway = new SyncGateway();
    });

    it('exposes no outbound send method (sending lives in sync-engine.flush)', () => {
        expect(gateway.sendPendingOperations).toBeUndefined();
    });

    it('applyRemoteOperation is a no-op', async () => {
        const handler = vi.fn();
        gateway.setRemoteOperationHandler(handler);

        await gateway.applyRemoteOperation({ lamportTimestamp: 100 });

        // Handler should not be called because we're offline
        expect(handler).not.toHaveBeenCalled();
    });
});

// ============================================================================
// 5. OperationQueue works independently of connection state
// ============================================================================

describe('OperationQueue offline operation', () => {
    let queue;

    beforeEach(() => {
        queue = new OperationQueue();
    });

    it('can enqueue, peek, and dequeue operations offline', async () => {
        const op = createOperation(EntityType.FEATURE, OperationType.CREATE, 'f1', 'map1', { id: 'f1' });

        await queue.enqueue(op);
        expect(await queue.count()).toBe(1);

        const peeked = await queue.peek(10);
        expect(peeked).toHaveLength(1);

        await queue.dequeue([op.id]);
        expect(await queue.count()).toBe(0);
    });
});

// ============================================================================
// 6. Memory store per-user undo structure works offline
// ============================================================================

describe('Memory store per-user undo offline', () => {
    it('has per-user undo/redo stacks structure', () => {
        const mapState = memoryStore.maps['Principal'];
        expect(mapState).toBeDefined();
        expect(mapState.undoStacks).toBeDefined();
        expect(mapState.redoStacks).toBeDefined();
        expect(typeof mapState.undoStacks).toBe('object');
        expect(typeof mapState.redoStacks).toBe('object');
    });

    it('undo stacks keyed by userId work with clientId', () => {
        const userId = sessionContext.getUserId();
        const mapState = memoryStore.maps['Principal'];

        // Simulate pushing to the user's stack
        if (!mapState.undoStacks[userId]) {
            mapState.undoStacks[userId] = [];
        }
        mapState.undoStacks[userId].push({ type: 'add', featureType: 'point' });

        expect(mapState.undoStacks[userId]).toHaveLength(1);
        expect(mapState.undoStacks[userId][0].type).toBe('add');
    });

    it('resetMemoryStore restores initial per-user structure', () => {
        memoryStore.maps['Principal'].undoStacks['some-user'] = [{ type: 'add' }];
        resetMemoryStore();

        const mapState = memoryStore.maps['Principal'];
        expect(mapState.undoStacks).toEqual({});
        expect(mapState.redoStacks).toEqual({});
    });
});

// ============================================================================
// 7. Round-trip: session offline → online → offline preserves behavior
// ============================================================================

describe('Session round-trip regression', () => {
    it('going online then back to offline restores full permissions', () => {
        // Start offline
        expect(sessionContext.canPerformAction('canEdit')).toBe(true);
        expect(sessionContext.canPerformAction('canManageUsers')).toBe(true);

        // Login as viewer (limited permissions)
        sessionContext.setSession({ userId: 'user1', role: 'viewer' });
        expect(sessionContext.canPerformAction('canEdit')).toBe(false);
        expect(sessionContext.canPerformAction('canManageUsers')).toBe(false);

        // Logout back to offline
        sessionContext.clearSession();
        expect(sessionContext.mode).toBe(SessionMode.OFFLINE);
        expect(sessionContext.canPerformAction('canEdit')).toBe(true);
        expect(sessionContext.canPerformAction('canManageUsers')).toBe(true);
    });

    it('getUserId switches between userId and clientId correctly', () => {
        const clientId = getClientId();

        // Offline: returns clientId
        expect(sessionContext.getUserId()).toBe(clientId);

        // Online: returns userId
        sessionContext.setSession({ userId: 'authenticated-user-123', role: 'editor' });
        expect(sessionContext.getUserId()).toBe('authenticated-user-123');

        // Back to offline: returns clientId again
        sessionContext.clearSession();
        expect(sessionContext.getUserId()).toBe(clientId);
    });
});

// ============================================================================
// 8. Permission guard integrated in operations still allows everything offline
// ============================================================================

describe('Permission guard allows all operations offline', () => {
    it('allows all CRUD guard actions when offline (default state)', () => {
        expect(sessionContext.isOffline()).toBe(true);

        const crudActions = [
            GuardAction.CREATE_FEATURE,
            GuardAction.UPDATE_FEATURE,
            GuardAction.DELETE_FEATURE,
            GuardAction.CREATE_LAYER,
            GuardAction.UPDATE_LAYER,
            GuardAction.DELETE_LAYER,
            GuardAction.CREATE_MAP,
            GuardAction.UPDATE_MAP,
            GuardAction.DELETE_MAP,
            GuardAction.CREATE_GROUP,
            GuardAction.UPDATE_GROUP,
            GuardAction.DELETE_GROUP,
            GuardAction.CREATE_BRIEFING,
            GuardAction.UPDATE_BRIEFING,
            GuardAction.DELETE_BRIEFING,
        ];

        for (const action of crudActions) {
            const result = checkPermission(action);
            expect(result.allowed).toBe(true);
        }
    });

    it('allows administrative actions when offline', () => {
        expect(sessionContext.isOffline()).toBe(true);

        const adminActions = [
            GuardAction.LOCK_MAP,
            GuardAction.MANAGE_USERS,
            GuardAction.IMPORT_DATA,
            GuardAction.CLEAR_ALL_DATA,
        ];

        for (const action of adminActions) {
            const result = checkPermission(action);
            expect(result.allowed).toBe(true);
        }
    });

    it('permission check has negligible cost (sync call, no async)', () => {
        // Verify checkPermission is synchronous and fast
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            checkPermission(GuardAction.CREATE_FEATURE);
        }
        const elapsed = performance.now() - start;

        // 1000 calls should take <50ms (typically <5ms)
        expect(elapsed).toBeLessThan(50);
    });
});

// ============================================================================
// 9. Sync scheduler does NOT trigger network activity offline
// ============================================================================

describe('Sync scheduler offline no-op', () => {
    let eventBus;

    beforeEach(() => {
        vi.useFakeTimers();
        connectionState._reset();
        eventBus = createMockEventBus();
        initSyncScheduler(eventBus);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not trigger any network activity when offline', async () => {
        // The scheduler is a no-op; the gateway exposes no send path.
        expect(syncGateway.sendPendingOperations).toBeUndefined();

        // Emit entity lifecycle events while offline
        eventBus.emit(EventTypes.FEATURE_CREATED, {});
        eventBus.emit(EventTypes.LAYER_MODIFIED, {});
        eventBus.emit(EventTypes.MAP_DELETED, {});

        // Wait well past any historical debounce window
        await vi.advanceTimersByTimeAsync(5000);

        // Still no send path exists.
        expect(syncGateway.sendPendingOperations).toBeUndefined();
    });
});

// ============================================================================
// 10. Event bridges emit events correctly even in offline state
// ============================================================================

describe('Event bridges offline behavior', () => {
    it('session bridge emits SESSION_CHANGED with offline snapshot', () => {
        const eventBus = createMockEventBus();
        initSessionEventBridge(eventBus);

        // Trigger session change (login then logout)
        sessionContext.setSession({ userId: 'temp', role: 'editor' });
        sessionContext.clearSession();

        // Should have emitted SESSION_CHANGED twice
        const sessionCalls = eventBus.emit.mock.calls.filter(
            c => c[0] === EventTypes.SESSION_CHANGED
        );
        expect(sessionCalls.length).toBe(2);

        // Last call should be offline snapshot
        const offlineSnapshot = sessionCalls[1][1];
        expect(offlineSnapshot.mode).toBe('offline');
        expect(offlineSnapshot.userId).toBe(null);
    });

    it('connection bridge does not emit when staying offline', () => {
        const eventBus = createMockEventBus();
        initConnectionEventBridge(eventBus);

        // No transitions happen → no events emitted
        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Helper
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

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Permission-Guarded Operations Tests
 *
 * Validates that store operations correctly check permissions
 * and block operations when the user has insufficient role.
 * Verifies that offline mode (default) still allows everything.
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

vi.mock('../../src/js/utilities/uuid.js', () => {
    let counter = 0;
    return {
        generateUUID: vi.fn(() => `uuid-${++counter}`),
        isValidUUID: vi.fn(() => true),
    };
});

const emitStoreErrorMock = vi.fn();
vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_SYNC_ERROR: 'store:syncError',
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked'
    },
    emitStoreError: (...args) => emitStoreErrorMock(...args),
    setStoreErrorEventBus: vi.fn()
}));

// The role-based gate applies ONLY to a connected REMOTE atlas. In this suite "online" means
// "connected to a remote atlas", so default isRemoteStoreSync → true (the role gate is active);
// the offline describes are permitted via checkPermission's isOffline() short-circuit regardless.
// Other store-origin exports are no-ops (the guarded ops under test never touch them).
vi.mock('../../src/js/store/store-origin.js', () => ({
    StoreOriginKind: { LOCAL: 'local', REMOTE: 'remote' },
    isRemoteStoreSync: vi.fn(() => true),
    getStoreOriginSync: vi.fn(() => ({ kind: 'remote', atlasId: 'atlas-1' })),
    loadStoreOrigin: vi.fn(async () => ({ kind: 'remote', atlasId: 'atlas-1' })),
    setStoreOrigin: vi.fn(async () => {}),
    markStoreRemote: vi.fn(async () => {}),
    markStoreLocal: vi.fn(async () => {}),
}));

// ============================================================================
// Imports
// ============================================================================

import { sessionContext, UserRole } from '../../src/js/store/sync/session-context.js';
import { checkPermission, GuardAction } from '../../src/js/store/sync/permission-guard.js';

beforeEach(() => {
    sessionContext._reset();
    emitStoreErrorMock.mockClear();
});

// ============================================================================
// 1. Offline mode: all permissions granted
// ============================================================================

describe('Offline mode permissions', () => {
    it('allows all GuardActions when offline', () => {
        expect(sessionContext.isOffline()).toBe(true);

        const allActions = Object.keys(GuardAction);
        for (const action of allActions) {
            const result = checkPermission(action);
            expect(result.allowed).toBe(true);
        }
    });
});

// ============================================================================
// 2. Online mode: role-based permissions
// ============================================================================

describe('Online mode with Editor role', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'editor-1', role: UserRole.EDITOR });
    });

    it('allows CREATE_FEATURE', () => {
        const result = checkPermission(GuardAction.CREATE_FEATURE);
        expect(result.allowed).toBe(true);
    });

    it('allows UPDATE_FEATURE', () => {
        const result = checkPermission(GuardAction.UPDATE_FEATURE);
        expect(result.allowed).toBe(true);
    });

    it('allows DELETE_FEATURE', () => {
        const result = checkPermission(GuardAction.DELETE_FEATURE);
        expect(result.allowed).toBe(true);
    });

    it('allows CREATE_LAYER', () => {
        const result = checkPermission(GuardAction.CREATE_LAYER);
        expect(result.allowed).toBe(true);
    });

    it('allows CREATE_MAP', () => {
        const result = checkPermission(GuardAction.CREATE_MAP);
        expect(result.allowed).toBe(true);
    });

    it('blocks LOCK_MAP (requires canLockMaps)', () => {
        const result = checkPermission(GuardAction.LOCK_MAP);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('canLockMaps');
    });

    it('blocks MANAGE_USERS', () => {
        const result = checkPermission(GuardAction.MANAGE_USERS);
        expect(result.allowed).toBe(false);
    });
});

describe('Online mode with Viewer role', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'viewer-1', role: UserRole.VIEWER });
    });

    it('blocks all write operations', () => {
        const writeActions = [
            'CREATE_FEATURE', 'UPDATE_FEATURE', 'DELETE_FEATURE',
            'CREATE_LAYER', 'UPDATE_LAYER', 'DELETE_LAYER',
            'CREATE_MAP', 'UPDATE_MAP', 'DELETE_MAP',
            'CREATE_GROUP', 'UPDATE_GROUP', 'DELETE_GROUP',
            'CREATE_BRIEFING', 'UPDATE_BRIEFING', 'DELETE_BRIEFING',
            'IMPORT_DATA', 'CLEAR_ALL_DATA',
            'LOCK_MAP', 'MANAGE_USERS'
        ];

        for (const action of writeActions) {
            const result = checkPermission(action);
            expect(result.allowed).toBe(false);
        }
    });
});

describe('Online mode with Admin role', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'admin-1', role: UserRole.ADMIN });
    });

    it('allows all operations including LOCK_MAP and MANAGE_USERS', () => {
        const allActions = Object.keys(GuardAction);
        for (const action of allActions) {
            const result = checkPermission(action);
            expect(result.allowed).toBe(true);
        }
    });
});

describe('Online mode with Owner role', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'owner-1', role: UserRole.OWNER });
    });

    it('allows all operations', () => {
        const allActions = Object.keys(GuardAction);
        for (const action of allActions) {
            const result = checkPermission(action);
            expect(result.allowed).toBe(true);
        }
    });
});

// ============================================================================
// 3. Round-trip: offline → online → offline
// ============================================================================

describe('Offline → Online → Offline round-trip', () => {
    it('permissions are fully restored on logout', () => {
        // Offline: full permissions
        expect(checkPermission(GuardAction.CREATE_FEATURE).allowed).toBe(true);
        expect(checkPermission(GuardAction.MANAGE_USERS).allowed).toBe(true);

        // Login as Viewer: blocked
        sessionContext.setSession({ userId: 'viewer-1', role: UserRole.VIEWER });
        expect(checkPermission(GuardAction.CREATE_FEATURE).allowed).toBe(false);
        expect(checkPermission(GuardAction.MANAGE_USERS).allowed).toBe(false);

        // Logout: full permissions again
        sessionContext.clearSession();
        expect(sessionContext.isOffline()).toBe(true);
        expect(checkPermission(GuardAction.CREATE_FEATURE).allowed).toBe(true);
        expect(checkPermission(GuardAction.MANAGE_USERS).allowed).toBe(true);
    });

    it('multiple login/logout cycles work correctly', () => {
        for (let i = 0; i < 3; i++) {
            sessionContext.setSession({ userId: `user-${i}`, role: UserRole.EDITOR });
            expect(checkPermission(GuardAction.LOCK_MAP).allowed).toBe(false);

            sessionContext.clearSession();
            expect(checkPermission(GuardAction.LOCK_MAP).allowed).toBe(true);
        }
    });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock only operation-factory (sessionContext's sole external dependency)
vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    getClientId: vi.fn(() => 'mock-client-id-123')
}));

// The role-based gate applies ONLY to a connected REMOTE atlas (store-origin). Mock it so the
// online-role describes below exercise the gate (default REMOTE); the local-store describe flips it.
vi.mock('../../src/js/store/store-origin.js', () => ({ isRemoteStoreSync: vi.fn(() => true) }));

// NO mock of session-context — use the REAL singleton + ROLE_PERMISSIONS
import { checkPermission, assertPermission, GuardAction } from '../../src/js/store/sync/permission-guard.js';
import { sessionContext, UserRole } from '../../src/js/store/sync/session-context.js';
import { isRemoteStoreSync } from '../../src/js/store/store-origin.js';

beforeEach(() => {
    sessionContext._reset(); // restores OFFLINE mode with full permissions
    isRemoteStoreSync.mockReturnValue(true); // default: connected to a remote atlas (role gate active)
});

// ============================================================================
// Offline mode (default) — real sessionContext in OFFLINE mode
// ============================================================================

describe('Offline mode', () => {
    it('allows all actions when offline', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online — Viewer role (real ROLE_PERMISSIONS lookup)
// ============================================================================

describe('Online — Viewer', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-1', role: UserRole.VIEWER });
    });

    it('blocks CREATE_FEATURE (viewer cannot edit)', () => {
        const result = checkPermission('CREATE_FEATURE');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('viewer');
    });

    it('blocks DELETE_MAP (viewer cannot delete)', () => {
        const result = checkPermission('DELETE_MAP');
        expect(result.allowed).toBe(false);
    });

    it('blocks MANAGE_USERS', () => {
        expect(checkPermission('MANAGE_USERS').allowed).toBe(false);
    });

    it('blocks LOCK_MAP', () => {
        expect(checkPermission('LOCK_MAP').allowed).toBe(false);
    });
});

// ============================================================================
// Online — Editor role
// ============================================================================

describe('Online — Editor', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-2', role: UserRole.EDITOR });
    });

    it('allows CREATE_FEATURE (editor can edit)', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
    });

    it('allows DELETE_FEATURE (editor can delete)', () => {
        expect(checkPermission('DELETE_FEATURE')).toEqual({ allowed: true });
    });

    it('blocks LOCK_MAP (editor cannot lock)', () => {
        const result = checkPermission('LOCK_MAP');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('editor');
    });

    it('blocks MANAGE_USERS (editor cannot manage)', () => {
        expect(checkPermission('MANAGE_USERS').allowed).toBe(false);
    });
});

// ============================================================================
// Online — Admin role
// ============================================================================

describe('Online — Admin', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-3', role: UserRole.ADMIN });
    });

    it('allows all actions', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online — Owner role
// ============================================================================

describe('Online — Owner', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-4', role: UserRole.OWNER });
    });

    it('allows all actions', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online but on the LOCAL store (logged in, NOT connected to a server atlas)
// ============================================================================

describe('Online — local store (not connected)', () => {
    beforeEach(() => {
        // A logged-in user whose global role is VIEWER, but working on the LOCAL workspace.
        sessionContext.setSession({ userId: 'u-local', role: UserRole.VIEWER });
        isRemoteStoreSync.mockReturnValue(false);
    });

    it('permits editing despite a viewer role — the local store is always editable (P1)', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Session transitions: offline → online → offline
// ============================================================================

describe('Session transitions', () => {
    it('offline → viewer → offline restores full permissions', () => {
        // Start offline — allowed
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(true);

        // Go online as viewer — blocked
        sessionContext.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(false);

        // Back to offline — allowed again
        sessionContext.clearSession();
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(true);
    });
});

// ============================================================================
// assertPermission
// ============================================================================

describe('assertPermission', () => {
    it('does not throw when allowed (offline)', () => {
        expect(() => assertPermission('CREATE_FEATURE')).not.toThrow();
    });

    it('throws PermissionError with correct fields when denied', () => {
        sessionContext.setSession({ userId: 'u1', role: UserRole.VIEWER });

        try {
            assertPermission('DELETE_MAP');
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error.name).toBe('PermissionError');
            expect(error.action).toBe('DELETE_MAP');
            expect(error.message).toContain('viewer');
        }
    });
});

// ============================================================================
// GuardAction mapping completeness
// ============================================================================

describe('GuardAction covers all expected actions', () => {
    it('has mappings for feature CRUD', () => {
        expect(GuardAction.CREATE_FEATURE).toBeDefined();
        expect(GuardAction.UPDATE_FEATURE).toBeDefined();
        expect(GuardAction.DELETE_FEATURE).toBeDefined();
    });

    it('has mappings for layer CRUD', () => {
        expect(GuardAction.CREATE_LAYER).toBeDefined();
        expect(GuardAction.DELETE_LAYER).toBeDefined();
    });

    it('has mappings for map operations', () => {
        expect(GuardAction.CREATE_MAP).toBeDefined();
        expect(GuardAction.DELETE_MAP).toBeDefined();
        expect(GuardAction.LOCK_MAP).toBeDefined();
    });

    it('has mappings for destructive operations', () => {
        expect(GuardAction.CLEAR_ALL_DATA).toBeDefined();
        expect(GuardAction.DELETE_BRIEFING).toBeDefined();
    });
});

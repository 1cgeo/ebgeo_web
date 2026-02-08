import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock session-context
vi.mock('../../src/js/store/sync/session-context.js', () => {
    const mockContext = {
        isOffline: vi.fn(() => true),
        canPerformAction: vi.fn(() => true),
        role: null
    };
    return {
        sessionContext: mockContext,
        PermissionAction: {
            EDIT: 'canEdit',
            DELETE: 'canDelete',
            MANAGE_USERS: 'canManageUsers',
            LOCK_MAPS: 'canLockMaps'
        }
    };
});

import { checkPermission, assertPermission, GuardAction } from '../../src/js/store/sync/permission-guard.js';
import { sessionContext } from '../../src/js/store/sync/session-context.js';

beforeEach(() => {
    vi.clearAllMocks();
    sessionContext.isOffline.mockReturnValue(true);
    sessionContext.canPerformAction.mockReturnValue(true);
    sessionContext.role = null;
});

// ============================================================================
// Offline mode
// ============================================================================

describe('Offline mode', () => {
    it('always allows all actions when offline', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
    });

    it('does not call canPerformAction when offline', () => {
        checkPermission('CREATE_FEATURE');
        expect(sessionContext.canPerformAction).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Online mode — allowed
// ============================================================================

describe('Online mode — allowed', () => {
    beforeEach(() => {
        sessionContext.isOffline.mockReturnValue(false);
        sessionContext.canPerformAction.mockReturnValue(true);
        sessionContext.role = 'editor';
    });

    it('returns allowed:true for permitted actions', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
    });

    it('checks the correct permission for each action', () => {
        checkPermission('DELETE_MAP');
        expect(sessionContext.canPerformAction).toHaveBeenCalledWith('canDelete');
    });
});

// ============================================================================
// Online mode — denied
// ============================================================================

describe('Online mode — denied', () => {
    beforeEach(() => {
        sessionContext.isOffline.mockReturnValue(false);
        sessionContext.canPerformAction.mockReturnValue(false);
        sessionContext.role = 'viewer';
    });

    it('returns allowed:false with reason', () => {
        const result = checkPermission('CREATE_FEATURE');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Permissão insuficiente');
        expect(result.reason).toContain('viewer');
    });
});

// ============================================================================
// assertPermission
// ============================================================================

describe('assertPermission', () => {
    it('does not throw when allowed', () => {
        expect(() => assertPermission('CREATE_FEATURE')).not.toThrow();
    });

    it('throws PermissionError when denied', () => {
        sessionContext.isOffline.mockReturnValue(false);
        sessionContext.canPerformAction.mockReturnValue(false);
        sessionContext.role = 'viewer';

        try {
            assertPermission('DELETE_MAP');
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error.name).toBe('PermissionError');
            expect(error.action).toBe('DELETE_MAP');
        }
    });
});

// ============================================================================
// GuardAction mapping
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

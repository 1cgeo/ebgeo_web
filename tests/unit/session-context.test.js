import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock operation-factory.js (dependency of session-context.js)
vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    getClientId: vi.fn(() => 'mock-client-id-123')
}));

import {
    SessionContext,
    SessionMode,
    UserRole,
    PermissionAction
} from '../../src/js/store/sync/session-context.js';

let ctx;

beforeEach(() => {
    ctx = new SessionContext();
});

// ============================================================================
// Initial state
// ============================================================================

describe('SessionContext initial state', () => {
    it('starts in offline mode', () => {
        expect(ctx.mode).toBe(SessionMode.OFFLINE);
    });

    it('userId is null when offline', () => {
        expect(ctx.userId).toBeNull();
    });

    it('role is null when offline', () => {
        expect(ctx.role).toBeNull();
    });

    it('is not authenticated when offline', () => {
        expect(ctx.isAuthenticated()).toBe(false);
    });

    it('isOffline returns true', () => {
        expect(ctx.isOffline()).toBe(true);
    });

    it('clientId returns value from operation-factory', () => {
        expect(ctx.clientId).toBe('mock-client-id-123');
    });
});

// ============================================================================
// getUserId
// ============================================================================

describe('getUserId', () => {
    it('returns clientId when offline', () => {
        expect(ctx.getUserId()).toBe('mock-client-id-123');
    });

    it('returns userId when online', () => {
        ctx.setSession({ userId: 'user-abc', role: UserRole.EDITOR });
        expect(ctx.getUserId()).toBe('user-abc');
    });
});

// ============================================================================
// Permissions
// ============================================================================

describe('Permissions', () => {
    it('offline user can perform any action', () => {
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(true);
    });

    it('viewer cannot edit, delete, or comment', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.COMMENT)).toBe(false);
    });

    it('commenter can comment but cannot edit, delete, or manage users', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.COMMENTER });
        expect(ctx.canPerformAction(PermissionAction.COMMENT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(false);
    });

    it('editor can edit and delete but not manage users', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(false);
    });

    it('admin can do everything', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.LOCK_MAPS)).toBe(true);
    });

    it('owner can do everything', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(true);
    });

    it('custom permissions override role defaults', () => {
        ctx.setSession({
            userId: 'u1',
            role: UserRole.VIEWER,
            permissions: { canEdit: true }
        });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
    });
});

// ============================================================================
// setSession / clearSession
// ============================================================================

describe('setSession', () => {
    it('transitions to online mode', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(ctx.mode).toBe(SessionMode.ONLINE);
        expect(ctx.userId).toBe('u1');
        expect(ctx.role).toBe(UserRole.EDITOR);
        expect(ctx.isAuthenticated()).toBe(true);
    });

    it('throws if userId is missing', () => {
        expect(() => ctx.setSession({})).toThrow('userId is required');
        expect(() => ctx.setSession(null)).toThrow();
    });

    it('defaults to viewer if role not provided', () => {
        ctx.setSession({ userId: 'u1' });
        expect(ctx.role).toBe(UserRole.VIEWER);
    });
});

// ============================================================================
// globalRole / isAdmin (global system role, distinct from per-atlas role)
// ============================================================================

describe('globalRole / isAdmin', () => {
    it('globalRole is null and isAdmin is false when offline', () => {
        expect(ctx.globalRole).toBeNull();
        expect(ctx.isAdmin()).toBe(false);
    });

    it('isAdmin is true when globalRole is admin', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        expect(ctx.globalRole).toBe('admin');
        expect(ctx.isAdmin()).toBe(true);
    });

    it('isAdmin is false when globalRole is user', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER, globalRole: 'user' });
        expect(ctx.isAdmin()).toBe(false);
    });

    it('global admin is independent of the per-atlas role (viewer access does not drop admin)', () => {
        // A system admin opening an atlas where they only have VIEWER access stays a system admin.
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN, globalRole: 'admin' });
        expect(ctx.isAdmin()).toBe(true);
        // connect() re-sets only the per-atlas role, omitting globalRole → it must be PRESERVED.
        ctx.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(ctx.role).toBe(UserRole.VIEWER);
        expect(ctx.isAdmin()).toBe(true);
    });

    it('globalRole is preserved when a later setSession omits it', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        ctx.setSession({ userId: 'u1', role: UserRole.OWNER }); // no globalRole
        expect(ctx.globalRole).toBe('admin');
    });

    it('clearSession resets globalRole and isAdmin', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN, globalRole: 'admin' });
        ctx.clearSession();
        expect(ctx.globalRole).toBeNull();
        expect(ctx.isAdmin()).toBe(false);
    });

    it('a visitor is never a global admin', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        ctx.setVisitorSession();
        expect(ctx.globalRole).toBeNull();
        expect(ctx.isAdmin()).toBe(false);
    });

    it('getSnapshot includes globalRole', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, globalRole: 'admin' });
        expect(ctx.getSnapshot().globalRole).toBe('admin');
    });
});

describe('clearSession', () => {
    it('returns to offline mode', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        ctx.clearSession();
        expect(ctx.mode).toBe(SessionMode.OFFLINE);
        expect(ctx.userId).toBeNull();
        expect(ctx.role).toBeNull();
        expect(ctx.isAuthenticated()).toBe(false);
    });

    it('restores full permissions', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);

        ctx.clearSession();
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
    });
});

// ============================================================================
// setVisitorSession (anonymous public view-link)
// ============================================================================

describe('setVisitorSession', () => {
    it('is an online, read-only VIEWER with no account identity', () => {
        ctx.setVisitorSession();
        expect(ctx.mode).toBe(SessionMode.ONLINE);
        expect(ctx.role).toBe(UserRole.VIEWER);
        expect(ctx.userId).toBeNull();
        expect(ctx.isVisitor()).toBe(true);
        // No account: isAuthenticated must stay false so the account menu stays hidden.
        expect(ctx.isAuthenticated()).toBe(false);
    });

    it('cannot edit, delete, or comment (public link is view-only)', () => {
        ctx.setVisitorSession();
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.DELETE)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.COMMENT)).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.MANAGE_USERS)).toBe(false);
    });

    it('clearSession restores offline full control and drops the visitor flag', () => {
        ctx.setVisitorSession();
        ctx.clearSession();
        expect(ctx.isOffline()).toBe(true);
        expect(ctx.isVisitor()).toBe(false);
        expect(ctx.canPerformAction(PermissionAction.EDIT)).toBe(true);
    });
});

// ============================================================================
// Observer
// ============================================================================

describe('onSessionChanged', () => {
    it('notifies on setSession', () => {
        const listener = vi.fn();
        ctx.onSessionChanged(listener);
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            mode: SessionMode.ONLINE,
            userId: 'u1',
            role: UserRole.EDITOR
        }));
    });

    it('notifies on clearSession', () => {
        const listener = vi.fn();
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        ctx.onSessionChanged(listener);
        ctx.clearSession();

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            mode: SessionMode.OFFLINE,
            userId: null
        }));
    });

    it('returns unsubscribe function', () => {
        const listener = vi.fn();
        const unsub = ctx.onSessionChanged(listener);
        unsub();
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR });
        expect(listener).not.toHaveBeenCalled();
    });

    it('throws if callback is not a function', () => {
        expect(() => ctx.onSessionChanged('not a function')).toThrow();
    });

    it('does not crash if listener throws', () => {
        ctx.onSessionChanged(() => { throw new Error('boom'); });
        expect(() => ctx.setSession({ userId: 'u1', role: UserRole.EDITOR })).not.toThrow();
    });
});

// ============================================================================
// getSnapshot
// ============================================================================

describe('getSnapshot', () => {
    it('returns current state as plain object', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        const snap = ctx.getSnapshot();
        expect(snap.mode).toBe(SessionMode.ONLINE);
        expect(snap.userId).toBe('u1');
        expect(snap.clientId).toBe('mock-client-id-123');
        expect(snap.role).toBe(UserRole.ADMIN);
        expect(snap.permissions.canEdit).toBe(true);
    });

    it('snapshot permissions are a copy (not a reference)', () => {
        const snap = ctx.getSnapshot();
        snap.permissions.canEdit = false;
        expect(ctx.permissions.canEdit).toBe(true);
    });
});

// ============================================================================
// _reset
// ============================================================================

describe('_reset', () => {
    it('clears the username (parity with clearSession)', () => {
        ctx.setSession({ userId: 'u1', role: UserRole.EDITOR, username: 'alice' });
        expect(ctx.username).toBe('alice');
        ctx._reset();
        expect(ctx.username).toBeNull();
    });

    it('returns to initial state and clears listeners', () => {
        const listener = vi.fn();
        ctx.onSessionChanged(listener);
        ctx.setSession({ userId: 'u1', role: UserRole.ADMIN });
        ctx._reset();

        expect(ctx.mode).toBe(SessionMode.OFFLINE);
        expect(ctx.userId).toBeNull();

        // Listener should have been cleared
        ctx.setSession({ userId: 'u2', role: UserRole.EDITOR });
        expect(listener).toHaveBeenCalledTimes(1); // Only the first call
    });
});

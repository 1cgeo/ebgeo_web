// Path: js/store/sync/permission-guard.js

/**
 * @fileoverview Permission guard for operation validation.
 * Checks if the current user has permission to perform an action
 * based on their role and the session context.
 *
 * Offline: always permits all actions (full local control).
 * Online: checks role-based permissions from SessionContext.
 *
 * @dependencies session-context.js
 */

import { sessionContext, PermissionAction } from './session-context.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Guard action types.
 * Maps high-level actions to the permission required.
 * @readonly
 * @enum {string}
 */
export const GuardAction = Object.freeze({
    // Feature operations
    CREATE_FEATURE: PermissionAction.EDIT,
    UPDATE_FEATURE: PermissionAction.EDIT,
    DELETE_FEATURE: PermissionAction.DELETE,

    // Layer operations
    CREATE_LAYER: PermissionAction.EDIT,
    UPDATE_LAYER: PermissionAction.EDIT,
    DELETE_LAYER: PermissionAction.DELETE,

    // Map operations
    CREATE_MAP: PermissionAction.EDIT,
    UPDATE_MAP: PermissionAction.EDIT,
    DELETE_MAP: PermissionAction.DELETE,
    LOCK_MAP: PermissionAction.LOCK_MAPS,
    COMBINE_MAPS: PermissionAction.EDIT,

    // Group operations
    CREATE_GROUP: PermissionAction.EDIT,
    UPDATE_GROUP: PermissionAction.EDIT,
    DELETE_GROUP: PermissionAction.DELETE,

    // Import/export
    IMPORT_DATA: PermissionAction.EDIT,
    CLEAR_ALL_DATA: PermissionAction.DELETE,

    // Briefing operations
    CREATE_BRIEFING: PermissionAction.EDIT,
    UPDATE_BRIEFING: PermissionAction.EDIT,
    DELETE_BRIEFING: PermissionAction.DELETE,

    // 3D / 360 operations
    CREATE_MARKER_3D: PermissionAction.EDIT,
    DELETE_MARKER_3D: PermissionAction.DELETE,
    CREATE_MARKER_360: PermissionAction.EDIT,
    DELETE_MARKER_360: PermissionAction.DELETE,

    // Admin
    MANAGE_USERS: PermissionAction.MANAGE_USERS
});

// ============================================================================
// GUARD FUNCTION
// ============================================================================

/**
 * Checks if the current user has permission to perform an action.
 *
 * @param {string} action - Action to check (from GuardAction)
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkPermission(action) {
    // Offline mode: full control
    if (sessionContext.isOffline()) {
        return { allowed: true };
    }

    // Resolve the permission name from the action
    const permissionName = GuardAction[action] || action;
    const allowed = sessionContext.canPerformAction(permissionName);

    if (allowed) {
        return { allowed: true };
    }

    return {
        allowed: false,
        reason: `Permissão insuficiente: ${action} requer ${permissionName} (role atual: ${sessionContext.role})`
    };
}

/**
 * Asserts that the current user has permission, throwing if not.
 *
 * @param {string} action - Action to check (from GuardAction)
 * @throws {PermissionError} If the action is not allowed
 */
export function assertPermission(action) {
    const result = checkPermission(action);
    if (!result.allowed) {
        const error = new Error(result.reason);
        error.name = 'PermissionError';
        error.action = action;
        throw error;
    }
}

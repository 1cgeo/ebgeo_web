// Path: js/store/sync/permission-guard.js

/**
 * Permission guard for operation validation.
 * Checks if the current user has permission to perform an action
 * based on their role and the session context.
 *
 * Offline: always permits all actions (full local control).
 * Online: checks role-based permissions from SessionContext.
 */

import { sessionContext, PermissionAction } from './session-context.js';
import { isRemoteStoreSync } from '../store-origin.js';

/**
 * Maps high-level guard actions to the permission required.
 * @readonly
 */
export const GuardAction = Object.freeze({
    CREATE_FEATURE: PermissionAction.EDIT,
    UPDATE_FEATURE: PermissionAction.EDIT,
    DELETE_FEATURE: PermissionAction.DELETE,

    CREATE_LAYER: PermissionAction.EDIT,
    UPDATE_LAYER: PermissionAction.EDIT,
    DELETE_LAYER: PermissionAction.DELETE,

    CREATE_MAP: PermissionAction.EDIT,
    UPDATE_MAP: PermissionAction.EDIT,
    DELETE_MAP: PermissionAction.DELETE,
    LOCK_MAP: PermissionAction.LOCK_MAPS,
    COMBINE_MAPS: PermissionAction.EDIT,

    CREATE_GROUP: PermissionAction.EDIT,
    UPDATE_GROUP: PermissionAction.EDIT,
    DELETE_GROUP: PermissionAction.DELETE,

    // Spatial comments: gated by the COMMENT capability (Comentarista and up). The finer
    // author-or-editor rule for editing/deleting a specific comment is enforced in the comment
    // operations + backend, not by this coarse capability gate.
    CREATE_COMMENT: PermissionAction.COMMENT,
    UPDATE_COMMENT: PermissionAction.COMMENT,
    DELETE_COMMENT: PermissionAction.COMMENT,

    IMPORT_DATA: PermissionAction.EDIT,
    CLEAR_ALL_DATA: PermissionAction.DELETE,

    CREATE_BRIEFING: PermissionAction.EDIT,
    UPDATE_BRIEFING: PermissionAction.EDIT,
    DELETE_BRIEFING: PermissionAction.DELETE,

    CREATE_MARKER_3D: PermissionAction.EDIT,
    DELETE_MARKER_3D: PermissionAction.DELETE,
    CREATE_MARKER_360: PermissionAction.EDIT,
    DELETE_MARKER_360: PermissionAction.DELETE,

    MANAGE_USERS: PermissionAction.MANAGE_USERS
});

/**
 * Checks if the current user has permission to perform an action.
 *
 * @param {string} action - Action key from GuardAction (e.g. 'CREATE_FEATURE')
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkPermission(action) {
    // Full local control whenever the store is the user's OWN local workspace — offline/anonymous OR
    // authenticated but NOT connected to a server atlas. The role-based gate applies ONLY to a
    // connected REMOTE atlas; the local store is always editable (offline-first, P1). Without this a
    // logged-in user whose global role is `viewer` could not even draw on their own local store.
    if (sessionContext.isOffline() || !isRemoteStoreSync()) {
        return { allowed: true };
    }

    const permissionName = GuardAction[action] || action;

    if (sessionContext.canPerformAction(permissionName)) {
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
 * @param {string} action - Action key from GuardAction (e.g. 'CREATE_FEATURE')
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

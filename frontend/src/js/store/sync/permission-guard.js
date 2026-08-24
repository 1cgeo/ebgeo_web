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
    // The key for editing the map document AND its per-map settings, which travel as separate
    // sync entities but answer to ONE authority on the server: `assertOperationAllowed` refuses
    // every non-comment write from a reader, whatever the target. So map notes, grid style and
    // temporal config gate on this key too, and get no key of their own, because a client gate
    // finer than the server's could only refuse work the server would have accepted.
    //
    // FIVE writers consulted NO gate at all until 2026-08-23: map notes, grid style, temporal
    // config, `setBaseLayer` and `updateMapPosition`. The reader was offered the control, the op
    // was queued, the push came back 403 and the OUTBOUND QUEUE STOPPED, with a message blaming
    // the user's access for a button the screen itself had offered. The shape to look for when
    // writing a new one: an operation that calls a `logXxxOperation` and no `checkPermission`.
    // The trigger is enqueuing a sync op, not how important the operation looks.
    UPDATE_MAP: PermissionAction.EDIT,
    DELETE_MAP: PermissionAction.DELETE_MAP,
    LOCK_MAP: PermissionAction.LOCK_MAPS,
    // Combining EMPTIES the source maps into a target and cannot be undone: which
    // feature came from which map is not recorded anywhere. That makes it a
    // management action, gated exactly like DELETE_MAP, and it matches the server,
    // where POST /maps/:id/merge requires 'manage'.
    //
    // It was mapped to EDIT and, worse, never consulted — the only reference to this
    // key in the whole repository was its own definition, so an Editor could combine
    // maps freely under the CREATE_FEATURE gate the local implementation happens to
    // use. Now enforced in map.manager.combineSelectedMapsIntoTarget.
    COMBINE_MAPS: PermissionAction.DELETE_MAP,

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

    // Writes that land on `atlas.settings` rather than on a map document: the appearance
    // (terrain exaggeration and friends) and the custom-icon registry. They travel as a
    // `setting` sync op, which the server refuses from a reader like any other write, so they
    // need the same gate as the map settings above. Separate key from `UPDATE_MAP` because the
    // OBJECT is different, not because the authority is: both resolve to EDIT today.
    UPDATE_ATLAS_SETTINGS: PermissionAction.EDIT,

    MANAGE_USERS: PermissionAction.MANAGE_USERS
});

/**
 * Checks if the current user has permission to perform an action.
 *
 * THE REFUSAL CARRIES THE CAPABILITY, not just prose. `reason` is a DEVELOPER string (it names
 * the action, the flag and the current role, and tests assert on it); it is unfit for a toast,
 * and using it as one was never the plan. What the screen needs is `required`, the
 * `PermissionAction` flag the gate actually consulted, which `denialNotice`
 * (`store/denial-phrases.js`) turns into a sentence that is true for whoever reads it.
 *
 * Before this, every refusal reached the user as one canned sentence claiming read-only access,
 * which was false for every level above Visualizador. See that module's fileoverview.
 *
 * @param {string} action - Action key from GuardAction (e.g. 'CREATE_FEATURE')
 * @returns {{ allowed: boolean, reason?: string, action?: string, required?: string }}
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
        action,
        required: permissionName,
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

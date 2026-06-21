// Path: js/sidebar/tabs/remote-map-redirect.js

/**
 * @fileoverview Pure decision logic for §1.9 "redirect viewers when the map they
 * are viewing is deleted by another user". Kept pure (no DOM/store side effects) so
 * it is unit-testable; the maps tab performs the actual map switch.
 */

/**
 * Decides which map to switch to when a REMOTE operation is applied. Returns the
 * target map NAME to switch to, or null when no redirect is needed.
 *
 * A redirect is needed only when the applied op is a remote MAP DELETE whose target
 * is the map the user is currently viewing, and another map exists to switch to.
 *
 * @param {Object} operation - The applied remote operation ({ entityType, operationType, entityId }).
 * @param {Object} ctx
 * @param {string} ctx.currentMapName - The map the user is currently viewing.
 * @param {string[]} ctx.allMapNames - All known map names (incl. the just-deleted one).
 * @param {(id: string) => (string|undefined)} ctx.getNameForId - Resolves a map UUID to its name.
 * @returns {string|null} The map name to switch to, or null.
 */
export function resolveRedirectTarget(operation, { currentMapName, allMapNames, getNameForId }) {
    if (!operation || operation.entityType !== 'map' || operation.operationType !== 'delete') {
        return null;
    }
    const deletedName = getNameForId(operation.entityId);
    if (!deletedName || deletedName !== currentMapName) {
        return null;
    }
    const other = (allMapNames || []).find((name) => name !== deletedName);
    return other || null;
}

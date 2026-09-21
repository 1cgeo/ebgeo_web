// Path: js/tool_manager/edit-surface.js

/**
 * @fileoverview WHEN THE MAP IS INERT TO EDITING GESTURES: no edit handles on selection, no drag.
 *
 * TWO REASONS, ONE BEHAVIOUR (owner, 2026-09-20: "era para funcionar igual o cadeado"). Until then
 * only the MAP LOCK made the surface inert. A person whose level cannot edit (Leitor, Comentarista,
 * the anonymous visitor of a public link) still got the vertex handles on click and could DRAG a
 * feature: the map painted the move, the store refused the write, and the screen was left showing
 * a geometry that exists nowhere, until the next remote op repainted the source. Measured on a
 * public visit: the polygon moved on screen under the toast that said the level does not allow
 * editing.
 *
 * THE ROLE QUESTION IS ASKED THROUGH THE GUARD, never by comparing roles here: the guard is
 * permissive offline and on a local atlas, so this predicate changes nothing for them, and it
 * answers by CAPABILITY (`GuardAction.UPDATE_FEATURE`), so a level born later between two others
 * lands on the right side without an edit here.
 *
 * IT FAILS CLOSED WHILE THE ROLE IS STILL THE BOOT SEED: the seed is Leitor, so a selection made in
 * the instant before the server answers gets no handles. Selecting again after that draws them.
 *
 * SILENT, LIKE THE LOCK. Selecting a feature to READ it is the legitimate gesture of a reader, and
 * a toast on every click would punish it. The refusal that speaks is still the store's, on the
 * gestures that are unambiguous writes (delete, paste, the attribute panel).
 */

import { isCurrentMapLockedSync } from '@store/map.operations.js';
import { checkPermission, GuardAction } from '@store/sync/permission-guard.js';

/**
 * @returns {boolean} True when selection must not draw edit handles and a drag must not start.
 */
export function isEditSurfaceInert() {
    if (isCurrentMapLockedSync()) return true;
    return !checkPermission(GuardAction.UPDATE_FEATURE).allowed;
}

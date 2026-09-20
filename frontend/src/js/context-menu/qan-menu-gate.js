// Path: js/context-menu/qan-menu-gate.js

/**
 * @fileoverview WHETHER the map's right-click menu offers "Exportar QAN", as a PURE
 * decision. Zero imports, so it runs in plain node and the gate can be pinned without
 * loading `context-menu.control.js`, which pulls the store barrel and MapLibre.
 *
 * ================= WHAT CHANGED, AND WHY IT IS NOT A BUG =====================
 *
 * The menu used to offer the export for `line` AND `polygon`. Since 2026-09-20 the
 * right-click menu offers it for POLYGON ONLY (owner's request). Nothing about the
 * generator changed: `generateQAN` (`js/import_export/qan/qan-export.js`) still turns a
 * LINE into one row per leg, and the suite that pins it (`tests/unit/qan-export.test.js`)
 * still covers both shapes. Narrowing the generator to match this menu would break the
 * OTHER door, which is the point below.
 *
 * ================= THE OTHER DOOR, WHICH STAYS ===============================
 *
 * A line still exports a QAN from the feature panel: the "Azimutes" tab draws an
 * "Exportar QAN" button through `createObservationsSection`
 * (`js/tool_manager/helpers/observations-editor.helpers.js`), for line and polygon alike.
 * That door was NOT part of the request, so it is declared here rather than silently
 * assumed away: whoever reads this gate and concludes "a line can no longer produce a
 * QAN" is wrong, and would be wrong in the direction that gets the second door removed by
 * accident.
 *
 * ================= WHY A MODULE FOR ONE PREDICATE ============================
 *
 * The same reason `clipboard-menu-actions.js` exists next door: a gate written inline in
 * the drawing code can only be checked by reading the drawing code. Here the decision is
 * a function the unit suite calls directly, and the structural half of
 * `tests/unit/qan-fora-do-menu-de-linha.test.js` pins that the menu still CONSULTS it, so
 * that a future inline `source === 'line'` cannot resurrect the item while this file
 * stays green as dead code.
 */

/**
 * Whether the right-click menu should offer the QAN export for the current selection.
 *
 * Single selection only, and only a polygon. Fails CLOSED: a missing `properties`, a
 * non-array argument or any other `source` yields `false`, because losing a menu item
 * costs less than offering an export the generator cannot fill.
 *
 * @param {Array<Object>} [selectedFeatures] - Currently selected features
 * @returns {boolean} True when the "Exportar QAN" item should be drawn
 */
export function canExportQAN(selectedFeatures) {
    if (!Array.isArray(selectedFeatures) || selectedFeatures.length !== 1) return false;
    return selectedFeatures[0]?.properties?.source === 'polygon';
}

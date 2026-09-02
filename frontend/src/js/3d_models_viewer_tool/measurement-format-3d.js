// Path: js/3d_models_viewer_tool/measurement-format-3d.js

/**
 * @fileoverview Result formatting for 3D measurements (distance and area).
 *
 * Pure module, ZERO imports, node-testable. It exists because a 3D measurement
 * persists a `formatted` string alongside the numeric value AND is a sync
 * entity (`measurement3d`), so that string TRAVELS to the collaborator: changing
 * only the formatter would leave every record saved by an older build showing
 * the old unit forever, on both machines. Both the tool (Cesium labels) and the
 * panel therefore derive the text from the VALUE and fall back to the stored
 * string only when there is no value to derive from, which is what makes a peer
 * on a new build read m2/km2 even when the op it received carries "ha".
 *
 * Hectares were REMOVED from the 3D area formatter on 2026-09-02 at the owner's
 * request: 3D areas now read in square metres below 1 km2 and in square
 * kilometres above it. The 2D measurement tool is untouched and keeps its own
 * unit selector, where hectares are one of the units the user may pick; do not
 * "align" the two.
 *
 * It lives at the ROOT of 3d_models_viewer_tool/, not under tools/ or
 * services/, because the chunk rules in vite.config.js route those two folders
 * to the lazy cesium-integration group, and this module is shared with
 * components/measurement-panel-3d.js. The name avoids the substring
 * `measurement_tool` for the same reason in the other direction: that rule
 * pins anything matching it to core.
 *
 * Do not expect the placement to MOVE it, though: this was measured on 2026-09-02
 * with vite build plus the emitted sourcemaps, and the result is not the intuitive
 * one. Rolldown co-locates this unassigned leaf with its importers, so it lands in
 * a cesium-integration-* chunk of its own (one source) anyway. That costs nothing,
 * because both importers are themselves lazy, and it is the same thing that happens
 * to the keyboard-service-3d pinned to core by an older rule in the same block.
 * A control build with the panel import removed showed the panel chunk ALREADY
 * importing a cesium-integration-* chunk statically (the modals one, for showConfirm),
 * so this module did not create that edge.
 *
 * Non-finite input is not guarded on purpose, matching the private helpers this
 * replaced: NaN yields 'NaN m2' and Infinity yields 'Infinity km2'. A negative
 * value falls into the metre branch ('-5.00 m2'), since the comparison is a
 * plain `>=` against the upper bound.
 */

/**
 * Formats a distance in metres.
 * Boundary: >= 1000 m reads in kilometres, both branches with 2 decimals.
 * @param {number} meters - Distance in metres
 * @returns {string} Formatted distance, e.g. '523.45 m' or '1.23 km'
 */
export function formatDistance3D(meters) {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(2)} m`;
}

/**
 * Formats an area in square metres.
 * Boundary: >= 1e6 m2 reads in square kilometres, both branches with 2
 * decimals. There is no hectare branch (see the file header).
 * @param {number} sqMeters - Area in square metres
 * @returns {string} Formatted area, e.g. '10000.00 m2' or '1.00 km2'
 */
export function formatArea3D(sqMeters) {
    if (sqMeters >= 1000000) {
        return `${(sqMeters / 1000000).toFixed(2)} km²`;
    }
    return `${sqMeters.toFixed(2)} m²`;
}

/**
 * Formats a stored measurement's result, deriving the text from the numeric
 * value whenever there is one so that a record saved (or received by sync) when
 * 3D areas still read in hectares displays the current units.
 * @param {Object} measurement - Stored measurement
 * @param {string} measurement.type - 'distance' | 'area'
 * @param {Object} [measurement.result] - { value, formatted }
 * @returns {string|null} Formatted result, the legacy stored string when there
 *   is no usable value, or null when there is neither.
 */
export function formatMeasurementResult3D(measurement) {
    const result = measurement?.result;
    const value = result?.value;

    if (typeof value === 'number' && Number.isFinite(value)) {
        return measurement.type === 'area'
            ? formatArea3D(value)
            : formatDistance3D(value);
    }

    if (typeof result?.formatted === 'string' && result.formatted !== '') {
        return result.formatted;
    }

    return null;
}

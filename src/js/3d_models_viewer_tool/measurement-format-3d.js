// Path: js/3d_models_viewer_tool/measurement-format-3d.js

/**
 * @fileoverview Result formatting for 3D measurements (distance and area).
 *
 * Pure module, ZERO imports, node-testable. It exists because 3D measurements
 * persist a `formatted` string alongside the numeric value: changing only the
 * formatter would leave old records displaying the old unit forever, so both
 * the tool (Cesium labels) and the panel derive the text from the VALUE and
 * fall back to the stored string only when there is no value to derive from.
 *
 * Hectares were REMOVED from the 3D area formatter on 2026-09-02 at the
 * owner's request: 3D areas now read in m² below 1 km² and in km² above it.
 * The 2D measurement tool is untouched and keeps its own unit selector
 * (`measurement_tool/measurement-geometry.js`), where hectares are one of the
 * units the user may pick; do not "align" the two.
 *
 * It lives at the ROOT of 3d_models_viewer_tool/, not under tools/, because
 * the chunking rules in vite.config.js route tools/ and services/ to the lazy
 * cesium-integration chunk and this module is shared with
 * components/measurement-panel-3d.js, which the sidebar reaches through
 * import(). Keep it out of tools/ and services/ for that reason, but do not
 * expect the placement to move it: everything below was MEASURED on
 * 2026-09-02 with `vite build` plus the emitted sourcemaps, and none of it
 * matches the intuition.
 *
 * 1. A manualChunks pin to core is a no-op here. Same chunk and same chunk
 *    hash with and without the rule; the pre-existing keyboard-service-3d pin
 *    from the same block also lands in cesium-integration.
 * 2. At the folder root the module STILL lands in cesium-integration, because
 *    Rolldown co-locates an unassigned leaf with its importers.
 * 3. None of that regressed anything: a control build with this import removed
 *    from the panel showed measurement-panel-3d-*.js importing
 *    cesium-integration-*.js anyway, for showConfirm (@modals) and through
 *    panel-shared-3d. The edge predates this module.
 *
 * Non-finite input is not guarded on purpose, matching the previous private
 * helpers: NaN yields 'NaN m²' and Infinity yields 'Infinity km²'. Negative
 * values fall into the metre branch ('-5.00 m²'), since the comparison is a
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
 * Boundary: >= 1e6 m² reads in square kilometres, both branches with 2
 * decimals. There is no hectare branch (see the file header).
 * @param {number} sqMeters - Area in square metres
 * @returns {string} Formatted area, e.g. '10000.00 m²' or '1.00 km²'
 */
export function formatArea3D(sqMeters) {
    if (sqMeters >= 1000000) {
        return `${(sqMeters / 1000000).toFixed(2)} km²`;
    }
    return `${sqMeters.toFixed(2)} m²`;
}

/**
 * Formats a stored measurement's result, deriving the text from the numeric
 * value whenever there is one so that records saved before the hectare removal
 * (or before any future unit change) display the current units.
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

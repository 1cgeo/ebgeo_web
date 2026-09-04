// Path: js/layers/styles/layer.helpers.js

/**
 * @fileoverview Shared helpers for layer setup files.
 *
 * Eliminates repeated source/layer-existence checks across
 * shape, tactical, symbol, content, line, polygon and auxiliary layer modules.
 */

import { writeWholeCollection } from '../geojson-dispatcher.js';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

/**
 * Creates a GeoJSON source with data, or updates it if it already exists.
 *
 * `promoteId: 'id'` is declared HERE and never at a call site: `setStyle()` (base-layer switch)
 * destroys and recreates every custom source, so a promoteId set anywhere else disappears on the
 * first base-layer change and every later `updateData` throws. It is the precondition for the
 * diff dispatcher (`layers/geojson-dispatcher.js`): MapLibre only accepts a diff on a source whose
 * every feature resolves a non-null, unique key.
 *
 * All sources created through this helper carry a unique `properties.id`: points, lines, brushes,
 * circles, rectangles, ellipses, setores, military_symbols, coordination_measures,
 * magnetic_declinations, boundarys, occupied_fronts, coordination_lines, los, processed-los,
 * visibility and processed-visibility. For `los` and `visibility` this is the ONLY id they get,
 * since those two families never wrote a top-level `feature.id`.
 *
 * Two measured notes. First, promoteId changes what MapLibre reports as `feature.id` (integer
 * `geoJsonId` becomes the UUID) and nothing in `src/` reads `feature.id` off one of our GeoJSON
 * sources, so no `queryRenderedFeatures` call site is affected; the single `setFeatureState` user
 * on these sources writes `{ tableHover }` that no paint expression reads. Second, a duplicate key
 * (the derived ids of `add_los_geometry.js` can repeat) does NOT break rendering; it only makes
 * that source refuse diffs, which the dispatcher detects and answers with a whole-collection
 * `setData`.
 *
 * The redraw goes through `writeWholeCollection`, NOT through a raw `setData`, and that is the
 * precondition the dispatcher declares rather than a stylistic preference: this one function is
 * the co-writer of all sixteen migrated sources, so a raw write here would replace MapLibre's
 * pending-update slot and silently drop whatever diff a tool had queued. Sources that no tool
 * migrated take the raw path inside that helper, where there is no queue to lose.
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Source ID
 * @param {Array} features - Array of GeoJSON features
 */
export function setOrCreateSource(map, id, features) {
    const fc = { type: 'FeatureCollection', features };

    if (map.getSource(id)) {
        writeWholeCollection(map, id, fc);
    } else {
        map.addSource(id, { type: 'geojson', data: fc, promoteId: 'id' });
    }
}

/**
 * Adds an empty GeoJSON source if it does not already exist.
 *
 * DELIBERATELY WITHOUT `promoteId`, for two different reasons depending on the source:
 * - the ephemeral ones (`*-feedback`, `*-edit-handles`, `circle-x-marks`, `snap-indicator`,
 *   `selection-boxes`, the separators) hold transient geometry with no `properties.id`, so the key
 *   would resolve to null and the source would be non-diffable anyway. They are not dispatcher
 *   candidates: a handful of features rebuilt per mousemove, where `setData` is already cheap.
 * - `boundary-circles` and `boundary-texts` are BLOCKED, not merely skipped. Their derived
 *   features carry a stable TOP-LEVEL id (`<paiId>-circle-<i>-<j>`) but `properties` without any
 *   `id`, so `promoteId: 'id'` would turn every key into null and leave the source permanently
 *   non-diffable. Enabling them requires writing `properties.id` in
 *   `military_tools/boundary_tool/add_boundary_geometry.js` first, which is a separate change.
 * - the label sources (`polygon-labels`, `circle-labels` and siblings) do have a unique
 *   `properties.id` copied from the parent, but every writer rebuilds them whole (`syncLabelSource`
 *   and the zoom handler), so there is nothing for a diff to save yet.
 * @param {Object} map - MapLibre map instance
 * @param {string} id - Source ID
 */
export function ensureSource(map, id) {
    if (!map.getSource(id)) {
        map.addSource(id, { type: 'geojson', data: EMPTY_FC });
    }
}

/**
 * Adds a MapLibre layer if it does not already exist.
 * @param {Object} map - MapLibre map instance
 * @param {Object} layerDef - Full MapLibre layer definition (must include `id`)
 */
export function ensureLayer(map, layerDef) {
    if (!map.getLayer(layerDef.id)) {
        map.addLayer(layerDef);
    }
}

/**
 * MapLibre expression that maps `lineStyle` property values to dash arrays.
 * Reused by polygon, circle, rectangle, ellipse, and sector outline layers.
 */
export const LINE_STYLE_DASHARRAY = [
    'match',
    ['get', 'lineStyle'],
    'dashed', ['literal', [8, 4]],
    'dotted', ['literal', [2, 3]],
    'dash-dot', ['literal', [8, 4, 2, 4]],
    'long-dash', ['literal', [16, 6]],
    'short-dash', ['literal', [4, 4]],
    'dot-dot-dash', ['literal', [2, 2, 2, 2, 8, 2]],
    ['literal', [1, 0]],
];

/** Visibility filter used on most feature layers. */
export const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

/** Filter for solid fill layers (visible + no hatch). */
export const SOLID_FILL_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['!=', ['get', 'hatchEnabled'], true],
];

/** Filter for hatch-pattern fill layers (visible + hatch enabled + pattern present). */
export const HATCH_FILL_FILTER = [
    'all',
    ['!=', ['get', 'visivel'], false],
    ['==', ['get', 'hatchEnabled'], true],
    ['has', 'hatchPatternId'],
];

/** Standard Point type filter for edit-handle layers. */
export const POINT_TYPE_FILTER = ['==', '$type', 'Point'];

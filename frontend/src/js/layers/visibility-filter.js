// Path: js/layers/visibility-filter.js

/**
 * @fileoverview Layer visibility filter system for MapLibre.
 *
 * This module writes NO data: it hides and reveals through `map.setFilter` on layer ids, so it is
 * orthogonal to the diff dispatcher (`layers/geojson-dispatcher.js`) and has nothing to migrate.
 * The consequence matters to whoever migrates a source, though: hiding a feature does NOT remove
 * it from its source, so "ocultar" must never be implemented as a `{ remove }` diff. The filter
 * owns visibility and the source has to keep every feature, or the next step boundary has nothing
 * left to bring back.
 */

import { FEATURE_LAYER_IDS, HATCH_PATTERN_LAYERS, LAYER_ADDITIONAL_FILTERS } from './layer.constants.js';
import { getVisibleLayerIds } from '../store';
import { isActive } from '../store/sync/sync-metadata.js';

const VISIBLE_FILTER = ['!=', ['get', 'visivel'], false];

let cachedVisibleLayerIds = null;

/**
 * Ids of the features a HIDDEN GROUP holds, kept out of every feature layer.
 *
 * A GROUP'S VISIBILITY IS SHARED STATE, and until 2026-09-24 only its author ever saw it. The
 * group's `visible` travels by sync operation and the server persists it (`groups.visible`), but
 * hiding a group used to be a session-only patch of each member's `visivel` on the author's
 * MapLibre source. Measured with two browsers: the peer's tree showed the group hidden while the
 * members stayed drawn, and the author's own F5 drew them again under a tree that still said
 * hidden. The same patch also broke the member's OWN state: showing the group wrote
 * `visivel: true` over a member hidden on its own. So the rule moved here, next to the layer
 * membership clause it mirrors: a member of a hidden group is not drawn, whoever hid it and
 * whenever the map was loaded, and the feature's `visivel` is never touched.
 *
 * Pushed rather than read, so this module keeps a single import from the store barrel (several
 * unit suites mock that barrel with `getVisibleLayerIds` alone). `layers/layer_setup.js` is the
 * writer, from the groups of the current map, on every group or layer change.
 * @type {string[]}
 */
let hiddenFeatureIds = [];
let hiddenFeatureKey = '';

/**
 * Replaces the set of feature ids hidden by their group. Caller must follow with
 * updateAllLayerFilters() to take effect.
 * @param {Iterable<string>|null|undefined} ids
 */
export function setHiddenFeatureIds(ids) {
    const unique = new Set();
    for (const id of ids || []) {
        if (typeof id === 'string' && id !== '') unique.add(id);
    }
    hiddenFeatureIds = [...unique].sort();
    hiddenFeatureKey = hiddenFeatureIds.join(',');
}

/**
 * The feature ids to hide because their group is hidden.
 *
 * Only ACTIVE groups count (`isActive`, the rule the layers tab and the lock predicate use), so
 * a deleted group hides nothing. The processed outputs of line of sight and visibility carry
 * their parent's id with a suffix (`add_los_control.js`, `add_visibility_control.js`), and they
 * go too, or hiding a group would leave its analysis drawn without the line that produced it.
 * @param {Object<string, Object>|null|undefined} groups - Groups of one map, keyed by id.
 * @returns {string[]}
 */
export function hiddenGroupMemberIds(groups) {
    const ids = [];
    if (!groups || typeof groups !== 'object') return ids;
    for (const group of Object.values(groups)) {
        if (!group || group.visible !== false || !isActive(group.sync)) continue;
        for (const ref of Array.isArray(group.features) ? group.features : []) {
            if (typeof ref?.id !== 'string' || ref.id === '') continue;
            ids.push(ref.id);
            if (ref.type === 'los' || ref.type === 'visibility') {
                ids.push(`${ref.id}-visible`, `${ref.id}-obstructed`);
            }
        }
    }
    return ids;
}

/**
 * @returns {Array<Array>} The hidden-group clause ([] when no group is hidden).
 */
function hiddenGroupClauses() {
    if (hiddenFeatureIds.length === 0) return [];
    return [['!', ['in', ['get', 'id'], ['literal', hiddenFeatureIds]]]];
}

/**
 * Active temporal window [start, end] (epoch ms), or null when temporal control
 * is off. A feature passes when its [temporalInicio, temporalFim] validity
 * overlaps this window. During playback the window spans one timeline step, so
 * the filters only change on step boundaries while the cursor advances smoothly.
 * For an instantaneous test, end === start.
 * @type {number|null}
 */
let activeTemporalCursor = null;
let activeTemporalCursorEnd = null;

/**
 * Reveal mode: when true the temporal hide-clause is suppressed so all features
 * stay rendered (out-of-window ones are dimmed elsewhere, not hidden).
 * @type {boolean}
 */
let revealMode = false;

/**
 * Sets (or clears) the temporal window used by the layer filters. A feature is
 * kept when its validity overlaps [cursor, cursorEnd]; with the default
 * `cursorEnd === cursor` this is the classic instantaneous test. Pass a wider
 * window (one timeline step) to keep features valid anywhere within the current
 * step visible for the whole step. Pass a null/non-finite `cursor` to disable
 * temporal filtering. Caller must follow with updateAllLayerFilters() to take effect.
 * @param {number|null} cursor - Window start (epoch ms), or null to disable.
 * @param {number} [cursorEnd=cursor] - Window end (epoch ms).
 */
export function setTemporalCursor(cursor, cursorEnd = cursor) {
    activeTemporalCursor = Number.isFinite(cursor) ? cursor : null;
    activeTemporalCursorEnd =
        activeTemporalCursor === null ? null
            : Number.isFinite(cursorEnd) ? Math.max(cursorEnd, activeTemporalCursor) : activeTemporalCursor;
}

/**
 * Enables/disables reveal mode (suppresses temporal hiding).
 * @param {boolean} on
 */
export function setRevealMode(on) {
    revealMode = !!on;
}

/** Sentinels at the edges of the JS Date range (used as "no bound"). */
const MIN_TS = -8.64e15;
const MAX_TS = 8.64e15;

/**
 * Builds a MapLibre predicate that keeps a feature only when its
 * [temporalInicio, temporalFim] window overlaps [windowStart, windowEnd].
 * Missing/null bounds coalesce to the date-range sentinels, so a feature without
 * temporal data is permanent. With windowEnd === windowStart this is the classic
 * "cursor inside the feature window" instantaneous test.
 *
 * THE THIRD CLAUSE IS NOT COSMETIC (finding M6). `inicio <= fim` rejects a feature
 * whose validity is INVERTED (end before start, which nothing in the product
 * validates). Without it the overlap test SHOWS such a feature whenever the timeline
 * window straddles the inversion, while every instant test hides it at every cursor:
 * the same feature, two answers, depending on the surface. The pure twin of this
 * expression is `isTemporallyVisibleInWindow` (`temporal/temporal-model.js`), and
 * `tests/unit/visibilidade-temporal-uma-regra-so.test.js` evaluates BOTH over the
 * same corpus and demands identical answers.
 *
 * Exported because the reveal-dim multiplier in `layers/layer-opacity-applier.js`
 * has to ask the very same question: it decides which features are dimmed BECAUSE
 * they are temporally hidden, so a second hand-written copy there is the M3 bug.
 * @param {number} windowStart - Window start (epoch ms).
 * @param {number} windowEnd - Window end (epoch ms).
 * @returns {Array} MapLibre filter expression.
 */
export function buildTemporalOverlapFilter(windowStart, windowEnd) {
    const inicio = ['coalesce', ['get', 'temporalInicio'], MIN_TS];
    const fim = ['coalesce', ['get', 'temporalFim'], MAX_TS];
    return [
        'all',
        ['<=', inicio, windowEnd],
        ['>=', fim, windowStart],
        ['<=', inicio, fim],
    ];
}

/**
 * @returns {Array<Array>} Temporal clause(s) to append to a layer filter ([] when off).
 */
function temporalClauses() {
    if (activeTemporalCursor === null || revealMode) return [];
    return [buildTemporalOverlapFilter(activeTemporalCursor, activeTemporalCursorEnd ?? activeTemporalCursor)];
}

/**
 * Builds the layer membership filter for a set of visible layer IDs.
 * @param {string[]} visibleLayerIds
 * @returns {Array} MapLibre expression
 */
function buildLayerFilter(visibleLayerIds) {
    return ['in', ['coalesce', ['get', 'layerId'], 'default'], ['literal', visibleLayerIds]];
}

/**
 * Creates a visibility filter expression for MapLibre layers.
 * @param {string[]} visibleLayerIds - Array of visible layer IDs
 * @param {Array|null} [additionalFilters=null] - Additional filter expressions
 * @returns {Array} MapLibre filter expression
 */
export function createLayerVisibilityFilter(visibleLayerIds, additionalFilters) {
    const layerFilter = buildLayerFilter(visibleLayerIds);
    const extra = [...(additionalFilters || []), ...hiddenGroupClauses(), ...temporalClauses()];
    if (extra.length) {
        return ['all', VISIBLE_FILTER, layerFilter, ...extra];
    }
    return ['all', VISIBLE_FILTER, layerFilter];
}

/**
 * Creates a hatch pattern filter for fill layers.
 * @param {string[]} visibleLayerIds - Array of visible layer IDs
 * @param {boolean} hatchEnabled - Whether to filter for hatch (true) or solid (false)
 * @returns {Array} MapLibre filter expression
 */
export function createHatchLayerFilter(visibleLayerIds, hatchEnabled) {
    const hatchFilters = hatchEnabled
        ? [['==', ['get', 'hatchEnabled'], true], ['has', 'hatchPatternId']]
        : [['!=', ['get', 'hatchEnabled'], true]];

    return ['all', VISIBLE_FILTER, buildLayerFilter(visibleLayerIds), ...hatchFilters, ...hiddenGroupClauses(), ...temporalClauses()];
}

/**
 * Updates all layer filters on the map.
 * @param {Object} mapInstance - MapLibre map instance
 */
export function updateAllLayerFilters(mapInstance) {
    if (!mapInstance) return;

    const visibleLayerIds = getVisibleLayerIds();
    // Cheap cache key (runs every frame during playback): join the ids instead of
    // JSON.stringify — layer ids are plain strings, so a delimiter join is unique
    // enough and avoids the per-frame serializer cost.
    const cacheKey = `${activeTemporalCursor}|${activeTemporalCursorEnd}|${revealMode}|${visibleLayerIds.join(',')}|${hiddenFeatureKey}`;
    if (cachedVisibleLayerIds === cacheKey) return;
    cachedVisibleLayerIds = cacheKey;

    FEATURE_LAYER_IDS.forEach(function (layerId) {
        if (!mapInstance.getLayer(layerId)) return;

        try {
            let filter;
            if (layerId in HATCH_PATTERN_LAYERS) {
                filter = createHatchLayerFilter(visibleLayerIds, HATCH_PATTERN_LAYERS[layerId]);
            } else {
                filter = createLayerVisibilityFilter(visibleLayerIds, LAYER_ADDITIONAL_FILTERS[layerId]);
            }
            mapInstance.setFilter(layerId, filter);
        } catch (error) {
            console.warn(`Error updating filter for ${layerId}:`, error);
        }
    });
}

/**
 * Clears the visibility filter cache.
 * Call when layer configuration changes.
 */
export function invalidateFilterCache() {
    cachedVisibleLayerIds = null;
}

/**
 * Updates visibility of DOM-based measurement labels to match layer visibility.
 * Measurement labels are MapLibre Markers (DOM elements) that bypass layer filters.
 * Reads layerId from data-layer-id attribute stored at label creation time.
 */
export function updateMeasurementLabelVisibility() {
    const labels = document.querySelectorAll('.measurement-label[data-feature-id]');
    if (labels.length === 0) return;

    const visibleSet = new Set(getVisibleLayerIds());

    for (const label of labels) {
        const layerId = label.dataset.layerId || 'default';
        const marker = label.closest('.maplibregl-marker');
        if (!marker) continue;

        marker.style.display = visibleSet.has(layerId) ? '' : 'none';
    }
}

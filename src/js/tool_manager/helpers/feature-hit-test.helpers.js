// Path: js/tool_manager/helpers/feature-hit-test.helpers.js

/**
 * @fileoverview THE shared click hit-test: the one query that selection,
 * drag-start and the hover cursor all go through, so a feature that can be
 * selected at a spot can also be dragged from it and shows the move cursor
 * there.
 *
 * Everything geometric lives in `hit-test.model.js` (and is unit-tested there);
 * this file only reads the map — the query, the image dimensions, the zoom, the
 * projection — and hands the numbers over. It is deliberately forgiving: a
 * rendered row with no layer, no properties or an unexpected geometry must never
 * take the whole click down, so anything unreadable falls back to MapLibre's own
 * answer (keep the row) rather than to a guess.
 *
 * @see src/js/tool_manager/helpers/hit-test.model.js - why the tolerance and the
 *   exact icon rectangle are needed at all
 */

import { isTouchDevice } from '@utils/pointer-utils.js';

import { queryHoverFeatures } from './hover-query.helpers.js';
import {
    CLICK_TOLERANCE_PX,
    TOUCH_CLICK_TOLERANCE_PX,
    EXACT_ICON_LAYER_IDS,
    ICON_SIZE_RULES,
    toleranceBox,
    iconSizeForFeature,
    iconScreenQuad,
    parseIconOffset,
    pointInConvexQuad,
    perspectiveRatio,
    projectedW,
    lngLatToMercator,
    needsExactHit,
    resolveExactHits,
    pickPreferredHits,
} from './hit-test.model.js';

/** Tolerance resolved once: `isTouchDevice` ends in a `matchMedia` call, too costly per mousemove. */
let cachedTolerancePx = null;

/**
 * Reads a `lngLat` given either as a GeoJSON `[lng, lat]` pair or as a MapLibre
 * `LngLat`-shaped object.
 * @param {Array<number>|Object} lngLat - Position
 * @returns {{lng: number, lat: number}} Degrees, `NaN` when unreadable
 */
function toLngLat(lngLat) {
    if (Array.isArray(lngLat)) return { lng: Number(lngLat[0]), lat: Number(lngLat[1]) };
    return { lng: Number(lngLat?.lng), lat: Number(lngLat?.lat) };
}

/**
 * Click slack for the current pointer: a finger needs twice what a mouse does.
 * Probed once per page load; the pointer kind does not change under the app.
 * @returns {number} Tolerance in CSS pixels
 */
export function getClickTolerancePx() {
    if (cachedTolerancePx === null) {
        try {
            cachedTolerancePx = isTouchDevice() ? TOUCH_CLICK_TOLERANCE_PX : CLICK_TOLERANCE_PX;
        } catch {
            cachedTolerancePx = CLICK_TOLERANCE_PX;
        }
    }
    return cachedTolerancePx;
}

/**
 * Whether a row's hit is trustworthy enough to decide the winning class.
 * MapLibre verifies geometry layers itself (a line within its width, a circle
 * within its radius, a fill by containment) and the icon layers of
 * `EXACT_ICON_LAYER_IDS` are rebuilt here; any OTHER symbol layer
 * (`text-layer`, the label layers) still answers from its inflated collision
 * box and must not demote anything.
 * @param {Object} row - Rendered row
 * @returns {boolean} `true` for a verified hit
 */
export function isDecisiveHit(row) {
    const layer = row?.layer;
    if (!layer) return true;
    return layer.type !== 'symbol' || EXACT_ICON_LAYER_IDS.includes(layer.id);
}

/**
 * Ranks surviving rows the way selection wants them: point > line > area,
 * decided by verified hits only (`isDecisiveHit`). Callers apply this AFTER
 * their own lock / visibility / source filtering.
 * @param {Array<Object>} rows - Rows from `queryFeaturesAtPoint`, already filtered
 * @returns {Array<Object>} The preferred rows, order preserved
 */
export function rankHitRows(rows) {
    return pickPreferredHits(rows, isDecisiveHit);
}

/**
 * Perspective ratio MapLibre applies to a viewport-aligned symbol anchored at
 * `lngLat`.
 *
 * A flat map with no terrain is the overwhelmingly common case and the ratio is
 * exactly 1 there, so it skips the matrix entirely. Otherwise this reproduces
 * `MercatorTransform.coordinatePoint`
 * (`maplibre-gl/src/geo/projection/mercator_transform.ts:484-488`), which
 * transforms `[mercatorX * worldSize, mercatorY * worldSize, elevation, 1]`.
 * The clip-to-pixel step is an affine scale that leaves `w` untouched, so
 * `modelViewProjectionMatrix` yields the same `w` as the internal `_pixelMatrix`.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Array<number>|Object} lngLat - Symbol anchor position
 * @returns {number} The ratio; `1` whenever it cannot be computed
 */
export function getSymbolPerspectiveRatio(map, lngLat) {
    if (!map) return 1;

    try {
        const terrain = map.getTerrain?.() || null;
        if (map.getPitch?.() === 0 && !terrain) return 1;

        const transform = map.transform;
        const matrix = transform?.modelViewProjectionMatrix;
        const cameraToCenterDistance = transform?.cameraToCenterDistance;
        const worldSize = transform?.worldSize;
        if (!matrix) return 1;
        if (!Number.isFinite(cameraToCenterDistance) || !Number.isFinite(worldSize)) return 1;

        const { lng, lat } = toLngLat(lngLat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return 1;

        const rawElevation = terrain ? map.queryTerrainElevation?.(lngLat) : 0;
        const elevation = Number.isFinite(rawElevation) ? rawElevation : 0;

        const mercator = lngLatToMercator(lng, lat);
        const w = projectedW(matrix, mercator.x * worldSize, mercator.y * worldSize, elevation);

        return perspectiveRatio(cameraToCenterDistance, w);
    } catch {
        return 1;
    }
}

/**
 * The rectangle MapLibre drew for one icon-backed feature, in screen pixels.
 *
 * Everything comes from the map: the image the style holds (its bitmap size
 * over its `pixelRatio` is the CSS size at `icon-size` 1), the zoom, the
 * projection of the feature's coordinates and the perspective ratio. The layer
 * rule says which properties the layer actually reads (`rotates`, `anchored`).
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} icon - The feature as drawn
 * @param {string} icon.layerId - One of `EXACT_ICON_LAYER_IDS`
 * @param {Array<number>} icon.coordinates - `[lng, lat]` the icon is anchored at
 * @param {Object} icon.properties - Feature properties (`id` is the image id)
 * @param {Object} [options] - Quad options
 * @param {number} [options.paddingPx=0] - Screen pixels added on every side
 * @returns {Array<{x: number, y: number}>|null} The four corners, or `null`
 *   when the style has no such image or the rectangle cannot be reconstructed
 */
export function renderedIconQuad(map, { layerId, coordinates, properties }, { paddingPx = 0 } = {}) {
    if (!map || !properties || !Array.isArray(coordinates)) return null;

    const rule = ICON_SIZE_RULES[layerId];
    if (!rule) return null;

    try {
        const image = map.getImage?.(properties.id);
        const data = image?.data;
        if (!data) return null;

        const pixelRatio = Number.isFinite(image.pixelRatio) && image.pixelRatio > 0
            ? image.pixelRatio
            : 1;
        const displayWidth = Number(data.width) / pixelRatio;
        const displayHeight = Number(data.height) / pixelRatio;
        if (!Number.isFinite(displayWidth) || !Number.isFinite(displayHeight)) return null;

        const iconSize = iconSizeForFeature(layerId, properties, map.getZoom?.());
        if (!Number.isFinite(iconSize)) return null;

        const anchor = map.project?.(coordinates);
        if (!anchor) return null;

        const rotation = rule.rotates ? Number(properties.rotation) : 0;
        const iconAnchor = rule.anchored && typeof properties.anchor === 'string'
            ? properties.anchor
            : 'center';
        // Icon pixels, applied before rotation exactly as MapLibre shapes the
        // icon; only the coordination measures declare an `icon-offset`.
        const iconOffset = rule.offset ? parseIconOffset(properties.iconOffset) : [0, 0];

        return iconScreenQuad({
            anchor,
            displayWidth,
            displayHeight,
            iconSize,
            rotationDeg: Number.isFinite(rotation) ? rotation : 0,
            iconAnchor,
            iconOffset,
            perspectiveRatio: getSymbolPerspectiveRatio(map, coordinates),
            paddingPx,
        });
    } catch {
        return null;
    }
}

/**
 * Exact rendered-rectangle test for a row of one of `EXACT_ICON_LAYER_IDS`.
 *
 * The anchor comes from the row's OWN geometry rather than from the store,
 * because that is the position MapLibre drew — including the per-frame
 * trajectory positions the temporal module writes into the source.
 *
 * The tolerance only reaches the rectangle of a layer whose rule says
 * `tolerant` (the point markers, which stand in for a point and are as thin a
 * target as a line); the four picture layers are tested against the drawing
 * itself, with no slack.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} row - Rendered feature
 * @param {Object|Array<number>} point - Click point in CSS pixels
 * @param {Object} [options] - Test options
 * @param {number} [options.tolerancePx=0] - Click slack the caller queried
 *   with, added around the rectangle of a `tolerant` layer only
 * @returns {boolean} `true` when the click is inside the drawn rectangle, and
 *   also whenever the rectangle cannot be reconstructed (MapLibre's answer stands)
 */
export function isPointInsideRenderedIcon(map, row, point, { tolerancePx = 0 } = {}) {
    if (!map || !row) return true;

    const geometry = row.geometry;
    if (geometry?.type !== 'Point') return true;

    const layerId = row.layer?.id;
    const quad = renderedIconQuad(map, {
        layerId,
        coordinates: geometry.coordinates,
        properties: row.properties,
    }, { paddingPx: ICON_SIZE_RULES[layerId]?.tolerant ? tolerancePx : 0 });
    if (!quad) return true;

    return pointInConvexQuad(point, quad);
}

/**
 * The shared hit-test.
 *
 * Deliberately UNRANKED: the selection manager first drops locked, hidden and
 * foreign rows and only then applies `rankHitRows`, while hover wants the raw
 * survivors.
 *
 * The exact point query runs only when a survivor needs it (an area or an edit
 * handle), and only over the layers those survivors came from: this is on the
 * mousemove path of every tool, so the second walk must stay as small as the
 * first one was.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object|Array<number>} point - Click point in CSS pixels, `{ x, y }` or `[x, y]`
 * @param {Object} [options] - Query options
 * @param {Array<string>} [options.layers] - Restrict the query to these layer
 *   ids (ids absent from the style are dropped); omit for the full style
 * @param {number} [options.tolerance] - Slack in pixels, default
 *   `getClickTolerancePx()`; `0` makes the first query a plain point query
 * @returns {Array<Object>} Surviving rendered features, in query order
 */
export function queryFeaturesAtPoint(map, point, options = {}) {
    if (!map) return [];

    const layers = Array.isArray(options.layers) ? options.layers : null;
    const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : getClickTolerancePx();

    const query = (geometry, layerIds) => {
        try {
            const rows = layerIds
                ? queryHoverFeatures(map, geometry, layerIds)
                : map.queryRenderedFeatures?.(geometry);
            return Array.isArray(rows) ? rows : [];
        } catch {
            return [];
        }
    };

    const tolerant = query(tolerance > 0 ? toleranceBox(point, tolerance) : point, layers);
    if (tolerant.length === 0) return [];

    const survivors = tolerant.filter((row) => (
        !EXACT_ICON_LAYER_IDS.includes(row?.layer?.id)
        || isPointInsideRenderedIcon(map, row, point, { tolerancePx: tolerance })
    ));

    const exactLayerIds = new Set();
    let exactNeeded = false;
    for (const row of survivors) {
        if (!needsExactHit(row)) continue;
        exactNeeded = true;
        if (typeof row.layer?.id === 'string') exactLayerIds.add(row.layer.id);
    }
    if (!exactNeeded) return survivors;

    // A survivor with no layer id cannot be narrowed to a layer, so the exact
    // query falls back to the same scope the tolerant one had.
    const exactScope = exactLayerIds.size > 0 ? [...exactLayerIds] : layers;

    return resolveExactHits(survivors, query(point, exactScope));
}

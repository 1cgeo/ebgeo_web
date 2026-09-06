// Path: js/tool_manager/helpers/icon-selection-box.helpers.js

/**
 * @fileoverview The dashed selection box of an icon-backed feature (image,
 * military symbol, coordination measure, declination diagram), built from the
 * rectangle MapLibre actually drew.
 *
 * Until 2026-09-06 each of those tools derived its box from stored
 * `width`/`height` through an empirical factor (0.5 or 0.625) that stood in for
 * the image's `pixelRatio`, then took the axis-aligned bounds of the rotated
 * rectangle and converted them to degrees at the feature's latitude. The
 * factors were mutually inconsistent and the bounds ignored the rotation, so
 * the box could sit visibly outside the picture. The hit-test already rebuilds
 * the drawn rectangle from the map (`renderedIconQuad`); this module reuses it,
 * adds the frame's padding in screen pixels and unprojects the four corners, so
 * the box is exactly the picture plus the padding, rotation included.
 *
 * The box is geometry in degrees and therefore VIEW-DEPENDENT: it is right for
 * the zoom, bearing and pitch it was built at. `SelectionHighlightManager`
 * keys its cache on those for the tools that answer `'viewport'` to
 * `getSelectionBoxStrategy`, and rebuilds when they change.
 *
 * @see src/js/tool_manager/helpers/feature-hit-test.helpers.js - `renderedIconQuad`
 * @see src/js/tool_manager/managers/selection-highlight.manager.js - the cache
 */

import { renderedIconQuad } from './feature-hit-test.helpers.js';

/** Screen pixels between the picture and the dashed frame, on every side. @constant {number} */
export const ICON_SELECTION_BOX_PADDING_PX = 5;

/**
 * Selection-box polygon of an icon-backed feature, from its drawn rectangle.
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} feature - Feature with a Point geometry and the tool's properties
 * @param {string} layerId - The layer the feature is drawn on (one of `EXACT_ICON_LAYER_IDS`)
 * @param {number} [paddingPx=ICON_SELECTION_BOX_PADDING_PX] - Frame padding, screen pixels
 * @returns {Object|null} GeoJSON Polygon geometry (closed ring), or `null` when
 *   the drawn rectangle cannot be rebuilt (image not in the style yet, no map
 *   projection); the caller then falls back to its stored box
 */
export function createRenderedIconSelectionBox(map, feature, layerId, paddingPx = ICON_SELECTION_BOX_PADDING_PX) {
    const coordinates = feature?.geometry?.coordinates;
    if (!map || typeof map.unproject !== 'function' || !Array.isArray(coordinates)) return null;

    const quad = renderedIconQuad(map, {
        layerId,
        coordinates,
        properties: feature.properties,
    }, { paddingPx });
    if (!quad) return null;

    const ring = [];
    for (const corner of quad) {
        const lngLat = map.unproject([corner.x, corner.y]);
        const lng = Number(lngLat?.lng);
        const lat = Number(lngLat?.lat);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        ring.push([lng, lat]);
    }
    ring.push([ring[0][0], ring[0][1]]);

    return { type: 'Polygon', coordinates: [ring] };
}

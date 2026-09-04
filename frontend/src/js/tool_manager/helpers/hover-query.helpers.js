// Path: js/tool_manager/helpers/hover-query.helpers.js

/**
 * @fileoverview Layer-restricted queryRenderedFeatures for hot mouse paths.
 *
 * queryRenderedFeatures without a `layers` option walks every tileManager in the
 * style (in production: the vector frames, the raster base, the terrain, the
 * hillshade and dozens of GeoJSON sources) just to pick a cursor. The hover
 * handlers already discard everything but their own family, so they can name the
 * layers up front and pay for those alone.
 *
 * MapLibre throws when a layer id is not in the style, so the ids are filtered
 * by map.getLayer() before the query. That is the same guard the snapping
 * service uses for SNAPPABLE_LAYER_IDS.
 */

/**
 * Query rendered features restricted to a list of layer ids.
 * Ids absent from the current style are dropped before the query, so a style
 * that has not created a layer yet yields [] instead of an exception.
 * @param {Object} map - MapLibre map instance
 * @param {Object|Array<number>} point - Screen point, { x, y } or [x, y]
 * @param {Array<string>} layerIds - Candidate MapLibre layer ids
 * @returns {Array<Object>} Rendered features, [] when no id is in the style
 */
export function queryHoverFeatures(map, point, layerIds) {
    if (!map || !Array.isArray(layerIds) || layerIds.length === 0) return [];

    const layers = [];
    for (const id of layerIds) {
        if (map.getLayer(id)) layers.push(id);
    }

    if (layers.length === 0) return [];

    return map.queryRenderedFeatures(point, { layers });
}

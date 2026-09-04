// Path: js/baselayers/style-transform.js

/**
 * @fileoverview Keeps the application's sources and layers across a base-map
 * `setStyle`, as the `transformStyle` hook of MapLibre 5.18.
 *
 * `map.setStyle(next)` diffs the CURRENT style against `next`. The current style
 * carries everything the application added (~85 sources and ~128 layers in
 * production: the 19 feature families, the grid, the frame and data layers, the
 * terrain, the hillshade, the measurement and auxiliary layers). None of it is in
 * `next`, so the diff used to emit a `removeSource` and a `removeLayer` for each,
 * and `setupMapFeatures` rebuilt them all: every GeoJSON re-tiled in the worker,
 * every symbol layer re-placed, sixteen TileJSON requests repeated. This hook
 * hands MapLibre a `next` that already contains the application's sources and
 * layers, by the same object references, so the diff finds them equal (the diff
 * ignores the `data` key of a source) and emits nothing for them.
 *
 * What still changes is exactly the base map: the previous base's sources and
 * layers go, the new base's come in underneath. The application ids are known by
 * exclusion: whatever the previous BASE style did not own. That base is recorded
 * every time the hook runs, so a URL style (fetched, unknown until then) is
 * handled the same as an inline one.
 */

/**
 * Ids a style declares, for telling base content apart from application content.
 * @param {Object|null|undefined} style - A style specification
 * @returns {{ sources: Set<string>, layers: Set<string> }}
 */
export function collectStyleIds(style) {
    return {
        sources: new Set(Object.keys(style?.sources || {})),
        layers: new Set((style?.layers || []).map((layer) => layer.id)),
    };
}

/**
 * Whether the base style asked for is already the one on the map, judged by
 * the map itself: same style name AND every layer of the base present. The
 * control's own record of the current base is a belief (persisted state) and
 * is not consulted here.
 *
 * A URL style (string) is never "already on the map": it has to be fetched
 * and applied.
 *
 * @param {Object|null|undefined} styleOnMap - `map.getStyle()`
 * @param {Object|string|null|undefined} style - Style registered for the base
 * @param {(id: string) => boolean} hasLayer - `map.getLayer(id)` as a predicate
 * @returns {boolean}
 */
export function baseStyleAlreadyOnMap(styleOnMap, style, hasLayer) {
    if (!styleOnMap || !style || typeof style !== 'object') return false;
    if ((styleOnMap.name || null) !== (style.name || null)) return false;
    const ids = collectStyleIds(style).layers;
    if (!ids.size) return false;
    for (const id of ids) if (!hasLayer(id)) return false;
    return true;
}

/**
 * The style to apply: the new base map plus everything the application added on
 * top of the previous base, in the previous order, above the new base layers.
 *
 * Collisions resolve in favour of the new base: a source or layer id that the
 * new style declares is taken from it, never from the previous style.
 *
 * @param {Object|null|undefined} previous - Style currently on the map (serialized)
 * @param {Object} next - Style being applied
 * @param {{ sources: Set<string>, layers: Set<string> }} previousBase - Ids the previous base map owned
 * @returns {Object} Merged style specification
 */
export function mergeApplicationStyle(previous, next, previousBase) {
    if (!previous || !next) return next;

    const baseSources = previousBase?.sources || new Set();
    const baseLayers = previousBase?.layers || new Set();

    const sources = { ...(next.sources || {}) };
    for (const [id, source] of Object.entries(previous.sources || {})) {
        if (baseSources.has(id) || Object.prototype.hasOwnProperty.call(sources, id)) continue;
        sources[id] = source;
    }

    const nextLayerIds = new Set((next.layers || []).map((layer) => layer.id));
    const layers = [...(next.layers || [])];
    for (const layer of previous.layers || []) {
        if (baseLayers.has(layer.id) || nextLayerIds.has(layer.id)) continue;
        // A layer of the previous base map that was not listed by id: it draws
        // from a base source that the new style does not carry over.
        if (layer.source && baseSources.has(layer.source) && !Object.prototype.hasOwnProperty.call(sources, layer.source)) continue;
        layers.push(layer);
    }

    const merged = { ...next, sources, layers };
    // Terrain and projection belong to the application state, not to the base
    // map: keep them so the diff does not tear the terrain down and the app does
    // not have to put it back a frame later.
    if (previous.terrain && !next.terrain) merged.terrain = previous.terrain;
    if (previous.projection && !next.projection) merged.projection = previous.projection;
    return merged;
}

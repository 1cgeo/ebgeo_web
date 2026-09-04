// Path: js/baselayers/style-transform.js

/**
 * @fileoverview Keeps the application's sources and layers across a base-map
 * `setStyle`, as the `transformStyle` hook of MapLibre, and decides whether the
 * base asked for is already the one on the map.
 *
 * `map.setStyle(next)` diffs the CURRENT style against `next`. The current style
 * carries everything the application added (74 sources and 87 layers measured in
 * this tree on a boot with no drawing: the 19 feature families, the grid, the
 * frame and data layers, the terrain, the hillshade, the measurement and
 * auxiliary layers). None of it is in `next`, so the diff used to emit a
 * `removeSource` and a `removeLayer` for each, and `setupMapFeatures` rebuilt
 * them all: every GeoJSON re-tiled in the worker, every symbol layer re-placed,
 * sixteen TileJSON requests repeated. This hook hands MapLibre a `next` that
 * already contains the application's sources and layers, by the same object
 * references, so the diff finds them equal (the diff ignores the `data` key of a
 * source) and emits nothing for them.
 *
 * IN THIS TREE IT WAS WORSE THAN A LARGE DIFF, and that was measured in the real
 * browser on 2026-09-04 rather than carried over from the report this port comes
 * from. Every base switch made `diffStyles` throw ("Unable to perform style diff:
 * Cannot read properties of undefined (reading 'type')") and MapLibre fell back
 * to "Rebuilding the style from scratch": the whole `Style` object was torn down
 * and rebuilt, all 74 sources and 87 layers with it. With the hook, the same
 * switch removes ONE source and ONE layer, which are the previous base's.
 *
 * What still changes is exactly the base map: the previous base's sources and
 * layers go, the new base's come in underneath. The application ids are known by
 * exclusion: whatever the previous BASE style did not own. That base is recorded
 * every time the hook runs, so a URL style (fetched, unknown until then) is
 * handled the same as an inline one.
 *
 * THE HOOK IS SUPPORTED BY THE BUNDLE IN USE, and that was read rather than
 * assumed (`public/vendors/maplibre-gl.js`, 5.18.0): `Map.setStyle` takes
 * `_diffStyle` -> `_updateDiff` -> `Style.setState(next, options)`, and
 * `setState` opens with `next = options.transformStyle(this.serialize(), next)`.
 * A URL style takes the same path after the fetch. When `setState` throws,
 * MapLibre logs "Rebuilding the style from scratch" and falls back to
 * `_updateStyle`, which drops every source: that fallback is what the
 * `hasApplicationSource` guard of `layers/setup-mode.js` exists to catch.
 *
 * WHY THIS MATTERS MORE HERE THAN IT DID UPSTREAM. Sixteen of the application's
 * GeoJSON sources are written through the diff dispatcher
 * (`layers/geojson-dispatcher.js`), which owns a queue per source. Measured in
 * this tree on 2026-09-04 with a fake map: a `setStyle` that recreates the
 * sources leaves the dispatcher pointing at a NEW source object, and the whole
 * collection the full redraw then writes is a `replaceAll` that DISCARDS the
 * queued diff. Preserving the sources by reference keeps the dispatcher writing
 * to the very object it queued for.
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
 * control's own record of the current base is a belief (StateManager, in
 * memory) and is not consulted here.
 *
 * A URL style (string) is never "already on the map": it has to be fetched
 * and applied.
 *
 * THE BELIEF IS AN ID, AND AN ID NO LONGER DETERMINES A STYLE IN THIS BRANCH.
 * A basemap that is not one of the five built-in modules resolves through
 * `config.basemapStyles` (`basemap-style.js`), and that table is MUTATED at
 * runtime: `store/sync/atlas-settings.service.js` writes and deletes entries
 * whenever the additive grant payload arrives or is withdrawn. So the same id
 * can name a different style object from one switch to the next, and a gate
 * that compares ids alone would skip the switch and leave the old base drawn.
 *
 * IN THIS TREE THE NAME CHECK IS A NO-OP FOR THE FIVE BUILT-IN STYLES, measured
 * on 2026-09-04: none of them declares `name`, so both sides read `null` and the
 * decision rests entirely on the layer ids. That is deliberate rather than
 * tolerated. `carta_topografica.js` and `osm_layer.js` are the same style
 * content (the defect `baselayer-style-uniqueness.repro.test.js` documents), so
 * "already on the map" is the honest answer when the map holds either of them
 * and the other is asked for, and it is also the answer that avoids the no-op
 * diff that never fires `styledata` and costs the caller the full 10 s timeout.
 * A published style, which is where the ids really can collide, does carry a
 * name, and there the check bites.
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

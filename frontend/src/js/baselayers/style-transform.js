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
 * assumed (the vendored 5.18 bundle when this was written; the app now installs
 * `maplibre-gl` 6.7.0 from npm, and `src/ui/map.ts` there takes the same route):
 * `Map.setStyle` takes
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

import { withLiteralGlyphTokens } from './glyphs-template.js';

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
    // The glyph tokens are restored HERE too, and not only in `resolveBasemapStyle`: a URL style
    // is a string there, and its document reaches this hook only after MapLibre fetched it.
    if (!previous || !next) return withLiteralGlyphTokens(next);

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

    const merged = { ...withLiteralGlyphTokens(next), sources, layers };
    // Terrain and projection belong to the application state, not to the base
    // map: keep them so the diff does not tear the terrain down and the app does
    // not have to put it back a frame later.
    if (previous.terrain && !next.terrain) merged.terrain = previous.terrain;
    if (previous.projection && !next.projection) merged.projection = previous.projection;
    return merged;
}

/**
 * The appearance a base switch owes the map, written INTO the style handed to `setStyle`
 * instead of applied to the map after it.
 *
 * WHY INSIDE THE STYLE. `switchLayer` used to call `map.setProjection({ type: 'globe' })` and
 * `map.setSky(undefined)` after awaiting the first `styledata`, and both go through
 * `Style._checkLoaded`, which throws "Style is not done loading." while a style is being rebuilt.
 * The first `styledata` does not mean "loaded" (it can come from the style being replaced, and the
 * 10 s timeout falls through too), so a map switch that hit the full-rebuild path threw from
 * there: 3 occurrences in 2 sessions on release 1c3c19c9 of the test stack. Inside the style,
 * MapLibre applies the projection itself, in `_load` for a rebuild and as a `setProjection` diff
 * command on a loaded style, so nothing is ever written to a style that is still loading.
 *
 * AND THE INPUTS ARE READ WHEN MAPLIBRE APPLIES THE STYLE, because the caller passes them from
 * inside the `transformStyle` hook: two rapid switches each carry the state of the moment their
 * style lands, and no projection computed for the first can be written after the second.
 *
 * Same rule as before, only moved: globe when the atlas asks for it and terrain is off (globe and
 * terrain are incompatible, MapLibre #4792); otherwise the projection the merge kept. The sky is
 * dropped because the app never shows one (the background is CSS).
 *
 * @param {Object|null|undefined} style - The merged style
 * @param {{ globe: boolean, terrainActive: boolean }} appearance
 * @returns {Object|null|undefined} A new style object, or the input when it is not an object
 */
export function withSwitchAppearance(style, { globe, terrainActive }) {
    if (!style || typeof style !== 'object') return style;
    const out = { ...style };
    delete out.sky;
    if (globe && !terrainActive) out.projection = { type: 'globe' };
    return out;
}

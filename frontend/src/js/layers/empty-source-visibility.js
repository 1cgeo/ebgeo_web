// Path: js/layers/empty-source-visibility.js

/**
 * @fileoverview Keeps the layers of an EMPTY GeoJSON source hidden.
 *
 * In a typical session the style holds around a hundred sources, and most of the
 * feature ones are empty: the user has not drawn that kind of thing yet. Their
 * layers stayed visible, and with 3D terrain on that cost twice per frame.
 *
 * FIRST COST. `Style._updateSources` walks EVERY source
 * (`for (const t in this.tileManagers) this.tileManagers[t].update(e, this.map.terrain)`)
 * and `TileManager.update` only skips the elevation-aware `coveringTiles` when the
 * source is not in use: `this.used || this.usedForTerrain ? (... coveringTiles with
 * terrain ...) : a = []`. An empty source with a visible layer takes the expensive
 * branch and queries elevation for nothing.
 *
 * SECOND COST. `symbol` and `circle` layers interleaved between `fill` and `line`
 * break the terrain's render-to-texture stacks, and 5.18 pools thirty textures for
 * all of them.
 *
 * THE KEY is `Style.update`, which marks a source as used per NON-hidden layer:
 * `!i.isHidden(e.zoom) && i.source && (this.tileManagers[i.source].used = !0)`.
 * A layer with `visibility: none` does not count, so the source drops out of both
 * mechanisms. Measured on the `main` branch with the 82 layers of 67 empty sources
 * hidden by hand: 2 stacks instead of 17, still frame from 26 ms to 5,7 ms and
 * rotation from 38 ms to 7,7 ms (60 fps).
 *
 * WHY A LISTENER AND NOT A HELPER. The application writes to GeoJSON sources from
 * hundreds of call sites across dozens of files, and there is no single write
 * helper: the sixteen migrated sources go through `layers/geojson-dispatcher.js`
 * and every support source (`-feedback`, `-edit-handles`, `selection-boxes`) is
 * written with a raw `setData`. A new helper would mean migrating all of them, and
 * the one call site forgotten would hide a layer WITH features in it, which is a
 * visible defect. The `sourcedata` event is fired inside `GeoJSONSource` itself,
 * below every caller, and covers them all with one change.
 *
 * IT COVERS `updateData` TOO, and that is the half this branch needed: read from
 * the vendored 5.18 bundle, `setData` and `updateData` both land in
 * `_updateWorkerData` and then in `_dispatchWorkerUpdate`, which fires
 * `sourcedata` with `sourceDataType: 'metadata'` and then `'content'` without
 * consulting `used` anywhere. If it did consult it, hiding the layer would kill
 * the very trigger that brings it back.
 *
 * WHAT COUNTING COSTS ON A MIGRATED SOURCE. After the first `updateData` the
 * source holds `_data.updateable` (a Map) and `serialize()` REBUILDS the
 * collection: `{type: 'FeatureCollection', features: Array.from(map.values())}`.
 * That allocation is the price of the count, and it is paid once per `content`
 * event, never per frame. Measured in node over the same shape: 0,10 us with the
 * source empty, 0,35 us at 170 features, 1,4 us at 1.000 and 12,8 us at 10.000.
 * Reaching into `_data.updateable.size` would save that and buy a dependency on a
 * private field, which at these numbers is not a trade worth making.
 *
 * WHAT THE MODULE REMEMBERS. Only the set of layers IT hid. There is no record of
 * what the application "wants", because the atlas layer tab does not touch
 * `visibility`: it rewrites the FILTER (`visibility-filter.js`), as does the
 * temporal mode, and opacity only writes `setPaintProperty`. A layer hidden by
 * someone else is never shown by this module, and that is why the separators
 * (which are born `none` as `beforeId` anchors) are left alone. A hidden anchor
 * still works: `Style.addLayer` resolves `beforeId` through
 * `this._order.indexOf(beforeId)`, an array of ids, with no look at visibility.
 */

/**
 * GeoJSON sources with inline data whose layers their own owner toggles through
 * `visibility`. If the rule governed them, incoming data would show a layer the
 * owner had just hidden.
 *
 * The list was measured, not inherited: a sweep of
 * `setLayoutProperty(..., 'visibility', ...)` over `frontend/src/js` finds these
 * three plus owners the rule cannot reach anyway. The grid sources are `vector`,
 * the hillshade is `raster-dem`, the analysis and data layers are vector or
 * raster, and the 360 floor plan lives on the mini-map, not on this one. The 360
 * line source is a vector tile source here, not GeoJSON.
 */
export const UNMANAGED_SOURCE_IDS = Object.freeze(new Set([
    // add_3d_models_viewer_control.js: sourceId at line 136, toggled at 597 and 612
    '3d-models-source',
    // streetview_markers.js: sourceId at line 43, layers born `none`, toggled at 270 to 273 and 296 to 299
    'streetview-markers-source',
    // saved_photos_markers.js: sourceId at line 30, toggled around 318
    'saved-photos-markers-source',
]));

/**
 * Per-map state: the layers this module hid, and the installed listener.
 * @type {WeakMap<Object, { hidden: Set<string>, handler: Function|null }>}
 */
const stateByMap = new WeakMap();

/**
 * Returns (creating it the first time) the state of this map.
 * @param {Object} map - MapLibre map instance
 * @returns {{ hidden: Set<string>, handler: Function|null }}
 */
function ensureState(map) {
    let state = stateByMap.get(map);
    if (!state) {
        state = { hidden: new Set(), handler: null };
        stateByMap.set(map, state);
    }
    return state;
}

/**
 * The data a GeoJSON source currently holds, read synchronously.
 *
 * `serialize()` is the public path and is the one the bundle keeps honest for both
 * source shapes: `this._data.updateable ? {FeatureCollection rebuilt} :
 * this._data.url || this._data.geojson`. A URL source therefore yields a string
 * and a non-GeoJSON source yields no `data` at all, which is exactly the "we
 * cannot tell" answer this module needs.
 *
 * @param {Object} source - MapLibre source (`map.getSource(id)`)
 * @returns {*} Whatever the source serializes as its data, or undefined
 */
function readSourceData(source) {
    if (!source || typeof source.serialize !== 'function') return undefined;
    try {
        return source.serialize()?.data;
    } catch {
        return undefined;
    }
}

/**
 * How many features the source holds RIGHT NOW, read without a worker round trip.
 *
 * Returns `null` when the question does not apply, and in that case the module
 * touches nothing: a source that does not exist, is not GeoJSON, loads from a URL
 * (the data is a string) or holds a shape we cannot count. Emptiness is proved,
 * never presumed.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 * @returns {number|null} Number of features, or null when undetermined
 */
export function countSourceFeatures(map, sourceId) {
    const data = readSourceData(map?.getSource?.(sourceId));
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data.features)) return data.features.length;
    // A bare `Feature` draws too, and a naive count would read it as empty.
    if (data.type === 'Feature') return 1;
    return null;
}

/**
 * The layer's effective visibility, with the spec default applied.
 *
 * `StyleLayer.getLayoutProperty('visibility')` returns `undefined` on a layer that
 * never declared `layout.visibility`, and MapLibre has no class default. Without
 * this normalization the idempotence check would fail: `undefined` is not
 * `'visible'`, so `setLayoutProperty` would pass MapLibre's own short circuit and
 * mark the source for reload for nothing.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string} layerId - Layer id
 * @returns {'visible'|'none'}
 */
function currentVisibility(map, layerId) {
    let value;
    try {
        value = map.getLayoutProperty(layerId, 'visibility');
    } catch {
        return 'visible';
    }
    return value === 'none' ? 'none' : 'visible';
}

/**
 * The ids of the layers drawing from a source, in style order. Built from the LIVE
 * style, because the application has no source-to-layers map anywhere and the
 * support sources are named by prefix (`${prefix}-feedback` and friends) in
 * `layers/styles/shape.layers.js`.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 * @returns {string[]} Layer ids
 */
function layersOfSource(map, sourceId) {
    const ids = [];
    for (const layerId of map.getLayersOrder()) {
        const layer = map.getLayer(layerId);
        if (layer && layer.source === sourceId) ids.push(layerId);
    }
    return ids;
}

/**
 * Applies the rule to a list of layers that is already known.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string[]} layerIds - Layers of the source
 * @param {boolean} isEmpty - Whether the source is empty
 * @returns {number} How many `visibility` writes were made
 */
function applyToLayers(map, layerIds, isEmpty) {
    const state = ensureState(map);
    let writes = 0;

    for (const layerId of layerIds) {
        const visible = currentVisibility(map, layerId) === 'visible';

        if (isEmpty) {
            // A layer already hidden by someone else never enters the set, so it
            // will never be shown from here.
            if (!visible) continue;
            map.setLayoutProperty(layerId, 'visibility', 'none');
            state.hidden.add(layerId);
            writes++;
            continue;
        }

        if (!state.hidden.has(layerId)) continue;
        if (visible) {
            // Someone showed it before us: the record no longer holds.
            state.hidden.delete(layerId);
            continue;
        }
        map.setLayoutProperty(layerId, 'visibility', 'visible');
        state.hidden.delete(layerId);
        writes++;
    }

    return writes;
}

/**
 * Puts the layers of ONE source in the state its feature count asks for.
 *
 * Does not write when the value is already the wanted one, and that guard matters:
 * every `visibility` write makes `Style._updateLayer` mark the source with
 * `_updatedSources[source] = 'reload'` and pause its `TileManager`.
 *
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 * @returns {number} How many `visibility` writes were made
 */
export function syncSourceLayersVisibility(map, sourceId) {
    if (!map || !sourceId) return 0;
    if (UNMANAGED_SOURCE_IDS.has(sourceId)) return 0;
    if (typeof map.getLayersOrder !== 'function') return 0;

    const count = countSourceFeatures(map, sourceId);
    if (count === null) return 0;

    return applyToLayers(map, layersOfSource(map, sourceId), count === 0);
}

/**
 * Runs the rule over every source the style draws from.
 *
 * Walks the layer order ONCE and groups by source, instead of walking the order
 * per source: with around a hundred sources and three hundred layers the naive
 * shape is thirty thousand lookups, and each source would also be counted once per
 * layer. A source with no layers does not show up, and there is nothing to hide in
 * it.
 *
 * @param {Object} map - MapLibre map instance
 * @returns {number} How many `visibility` writes were made
 */
export function syncAllSourcesVisibility(map) {
    if (!map || typeof map.getLayersOrder !== 'function') return 0;

    const bySource = new Map();
    for (const layerId of map.getLayersOrder()) {
        const layer = map.getLayer(layerId);
        const sourceId = layer?.source;
        if (!sourceId || UNMANAGED_SOURCE_IDS.has(sourceId)) continue;
        const list = bySource.get(sourceId);
        if (list) list.push(layerId);
        else bySource.set(sourceId, [layerId]);
    }

    let writes = 0;
    for (const [sourceId, layerIds] of bySource) {
        const count = countSourceFeatures(map, sourceId);
        if (count === null) continue;
        writes += applyToLayers(map, layerIds, count === 0);
    }
    return writes;
}

/**
 * Installs the rule on a map: syncs the current state and follows every write from
 * then on.
 *
 * Idempotent. It runs again on every `setupMapFeatures`, that is on every atlas map
 * switch and every base map switch, without stacking listeners.
 *
 * @param {Object} map - MapLibre map instance
 * @returns {Function} Uninstalls the listener (does not show back what was hidden)
 */
export function installEmptySourceVisibility(map) {
    if (!map || typeof map.on !== 'function') return () => {};

    const state = ensureState(map);

    if (!state.handler) {
        state.handler = (event) => {
            // `sourcedata` also fires once per TILE the source produces. Only a
            // data write carries `content`, and only it changes the count.
            if (event?.sourceDataType !== 'content') return;
            if (!event.sourceId) return;
            syncSourceLayersVisibility(map, event.sourceId);
        };
        map.on('sourcedata', state.handler);
    }

    syncAllSourcesVisibility(map);

    return () => {
        if (!state.handler) return;
        map.off('sourcedata', state.handler);
        state.handler = null;
    };
}

/**
 * The layers this module hid on the given map. For tests and diagnostics, never
 * for the render path.
 *
 * @param {Object} map - MapLibre map instance
 * @returns {string[]} Ids of the layers hidden by the rule
 */
export function layersHiddenByRule(map) {
    return [...(stateByMap.get(map)?.hidden || [])];
}

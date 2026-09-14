// Path: js/map/tile-lod.js

/**
 * @fileoverview Tile level-of-detail parameters for a pitched camera, kept on
 * EVERY source the map holds for the whole life of the map.
 *
 * `map.setSourceTileLodParams(maxZoomLevelsOnScreen, tileCountMaxMinRatio)`
 * writes a `calculateTileZoom` function on the sources that exist AT THAT
 * INSTANT and stores no default for later ones (MapLibre 6.7.0, `map.ts`). A
 * source created afterwards falls back to MapLibre's `(9.314, 3)` in silence.
 *
 * WHY ONE CALL IS NOT ENOUGH, measured in the browser on 2026-09-14 with
 * `[4, 8]` in the config and the previous one-shot code: 0 of 100 sources had the
 * function at boot on the default base, because `createMap` ran before the
 * style's sources existed; still 0 after turning the terrain on, after adding a
 * source at runtime, and after a base "switch" to the base already on the map,
 * which skips `setStyle` and therefore skipped the re-apply. The parameter only
 * took effect after the user switched to a DIFFERENT base.
 *
 * So the pair is installed once per map and re-synced on every way a source
 * appears: the `map.addSource` wrapper (synchronous, before any tile request),
 * `styledata` (a `setStyle` adds its sources internally, bypassing the wrapper)
 * and `sourcedata` with `metadata`. Covered sources are tracked by OBJECT, not
 * by id, because `setStyle` replaces a source with a new object under the same id.
 *
 * WHAT THE FIRST NUMBER DOES: it sets how fast the tile zoom drops towards the
 * horizon. The default gives 1,5; `5` gives 0,72; `1` gives 0,00, "one zoom level
 * on the whole screen", which loads the horizon at the zoom of the foreground.
 * A first value below 2 therefore DISABLES the LOD, and this module refuses it
 * and leaves MapLibre's default in place, so a stale config cannot make a
 * pitched view heavier than no config at all.
 */

const MIN_ZOOM_LEVELS_ON_SCREEN = 2;

/** @type {WeakMap<Object, {pair: [number, number], covered: WeakSet<Object>}>} */
const installed = new WeakMap();

/**
 * Validated `[maxZoomLevelsOnScreen, tileCountMaxMinRatio]`, or null when the
 * parameters are absent or would disable the LOD. Null means "keep MapLibre's
 * default", which is the safe outcome.
 *
 * @param {*} params - `config.map2d.sourceTileLodParams`
 * @returns {[number, number]|null}
 */
export function normalizeTileLodParams(params) {
    if (!Array.isArray(params) || params.length < 2) return null;
    const [levels, ratio] = params;
    if (!Number.isFinite(levels) || !Number.isFinite(ratio)) return null;
    if (levels < MIN_ZOOM_LEVELS_ON_SCREEN || ratio < 1) return null;
    return [levels, ratio];
}

/**
 * Applies the installed pair to every source of the map that has not received
 * it yet. Idempotent and cheap: a covered source costs one WeakSet lookup.
 *
 * @param {Object} map - MapLibre map
 * @returns {number} How many sources received the pair in this call
 */
export function syncTileLodParams(map) {
    const state = installed.get(map);
    const managers = map?.style?.tileManagers;
    if (!state || !managers) return 0;

    let applied = 0;
    for (const id of Object.keys(managers)) {
        const source = managers[id]?.getSource?.();
        if (!source || state.covered.has(source)) continue;
        try {
            map.setSourceTileLodParams(state.pair[0], state.pair[1], id);
            state.covered.add(source);
            applied++;
        } catch (error) {
            // One source that refuses must not leave the others on the default.
            console.warn(`[tile-lod] fonte "${id}" recusou o LOD:`, error?.message ?? error);
        }
    }
    return applied;
}

/**
 * Installs the LOD parameters on the map: applies them to the sources that
 * exist now and to every source created later, including the ones a `setStyle`
 * brings. Call it once, right after creating the map. Calling it again with a
 * new pair re-applies to every source without duplicating the listeners.
 *
 * @param {Object} map - MapLibre map
 * @param {*} params - `config.map2d.sourceTileLodParams`
 * @returns {boolean} Whether a valid pair was installed
 */
export function installTileLodParams(map, params) {
    const pair = normalizeTileLodParams(params);
    if (!pair) {
        if (params != null) {
            console.warn('[tile-lod] sourceTileLodParams ignorado: o primeiro valor abaixo de 2 desliga o LOD com a camera inclinada; o padrao do MapLibre fica valendo.', params);
        }
        return false;
    }
    if (typeof map?.setSourceTileLodParams !== 'function' || typeof map.on !== 'function') return false;

    const state = installed.get(map);
    if (state) {
        state.pair = pair;
        state.covered = new WeakSet();
    } else {
        installed.set(map, { pair, covered: new WeakSet() });

        if (typeof map.addSource === 'function') {
            const addSource = map.addSource;
            map.addSource = function addSourceWithTileLod(...args) {
                const result = addSource.apply(this, args);
                syncTileLodParams(map);
                return result;
            };
        }
        map.on('styledata', () => syncTileLodParams(map));
        map.on('sourcedata', (event) => {
            if (event?.sourceDataType === 'metadata') syncTileLodParams(map);
        });
    }

    syncTileLodParams(map);
    return true;
}

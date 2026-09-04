// Path: js/map/tile-lod.js

/**
 * @fileoverview Tile level-of-detail parameters for a pitched camera, applied to
 * EVERY source the style holds, and re-applied after every style swap.
 *
 * `map.setSourceTileLodParams(maxZoomLevelsOnScreen, tileCountMaxMinRatio)` writes
 * a `calculateTileZoom` function on each source that exists at that instant, and
 * `setStyle` replaces every source. The application used to call it once, in
 * `createMap`, before the first `setStyle`: the parameter reached only the first
 * base map, and the whole style fell back to MapLibre's default `(9.314, 3)` on
 * the first base-layer switch. Terrain, hillshade, grid and frame sources never
 * received it at all.
 *
 * WHAT THE FIRST NUMBER DOES, read from the vendored 5.18 bundle: it sets the
 * angular slope of the LOD, that is how fast the tile zoom drops towards the
 * horizon. The default gives 1,5; `5` gives 0,72; `1` gives 0,00, which means
 * "one zoom level on the whole screen", the pre-5.x behaviour that loads the
 * horizon at the same zoom as the foreground. Modelled at pitch 60, the pitch
 * the terrain toggle imposes, `(5, 6)` asks ~4x the tiles of the default and
 * `(1, 10)` ~12x. A first value below 2 therefore DISABLES the LOD, and this
 * module refuses it and leaves MapLibre's default in place, so a stale config
 * cannot make a pitched view heavier than no config at all.
 */

const MIN_ZOOM_LEVELS_ON_SCREEN = 2;

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
 * Applies the LOD parameters to every source the map currently holds. Call it
 * after the map is created AND after every `setStyle`, because the sources are
 * new objects each time.
 *
 * @param {Object} map - MapLibre map
 * @param {*} params - `config.map2d.sourceTileLodParams`
 * @returns {boolean} Whether a valid pair was applied
 */
export function applyTileLodParams(map, params) {
    const pair = normalizeTileLodParams(params);
    if (!pair) {
        if (params != null) {
            console.warn('[tile-lod] sourceTileLodParams ignorado: o primeiro valor abaixo de 2 desliga o LOD com a camera inclinada; o padrao do MapLibre fica valendo.', params);
        }
        return false;
    }
    if (typeof map?.setSourceTileLodParams !== 'function') return false;
    map.setSourceTileLodParams(pair[0], pair[1]);
    return true;
}

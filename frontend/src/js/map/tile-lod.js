// Path: js/map/tile-lod.js

/**
 * @fileoverview Tile level-of-detail parameters for a pitched camera, validated
 * before they reach the map and re-applied after every style swap.
 *
 * WHAT THE MAP DOES WITH THEM, read from the vendored MapLibre 5.18 bundle:
 * `setSourceTileLodParams(maxZoomLevelsOnScreen, tileCountMaxMinRatio)` with no
 * source id loops over `style.tileManagers` and writes a `calculateTileZoom`
 * function on EACH source that exists at that instant
 * (`...getSource().calculateTileZoom = Te(max(1, a), max(1, b))`). It is state per
 * source OBJECT, so a source created later never gets it, and MapLibre's own
 * default is the module-level `Te(9.314, 3)`.
 *
 * WHY THE RE-APPLY EXISTS IN THIS BRANCH. The single call lived in `createMap`,
 * before the first `setStyle`. Until 2026-09-04 a base-map switch here rebuilt the
 * whole style from scratch (the `diffStyles` of 5.18 threw over the application's
 * style, measured in Chromium by the base-map lot), and the 74 sources were
 * recreated without the parameter. With `transformStyle` in place the
 * application's sources survive BY REFERENCE and keep theirs, and it is the base
 * map's own new source that is born with MapLibre's default. Either way the fix is
 * the same one line after `setStyle`.
 *
 * WHY A FIRST VALUE BELOW 2 IS REFUSED. That number sets how fast the tile zoom
 * drops towards the horizon. `1` flattens the drop, which is the pre-5.x behaviour
 * of loading the horizon at the same zoom as the foreground: modelled at pitch 60,
 * the pitch the terrain toggle imposes, `(1, 10)` asks about twelve times the tiles
 * of the default and `(5, 6)` about four times. The map clamps the argument with
 * `Math.max(1, ...)` and asks no further questions, so a stale configuration could
 * make a pitched view heavier than no configuration at all. Refusing it leaves
 * MapLibre's default in place, which is the lightest outcome.
 *
 * `null` is therefore a first-class answer, not an omission, and since 2026-09-04
 * it is what `GET /api/config` serves (`backend/src/modules/config/config.static.js`).
 */

/**
 * Below this, the LOD stops dropping the tile zoom towards the horizon.
 * Mirrored on the server side by the `sourceTileLodParams` rule of
 * `backend/src/modules/config/config.admin.schemas.js`, which refuses the same
 * pair at the edge so a saved override can never reach a client.
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
 * after the map is created AND after every `setStyle`, because the base map's
 * sources are new objects each time.
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

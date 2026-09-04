// Path: js/layers/setup-mode.js

/**
 * @fileoverview Decides how much of `setupMapFeatures` has to run after a base-map
 * change.
 *
 * With `transformStyle` (base-layer.control.js) the application's sources and
 * layers survive `setStyle`. When the atlas map is the same as before, every
 * feature collection is already on the map, and rebuilding it means 30 `setData`,
 * 43 `setFilter` and 44 `setPaintProperty` on live sources, each of which makes
 * MapLibre reload that source's tiles (969 `reloadTile` measured on 2026-09-03).
 * The light mode skips exactly that work. It is only taken when the caller says
 * the map did not change AND an application source is still on the map: if the
 * style diff ever fell back to a full rebuild (MapLibre's `_updateStyle`), the
 * application sources are gone and the full setup runs as before.
 */

/**
 * @param {{ contentPreserved?: boolean }} [options] - What the caller knows
 * @param {boolean} hasApplicationSource - Whether an application source (`points`)
 *   is still registered on the map
 * @returns {'full'|'preserved'}
 */
export function resolveSetupMode(options, hasApplicationSource) {
    if (options?.contentPreserved === true && hasApplicationSource === true) {
        return 'preserved';
    }
    return 'full';
}

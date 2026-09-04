// Path: js/layers/setup-mode.js

/**
 * @fileoverview Decides how much of `setupMapFeatures` has to run after a base-map
 * change.
 *
 * With `transformStyle` (`baselayers/style-transform.js`) the application's
 * sources and layers survive `setStyle`. When the atlas map is the same as
 * before, every feature collection is already on the map, and rebuilding it
 * means 30 `setData`, 43 `setFilter` and 44 `setPaintProperty` on live sources,
 * each of which makes MapLibre reload that source's tiles (969 `reloadTile`
 * measured upstream on 2026-09-03).
 *
 * IN THIS BRANCH THE LIGHT MODE IS NOT ONLY CHEAPER, IT IS THE CORRECT ONE, and
 * that is the reason it cannot be treated as an optimisation to drop under
 * doubt. Sixteen feature sources are written through the diff dispatcher
 * (`layers/geojson-dispatcher.js`), and the rebuild writes each of them whole,
 * through `setOrCreateSource` -> `writeWholeCollection`. A whole collection is a
 * `replaceAll`, which by the dispatcher's own contract DISCARDS whatever that
 * source had queued. Measured here on 2026-09-04 against a fake map: a feature
 * queued and not yet flushed is gone after one such write, with no error
 * anywhere. So a base-map change on the same atlas map would erase what the user
 * had just drawn and the queue had not yet delivered.
 *
 * The light mode is only taken when the caller says the map did not change AND
 * an application source is still on the map: if the style diff ever fell back to
 * a full rebuild (MapLibre's `_updateStyle`, taken when `Style.setState` throws),
 * the application sources are gone and the full setup runs as before.
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

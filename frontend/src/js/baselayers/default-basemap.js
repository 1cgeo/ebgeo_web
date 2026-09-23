// Path: js/baselayers/default-basemap.js

/**
 * @fileoverview The DEFAULT BASEMAP: the catalog id the map is born with on opening and that a
 * new map document gets.
 *
 * IT WAS A CONSTANT UNTIL 2026-09-23 (`DEFAULT_LAYER = 'carta-topografica'` in
 * `base-layer.control.js`). The owner asked for it to be the administrator's choice, in the
 * "Sistema" tab, so it is now `config.map2d.defaultBasemap`, served by `GET /api/config`
 * (`MAP2D_BASE` in `backend/src/modules/config/config.static.js`, whose default is the old
 * constant: a deploy with no override behaves as before).
 *
 * READ AT EVERY CALL, never at module load. `config` is a shell until `applyRuntimeConfig`
 * hydrates it (`store/sync/runtime-config.js`), and this module is imported long before that by
 * the store and by the base-layer control; a value captured at import would always be the floor.
 *
 * A LEAF WITH ONE IMPORT, `config.js`, which has none: the store reads this for the blank map
 * document (`store/repository.utils.js`), and reaching the base-layer control from there would
 * drag MapLibre styles into the store.
 *
 * This answers what was CONFIGURED, not what this viewer can draw. Which base the map is actually
 * born with (the configured one when this viewer's catalogue offers it, a fallback otherwise) is
 * `initialBaseLayer`, in `base-layer.control.js`, because only that module knows the built-in
 * styles.
 */

import config from '../config.js';

/**
 * The floor, used when the server serves no choice (a partial `/api/config`, or a page that never
 * hydrated `config`). The same value as `MAP2D_BASE.defaultBasemap` on the server, and
 * `tests/unit/basemap-padrao-configuravel.test.js` holds the two together.
 */
export const FACTORY_DEFAULT_BASEMAP = 'carta-topografica';

/**
 * The default basemap id this deploy is configured with.
 * @returns {string} `config.map2d.defaultBasemap` when it is a non-empty string, else the floor.
 */
export function defaultBasemap() {
    const id = config.map2d?.defaultBasemap;
    return typeof id === 'string' && id.trim() ? id.trim() : FACTORY_DEFAULT_BASEMAP;
}

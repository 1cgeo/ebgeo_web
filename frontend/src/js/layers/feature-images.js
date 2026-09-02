// Path: js/layers/feature-images.js

/**
 * @fileoverview The ONE sweep over a feature collection that answers "which images does this
 * set of features need registered on the map, and under which ids".
 *
 * WHY IT EXISTS. Some feature families draw a raster registered on the MapLibre instance
 * under the feature's own `properties.id`: the style resolves it with
 * `'icon-image': ['get', 'id']` (`layers/styles/symbol.layers.js`). So an id that changes,
 * as it does on every paste, needs a fresh registration, and there is no fallback: the
 * feature simply draws nothing.
 *
 * Two paths read a collection keyed by storage type and have to do that registration, and
 * until 2026-09-02 each wrote its own list of buckets by hand: pasting
 * (`tool_manager/clipboard_manager.js`) and the map setup that runs on load, on map switch
 * and on base-layer switch (`layers/layer_setup.js`). The paste list was two families behind
 * the setup list, so a pasted coordination measure or magnetic declination drew nothing until
 * a reload, with no error anywhere. Nothing caught it: the local paste emits no
 * `FEATURE_CREATED` (only the remote path does), so it never reaches the setup sweep.
 *
 * The list is now DERIVED, from `IMAGE_RESOURCE_STORAGE_TYPES`, which is itself derived from
 * the feature-type registry. A family born there is registered by both paths on the same
 * commit, without either file being touched.
 *
 * WHY IT RETURNS THE FEATURE AND NOT ONLY THE ID. The setup path needs the feature object:
 * when no local blob exists it rebuilds the raster from the feature's own properties through
 * `image-regen-registry.js`. The paste path only needs the id, and gets it from
 * `collectImageResourceIds`, which is this same sweep with the objects dropped.
 */

import { IMAGE_RESOURCE_STORAGE_TYPES } from '@store/store.constants.js';

/**
 * @typedef {Object} ParDeImagem
 * @property {string} imageId - The id the raster is registered under (the feature's own id)
 * @property {Object} feature - The feature that needs it, for the props-based rebuild path
 */

/**
 * Walks the image-bearing buckets of a feature collection and pairs each image id with the
 * feature that needs it.
 *
 * Tolerant on purpose: a bucket may be absent (the empty map shape does not always carry
 * every key), may be something other than an array (a malformed import), and a feature may
 * have lost its id. None of those is worth throwing over in a rendering path, and each of
 * them used to be a silent `undefined` reaching `map.addImage`.
 *
 * @param {Object|null|undefined} featuresByStorageType - Collection keyed by storage type
 * @returns {ParDeImagem[]} One entry per distinct id, in registry order
 */
export function collectImageResourceFeatures(featuresByStorageType) {
    if (!featuresByStorageType || typeof featuresByStorageType !== 'object') return [];

    const pares = [];
    const vistos = new Set();

    for (const bucket of IMAGE_RESOURCE_STORAGE_TYPES) {
        const lista = featuresByStorageType[bucket];
        if (!Array.isArray(lista)) continue;

        for (const feature of lista) {
            const imageId = feature?.properties?.id;
            if (!imageId || vistos.has(imageId)) continue;
            vistos.add(imageId);
            pares.push({ imageId, feature });
        }
    }

    return pares;
}

/**
 * The same sweep, keeping only the ids. For the caller that loads a stored blob and has no
 * use for the feature object.
 *
 * @param {Object|null|undefined} featuresByStorageType - Collection keyed by storage type
 * @returns {string[]} One id per distinct image, in registry order
 */
export function collectImageResourceIds(featuresByStorageType) {
    return collectImageResourceFeatures(featuresByStorageType).map(par => par.imageId);
}

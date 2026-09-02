// Path: js/layers/feature-images.js

/**
 * @fileoverview Resolves which MapLibre images a feature collection needs.
 *
 * The symbol layers declare `icon-image: [get, id]`, so an image-backed feature
 * renders only if an image named after its own `properties.id` is registered on
 * the map. Two paths register them: the boot path (layer_setup.setImages) and
 * the paste path (ClipboardManager.loadPastedImages). Each used to keep its own
 * hand-written list of buckets, and the paste one was written before
 * coordination measures and magnetic declinations existed, so those pasted
 * invisible. Both now read the single derived list below.
 *
 * Pure and dependency-light on purpose (its only import is a leaf constants
 * module), so it stays testable in plain node.
 */

import { IMAGE_RESOURCE_STORAGE_TYPES } from '@js/store/store.constants.js';

/**
 * Collects the image ids required by every image-backed feature in a collection.
 * @param {Object<string, Array<Object>>} [featuresByStorageType] - Feature
 *   collection keyed by storage type (e.g. `coordination_measures`). Missing or
 *   non-array buckets are skipped.
 * @returns {string[]} Unique `properties.id` values, in bucket order.
 */
export function collectImageResourceIds(featuresByStorageType) {
    if (!featuresByStorageType) return [];

    const imageIds = new Set();

    for (const storageType of IMAGE_RESOURCE_STORAGE_TYPES) {
        const features = featuresByStorageType[storageType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            const imageId = feature?.properties?.id;
            if (imageId) imageIds.add(imageId);
        }
    }

    return [...imageIds];
}

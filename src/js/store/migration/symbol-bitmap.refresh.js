// Path: js/store/migration/symbol-bitmap.refresh.js

/**
 * @fileoverview Rebuilds the stale symbol bitmaps of one map's feature collection.
 *
 * Two callers share this: the v2.3 -> v2.4 storage migration and the `.ebgeo`
 * import. Both hold a plain feature collection (the object keyed by storage type)
 * and both need the same answer — which features still carry a version 1 bitmap,
 * and what to write in its place.
 *
 * Everything here is pure except the injected `regenerate`, so the whole pass is
 * testable in `node` with fake generators. Persisting the blobs is the caller's
 * job: the migration talks to localforage directly (it runs before the repository
 * exists), the import goes through `storeImage`.
 *
 * @module store/migration/symbol-bitmap.refresh
 */

import { getStorageTypeFromSource, getSourceTypeFromStorage } from '../store.constants.js';
import { applyGeneratedBitmap } from '@js/military_tools/bitmap-version.js';
import { isStaleBitmapFeature, regenerateSymbolBitmap } from '@js/military_tools/symbol-bitmap.regenerate.js';

/**
 * The buckets that hold bitmap-backed features. Derived from the canonical
 * mapping because the plurals are irregular and a hand-written `military_symbols`
 * would silently stop matching if the mapping ever moved.
 * @constant {string[]}
 */
const BITMAP_STORAGE_TYPES = Object.freeze([
    getStorageTypeFromSource('military_symbol'),
    getStorageTypeFromSource('coordination_measure'),
]);

/**
 * Lists the features whose bitmap predates the current layout.
 *
 * Degenerate input is expected here, not exceptional: this runs over data written
 * by every past version of the app, including hand-edited `.ebgeo` files. A missing
 * bucket, a bucket that is not an array and a feature without properties are all
 * simply skipped.
 *
 * @param {Object} featuresByStorageType - A map's feature collection
 * @returns {Array<{storageType: string, featureType: string, feature: Object}>} Stale features
 */
export function findStaleBitmapFeatures(featuresByStorageType) {
    if (!featuresByStorageType || typeof featuresByStorageType !== 'object') return [];

    const stale = [];

    for (const storageType of BITMAP_STORAGE_TYPES) {
        const bucket = featuresByStorageType[storageType];
        if (!Array.isArray(bucket)) continue;

        const featureType = getSourceTypeFromStorage(storageType);

        for (const feature of bucket) {
            const properties = feature?.properties;
            if (!properties || typeof properties !== 'object') continue;
            if (!isStaleBitmapFeature(featureType, properties)) continue;

            stale.push({ storageType, featureType, feature });
        }
    }

    return stale;
}

/**
 * Regenerates every stale bitmap of a feature collection, stamping the properties
 * in place and handing the caller the blobs to persist.
 *
 * A feature that fails to regenerate — or whose blob `onBlob` fails to persist — is
 * left EXACTLY as it was, unstamped, and counted, so a later pass retries it.
 * Failing one symbol must never abort the pass: the cost of a stale bitmap is a
 * selection box larger than the drawing, the cost of aborting is an application
 * that will not start.
 *
 * A feature without an id counts as a failure too: its blob has nowhere to go (the
 * image store is keyed by feature id), so stamping it would claim a fresh bitmap
 * that is not on disk.
 *
 * @param {Object} featuresByStorageType - A map's feature collection (mutated)
 * @param {Object} [options] - Options
 * @param {Function} [options.regenerate] - `(featureType, properties) => Promise<result|null>`
 * @param {Function} [options.onBlob] - `(id, blob) => Promise<void>`, awaited BEFORE the
 *   properties are stamped; a throw counts the feature as failed
 * @returns {Promise<{updated: number, failed: number, blobs: Map<string, Blob>}>} Pass summary
 */
export async function refreshStaleBitmaps(
    featuresByStorageType,
    { regenerate = regenerateSymbolBitmap, onBlob } = {}
) {
    const stale = findStaleBitmapFeatures(featuresByStorageType);
    const blobs = new Map();
    let updated = 0;
    let failed = 0;

    for (const { featureType, feature } of stale) {
        const id = feature.properties.id;
        let result = null;

        // The blob is handed out BEFORE the properties are stamped: a stamp claims
        // that the bitmap on disk is the cropped one, and a failed write (quota,
        // IndexedDB error) must leave the feature unstamped and counted, not abort
        // the whole pass.
        try {
            result = await regenerate(featureType, feature.properties);
            if (result?.blob && id && typeof onBlob === 'function') {
                await onBlob(id, result.blob);
            }
        } catch (error) {
            console.warn(`Bitmap refresh failed for ${featureType} ${id}`, error);
            result = null;
        }

        if (!result?.blob || !id) {
            failed++;
            continue;
        }

        applyGeneratedBitmap(feature.properties, result);
        // The generators used here return no data URL, and nothing reads the
        // `imageUrl` the tools also keep; a base64 copy of the OLD bitmap must not
        // survive the refresh inside the properties (and every `.ebgeo`).
        delete feature.properties.imageUrl;
        blobs.set(id, result.blob);
        updated++;
    }

    return { updated, failed, blobs };
}

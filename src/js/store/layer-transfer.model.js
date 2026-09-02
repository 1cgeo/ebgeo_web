// Path: js/store/layer-transfer.model.js

/**
 * @fileoverview Pure model for moving/copying a whole layer between maps.
 *
 * Zero store imports on purpose: every decision here (target name, which
 * features may travel, how a feature and a layer record are reshaped for the
 * destination) is arithmetic over plain objects, so it is node-testable and
 * cannot reach IndexedDB, the memory store or the current-map singleton.
 *
 * Two properties this module guarantees and the operation relies on:
 * - nothing here mutates its input (every reshape returns a deep clone), so a
 *   failure downstream leaves the source features exactly as they were;
 * - no id is generated here. Ids arrive as parameters, which is what keeps the
 *   functions deterministic under test and keeps `generateUUID` (and its
 *   `crypto` dependency) out of the pure layer.
 */

import { deepClone } from '@utils/deep-utils.js';

/**
 * Transfer modes.
 * `move` empties the source layer; `copy` leaves it untouched.
 * @readonly
 * @enum {string}
 */
export const TransferMode = Object.freeze({
    MOVE: 'move',
    COPY: 'copy'
});

/**
 * Find the next available numbered name given a base name and existing names.
 * Same rule as the private helper behind `IDUtils.generateUniqueLayerName`
 * ("Base", then "Base #2", "Base #3"...). Reimplemented instead of imported
 * because that helper is not exported and `id_utils.js` imports the `@store`
 * barrel, which would close an import cycle from inside the store.
 *
 * @param {string[]} existingNames - Names already in use
 * @param {string} baseName - Base name to derive from
 * @returns {string} Unique name
 */
function findNextAvailableName(existingNames, baseName) {
    if (!existingNames || existingNames.length === 0) {
        return baseName;
    }

    const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escaped}(?: #(\\d+))?$`);
    const usedNumbers = new Set();

    for (const name of existingNames) {
        const match = name.match(pattern);
        if (match) {
            const num = match[1] ? parseInt(match[1], 10) : 1;
            usedNumbers.add(num);
        }
    }

    if (!usedNumbers.has(1)) {
        return baseName;
    }

    let nextNumber = 2;
    while (usedNumbers.has(nextNumber)) {
        nextNumber++;
    }

    return `${baseName} #${nextNumber}`;
}

/**
 * Picks the name the transferred layer gets in the destination map.
 *
 * @param {string} sourceName - Name of the layer being transferred
 * @param {Array<{name?: string}>} [targetLayers] - Layers already in the destination
 * @returns {string} A name not yet used in the destination
 */
export function buildTargetLayerName(sourceName, targetLayers = []) {
    const base = typeof sourceName === 'string' && sourceName.trim()
        ? sourceName.trim()
        : 'Camada';
    const existingNames = (targetLayers || [])
        .map(layer => layer?.name)
        .filter(name => typeof name === 'string');

    return findNextAvailableName(existingNames, base);
}

/**
 * Splits a per-storage-type feature collection into what may travel and what
 * must stay behind.
 *
 * Analysis features (LOS / visibility) stay in BOTH modes: their rendered
 * children live in `processed_los` / `processed_visibility`, buckets that
 * `getAllStorageTypes()` does not list, so carrying the parent across would
 * leave the children orphaned in the source map.
 *
 * @param {Object<string, Object[]>} featuresByStorageType - Features keyed by storage type
 * @param {function(string): boolean} [isUncopyable] - Predicate over the singular source type
 * @returns {{ transferable: Object<string, Object[]>, skipped: Object[] }}
 */
export function partitionTransferableFeatures(featuresByStorageType, isUncopyable) {
    const transferable = {};
    const skipped = [];

    if (!featuresByStorageType || typeof featuresByStorageType !== 'object') {
        return { transferable, skipped };
    }

    const predicate = typeof isUncopyable === 'function' ? isUncopyable : () => false;

    for (const [storageType, features] of Object.entries(featuresByStorageType)) {
        if (!Array.isArray(features) || features.length === 0) continue;

        const kept = [];
        for (const feature of features) {
            // A feature with no `source` is not an analysis feature: the
            // predicate answers false for undefined, so it travels.
            if (predicate(feature?.properties?.source)) {
                skipped.push(feature);
            } else {
                kept.push(feature);
            }
        }

        if (kept.length > 0) {
            transferable[storageType] = kept;
        }
    }

    return { transferable, skipped };
}

/**
 * Reshapes one feature for the destination layer. Never mutates the input.
 *
 * `copy` mints a brand new identity (both the sync id in `properties.id` and
 * the GeoJSON `id` MapLibre keys on) and restarts the sync metadata, because
 * the result is a different object that will be synced on its own.
 * `move` keeps the identity and `createdAt` (it is the same object in a new
 * home) and only bumps `updatedAt`/`version`, like any other update.
 *
 * @param {Object} feature - Source feature
 * @param {Object} options
 * @param {string} options.mode - TransferMode.MOVE or TransferMode.COPY
 * @param {string} options.layerId - Destination layer id
 * @param {string} [options.newId] - New `properties.id` (required in copy mode)
 * @param {string|number} [options.newGeoJsonId] - New GeoJSON `id` (copy mode)
 * @param {number} [options.now] - Timestamp to stamp
 * @returns {Object} A new feature object
 */
export function remapFeatureForTransfer(feature, options = {}) {
    if (!feature || typeof feature !== 'object') {
        throw new Error('remapFeatureForTransfer: feature is required');
    }

    const { mode, layerId, newId, newGeoJsonId, now = Date.now() } = options;

    if (mode !== TransferMode.MOVE && mode !== TransferMode.COPY) {
        throw new Error(`remapFeatureForTransfer: mode must be "move" or "copy", got "${mode}"`);
    }
    if (mode === TransferMode.COPY && !newId) {
        throw new Error('remapFeatureForTransfer: newId is required in copy mode');
    }

    const clone = deepClone(feature);
    if (!clone.properties || typeof clone.properties !== 'object') {
        clone.properties = {};
    }

    clone.properties.layerId = layerId;

    if (mode === TransferMode.COPY) {
        clone.properties.id = newId;
        clone.id = newGeoJsonId ?? newId;
        clone.properties.createdAt = now;
        clone.properties.updatedAt = now;
        clone.properties.version = 1;
        return clone;
    }

    clone.properties.updatedAt = now;
    const previousVersion = clone.properties.version;
    clone.properties.version = Number.isFinite(previousVersion) ? previousVersion + 1 : 1;
    return clone;
}

/**
 * Highest `order` in a layer list, plus one. Empty list starts at 0.
 * @param {Array<{order?: number}>} targetLayers
 * @returns {number}
 * @private
 */
function nextLayerOrder(targetLayers) {
    const orders = (targetLayers || [])
        .map(layer => (Number.isFinite(layer?.order) ? layer.order : 0));
    return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

/**
 * Builds the layer record the destination map receives.
 *
 * Style state travels (visibility, lock, opacity and any other attribute the
 * source record carries), because a copied layer that came back fully visible
 * and unlocked would silently discard the author's intent. Identity does not:
 * the id is always new, since layer ids are NOT unique across maps (every map
 * born from `getDefaultLayer()` carries a layer literally called `default`).
 *
 * @param {Object} sourceLayer - Layer record being transferred
 * @param {Array<{order?: number, name?: string}>} [targetLayers] - Destination layers
 * @param {Object} options
 * @param {string} options.id - Id for the new record (caller-generated)
 * @param {string} [options.name] - Name for the new record
 * @param {number} [options.now] - Timestamp to stamp
 * @returns {Object} New layer record
 */
export function buildTargetLayerRecord(sourceLayer, targetLayers = [], options = {}) {
    const { id, name, now = Date.now() } = options;

    if (!id) {
        throw new Error('buildTargetLayerRecord: id is required');
    }

    const source = sourceLayer && typeof sourceLayer === 'object' ? sourceLayer : {};
    const record = deepClone(source);

    record.id = id;
    record.name = name || buildTargetLayerName(source.name, targetLayers);
    record.visible = source.visible !== false;
    record.locked = source.locked === true;
    record.opacity = Number.isFinite(source.opacity) ? source.opacity : 1;
    record.order = nextLayerOrder(targetLayers);
    record.createdAt = now;
    record.updatedAt = now;
    record.version = 1;

    return record;
}

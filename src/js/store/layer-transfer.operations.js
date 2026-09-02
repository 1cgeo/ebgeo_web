// Path: js/store/layer-transfer.operations.js

/**
 * @fileoverview Moves or copies a whole layer (record + features) to another
 * map of the same atlas.
 *
 * THREE THINGS HERE ARE NOT OPTIONAL, and each one is a defect this file
 * exists to avoid:
 *
 * 1. THE DESTINATION LAYER LIST COMES FROM THE REPOSITORY, NEVER FROM MEMORY.
 *    `memoryStore.layers` is hydrated one map at a time (`loadLayersToMemory`,
 *    called by `setCurrentMap`), and `LayerManager._resolveMap` FABRICATES a
 *    `new Map([['default', getDefaultLayer()]])` for any map it has not seen.
 *    Writing through the memory path (`createLayerForImport(name, 'MapaB')`)
 *    therefore persists `[default, nova]` OVER the real layers of a map that
 *    was never visited this session, with no error anywhere. So: read with
 *    `getLayersCompat`, write with `setLayersCompat`, and only afterwards
 *    reconcile memory IF that map happens to be hydrated.
 *
 * 2. `memoryStore.activeLayerId` IS GLOBAL, not per map. `loadLayersToMemory`
 *    and `setActiveLayer` both write it, so touching either for the DESTINATION
 *    map would silently move the active layer of the map the user is looking at.
 *    Nothing here writes that field.
 *
 * 3. DESTINATION FIRST, SOURCE LAST. The features are written to the target and
 *    the write is read back before anything is removed from the source. The
 *    worst case is then a recoverable duplicate, never a loss.
 *
 * Layer ids are NOT unique across maps (`getDefaultLayer()` always returns the
 * id `default`), so the destination record always gets a freshly generated id.
 */

import { getLayersCompat, setLayersCompat, getMapDataCompat } from './repositories/index.js';
import {
    getAllStorageTypes,
    hasImageResource,
    isUncopyableFeatureType
} from './store.constants.js';
import { getImage, storeImage, removeImage } from './settings.operations.js';
import {
    addFeatures,
    deleteLayerFeatures,
    getLayerFeaturesByStorageType
} from './feature.operations.js';
import { deleteLayerOnly } from './layer.operations.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { logLayerOperation, OperationType } from './sync/index.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { runTransaction } from './store-transaction.js';
import {
    TransferMode,
    buildTargetLayerName,
    buildTargetLayerRecord,
    partitionTransferableFeatures,
    remapFeatureForTransfer
} from './layer-transfer.model.js';
import { generateUUID } from '@utils/uuid.js';
import { EventTypes } from '@events';

export { TransferMode };

// ===== DEPENDENCY INJECTION =====

/** @type {import('./store.types.js').StoreDependencies} */
const deps = { eventBus: null, layerManager: null };

/**
 * Sets dependencies for layer transfer operations.
 * @param {import('./store.types.js').StoreDependencies} dependencies
 */
export function setLayerTransferDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== PRIVATE HELPERS =====

/**
 * Emits a blocked-operation event and shapes the refusal result.
 * @param {string} reason - Machine-readable reason
 * @param {string} mode - Transfer mode
 * @param {Object} [extra] - Extra fields the caller needs in order to phrase it
 * @returns {{ success: false, reason: string, mode: string }}
 * @private
 */
function refuse(reason, mode, extra = {}) {
    emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
        operation: 'transferLayerToMap',
        reason
    });
    return { success: false, reason, mode, ...extra };
}

/**
 * Generates a GeoJSON `id` (MapLibre keys features on it and wants a number).
 * Mirrors IDUtils.generateGeoJSONId, which cannot be imported here: id_utils.js
 * imports the `@store` barrel and would close a cycle.
 * @returns {number}
 * @private
 */
function generateGeoJsonId() {
    return Date.now() + Math.floor(Math.random() * 10000);
}

/**
 * Mirrors the new layer into the destination's in-memory cache, but ONLY if
 * that map is already hydrated. Creating the entry here would be worse than
 * doing nothing: a half-built cache is indistinguishable from a real one, and
 * the next `_persistLayersAsync` for that map would write it over the disk.
 * Never touches `memoryStore.activeLayerId` (see file header, point 2).
 *
 * @param {string} targetMapName
 * @param {Object} newLayer
 * @private
 */
function mirrorLayerIntoHydratedMemory(targetMapName, newLayer) {
    const hydrated = memoryStore.layers?.[targetMapName];
    if (!hydrated || typeof hydrated.set !== 'function') return;
    hydrated.set(newLayer.id, newLayer);
}

/**
 * Counts how many features of a map already carry a given layer id.
 * Read back from the repository, i.e. by a path independent of the write, so a
 * write that was refused in silence cannot be mistaken for a write that landed.
 *
 * @param {string} mapName
 * @param {string} layerId
 * @returns {Promise<number>}
 * @private
 */
async function countFeaturesInLayer(mapName, layerId) {
    const mapData = await getMapDataCompat(mapName);
    let count = 0;

    for (const storageType of getAllStorageTypes()) {
        for (const feature of mapData?.features?.[storageType] || []) {
            if (feature.properties?.layerId === layerId) count++;
        }
    }
    return count;
}

/**
 * Duplicates one image blob under a new id. Returns false instead of throwing:
 * a missing thumbnail must not abort a transfer that already succeeded.
 * @param {string} oldId
 * @param {string} newId
 * @returns {Promise<boolean>}
 * @private
 */
async function duplicateImageBlob(oldId, newId) {
    const blob = await getImage(oldId);
    if (!blob) return false;
    await storeImage(newId, blob);
    return true;
}

/**
 * Reshapes every transferable feature for the destination layer and collects
 * the image-blob duplications the copy mode needs.
 *
 * @param {Object<string, Object[]>} transferable
 * @param {Object} context
 * @param {string} context.mode
 * @param {string} context.layerId
 * @param {number} context.now
 * @returns {{ featuresByType: Object<string, Object[]>, total: number,
 *   blobJobs: Promise<boolean>[], duplicatedImageIds: string[] }}
 * @private
 */
function remapFeatures(transferable, { mode, layerId, now }) {
    const isCopy = mode === TransferMode.COPY;
    const featuresByType = {};
    const blobJobs = [];
    const duplicatedImageIds = [];
    let total = 0;

    for (const [storageType, features] of Object.entries(transferable)) {
        const bucket = [];

        for (const feature of features) {
            const oldId = feature.properties?.id;
            const newId = isCopy ? generateUUID() : oldId;

            bucket.push(remapFeatureForTransfer(feature, {
                mode,
                layerId,
                newId,
                newGeoJsonId: isCopy ? generateGeoJsonId() : feature.id,
                now
            }));
            total++;

            // Blobs live in a GLOBAL store keyed by the feature id: a move
            // carries the id along and must not touch them; a copy mints a new
            // id and therefore needs its own blob.
            if (isCopy && oldId && hasImageResource(feature.properties?.source)) {
                blobJobs.push(duplicateImageBlob(oldId, newId));
                duplicatedImageIds.push(newId);
            }
        }

        featuresByType[storageType] = bucket;
    }

    return { featuresByType, total, blobJobs, duplicatedImageIds };
}

/**
 * Undoes the destination-side writes made before the features failed to land.
 *
 * The layer record has to be written BEFORE the features (they need its id), so
 * a feature write that is refused or that throws would otherwise leave an empty
 * layer sitting in a map the user never opened and, in copy mode, duplicated
 * blobs with nothing referencing them. Neither is recoverable by looking at the
 * destination: an empty layer is indistinguishable from one somebody made, and
 * an orphan blob is invisible.
 *
 * Best-effort by construction: this runs while something else is already
 * failing, so every step is isolated and only warns. It must never mask the
 * original failure.
 *
 * @param {string} targetMapName
 * @param {Array<Object>} previousLayers - Destination layer list before the write
 * @param {Object} newLayer - The record to take back out
 * @param {string[]} duplicatedImageIds - Blob ids minted by a copy
 * @private
 */
async function rollbackTargetLayer(targetMapName, previousLayers, newLayer, duplicatedImageIds) {
    try {
        await setLayersCompat(targetMapName, previousLayers);
    } catch (error) {
        console.warn('transferLayerToMap: could not roll back the destination layer list:', error);
    }

    try {
        const hydrated = memoryStore.layers?.[targetMapName];
        if (hydrated && typeof hydrated.delete === 'function') {
            hydrated.delete(newLayer.id);
        }
    } catch (error) {
        console.warn('transferLayerToMap: could not roll back the in-memory layer:', error);
    }

    for (const imageId of duplicatedImageIds) {
        try {
            await removeImage(imageId);
        } catch (error) {
            console.warn('transferLayerToMap: could not release orphan blob ' + imageId + ':', error);
        }
    }
}

// ===== PUBLIC OPERATION =====

/**
 * Moves or copies a layer of the current map (record + features) into another
 * map of the same atlas.
 *
 * Analysis features (LOS / visibility) never travel, because their rendered
 * children live in `processed_los`/`processed_visibility`, buckets that
 * `getAllStorageTypes()` does not list. THE TWO MODES ANSWER THAT DIFFERENTLY, and
 * the asymmetry is the whole point: `copy` skips them, reports them in
 * `skippedCount` and leaves the originals where they are; `move` REFUSES
 * outright (`analysis_features_present`, carrying `skippedCount`), because the
 * removal step sweeps EVERY bucket by layer id and would destroy in the source
 * exactly the features the partition had just spared, orphaning their
 * `processed_*` children along the way.
 *
 * LOCKS ARE NOT SYMMETRIC BETWEEN THE MODES, because the modes do not write to
 * the same places. A locked DESTINATION map refuses both. A locked source map,
 * or a locked source layer, refuses only `move`, the only mode that takes
 * anything out of the source; `copy` reads the source and leaves it untouched.
 *
 * @param {string} layerId - Layer to transfer (must belong to the current map)
 * @param {string} targetMapName - Destination map name
 * @param {Object} options
 * @param {string} options.mode - TransferMode.MOVE or TransferMode.COPY
 * @returns {Promise<{ success: boolean, mode: string, reason?: string, movedCount?: number,
 *   skippedCount?: number, targetLayerId?: string, targetLayerName?: string,
 *   sourceLayerRemoved?: boolean }>}
 *   On a successful move, `sourceLayerRemoved` is false when the features left the
 *   source but the layer RECORD could not be deleted (deleteLayerOnly carries
 *   guards of its own). The transfer still succeeded; what stays behind is an
 *   empty layer, and the caller may say so.
 */
export async function transferLayerToMap(layerId, targetMapName, options = {}) {
    const mode = options?.mode;

    if (typeof layerId !== 'string' || !layerId.trim()) {
        throw new Error('transferLayerToMap: layerId is required');
    }
    if (typeof targetMapName !== 'string' || !targetMapName.trim()) {
        throw new Error('transferLayerToMap: targetMapName is required');
    }
    if (mode !== TransferMode.MOVE && mode !== TransferMode.COPY) {
        throw new Error(`transferLayerToMap: mode must be "move" or "copy", got "${mode}"`);
    }
    if (!deps.layerManager) {
        throw new Error('transferLayerToMap: layerManager dependency is not set');
    }

    const sourceMapName = mapManager.getCurrentMapName();

    // ----- Expected failures: refuse, name the state, leave everything intact -----

    const createPerm = checkPermission(GuardAction.CREATE_FEATURE);
    if (!createPerm.allowed) return refuse('permission_denied', mode);

    if (mode === TransferMode.MOVE) {
        const deletePerm = checkPermission(GuardAction.DELETE_FEATURE);
        if (!deletePerm.allowed) return refuse('permission_denied', mode);
    }

    if (targetMapName === sourceMapName) return refuse('same_map', mode);

    // The DESTINATION lock refuses both modes: either one writes there.
    if (memoryStore.lockedMaps?.has(targetMapName)) return refuse('target_map_locked', mode);

    // The SOURCE locks (map and layer) refuse only the move, which is the only
    // mode that writes back to the source. A copy reads the source and leaves it
    // byte for byte as it was, so refusing it would deny a harmless action and
    // make the lock read as a general ban on the layer.
    if (mode === TransferMode.MOVE && isCurrentMapLockedSync()) {
        return refuse('map_locked', mode);
    }

    const sourceLayer = deps.layerManager.getLayerById(layerId, sourceMapName);
    if (!sourceLayer) return refuse('layer_not_found', mode);
    if (mode === TransferMode.MOVE && sourceLayer.locked === true) {
        return refuse('layer_locked', mode);
    }

    // ----- Collect what travels -----

    const featuresByStorageType = await getLayerFeaturesByStorageType(layerId, sourceMapName);
    const { transferable, skipped } = partitionTransferableFeatures(
        featuresByStorageType,
        isUncopyableFeatureType
    );
    const skippedCount = skipped.length;

    // A move deletes EVERY feature carrying this layer id from the source,
    // analysis buckets included, so the features the partition just spared
    // would be destroyed there and their processed children orphaned. Refuse
    // before writing anything; the user can copy, or delete those first.
    if (mode === TransferMode.MOVE && skippedCount > 0) {
        return refuse('analysis_features_present', mode, { skippedCount });
    }

    // ----- Create the destination layer record (repository first) -----

    const now = Date.now();
    const targetLayers = (await getLayersCompat(targetMapName)) || [];
    const newLayer = buildTargetLayerRecord(sourceLayer, targetLayers, {
        id: generateUUID(),
        name: buildTargetLayerName(sourceLayer.name, targetLayers),
        now
    });
    const nextLayers = [...targetLayers, newLayer];

    await runTransaction(async (tx) => {
        tx.deferSync(() => mirrorLayerIntoHydratedMemory(targetMapName, newLayer));
        tx.deferAsync(() =>
            logLayerOperation(OperationType.CREATE, newLayer.id, targetMapName, newLayer)
        );
        return () => setLayersCompat(targetMapName, nextLayers);
    });

    // ----- Write the features into the destination -----

    const { featuresByType, total, blobJobs, duplicatedImageIds } = remapFeatures(transferable, {
        mode,
        layerId: newLayer.id,
        now
    });

    if (blobJobs.length > 0) {
        const results = await Promise.allSettled(blobJobs);
        const failed = results.filter(r => r.status === 'rejected' || r.value === false).length;
        if (failed > 0) {
            console.warn(`transferLayerToMap: ${failed} image blob(s) could not be duplicated`);
        }
    }

    if (total > 0) {
        try {
            await addFeatures(featuresByType, targetMapName);
        } catch (error) {
            await rollbackTargetLayer(targetMapName, targetLayers, newLayer, duplicatedImageIds);
            throw error;
        }

        // addFeatures can also refuse in silence (it guards on its own). Reading
        // the destination back is the only way to tell a refusal from a write,
        // and it is what licenses the removal below.
        const landed = await countFeaturesInLayer(targetMapName, newLayer.id);
        if (landed < total) {
            await rollbackTargetLayer(targetMapName, targetLayers, newLayer, duplicatedImageIds);
            emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
                operation: 'transferLayerToMap',
                error: `destination accepted ${landed} of ${total} features; source left untouched`,
                timestamp: Date.now()
            });
            return { success: false, reason: 'target_write_incomplete', mode };
        }
    }

    // ----- Only now may the source be emptied -----

    let sourceLayerRemoved = true;
    if (mode === TransferMode.MOVE) {
        await deleteLayerFeatures(layerId, sourceMapName, { releaseImages: false });

        // deleteLayerOnly carries guards of its own and can decline. The
        // features are already gone by then, so this is not a failed transfer,
        // but an empty layer left in the source is not what we promised either.
        const deletion = deleteLayerOnly(layerId, sourceMapName);
        if (deletion && deletion.success === false) {
            sourceLayerRemoved = false;
            console.warn(
                'transferLayerToMap: features moved but layer ' + layerId +
                ' was not removed from ' + sourceMapName + ' (' + deletion.reason + ')'
            );
        }
    }

    deps.eventBus?.emit(EventTypes.LAYERS_CHANGED, { mapName: targetMapName });

    return {
        success: true,
        mode,
        movedCount: total,
        skippedCount,
        targetLayerId: newLayer.id,
        targetLayerName: newLayer.name,
        sourceLayerRemoved
    };
}

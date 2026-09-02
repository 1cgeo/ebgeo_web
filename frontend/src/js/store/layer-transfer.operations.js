// Path: js/store/layer-transfer.operations.js

/**
 * @fileoverview Moves or copies a whole layer (record + features) to another map of the
 * same atlas.
 *
 * FIVE THINGS HERE ARE NOT OPTIONAL, and each one is a defect this file exists to avoid.
 *
 * 1. THE DESTINATION LAYER LIST COMES FROM THE REPOSITORY, NEVER FROM MEMORY.
 *    `memoryStore.layers` is hydrated one map at a time (`loadLayersToMemory`, called by
 *    `setCurrentMap`), and `LayerManager._resolveMap` FABRICATES a list holding only the
 *    default layer for any map it has not seen. Writing through the memory path would
 *    therefore persist that fabricated list OVER the real layers of a map that was never
 *    visited this session, with no error anywhere. So: read with `getLayersCompat`, write
 *    with `setLayersCompat`, and only afterwards reconcile memory IF that map happens to
 *    be hydrated.
 *
 * 2. `memoryStore.activeLayerId` IS GLOBAL, not per map. `loadLayersToMemory` and
 *    `setActiveLayer` both write it, so touching either for the DESTINATION map would
 *    silently move the active layer of the map the user is looking at. Nothing here
 *    writes that field.
 *
 * 3. DESTINATION FIRST, SOURCE LAST. The features are written to the target and the write
 *    is READ BACK, by a path independent of the one that wrote it, before anything is
 *    removed from the source. The worst case is then a recoverable duplicate, never a
 *    loss.
 *
 * 4. THIS OPERATION IS COMPOSITE AND MUST NOT TAKE THE DOCUMENT LOCK. `addFeatures` and
 *    `deleteLayerFeatures` each take `withMapDocument` on their own, and the queue in
 *    `document-lock.js` is strictly FIFO with NO reentrancy: a section that awaits
 *    another section on the same key waits for itself, forever. Wrapping this function in
 *    `withMapDocument(sourceMapName, ...)` deadlocks on the very first move. It is listed
 *    among the known composites in that file's header.
 *
 * 5. THE DESTINATION LOCK IS READ FROM DISK, NOT FROM `memoryStore.lockedMaps`. That set
 *    is only COMPLETE in a remote atlas, where the snapshot carries every map's lock; in
 *    a LOCAL atlas only the current map is ever put in it, so asking the set about
 *    ANOTHER map answers "unlocked" for a map that is locked. The async
 *    `isMapLocked(name)` reads the app setting and is the only correct question here. The
 *    source-side check stays synchronous (`isCurrentMapLockedSync`), because there the
 *    map in question IS the current one, which is exactly the entry the set holds.
 *
 * Layer ids are NOT unique across maps (`getDefaultLayer()` always returns the id
 * `default`), so the destination record always gets a freshly generated id.
 *
 * WHAT CARRIES THE SOURCE-SIDE REMOVAL TO A PEER IS THE LAYER DELETE, NOT A FEATURE OP.
 * `deleteLayerFeatures` logs nothing, so a move emits only the layer create (destination),
 * the feature creates (destination, same ids) and the layer delete (source). The peer
 * empties its source map by mirroring the server's layer cascade, in
 * `cascadeRemoteLayerDelete` (`store/sync/remote-operation-handler.js`). Emitting a feature
 * DELETE here instead would be the obvious fix and the wrong one: with LWW by arrival order
 * it would erase the very row the create had just moved.
 *
 * WHAT DOES NOT SYNC, declared rather than discovered later: a moved feature leaves the
 * GROUPS of the source map through `removeFeatureFromAllGroups`, which logs no operation.
 * A collaborator therefore keeps seeing the moved feature listed inside the source
 * group until their next full snapshot. Inventing a group op here would be worse: group
 * membership has no incremental op of its own in this build, and a fabricated one would
 * be rejected by the server and freeze the outbound queue.
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
import { isCurrentMapLockedSync, isMapLocked } from './map.operations.js';
import { isRemoteStoreSync } from './store-origin.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { mapResolver } from './services/map-resolver.service.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { logLayerOperation, OperationType, apiClient, syncEngine } from './sync/index.js';
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
 * @param {import('./store.types.js').StoreDependencies} dependencies - Injected services
 * @returns {void}
 */
export function setLayerTransferDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== PRIVATE HELPERS =====

/**
 * Emits a blocked-operation event and shapes the refusal result.
 *
 * `required` is forwarded whenever the guard produced one, because the sentence the user
 * reads is keyed by CAPABILITY (`denialNotice`, `store/denial-phrases.js`) and not by
 * role: a refusal that drops the field silently downgrades to the generic text.
 *
 * @param {string} reason - Machine-readable reason
 * @param {string} mode - Transfer mode
 * @param {Object} [extra] - Extra fields the caller needs in order to phrase it
 * @returns {{ success: false, reason: string, mode: string }} The refusal
 * @private
 */
function refuse(reason, mode, extra = {}) {
    emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
        operation: 'transferLayerToMap',
        reason,
        ...(extra.required ? { required: extra.required } : {})
    });
    return { success: false, reason, mode, ...extra };
}

/**
 * Generates a GeoJSON `id` (MapLibre keys features on it and wants a number).
 *
 * Mirrors `IDUtils.generateGeoJSONId`, which cannot be imported here: `id_utils.js`
 * imports the `@store` barrel and would close a cycle.
 * @returns {number} A fresh numeric id
 * @private
 */
function generateGeoJsonId() {
    return Date.now() + Math.floor(Math.random() * 10000);
}

/**
 * Mirrors the new layer into the destination's in-memory cache, but ONLY if that map is
 * already hydrated. Creating the entry here would be worse than doing nothing: a
 * half-built cache is indistinguishable from a real one, and the next
 * `_persistLayersAsync` for that map would write it over the disk. Never touches
 * `memoryStore.activeLayerId` (see file header, point 2).
 *
 * @param {string} targetMapName - Destination map name
 * @param {Object} newLayer - The record just written to the repository
 * @returns {void}
 * @private
 */
function mirrorLayerIntoHydratedMemory(targetMapName, newLayer) {
    const hydrated = memoryStore.layers?.[targetMapName];
    if (!hydrated || typeof hydrated.set !== 'function') return;
    hydrated.set(newLayer.id, newLayer);
}

/**
 * Counts how many features of a map already carry a given layer id.
 *
 * Read back from the repository, i.e. by a path independent of the write, so a write that
 * was refused in silence cannot be mistaken for a write that landed.
 *
 * @param {string} mapName - Map to read
 * @param {string} layerId - Layer id to count
 * @returns {Promise<number>} How many features carry it
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
 * Duplicates one image blob under a new id. Returns false instead of throwing: a missing
 * thumbnail must not abort a transfer that already succeeded.
 * @param {string} oldId - Blob id to read
 * @param {string} newId - Blob id to write
 * @returns {Promise<boolean>} Whether a blob was actually duplicated
 * @private
 */
async function duplicateImageBlob(oldId, newId) {
    const blob = await getImage(oldId);
    if (!blob) return false;
    await storeImage(newId, blob);
    return true;
}

/**
 * Sends the freshly minted blobs to the server, when the atlas is a server atlas.
 *
 * WHY THIS EXISTS AT ALL: `storeImage` writes to the LOCAL blob store and uploads
 * nothing, and there is no incremental sync op for an image. In a server atlas a copy
 * therefore produced features pointing at ids the server had never heard of, and every
 * other collaborator saw a broken image with no error anywhere. The bulk route is the
 * only path that can claim a chosen id: the server preserves `localId` as the id on the
 * first occurrence (guard: `frontend/tests/e2e/bulk-image-preserve-id.e2e.test.js`).
 *
 * IT RUNS BEFORE `addFeatures`, on purpose: the outbound flush leaves every 1.5 s, so a
 * feature op that reached a peer before its blob would render as a hole.
 *
 * BEST-EFFORT, and the asymmetry is deliberate: a failed upload costs a picture, while
 * aborting would cost the whole transfer. `import_export/atlas-image-upload.js` is
 * reached by a dynamic import so the store's static graph does not grow an edge into the
 * import/export chunk group.
 *
 * @param {Array<{oldId: string, newId: string}>} pairs - Blobs duplicated locally
 * @returns {Promise<void>} Resolves once the upload was attempted
 * @private
 */
async function uploadCopiedBlobsToServer(pairs) {
    if (pairs.length === 0) return;
    if (!isRemoteStoreSync()) return;

    const atlasId = syncEngine?.atlasId;
    if (!atlasId) return;

    try {
        const { buildImageUploads, uploadImagesInChunks } =
            await import('@js/import_export/atlas-image-upload.js');

        const blobs = [];
        for (const { newId } of pairs) {
            const blob = await getImage(newId);
            if (blob) blobs.push([newId, blob]);
        }
        if (blobs.length === 0) return;

        const { uploads } = await buildImageUploads(blobs);
        if (uploads.length === 0) return;

        const { failed } = await uploadImagesInChunks(apiClient, atlasId, uploads);
        if (failed.length > 0) {
            console.warn(`transferLayerToMap: ${failed.length} image blob(s) refused by the server`);
        }
    } catch (error) {
        console.warn('transferLayerToMap: image blobs could not be uploaded:', error);
    }
}

/**
 * Reshapes every transferable feature for the destination layer and collects the
 * image-blob duplications the copy mode needs.
 *
 * @param {Object<string, Object[]>} transferable - Features that may travel
 * @param {Object} context - Reshape context
 * @param {string} context.mode - Transfer mode
 * @param {string} context.layerId - Destination layer id
 * @param {number} context.now - Timestamp to stamp
 * @returns {{ featuresByType: Object<string, Object[]>, total: number,
 *   blobPairs: Array<{oldId: string, newId: string}> }} The reshaped batch
 * @private
 */
function remapFeatures(transferable, { mode, layerId, now }) {
    const isCopy = mode === TransferMode.COPY;
    const featuresByType = {};
    const blobPairs = [];
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

            // Blobs live in a store keyed by the feature id: a move carries the id along
            // and must not touch them; a copy mints a new id and therefore needs its own.
            if (isCopy && oldId && hasImageResource(feature.properties?.source)) {
                blobPairs.push({ oldId, newId });
            }
        }

        featuresByType[storageType] = bucket;
    }

    return { featuresByType, total, blobPairs };
}

/**
 * Undoes the destination-side writes made before the features failed to land.
 *
 * The layer record has to be written BEFORE the features (they need its id), so a feature
 * write that is refused or that throws would otherwise leave an empty layer sitting in a
 * map the user never opened and, in copy mode, duplicated blobs with nothing referencing
 * them. Neither is recoverable by looking at the destination: an empty layer is
 * indistinguishable from one somebody made, and an orphan blob is invisible.
 *
 * IT ONLY REACHES THE LOCAL BLOBS. A blob already accepted by the server stays there; it
 * is referenced by nothing and costs storage, which is the cheaper half of the trade
 * against a transfer that aborts mid-way.
 *
 * Best-effort by construction: this runs while something else is already failing, so
 * every step is isolated and only warns. It must never mask the original failure.
 *
 * @param {string} targetMapName - Destination map name
 * @param {Array<Object>} previousLayers - Destination layer list before the write
 * @param {Object} newLayer - The record to take back out
 * @param {string[]} duplicatedImageIds - Blob ids minted by a copy
 * @returns {Promise<void>} Resolves once every step was attempted
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
 * Moves or copies a layer of the current map (record + features) into another map of the
 * same atlas.
 *
 * Analysis output never travels, parents and rendered children alike. The mechanism that
 * catches the children is worth naming, because the intuitive one is wrong:
 * `getAllStorageTypes()` DOES list their buckets, so they are swept like anything else. What
 * holds them back is that each child is minted by spreading its parent's properties
 * (`generateProcessedFeatures`), so it inherits the parent's `source` and
 * `isUncopyableFeatureType` answers true for it too.
 *
 * THE TWO MODES ANSWER THAT DIFFERENTLY, and the asymmetry is the whole point: `copy` skips
 * them, reports them in `skippedCount` and leaves the originals where they are; `move` REFUSES
 * outright (`analysis_features_present`, carrying `skippedCount`), because the removal step
 * sweeps EVERY bucket by layer id and would destroy in the source exactly the features the
 * partition had just spared, orphaning their rendered children along the way.
 *
 * `skippedCount` COUNTS PARENTS, not everything held back: one line of sight is one parent plus
 * two rendered halves, and a sentence saying "3" would send the person hunting for two objects
 * they never drew. The refusal still gates on the FULL partition.
 *
 * LOCKS ARE NOT SYMMETRIC BETWEEN THE MODES, because the modes do not write to the same
 * places. A locked DESTINATION map refuses both. A locked source map, or a locked source
 * layer, refuses only `move`, the only mode that takes anything out of the source; `copy`
 * reads the source and leaves it untouched.
 *
 * @param {string} layerId - Layer to transfer (must belong to the current map)
 * @param {string} targetMapName - Destination map name
 * @param {Object} options - Transfer options
 * @param {string} options.mode - TransferMode.MOVE or TransferMode.COPY
 * @returns {Promise<{ success: boolean, mode: string, reason?: string, required?: string,
 *   movedCount?: number, skippedCount?: number, targetLayerId?: string,
 *   targetLayerName?: string, sourceLayerRemoved?: boolean }>} The outcome.
 *   On a successful move, `sourceLayerRemoved` is false when the features left the source
 *   but the layer RECORD could not be deleted (`deleteLayerOnly` carries guards of its
 *   own). The transfer still succeeded; what stays behind is an empty layer, and the
 *   caller may say so.
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
    if (!createPerm.allowed) {
        return refuse('permission_denied', mode, { required: createPerm.required });
    }

    if (mode === TransferMode.MOVE) {
        const deletePerm = checkPermission(GuardAction.DELETE_FEATURE);
        if (!deletePerm.allowed) {
            return refuse('permission_denied', mode, { required: deletePerm.required });
        }
    }

    if (targetMapName === sourceMapName) return refuse('same_map', mode);

    // The DESTINATION lock refuses both modes: either one writes there. Read from disk,
    // never from `memoryStore.lockedMaps` (see file header, point 5).
    if (await isMapLocked(targetMapName)) return refuse('target_map_locked', mode);

    // The SOURCE locks (map and layer) refuse only the move, which is the only mode that
    // writes back to the source. A copy reads the source and leaves it byte for byte as
    // it was, so refusing it would deny a harmless action and make the lock read as a
    // general ban on the layer.
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
    const { transferable, skipped, skippedParents } = partitionTransferableFeatures(
        featuresByStorageType,
        isUncopyableFeatureType
    );
    // The gate below reads the FULL partition; the count is what the sentence quotes. The `||`
    // covers the one shape where the parent count would lie: a layer holding an orphan child
    // whose parent lives elsewhere counts zero parents, and zero is the single number that is
    // certainly wrong when something was in fact held back.
    const skippedCount = skippedParents || skipped.length;

    // A move deletes EVERY feature carrying this layer id from the source, analysis
    // buckets included, so the features the partition just spared would be destroyed
    // there and their processed children orphaned. Refuse before writing anything; the
    // user can copy, or delete those first.
    if (mode === TransferMode.MOVE && skipped.length > 0) {
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
        // The op carries the destination map ID, not its NAME: `logLayerOperation` files
        // the op under whatever it is handed, and a name would be pushed as a map id the
        // server does not know, failing the whole flush batch.
        tx.deferAsync(() => logLayerOperation(
            OperationType.CREATE,
            newLayer.id,
            mapResolver.resolveToId(targetMapName),
            newLayer
        ));
        return () => setLayersCompat(targetMapName, nextLayers);
    });

    // ----- Write the features into the destination -----

    const { featuresByType, total, blobPairs } = remapFeatures(transferable, {
        mode,
        layerId: newLayer.id,
        now
    });

    const duplicatedImageIds = [];
    if (blobPairs.length > 0) {
        const results = await Promise.allSettled(
            blobPairs.map(({ oldId, newId }) => duplicateImageBlob(oldId, newId))
        );
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value === true) {
                duplicatedImageIds.push(blobPairs[index].newId);
            }
        });
        const failed = blobPairs.length - duplicatedImageIds.length;
        if (failed > 0) {
            console.warn(`transferLayerToMap: ${failed} image blob(s) could not be duplicated`);
        }
        await uploadCopiedBlobsToServer(
            blobPairs.filter(pair => duplicatedImageIds.includes(pair.newId))
        );
    }

    if (total > 0) {
        try {
            await addFeatures(featuresByType, targetMapName);
        } catch (error) {
            await rollbackTargetLayer(targetMapName, targetLayers, newLayer, duplicatedImageIds);
            throw error;
        }

        // `addFeatures` can also refuse in silence (it guards on its own). Reading the
        // destination back is the only way to tell a refusal from a write, and it is what
        // licenses the removal below.
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
        // `releaseImages: false` because the moved features KEEP their ids: the blob store
        // is keyed by feature id, so releasing here would leave the just-moved features
        // pointing at nothing.
        await deleteLayerFeatures(layerId, sourceMapName, { releaseImages: false });

        // `deleteLayerOnly` carries guards of its own and can decline. The features are
        // already gone by then, so this is not a failed transfer, but an empty layer left
        // in the source is not what we promised either.
        //
        // IT CAN ALSO THROW, and that is why the call is wrapped. It delegates to
        // `layerManager.deleteLayer`, which throws when the layer is no longer in
        // `memoryStore.layers[map]`, and a peer deleting the same layer mid-transfer does
        // exactly that: `applyRemoteLayerOp` rewrites the cache between the `getLayerById`
        // above and this line. Letting it escape would be the worst outcome of the whole
        // operation, because it lands AFTER the source was emptied and the destination
        // accepted everything: the caller's `catch` shows an error toast and skips the
        // deselect, the MapLibre source sync and the reload, so the map keeps drawing
        // features the store no longer has. A refused deletion and a failed one leave the
        // same thing behind (an empty layer), so they get the same answer.
        let deletion = null;
        try {
            deletion = deleteLayerOnly(layerId, sourceMapName);
        } catch (error) {
            deletion = { success: false, reason: error?.message || 'threw' };
        }
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

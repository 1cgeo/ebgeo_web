// Path: js/store/catalog.operations.js

/**
 * @fileoverview Store operations for catalog layers.
 * Manages persistence of catalog layers added to the map.
 *
 * A stored catalog layer is a REFERENCE plus the per-atlas state of that reference; the
 * definition (name, `config`, and the source URL inside it) belongs to the catalog and is
 * resolved on read by `@catalog/catalog-layer.ref.js`. Every write here goes through
 * `pruneCatalogLayerDefinition`, so no definition is persisted and none travels in a sync op.
 *
 * "EVERY WRITE" IS LITERAL, and it was not always: `revalidateCatalogLayers` mutated the entry in
 * place and `processCatalogLayersOnImport` returned it with `config` intact. Neither of them
 * leaked (they emit no op), but the invariant written at the top of a file is what the next
 * author trusts in order NOT to prune, and the import path fed straight into `addMap`, which logs
 * the WHOLE map document as one op — so an `.ebgeo` from before the change replanted the
 * definition in the server's operation log. Both prune now; the sentence above is the contract.
 */

import { generateUUID } from '../utilities/uuid.js';
import {
    CATALOG_LAYER_DEFINITION_KEYS,
    pruneCatalogLayerDefinition,
    resolveCatalogLayerDefinition
} from '../catalog/catalog-layer.ref.js';
import { getMapDataCompat, updateMapDataCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { logCatalogLayerOperation, OperationType } from './sync/index.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import { withMapDocument } from './document-lock.js';

/**
 * Catalog layer status.
 * @typedef {'active' | 'unavailable'} CatalogLayerStatus
 */

/**
 * @typedef {Object} CatalogLayerState
 * @property {string} id - Layer ID: the catalog row id PREFIXED by type (`analysis-`, `data-`),
 *   or the bare `'hillshade'`. This is the reference; the definition is never stored.
 * @property {string} type - Type (hillshade | analysis_layer | data_layer)
 * @property {boolean} visible - Current visibility
 * @property {number} [opacity] - Opacity (0-1)
 * @property {CatalogLayerStatus} [status='active'] - Availability status
 * @property {string} [originalId] - LEGACY reference carrier, for entries whose id has no prefix.
 *   Read, never minted, except when pruning would otherwise destroy the only reference.
 * @property {string} [name] - LEGACY copy of the catalog name. Read only as a display fallback
 *   (see `catalogLayerDisplayName`); never written.
 * @property {Object} [config] - LEGACY copy of the catalog row. Only `config.id` is ever read,
 *   and only as a reference; never written.
 * @property {Object} [styleOverrides] - User-customized paint/layout values,
 *   nested by sub-layer. Vector: { fill:{prop:val}, border:{...}, label:{...} };
 *   raster: { raster:{prop:val} }. Each value may be a scalar or a data-driven
 *   MapLibre expression. Legacy flat overrides (keyed directly by property) are
 *   ignored by the managers.
 */

// ===== HELPERS =====

/**
 * Resolves the target map name, defaulting to the current map.
 *
 * @param {string|null} mapName - Explicit map name or null for current
 * @returns {string} Resolved map name
 */
function resolveMapName(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/**
 * Permission + map-lock gate for a catalog-layer write.
 *
 * A catalog-layer op the server refuses (403 for a Visualizador/Comentarista) aborts the
 * WHOLE push batch, and 403 is deliberately not a permanent rejection, so the batch is
 * re-sent every 1.5 s forever: never enqueue an op the user has no right to write.
 * The gate is hierarchical by construction (GuardAction → PermissionAction →
 * sessionContext.canPerformAction), so a co-Gestor passes without any closed role list.
 *
 * @param {string} operation - Operation label carried in the error payload
 * @param {string} action - Key from GuardAction
 * @returns {boolean} True when the write may proceed
 */
function guardCatalogWrite(operation, action) {
    const perm = checkPermission(action);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation, reason: perm.reason, required: perm.required });
        return false;
    }
    if (isCurrentMapLockedSync()) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation, reason: 'map_locked' });
        return false;
    }
    return true;
}

// ===== CATALOG LAYERS =====

/**
 * Gets catalog layers from current map.
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<CatalogLayerState[]>} Catalog layers
 */
export async function getCatalogLayers(mapName = null) {
    const mapData = await getMapDataCompat(resolveMapName(mapName));
    return mapData.catalogLayers || [];
}

/**
 * Adds a catalog layer.
 *
 * @param {CatalogLayerState} layer - Layer to add
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function addCatalogLayer(layer, mapName = null) {
    if (!guardCatalogWrite('addCatalogLayer', GuardAction.CREATE_LAYER)) return;

    const targetMap = resolveMapName(mapName);
    // Catalog layers live INSIDE the map document, so this read-modify-write competes with
    // every feature write on the same map. Same lock key (see document-lock.js).
    return withMapDocument(targetMap, 'addCatalogLayer', async () => {
        const mapData = await getMapDataCompat(targetMap);

        if (!mapData.catalogLayers) {
            mapData.catalogLayers = [];
        }

        const exists = mapData.catalogLayers.some(l => l.id === layer.id);
        if (exists) return;

        // The DEFINITION is dropped here, at the only door into the document: whatever the caller
        // assembled, what is persisted (and what the op carries) is reference + per-atlas state.
        const layerWithMetadata = pruneCatalogLayerDefinition({
            ...layer,
            id: layer.id || generateUUID(),
            sync: createSyncMetadata(null)
        });

        mapData.catalogLayers.push(layerWithMetadata);
        await updateMapDataCompat(targetMap, mapData);

        const mapId = mapManager.getCurrentMapId();
        logCatalogLayerOperation(OperationType.CREATE, layerWithMetadata.id, mapId, layerWithMetadata);
    });
}

/**
 * Removes a catalog layer.
 *
 * @param {string} layerId - Layer ID to remove
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function removeCatalogLayer(layerId, mapName = null) {
    if (!guardCatalogWrite('removeCatalogLayer', GuardAction.DELETE_LAYER)) return;

    const targetMap = resolveMapName(mapName);
    return withMapDocument(targetMap, 'removeCatalogLayer', async () => {
        const mapData = await getMapDataCompat(targetMap);

        if (!mapData.catalogLayers) return;

        const removedLayer = mapData.catalogLayers.find(l => l.id === layerId);
        mapData.catalogLayers = mapData.catalogLayers.filter(l => l.id !== layerId);
        await updateMapDataCompat(targetMap, mapData);

        if (removedLayer) {
            const mapId = mapManager.getCurrentMapId();
            // `previousData` also leaves the document, so it is pruned too: a legacy entry must
            // not re-publish the definition on its way out.
            logCatalogLayerOperation(
                OperationType.DELETE, layerId, mapId, null,
                pruneCatalogLayerDefinition(removedLayer)
            );
        }
    });
}

/**
 * Updates a catalog layer.
 *
 * @param {string} layerId - Layer ID to update
 * @param {Partial<CatalogLayerState>} updates - Updates to apply
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function updateCatalogLayer(layerId, updates, mapName = null) {
    if (!guardCatalogWrite('updateCatalogLayer', GuardAction.UPDATE_LAYER)) return;

    const targetMap = resolveMapName(mapName);
    // Locked leaf: `toggleCatalogLayerVisibility` and `updateCatalogLayerStatus` await this
    // one, so neither of them may take the lock (document-lock.js has no reentrancy).
    return withMapDocument(targetMap, 'updateCatalogLayer', async () => {
        const mapData = await getMapDataCompat(targetMap);

        if (!mapData.catalogLayers) return;

        const index = mapData.catalogLayers.findIndex(l => l.id === layerId);
        if (index === -1) return;

        const oldLayer = pruneCatalogLayerDefinition({ ...mapData.catalogLayers[index] });
        // Rewrite rather than mutate in place: the entry is REPLACED by its pruned form, which is
        // what makes a legacy entry converge on the new shape the first time it is touched,
        // without a sweep over documents nobody is reading.
        const updated = pruneCatalogLayerDefinition({ ...mapData.catalogLayers[index], ...updates });

        if (updated.sync) {
            updated.sync = touchSyncMetadata(updated.sync);
        }

        mapData.catalogLayers[index] = updated;
        await updateMapDataCompat(targetMap, mapData);

        const mapId = mapManager.getCurrentMapId();
        logCatalogLayerOperation(OperationType.UPDATE, layerId, mapId, updated, oldLayer);
    });
}

/**
 * Toggles catalog layer visibility.
 *
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - New visibility state
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function toggleCatalogLayerVisibility(layerId, visible, mapName = null) {
    await updateCatalogLayer(layerId, { visible }, mapName);
}

/**
 * Gets a specific catalog layer by ID.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<CatalogLayerState|null>} Layer or null
 */
export async function getCatalogLayerById(layerId, mapName = null) {
    const layers = await getCatalogLayers(mapName);
    return layers.find(l => l.id === layerId) || null;
}

/**
 * Checks if a catalog layer exists.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} True if exists
 */
export async function hasCatalogLayer(layerId, mapName = null) {
    const layer = await getCatalogLayerById(layerId, mapName);
    return layer !== null;
}

// ===== AVAILABILITY VALIDATION =====

/**
 * Validates if a catalog layer is available to THIS client.
 *
 * Availability is now exactly "the definition resolves", which folds four causes into one answer:
 * the resource left the catalog, the section is disabled for this atlas, the resource is private
 * and this user holds no grant, or the loan that reached it was made to another atlas. The UI
 * needs to distinguish none of them; it needs to render "indisponível" and offer a retry.
 *
 * @param {CatalogLayerState} layer - Layer to validate
 * @returns {CatalogLayerStatus} 'active' if available, 'unavailable' otherwise
 */
export function validateCatalogLayerAvailability(layer) {
    return resolveCatalogLayerDefinition(layer) ? 'active' : 'unavailable';
}

/**
 * Processes catalog layers during import, validating availability.
 *
 * @param {CatalogLayerState[]} layers - Layers from the imported file
 * @returns {{ processed: CatalogLayerState[], unavailableCount: number }}
 */
export function processCatalogLayersOnImport(layers) {
    if (!layers || !Array.isArray(layers)) {
        return { processed: [], unavailableCount: 0 };
    }

    let unavailableCount = 0;

    // The order matters: availability is resolved from the entry AS IMPORTED (a legacy `.ebgeo`
    // may carry its only reference in `config.id`), and only then is the definition pruned —
    // which preserves that reference in `originalId`, so the layer stays resolvable afterwards.
    const processed = layers.map(layer => {
        const status = validateCatalogLayerAvailability(layer);
        if (status === 'unavailable') unavailableCount++;
        return pruneCatalogLayerDefinition({ ...layer, status });
    });

    return { processed, unavailableCount };
}

/**
 * Updates the status of a catalog layer.
 *
 * @param {string} layerId - Layer ID
 * @param {CatalogLayerStatus} status - New status
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function updateCatalogLayerStatus(layerId, status, mapName = null) {
    await updateCatalogLayer(layerId, { status }, mapName);
}

/**
 * Re-validates all catalog layers and updates their status.
 * Performs a single read-modify-write cycle instead of per-layer persistence.
 *
 * Returns the revalidated layers so callers do NOT need a second
 * `getCatalogLayers()` call. Each such call reads the whole map document from
 * IndexedDB (every drawn feature) just to reach a list of 2 or 3 catalog
 * layers, and the feature panel refresh used to pay that price twice.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<{ layers: Array, reactivated: string[], stillUnavailable: string[] }>}
 */
export async function revalidateCatalogLayers(mapName = null) {
    const targetMap = resolveMapName(mapName);
    return withMapDocument(targetMap, 'revalidateCatalogLayers', async () => {
        const mapData = await getMapDataCompat(targetMap);
        const catalogLayers = mapData.catalogLayers || [];

        const reactivated = [];
        const stillUnavailable = [];
        let hasChanges = false;

        // REWRITE, never mutate in place: like `updateCatalogLayer`, the entry is replaced by its
        // pruned form, which is what makes a legacy document converge on the new shape the first
        // time anything touches it. `hasChanges` therefore also has to fire when only the prune
        // changed something, otherwise the old shape is recomputed on every revalidation and
        // never persisted.
        catalogLayers.forEach((layer, i) => {
            const oldStatus = layer.status;
            const newStatus = validateCatalogLayerAvailability(layer);

            const updated = pruneCatalogLayerDefinition({ ...layer, status: newStatus });
            if (oldStatus !== newStatus && updated.sync) {
                updated.sync = touchSyncMetadata(updated.sync);
            }
            // The prune changed something when a definition key was there to take, or when the
            // reference had to be rescued into `originalId`. Comparing key COUNTS would miss the
            // case that removes one key and adds one back.
            const pruned = CATALOG_LAYER_DEFINITION_KEYS.some(key => key in layer)
                || updated.originalId !== layer.originalId;
            if (oldStatus !== newStatus || pruned) {
                hasChanges = true;
            }
            catalogLayers[i] = updated;

            if (newStatus === 'unavailable') {
                stillUnavailable.push(layer.id);
            } else if (oldStatus === 'unavailable' && newStatus === 'active') {
                reactivated.push(layer.id);
            }
        });

        if (hasChanges) {
            await updateMapDataCompat(targetMap, mapData);
        }

        return { layers: catalogLayers, reactivated, stillUnavailable };
    });
}

// Path: js/store/layer.operations.js

/**
 * @fileoverview Layer CRUD operations.
 * Delegates to LayerManager for actual implementation.
 */

import { setLayersCompat, setActiveLayerIdCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import { EventTypes } from '../events';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';

// ===== DEPENDENCY INJECTION =====

/** @type {import('./store.types.js').StoreDependencies} */
const deps = { eventBus: null, groupManager: null, layerManager: null };

/**
 * Sets dependencies for layer operations.
 *
 * @param {import('./store.types.js').StoreDependencies} dependencies
 */
export function setLayerDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== READ OPERATIONS =====

/**
 * Gets layers for a map (sorted by order).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {import('./store.types.js').Layer[]} Array of layers
 */
export function getLayers(mapName = null) {
    return deps.layerManager.getLayers(mapName);
}

/**
 * Gets a layer by ID.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer|null} Layer or null
 */
export function getLayerById(layerId, mapName = null) {
    return deps.layerManager.getLayerById(layerId, mapName);
}

/**
 * Gets the active layer ID synchronously.
 *
 * @returns {string} Active layer ID
 */
export function getActiveLayerIdSync() {
    return deps.layerManager.getActiveLayerIdSync();
}

/**
 * Gets visible layer IDs.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {string[]} Array of visible layer IDs
 */
export function getVisibleLayerIds(mapName = null) {
    return deps.layerManager.getVisibleLayerIds(mapName);
}

// ===== CREATE OPERATIONS =====

/**
 * Creates a new layer.
 *
 * ASYNC since 2026-09-13: the manager journals the intention before writing (bloco B4).
 *
 * @param {string} [name='Nova Camada'] - Layer name
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<import('./store.types.js').Layer|null>} Created layer or null if blocked
 */
export async function createLayer(name = 'Nova Camada', mapName = null) {
    const perm = checkPermission(GuardAction.CREATE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'createLayer', reason: perm.reason, required: perm.required });
        return null;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot create layer.');
        return null;
    }
    return deps.layerManager.createLayer(name, mapName);
}

/**
 * Creates a new layer for import (no event emission).
 *
 * ASYNC since 2026-09-13, like {@link createLayer}. Every caller has to await it: a floating
 * promise here returns a layer id the import then stamps on features that reach disk first.
 *
 * @param {string} [name='Importação'] - Layer name
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<import('./store.types.js').Layer>} Created layer
 */
export async function createLayerForImport(name = 'Importação', mapName = null) {
    return deps.layerManager.createLayerForImport(name, mapName);
}

// ===== UPDATE OPERATIONS =====

/**
 * Sets the active layer.
 *
 * @param {string} layerId - Layer ID to set as active
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Activated layer
 */
export function setActiveLayer(layerId, mapName = null) {
    return deps.layerManager.setActiveLayer(layerId, mapName);
}

/**
 * Renames a layer.
 *
 * @param {string} layerId - Layer ID
 * @param {string} newName - New layer name
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<import('./store.types.js').Layer|null>} Renamed layer or null if blocked
 */
export async function renameLayer(layerId, newName, mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'renameLayer', reason: perm.reason, required: perm.required });
        return null;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot rename layer.');
        return null;
    }
    return deps.layerManager.renameLayer(layerId, newName, mapName);
}

/**
 * Sets layer visibility.
 *
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - Visibility state
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<import('./store.types.js').Layer>} Updated layer
 */
export async function setLayerVisibility(layerId, visible, mapName = null) {
    return deps.layerManager.setLayerVisibility(layerId, visible, mapName);
}

/**
 * Sets layer lock state.
 *
 * @param {string} layerId - Layer ID
 * @param {boolean} locked - Lock state
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<import('./store.types.js').Layer>} Updated layer
 */
export async function setLayerLocked(layerId, locked, mapName = null) {
    return deps.layerManager.setLayerLocked(layerId, locked, mapName);
}

/**
 * Sets layer opacity (0..1).
 *
 * @param {string} layerId - Layer ID
 * @param {number} opacity - Opacity multiplier
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<import('./store.types.js').Layer|null>} Updated layer or null if blocked
 */
export async function setLayerOpacity(layerId, opacity, mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'setLayerOpacity', reason: perm.reason, required: perm.required });
        return null;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot change layer opacity.');
        return null;
    }
    return deps.layerManager.setLayerOpacity(layerId, opacity, mapName);
}

/**
 * Reorders layers.
 *
 * @param {string[]} orderedLayerIds - Array of layer IDs in new order
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function reorderLayers(orderedLayerIds, mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'reorderLayers', reason: perm.reason, required: perm.required });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot reorder layers.');
        return;
    }
    return deps.layerManager.reorderLayers(orderedLayerIds, mapName);
}

// ===== DELETE OPERATIONS =====

/**
 * Deletes a layer (without its features).
 * Feature deletion should be handled separately.
 *
 * ASYNC since 2026-09-13 (write-ahead, bloco B4): the manager journals the `layer` DELETE, plus the
 * CREATE of the replacement default layer in a LOCAL atlas, before it writes the document. The two
 * refusals below stay SYNCHRONOUS values, and a caller that reads `deletion.success` has to await
 * first: an unawaited promise is truthy and `.success` on it is `undefined`, which reads as neither
 * refusal nor success.
 *
 * @param {string} layerId - Layer ID to delete
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<Object>|Object} Deletion result
 */
export function deleteLayerOnly(layerId, mapName = null) {
    const perm = checkPermission(GuardAction.DELETE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'deleteLayerOnly', reason: perm.reason, required: perm.required });
        return { success: false, reason: 'PERMISSION_DENIED' };
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot delete layer.');
        return { success: false, reason: 'MAP_LOCKED' };
    }
    return deps.layerManager.deleteLayer(layerId, mapName);
}

// ===== MEMORY OPERATIONS =====

/**
 * Loads layers to memory.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export async function loadLayersToMemory(mapName) {
    return deps.layerManager.loadLayersToMemory(mapName);
}

/**
 * Descarrega a escrita de camada represada pelo debounce, de TODO mapa.
 *
 * Quem le camada do REPOSITORIO precisa chamar isto antes, senao le o estado de ate 300 ms
 * atras. O unico chamador hoje e `buildExportDataObject`; ver o cabecalho de
 * `layerManager.flushPendingWrites`.
 * @returns {Promise<void>}
 */
export async function flushPendingLayerWrites() {
    return deps.layerManager.flushPendingWrites();
}

// ===== IMPORT OPERATIONS =====

/**
 * Sets map layers (for import).
 *
 * @param {string} mapName - Map name
 * @param {Object} layersData - Layers data with layers and activeLayerId
 * @returns {Promise<void>}
 */
export async function setMapLayers(mapName, layersData) {
    if (layersData.layers) {
        await setLayersCompat(mapName, layersData.layers);
    }
    if (layersData.activeLayerId) {
        await setActiveLayerIdCompat(mapName, layersData.activeLayerId);
    }

    // Reload to memory if current map
    if (mapName === mapManager.getCurrentMapName()) {
        await deps.layerManager.loadLayersToMemory(mapName);
        deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName });
    }
}

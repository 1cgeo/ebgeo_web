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
 * Gets the active layer ID (async, for compatibility).
 *
 * @param {string} [_mapName=null] - Map name (unused, kept for API compatibility)
 * @returns {Promise<string>} Active layer ID
 */
export async function getActiveLayerId(_mapName = null) {
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
 * @param {string} [name='Nova Camada'] - Layer name
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer|null} Created layer or null if blocked
 */
export function createLayer(name = 'Nova Camada', mapName = null) {
    const perm = checkPermission(GuardAction.CREATE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'createLayer', reason: perm.reason });
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
 * @param {string} [name='Importação'] - Layer name
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Created layer
 */
export function createLayerForImport(name = 'Importação', mapName = null) {
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
 * Sets the active layer ID (for compatibility).
 *
 * @param {string} mapName - Map name
 * @param {string} layerId - Layer ID
 * @returns {Promise<import('./store.types.js').Layer>}
 */
export async function setActiveLayerId(mapName, layerId) {
    return deps.layerManager.setActiveLayer(layerId, mapName);
}

/**
 * Renames a layer.
 *
 * @param {string} layerId - Layer ID
 * @param {string} newName - New layer name
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer|null} Renamed layer or null if blocked
 */
export function renameLayer(layerId, newName, mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'renameLayer', reason: perm.reason });
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
 * @returns {import('./store.types.js').Layer} Updated layer
 */
export function setLayerVisibility(layerId, visible, mapName = null) {
    return deps.layerManager.setLayerVisibility(layerId, visible, mapName);
}

/**
 * Sets layer lock state.
 *
 * @param {string} layerId - Layer ID
 * @param {boolean} locked - Lock state
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Updated layer
 */
export function setLayerLocked(layerId, locked, mapName = null) {
    return deps.layerManager.setLayerLocked(layerId, locked, mapName);
}

/**
 * Reorders layers.
 *
 * @param {string[]} orderedLayerIds - Array of layer IDs in new order
 * @param {string} [mapName=null] - Map name
 */
export function reorderLayers(orderedLayerIds, mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'reorderLayers', reason: perm.reason });
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
 * @param {string} layerId - Layer ID to delete
 * @param {string} [mapName=null] - Map name
 * @returns {Object} Deletion result
 */
export function deleteLayerOnly(layerId, mapName = null) {
    const perm = checkPermission(GuardAction.DELETE_LAYER);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'deleteLayerOnly', reason: perm.reason });
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
 * Clears layers cache.
 */
export function clearLayersCache() {
    deps.layerManager.clearLayersCache();
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

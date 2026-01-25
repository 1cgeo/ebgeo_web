// Path: js/store/layer.operations.js

/**
 * @fileoverview Layer CRUD operations.
 * Delegates to LayerManager for actual implementation.
 */

import {
    setLayers as setLayersRepo,
    setActiveLayerId as setActiveLayerIdRepo
} from './repository.js';
import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';

// ===== DEPENDENCY INJECTION =====

/**
 * Module-level dependencies
 * @type {import('./store.types.js').StoreDependencies}
 */
const deps = {
    eventBus: null,
    groupManager: null,
    layerManager: null
};

/**
 * Sets dependencies for layer operations.
 *
 * @param {import('./store.types.js').StoreDependencies} dependencies - Dependencies object
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
export const getLayers = (mapName = null) => {
    return deps.layerManager.getLayers(mapName);
};

/**
 * Gets a layer by ID.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer|null} Layer or null
 */
export const getLayerById = (layerId, mapName = null) => {
    return deps.layerManager.getLayerById(layerId, mapName);
};

/**
 * Gets the active layer ID synchronously.
 *
 * @returns {string} Active layer ID
 */
export const getActiveLayerIdSync = () => {
    return deps.layerManager.getActiveLayerIdSync();
};

/**
 * Gets the active layer ID (async - for compatibility).
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<string>} Active layer ID
 */
export const getActiveLayerId = async (_mapName = null) => {
    return deps.layerManager.getActiveLayerIdSync();
};

/**
 * Gets visible layer IDs.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {string[]} Array of visible layer IDs
 */
export const getVisibleLayerIds = (mapName = null) => {
    return deps.layerManager.getVisibleLayerIds(mapName);
};

// ===== CREATE OPERATIONS =====

/**
 * Creates a new layer.
 *
 * @param {string} [name='Nova Camada'] - Layer name
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Created layer
 */
export const createLayer = (name = 'Nova Camada', mapName = null) => {
    return deps.layerManager.createLayer(name, mapName);
};

/**
 * Creates a new layer for import (no event emission).
 *
 * @param {string} [name='Importação'] - Layer name
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Created layer
 */
export const createLayerForImport = (name = 'Importação', mapName = null) => {
    return deps.layerManager.createLayerForImport(name, mapName);
};

// ===== UPDATE OPERATIONS =====

/**
 * Sets the active layer.
 *
 * @param {string} layerId - Layer ID to set as active
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Activated layer
 */
export const setActiveLayer = (layerId, mapName = null) => {
    return deps.layerManager.setActiveLayer(layerId, mapName);
};

/**
 * Sets the active layer ID (for compatibility).
 *
 * @param {string} mapName - Map name
 * @param {string} layerId - Layer ID
 * @returns {Promise<import('./store.types.js').Layer>}
 */
export const setActiveLayerId = async (mapName, layerId) => {
    return deps.layerManager.setActiveLayer(layerId, mapName);
};

/**
 * Renames a layer.
 *
 * @param {string} layerId - Layer ID
 * @param {string} newName - New layer name
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Renamed layer
 */
export const renameLayer = (layerId, newName, mapName = null) => {
    return deps.layerManager.renameLayer(layerId, newName, mapName);
};

/**
 * Sets layer visibility.
 *
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - Visibility state
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Updated layer
 */
export const setLayerVisibility = (layerId, visible, mapName = null) => {
    return deps.layerManager.setLayerVisibility(layerId, visible, mapName);
};

/**
 * Sets layer lock state.
 *
 * @param {string} layerId - Layer ID
 * @param {boolean} locked - Lock state
 * @param {string} [mapName=null] - Map name
 * @returns {import('./store.types.js').Layer} Updated layer
 */
export const setLayerLocked = (layerId, locked, mapName = null) => {
    return deps.layerManager.setLayerLocked(layerId, locked, mapName);
};

/**
 * Reorders layers.
 *
 * @param {string[]} orderedLayerIds - Array of layer IDs in new order
 * @param {string} [mapName=null] - Map name
 */
export const reorderLayers = (orderedLayerIds, mapName = null) => {
    return deps.layerManager.reorderLayers(orderedLayerIds, mapName);
};

// ===== DELETE OPERATIONS =====

/**
 * Deletes a layer.
 * Note: This only deletes the layer, not its features.
 * Feature deletion should be handled separately.
 *
 * @param {string} layerId - Layer ID to delete
 * @param {string} [mapName=null] - Map name
 * @returns {Object} Deletion result
 */
export const deleteLayerOnly = (layerId, mapName = null) => {
    return deps.layerManager.deleteLayer(layerId, mapName);
};

// ===== MEMORY OPERATIONS =====

/**
 * Loads layers to memory.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export const loadLayersToMemory = async (mapName) => {
    return deps.layerManager.loadLayersToMemory(mapName);
};

/**
 * Clears layers cache.
 */
export const clearLayersCache = () => {
    deps.layerManager.clearLayersCache();
};

// ===== IMPORT OPERATIONS =====

/**
 * Sets map layers (for import).
 *
 * @param {string} mapName - Map name
 * @param {Object} layersData - Layers data with layers and activeLayerId
 * @returns {Promise<void>}
 */
export const setMapLayers = async (mapName, layersData) => {
    if (layersData.layers) {
        await setLayersRepo(mapName, layersData.layers);
    }
    if (layersData.activeLayerId) {
        await setActiveLayerIdRepo(mapName, layersData.activeLayerId);
    }

    // Reload to memory if current map
    if (mapName === mapManager.getCurrentMapName()) {
        await deps.layerManager.loadLayersToMemory(mapName);
        deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName });
    }
};

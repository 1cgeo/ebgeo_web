// Path: js/store/catalog.operations.js

/**
 * @fileoverview Store operations for catalog layers.
 * Manages persistence of catalog layers added to the map.
 */

import { getMapDataCompat, updateMapDataCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import config from '../config.js';
import { generateUUID } from '../utilities/uuid.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';
import { logCatalogLayerOperation, OperationType } from './sync/index.js';

// Alias for backward compatibility during migration
const getMapData = getMapDataCompat;
const updateMapData = updateMapDataCompat;

/**
 * Catalog layer status.
 * @typedef {'active' | 'unavailable'} CatalogLayerStatus
 */

/**
 * @typedef {Object} CatalogLayerState
 * @property {string} id - Layer ID
 * @property {string} type - Type (hillshade | analysis_layer)
 * @property {string} name - Display name
 * @property {boolean} visible - Current visibility
 * @property {number} opacity - Opacity (0-1)
 * @property {CatalogLayerStatus} [status='active'] - Availability status
 * @property {string} [originalId] - Original ID in config (for analysis layers)
 * @property {Object} config - Original configuration
 */

/** Item types matching catalog.constants.js */
const ITEM_TYPES = {
    HILLSHADE: 'hillshade',
    ANALYSIS_LAYER: 'analysis_layer',
    DATA_LAYER: 'data_layer',
    MODEL_3D: 'model_3d'
};

// ===== CATALOG LAYERS =====

/**
 * Gets catalog layers from current map.
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<CatalogLayerState[]>} Catalog layers
 */
export const getCatalogLayers = async (mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);
    return mapData.catalogLayers || [];
};

/**
 * Adds a catalog layer.
 *
 * @param {CatalogLayerState} layer - Layer to add
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const addCatalogLayer = async (layer, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);

    if (!mapData.catalogLayers) {
        mapData.catalogLayers = [];
    }

    // Avoid duplicates
    const exists = mapData.catalogLayers.some(l => l.id === layer.id);
    if (!exists) {
        // Add UUID and sync metadata if not present
        const layerWithMetadata = {
            ...layer,
            id: layer.id || generateUUID(),
            sync: createSyncMetadata(null)
        };

        mapData.catalogLayers.push(layerWithMetadata);
        await updateMapData(targetMap, mapData);

        // Log operation for sync
        const mapId = mapManager.getCurrentMapId();
        logCatalogLayerOperation(OperationType.CREATE, layerWithMetadata.id, mapId, layerWithMetadata);
    }
};

/**
 * Removes a catalog layer.
 *
 * @param {string} layerId - Layer ID to remove
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const removeCatalogLayer = async (layerId, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);

    if (mapData.catalogLayers) {
        // Capture layer data before removal for logging
        const removedLayer = mapData.catalogLayers.find(l => l.id === layerId);

        mapData.catalogLayers = mapData.catalogLayers.filter(l => l.id !== layerId);
        await updateMapData(targetMap, mapData);

        // Log operation for sync
        if (removedLayer) {
            const mapId = mapManager.getCurrentMapId();
            logCatalogLayerOperation(OperationType.DELETE, layerId, mapId, null, removedLayer);
        }
    }
};

/**
 * Updates a catalog layer.
 *
 * @param {string} layerId - Layer ID to update
 * @param {Partial<CatalogLayerState>} updates - Updates to apply
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const updateCatalogLayer = async (layerId, updates, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);

    if (mapData.catalogLayers) {
        const layer = mapData.catalogLayers.find(l => l.id === layerId);
        if (layer) {
            // Capture old state for logging
            const oldLayer = { ...layer };

            Object.assign(layer, updates);

            // Update sync metadata
            if (layer.sync) {
                layer.sync = touchSyncMetadata(layer.sync);
            }

            await updateMapData(targetMap, mapData);

            // Log operation for sync
            const mapId = mapManager.getCurrentMapId();
            logCatalogLayerOperation(OperationType.UPDATE, layerId, mapId, layer, oldLayer);
        }
    }
};

/**
 * Toggles catalog layer visibility.
 *
 * @param {string} layerId - Layer ID
 * @param {boolean} visible - New visibility state
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const toggleCatalogLayerVisibility = async (layerId, visible, mapName = null) => {
    await updateCatalogLayer(layerId, { visible }, mapName);
};

/**
 * Gets a specific catalog layer by ID.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<CatalogLayerState|null>} Layer or null
 */
export const getCatalogLayerById = async (layerId, mapName = null) => {
    const layers = await getCatalogLayers(mapName);
    return layers.find(l => l.id === layerId) || null;
};

/**
 * Checks if a catalog layer exists.
 *
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} True if exists
 */
export const hasCatalogLayer = async (layerId, mapName = null) => {
    const layer = await getCatalogLayerById(layerId, mapName);
    return layer !== null;
};

/**
 * Clears all catalog layers.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const clearCatalogLayers = async (mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);
    mapData.catalogLayers = [];
    await updateMapData(targetMap, mapData);
};

// ===== AVAILABILITY VALIDATION =====

/**
 * Validates if a catalog layer is available in the current config.
 *
 * @param {CatalogLayerState} layer - Layer to validate
 * @returns {CatalogLayerStatus} 'active' if available, 'unavailable' otherwise
 */
export const validateCatalogLayerAvailability = (layer) => {
    switch (layer.type) {
        case ITEM_TYPES.HILLSHADE:
            return config.map2d?.hillshade?.enabled === true
                ? 'active'
                : 'unavailable';

        case ITEM_TYPES.ANALYSIS_LAYER: {
            const analysisConfig = config.analysisLayers;
            if (!analysisConfig?.enabled) return 'unavailable';

            const layerExists = analysisConfig.layers?.some(
                l => l.id === (layer.originalId || layer.config?.id)
            );
            return layerExists ? 'active' : 'unavailable';
        }

        case ITEM_TYPES.DATA_LAYER: {
            const dataConfig = config.dataLayers;
            if (!dataConfig?.enabled) return 'unavailable';

            const layerExists = dataConfig.layers?.some(
                l => l.id === (layer.originalId || layer.config?.id)
            );
            return layerExists ? 'active' : 'unavailable';
        }

        case ITEM_TYPES.MODEL_3D: {
            const tilesets = config.tilesets;
            if (!tilesets || tilesets.length === 0) return 'unavailable';

            const tilesetExists = tilesets.some(
                t => t.id === (layer.originalId || layer.config?.id)
            );
            return tilesetExists ? 'active' : 'unavailable';
        }

        default:
            return 'unavailable';
    }
};

/**
 * Processes catalog layers during import, validating availability.
 *
 * @param {CatalogLayerState[]} layers - Layers from the imported file
 * @returns {{ processed: CatalogLayerState[], unavailableCount: number }}
 */
export const processCatalogLayersOnImport = (layers) => {
    if (!layers || !Array.isArray(layers)) {
        return { processed: [], unavailableCount: 0 };
    }

    let unavailableCount = 0;

    const processed = layers.map(layer => {
        const status = validateCatalogLayerAvailability(layer);

        if (status === 'unavailable') {
            unavailableCount++;
        }

        return {
            ...layer,
            status
        };
    });

    return { processed, unavailableCount };
};

/**
 * Updates the status of a catalog layer.
 *
 * @param {string} layerId - Layer ID
 * @param {CatalogLayerStatus} status - New status
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const updateCatalogLayerStatus = async (layerId, status, mapName = null) => {
    await updateCatalogLayer(layerId, { status }, mapName);
};

/**
 * Re-validates all catalog layers and updates their status.
 * Useful when config might have changed.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<{ reactivated: string[], stillUnavailable: string[] }>}
 */
export const revalidateCatalogLayers = async (mapName = null) => {
    const layers = await getCatalogLayers(mapName);
    const reactivated = [];
    const stillUnavailable = [];

    for (const layer of layers) {
        const newStatus = validateCatalogLayerAvailability(layer);

        if (layer.status !== newStatus) {
            await updateCatalogLayerStatus(layer.id, newStatus, mapName);
        }

        if (newStatus === 'unavailable') {
            stillUnavailable.push(layer.id);
        } else if (layer.status === 'unavailable' && newStatus === 'active') {
            reactivated.push(layer.id);
        }
    }

    return { reactivated, stillUnavailable };
};

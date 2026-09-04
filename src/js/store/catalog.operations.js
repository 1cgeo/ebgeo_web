// Path: js/store/catalog.operations.js

/**
 * @fileoverview Store operations for catalog layers.
 * Manages persistence of catalog layers added to the map.
 */

import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import config from '../config.js';
import { generateUUID } from '../utilities/uuid.js';
import { getMapDataCompat, updateMapDataCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { logCatalogLayerOperation, OperationType } from './sync/index.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';

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
 * Checks whether a config section contains a layer matching the given catalog layer.
 *
 * @param {Object|null} sectionConfig - Config section (e.g. config.analysisLayers)
 * @param {CatalogLayerState} layer - Catalog layer to match
 * @returns {boolean} True if enabled and layer exists in config
 */
function hasConfigLayer(sectionConfig, layer) {
    if (!sectionConfig?.enabled) return false;

    const targetId = layer.originalId || layer.config?.id;
    return sectionConfig.layers?.some(l => l.id === targetId) ?? false;
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
    const targetMap = resolveMapName(mapName);
    const mapData = await getMapDataCompat(targetMap);

    if (!mapData.catalogLayers) {
        mapData.catalogLayers = [];
    }

    const exists = mapData.catalogLayers.some(l => l.id === layer.id);
    if (exists) return;

    const layerWithMetadata = {
        ...layer,
        id: layer.id || generateUUID(),
        sync: createSyncMetadata(null)
    };

    mapData.catalogLayers.push(layerWithMetadata);
    await updateMapDataCompat(targetMap, mapData);

    const mapId = mapManager.getCurrentMapId();
    logCatalogLayerOperation(OperationType.CREATE, layerWithMetadata.id, mapId, layerWithMetadata);
}

/**
 * Removes a catalog layer.
 *
 * @param {string} layerId - Layer ID to remove
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function removeCatalogLayer(layerId, mapName = null) {
    const targetMap = resolveMapName(mapName);
    const mapData = await getMapDataCompat(targetMap);

    if (!mapData.catalogLayers) return;

    const removedLayer = mapData.catalogLayers.find(l => l.id === layerId);
    mapData.catalogLayers = mapData.catalogLayers.filter(l => l.id !== layerId);
    await updateMapDataCompat(targetMap, mapData);

    if (removedLayer) {
        const mapId = mapManager.getCurrentMapId();
        logCatalogLayerOperation(OperationType.DELETE, layerId, mapId, null, removedLayer);
    }
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
    const targetMap = resolveMapName(mapName);
    const mapData = await getMapDataCompat(targetMap);

    if (!mapData.catalogLayers) return;

    const layer = mapData.catalogLayers.find(l => l.id === layerId);
    if (!layer) return;

    const oldLayer = { ...layer };
    Object.assign(layer, updates);

    if (layer.sync) {
        layer.sync = touchSyncMetadata(layer.sync);
    }

    await updateMapDataCompat(targetMap, mapData);

    const mapId = mapManager.getCurrentMapId();
    logCatalogLayerOperation(OperationType.UPDATE, layerId, mapId, layer, oldLayer);
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
 * Validates if a catalog layer is available in the current config.
 *
 * @param {CatalogLayerState} layer - Layer to validate
 * @returns {CatalogLayerStatus} 'active' if available, 'unavailable' otherwise
 */
export function validateCatalogLayerAvailability(layer) {
    switch (layer.type) {
        case CATALOG_ITEM_TYPES.HILLSHADE:
            return config.map2d?.hillshade?.enabled === true ? 'active' : 'unavailable';

        case CATALOG_ITEM_TYPES.ANALYSIS_LAYER:
            return hasConfigLayer(config.analysisLayers, layer) ? 'active' : 'unavailable';

        case CATALOG_ITEM_TYPES.DATA_LAYER:
            return hasConfigLayer(config.dataLayers, layer) ? 'active' : 'unavailable';

        case CATALOG_ITEM_TYPES.MODEL_3D: {
            const tilesets = config.tilesets;
            if (!tilesets || tilesets.length === 0) return 'unavailable';

            const targetId = layer.originalId || layer.config?.id;
            return tilesets.some(t => t.id === targetId) ? 'active' : 'unavailable';
        }

        default:
            return 'unavailable';
    }
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

    const processed = layers.map(layer => {
        const status = validateCatalogLayerAvailability(layer);
        if (status === 'unavailable') unavailableCount++;
        return { ...layer, status };
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
 * @returns {Promise<{ layers: CatalogLayerState[], reactivated: string[], stillUnavailable: string[] }>}
 */
export async function revalidateCatalogLayers(mapName = null) {
    const targetMap = resolveMapName(mapName);
    const mapData = await getMapDataCompat(targetMap);
    const catalogLayers = mapData.catalogLayers || [];

    const reactivated = [];
    const stillUnavailable = [];
    let hasChanges = false;

    for (const layer of catalogLayers) {
        const oldStatus = layer.status;
        const newStatus = validateCatalogLayerAvailability(layer);

        if (oldStatus !== newStatus) {
            layer.status = newStatus;
            if (layer.sync) {
                layer.sync = touchSyncMetadata(layer.sync);
            }
            hasChanges = true;
        }

        if (newStatus === 'unavailable') {
            stillUnavailable.push(layer.id);
        } else if (oldStatus === 'unavailable' && newStatus === 'active') {
            reactivated.push(layer.id);
        }
    }

    if (hasChanges) {
        await updateMapDataCompat(targetMap, mapData);
    }

    return { layers: catalogLayers, reactivated, stillUnavailable };
}

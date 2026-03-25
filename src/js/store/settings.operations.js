// Path: js/store/settings.operations.js

/**
 * @fileoverview Settings, notes, grid, hillshade, and image operations.
 */

import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { getCatalogLayers } from './catalog.operations.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import {
    deleteImageCompat as removeImageData,
    getGridStyleCompat as getGridStyleRepo,
    getImageCompat as getImageData,
    getMapDataCompat as getMapData,
    getMapNotesCompat as getMapNotesRepo,
    hasImageCompat as hasImageData,
    saveImageCompat as storeImageData,
    setGridStyleCompat as setGridStyleRepo,
    setMapNotesCompat as setMapNotesRepo,
    updateMapDataCompat as updateMapData
} from './repositories/index.js';
import { mapResolver } from './services/map-resolver.service.js';
import mapManager from './store-state-manager.js';
import { logGridStyleOperation, logMapNotesOperation, OperationType } from './sync/index.js';

// ===== HELPERS =====

/**
 * Checks if a catalog layer is active (visible and available).
 *
 * @param {Object} layer - Catalog layer object
 * @returns {boolean}
 */
function isCatalogLayerActive(layer) {
    return layer?.visible === true && layer?.status !== 'unavailable';
}

/**
 * Resolves the target map name, falling back to the current map.
 *
 * @param {string|null} mapName
 * @returns {string}
 */
function resolveMapName(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

// ===== MAP NOTES =====

/**
 * Gets map notes.
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<import('./store.types.js').MapNotes>} Map notes
 */
export async function getMapNotes(mapName = null) {
    return getMapNotesRepo(resolveMapName(mapName));
}

/**
 * Sets map notes.
 *
 * @param {string} mapName - Map name
 * @param {import('./store.types.js').MapNotes} notes - Notes data
 * @returns {Promise<void>}
 */
export async function setMapNotes(mapName, notes) {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot set map notes.');
        return;
    }

    const targetMap = resolveMapName(mapName);
    const previousNotes = await getMapNotesRepo(targetMap);

    await setMapNotesRepo(targetMap, notes);

    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    const opType = previousNotes?.title || previousNotes?.description
        ? OperationType.UPDATE
        : OperationType.CREATE;
    logMapNotesOperation(opType, mapId, notes, previousNotes);
}

/**
 * Checks if a map has notes (title or description not empty).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} True if map has notes
 */
export async function hasMapNotes(mapName = null) {
    const notes = await getMapNotes(mapName);
    return !!(notes && (notes.title?.trim() || notes.description?.trim()));
}

// ===== GRID STYLE =====

/**
 * Gets grid style.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<import('./store.types.js').GridStyle>} Grid style
 */
export async function getGridStyle(mapName) {
    return getGridStyleRepo(mapName);
}

/**
 * Sets grid style.
 *
 * @param {string} mapName - Map name
 * @param {import('./store.types.js').GridStyle} gridStyle - Grid style
 * @returns {Promise<void>}
 */
export async function setGridStyle(mapName, gridStyle) {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot set grid style.');
        return;
    }

    const targetMap = resolveMapName(mapName);
    const previousGridStyle = await getGridStyleRepo(targetMap);

    await setGridStyleRepo(targetMap, gridStyle);

    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    const opType = previousGridStyle ? OperationType.UPDATE : OperationType.CREATE;
    logGridStyleOperation(opType, mapId, gridStyle, previousGridStyle);
}

// ===== HILLSHADE =====

/**
 * Gets map hillshade state from catalog layers.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} Hillshade enabled state
 */
export async function getMapHillshadeState(mapName = null) {
    const catalogLayers = await getCatalogLayers(mapName);
    const hillshadeLayer = catalogLayers?.find(l => l.type === CATALOG_ITEM_TYPES.HILLSHADE);

    return isCatalogLayerActive(hillshadeLayer);
}

// ===== ANALYSIS LAYERS =====

/**
 * Gets a specific analysis layer state from catalog layers.
 *
 * @param {string} layerId - Analysis layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} Layer enabled state
 */
export async function getMapAnalysisLayerState(layerId, mapName = null) {
    const catalogLayers = await getCatalogLayers(mapName);
    const analysisLayer = catalogLayers?.find(
        l => l.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER &&
             (l.config?.id === layerId || l.originalId === layerId || l.id === `analysis-${layerId}`)
    );

    return isCatalogLayerActive(analysisLayer);
}

/**
 * Gets all analysis layers states from catalog layers.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<Object>} Analysis layers states { layerId: boolean }
 */
export async function getMapAnalysisLayersStates(mapName = null) {
    const catalogLayers = await getCatalogLayers(mapName);
    const states = {};

    catalogLayers?.forEach(layer => {
        if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER) {
            const layerId = layer.config?.id || layer.originalId || layer.id.replace('analysis-', '');
            states[layerId] = isCatalogLayerActive(layer);
        }
    });

    return states;
}

/**
 * Sets multiple analysis layers states.
 *
 * @param {Object} layersStates - Layers states object
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function setMapAnalysisLayersStates(layersStates, mapName = null) {
    const targetMap = resolveMapName(mapName);
    const mapData = await getMapData(targetMap);

    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    Object.assign(mapData.analysisLayers, layersStates);
    await updateMapData(targetMap, mapData);
}

// ===== IMAGE MANAGEMENT =====

/**
 * Stores an image.
 *
 * @param {string} imageId - Image ID
 * @param {Blob} blob - Image blob
 * @returns {Promise<void>}
 */
export async function storeImage(imageId, blob) {
    await storeImageData(imageId, blob);
}

/**
 * Gets an image.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<Blob|null>} Image blob or null
 */
export async function getImage(imageId) {
    return getImageData(imageId);
}

/**
 * Removes an image.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<void>}
 */
export async function removeImage(imageId) {
    await removeImageData(imageId);
}

/**
 * Checks if an image exists.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<boolean>} True if image exists
 */
export async function hasImage(imageId) {
    return hasImageData(imageId);
}

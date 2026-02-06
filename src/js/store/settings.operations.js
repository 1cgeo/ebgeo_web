// Path: js/store/settings.operations.js

/**
 * @fileoverview Settings, notes, grid, hillshade, and image operations.
 */

import {
    getMapDataCompat,
    updateMapDataCompat,
    saveImageCompat,
    getImageCompat,
    deleteImageCompat,
    hasImageCompat,
    setMapNotesCompat,
    getMapNotesCompat,
    setGridStyleCompat,
    getGridStyleCompat
} from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import { getCatalogLayers } from './catalog.operations.js';
import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { logMapNotesOperation, logGridStyleOperation, OperationType } from './sync/index.js';
import { mapResolver } from './services/map-resolver.service.js';

// Alias for backward compatibility during migration
const getMapData = getMapDataCompat;
const updateMapData = updateMapDataCompat;
const storeImageData = saveImageCompat;
const getImageData = getImageCompat;
const removeImageData = deleteImageCompat;
const hasImageData = hasImageCompat;
const setMapNotesRepo = setMapNotesCompat;
const getMapNotesRepo = getMapNotesCompat;
const setGridStyleRepo = setGridStyleCompat;
const getGridStyleRepo = getGridStyleCompat;

// ===== MAP NOTES =====

/**
 * Gets map notes.
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<import('./store.types.js').MapNotes>} Map notes
 */
export const getMapNotes = async (mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    return await getMapNotesRepo(targetMap);
};

/**
 * Sets map notes.
 *
 * @param {string} mapName - Map name
 * @param {import('./store.types.js').MapNotes} notes - Notes data
 * @returns {Promise<void>}
 */
export const setMapNotes = async (mapName, notes) => {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot set map notes.');
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();

    // Get previous notes for logging
    const previousNotes = await getMapNotesRepo(targetMap);

    await setMapNotesRepo(targetMap, notes);

    // Log operation for sync
    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    const opType = previousNotes?.title || previousNotes?.description
        ? OperationType.UPDATE
        : OperationType.CREATE;
    logMapNotesOperation(opType, mapId, notes, previousNotes);
};

/**
 * Checks if a map has notes (title or description not empty).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} True if map has notes
 */
export const hasMapNotes = async (mapName = null) => {
    const notes = await getMapNotes(mapName);
    return !!(notes && (notes.title?.trim() || notes.description?.trim()));
};

// ===== GRID STYLE =====

/**
 * Gets grid style.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<import('./store.types.js').GridStyle>} Grid style
 */
export const getGridStyle = async (mapName) => {
    return await getGridStyleRepo(mapName);
};

/**
 * Sets grid style.
 *
 * @param {string} mapName - Map name
 * @param {import('./store.types.js').GridStyle} gridStyle - Grid style
 * @returns {Promise<void>}
 */
export const setGridStyle = async (mapName, gridStyle) => {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot set grid style.');
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();

    // Get previous grid style for logging
    const previousGridStyle = await getGridStyleRepo(targetMap);

    await setGridStyleRepo(targetMap, gridStyle);

    // Log operation for sync
    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    const opType = previousGridStyle ? OperationType.UPDATE : OperationType.CREATE;
    logGridStyleOperation(opType, mapId, gridStyle, previousGridStyle);
};

// ===== HILLSHADE =====

/**
 * Gets map hillshade state from catalog layers.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} Hillshade enabled state
 */
export const getMapHillshadeState = async (mapName = null) => {
    const catalogLayers = await getCatalogLayers(mapName);
    const hillshadeLayer = catalogLayers?.find(l => l.type === CATALOG_ITEM_TYPES.HILLSHADE);

    return hillshadeLayer?.visible === true && hillshadeLayer?.status !== 'unavailable';
};

// ===== ANALYSIS LAYERS =====

/**
 * Gets a specific analysis layer state from catalog layers.
 *
 * @param {string} layerId - Analysis layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} Layer enabled state
 */
export const getMapAnalysisLayerState = async (layerId, mapName = null) => {
    const catalogLayers = await getCatalogLayers(mapName);
    const analysisLayer = catalogLayers?.find(
        l => l.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER &&
             (l.config?.id === layerId || l.originalId === layerId || l.id === `analysis-${layerId}`)
    );

    return analysisLayer?.visible === true && analysisLayer?.status !== 'unavailable';
};

/**
 * Gets all analysis layers states from catalog layers.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<Object>} Analysis layers states { layerId: boolean }
 */
export const getMapAnalysisLayersStates = async (mapName = null) => {
    const catalogLayers = await getCatalogLayers(mapName);
    const states = {};

    catalogLayers?.forEach(layer => {
        if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER) {
            const layerId = layer.config?.id || layer.originalId || layer.id.replace('analysis-', '');
            states[layerId] = layer.visible === true && layer.status !== 'unavailable';
        }
    });

    return states;
};

/**
 * Sets multiple analysis layers states.
 *
 * @param {Object} layersStates - Layers states object
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const setMapAnalysisLayersStates = async (layersStates, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);

    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    Object.assign(mapData.analysisLayers, layersStates);
    await updateMapData(targetMap, mapData);
};

// ===== IMAGE MANAGEMENT =====

/**
 * Stores an image.
 *
 * @param {string} imageId - Image ID
 * @param {Blob} blob - Image blob
 * @returns {Promise<void>}
 */
export const storeImage = async (imageId, blob) => {
    await storeImageData(imageId, blob);
};

/**
 * Gets an image.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<Blob|null>} Image blob or null
 */
export const getImage = async (imageId) => {
    return await getImageData(imageId);
};

/**
 * Removes an image.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<void>}
 */
export const removeImage = async (imageId) => {
    await removeImageData(imageId);
};

/**
 * Checks if an image exists.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<boolean>} True if image exists
 */
export const hasImage = async (imageId) => {
    return await hasImageData(imageId);
};

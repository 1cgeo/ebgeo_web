// Path: js/store/settings.operations.js

/**
 * @fileoverview Settings, notes, frame, grid, hillshade, and image operations.
 */

import {
    getMapData,
    updateMapData,
    storeImageData,
    getImageData,
    removeImageData,
    hasImageData,
    setMapNotes as setMapNotesRepo,
    getMapNotes as getMapNotesRepo,
    setFrameStyle as setFrameStyleRepo,
    getFrameStyle as getFrameStyleRepo,
    setGridStyle as setGridStyleRepo,
    getGridStyle as getGridStyleRepo
} from './repository.js';
import mapManager from './store-state-manager.js';

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
    const targetMap = mapName || mapManager.getCurrentMapName();
    await setMapNotesRepo(targetMap, notes);
};

// ===== FRAME STYLE =====

/**
 * Gets frame style.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<import('./store.types.js').FrameStyle>} Frame style
 */
export const getFrameStyle = async (mapName) => {
    return await getFrameStyleRepo(mapName);
};

/**
 * Sets frame style.
 *
 * @param {string} mapName - Map name
 * @param {import('./store.types.js').FrameStyle} frameStyle - Frame style
 * @returns {Promise<void>}
 */
export const setFrameStyle = async (mapName, frameStyle) => {
    await setFrameStyleRepo(mapName, frameStyle);
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
    await setGridStyleRepo(mapName, gridStyle);
};

// ===== HILLSHADE =====

/**
 * Gets map hillshade state.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} Hillshade enabled state
 */
export const getMapHillshadeState = async (mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);
    return mapData.hillshadeEnabled ?? true;
};

/**
 * Sets map hillshade state.
 *
 * @param {boolean} enabled - New state
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const setMapHillshadeState = async (enabled, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);
    mapData.hillshadeEnabled = enabled;
    await updateMapData(targetMap, mapData);
};

// ===== ANALYSIS LAYERS =====

/**
 * Gets a specific analysis layer state.
 *
 * @param {string} layerId - Analysis layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} Layer enabled state
 */
export const getMapAnalysisLayerState = async (layerId, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);

    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    return mapData.analysisLayers[layerId] ?? false;
};

/**
 * Sets a specific analysis layer state.
 *
 * @param {string} layerId - Analysis layer ID
 * @param {boolean} enabled - New state
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const setMapAnalysisLayerState = async (layerId, enabled, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);

    if (!mapData.analysisLayers) {
        mapData.analysisLayers = {};
    }

    mapData.analysisLayers[layerId] = enabled;
    await updateMapData(targetMap, mapData);
};

/**
 * Gets all analysis layers states.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<Object>} Analysis layers states
 */
export const getMapAnalysisLayersStates = async (mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const mapData = await getMapData(targetMap);

    return mapData.analysisLayers || {};
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

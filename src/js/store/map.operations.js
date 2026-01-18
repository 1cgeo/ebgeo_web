// Path: js/store/map.operations.js

/**
 * @fileoverview Map CRUD operations.
 */

import {
    createMapData,
    getMapData,
    updateMapData,
    deleteMapData,
    getAllMapNames,
    renameMapData,
    setAppSetting,
    getAppSetting,
    getMapOrder as getMapOrderRepo,
    setMapOrder as setMapOrderRepo,
    setMapNotes as setMapNotesRepo
} from './repository.js';
import mapManager from './store-state-manager.js';
import config from '../config.js';

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
 * Sets dependencies for map operations.
 *
 * @param {import('./store.types.js').StoreDependencies} dependencies - Dependencies object
 */
export function setMapDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== MAP CRUD OPERATIONS =====

/**
 * Gets all map names in order.
 *
 * @returns {Promise<string[]>} Array of map names
 */
export const getAllMapNamesStore = async () => {
    const allMaps = await getAllMapNames();
    const savedOrder = await getMapOrderRepo();

    if (!savedOrder || savedOrder.length === 0) {
        return allMaps;
    }

    const orderedMaps = [];
    const remainingMaps = new Set(allMaps);

    for (const mapName of savedOrder) {
        if (remainingMaps.has(mapName)) {
            orderedMaps.push(mapName);
            remainingMaps.delete(mapName);
        }
    }

    for (const mapName of remainingMaps) {
        orderedMaps.push(mapName);
    }

    return orderedMaps;
};

/**
 * Gets the map order.
 *
 * @returns {Promise<string[]>} Ordered array of map names
 */
export const getMapOrder = async () => {
    return await getMapOrderRepo();
};

/**
 * Sets the map order.
 *
 * @param {string[]} orderArray - New map order
 * @returns {Promise<void>}
 */
export const setMapOrder = async (orderArray) => {
    await setMapOrderRepo(orderArray);
};

/**
 * Adds a new map.
 *
 * @param {string} mapName - Map name
 * @param {Object} [mapData=null] - Initial map data
 * @param {Object} [colorUsageData=null] - Color usage data
 * @param {Object} [notesData=null] - Notes data
 * @returns {Promise<Object>} Created map data
 */
export const addMap = async (mapName, mapData = null, colorUsageData = null, notesData = null) => {
    const newMapData = await createMapData(mapName, mapData);
    mapManager.addMapToMemory(mapName);
    await mapManager.processMapColors(mapName, newMapData, colorUsageData);

    if (notesData && (notesData.title || notesData.description)) {
        await setMapNotesRepo(mapName, notesData);
    }

    return newMapData;
};

/**
 * Removes a map.
 *
 * @param {string} mapName - Map name to remove
 * @returns {Promise<import('./store.types.js').RemoveResult>} Removal result
 */
export const removeMap = async (mapName) => {
    const mapData = await getMapData(mapName);
    if (!mapData || Object.keys(mapData).length === 0) {
        console.warn(`Tentativa de remover mapa inexistente: ${mapName}`);
        return { success: false, reason: 'MAP_NOT_FOUND' };
    }

    const currentMapName = mapManager.getCurrentMapName();
    const isCurrentMap = mapName === currentMapName;
    const allMaps = await getAllMapNames();
    const remainingMaps = allMaps.filter(name => name !== mapName);

    await deleteMapData(mapName);
    await mapManager.removeMapFromMemory(mapName);
    await deps.groupManager.clearMapGroups(mapName);

    if (isCurrentMap) {
        if (remainingMaps.length > 0) {
            const newCurrentMap = remainingMaps[0];
            await setCurrentMap(newCurrentMap);
        } else {
            await addMap('Principal');
            await setCurrentMap('Principal');
        }
    }

    return {
        success: true,
        wasCurrentMap: isCurrentMap,
        remainingMapsCount: remainingMaps.length,
        newCurrentMap: isCurrentMap ? (remainingMaps.length > 0 ? remainingMaps[0] : 'Principal') : currentMapName
    };
};

/**
 * Renames a map.
 *
 * @param {string} oldName - Current map name
 * @param {string} newName - New map name
 * @returns {Promise<void>}
 */
export const renameMap = async (oldName, newName) => {
    await renameMapData(oldName, newName);
    mapManager.renameMapInMemory(oldName, newName);

    if (mapManager.getCurrentMapName() === newName) {
        await deps.groupManager.loadGroupsToMemory(newName);
    }
};

/**
 * Sets the current map.
 *
 * @param {string} mapName - Map name to set as current
 * @returns {Promise<void>}
 */
export const setCurrentMap = async (mapName) => {
    await mapManager.setCurrentMap(mapName);
    await deps.groupManager.loadGroupsToMemory(mapName);
    await deps.layerManager.loadLayersToMemory(mapName);
};

/**
 * Gets the current map name (async).
 *
 * @returns {Promise<string>} Current map name
 */
export const getCurrentMapName = async () => {
    return await getAppSetting('lastActiveMap');
};

/**
 * Gets the current map name synchronously.
 *
 * @returns {string} Current map name
 */
export const getCurrentMapNameSync = () => {
    return mapManager.getCurrentMapName();
};

/**
 * Sets the last active map.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export const setLastActiveMap = async (mapName) => {
    await setAppSetting('lastActiveMap', mapName);
};

/**
 * Sets the schema version.
 *
 * @param {string} schemaVersion - Schema version
 * @returns {Promise<void>}
 */
export const setSchemaVersion = async (schemaVersion) => {
    await setAppSetting('schemaVersion', schemaVersion);
};

/**
 * Gets map data from storage.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<Object>} Map data
 */
export const getMapDataStore = async (mapName) => {
    return await getMapData(mapName);
};

// ===== MAP CONFIGURATION =====

/**
 * Gets the current base layer for a map.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<string>} Base layer ID
 */
export const getCurrentBaseLayer = async (mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    return currentMapData.baseLayer;
};

/**
 * Sets the base layer for a map.
 *
 * @param {string} layer - Base layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const setBaseLayer = async (layer, mapName = null) => {
    if (!config.basemaps[layer]?.enabled) {
        const fallback = config.getValidBasemapFallback();
        console.warn(`Base layer "${layer}" not enabled. Using "${fallback}".`);
        layer = fallback;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    currentMapData.baseLayer = layer;
    await updateMapData(targetMap, currentMapData);
};

/**
 * Updates the map position.
 *
 * @param {number} center_lat - Center latitude
 * @param {number} center_long - Center longitude
 * @param {number} zoom - Zoom level
 * @param {number} bearing - Bearing
 * @param {number} pitch - Pitch
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const updateMapPosition = async (center_lat, center_long, zoom, bearing, pitch, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    currentMapData.center_lat = center_lat;
    currentMapData.center_long = center_long;
    currentMapData.zoom = zoom;
    currentMapData.bearing = bearing;
    currentMapData.pitch = pitch;
    await updateMapData(targetMap, currentMapData);
};

/**
 * Gets the map position.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<import('./store.types.js').MapPosition>} Map position
 */
export const getMapPosition = async (mapName) => {
    const currentMapData = await getMapData(mapName);
    return {
        center_lat: currentMapData.center_lat,
        center_long: currentMapData.center_long,
        zoom: currentMapData.zoom,
        bearing: currentMapData.bearing,
        pitch: currentMapData.pitch
    };
};

/**
 * Checks if a map has a saved position.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} True if has saved position
 */
export const hasMapSavedPosition = async (mapName = null) => {
    const position = await getMapPosition(mapName);
    return position.center_lat !== null &&
        position.center_long !== null &&
        position.zoom !== null &&
        position.bearing !== null &&
        position.pitch !== null;
};

/**
 * Clears the map position.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const clearMapPosition = async (mapName = null) => {
    const targetMapName = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMapName);

    currentMapData.center_lat = null;
    currentMapData.center_long = null;
    currentMapData.zoom = null;
    currentMapData.bearing = null;
    currentMapData.pitch = null;

    await updateMapData(targetMapName, currentMapData);
};

// ===== UNDO/REDO =====

/**
 * Undoes the last action.
 *
 * @param {Object} executeFunctions - Functions to execute undo
 * @returns {Promise<Object>} Undo result
 */
export const undoLastAction = async (executeFunctions) => {
    return await mapManager.undoLastAction(executeFunctions);
};

/**
 * Redoes the last undone action.
 *
 * @param {Object} executeFunctions - Functions to execute redo
 * @returns {Promise<Object>} Redo result
 */
export const redoLastAction = async (executeFunctions) => {
    return await mapManager.redoLastAction(executeFunctions);
};

// ===== COLOR TRACKING =====

/**
 * Gets frequently used colors.
 *
 * @param {number} [limit=10] - Maximum colors to return
 * @param {string} [scope='current'] - Scope ('current' or 'project')
 * @returns {string[]} Array of hex colors
 */
export const getFrequentColors = (limit = 10, scope = 'current') => {
    return mapManager.getFrequentColors(limit, scope);
};

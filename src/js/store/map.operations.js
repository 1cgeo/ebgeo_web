// Path: js/store/map.operations.js

/**
 * @fileoverview Map CRUD operations.
 */

import {
    getMapDataCompat,
    updateMapDataCompat,
    createMapCompat,
    deleteMapCompat,
    renameMapCompat,
    getAllMapKeysCompat,
    getSettingCompat,
    setSettingCompat,
    setMapNotesCompat
} from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { mapResolver } from './services/map-resolver.service.js';
import config from '../config.js';
import { EventTypes } from '../events';
import { logMapOperation, logMapPositionOperation, logBaseLayerOperation, OperationType } from './sync/index.js';
import { generateUUID } from '../utilities/uuid.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';

// Alias for backward compatibility during migration
const getMapData = getMapDataCompat;
const updateMapData = updateMapDataCompat;
const createMapData = createMapCompat;
const deleteMapData = deleteMapCompat;
const renameMapData = renameMapCompat;
const getAllMapNames = getAllMapKeysCompat;
const getAppSetting = getSettingCompat;
const setAppSetting = setSettingCompat;
const setMapNotesRepo = setMapNotesCompat;
const getMapOrderRepo = async () => await getSettingCompat('mapOrder') || [];
const setMapOrderRepo = async (order) => await setSettingCompat('mapOrder', order);

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

    // Log operation for sync (use map ID from resolver if available)
    const mapId = mapResolver.resolveToId(mapName) || mapName;
    logMapOperation(OperationType.CREATE, mapId, newMapData);

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

    // Get map ID before deletion for logging
    const mapId = mapResolver.resolveToId(mapName) || mapName;

    const currentMapName = mapManager.getCurrentMapName();
    const isCurrentMap = mapName === currentMapName;
    const allMaps = await getAllMapNames();
    const remainingMaps = allMaps.filter(name => name !== mapName);

    await deleteMapData(mapName);
    await mapManager.removeMapFromMemory(mapName);
    await deps.groupManager.clearMapGroups(mapName);

    // Remove badge color for this map (will be reused for new maps)
    const colors = await getAppSetting('mapBadgeColors');
    if (colors && colors[mapName]) {
        delete colors[mapName];
        await setAppSetting('mapBadgeColors', colors);
    }

    if (isCurrentMap) {
        if (remainingMaps.length > 0) {
            const newCurrentMap = remainingMaps[0];
            await setCurrentMap(newCurrentMap);
        } else {
            await addMap('Principal');
            await setCurrentMap('Principal');
        }
    }

    // Log operation for sync
    logMapOperation(OperationType.DELETE, mapId, null, mapData);

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
    if (memoryStore.lockedMaps.has(oldName)) {
        console.warn('Map is locked. Cannot rename.');
        return;
    }

    // Get map data for logging before rename
    const oldMapData = await getMapData(oldName);
    const mapId = mapResolver.resolveToId(oldName) || oldName;

    await renameMapData(oldName, newName);
    mapManager.renameMapInMemory(oldName, newName);

    // Update MapResolverService mapping
    mapResolver.renameMap(oldName, newName);

    // Transfer badge color to new name
    const colors = await getAppSetting('mapBadgeColors');
    if (colors && colors[oldName]) {
        colors[newName] = colors[oldName];
        delete colors[oldName];
        await setAppSetting('mapBadgeColors', colors);
    }

    if (mapManager.getCurrentMapName() === newName) {
        await deps.groupManager.loadGroupsToMemory(newName);
    }

    // Log operation for sync
    const newMapData = await getMapData(newName);
    logMapOperation(OperationType.UPDATE, mapId, newMapData, oldMapData);
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

    // Emit lock state change so all UI components update on map switch
    const locked = memoryStore.lockedMaps.has(mapName);
    deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, { mapName, locked });
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
 * Gets the current map UUID synchronously.
 * Uses MapResolverService for name → ID resolution.
 *
 * @returns {string} Current map UUID (or name if resolver not initialized)
 */
export const getCurrentMapIdSync = () => {
    return mapManager.getCurrentMapId();
};

/**
 * Gets both current map name and ID synchronously.
 *
 * @returns {{name: string, id: string}} Object with name and id
 */
export const getCurrentMapInfoSync = () => {
    return mapManager.getCurrentMapInfo();
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
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot change base layer.');
        return;
    }

    if (!config.basemaps[layer]?.enabled) {
        const fallback = config.getValidBasemapFallback();
        console.warn(`Base layer "${layer}" not enabled. Using "${fallback}".`);
        layer = fallback;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);

    // Capture old state for logging
    const previousBaseLayer = currentMapData.baseLayer;

    currentMapData.baseLayer = layer;
    await updateMapData(targetMap, currentMapData);

    // Log operation for sync
    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    logBaseLayerOperation(OperationType.UPDATE, mapId, { baseLayer: layer }, { baseLayer: previousBaseLayer });
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
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update position.');
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);

    // Check if this is an update or create
    const existingPosition = currentMapData.savedPosition;
    const isUpdate = !!existingPosition?.id;
    const previousData = existingPosition ? { ...existingPosition } : null;

    const sync = existingPosition?.sync
        ? touchSyncMetadata(existingPosition.sync)
        : createSyncMetadata(null);

    // Store position as a proper entity with UUID and sync metadata
    currentMapData.savedPosition = {
        id: existingPosition?.id || generateUUID(),
        center_lat,
        center_long,
        zoom,
        bearing,
        pitch,
        savedAt: Date.now(),
        sync
    };

    // Keep legacy fields for backward compatibility
    currentMapData.center_lat = center_lat;
    currentMapData.center_long = center_long;
    currentMapData.zoom = zoom;
    currentMapData.bearing = bearing;
    currentMapData.pitch = pitch;

    await updateMapData(targetMap, currentMapData);

    // Log operation for sync
    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    const newPosition = currentMapData.savedPosition;
    if (isUpdate) {
        logMapPositionOperation(OperationType.UPDATE, mapId, newPosition, previousData);
    } else {
        logMapPositionOperation(OperationType.CREATE, mapId, newPosition);
    }
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
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot clear position.');
        return;
    }

    const targetMapName = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMapName);

    // Capture for logging before clearing
    const existingPosition = currentMapData.savedPosition;
    const previousData = existingPosition ? { ...existingPosition } : null;
    const positionId = existingPosition?.id;

    // Clear the saved position entity
    delete currentMapData.savedPosition;

    // Clear legacy fields
    currentMapData.center_lat = null;
    currentMapData.center_long = null;
    currentMapData.zoom = null;
    currentMapData.bearing = null;
    currentMapData.pitch = null;

    await updateMapData(targetMapName, currentMapData);

    // Log operation for sync (only if there was a saved position)
    if (positionId) {
        const mapId = mapResolver.resolveToId(targetMapName) || targetMapName;
        logMapPositionOperation(OperationType.DELETE, mapId, null, previousData);
    }
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

// ===== MAP BADGE COLORS =====

/**
 * Color palette for map badges.
 */
const MAP_BADGE_COLORS = [
    '#3b82f6', // blue
    '#f59e0b', // amber
    '#f97316', // orange
    '#10b981', // emerald
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#ef4444', // red
    '#6366f1', // indigo
    '#14b8a6', // teal
    '#a855f7', // purple
];

/**
 * Gets map badge colors from storage.
 *
 * @returns {Promise<Object>} Map of mapName -> color
 */
export const getMapBadgeColors = async () => {
    const colors = await getAppSetting('mapBadgeColors');
    return colors || {};
};

/**
 * Sets map badge colors to storage.
 *
 * @param {Object} colors - Map of mapName -> color
 * @returns {Promise<void>}
 */
export const setMapBadgeColors = async (colors) => {
    await setAppSetting('mapBadgeColors', colors);
};

/**
 * Gets the badge color for a specific map.
 * If the map doesn't have a color, assigns one.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<string>} Hex color
 */
export const getMapBadgeColor = async (mapName) => {
    const colors = await getMapBadgeColors();

    if (colors[mapName]) {
        return colors[mapName];
    }

    // Assign a new color
    const usedColors = Object.values(colors);
    const availableColors = MAP_BADGE_COLORS.filter(c => !usedColors.includes(c));

    // If all colors are used, pick the least used one
    let newColor;
    if (availableColors.length > 0) {
        newColor = availableColors[0];
    } else {
        // Count color usage and pick the least used
        const colorCounts = {};
        MAP_BADGE_COLORS.forEach(c => { colorCounts[c] = 0; });
        usedColors.forEach(c => {
            if (colorCounts[c] !== undefined) {
                colorCounts[c]++;
            }
        });
        newColor = MAP_BADGE_COLORS.reduce((min, c) =>
            colorCounts[c] < colorCounts[min] ? c : min
        , MAP_BADGE_COLORS[0]);
    }

    colors[mapName] = newColor;
    await setMapBadgeColors(colors);
    return newColor;
};

/**
 * Removes the badge color for a map.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export const removeMapBadgeColor = async (mapName) => {
    const colors = await getMapBadgeColors();
    delete colors[mapName];
    await setMapBadgeColors(colors);
};

/**
 * Gets all map badge colors, assigning colors to maps that don't have one.
 *
 * @returns {Promise<Object>} Map of mapName -> color
 */
export const getAllMapBadgeColors = async () => {
    const allMaps = await getAllMapNames();
    const colors = await getMapBadgeColors();

    // Remove colors for maps that no longer exist
    const existingMapSet = new Set(allMaps);
    let changed = false;
    for (const mapName of Object.keys(colors)) {
        if (!existingMapSet.has(mapName)) {
            delete colors[mapName];
            changed = true;
        }
    }

    // Assign colors to maps that don't have one
    const usedColors = new Set(Object.values(colors));

    for (const mapName of allMaps) {
        if (!colors[mapName]) {
            // Find an unused color
            let newColor = MAP_BADGE_COLORS.find(c => !usedColors.has(c));

            if (!newColor) {
                // All colors used, find least used
                const colorCounts = {};
                MAP_BADGE_COLORS.forEach(c => { colorCounts[c] = 0; });
                Object.values(colors).forEach(c => {
                    if (colorCounts[c] !== undefined) {
                        colorCounts[c]++;
                    }
                });
                newColor = MAP_BADGE_COLORS.reduce((min, c) =>
                    colorCounts[c] < colorCounts[min] ? c : min
                , MAP_BADGE_COLORS[0]);
            }

            colors[mapName] = newColor;
            usedColors.add(newColor);
            changed = true;
        }
    }

    if (changed) {
        await setMapBadgeColors(colors);
    }

    return colors;
};

// ===== MAP LOCK (READ-ONLY) =====

/**
 * Gets lock state for a map (async, from IndexedDB).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} True if map is locked
 */
export const isMapLocked = async (mapName = null) => {
    const target = mapName || mapManager.getCurrentMapName();
    return !!(await getAppSetting(`mapLocked_${target}`));
};

/**
 * Gets lock state for current map (synchronous, from memory cache).
 * Use this in guards and hot paths that cannot await.
 *
 * @returns {boolean} True if current map is locked
 */
export const isCurrentMapLockedSync = () => {
    return memoryStore.lockedMaps.has(memoryStore.currentMap);
};

/**
 * Toggles lock state for a map.
 * Persists to IndexedDB, updates memory cache, emits MAP_LOCK_CHANGED.
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} New lock state
 */
export const toggleMapLock = async (mapName = null) => {
    const target = mapName || mapManager.getCurrentMapName();
    const current = await isMapLocked(target);
    const newState = !current;
    await setAppSetting(`mapLocked_${target}`, newState);
    if (newState) {
        memoryStore.lockedMaps.add(target);
    } else {
        memoryStore.lockedMaps.delete(target);
    }
    deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, { mapName: target, locked: newState });
    return newState;
};

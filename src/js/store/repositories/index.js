// Path: js/store/repositories/index.js

/**
 * @fileoverview Repository factory and exports.
 *
 * This module provides a unified entry point for repository access.
 * It exports the LocalRepository singleton and a factory function
 * that allows swapping implementations (for testing or future SyncRepository).
 *
 * Usage:
 * ```javascript
 * import { getRepository } from './repositories/index.js';
 * const repo = getRepository();
 * const mapData = await repo.getMap(mapId);
 * ```
 */

import { localRepository, LocalRepository, getEmptyMapData } from './local.repository.js';
import { RepositoryMethods, validateRepository, getMissingMethods } from './repository.interface.js';

// ===== SINGLETON MANAGEMENT =====

/**
 * Active repository instance.
 * Defaults to localRepository but can be swapped for testing or sync.
 * @type {import('./repository.interface.js').IRepository|null}
 */
let activeRepository = null;

/**
 * Gets the active repository instance.
 * Returns localRepository by default.
 * @returns {import('./repository.interface.js').IRepository} The active repository
 */
export function getRepository() {
    if (!activeRepository) {
        activeRepository = localRepository;
    }
    return activeRepository;
}

/**
 * Sets the active repository instance.
 * Used for testing or swapping to SyncRepository.
 * @param {import('./repository.interface.js').IRepository} repository - Repository to use
 * @throws {Error} If repository doesn't implement IRepository interface
 */
export function setRepository(repository) {
    if (!validateRepository(repository)) {
        const missing = getMissingMethods(repository);
        throw new Error(`Invalid repository: missing methods: ${missing.join(', ')}`);
    }
    activeRepository = repository;
}

/**
 * Resets to the default LocalRepository.
 * Useful for cleanup in tests.
 */
export function resetRepository() {
    activeRepository = localRepository;
}

// ===== RE-EXPORTS =====

// Export the singleton for direct access when needed
export { localRepository };

// Export the class for creating new instances (testing)
export { LocalRepository };

// Export helper functions
export { getEmptyMapData };

// Export interface utilities
export { RepositoryMethods, validateRepository, getMissingMethods };

// ===== COMPATIBILITY LAYER =====
// These functions provide backward-compatible wrappers around the repository
// to ease migration from the legacy repository.js

/**
 * Gets map data with default empty structure if not found.
 * Compatible with legacy getMapData(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<Object>} Map data or empty structure
 */
export async function getMapDataCompat(mapNameOrId) {
    const repo = getRepository();
    const data = await repo.getMap(mapNameOrId);
    if (data) return data;
    // Return empty structure for backward compatibility
    return getEmptyMapData();
}

/**
 * Updates map data.
 * Compatible with legacy updateMapData(mapName, data) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Object} mapData - Map data to save
 * @returns {Promise<void>}
 */
export async function updateMapDataCompat(mapNameOrId, mapData) {
    const repo = getRepository();
    await repo.saveMap(mapNameOrId, mapData);
}

/**
 * Gets layers for a map with default if not found.
 * Compatible with legacy getLayers(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<Array>} Layers array
 */
export async function getLayersCompat(mapNameOrId) {
    const repo = getRepository();
    return await repo.getLayers(mapNameOrId);
}

/**
 * Gets groups for a map.
 * Compatible with legacy getMapGroups(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<Object>} Groups object
 */
export async function getGroupsCompat(mapNameOrId) {
    const repo = getRepository();
    return await repo.getGroups(mapNameOrId);
}

/**
 * Saves groups for a map.
 * Compatible with legacy setMapGroups(mapName, groups) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Object} groups - Groups object
 * @returns {Promise<void>}
 */
export async function setGroupsCompat(mapNameOrId, groups) {
    const repo = getRepository();
    await repo.saveGroups(mapNameOrId, groups);
}

/**
 * Gets all map keys from storage.
 * Compatible with legacy getAllMapNames() signature.
 * @returns {Promise<string[]>} Array of map keys (names or IDs)
 */
export async function getAllMapKeysCompat() {
    const repo = getRepository();
    return await repo.getAllMapIds();
}

/**
 * Creates a new map with optional initial data.
 * Compatible with legacy createMapData(mapName, mapData) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Object} [mapData=null] - Initial map data
 * @returns {Promise<Object>} Created map data
 */
export async function createMapCompat(mapNameOrId, mapData = null) {
    const repo = getRepository();
    const newMapData = mapData || getEmptyMapData();
    // Ensure name is set if not provided
    if (!newMapData.name) {
        newMapData.name = mapNameOrId;
    }
    await repo.saveMap(mapNameOrId, newMapData);
    return newMapData;
}

/**
 * Deletes a map and its associated data.
 * Compatible with legacy deleteMapData(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<void>}
 */
export async function deleteMapCompat(mapNameOrId) {
    const repo = getRepository();
    await repo.deleteMap(mapNameOrId);
}

/**
 * Renames a map and transfers all associated data.
 * Compatible with legacy renameMapData(oldName, newName) signature.
 * @param {string} oldName - Current map name
 * @param {string} newName - New map name
 * @returns {Promise<void>}
 */
export async function renameMapCompat(oldName, newName) {
    const repo = getRepository();
    await repo.renameMap(oldName, newName);
}

/**
 * Gets a setting from app storage.
 * Compatible with legacy getAppSetting(key) signature.
 * @param {string} key - Setting key
 * @returns {Promise<any>} Setting value
 */
export async function getSettingCompat(key) {
    const repo = getRepository();
    return await repo.getSetting(key);
}

/**
 * Saves a setting to app storage.
 * Compatible with legacy setAppSetting(key, value) signature.
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 * @returns {Promise<void>}
 */
export async function setSettingCompat(key, value) {
    const repo = getRepository();
    await repo.saveSetting(key, value);
}

/**
 * Saves layers for a map.
 * Compatible with legacy setLayers(mapName, layers) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Array} layers - Layers array
 * @returns {Promise<void>}
 */
export async function setLayersCompat(mapNameOrId, layers) {
    const repo = getRepository();
    await repo.saveLayers(mapNameOrId, layers);
}

/**
 * Gets active layer ID for a map.
 * Compatible with legacy getActiveLayerId(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<string>} Active layer ID
 */
export async function getActiveLayerIdCompat(mapNameOrId) {
    const repo = getRepository();
    return await repo.getActiveLayerId(mapNameOrId);
}

/**
 * Saves active layer ID for a map.
 * Compatible with legacy setActiveLayerId(mapName, layerId) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {string} layerId - Active layer ID
 * @returns {Promise<void>}
 */
export async function setActiveLayerIdCompat(mapNameOrId, layerId) {
    const repo = getRepository();
    await repo.saveActiveLayerId(mapNameOrId, layerId);
}

/**
 * Gets Cesium3D data for a map.
 * Compatible with legacy getCesium3dData(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<Object>} Cesium3D data
 */
export async function getCesium3dCompat(mapNameOrId) {
    const repo = getRepository();
    return await repo.getCesium3d(mapNameOrId);
}

/**
 * Saves Cesium3D data for a map.
 * Compatible with legacy setCesium3dData(mapName, data) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Object} data - Cesium3D data
 * @returns {Promise<void>}
 */
export async function setCesium3dCompat(mapNameOrId, data) {
    const repo = getRepository();
    await repo.saveCesium3d(mapNameOrId, data);
}

/**
 * Gets StreetView360 data for a map.
 * Compatible with legacy getStreetview360Data(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<Object>} StreetView360 data
 */
export async function getStreetview360Compat(mapNameOrId) {
    const repo = getRepository();
    return await repo.getStreetview360(mapNameOrId);
}

/**
 * Saves StreetView360 data for a map.
 * Compatible with legacy setStreetview360Data(mapName, data) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Object} data - StreetView360 data
 * @returns {Promise<void>}
 */
export async function setStreetview360Compat(mapNameOrId, data) {
    const repo = getRepository();
    await repo.saveStreetview360(mapNameOrId, data);
}

/**
 * Saves an image blob.
 * Compatible with legacy storeImageData(imageId, blob) signature.
 * @param {string} imageId - Image ID
 * @param {Blob} blob - Image blob
 * @returns {Promise<void>}
 */
export async function saveImageCompat(imageId, blob) {
    const repo = getRepository();
    await repo.saveImage(imageId, blob);
}

/**
 * Gets an image blob.
 * Compatible with legacy getImageData(imageId) signature.
 * @param {string} imageId - Image ID
 * @returns {Promise<Blob|null>} Image blob or null
 */
export async function getImageCompat(imageId) {
    const repo = getRepository();
    return await repo.getImage(imageId);
}

/**
 * Deletes an image.
 * Compatible with legacy removeImageData(imageId) signature.
 * @param {string} imageId - Image ID
 * @returns {Promise<void>}
 */
export async function deleteImageCompat(imageId) {
    const repo = getRepository();
    await repo.deleteImage(imageId);
}

/**
 * Checks if an image exists.
 * Compatible with legacy hasImageData(imageId) signature.
 * @param {string} imageId - Image ID
 * @returns {Promise<boolean>} True if exists
 */
export async function hasImageCompat(imageId) {
    const repo = getRepository();
    return await repo.hasImage(imageId);
}

// ===== COLOR USAGE OPERATIONS =====
// These store color counts per map for the frequent colors feature

/**
 * Gets color usage data for a map.
 * Compatible with legacy getColorUsage(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<Object>} Color usage data (color -> count)
 */
export async function getColorUsageCompat(mapNameOrId) {
    const repo = getRepository();
    const key = `color_usage_${mapNameOrId}`;
    return await repo.getSetting(key) || {};
}

/**
 * Saves color usage data for a map.
 * Compatible with legacy setColorUsage(mapName, data) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Object} colorUsageData - Color usage data (color -> count)
 * @returns {Promise<void>}
 */
export async function setColorUsageCompat(mapNameOrId, colorUsageData) {
    const repo = getRepository();
    const key = `color_usage_${mapNameOrId}`;
    await repo.saveSetting(key, colorUsageData);
}

/**
 * Removes color usage data for a map.
 * Compatible with legacy removeColorUsage(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<void>}
 */
export async function removeColorUsageCompat(mapNameOrId) {
    const repo = getRepository();
    const key = `color_usage_${mapNameOrId}`;
    await repo.deleteSetting(key);
}

// ===== MAP NOTES OPERATIONS =====

/**
 * Gets map notes.
 * Compatible with legacy getMapNotes(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<{title: string, description: string}>}
 */
export async function getMapNotesCompat(mapNameOrId) {
    const repo = getRepository();
    return await repo.getMapNotes(mapNameOrId);
}

/**
 * Saves map notes.
 * Compatible with legacy setMapNotes(mapName, notes) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {{title: string, description: string}} notes - Notes data
 * @returns {Promise<void>}
 */
export async function setMapNotesCompat(mapNameOrId, notes) {
    const repo = getRepository();
    await repo.saveMapNotes(mapNameOrId, notes);
}

/**
 * Removes map notes.
 * Compatible with legacy removeMapNotes(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<void>}
 */
export async function removeMapNotesCompat(mapNameOrId) {
    const repo = getRepository();
    await repo.deleteMapNotes(mapNameOrId);
}

// ===== GRID STYLE OPERATIONS =====

/**
 * Gets grid style for a map.
 * Compatible with legacy getGridStyle(mapName) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @returns {Promise<Object|null>}
 */
export async function getGridStyleCompat(mapNameOrId) {
    const repo = getRepository();
    return await repo.getGridStyle(mapNameOrId);
}

/**
 * Saves grid style for a map.
 * Compatible with legacy setGridStyle(mapName, gridStyle) signature.
 * @param {string} mapNameOrId - Map name or ID
 * @param {Object} gridStyle - Grid style data
 * @returns {Promise<void>}
 */
export async function setGridStyleCompat(mapNameOrId, gridStyle) {
    const repo = getRepository();
    await repo.saveGridStyle(mapNameOrId, gridStyle);
}

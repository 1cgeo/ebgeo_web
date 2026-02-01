// Path: js/store/repositories/repository.interface.js

/**
 * @fileoverview Repository interface definition.
 *
 * The Repository pattern abstracts data persistence, allowing the application
 * to work with data without knowing where it's stored (IndexedDB, REST API, etc.).
 *
 * This interface defines the contract that all repository implementations must follow.
 * Currently, only LocalRepository (IndexedDB) is implemented.
 * Future implementations may include:
 * - RemoteRepository (REST API)
 * - SyncRepository (combines local + remote with conflict resolution)
 */

/**
 * List of required methods for Repository implementations.
 * Used for runtime validation of repository objects.
 */
export const RepositoryMethods = Object.freeze([
    // Atlas operations
    'getAtlas',
    'saveAtlas',

    // Map operations
    'getMap',
    'getAllMaps',
    'getAllMapIds',
    'saveMap',
    'deleteMap',

    // Image operations
    'saveImage',
    'getImage',
    'deleteImage',
    'hasImage',

    // Layer operations
    'getLayers',
    'saveLayers',
    'getActiveLayerId',
    'saveActiveLayerId',

    // Group operations
    'getGroups',
    'saveGroups',

    // Cesium 3D operations
    'getCesium3d',
    'saveCesium3d',

    // Street View 360 operations
    'getStreetview360',
    'saveStreetview360',

    // Settings operations
    'getSetting',
    'saveSetting',
    'deleteSetting',
]);

/**
 * Validates if an object implements the IRepository interface.
 * @param {Object} repository - Object to validate
 * @returns {boolean} True if all required methods are present
 */
export function validateRepository(repository) {
    if (!repository || typeof repository !== 'object') {
        return false;
    }
    return RepositoryMethods.every(
        method => typeof repository[method] === 'function'
    );
}

/**
 * Gets list of missing methods from a repository implementation.
 * Useful for debugging incomplete implementations.
 * @param {Object} repository - Object to check
 * @returns {string[]} List of missing method names
 */
export function getMissingMethods(repository) {
    if (!repository || typeof repository !== 'object') {
        return [...RepositoryMethods];
    }
    return RepositoryMethods.filter(
        method => typeof repository[method] !== 'function'
    );
}

/**
 * @typedef {Object} IRepository
 *
 * Atlas operations:
 * @property {() => Promise<import('../atlas/atlas.entity.js').Atlas|null>} getAtlas
 *   Get the current Atlas (or null if none exists)
 * @property {(atlas: import('../atlas/atlas.entity.js').Atlas) => Promise<void>} saveAtlas
 *   Save the Atlas (creates or updates)
 *
 * Map operations:
 * @property {(mapId: string) => Promise<Object|null>} getMap
 *   Get a map by its ID
 * @property {() => Promise<Map<string, Object>>} getAllMaps
 *   Get all maps as a Map of id -> data
 * @property {() => Promise<string[]>} getAllMapIds
 *   Get list of all map IDs
 * @property {(mapId: string, data: Object) => Promise<void>} saveMap
 *   Save a map (creates or updates)
 * @property {(mapId: string) => Promise<void>} deleteMap
 *   Delete a map and all associated data
 *
 * Image operations:
 * @property {(imageId: string, blob: Blob) => Promise<void>} saveImage
 *   Save an image blob
 * @property {(imageId: string) => Promise<Blob|null>} getImage
 *   Get an image blob by ID
 * @property {(imageId: string) => Promise<void>} deleteImage
 *   Delete an image
 * @property {(imageId: string) => Promise<boolean>} hasImage
 *   Check if an image exists
 *
 * Layer operations:
 * @property {(mapId: string) => Promise<Array>} getLayers
 *   Get layers for a map
 * @property {(mapId: string, layers: Array) => Promise<void>} saveLayers
 *   Save layers for a map
 * @property {(mapId: string) => Promise<string>} getActiveLayerId
 *   Get active layer ID for a map
 * @property {(mapId: string, layerId: string) => Promise<void>} saveActiveLayerId
 *   Save active layer ID for a map
 *
 * Group operations:
 * @property {(mapId: string) => Promise<Object>} getGroups
 *   Get groups for a map
 * @property {(mapId: string, groups: Object) => Promise<void>} saveGroups
 *   Save groups for a map
 *
 * Cesium 3D operations:
 * @property {(mapId: string) => Promise<Object>} getCesium3d
 *   Get Cesium 3D data for a map
 * @property {(mapId: string, data: Object) => Promise<void>} saveCesium3d
 *   Save Cesium 3D data for a map
 *
 * Street View 360 operations:
 * @property {(mapId: string) => Promise<Object>} getStreetview360
 *   Get Street View 360 data for a map
 * @property {(mapId: string, data: Object) => Promise<void>} saveStreetview360
 *   Save Street View 360 data for a map
 *
 * Settings operations:
 * @property {(key: string) => Promise<any>} getSetting
 *   Get a setting by key
 * @property {(key: string, value: any) => Promise<void>} saveSetting
 *   Save a setting
 * @property {(key: string) => Promise<void>} deleteSetting
 *   Delete a setting
 */

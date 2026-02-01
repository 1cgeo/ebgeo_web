// Path: js/store/repository.js

/**
 * @fileoverview Repository facade - backward compatibility layer.
 *
 * This file exists for backward compatibility during the migration to the
 * new repository pattern. New code should import directly from:
 * - ./repository.utils.js - for utility functions (cleanFeature, compareVersions, etc.)
 * - ./memory-store.js - for runtime memory state
 * - ./repositories/index.js - for data access operations
 *
 * The following functions are still implemented here because they require
 * direct access to localforage instances for initialization and bulk operations:
 * - initializeRepository() - initializes the data layer and runs migrations
 * - clearAll*() functions - bulk clear operations for all stores
 */

import localforage from 'localforage';
import { detectMigrationNeeded, safelyMigrate } from './migration/migration.service.js';
import { ATLAS_SCHEMA_VERSION } from './atlas/atlas.entity.js';

// Re-export from repository.utils.js for backward compatibility
export {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    cleanFeature,
    isInternalProperty,
    compareVersions,
    getEmptyMapData,
    getDefaultLayer,
    getEmptyCesium3dData,
    getEmptyStreetview360Data
} from './repository.utils.js';

// Re-export from memory-store.js for backward compatibility
export { memoryStore, resetMemoryStore } from './memory-store.js';

// Import constants for internal use
import {
    SCHEMA_VERSION,
    getEmptyMapData,
    getEmptyCesium3dData
} from './repository.utils.js';
import { memoryStore } from './memory-store.js';

// Schema version for v2.0+ (Atlas-based)
export const CURRENT_SCHEMA_VERSION = ATLAS_SCHEMA_VERSION;

// ===== LOCALFORAGE INSTANCES =====
// These are kept here for initialization and bulk clear operations

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const imageStore = localforage.createInstance({ name: 'ebgeo_images' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });
const groupStore = localforage.createInstance({ name: 'ebgeo_groups' });
const layerStore = localforage.createInstance({ name: 'ebgeo_layers' });
const cesium3dStore = localforage.createInstance({ name: 'ebgeo_cesium3d' });
const streetview360Store = localforage.createInstance({ name: 'ebgeo_streetview360' });

// ===== HELPER FUNCTIONS FOR INITIALIZATION =====

/**
 * Compares two version strings (format X.Y).
 * @param {string} version1 - First version
 * @param {string} version2 - Second version
 * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersionsInternal(version1, version2) {
    const v1Parts = version1.split('.').map(Number);
    const v2Parts = version2.split('.').map(Number);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
        const v1Part = v1Parts[i] || 0;
        const v2Part = v2Parts[i] || 0;

        if (v1Part < v2Part) return -1;
        if (v1Part > v2Part) return 1;
    }
    return 0;
}

const MIN_SCHEMA_VERSION_INTERNAL = '1.3';

/**
 * Checks and cleans incompatible legacy data.
 */
const checkAndCleanLegacyData = async () => {
    try {
        const currentSchemaVersion = await appStore.getItem('schemaVersion');

        if (!currentSchemaVersion || compareVersionsInternal(currentSchemaVersion, MIN_SCHEMA_VERSION_INTERNAL) < 0) {
            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            await groupStore.clear();
            await layerStore.clear();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        }
    } catch (error) {
        console.warn('Error checking schema version:', error);
        try {
            await mapStore.clear();
            await imageStore.clear();
            await appStore.clear();
            await groupStore.clear();
            await layerStore.clear();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } catch (cleanupError) {
            console.error('Critical error cleaning data:', cleanupError);
        }
    }
};

// ===== LEGACY MIGRATION FUNCTIONS =====

const migrateMapTo14 = async (mapName, mapData) => {
    if (!mapData.features.coordination_measures) {
        mapData.features.coordination_measures = [];
        await mapStore.setItem(mapName, mapData);
        return true;
    }
    return false;
};

const migrateAllMapsTo14 = async () => {
    const mapNames = await mapStore.keys();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (mapData) {
            const wasMigrated = await migrateMapTo14(mapName, mapData);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.4`);
    }
};

const migrateMapTo15 = async (mapName, mapData) => {
    let modified = false;
    const featureTypes = Object.keys(mapData.features);

    for (const featureType of featureTypes) {
        const features = mapData.features[featureType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            if (feature.properties && !feature.properties.layerId) {
                feature.properties.layerId = 'default';
                modified = true;
            }
        }
    }

    if (modified) {
        await mapStore.setItem(mapName, mapData);
    }
    return modified;
};

const migrateAllMapsTo15 = async () => {
    const mapNames = await mapStore.keys();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (mapData) {
            const wasMigrated = await migrateMapTo15(mapName, mapData);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.5 (added layerId to features)`);
    }
};

const migrateMapTo16 = async (mapName, mapData) => {
    if (!mapData || !mapData.features) {
        return false;
    }

    let modified = false;
    const featureTypes = Object.keys(mapData.features);

    for (const featureType of featureTypes) {
        const features = mapData.features[featureType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            if (feature.properties) {
                if (feature.properties.attributes === undefined) {
                    feature.properties.attributes = {};
                    modified = true;
                }
                if (feature.properties.images === undefined) {
                    feature.properties.images = [];
                    modified = true;
                }
            }
        }
    }

    if (modified) {
        await mapStore.setItem(mapName, mapData);
    }
    return modified;
};

const migrateAllMapsTo16 = async () => {
    const mapNames = await mapStore.keys();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (mapData) {
            const wasMigrated = await migrateMapTo16(mapName, mapData);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.6 (added attributes and images to features)`);
    }
};

const migrateMapTo17 = async (mapName) => {
    const key = `cesium3d_${mapName}`;
    const existingData = await cesium3dStore.getItem(key);
    if (!existingData || existingData.cameraPositions === undefined || existingData.markers === undefined) {
        await cesium3dStore.setItem(key, getEmptyCesium3dData());
        return true;
    }
    return false;
};

const migrateAllMapsTo17 = async () => {
    const mapNames = await mapStore.keys();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        const wasMigrated = await migrateMapTo17(mapName);
        if (wasMigrated) migratedCount++;
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to v1.7 (initialized cesium3d data)`);
    }
};

// ===== INITIALIZATION =====

/**
 * Initializes the repository, runs migrations, and returns the last active map.
 * @returns {Promise<string>} Last active map name
 */
export const initializeRepository = async () => {
    try {
        await checkAndCleanLegacyData();

        const currentSchemaVersion = await appStore.getItem('schemaVersion');

        // Run legacy migrations (v1.3 -> v1.7) if needed
        if (currentSchemaVersion === '1.3') {
            await migrateAllMapsTo14();
            await migrateAllMapsTo15();
            await migrateAllMapsTo16();
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (currentSchemaVersion === '1.4') {
            await migrateAllMapsTo15();
            await migrateAllMapsTo16();
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (currentSchemaVersion === '1.5') {
            await migrateAllMapsTo16();
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (currentSchemaVersion === '1.6') {
            await migrateAllMapsTo17();
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        } else if (!currentSchemaVersion) {
            await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        }

        // Run v2.0 migration if needed (adds Atlas, sync metadata, etc.)
        const { needed } = await detectMigrationNeeded();
        if (needed) {
            console.log('Running v2.0 migration...');
            const result = await safelyMigrate();
            if (!result.success) {
                console.error('v2.0 migration failed:', result.error);
            } else {
                console.log('v2.0 migration completed successfully');
            }
        }

        const allMapNames = await mapStore.keys();
        if (allMapNames.length === 0) {
            await mapStore.setItem('Principal', getEmptyMapData());
            memoryStore.currentMap = 'Principal';
            return 'Principal';
        }

        const lastActiveMap = await appStore.getItem('lastActiveMap');
        if (lastActiveMap && allMapNames.includes(lastActiveMap)) {
            memoryStore.currentMap = lastActiveMap;
            return lastActiveMap;
        } else {
            const firstMap = allMapNames[0];
            memoryStore.currentMap = firstMap;
            return firstMap;
        }
    } catch (error) {
        console.error('Error initializing repository:', error);
        memoryStore.currentMap = 'Principal';
        return 'Principal';
    }
};

// ===== BULK CLEAR OPERATIONS =====

/**
 * Clears all map data.
 */
export const clearAllMapData = async () => {
    await mapStore.clear();
};

/**
 * Clears all image data.
 */
export const clearAllImageData = async () => {
    await imageStore.clear();
};

/**
 * Clears all group data.
 */
export const clearAllGroupData = async () => {
    await groupStore.clear();
};

/**
 * Clears all layer data.
 */
export const clearAllLayerData = async () => {
    await layerStore.clear();
};

/**
 * Clears all Cesium 3D data.
 */
export const clearAllCesium3dData = async () => {
    await cesium3dStore.clear();
};

/**
 * Clears all Street View 360 data.
 */
export const clearAllStreetview360Data = async () => {
    await streetview360Store.clear();
};

/**
 * Clears all app settings and associated per-map data.
 */
export const clearAllAppSettings = async () => {
    const allMaps = await mapStore.keys();
    for (const mapName of allMaps) {
        try {
            await appStore.removeItem(`color_usage_${mapName}`);
            await appStore.removeItem(`map_notes_${mapName}`);
            await appStore.removeItem(`gridStyle_${mapName}`);
            await groupStore.removeItem(mapName);
            await layerStore.removeItem(`layers_${mapName}`);
            await layerStore.removeItem(`activeLayer_${mapName}`);
            await cesium3dStore.removeItem(`cesium3d_${mapName}`);
            await streetview360Store.removeItem(`streetview360_${mapName}`);
        } catch (error) {
            console.warn(`Error clearing data for map ${mapName}:`, error);
        }
    }

    await appStore.clear();
};

// ===== APP SETTINGS (needed by store.js for setSchemaVersion) =====

/**
 * Sets an app setting.
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
export const setAppSetting = async (key, value) => {
    await appStore.setItem(key, value);
};

/**
 * Gets an app setting.
 * @param {string} key - Setting key
 * @returns {Promise<any>} Setting value
 */
export const getAppSetting = async (key) => {
    return await appStore.getItem(key);
};

// ===== COLOR USAGE (needed by store.js for getColorUsage export) =====

/**
 * Gets color usage data for a map.
 * @param {string} mapName - Map name
 * @returns {Promise<Object>} Color usage data
 */
export const getColorUsage = async (mapName) => {
    const key = `color_usage_${mapName}`;
    return await appStore.getItem(key) || {};
};

/**
 * Sets color usage data for a map.
 * @param {string} mapName - Map name
 * @param {Object} colorUsageData - Color usage data
 */
export const setColorUsage = async (mapName, colorUsageData) => {
    const key = `color_usage_${mapName}`;
    await appStore.setItem(key, colorUsageData);
};

/**
 * Removes color usage data for a map.
 * @param {string} mapName - Map name
 */
export const removeColorUsage = async (mapName) => {
    const key = `color_usage_${mapName}`;
    await appStore.removeItem(key);
};

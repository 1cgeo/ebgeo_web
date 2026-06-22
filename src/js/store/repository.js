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
import config from '../config.js';
import { createSyncMetadata } from './sync/sync-metadata.js';
import { DEFAULT_MAP_NAME } from './store.constants.js';
import { logAtlasSetting } from './sync/operation-dispatcher.js';

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

// Import for internal use
import {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    compareVersions,
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
const briefingStore = localforage.createInstance({ name: 'ebgeo_briefings' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });

// ===== HELPER FUNCTIONS FOR INITIALIZATION =====

/**
 * Clears all legacy stores and resets schema version.
 */
async function clearLegacyStores() {
    await mapStore.clear();
    await imageStore.clear();
    await appStore.clear();
    await groupStore.clear();
    await layerStore.clear();
    await appStore.setItem('schemaVersion', SCHEMA_VERSION);
}

/**
 * Checks and cleans incompatible legacy data.
 */
async function checkAndCleanLegacyData() {
    try {
        const currentSchemaVersion = await appStore.getItem('schemaVersion');

        if (!currentSchemaVersion || compareVersions(currentSchemaVersion, MIN_SCHEMA_VERSION) < 0) {
            await clearLegacyStores();
        }
    } catch (error) {
        console.warn('Error checking schema version:', error);
        try {
            await clearLegacyStores();
        } catch (cleanupError) {
            console.error('Critical error cleaning data:', cleanupError);
        }
    }
}

// ===== LEGACY MIGRATION FUNCTIONS =====

/**
 * Runs a per-map migration function on all maps and logs progress.
 * @param {Function} migrateFn - async (mapName, mapData?) => boolean
 * @param {string} label - Log label for the migration version
 * @param {boolean} [needsData=true] - Whether the migration needs map data loaded
 */
async function runMigrationForAllMaps(migrateFn, label, needsData = true) {
    const mapNames = await mapStore.keys();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        if (needsData) {
            const mapData = await mapStore.getItem(mapName);
            if (mapData) {
                const wasMigrated = await migrateFn(mapName, mapData);
                if (wasMigrated) migratedCount++;
            }
        } else {
            const wasMigrated = await migrateFn(mapName);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to ${label}`);
    }
}

async function migrateMapTo14(mapName, mapData) {
    if (!mapData.features.coordination_measures) {
        mapData.features.coordination_measures = [];
        await mapStore.setItem(mapName, mapData);
        return true;
    }
    return false;
}

async function migrateMapTo15(mapName, mapData) {
    let modified = false;

    for (const featureType of Object.keys(mapData.features)) {
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
}

async function migrateMapTo16(mapName, mapData) {
    if (!mapData?.features) {
        return false;
    }

    let modified = false;

    for (const featureType of Object.keys(mapData.features)) {
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
}

async function migrateMapTo17(mapName) {
    const key = `cesium3d_${mapName}`;
    const existingData = await cesium3dStore.getItem(key);
    if (!existingData || existingData.cameraPositions === undefined || existingData.markers === undefined) {
        await cesium3dStore.setItem(key, getEmptyCesium3dData());
        return true;
    }
    return false;
}

/**
 * Ordered legacy migrations with their per-map functions and log labels.
 * Each entry: [migrateFn, label, needsData]
 */
const LEGACY_MIGRATIONS = [
    { version: '1.3', fn: migrateMapTo14, label: 'v1.4' },
    { version: '1.4', fn: migrateMapTo15, label: 'v1.5 (added layerId to features)' },
    { version: '1.5', fn: migrateMapTo16, label: 'v1.6 (added attributes and images to features)' },
    { version: '1.6', fn: migrateMapTo17, label: 'v1.7 (initialized cesium3d data)', needsData: false }
];

/**
 * Runs all applicable legacy migrations from the given schema version.
 * @param {string|null} currentVersion - Current schema version
 */
async function runLegacyMigrations(currentVersion) {
    if (!currentVersion) {
        await appStore.setItem('schemaVersion', SCHEMA_VERSION);
        return;
    }

    const startIndex = LEGACY_MIGRATIONS.findIndex(m => m.version === currentVersion);
    if (startIndex === -1) return;

    for (let i = startIndex; i < LEGACY_MIGRATIONS.length; i++) {
        const { fn, label, needsData } = LEGACY_MIGRATIONS[i];
        await runMigrationForAllMaps(fn, label, needsData !== false);
    }

    await appStore.setItem('schemaVersion', SCHEMA_VERSION);
}

// ===== INITIALIZATION =====

/**
 * Initializes the repository, runs migrations, and returns the last active map.
 * @returns {Promise<string>} Last active map name
 */
export async function initializeRepository() {
    try {
        await checkAndCleanLegacyData();

        const currentSchemaVersion = await appStore.getItem('schemaVersion');
        await runLegacyMigrations(currentSchemaVersion);

        // Run v2.0 migration if needed (adds Atlas, sync metadata, etc.)
        const { needed } = await detectMigrationNeeded();
        if (needed) {
            console.log('Running v2.0 migration...');
            const result = await safelyMigrate();
            if (result.success) {
                console.log('v2.0 migration completed successfully');
            } else {
                console.error('v2.0 migration failed:', result.error);
            }
        }

        const allMapNames = await mapStore.keys();
        if (allMapNames.length === 0) {
            const newMapData = getEmptyMapData();

            if (config.map2d?.hillshade?.enabled === true) {
                newMapData.catalogLayers = [{
                    id: 'hillshade',
                    type: 'hillshade',
                    name: config.map2d.hillshade.name || 'Sombreamento do Relevo',
                    visible: true,
                    opacity: 1,
                    status: 'active',
                    config: config.map2d.hillshade,
                    sync: createSyncMetadata(null)
                }];
            }

            await mapStore.setItem(DEFAULT_MAP_NAME, newMapData);
            memoryStore.currentMap = DEFAULT_MAP_NAME;
            return DEFAULT_MAP_NAME;
        }

        const lastActiveMap = await appStore.getItem('lastActiveMap');
        const activeMap = (lastActiveMap && allMapNames.includes(lastActiveMap))
            ? lastActiveMap
            : allMapNames[0];

        memoryStore.currentMap = activeMap;
        return activeMap;
    } catch (error) {
        console.error('Error initializing repository:', error);
        memoryStore.currentMap = DEFAULT_MAP_NAME;
        return DEFAULT_MAP_NAME;
    }
}

// ===== BULK CLEAR OPERATIONS =====

/**
 * Clears all map data.
 */
export async function clearAllMapData() {
    await mapStore.clear();
}

/**
 * Clears all image data.
 */
export async function clearAllImageData() {
    await imageStore.clear();
}

/**
 * Clears all group data.
 */
export async function clearAllGroupData() {
    await groupStore.clear();
}

/**
 * Clears all layer data.
 */
export async function clearAllLayerData() {
    await layerStore.clear();
}

/**
 * Clears all Cesium 3D data.
 */
export async function clearAllCesium3dData() {
    await cesium3dStore.clear();
}

/**
 * Clears all Street View 360 data.
 */
export async function clearAllStreetview360Data() {
    await streetview360Store.clear();
}

/**
 * Clears all briefing data.
 */
export async function clearAllBriefingData() {
    await briefingStore.clear();
}

/**
 * Clears the atlas record (`ebgeo_atlas`). The atlas holds atlas-level settings (e.g.
 * `terrainExaggeration`) that a remote atlas writes; clearing it on logout/switch prevents
 * those from surviving the session or leaking into another atlas (inv 2/3).
 */
export async function clearAllAtlasData() {
    await atlasStore.clear();
}

/**
 * Clears all app settings and associated per-map data.
 */
export async function clearAllAppSettings() {
    const allMaps = await mapStore.keys();
    for (const mapName of allMaps) {
        try {
            await Promise.all([
                appStore.removeItem(`color_usage_${mapName}`),
                appStore.removeItem(`map_notes_${mapName}`),
                appStore.removeItem(`gridStyle_${mapName}`),
                groupStore.removeItem(mapName),
                layerStore.removeItem(`layers_${mapName}`),
                layerStore.removeItem(`activeLayer_${mapName}`),
                cesium3dStore.removeItem(`cesium3d_${mapName}`),
                streetview360Store.removeItem(`streetview360_${mapName}`)
            ]);
        } catch (error) {
            console.warn(`Error clearing data for map ${mapName}:`, error);
        }
    }

    await appStore.clear();
}

// ===== APP SETTINGS (needed by store.js for setSchemaVersion) =====

/**
 * Sets an app setting.
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
export async function setAppSetting(key, value) {
    await appStore.setItem(key, value);
}

/**
 * Gets an app setting.
 * @param {string} key - Setting key
 * @returns {Promise<any>} Setting value
 */
export async function getAppSetting(key) {
    return appStore.getItem(key);
}

// ===== COLOR USAGE (needed by store.js for getColorUsage export) =====

/**
 * Gets color usage data for a map.
 * @param {string} mapName - Map name
 * @returns {Promise<Object>} Color usage data
 */
export async function getColorUsage(mapName) {
    const data = await appStore.getItem(`color_usage_${mapName}`);
    return data || {};
}

/**
 * Sets color usage data for a map.
 * @param {string} mapName - Map name
 * @param {Object} colorUsageData - Color usage data
 */
export async function setColorUsage(mapName, colorUsageData) {
    await appStore.setItem(`color_usage_${mapName}`, colorUsageData);
    // datamodel-13: sync this map's color usage to the atlas as a per-map nested
    // object ({ [mapName]: counts }). No-op offline; the backend deep-merges into
    // atlas.settings.colorUsage so a single-map write does not clobber sibling maps.
    await logAtlasSetting({ colorUsage: { [mapName]: colorUsageData } });
}

/**
 * Removes color usage data for a map.
 * @param {string} mapName - Map name
 */
export async function removeColorUsage(mapName) {
    await appStore.removeItem(`color_usage_${mapName}`);
}

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
import { ATLAS_SCHEMA_VERSION, createAtlas } from './atlas/atlas.entity.js';
import config from '../config.js';
import { createSyncMetadata } from './sync/sync-metadata.js';
import { DEFAULT_MAP_NAME } from './store.constants.js';
import { isValidId } from '../utilities/uuid.js';

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
 * Creates the atlas record if the scope has none.
 *
 * Nothing else in the application creates it: `LocalRepository.ensureAtlas` has no production
 * caller, and until this commit the ONLY path that seeded it on a fresh install was the side
 * effect of stamping the legacy '1.7' below, which sent the boot through the whole v1 -> v2.4
 * chain over an empty store just so `migrateToV2` would write the record on its way out.
 * Removing the '1.7' stamp removes that round trip, so the record is seeded here directly.
 *
 * It never overwrites an existing record: the record holds the terrain exaggeration, and a
 * scope that still has one is not a new repository.
 *
 * @returns {Promise<void>}
 */
async function ensureAtlasRecord() {
    const existing = await atlasStore.getItem('current_atlas');
    if (existing) return;
    await atlasStore.setItem('current_atlas', createAtlas());
}

/**
 * Clears all legacy stores and resets schema version.
 *
 * IN PARALLEL, and with `allSettled` rather than `all`: these are five independent IndexedDB
 * databases with no dependency between them, and the serial `await` queue paid five round trips
 * for an order nobody asked for. `all` is worse than serial here, because its first rejection
 * returns control while the other clears run unobserved, turning one error into unhandled
 * rejections and a silent partial wipe. With `allSettled` every clear is awaited and only then
 * is the first failure rethrown, so the caller still sees as a failure what failed.
 *
 * @returns {Promise<void>}
 * @throws {Error} The first clear failure, after every store has been attempted.
 */
async function clearLegacyStores() {
    const results = await Promise.allSettled([
        mapStore.clear(),
        imageStore.clear(),
        appStore.clear(),
        groupStore.clear(),
        layerStore.clear()
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;

    // A cleared store is a BRAND-NEW repository, and a new repository is born on the CURRENT
    // version, not on the legacy '1.7'. It is the same rule commit 2bd89de2 applied to "Limpar
    // Todos os Dados" (store.js), for the same reason: '1.7' in the settings makes the NEXT
    // deployment read a pre-Atlas repository and run `migrateToV2` over v2.x data, renumbering
    // every feature id and orphaning every blob keyed by the old ids.
    await ensureAtlasRecord();
    await appStore.setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
}

/**
 * Does the active scope hold anything a user would call theirs?
 *
 * BY KEYS, and only of the databases `clearLegacyStores` would empty: the question is whether
 * there is something to lose, not what it is. A read that throws answers YES, because "I could
 * not tell" must never be the reason a repository is destroyed.
 *
 * @returns {Promise<boolean>} True when any of the four data databases carries a key.
 */
async function scopeHoldsData() {
    try {
        const keySets = await Promise.all([
            mapStore.keys(),
            imageStore.keys(),
            groupStore.keys(),
            layerStore.keys()
        ]);
        return keySets.some((keys) => keys.length > 0);
    } catch (error) {
        console.error('Atlas boot: could not measure the scope; nothing will be erased', error);
        return true;
    }
}

/**
 * Checks and cleans incompatible legacy data.
 *
 * A READ THAT FAILS IS NOT A VERDICT ABOUT THE DATA, and treating it as one is what this
 * function used to do: the `catch` of `getItem('schemaVersion')` called `clearLegacyStores()`,
 * so any transient IndexedDB error (an `InvalidStateError` after another tab's `versionchange`,
 * an `UnknownError` from disk, a quota failure) emptied five databases and stamped a version
 * over the remains. Measured in vitest over a 14-map / 149-image production acervo: every map
 * and every blob gone, no line on screen, and `ebgeo_atlas` left describing an acervo that no
 * longer exists, which is what makes the NEXT boot look normal.
 *
 * AND ABSENCE OF THE MARKER IS NOT PROOF OF AGE EITHER. A missing `schemaVersion` means two
 * indistinguishable things (an installation older than the marker, which is empty, and a scope
 * whose marker was lost, which may be full), and the destructive reading was applied to both.
 * The question that separates them is about CONTENT, and it is cheap: `scopeHoldsData`.
 *
 * @returns {Promise<boolean>} Whether the marker read is TRUSTWORTHY, i.e. whether the caller
 *   may reason with what it finds in `schemaVersion` afterwards. False means "I do not know",
 *   and the legacy chain is skipped for this boot rather than run on a guess.
 */
async function checkAndCleanLegacyData() {
    let currentSchemaVersion = null;
    try {
        currentSchemaVersion = await appStore.getItem('schemaVersion');
    } catch (error) {
        console.error('Atlas boot: could not read the schema marker; nothing will be erased', error);
        return false;
    }

    if (currentSchemaVersion && compareVersions(currentSchemaVersion, MIN_SCHEMA_VERSION) >= 0) {
        return true;
    }

    if (await scopeHoldsData()) {
        console.error(
            `Atlas boot: schema marker ${currentSchemaVersion ?? 'absent'} over a scope WITH `
            + 'data; nothing will be erased and the legacy chain does not run on this boot'
        );
        return false;
    }

    await clearLegacyStores();
    return true;
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
 *
 * The null branch is NO LONGER REACHABLE FROM THE BOOT, and it must stay that way. It stamps
 * `SCHEMA_VERSION`, which is the legacy '1.7' and not the current version: a partial clear used
 * to leave the marker unwritten, the boot read null here, and this line wrote '1.7' over a v2.x
 * repository, which is the very state commit 2bd89de2 removed from "Limpar Todos os Dados", fabricated
 * by the boot itself. `initializeRepository` now calls this only with a marker it trusts, and a
 * trusted marker is never null (a cleared scope leaves the current version behind).
 *
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
        const markerTrustworthy = await checkAndCleanLegacyData();

        // THE LEGACY CHAIN ONLY RUNS OVER A MARKER THAT CAN BE TRUSTED. With the marker
        // unreadable, or absent over a scope that holds data, `runLegacyMigrations(null)` would
        // stamp the legacy '1.7' over a v2.x repository. What decides the version in that state
        // is `detectMigrationNeeded`, which also reads the atlas record.
        if (markerTrustworthy) {
            const currentSchemaVersion = await appStore.getItem('schemaVersion');
            await runLegacyMigrations(currentSchemaVersion);
        }

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

        if (markerTrustworthy) {
            await repairPlaceholderMapNames();
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
        return await emergencyEntryMap();
    }
}

/**
 * Which map the boot opens when initialization failed halfway.
 *
 * The `catch` returned `DEFAULT_MAP_NAME` ALWAYS, and in an acervo of 14 maps none of them is
 * called 'Principal': a quota failure while stamping a migration rung dropped the user inside a
 * map the acervo does not have, with the whole acervo on disk and nothing on screen. The error
 * is REAL and is still reported; what changes is that the entry is a map that EXISTS.
 *
 * A read that also fails falls back to the default map, which is the only name the repository
 * knows how to seed: there the ignorance is the state, not a guess.
 *
 * @returns {Promise<string>} Key of an existing map, or the default map.
 */
async function emergencyEntryMap() {
    try {
        const names = await mapStore.keys();
        if (names.length > 0) {
            const preferred = await appStore.getItem('lastActiveMap');
            const chosen = names.includes(preferred) ? preferred : names[0];
            memoryStore.currentMap = chosen;
            return chosen;
        }
    } catch (readError) {
        console.error('Atlas boot: could not choose an entry map:', readError);
    }
    memoryStore.currentMap = DEFAULT_MAP_NAME;
    return DEFAULT_MAP_NAME;
}

// ===== ONE-SHOT REPAIR OF THE PLACEHOLDER MAP NAME =====

/** Settings key that marks the placeholder-name repair as already done for this scope. */
const PLACEHOLDER_NAME_REPAIR_KEY = 'placeholderMapNameRepairDone';

/**
 * The placeholder name a brand-new map record carries.
 *
 * It comes from `getEmptyMapData()` in repositories/local.repository.js, which is a DIFFERENT
 * function from the same-named one this file imports out of repository.utils.js: that one has no
 * `name` field at all. Written as a literal rather than imported, so the boot does not pull the
 * repository layer into its module graph, and pinned by the test, which reads the real function.
 */
const PLACEHOLDER_MAP_NAME = 'Novo Mapa';

/**
 * Rewrites `data.name` from the storage key on maps left holding the placeholder.
 *
 * `createMapCompat` used to let `getEmptyMapData()`'s placeholder 'Novo Mapa' win over the name
 * the user asked for, because its guard only fired on a MISSING name. Every map created that way
 * carries the right KEY and the wrong FIELD. Inside this application that was cosmetic and inert
 * (maps are keyed by name, the `.ebgeo` export is keyed by name and does not carry the field),
 * which is why it survived; the field only bites where something PREFERS it to the key, and the
 * first such reader measured 2 maps and 33 features reaching a server out of 14 and 805.
 *
 * The guards are what make this safe to run on the user's records:
 * - only when the field IS the placeholder, so a name the user chose is never touched;
 * - only when the key DIFFERS from it, so a map the user really called 'Novo Mapa' is left alone;
 * - only when the key is not a generated id, because there the key is not a name;
 * - written straight to the store rather than through `saveMap`, so sync metadata is not touched
 *   and the repair does not enqueue 13 phantom operations;
 * - once per scope, behind a settings flag, so the full read of every map is paid on one boot;
 * - and inside its own try/catch, because a repair must never be the reason a boot fails.
 *
 * `MapResolver.initialize` is started by `initServices` and races with this, so on the repair boot
 * itself the resolver may still cache the placeholder for several maps, exactly as it does today;
 * from the next boot on it caches the real names. Nothing depends on the difference, because every
 * map is stored under its name and the direct key lookup answers first.
 *
 * @returns {Promise<number>} How many map records were rewritten.
 */
async function repairPlaceholderMapNames() {
    try {
        if (await appStore.getItem(PLACEHOLDER_NAME_REPAIR_KEY)) return 0;

        const keys = await mapStore.keys();
        let repaired = 0;

        for (const key of keys) {
            if (key === PLACEHOLDER_MAP_NAME || isValidId(key)) continue;
            const mapData = await mapStore.getItem(key);
            if (!mapData || mapData.name !== PLACEHOLDER_MAP_NAME) continue;
            await mapStore.setItem(key, { ...mapData, name: key });
            repaired++;
        }

        await appStore.setItem(PLACEHOLDER_NAME_REPAIR_KEY, true);
        if (repaired > 0) {
            console.log(`Repaired the placeholder name on ${repaired} map(s)`);
        }
        return repaired;
    } catch (error) {
        console.error('Atlas boot: could not repair the placeholder map names', error);
        return 0;
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
}

/**
 * Removes color usage data for a map.
 * @param {string} mapName - Map name
 */
export async function removeColorUsage(mapName) {
    await appStore.removeItem(`color_usage_${mapName}`);
}

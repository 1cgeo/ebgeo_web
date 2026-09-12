// Path: js/store/migration/legacy-backfills.js
import { StoreName, getStoreFor } from '../atlas-namespace.js';
import { SCHEMA_VERSION, getEmptyCesium3dData } from '../repository.utils.js';

// Explicit scope: preparing a copy must not mount it or overwrite this tab's boot pointer.
export async function runLegacyMigrations(currentVersion, scope) {
    const mapStore = () => getStoreFor(StoreName.MAPS, scope);
    const appStore = () => getStoreFor(StoreName.SETTINGS, scope);
    const cesium3dStore = () => getStoreFor(StoreName.CESIUM3D, scope);
    // ===== LEGACY MIGRATION FUNCTIONS =====

    /**
     * Runs a per-map migration function on all maps and logs progress.
     * @param {Function} migrateFn - async (mapName, mapData?) => boolean
     * @param {string} label - Log label for the migration version
     * @param {boolean} [needsData=true] - Whether the migration needs map data loaded
     */
    async function runMigrationForAllMaps(migrateFn, label, needsData = true) {
        const mapNames = await mapStore().keys();
        let migratedCount = 0;

        for (const mapName of mapNames) {
            if (needsData) {
                const mapData = await mapStore().getItem(mapName);
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
            await mapStore().setItem(mapName, mapData);
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
            await mapStore().setItem(mapName, mapData);
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
            await mapStore().setItem(mapName, mapData);
        }
        return modified;
    }

    async function migrateMapTo17(mapName) {
        const key = `cesium3d_${mapName}`;
        const existingData = await cesium3dStore().getItem(key);
        if (!existingData || existingData.cameraPositions === undefined || existingData.markers === undefined) {
            const empty = getEmptyCesium3dData();
            await cesium3dStore().setItem(key, {
                ...empty, ...existingData,
                cameraPositions: existingData?.cameraPositions ?? empty.cameraPositions,
                markers: existingData?.markers ?? empty.markers
            });
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
    async function run(currentVersion) {
        if (!currentVersion) {
            await appStore().setItem('schemaVersion', SCHEMA_VERSION);
            return;
        }

        const startIndex = LEGACY_MIGRATIONS.findIndex(m => m.version === currentVersion);
        if (startIndex === -1) return;

        for (let i = startIndex; i < LEGACY_MIGRATIONS.length; i++) {
            const { fn, label, needsData } = LEGACY_MIGRATIONS[i];
            await runMigrationForAllMaps(fn, label, needsData !== false);
        }

        await appStore().setItem('schemaVersion', SCHEMA_VERSION);
    }

    return run(currentVersion);
}

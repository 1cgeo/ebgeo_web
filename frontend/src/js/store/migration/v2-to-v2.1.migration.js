// Path: js/store/migration/v2-to-v2.1.migration.js

/**
 * @fileoverview Migration from v2.0 to v2.1.
 *
 * Adds sizeCreatedAtZoom default (10) to existing point features
 * so the new size zoom correction does not cause extreme scaling.
 */

import localforage from 'localforage';

/**
 * The version THIS step reaches — not the chain's final version.
 *
 * This used to stamp `ATLAS_SCHEMA_VERSION`, which worked only by accident while 2.1 was
 * one step from the end: the moment the constant moved to 2.3, this step started declaring
 * 2.3 having reached 2.1, and an interrupted chain (a closed tab, or a later step throwing
 * into the catch that `initializeRepository` swallows) marked the database fully migrated
 * forever, so `detectMigrationNeeded` compared 2.3 with 2.3 and the namespacing step never
 * ran, in silence. Same defect `v1-to-v2.migration.js` documents at length.
 */
const TARGET_VERSION = '2.1';

const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });

/** Default zoom reference for pre-existing points. */
const DEFAULT_SIZE_ZOOM = 10;

/**
 * Adds sizeCreatedAtZoom to point features that lack it.
 * @param {Object} features - Features object keyed by feature type
 * @returns {Object} Updated features
 */
function migratePointZoomProperties(features) {
    if (!features || typeof features !== 'object') {
        return features;
    }

    const points = features.points;
    if (!Array.isArray(points)) {
        return features;
    }

    let changed = false;
    for (const feature of points) {
        if (!feature?.properties) continue;
        if (!feature.properties.sizeCreatedAtZoom) {
            feature.properties.sizeCreatedAtZoom = DEFAULT_SIZE_ZOOM;
            changed = true;
        }
    }

    return changed ? { ...features, points } : features;
}

/**
 * Main migration function: v2.0 to v2.1.
 * @returns {Promise<{success: boolean}>}
 */
export async function migrateToV2_1() {
    console.log('Starting migration to v2.1...');

    const mapNames = await mapStore.keys();
    console.log(`Found ${mapNames.length} maps to migrate`);

    for (const mapName of mapNames) {
        const mapData = await mapStore.getItem(mapName);
        if (!mapData?.features) continue;

        const updatedFeatures = migratePointZoomProperties(mapData.features);
        if (updatedFeatures !== mapData.features) {
            await mapStore.setItem(mapName, { ...mapData, features: updatedFeatures });
            console.log(`Migrated point zoom properties in map: ${mapName}`);
        }
    }

    const atlas = await atlasStore.getItem('current_atlas');
    if (atlas) {
        atlas.schemaVersion = TARGET_VERSION;
        await atlasStore.setItem('current_atlas', atlas);
    }
    await appStore.setItem('schemaVersion', TARGET_VERSION);

    console.log('Migration to v2.1 complete');
    return { success: true };
}

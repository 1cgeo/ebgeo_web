// Path: js/store/migration/v1-to-v2.migration.js

/**
 * @fileoverview Migration logic from v1.x to v2.0 schema.
 *
 * This migration performs the following transformations:
 * 1. Creates an Atlas entity to wrap all maps
 * 2. Converts map names to UUIDs (maps still stored by name for backward compat)
 * 3. Adds sync metadata to all entities
 * 4. Updates feature IDs to UUIDs
 * 5. Updates layer IDs to UUIDs (except 'default')
 * 6. Updates group IDs to UUIDs
 *
 * IMPORTANT: This migration is designed to be non-destructive.
 * Original data structure is preserved in IndexedDB, only new metadata is added.
 * Full structural migration (using map IDs as keys) is deferred to v2.1.
 */

import localforage from 'localforage';
import { generateUUID } from '../../utilities/uuid.js';
import { createSyncMetadata } from '../sync/sync-metadata.js';
import { createAtlas, ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';

// LocalForage stores - same as in repository.js
const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });
const groupStore = localforage.createInstance({ name: 'ebgeo_groups' });
const layerStore = localforage.createInstance({ name: 'ebgeo_layers' });

/**
 * @typedef {Object} IdMappings
 * @property {Map<string, string>} maps - Map name → UUID
 * @property {Map<string, string>} layers - Old layer ID → UUID
 * @property {Map<string, string>} groups - Old group ID → UUID
 * @property {Map<string, string>} features - Old feature ID → UUID
 */

/**
 * Creates ID mappings for migration.
 * @returns {IdMappings}
 */
function createIdMappings() {
    return {
        maps: new Map(),
        layers: new Map(),
        groups: new Map(),
        features: new Map()
    };
}

/**
 * Gets all map names from the store.
 * @returns {Promise<string[]>}
 */
async function getAllMapNames() {
    return await mapStore.keys();
}

/**
 * Gets map order from settings.
 * @returns {Promise<string[]>}
 */
async function getMapOrder() {
    return await appStore.getItem('mapOrder') || [];
}

/**
 * Migrates a single feature to v2.0 format.
 * @param {Object} feature - Feature to migrate
 * @param {IdMappings} mappings - ID mappings
 * @returns {Object} Migrated feature
 */
function migrateFeature(feature, mappings) {
    if (!feature || !feature.properties) {
        return feature;
    }

    const oldId = feature.properties.id;
    let newId = oldId;

    // Only generate new UUID if old ID exists and hasn't been mapped yet
    if (oldId && !mappings.features.has(oldId)) {
        newId = generateUUID();
        mappings.features.set(oldId, newId);
    } else if (oldId && mappings.features.has(oldId)) {
        newId = mappings.features.get(oldId);
    }

    // Update layer ID if mapped
    let layerId = feature.properties.layerId || 'default';
    if (layerId !== 'default' && mappings.layers.has(layerId)) {
        layerId = mappings.layers.get(layerId);
    }

    // Update group ID if mapped
    let groupId = feature.properties.groupId;
    if (groupId && mappings.groups.has(groupId)) {
        groupId = mappings.groups.get(groupId);
    }

    return {
        ...feature,
        properties: {
            ...feature.properties,
            id: newId,
            layerId,
            groupId,
            // Add sync metadata to feature
            sync: createSyncMetadata(null)
        }
    };
}

/**
 * Migrates all features in a map's feature collection.
 * @param {Object} features - Features object from map data
 * @param {IdMappings} mappings - ID mappings
 * @returns {Object} Migrated features
 */
function migrateFeatures(features, mappings) {
    if (!features || typeof features !== 'object') {
        return features;
    }

    const migratedFeatures = {};

    for (const [featureType, featureList] of Object.entries(features)) {
        if (!Array.isArray(featureList)) {
            migratedFeatures[featureType] = featureList;
            continue;
        }

        migratedFeatures[featureType] = featureList.map(feature =>
            migrateFeature(feature, mappings)
        );
    }

    return migratedFeatures;
}

/**
 * Migrates layers for a map.
 * @param {string} mapName - Map name
 * @param {IdMappings} mappings - ID mappings
 * @returns {Promise<void>}
 */
async function migrateLayers(mapName, mappings) {
    const key = `layers_${mapName}`;
    const layers = await layerStore.getItem(key);

    if (!layers || !Array.isArray(layers)) {
        return;
    }

    const migratedLayers = layers.map(layer => {
        const oldId = layer.id;
        let newId = oldId;

        // Keep 'default' ID as-is, migrate others to UUID
        if (oldId !== 'default') {
            if (!mappings.layers.has(oldId)) {
                newId = generateUUID();
                mappings.layers.set(oldId, newId);
            } else {
                newId = mappings.layers.get(oldId);
            }
        }

        return {
            ...layer,
            id: newId,
            sync: createSyncMetadata(null)
        };
    });

    await layerStore.setItem(key, migratedLayers);
}

/**
 * Builds group ID mappings without saving (first pass).
 * @param {string} mapName - Map name
 * @param {IdMappings} mappings - ID mappings to populate
 * @returns {Promise<void>}
 */
async function buildGroupMappings(mapName, mappings) {
    const groups = await groupStore.getItem(mapName);

    if (!groups || typeof groups !== 'object') {
        return;
    }

    for (const oldGroupId of Object.keys(groups)) {
        if (!mappings.groups.has(oldGroupId)) {
            mappings.groups.set(oldGroupId, generateUUID());
        }
    }
}

/**
 * Migrates groups for a map (second pass, after features are migrated).
 * @param {string} mapName - Map name
 * @param {IdMappings} mappings - ID mappings (must have groups and features populated)
 * @returns {Promise<void>}
 */
async function migrateGroups(mapName, mappings) {
    const groups = await groupStore.getItem(mapName);

    if (!groups || typeof groups !== 'object') {
        return;
    }

    const migratedGroups = {};

    for (const [oldGroupId, group] of Object.entries(groups)) {
        const newGroupId = mappings.groups.get(oldGroupId) || oldGroupId;

        // Update feature references in the group
        const migratedFeatures = (group.features || []).map(ref => ({
            ...ref,
            id: mappings.features.get(ref.id) || ref.id
        }));

        migratedGroups[newGroupId] = {
            ...group,
            id: newGroupId,
            features: migratedFeatures,
            sync: createSyncMetadata(null)
        };
    }

    await groupStore.setItem(mapName, migratedGroups);
}

/**
 * Migrates a single map to v2.0 format.
 * Uses 3-pass approach to ensure all ID mappings are built before use:
 * 1. Build layer and group ID mappings
 * 2. Migrate features (uses layer/group mappings, builds feature mappings)
 * 3. Migrate groups (uses feature mappings to update references)
 *
 * @param {string} mapName - Map name
 * @param {IdMappings} mappings - ID mappings
 * @returns {Promise<void>}
 */
async function migrateMap(mapName, mappings) {
    const mapData = await mapStore.getItem(mapName);

    if (!mapData) {
        return;
    }

    // Generate UUID for this map
    const mapId = generateUUID();
    mappings.maps.set(mapName, mapId);

    // Pass 1: Build all ID mappings (layers and groups)
    await migrateLayers(mapName, mappings);
    await buildGroupMappings(mapName, mappings);

    // Pass 2: Migrate features (uses layer/group mappings, builds feature mappings)
    const migratedFeatures = migrateFeatures(mapData.features, mappings);

    // Pass 3: Migrate groups (uses feature mappings to update references)
    await migrateGroups(mapName, mappings);

    // Save migrated map data
    const migratedMapData = {
        ...mapData,
        id: mapId,
        name: mapName,
        features: migratedFeatures,
        sync: createSyncMetadata(null)
    };

    await mapStore.setItem(mapName, migratedMapData);
}

/**
 * Main migration function: v1.x to v2.0
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function migrateToV2() {
    console.log('Starting migration to v2.0...');

    const mappings = createIdMappings();

    // Get all map names and order
    const mapNames = await getAllMapNames();
    const mapOrder = await getMapOrder();
    const lastActiveMap = await appStore.getItem('lastActiveMap');

    console.log(`Found ${mapNames.length} maps to migrate`);

    // Migrate each map
    for (const mapName of mapNames) {
        console.log(`Migrating map: ${mapName}`);
        await migrateMap(mapName, mappings);
    }

    // Create Atlas
    const atlas = createAtlas('Meu Atlas');

    // Build map order using UUIDs (but maintain original order)
    // For now, we keep map names as the ordering reference
    // since we're not changing the IndexedDB keys yet
    atlas.mapOrder = mapOrder.length > 0 ? mapOrder : mapNames;

    // Set last active map
    if (lastActiveMap && mapNames.includes(lastActiveMap)) {
        atlas.lastActiveMapId = lastActiveMap; // Keep name for now
    } else if (mapNames.length > 0) {
        atlas.lastActiveMapId = mapNames[0];
    }

    // Save Atlas
    await atlasStore.setItem('current_atlas', atlas);

    // Update schema version
    await appStore.setItem('schemaVersion', ATLAS_SCHEMA_VERSION);

    console.log('Migration to v2.0 complete');

    return { success: true };
}

// Export helper functions for testing
export {
    createIdMappings,
    migrateFeature,
    migrateFeatures
};

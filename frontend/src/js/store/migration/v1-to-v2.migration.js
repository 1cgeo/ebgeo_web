// Path: js/store/migration/v1-to-v2.migration.js

/**
 * @fileoverview Migration logic from v1.x to v2.0 schema.
 *
 * Transforms:
 * 1. Creates an Atlas entity to wrap all maps
 * 2. Converts map names to UUIDs (maps still stored by name for backward compat)
 * 3. Adds sync metadata to all entities
 * 4. Updates feature, layer (except 'default'), and group IDs to UUIDs
 *
 * Non-destructive: original IndexedDB structure is preserved, only new metadata
 * is added. Full structural migration (map IDs as keys) deferred to v2.1.
 */

import localforage from 'localforage';
import { generateUUID } from '../../utilities/uuid.js';
import { createSyncMetadata } from '../sync/sync-metadata.js';
import { createAtlas, ATLAS_SCHEMA_VERSION } from '../atlas/atlas.entity.js';

const atlasStore = localforage.createInstance({ name: 'ebgeo_atlas' });
const mapStore = localforage.createInstance({ name: 'ebgeo_maps' });
const appStore = localforage.createInstance({ name: 'ebgeo_app_settings' });
const groupStore = localforage.createInstance({ name: 'ebgeo_groups' });
const layerStore = localforage.createInstance({ name: 'ebgeo_layers' });

/**
 * @typedef {Object} IdMappings
 * @property {Map<string, string>} maps - Map name -> UUID
 * @property {Map<string, string>} layers - Old layer ID -> UUID
 * @property {Map<string, string>} groups - Old group ID -> UUID
 * @property {Map<string, string>} features - Old feature ID -> UUID
 */

/**
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
 * Resolves an old ID to a new UUID. If the old ID has already been mapped,
 * returns the existing UUID. Otherwise generates a new UUID and stores it.
 * @param {Map<string, string>} mapping - ID mapping to use
 * @param {string} oldId - Original ID to resolve
 * @returns {string} Resolved UUID
 */
function resolveId(mapping, oldId) {
    if (mapping.has(oldId)) {
        return mapping.get(oldId);
    }
    const newId = generateUUID();
    mapping.set(oldId, newId);
    return newId;
}

/**
 * Migrates a single feature to v2.0 format.
 * @param {Object} feature
 * @param {IdMappings} mappings
 * @returns {Object} Migrated feature
 */
function migrateFeature(feature, mappings) {
    if (!feature || !feature.properties) {
        return feature;
    }

    const { id: oldId, layerId: rawLayerId, groupId: rawGroupId } = feature.properties;

    const id = oldId ? resolveId(mappings.features, oldId) : oldId;

    const layerId = (rawLayerId || 'default') !== 'default' && mappings.layers.has(rawLayerId)
        ? mappings.layers.get(rawLayerId)
        : rawLayerId || 'default';

    const groupId = rawGroupId && mappings.groups.has(rawGroupId)
        ? mappings.groups.get(rawGroupId)
        : rawGroupId;

    return {
        ...feature,
        properties: {
            ...feature.properties,
            id,
            layerId,
            groupId,
            sync: createSyncMetadata()
        }
    };
}

/**
 * Migrates all features in a map's feature collection.
 * @param {Object} features - Features object keyed by feature type
 * @param {IdMappings} mappings
 * @returns {Object} Migrated features
 */
function migrateFeatures(features, mappings) {
    if (!features || typeof features !== 'object') {
        return features;
    }

    const migrated = {};
    for (const [featureType, featureList] of Object.entries(features)) {
        migrated[featureType] = Array.isArray(featureList)
            ? featureList.map(f => migrateFeature(f, mappings))
            : featureList;
    }
    return migrated;
}

/**
 * Migrates layers for a map: assigns UUIDs and adds sync metadata.
 * @param {string} mapName
 * @param {IdMappings} mappings
 * @returns {Promise<void>}
 */
async function migrateLayers(mapName, mappings) {
    const key = `layers_${mapName}`;
    const layers = await layerStore.getItem(key);

    if (!Array.isArray(layers)) {
        return;
    }

    const migrated = layers.map(layer => ({
        ...layer,
        id: layer.id === 'default' ? 'default' : resolveId(mappings.layers, layer.id),
        sync: createSyncMetadata()
    }));

    await layerStore.setItem(key, migrated);
}

/**
 * Builds group ID mappings without persisting (first pass).
 * @param {string} mapName
 * @param {IdMappings} mappings
 * @returns {Promise<void>}
 */
async function buildGroupMappings(mapName, mappings) {
    const groups = await groupStore.getItem(mapName);

    if (!groups || typeof groups !== 'object') {
        return;
    }

    for (const oldGroupId of Object.keys(groups)) {
        resolveId(mappings.groups, oldGroupId);
    }
}

/**
 * Migrates groups (second pass, after features are migrated).
 * Updates group IDs and feature references within each group.
 * @param {string} mapName
 * @param {IdMappings} mappings - Must have groups and features populated
 * @returns {Promise<void>}
 */
async function migrateGroups(mapName, mappings) {
    const groups = await groupStore.getItem(mapName);

    if (!groups || typeof groups !== 'object') {
        return;
    }

    const migrated = {};
    for (const [oldGroupId, group] of Object.entries(groups)) {
        const newGroupId = mappings.groups.get(oldGroupId) || oldGroupId;
        const features = (group.features || []).map(ref => ({
            ...ref,
            id: mappings.features.get(ref.id) || ref.id
        }));

        migrated[newGroupId] = {
            ...group,
            id: newGroupId,
            features,
            sync: createSyncMetadata()
        };
    }

    await groupStore.setItem(mapName, migrated);
}

/**
 * Migrates a single map using a 3-pass approach:
 * 1. Build layer and group ID mappings
 * 2. Migrate features (consumes layer/group mappings, builds feature mappings)
 * 3. Migrate groups (consumes feature mappings to update references)
 * @param {string} mapName
 * @param {IdMappings} mappings
 * @returns {Promise<void>}
 */
async function migrateMap(mapName, mappings) {
    const mapData = await mapStore.getItem(mapName);
    if (!mapData) {
        return;
    }

    const mapId = generateUUID();
    mappings.maps.set(mapName, mapId);

    await migrateLayers(mapName, mappings);
    await buildGroupMappings(mapName, mappings);

    const features = migrateFeatures(mapData.features, mappings);

    await migrateGroups(mapName, mappings);

    await mapStore.setItem(mapName, {
        ...mapData,
        id: mapId,
        name: mapName,
        features,
        sync: createSyncMetadata()
    });
}

/**
 * Main migration function: v1.x to v2.0.
 * @returns {Promise<{success: boolean}>}
 */
export async function migrateToV2() {
    console.log('Starting migration to v2.0...');

    const mappings = createIdMappings();
    const mapNames = await mapStore.keys();
    const mapOrder = await appStore.getItem('mapOrder') || [];
    const lastActiveMap = await appStore.getItem('lastActiveMap');

    console.log(`Found ${mapNames.length} maps to migrate`);

    for (const mapName of mapNames) {
        console.log(`Migrating map: ${mapName}`);
        await migrateMap(mapName, mappings);
    }

    const atlas = createAtlas('Meu Atlas');
    atlas.mapOrder = mapOrder.length > 0 ? mapOrder : mapNames;

    if (lastActiveMap && mapNames.includes(lastActiveMap)) {
        atlas.lastActiveMapId = lastActiveMap;
    } else if (mapNames.length > 0) {
        atlas.lastActiveMapId = mapNames[0];
    }

    await atlasStore.setItem('current_atlas', atlas);
    await appStore.setItem('schemaVersion', ATLAS_SCHEMA_VERSION);

    console.log('Migration to v2.0 complete');
    return { success: true };
}

export {
    createIdMappings,
    migrateFeature,
    migrateFeatures
};

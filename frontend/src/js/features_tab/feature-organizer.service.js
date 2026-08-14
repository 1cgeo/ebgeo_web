// Path: js/features_tab/feature-organizer.service.js

/**
 * @fileoverview Service for organizing features by layers and groups.
 */

import {
    getMapGroups,
    getFeatureGroup,
    getCurrentMapNameSync,
    getAllStorageTypes,
    getLayers,
    getActiveLayerIdSync,
    getSourceTypeFromStorage,
} from '@store';
import { FEATURE_SOURCES, getFeatureDisplayName } from './features_tab.constants.js';

/**
 * @typedef {Object} FlatFeature
 * @property {string} id - Feature ID
 * @property {string} name - Feature name
 * @property {boolean} visible - Visibility state
 * @property {boolean} locked - Lock state
 * @property {Object} rawFeature - Original GeoJSON feature
 * @property {string} storageType - Storage type (e.g., 'points', 'lines')
 * @property {string} typeLabel - Display label for the type
 */

/**
 * @typedef {Object} GroupData
 * @property {Object} groupData - Group metadata
 * @property {FlatFeature[]} features - Features in group
 * @property {number} totalInGroup - Total features in group
 */

/**
 * @typedef {Object} LayerData
 * @property {Object} layer - Layer object
 * @property {boolean} isActive - Whether layer is active
 * @property {Map<string, GroupData>} groups - Groups in layer
 * @property {FlatFeature[]} ungrouped - Ungrouped features
 * @property {number} featureCount - Total feature count
 */

/**
 * Gets features directly from map sources.
 * @param {Object} map - MapLibre map instance
 * @param {string[]} [featureSources=FEATURE_SOURCES] - Array of source IDs
 * @returns {Promise<Object<string, Object[]>>} Features organized by source type
 */
export async function getFeaturesFromMapSources(map, featureSources = FEATURE_SOURCES) {
    const features = {};

    for (const sourceId of featureSources) {
        features[sourceId] = [];

        const source = map.getSource(sourceId);
        if (!source) continue;

        try {
            const data = await source.getData();
            if (data && data.features) {
                features[sourceId] = data.features;
            }
        } catch (error) {
            console.debug(`Could not get data from source ${sourceId}:`, error.message);
        }
    }

    return features;
}

/**
 * Flattens and sorts features from all sources.
 * @param {Object<string, Object[]>} features - Features organized by source type
 * @returns {FlatFeature[]} Flat sorted array of features
 */
export function flattenAndSortFeatures(features) {
    const flatFeatures = [];
    const validStorageTypes = getAllStorageTypes();

    Object.entries(features).forEach(([storageType, featureArray]) => {
        if (!validStorageTypes.includes(storageType)) {
            return;
        }
        if (featureArray.length > 0) {
            featureArray.forEach((feature) => {
                flatFeatures.push({
                    id: feature.properties.id,
                    name: feature.properties.nome || 'Sem nome',
                    visible: feature.properties.visivel ?? true,
                    locked: feature.properties.bloqueado ?? false,
                    rawFeature: feature,
                    storageType: storageType,
                    typeLabel: getFeatureDisplayName(storageType),
                });
            });
        }
    });

    flatFeatures.sort((a, b) => {
        const typeCompare = a.typeLabel.localeCompare(b.typeLabel, 'pt-BR');
        if (typeCompare !== 0) return typeCompare;
        return a.name.localeCompare(b.name, 'pt-BR');
    });

    return flatFeatures;
}

/**
 * Organizes features by layers and groups.
 * @param {Object<string, Object[]>} features - Features organized by source type
 * @returns {Promise<LayerData[]>} Organized layer data sorted by order
 */
export async function organizeFeaturesByLayers(features) {
    const currentMapName = getCurrentMapNameSync();
    const groups = getMapGroups(currentMapName);
    const layers = await getLayers();
    const activeLayerId = getActiveLayerIdSync();

    const flatFeatures = flattenAndSortFeatures(features);

    /** @type {Object<string, LayerData>} */
    const layerData = {};

    // Initialize layer data structure
    layers.forEach((layer) => {
        layerData[layer.id] = {
            layer: layer,
            isActive: layer.id === activeLayerId,
            groups: new Map(),
            ungrouped: [],
            featureCount: 0,
        };
    });

    // Pre-calculate group totals. `getMapGroups` returns a PLAIN OBJECT, so the old
    // `groups instanceof Map` branch never ran and every total fell back to 0.
    const groupTotals = new Map();
    for (const [groupId, group] of Object.entries(groups || {})) {
        groupTotals.set(groupId, group?.features?.length || 0);
    }

    // Distribute features to layers and groups
    flatFeatures.forEach((feature) => {
        const layerId = feature.rawFeature?.properties?.layerId || 'default';
        // Canonical reverse lookup, NOT a plural-stripping heuristic: 'setores',
        // 'brushes' and 'los' would become 'setore', 'brushe' and 'lo', which never
        // match the `type` groups store (`properties.source`, already singular).
        const sourceType = getSourceTypeFromStorage(feature.storageType);
        const group = getFeatureGroup(sourceType, feature.id, currentMapName);

        // Handle missing layer (use first layer as fallback)
        let targetLayerId = layerId;
        if (!layerData[layerId]) {
            targetLayerId = layers.length > 0 ? layers[0].id : null;
            if (!targetLayerId || !layerData[targetLayerId]) {
                return;
            }
        }

        const targetLayer = layerData[targetLayerId];
        targetLayer.featureCount++;

        if (group) {
            if (!targetLayer.groups.has(group.id)) {
                targetLayer.groups.set(group.id, {
                    groupData: group,
                    features: [],
                    totalInGroup: groupTotals.get(group.id) || group.features?.length || 0,
                });
            }
            targetLayer.groups.get(group.id).features.push(feature);
        } else {
            targetLayer.ungrouped.push(feature);
        }
    });

    // Sort layers by order
    const sortedLayers = Object.values(layerData).sort((a, b) => {
        const orderA = a.layer.order ?? 999;
        const orderB = b.layer.order ?? 999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.layer.name || '').localeCompare(b.layer.name || '', 'pt-BR');
    });

    return sortedLayers;
}

/**
 * Counts total features across all sources.
 * @param {Object<string, Object[]>} features - Features organized by source type
 * @returns {number} Total feature count
 */
export function countTotalFeatures(features) {
    return Object.values(features).reduce((sum, arr) => sum + arr.length, 0);
}

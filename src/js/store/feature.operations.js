// Path: js/store/feature.operations.js

/**
 * @fileoverview Feature CRUD operations.
 */

import { cleanFeature } from './repository.utils.js';
import { getMapDataCompat, updateMapDataCompat, getLayersCompat } from './repositories/index.js';
import { FEATURE_TYPE_MAPPINGS, getAllStorageTypes, getStorageTypeFromSource } from './store.constants.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import { logFeatureOperation, OperationType } from './sync/index.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { runTransaction } from './store-transaction.js';
import { deepClone, deepEqual } from '../utilities/deep-utils.js';

// ===== TIMESTAMP AND VERSION HELPERS =====

/**
 * Adds createdAt timestamp and initial version to a new feature.
 * @param {Object} feature - Feature to timestamp
 * @returns {Object} Feature with createdAt, updatedAt, and version in properties
 */
const addCreatedTimestamp = (feature) => {
    if (!feature || !feature.properties) return feature;
    if (!feature.properties.createdAt) {
        feature.properties.createdAt = Date.now();
    }
    if (!feature.properties.updatedAt) {
        feature.properties.updatedAt = feature.properties.createdAt;
    }
    // Initialize version for new features
    if (feature.properties.version === undefined) {
        feature.properties.version = 1;
    }
    return feature;
};

/**
 * Updates the updatedAt timestamp and increments version on a feature.
 * @param {Object} feature - Feature to update
 * @returns {Object} Feature with updated timestamp and version
 */
const touchUpdatedTimestamp = (feature) => {
    if (!feature || !feature.properties) return feature;
    feature.properties.updatedAt = Date.now();
    // Increment version on update
    feature.properties.version = (feature.properties.version || 0) + 1;
    return feature;
};

/**
 * Compares two features ignoring auto-managed metadata (updatedAt, version).
 * Used to detect no-op updates before touching timestamps.
 * @param {Object} a - First feature (stored)
 * @param {Object} b - Second feature (incoming, after cleanFeature + preserve)
 * @returns {boolean} True if features are equivalent
 */
function isFeatureEqual(a, b) {
    if (!deepEqual(a.geometry, b.geometry)) return false;

    const propsA = { ...a.properties };
    const propsB = { ...b.properties };
    delete propsA.updatedAt;
    delete propsB.updatedAt;
    delete propsA.version;
    delete propsB.version;

    return deepEqual(propsA, propsB);
}

// Alias for backward compatibility during migration
const getMapData = getMapDataCompat;
const updateMapData = updateMapDataCompat;
const getLayersRepo = getLayersCompat;

// ===== DEPENDENCY INJECTION =====

/** @type {import('./store.types.js').StoreDependencies} */
const deps = { eventBus: null, groupManager: null, layerManager: null };

/**
 * Sets dependencies for feature operations.
 * @param {import('./store.types.js').StoreDependencies} dependencies
 */
export function setFeatureDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== INTERNAL HELPERS =====

const getFeatureType = (feature) => {
    const source = feature.properties?.source;
    return FEATURE_TYPE_MAPPINGS[source];
};

const findRelatedProcessedFeatures = (type, featureId, mapData) => {
    if (type === 'los') {
        return mapData.features.processed_los.filter(pf =>
            pf.properties.id.startsWith(featureId + '-')
        );
    } else if (type === 'visibility') {
        return mapData.features.processed_visibility.filter(pf =>
            pf.properties.id.startsWith(featureId + '-')
        );
    }
    return [];
};

const removeProcessedFeaturesFromData = (processedType, processedFeatures, mapData) => {
    if (!processedType || !processedFeatures.length) return;
    const processedIds = new Set(processedFeatures.map(pf => pf.properties.id));
    mapData.features[processedType] = mapData.features[processedType]
        .filter(pf => !processedIds.has(pf.properties.id));
};

// ===== CRUD OPERATIONS =====

/**
 * Adds a new feature to a map.
 * @param {string} type - Storage type (e.g., 'points')
 * @param {Object} feature - GeoJSON feature to add
 * @param {string} [mapName=null] - Target map name
 */
export const addFeature = async (type, feature, mapName = null) => {
    const perm = checkPermission(GuardAction.CREATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'addFeature', reason: perm.reason });
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    if (memoryStore.lockedMaps.has(targetMap)) {
        console.warn('Map is locked. Cannot add feature.');
        return;
    }

    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignored after cleanup:', feature);
        return;
    }

    addCreatedTimestamp(cleanedFeature);

    await runTransaction(async (tx) => {
        const currentMapData = await getMapData(targetMap);
        currentMapData.features[type].push(cleanedFeature);

        // Defer color tracking until persistence succeeds
        const colors = mapManager.getFeatureColors(cleanedFeature);
        tx.deferSync(() => {
            for (const color of colors) {
                mapManager.updateColorUsage(null, color, targetMap);
            }
        });

        // Defer undo recording
        if (!mapName || mapName === mapManager.getCurrentMapName()) {
            tx.deferSync(() => {
                mapManager.recordAction({
                    type: 'add',
                    featureType: type,
                    feature: deepClone(cleanedFeature)
                });
            });
        }

        // Defer sync logging
        tx.deferAsync(() => {
            const mapId = mapManager.getCurrentMapId();
            return logFeatureOperation(OperationType.CREATE, cleanedFeature.properties.id, mapId, cleanedFeature);
        });

        return () => updateMapData(targetMap, currentMapData);
    });
};

/**
 * Updates an existing feature.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature with updated properties
 * @param {string} [mapName=null] - Target map name
 */
export const updateFeature = async (type, feature, mapName = null) => {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'updateFeature', reason: perm.reason });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update feature.');
        return;
    }

    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignored after cleanup:', feature);
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const index = currentMapData.features[type].findIndex(f => f.properties.id === cleanedFeature.properties.id);

    if (index !== -1) {
        const oldFeature = currentMapData.features[type][index];

        // Compute color diff before mutation but defer the actual update
        const oldColor = mapManager.getFeatureColor(oldFeature);

        // Preserve user data (images, attributes, descricao) from the stored feature
        // These are managed separately by userDataManager and should not be overwritten
        // by updates from the MapLibre source (which doesn't have these properties)
        const oldImages = oldFeature.properties.images;
        const newImages = cleanedFeature.properties.images;
        if (Array.isArray(oldImages) && oldImages.length > 0 &&
            (!Array.isArray(newImages) || newImages.length === 0)) {
            cleanedFeature.properties.images = oldImages;
        }

        const oldAttributes = oldFeature.properties.attributes;
        const newAttributes = cleanedFeature.properties.attributes;
        if (oldAttributes && Object.keys(oldAttributes).length > 0 &&
            (!newAttributes || Object.keys(newAttributes).length === 0)) {
            cleanedFeature.properties.attributes = oldAttributes;
        }

        // Preserve description (descricao) from the stored feature
        const oldDescricao = oldFeature.properties.descricao;
        const newDescricao = cleanedFeature.properties.descricao;
        if (oldDescricao && !newDescricao) {
            cleanedFeature.properties.descricao = oldDescricao;
        }

        // Preserve createdAt and version from old feature, then update
        if (oldFeature.properties.createdAt) {
            cleanedFeature.properties.createdAt = oldFeature.properties.createdAt;
        }
        if (oldFeature.properties.version !== undefined) {
            cleanedFeature.properties.version = oldFeature.properties.version;
        }
        // Skip no-op updates (compare before touching timestamps)
        if (isFeatureEqual(oldFeature, cleanedFeature)) return;

        touchUpdatedTimestamp(cleanedFeature);

        await runTransaction(async (tx) => {
            currentMapData.features[type][index] = cleanedFeature;

            // Defer color tracking until persistence succeeds
            const newColor = mapManager.getFeatureColor(cleanedFeature);
            if (oldColor !== newColor) {
                tx.deferSync(() => mapManager.updateColorUsage(oldColor, newColor, targetMap));
            }

            // Defer undo recording
            if (!mapName || mapName === mapManager.getCurrentMapName()) {
                tx.deferSync(() => {
                    mapManager.recordAction({
                        type: 'update',
                        featureType: type,
                        oldFeature: deepClone(oldFeature),
                        newFeature: deepClone(cleanedFeature)
                    });
                });
            }

            // Defer sync logging
            tx.deferAsync(() => {
                const mapId = mapManager.getCurrentMapId();
                return logFeatureOperation(OperationType.UPDATE, cleanedFeature.properties.id, mapId, cleanedFeature, oldFeature);
            });

            return () => updateMapData(targetMap, currentMapData);
        });
    }
};

/**
 * Removes a feature from a map.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID to remove
 * @param {string} [mapName=null] - Target map name
 */
export const removeFeature = async (type, id, mapName = null) => {
    const perm = checkPermission(GuardAction.DELETE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'removeFeature', reason: perm.reason });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot remove feature.');
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id === id);

    if (featureIndex === -1) return;

    // Prepare data mutations before transaction
    const mainFeature = currentMapData.features[type].splice(featureIndex, 1)[0];
    const processedFeatures = findRelatedProcessedFeatures(type, id, currentMapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, currentMapData);
    }

    await runTransaction(async (tx) => {
        // Defer color cleanup
        const color = mapManager.getFeatureColor(mainFeature);
        if (color) {
            tx.deferSync(() => mapManager.updateColorUsage(color, null, targetMap));
        }

        // Defer group cleanup (runs after persistence — if persistence fails, groups stay intact)
        tx.deferSync(() => {
            deps.groupManager.removeFeatureFromAllGroups(mainFeature.properties.source, id, targetMap);
        });

        // Defer undo recording
        if (!mapName || mapName === mapManager.getCurrentMapName()) {
            tx.deferSync(() => {
                mapManager.recordAction({
                    type: 'removeWithProcessed',
                    mainFeatureType: type,
                    mainFeature: deepClone(mainFeature),
                    processedFeatures: processedFeatures.length > 0 ? {
                        type: processedType,
                        features: deepClone(processedFeatures)
                    } : null
                });
            });
        }

        // Defer sync logging
        tx.deferAsync(() => {
            const mapId = mapManager.getCurrentMapId();
            return logFeatureOperation(OperationType.DELETE, id, mapId, null, mainFeature);
        });

        return () => updateMapData(targetMap, currentMapData);
    });
};

/**
 * Adds a feature to a specific map.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature to add
 * @param {string} mapName - Target map name
 */
export const addFeatureToMap = async (type, feature, mapName) => {
    return await addFeature(type, feature, mapName);
};

/**
 * Removes a feature from a specific map and returns removed data.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID
 * @param {string} mapName - Target map name
 * @returns {Promise<Object|null>} Removed feature data
 */
export const removeFeatureFromMap = async (type, id, mapName) => {
    const mapData = await getMapData(mapName);
    const featureIndex = mapData.features[type].findIndex(f => f.properties.id === id);
    if (featureIndex === -1) return null;

    // Prepare data mutations before transaction
    const mainFeature = mapData.features[type].splice(featureIndex, 1)[0];
    const processedFeatures = findRelatedProcessedFeatures(type, id, mapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, mapData);
    }

    const result = {
        mainFeature,
        processedFeatures: processedFeatures.length > 0 ? {
            type: processedType,
            features: processedFeatures
        } : null
    };

    await runTransaction(async (tx) => {
        const color = mapManager.getFeatureColor(mainFeature);
        if (color) {
            tx.deferSync(() => mapManager.updateColorUsage(color, null, mapName));
        }

        tx.deferSync(() => {
            deps.groupManager.removeFeatureFromAllGroups(mainFeature.properties.source, id, mapName);
        });

        return () => updateMapData(mapName, mapData);
    });

    return result;
};

/**
 * Adds a feature without recording undo action.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature to add
 * @param {string} [mapName=null] - Target map name
 */
export const addFeatureSilent = async (type, feature, mapName = null) => {
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) return;

    // Add creation timestamp
    addCreatedTimestamp(cleanedFeature);

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    currentMapData.features[type].push(cleanedFeature);
    await updateMapData(targetMap, currentMapData);
};

/**
 * Removes a feature without recording undo action.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID
 * @param {string} [mapName=null] - Target map name
 */
export const removeFeatureSilent = async (type, id, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id === id);
    if (featureIndex !== -1) {
        currentMapData.features[type].splice(featureIndex, 1);
        await updateMapData(targetMap, currentMapData);
    }
};

/**
 * Adds multiple features at once.
 * @param {Object<string, Array>} featuresMap - Map of type to features array
 * @param {string} [mapName=null] - Target map name
 */
export const addFeatures = async (featuresMap, mapName = null) => {
    const perm = checkPermission(GuardAction.CREATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'addFeatures', reason: perm.reason });
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    if (memoryStore.lockedMaps.has(targetMap)) {
        console.warn('Map is locked. Cannot add features.');
        return;
    }

    const currentMapData = await getMapData(targetMap);
    const action = { type: 'addMultiple', features: {} };

    // Collect all cleaned features per type for deferred color tracking
    const colorDeferrals = [];

    Object.keys(featuresMap).forEach(type => {
        const features = featuresMap[type] || [];
        if (features.length > 0) {
            const cleanedFeatures = features.map(cleanFeature).filter(Boolean);
            cleanedFeatures.forEach(addCreatedTimestamp);
            currentMapData.features[type].push(...cleanedFeatures);
            action.features[type] = deepClone(cleanedFeatures);

            // Collect color updates for deferral
            cleanedFeatures.forEach(feature => {
                const color = mapManager.getFeatureColor(feature);
                if (color) {
                    colorDeferrals.push(color);
                }
            });
        }
    });

    await runTransaction(async (tx) => {
        // Defer color tracking until persistence succeeds
        if (colorDeferrals.length > 0) {
            tx.deferSync(() => {
                for (const color of colorDeferrals) {
                    mapManager.updateColorUsage(null, color, targetMap);
                }
            });
        }

        // Defer undo recording
        if (Object.keys(action.features).length > 0 && (!mapName || mapName === mapManager.getCurrentMapName())) {
            tx.deferSync(() => mapManager.recordAction(action));
        }

        return () => updateMapData(targetMap, currentMapData);
    });
};

// ===== READ OPERATIONS =====

/**
 * Gets all features from a map.
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object>} Features collection
 */
export const getCurrentMapFeatures = async (mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    return deepClone(currentMapData.features);
};

/**
 * Gets a feature by ID.
 * @param {string} featureType - Storage type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object|undefined>} Feature or undefined
 */
export const getFeatureById = async (featureType, featureId, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    return currentMapData.features[featureType].find(f => f.properties.id === featureId);
};

/**
 * Updates a single property on a feature.
 * @param {string} featureType - Storage type
 * @param {string} featureId - Feature ID
 * @param {string} property - Property name
 * @param {*} value - New value
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether update was successful
 */
export const updateFeatureProperty = async (featureType, featureId, property, value, mapName = null) => {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'updateFeatureProperty', reason: perm.reason });
        return false;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update feature property.');
        return false;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const feature = currentMapData.features[featureType].find(f => f.properties.id === featureId);

    if (!feature) {
        console.warn(`Feature ${featureId} not found in ${featureType}`);
        return false;
    }

    // Capture old state for logging
    const oldFeature = deepClone(feature);

    // Compute color diff before mutation but defer the actual update
    const isColorProperty = ['color', 'fillColor', 'lineColor', 'outlinecolor', 'backgroundColor'].includes(property);
    let oldColor = null;
    if (isColorProperty) {
        oldColor = mapManager.getFeatureColor(feature);
    }

    feature.properties[property] = value;
    touchUpdatedTimestamp(feature);

    await runTransaction(async (tx) => {
        // Defer color tracking until persistence succeeds
        if (isColorProperty) {
            const newColor = mapManager.getFeatureColor(feature);
            if (oldColor !== newColor) {
                tx.deferSync(() => mapManager.updateColorUsage(oldColor, newColor, targetMap));
            }
        }

        // Defer sync logging
        tx.deferAsync(() => {
            const mapId = mapManager.getCurrentMapId();
            return logFeatureOperation(OperationType.UPDATE, featureId, mapId, feature, oldFeature);
        });

        return () => updateMapData(targetMap, currentMapData);
    });

    return true;
};

// ===== MOVE OPERATIONS =====

/**
 * Moves features between maps.
 * @param {Array} features - Features to move
 * @param {string} targetMapName - Target map name
 */
export const moveFeaturesToMap = async (features, targetMapName) => {
    if (!features || features.length === 0) return;

    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'moveFeaturesToMap', reason: perm.reason });
        return;
    }

    // Guard: cannot move out of or into a locked map
    if (isCurrentMapLockedSync()) {
        console.warn('Source map is locked. Cannot move features.');
        return;
    }
    if (memoryStore.lockedMaps.has(targetMapName)) {
        console.warn('Target map is locked. Cannot move features.');
        return;
    }

    const sourceMapName = mapManager.getCurrentMapName();
    if (sourceMapName === targetMapName) {
        console.warn('Attempt to move features to the same map');
        return;
    }

    const targetMapData = await getMapData(targetMapName);
    if (!targetMapData || Object.keys(targetMapData).length === 0) {
        throw new Error(`Target map "${targetMapName}" not found`);
    }

    // Build layer ID mapping for features being moved
    const layerIdMapping = await buildLayerMappingForMove(features, sourceMapName, targetMapName);

    const featuresByType = features.reduce((acc, feature) => {
        const type = getFeatureType(feature);
        if (!acc[type]) acc[type] = [];
        acc[type].push(feature);
        return acc;
    }, {});

    const batchOperation = {
        type: 'moveBetweenMaps',
        sourceMapName,
        targetMapName,
        movedFeatures: {}
    };

    try {
        for (const [type, featuresOfType] of Object.entries(featuresByType)) {
            const typeOperations = { mainFeatures: [], processedFeatures: [] };

            for (const feature of featuresOfType) {
                const removedData = await removeFeatureFromMap(type, feature.properties.id, sourceMapName);
                if (removedData) {
                    // Update layerId if mapping exists
                    const oldLayerId = feature.properties.layerId || 'default';
                    const newLayerId = layerIdMapping.get(oldLayerId);
                    if (newLayerId && newLayerId !== oldLayerId) {
                        feature.properties.layerId = newLayerId;
                    }

                    const addedFeature = await addFeatureToMap(type, feature, targetMapName);
                    if (addedFeature) {
                        typeOperations.mainFeatures.push({
                            feature: deepClone(addedFeature),
                            removedData: {
                                mainFeature: deepClone(removedData.mainFeature),
                                processedFeatures: removedData.processedFeatures ?
                                    deepClone(removedData.processedFeatures) : null
                            }
                        });

                        if (removedData.processedFeatures) {
                            for (const pf of removedData.processedFeatures.features) {
                                // Update layerId for processed features too
                                const pfOldLayerId = pf.properties.layerId || 'default';
                                const pfNewLayerId = layerIdMapping.get(pfOldLayerId);
                                if (pfNewLayerId && pfNewLayerId !== pfOldLayerId) {
                                    pf.properties.layerId = pfNewLayerId;
                                }
                                await addFeatureToMap(removedData.processedFeatures.type, pf, targetMapName);
                            }
                        }
                    }
                }
            }

            if (typeOperations.mainFeatures.length > 0) {
                batchOperation.movedFeatures[type] = typeOperations;
            }
        }

        if (Object.keys(batchOperation.movedFeatures).length > 0) {
            mapManager.recordAction(batchOperation);
        }
    } catch (error) {
        console.error('Error moving features:', error);
        throw error;
    }
};

/**
 * Builds layer ID mapping for moving features between maps.
 * Creates layers in target map if they don't exist (matching by name).
 * @param {Array} features - Features being moved
 * @param {string} sourceMapName - Source map name
 * @param {string} targetMapName - Target map name
 * @returns {Map} Mapping of source layerId to target layerId
 */
async function buildLayerMappingForMove(features, sourceMapName, targetMapName) {
    const layerIdMapping = new Map();

    if (!deps.layerManager) {
        // Fallback: map everything to default
        layerIdMapping.set('default', 'default');
        return layerIdMapping;
    }

    try {
        // Get unique layer IDs from features
        const sourceLayerIds = new Set();
        for (const feature of features) {
            const layerId = feature.properties?.layerId || 'default';
            sourceLayerIds.add(layerId);
        }

        // Get source layers info (need to load from repository for non-current map)
        const sourceLayers = await getLayersRepo(sourceMapName);
        const sourceLayersById = new Map(sourceLayers.map(l => [l.id, l]));

        // Get target layers
        const targetLayers = deps.layerManager.getLayers(targetMapName);
        const targetLayersByName = new Map(targetLayers.map(l => [l.name, l.id]));

        // For each source layer ID used by features, find or create target layer
        for (const sourceLayerId of sourceLayerIds) {
            if (sourceLayerId === 'default') {
                layerIdMapping.set('default', 'default');
                continue;
            }

            const sourceLayer = sourceLayersById.get(sourceLayerId);
            if (!sourceLayer) {
                // Layer not found in source, map to default
                layerIdMapping.set(sourceLayerId, 'default');
                continue;
            }

            // Check if target has layer with same name
            const existingTargetLayerId = targetLayersByName.get(sourceLayer.name);
            if (existingTargetLayerId) {
                // Reuse existing layer
                layerIdMapping.set(sourceLayerId, existingTargetLayerId);
            } else {
                // Create new layer in target with same name
                const newLayer = deps.layerManager.createLayerForImport(sourceLayer.name, targetMapName);
                layerIdMapping.set(sourceLayerId, newLayer.id);
                targetLayersByName.set(newLayer.name, newLayer.id);
            }
        }
    } catch (error) {
        console.warn('Error building layer mapping for move:', error);
        // Fallback: map everything to default
        layerIdMapping.set('default', 'default');
    }

    return layerIdMapping;
}

// ===== BATCH OPERATIONS FOR LOS/VISIBILITY =====

/**
 * Batch updates LOS feature and its processed features.
 * @param {Object} losFeature - LOS feature
 * @param {Array} processedFeatures - Processed LOS features
 * @param {string} [mapName=null] - Target map name
 */
export const batchUpdateLOSFeatures = async (losFeature, processedFeatures, mapName = null) => {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'batchUpdateLOSFeatures', reason: perm.reason });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update LOS features.');
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);

    const losIndex = currentMapData.features.los.findIndex(f => f.properties.id === losFeature.properties.id);
    if (losIndex === -1) return;

    const oldFeature = currentMapData.features.los[losIndex];
    const cleanedLos = cleanFeature(losFeature);
    currentMapData.features.los[losIndex] = cleanedLos;

    currentMapData.features.processed_los = currentMapData.features.processed_los.filter(f =>
        f.properties.id !== losFeature.properties.id + '-visible' &&
        f.properties.id !== losFeature.properties.id + '-obstructed'
    );

    const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
    currentMapData.features.processed_los.push(...cleanedProcessed);

    await runTransaction(async (tx) => {
        if (!mapName || mapName === mapManager.getCurrentMapName()) {
            tx.deferSync(() => {
                mapManager.recordAction({
                    type: 'update',
                    featureType: 'los',
                    oldFeature: deepClone(oldFeature),
                    newFeature: deepClone(cleanedLos)
                });
            });
        }

        return () => updateMapData(targetMap, currentMapData);
    });
};

/**
 * Batch updates visibility feature and its processed features.
 * @param {Object} visibilityFeature - Visibility feature
 * @param {Array} processedFeatures - Processed visibility features
 * @param {string} [mapName=null] - Target map name
 */
export const batchUpdateVisibilityFeatures = async (visibilityFeature, processedFeatures, mapName = null) => {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'batchUpdateVisibilityFeatures', reason: perm.reason });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update visibility features.');
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);

    const visIndex = currentMapData.features.visibility.findIndex(f => f.properties.id === visibilityFeature.properties.id);
    if (visIndex === -1) return;

    const oldFeature = currentMapData.features.visibility[visIndex];
    const cleanedVis = cleanFeature(visibilityFeature);
    currentMapData.features.visibility[visIndex] = cleanedVis;

    currentMapData.features.processed_visibility = currentMapData.features.processed_visibility.filter(f =>
        !f.properties.id.startsWith(visibilityFeature.properties.id + '-')
    );

    const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
    currentMapData.features.processed_visibility.push(...cleanedProcessed);

    await runTransaction(async (tx) => {
        if (!mapName || mapName === mapManager.getCurrentMapName()) {
            tx.deferSync(() => {
                mapManager.recordAction({
                    type: 'update',
                    featureType: 'visibility',
                    oldFeature: deepClone(oldFeature),
                    newFeature: deepClone(cleanedVis)
                });
            });
        }

        return () => updateMapData(targetMap, currentMapData);
    });
};

// ===== LAYER-FEATURE OPERATIONS =====

/**
 * Deletes all features from a specific layer.
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether any features were deleted
 */
export const deleteLayerFeatures = async (layerId, mapName = null) => {
    const perm = checkPermission(GuardAction.DELETE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'deleteLayerFeatures', reason: perm.reason });
        return false;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    let modified = false;

    // Collect group cleanup operations for deferral
    const groupCleanups = [];

    for (const storageType of getAllStorageTypes()) {
        const typeFeatures = currentMapData.features[storageType] || [];
        const initialLength = typeFeatures.length;

        currentMapData.features[storageType] = typeFeatures.filter(feature => {
            const featureLayerId = feature.properties?.layerId || 'default';
            if (featureLayerId === layerId) {
                const featureId = feature.properties?.id;
                if (featureId) {
                    groupCleanups.push({ storageType, featureId });
                }
                return false;
            }
            return true;
        });

        if (initialLength - currentMapData.features[storageType].length > 0) {
            modified = true;
        }
    }

    if (modified) {
        await runTransaction(async (tx) => {
            // Defer group cleanup until persistence succeeds
            if (groupCleanups.length > 0) {
                tx.deferSync(() => {
                    for (const { storageType, featureId } of groupCleanups) {
                        deps.groupManager.removeFeatureFromAllGroups(storageType, featureId, targetMap);
                    }
                });
            }

            return () => updateMapData(targetMap, currentMapData);
        });
    }
    return modified;
};

/**
 * Gets features from a specific layer.
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Array>} Array of features
 */
export const getLayerFeatures = async (layerId, mapName = null) => {
    const features = await getCurrentMapFeatures(mapName);
    const result = [];

    for (const storageType of getAllStorageTypes()) {
        const typeFeatures = features[storageType] || [];
        for (const feature of typeFeatures) {
            const featureLayerId = feature.properties?.layerId || 'default';
            if (featureLayerId === layerId) {
                result.push(feature);
            }
        }
    }
    return result;
};

/**
 * Moves features to another layer.
 * @param {Array} featureRefs - Array of layer IDs or feature references
 * @param {string} targetLayerId - Target layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether any features were moved
 */
export const moveFeaturesToLayer = async (featureRefs, targetLayerId, mapName = null) => {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'moveFeaturesToLayer', reason: perm.reason });
        return false;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot move features to layer.');
        return false;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    let modified = false;

    if (featureRefs.length === 0) return false;

    const isLayerIdArray = typeof featureRefs[0] === 'string';

    for (const storageType of getAllStorageTypes()) {
        const typeFeatures = currentMapData.features[storageType] || [];
        for (const feature of typeFeatures) {
            let shouldMove = false;
            if (isLayerIdArray) {
                const featureLayerId = feature.properties?.layerId || 'default';
                shouldMove = featureRefs.includes(featureLayerId);
            } else {
                shouldMove = featureRefs.some(ref => {
                    // ref.type is source type (e.g., 'point'), storageType is storage type (e.g., 'points')
                    const refStorageType = getStorageTypeFromSource(ref.type);
                    return refStorageType === storageType && ref.id === feature.properties?.id;
                });
            }

            if (shouldMove) {
                feature.properties.layerId = targetLayerId;
                modified = true;
            }
        }
    }

    if (modified) {
        await updateMapData(targetMap, currentMapData);
    }
    return modified;
};

// ===== VISIBILITY/LOCK CHECKS =====

/**
 * Checks if a feature is effectively visible.
 * @param {Object} feature - Feature to check
 * @returns {boolean} True if visible
 */
export const isFeatureEffectivelyVisible = (feature) => {
    return deps.layerManager.isFeatureEffectivelyVisible(feature);
};

/**
 * Checks if a feature is effectively locked.
 * @param {Object} feature - Feature to check
 * @returns {boolean} True if locked
 */
export const isFeatureEffectivelyLocked = (feature) => {
    if (!feature || !feature.properties) return false;

    if (deps.layerManager.isFeatureEffectivelyLocked(feature)) return true;

    const featureId = feature.properties.id;
    const sourceType = feature.properties.source;
    if (featureId && sourceType) {
        const group = deps.groupManager.getFeatureGroup(sourceType, featureId);
        if (group && group.locked === true) return true;
    }
    return false;
};

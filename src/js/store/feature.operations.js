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
import { EventTypes } from '../events';

// ===== TIMESTAMP AND VERSION HELPERS =====

/**
 * Adds createdAt timestamp and initial version to a new feature.
 * @param {Object} feature - Feature to timestamp
 * @returns {Object} Feature with createdAt, updatedAt, and version in properties
 */
function addCreatedTimestamp(feature) {
    if (!feature || !feature.properties) return feature;
    if (!feature.properties.createdAt) {
        feature.properties.createdAt = Date.now();
    }
    if (!feature.properties.updatedAt) {
        feature.properties.updatedAt = feature.properties.createdAt;
    }
    if (feature.properties.version === undefined) {
        feature.properties.version = 1;
    }
    return feature;
}

/**
 * Updates the updatedAt timestamp and increments version on a feature.
 * @param {Object} feature - Feature to update
 * @returns {Object} Feature with updated timestamp and version
 */
function touchUpdatedTimestamp(feature) {
    if (!feature || !feature.properties) return feature;
    feature.properties.updatedAt = Date.now();
    feature.properties.version = (feature.properties.version || 0) + 1;
    return feature;
}

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

/**
 * Returns the storage type for a feature based on its source property.
 * @param {Object} feature
 * @returns {string|undefined}
 */
function getFeatureType(feature) {
    return FEATURE_TYPE_MAPPINGS[feature.properties?.source];
}

/**
 * Returns the processed storage type key for analysis features.
 * @param {string} type - 'los' or 'visibility'
 * @returns {string|null}
 */
function getProcessedType(type) {
    if (type === 'los') return 'processed_los';
    if (type === 'visibility') return 'processed_visibility';
    return null;
}

/**
 * Resolves the target map name, defaulting to the current map.
 * @param {string|null} mapName
 * @returns {string}
 */
function resolveMap(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/**
 * Checks permission and map lock for a write operation.
 * Returns an object with `blocked` flag. If blocked, emits the appropriate error.
 * @param {string} guardAction - GuardAction constant
 * @param {string} operationName - Name for error reporting
 * @param {string} [targetMap] - Map name to check lock against (uses lockedMaps set)
 * @returns {{ blocked: boolean }}
 */
function guardWrite(guardAction, operationName, targetMap) {
    const perm = checkPermission(guardAction);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: operationName, reason: perm.reason });
        return { blocked: true };
    }
    if (targetMap && memoryStore.lockedMaps.has(targetMap)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: operationName, reason: 'map_locked' });
        return { blocked: true };
    }
    return { blocked: false };
}

/**
 * Returns whether undo should be recorded for this operation.
 * Undo is recorded when the operation targets the current map.
 * @param {string|null} mapName - Explicit map name (null means current)
 * @returns {boolean}
 */
function shouldRecordUndo(mapName) {
    return !mapName || mapName === mapManager.getCurrentMapName();
}

function findRelatedProcessedFeatures(type, featureId, mapData) {
    const processedType = getProcessedType(type);
    if (!processedType) return [];
    return mapData.features[processedType].filter(pf =>
        pf.properties.id.startsWith(featureId + '-')
    );
}

function removeProcessedFeaturesFromData(processedType, processedFeatures, mapData) {
    if (!processedType || !processedFeatures.length) return;
    const processedIds = new Set(processedFeatures.map(pf => pf.properties.id));
    mapData.features[processedType] = mapData.features[processedType]
        .filter(pf => !processedIds.has(pf.properties.id));
}

/**
 * Preserves user-managed data from oldFeature onto cleanedFeature.
 * Images, attributes, and description are managed separately by userDataManager
 * and should not be overwritten by MapLibre source updates.
 * @param {Object} oldFeature - Stored feature
 * @param {Object} cleanedFeature - Incoming cleaned feature
 */
function preserveUserData(oldFeature, cleanedFeature) {
    const oldProps = oldFeature.properties;
    const newProps = cleanedFeature.properties;

    if (Array.isArray(oldProps.images) && oldProps.images.length > 0 &&
        (!Array.isArray(newProps.images) || newProps.images.length === 0)) {
        newProps.images = oldProps.images;
    }

    if (oldProps.attributes && Object.keys(oldProps.attributes).length > 0 &&
        (!newProps.attributes || Object.keys(newProps.attributes).length === 0)) {
        newProps.attributes = oldProps.attributes;
    }

    if (oldProps.descricao && !newProps.descricao) {
        newProps.descricao = oldProps.descricao;
    }
}

/**
 * Preserves sync metadata (createdAt, version) from the stored feature.
 * @param {Object} oldFeature - Stored feature
 * @param {Object} cleanedFeature - Incoming cleaned feature
 */
function preserveSyncMetadata(oldFeature, cleanedFeature) {
    if (oldFeature.properties.createdAt) {
        cleanedFeature.properties.createdAt = oldFeature.properties.createdAt;
    }
    if (oldFeature.properties.version !== undefined) {
        cleanedFeature.properties.version = oldFeature.properties.version;
    }
}

// ===== CRUD OPERATIONS =====

/**
 * Adds a new feature to a map.
 * @param {string} type - Storage type (e.g., 'points')
 * @param {Object} feature - GeoJSON feature to add
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object|undefined>} Cleaned feature or undefined if blocked
 */
export async function addFeature(type, feature, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.CREATE_FEATURE, 'addFeature', targetMap).blocked) return;

    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignored after cleanup:', feature);
        return;
    }

    addCreatedTimestamp(cleanedFeature);

    await runTransaction(async (tx) => {
        const currentMapData = await getMapDataCompat(targetMap);
        currentMapData.features[type].push(cleanedFeature);

        const colors = mapManager.getFeatureColors(cleanedFeature);
        tx.deferSync(() => {
            for (const color of colors) {
                mapManager.updateColorUsage(null, color, targetMap);
            }
        });

        if (shouldRecordUndo(mapName)) {
            tx.deferSync(() => {
                mapManager.recordAction({
                    type: 'add',
                    featureType: type,
                    feature: deepClone(cleanedFeature)
                });
            });
        }

        tx.deferAsync(() => {
            const mapId = mapManager.getCurrentMapId();
            return logFeatureOperation(OperationType.CREATE, cleanedFeature.properties.id, mapId, cleanedFeature);
        });

        return () => updateMapDataCompat(targetMap, currentMapData);
    });

    return cleanedFeature;
}

/**
 * Updates an existing feature.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature with updated properties
 * @param {string} [mapName=null] - Target map name
 */
export async function updateFeature(type, feature, mapName = null) {
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

    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    const index = currentMapData.features[type].findIndex(f => f.properties.id === cleanedFeature.properties.id);
    if (index === -1) return;

    const oldFeature = currentMapData.features[type][index];
    const oldColor = mapManager.getFeatureColor(oldFeature);

    preserveUserData(oldFeature, cleanedFeature);
    preserveSyncMetadata(oldFeature, cleanedFeature);

    if (isFeatureEqual(oldFeature, cleanedFeature)) return;

    touchUpdatedTimestamp(cleanedFeature);

    await runTransaction(async (tx) => {
        currentMapData.features[type][index] = cleanedFeature;

        const newColor = mapManager.getFeatureColor(cleanedFeature);
        if (oldColor !== newColor) {
            tx.deferSync(() => mapManager.updateColorUsage(oldColor, newColor, targetMap));
        }

        if (shouldRecordUndo(mapName)) {
            tx.deferSync(() => {
                mapManager.recordAction({
                    type: 'update',
                    featureType: type,
                    oldFeature: deepClone(oldFeature),
                    newFeature: deepClone(cleanedFeature)
                });
            });
        }

        tx.deferAsync(() => {
            const mapId = mapManager.getCurrentMapId();
            return logFeatureOperation(OperationType.UPDATE, cleanedFeature.properties.id, mapId, cleanedFeature, oldFeature);
        });

        return () => updateMapDataCompat(targetMap, currentMapData);
    });
}

/**
 * Removes a feature from a map.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID to remove
 * @param {string} [mapName=null] - Target map name
 */
export async function removeFeature(type, id, mapName = null) {
    const perm = checkPermission(GuardAction.DELETE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'removeFeature', reason: perm.reason });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot remove feature.');
        return;
    }

    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id === id);
    if (featureIndex === -1) return;

    const mainFeature = currentMapData.features[type].splice(featureIndex, 1)[0];
    const processedFeatures = findRelatedProcessedFeatures(type, id, currentMapData);
    const processedType = getProcessedType(type);

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, currentMapData);
    }

    await runTransaction(async (tx) => {
        const color = mapManager.getFeatureColor(mainFeature);
        if (color) {
            tx.deferSync(() => mapManager.updateColorUsage(color, null, targetMap));
        }

        tx.deferSync(() => {
            deps.groupManager.removeFeatureFromAllGroups(mainFeature.properties.source, id, targetMap);
        });

        if (shouldRecordUndo(mapName)) {
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

        tx.deferAsync(() => {
            const mapId = mapManager.getCurrentMapId();
            return logFeatureOperation(OperationType.DELETE, id, mapId, null, mainFeature);
        });

        return () => updateMapDataCompat(targetMap, currentMapData);
    });
}

/**
 * Adds a feature to a specific map.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature to add
 * @param {string} mapName - Target map name
 * @returns {Promise<Object|undefined>} Cleaned feature or undefined
 */
export async function addFeatureToMap(type, feature, mapName) {
    return await addFeature(type, feature, mapName);
}

/**
 * Removes a feature from a specific map and returns removed data.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID
 * @param {string} mapName - Target map name
 * @returns {Promise<Object|null>} Removed feature data
 */
export async function removeFeatureFromMap(type, id, mapName) {
    const mapData = await getMapDataCompat(mapName);
    const featureIndex = mapData.features[type].findIndex(f => f.properties.id === id);
    if (featureIndex === -1) return null;

    const mainFeature = mapData.features[type].splice(featureIndex, 1)[0];
    const processedFeatures = findRelatedProcessedFeatures(type, id, mapData);
    const processedType = getProcessedType(type);

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

        return () => updateMapDataCompat(mapName, mapData);
    });

    return result;
}

/**
 * Adds a feature without recording undo action.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature to add
 * @param {string} [mapName=null] - Target map name
 */
export async function addFeatureSilent(type, feature, mapName = null) {
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) return;

    addCreatedTimestamp(cleanedFeature);

    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    currentMapData.features[type].push(cleanedFeature);
    await updateMapDataCompat(targetMap, currentMapData);
}

/**
 * Removes a feature without recording undo action.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID
 * @param {string} [mapName=null] - Target map name
 */
export async function removeFeatureSilent(type, id, mapName = null) {
    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id === id);
    if (featureIndex === -1) return;

    currentMapData.features[type].splice(featureIndex, 1);
    await updateMapDataCompat(targetMap, currentMapData);
}

/**
 * Adds multiple features at once.
 * @param {Object<string, Array>} featuresMap - Map of type to features array
 * @param {string} [mapName=null] - Target map name
 */
export async function addFeatures(featuresMap, mapName = null) {
    const targetMap = resolveMap(mapName);
    if (guardWrite(GuardAction.CREATE_FEATURE, 'addFeatures', targetMap).blocked) return;

    const currentMapData = await getMapDataCompat(targetMap);
    const action = { type: 'addMultiple', features: {} };
    const colorDeferrals = [];

    for (const type of Object.keys(featuresMap)) {
        const features = featuresMap[type] || [];
        if (features.length === 0) continue;

        const cleanedFeatures = features.map(cleanFeature).filter(Boolean);
        cleanedFeatures.forEach(addCreatedTimestamp);
        currentMapData.features[type].push(...cleanedFeatures);
        action.features[type] = deepClone(cleanedFeatures);

        for (const feat of cleanedFeatures) {
            const color = mapManager.getFeatureColor(feat);
            if (color) colorDeferrals.push(color);
        }
    }

    await runTransaction(async (tx) => {
        if (colorDeferrals.length > 0) {
            tx.deferSync(() => {
                for (const color of colorDeferrals) {
                    mapManager.updateColorUsage(null, color, targetMap);
                }
            });
        }

        if (Object.keys(action.features).length > 0 && shouldRecordUndo(mapName)) {
            tx.deferSync(() => mapManager.recordAction(action));
        }

        return () => updateMapDataCompat(targetMap, currentMapData);
    });
}

// ===== READ OPERATIONS =====

/**
 * Gets all features from a map.
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object>} Features collection
 */
export async function getCurrentMapFeatures(mapName = null) {
    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    return deepClone(currentMapData.features);
}

/**
 * Gets a feature by ID.
 * @param {string} featureType - Storage type
 * @param {string} featureId - Feature ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Object|undefined>} Feature or undefined
 */
export async function getFeatureById(featureType, featureId, mapName = null) {
    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    return currentMapData.features[featureType].find(f => f.properties.id === featureId);
}

/**
 * Updates a single property on a feature.
 * @param {string} featureType - Storage type
 * @param {string} featureId - Feature ID
 * @param {string} property - Property name
 * @param {*} value - New value
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether update was successful
 */
export async function updateFeatureProperty(featureType, featureId, property, value, mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'updateFeatureProperty', reason: perm.reason });
        return false;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update feature property.');
        return false;
    }

    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    const feature = currentMapData.features[featureType].find(f => f.properties.id === featureId);

    if (!feature) {
        console.warn(`Feature ${featureId} not found in ${featureType}`);
        return false;
    }

    const oldFeature = deepClone(feature);

    const COLOR_PROPERTIES = ['color', 'fillColor', 'lineColor', 'outlinecolor', 'backgroundColor'];
    const isColorProperty = COLOR_PROPERTIES.includes(property);
    const oldColor = isColorProperty ? mapManager.getFeatureColor(feature) : null;

    feature.properties[property] = value;
    touchUpdatedTimestamp(feature);

    await runTransaction(async (tx) => {
        if (isColorProperty) {
            const newColor = mapManager.getFeatureColor(feature);
            if (oldColor !== newColor) {
                tx.deferSync(() => mapManager.updateColorUsage(oldColor, newColor, targetMap));
            }
        }

        tx.deferAsync(() => {
            const mapId = mapManager.getCurrentMapId();
            return logFeatureOperation(OperationType.UPDATE, featureId, mapId, feature, oldFeature);
        });

        return () => updateMapDataCompat(targetMap, currentMapData);
    });

    return true;
}

// ===== MOVE OPERATIONS =====

/**
 * Moves features between maps.
 * @param {Array} features - Features to move
 * @param {string} targetMapName - Target map name
 */
export async function moveFeaturesToMap(features, targetMapName) {
    if (!features || features.length === 0) return;

    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'moveFeaturesToMap', reason: perm.reason });
        return;
    }

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

    const targetMapData = await getMapDataCompat(targetMapName);
    if (!targetMapData || Object.keys(targetMapData).length === 0) {
        throw new Error(`Target map "${targetMapName}" not found`);
    }

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
                if (!removedData) continue;

                updateLayerId(feature, layerIdMapping);
                const addedFeature = await addFeatureToMap(type, feature, targetMapName);
                if (!addedFeature) continue;

                typeOperations.mainFeatures.push({
                    feature: deepClone(addedFeature),
                    removedData: {
                        mainFeature: deepClone(removedData.mainFeature),
                        processedFeatures: removedData.processedFeatures
                            ? deepClone(removedData.processedFeatures)
                            : null
                    }
                });

                if (removedData.processedFeatures) {
                    for (const pf of removedData.processedFeatures.features) {
                        updateLayerId(pf, layerIdMapping);
                        await addFeatureToMap(removedData.processedFeatures.type, pf, targetMapName);
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
}

/**
 * Updates a feature's layerId based on the layer mapping.
 * @param {Object} feature
 * @param {Map} layerIdMapping
 */
function updateLayerId(feature, layerIdMapping) {
    const oldLayerId = feature.properties.layerId || 'default';
    const newLayerId = layerIdMapping.get(oldLayerId);
    if (newLayerId && newLayerId !== oldLayerId) {
        feature.properties.layerId = newLayerId;
    }
}

/**
 * Builds layer ID mapping for moving features between maps.
 * Creates layers in target map if they don't exist (matching by name).
 * @param {Array} features - Features being moved
 * @param {string} sourceMapName - Source map name
 * @param {string} targetMapName - Target map name
 * @returns {Promise<Map>} Mapping of source layerId to target layerId
 */
export async function buildLayerMappingForMove(features, sourceMapName, targetMapName) {
    const layerIdMapping = new Map();

    if (!deps.layerManager) {
        layerIdMapping.set('default', 'default');
        return layerIdMapping;
    }

    try {
        const sourceLayerIds = new Set(
            features.map(f => f.properties?.layerId || 'default')
        );

        const sourceLayers = await getLayersCompat(sourceMapName);
        const sourceLayersById = new Map(sourceLayers.map(l => [l.id, l]));

        const targetLayers = await getLayersCompat(targetMapName);
        const targetLayersByName = new Map(targetLayers.map(l => [l.name, l.id]));

        let createdNewLayers = false;

        for (const sourceLayerId of sourceLayerIds) {
            if (sourceLayerId === 'default') {
                layerIdMapping.set('default', 'default');
                continue;
            }

            const sourceLayer = sourceLayersById.get(sourceLayerId);
            if (!sourceLayer) {
                layerIdMapping.set(sourceLayerId, 'default');
                continue;
            }

            const existingTargetLayerId = targetLayersByName.get(sourceLayer.name);
            if (existingTargetLayerId) {
                layerIdMapping.set(sourceLayerId, existingTargetLayerId);
            } else {
                const newLayer = deps.layerManager.createLayerForImport(sourceLayer.name, targetMapName);
                layerIdMapping.set(sourceLayerId, newLayer.id);
                targetLayersByName.set(newLayer.name, newLayer.id);
                createdNewLayers = true;
            }
        }

        // Notify visibility system so new layers appear in the visible set
        if (createdNewLayers && deps.eventBus) {
            deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: targetMapName });
        }
    } catch (error) {
        console.warn('Error building layer mapping for move:', error);
        layerIdMapping.set('default', 'default');
    }

    return layerIdMapping;
}

// ===== BATCH OPERATIONS FOR LOS/VISIBILITY =====

/**
 * Shared implementation for batch-updating an analysis feature and its processed results.
 * @param {string} mainType - 'los' or 'visibility'
 * @param {Object} mainFeature - The analysis feature
 * @param {Array} processedFeatures - Processed result features
 * @param {string|null} mapName - Target map name
 */
async function batchUpdateAnalysisFeatures(mainType, mainFeature, processedFeatures, mapName) {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: `batchUpdate${mainType.charAt(0).toUpperCase() + mainType.slice(1)}Features`,
            reason: perm.reason
        });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn(`Map is locked. Cannot update ${mainType} features.`);
        return;
    }

    const processedType = getProcessedType(mainType);
    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);

    const mainIndex = currentMapData.features[mainType].findIndex(
        f => f.properties.id === mainFeature.properties.id
    );
    if (mainIndex === -1) return;

    const oldFeature = currentMapData.features[mainType][mainIndex];
    const cleanedMain = cleanFeature(mainFeature);
    currentMapData.features[mainType][mainIndex] = cleanedMain;

    const featureIdPrefix = mainFeature.properties.id + '-';

    const oldProcessedFeatures = currentMapData.features[processedType].filter(f =>
        f.properties.id.startsWith(featureIdPrefix)
    );

    currentMapData.features[processedType] = currentMapData.features[processedType].filter(f =>
        !f.properties.id.startsWith(featureIdPrefix)
    );

    const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
    currentMapData.features[processedType].push(...cleanedProcessed);

    await runTransaction(async (tx) => {
        if (shouldRecordUndo(mapName)) {
            tx.deferSync(() => {
                mapManager.recordAction({
                    type: 'updateWithProcessed',
                    mainFeatureType: mainType,
                    oldFeature: deepClone(oldFeature),
                    newFeature: deepClone(cleanedMain),
                    oldProcessedFeatures: {
                        type: processedType,
                        features: deepClone(oldProcessedFeatures)
                    },
                    newProcessedFeatures: {
                        type: processedType,
                        features: deepClone(cleanedProcessed)
                    }
                });
            });
        }

        return () => updateMapDataCompat(targetMap, currentMapData);
    });
}

/**
 * Batch updates LOS feature and its processed features.
 * @param {Object} losFeature - LOS feature
 * @param {Array} processedFeatures - Processed LOS features
 * @param {string} [mapName=null] - Target map name
 */
export async function batchUpdateLOSFeatures(losFeature, processedFeatures, mapName = null) {
    return batchUpdateAnalysisFeatures('los', losFeature, processedFeatures, mapName);
}

/**
 * Batch updates visibility feature and its processed features.
 * @param {Object} visibilityFeature - Visibility feature
 * @param {Array} processedFeatures - Processed visibility features
 * @param {string} [mapName=null] - Target map name
 */
export async function batchUpdateVisibilityFeatures(visibilityFeature, processedFeatures, mapName = null) {
    return batchUpdateAnalysisFeatures('visibility', visibilityFeature, processedFeatures, mapName);
}

// ===== LAYER-FEATURE OPERATIONS =====

/**
 * Deletes all features from a specific layer.
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether any features were deleted
 */
export async function deleteLayerFeatures(layerId, mapName = null) {
    const perm = checkPermission(GuardAction.DELETE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'deleteLayerFeatures', reason: perm.reason });
        return false;
    }

    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    let modified = false;
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

        if (currentMapData.features[storageType].length < initialLength) {
            modified = true;
        }
    }

    if (modified) {
        await runTransaction(async (tx) => {
            if (groupCleanups.length > 0) {
                tx.deferSync(() => {
                    for (const { storageType, featureId } of groupCleanups) {
                        deps.groupManager.removeFeatureFromAllGroups(storageType, featureId, targetMap);
                    }
                });
            }

            return () => updateMapDataCompat(targetMap, currentMapData);
        });
    }
    return modified;
}

/**
 * Gets features from a specific layer.
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<Array>} Array of features
 */
export async function getLayerFeatures(layerId, mapName = null) {
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
}

/**
 * Moves features to another layer.
 * @param {Array} featureRefs - Array of layer IDs or feature references
 * @param {string} targetLayerId - Target layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether any features were moved
 */
export async function moveFeaturesToLayer(featureRefs, targetLayerId, mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_FEATURE);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'moveFeaturesToLayer', reason: perm.reason });
        return false;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot move features to layer.');
        return false;
    }

    if (featureRefs.length === 0) return false;

    const targetMap = resolveMap(mapName);
    const currentMapData = await getMapDataCompat(targetMap);
    let modified = false;
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
        await updateMapDataCompat(targetMap, currentMapData);
    }
    return modified;
}

// ===== VISIBILITY/LOCK CHECKS =====

/**
 * Checks if a feature is effectively visible.
 * @param {Object} feature - Feature to check
 * @returns {boolean} True if visible
 */
export function isFeatureEffectivelyVisible(feature) {
    return deps.layerManager.isFeatureEffectivelyVisible(feature);
}

/**
 * Checks if a feature is effectively locked.
 * @param {Object} feature - Feature to check
 * @returns {boolean} True if locked
 */
export function isFeatureEffectivelyLocked(feature) {
    if (!feature || !feature.properties) return false;

    if (deps.layerManager.isFeatureEffectivelyLocked(feature)) return true;

    const featureId = feature.properties.id;
    const sourceType = feature.properties.source;
    if (featureId && sourceType) {
        const group = deps.groupManager.getFeatureGroup(sourceType, featureId);
        if (group && group.locked === true) return true;
    }
    return false;
}

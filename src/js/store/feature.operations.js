// Path: js/store/feature.operations.js

/**
 * @fileoverview Feature CRUD operations.
 */

import { cleanFeature, getMapData, updateMapData } from './repository.js';
import { FEATURE_TYPE_MAPPINGS, getAllStorageTypes } from './store.constants.js';
import mapManager from './store-state-manager.js';

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
    const cleanedFeature = cleanFeature(feature);
    if (!cleanedFeature) {
        console.warn('Feature ignored after cleanup:', feature);
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    currentMapData.features[type].push(cleanedFeature);
    await updateMapData(targetMap, currentMapData);

    // Track ALL colors from the feature
    const colors = mapManager.getFeatureColors(cleanedFeature);
    for (const color of colors) {
        mapManager.updateColorUsage(null, color, targetMap);
    }

    if (!mapName || mapName === mapManager.getCurrentMapName()) {
        mapManager.recordAction({
            type: 'add',
            featureType: type,
            feature: JSON.parse(JSON.stringify(cleanedFeature))
        });
    }
};

/**
 * Updates an existing feature.
 * @param {string} type - Storage type
 * @param {Object} feature - Feature with updated properties
 * @param {string} [mapName=null] - Target map name
 */
export const updateFeature = async (type, feature, mapName = null) => {
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
        const oldColor = mapManager.getFeatureColor(oldFeature);
        const newColor = mapManager.getFeatureColor(cleanedFeature);
        if (oldColor !== newColor) {
            mapManager.updateColorUsage(oldColor, newColor, targetMap);
        }

        // Preserve user data (images and attributes) from the stored feature
        // These are managed separately by userDataManager and should not be overwritten
        // by updates from the MapLibre source (which doesn't have these properties)
        // Check for actual content: oldFeature has data AND newFeature is empty/missing
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

        if (JSON.stringify(oldFeature) !== JSON.stringify(cleanedFeature)) {
            currentMapData.features[type][index] = cleanedFeature;
            await updateMapData(targetMap, currentMapData);

            if (!mapName || mapName === mapManager.getCurrentMapName()) {
                mapManager.recordAction({
                    type: 'update',
                    featureType: type,
                    oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                    newFeature: JSON.parse(JSON.stringify(cleanedFeature))
                });
            }
        }
    }
};

/**
 * Removes a feature from a map.
 * @param {string} type - Storage type
 * @param {string} id - Feature ID to remove
 * @param {string} [mapName=null] - Target map name
 */
export const removeFeature = async (type, id, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const featureIndex = currentMapData.features[type].findIndex(f => f.properties.id === id);

    if (featureIndex === -1) return;

    const mainFeature = currentMapData.features[type].splice(featureIndex, 1)[0];
    const color = mapManager.getFeatureColor(mainFeature);
    if (color) {
        mapManager.updateColorUsage(color, null, targetMap);
    }

    deps.groupManager.removeFeatureFromAllGroups(mainFeature.properties.source, id, targetMap);

    const processedFeatures = findRelatedProcessedFeatures(type, id, currentMapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, currentMapData);
    }

    await updateMapData(targetMap, currentMapData);

    if (!mapName || mapName === mapManager.getCurrentMapName()) {
        mapManager.recordAction({
            type: 'removeWithProcessed',
            mainFeatureType: type,
            mainFeature: JSON.parse(JSON.stringify(mainFeature)),
            processedFeatures: processedFeatures.length > 0 ? {
                type: processedType,
                features: JSON.parse(JSON.stringify(processedFeatures))
            } : null
        });
    }

    // Robust deletion verification
    setTimeout(async () => {
        try {
            const verifyMapData = await getMapData(targetMap);
            const stillExists = verifyMapData.features[type].some(f => f.properties.id === id);
            if (stillExists) {
                const retryMapData = await getMapData(targetMap);
                const retryIndex = retryMapData.features[type].findIndex(f => f.properties.id === id);
                if (retryIndex !== -1) {
                    retryMapData.features[type].splice(retryIndex, 1);
                    await updateMapData(targetMap, retryMapData);
                }
            }
        } catch (error) {
            console.error(`Robust deletion verification failed for ${type} ${id}:`, error);
        }
    }, 500);
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

    const mainFeature = mapData.features[type].splice(featureIndex, 1)[0];
    const color = mapManager.getFeatureColor(mainFeature);
    if (color) {
        mapManager.updateColorUsage(color, null, mapName);
    }

    deps.groupManager.removeFeatureFromAllGroups(mainFeature.properties.source, id, mapName);

    const processedFeatures = findRelatedProcessedFeatures(type, id, mapData);
    const processedType = type === 'los' ? 'processed_los' :
        type === 'visibility' ? 'processed_visibility' : null;

    if (processedType && processedFeatures.length > 0) {
        removeProcessedFeaturesFromData(processedType, processedFeatures, mapData);
    }

    await updateMapData(mapName, mapData);

    return {
        mainFeature,
        processedFeatures: processedFeatures.length > 0 ? {
            type: processedType,
            features: processedFeatures
        } : null
    };
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
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const action = { type: 'addMultiple', features: {} };

    Object.keys(featuresMap).forEach(type => {
        const features = featuresMap[type] || [];
        if (features.length > 0) {
            const cleanedFeatures = features.map(cleanFeature).filter(Boolean);
            currentMapData.features[type].push(...cleanedFeatures);
            action.features[type] = JSON.parse(JSON.stringify(cleanedFeatures));

            cleanedFeatures.forEach(feature => {
                const color = mapManager.getFeatureColor(feature);
                if (color) {
                    mapManager.updateColorUsage(null, color, targetMap);
                }
            });
        }
    });

    await updateMapData(targetMap, currentMapData);

    if (Object.keys(action.features).length > 0 && (!mapName || mapName === mapManager.getCurrentMapName())) {
        mapManager.recordAction(action);
    }
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
    return JSON.parse(JSON.stringify(currentMapData.features));
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
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const feature = currentMapData.features[featureType].find(f => f.properties.id === featureId);

    if (!feature) {
        console.warn(`Feature ${featureId} not found in ${featureType}`);
        return false;
    }

    const isColorProperty = ['color', 'fillColor', 'lineColor', 'outlinecolor', 'backgroundColor'].includes(property);
    if (isColorProperty) {
        const oldColor = mapManager.getFeatureColor(feature);
        feature.properties[property] = value;
        const newColor = mapManager.getFeatureColor(feature);
        if (oldColor !== newColor) {
            mapManager.updateColorUsage(oldColor, newColor, targetMap);
        }
    } else {
        feature.properties[property] = value;
    }

    await updateMapData(targetMap, currentMapData);
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
                            feature: JSON.parse(JSON.stringify(addedFeature)),
                            removedData: {
                                mainFeature: JSON.parse(JSON.stringify(removedData.mainFeature)),
                                processedFeatures: removedData.processedFeatures ?
                                    JSON.parse(JSON.stringify(removedData.processedFeatures)) : null
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
        const { getLayers: getLayersRepo } = await import('./repository.js');
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
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);

    const losIndex = currentMapData.features.los.findIndex(f => f.properties.id === losFeature.properties.id);
    if (losIndex !== -1) {
        const oldFeature = currentMapData.features.los[losIndex];
        currentMapData.features.los[losIndex] = cleanFeature(losFeature);

        currentMapData.features.processed_los = currentMapData.features.processed_los.filter(f =>
            f.properties.id !== losFeature.properties.id + '-visible' &&
            f.properties.id !== losFeature.properties.id + '-obstructed'
        );

        const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
        currentMapData.features.processed_los.push(...cleanedProcessed);
        await updateMapData(targetMap, currentMapData);

        if (!mapName || mapName === mapManager.getCurrentMapName()) {
            mapManager.recordAction({
                type: 'update',
                featureType: 'los',
                oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                newFeature: JSON.parse(JSON.stringify(cleanFeature(losFeature)))
            });
        }
    }
};

/**
 * Batch updates visibility feature and its processed features.
 * @param {Object} visibilityFeature - Visibility feature
 * @param {Array} processedFeatures - Processed visibility features
 * @param {string} [mapName=null] - Target map name
 */
export const batchUpdateVisibilityFeatures = async (visibilityFeature, processedFeatures, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);

    const visIndex = currentMapData.features.visibility.findIndex(f => f.properties.id === visibilityFeature.properties.id);
    if (visIndex !== -1) {
        const oldFeature = currentMapData.features.visibility[visIndex];
        currentMapData.features.visibility[visIndex] = cleanFeature(visibilityFeature);

        currentMapData.features.processed_visibility = currentMapData.features.processed_visibility.filter(f =>
            !f.properties.id.startsWith(visibilityFeature.properties.id + '-')
        );

        const cleanedProcessed = processedFeatures.map(cleanFeature).filter(Boolean);
        currentMapData.features.processed_visibility.push(...cleanedProcessed);
        await updateMapData(targetMap, currentMapData);

        if (!mapName || mapName === mapManager.getCurrentMapName()) {
            mapManager.recordAction({
                type: 'update',
                featureType: 'visibility',
                oldFeature: JSON.parse(JSON.stringify(oldFeature)),
                newFeature: JSON.parse(JSON.stringify(cleanFeature(visibilityFeature)))
            });
        }
    }
};

// ===== LAYER-FEATURE OPERATIONS =====

/**
 * Deletes all features from a specific layer.
 * @param {string} layerId - Layer ID
 * @param {string} [mapName=null] - Target map name
 * @returns {Promise<boolean>} Whether any features were deleted
 */
export const deleteLayerFeatures = async (layerId, mapName = null) => {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    let modified = false;

    for (const storageType of getAllStorageTypes()) {
        const typeFeatures = currentMapData.features[storageType] || [];
        const initialLength = typeFeatures.length;

        currentMapData.features[storageType] = typeFeatures.filter(feature => {
            const featureLayerId = feature.properties?.layerId || 'default';
            if (featureLayerId === layerId) {
                const featureId = feature.properties?.id;
                if (featureId) {
                    deps.groupManager.removeFeatureFromAllGroups(storageType, featureId, targetMap);
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
        await updateMapData(targetMap, currentMapData);
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
                shouldMove = featureRefs.some(ref =>
                    ref.type === storageType && ref.id === feature.properties?.id
                );
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

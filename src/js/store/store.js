// Path: js/store/store.js

/**
 * @fileoverview Store facade - central access point for all data operations.
 *
 * This file re-exports all operations from specialized modules
 * and handles dependency injection initialization.
 */

import {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    cleanFeature,
    isInternalProperty,
    compareVersions,
    resetMemoryStore,
    initializeRepository,
    clearAllMapData,
    clearAllImageData,
    clearAllAppSettings,
    clearAllGroupData,
    clearAllLayerData,
    clearAllCesium3dData,
    setAppSetting,
    getColorUsage
} from './repository.js';

import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';
import { resetColorCache } from '../tool_manager/helpers/color-picker.helpers.js';

// Import specialized operation modules
import {
    setFeatureDependencies,
    deleteLayerFeatures,
    addFeature,
    updateFeature,
    removeFeature,
    addFeatureToMap,
    removeFeatureFromMap,
    moveFeaturesToLayer as moveFeaturesToLayerBase
} from './feature.operations.js';
import {
    setMapDependencies,
    getCurrentMapNameSync
} from './map.operations.js';
import {
    setLayerDependencies,
    deleteLayerOnly
} from './layer.operations.js';
import { setGroupDependencies } from './group.operations.js';
import { setCesium3dDependencies, loadCesium3dDataToMemory, clearCesium3dCache } from './cesium3d.operations.js';

// ===== DEPENDENCY INJECTION =====

/**
 * Module-level dependencies injected via initStoreEvents()
 * @type {import('./store.types.js').StoreDependencies}
 */
const deps = {
    eventBus: null,
    groupManager: null,
    layerManager: null
};

/**
 * Initialize store module with dependencies.
 * Must be called once at application startup.
 *
 * @param {import('../events/event_bus.js').EventBus} eventBus - Event bus instance
 * @param {import('../tool_manager/group_manager.js').GroupManager} groupManager - Group manager instance
 * @param {import('../layers/layer.manager.js').LayerManager} layerManager - Layer manager instance
 */
export function initStoreEvents(eventBus, groupManager, layerManager) {
    if (deps.eventBus !== null) {
        throw new Error('Store events already initialized');
    }
    deps.eventBus = eventBus;
    deps.groupManager = groupManager;
    deps.layerManager = layerManager;

    // Propagate dependencies to all operation modules
    const dependencies = { eventBus, groupManager, layerManager };
    setFeatureDependencies(dependencies);
    setMapDependencies(dependencies);
    setLayerDependencies(dependencies);
    setGroupDependencies(dependencies);
    setCesium3dDependencies({ eventBus });
}

// ===== INITIALIZATION =====

/**
 * Initialize with last active map.
 *
 * @returns {Promise<string>} Last active map name
 */
export const initializeWithLastActiveMap = async () => {
    const lastActiveMap = await initializeRepository();
    await mapManager.setCurrentMap(lastActiveMap);
    await mapManager.initializeProjectColorCache();
    await deps.groupManager.loadGroupsToMemory(lastActiveMap);
    await deps.layerManager.loadLayersToMemory(lastActiveMap);
    await loadCesium3dDataToMemory(lastActiveMap);

    return lastActiveMap;
};

// ===== CLEANUP OPERATIONS =====

/**
 * Clears all data from storage.
 *
 * @returns {Promise<void>}
 */
export const clearAllDataStore = async () => {
    resetMemoryStore();
    await clearAllMapData();
    await clearAllImageData();
    await clearAllAppSettings();
    await clearAllGroupData();
    await clearAllLayerData();
    await clearAllCesium3dData();

    await mapManager.clearAllColorCaches();
    resetColorCache();

    deps.layerManager.clearLayersCache();
    clearCesium3dCache();

    await setAppSetting('schemaVersion', SCHEMA_VERSION);

    // Reinitialize with default map and layers
    const defaultMap = await initializeRepository();
    await mapManager.setCurrentMap(defaultMap);
    await deps.groupManager.loadGroupsToMemory(defaultMap);
    await deps.layerManager.loadLayersToMemory(defaultMap);
    await loadCesium3dDataToMemory(defaultMap);

    deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
};

// ===== DELETE LAYER WITH FEATURES =====

/**
 * Deletes a layer and all its features.
 *
 * @param {string} layerId - Layer ID to delete
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<Object>} Deletion result
 */
export const deleteLayer = async (layerId, mapName = null) => {
    await deleteLayerFeatures(layerId, mapName);
    return deleteLayerOnly(layerId, mapName);
};

// ===== UNDO/REDO SYSTEM =====

/**
 * Undoes the last action.
 *
 * @returns {Promise<Object>} Undo result
 */
export const undoLastAction = async () => {
    const executeFunction = {
        addFeature,
        updateFeature,
        removeFeature,
        addFeatureToMap,
        removeFeatureFromMap
    };

    return await mapManager.undoLastAction(executeFunction);
};

/**
 * Redoes the last undone action.
 *
 * @returns {Promise<Object>} Redo result
 */
export const redoLastAction = async () => {
    const executeFunction = {
        addFeature,
        updateFeature,
        removeFeature,
        addFeatureToMap,
        removeFeatureFromMap
    };

    return await mapManager.redoLastAction(executeFunction);
};

// ===== MOVE FEATURES TO LAYER (with event emission) =====

/**
 * Moves features to another layer (with event emission).
 *
 * @param {Array} featureRefs - Array of layer IDs or feature references
 * @param {string} targetLayerId - Target layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export const moveFeaturesToLayer = async (featureRefs, targetLayerId, mapName = null) => {
    const modified = await moveFeaturesToLayerBase(featureRefs, targetLayerId, mapName);
    if (modified) {
        const targetMap = mapName || getCurrentMapNameSync();
        deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: targetMap });
    }
};

// ===== RE-EXPORTS FROM CONSTANTS =====

export {
    FEATURE_TYPE_ICONS,
    FEATURE_TYPE_LAYERS,
    FEATURE_TYPE_MAPPINGS,
    FEATURE_DISPLAY_NAMES,
    UNCOPYABLE_FEATURE_TYPES,
    IMAGE_RESOURCE_FEATURE_TYPES,
    getStorageTypeFromSource,
    getSourceTypeFromStorage,
    getFeatureIcon,
    getFeatureDisplayName,
    getFeatureDisplayNameFromStorage,
    getFeatureIconFromStorage,
    getAllSourceTypes,
    getAllStorageTypes,
    isUncopyableFeatureType,
    hasImageResource,
    getSelectionControlConfig
} from './store.constants.js';

// ===== RE-EXPORTS FROM FEATURE OPERATIONS =====

export {
    addFeature,
    updateFeature,
    removeFeature,
    addFeatureToMap,
    removeFeatureFromMap,
    addFeatures,
    getCurrentMapFeatures,
    getFeatureById,
    updateFeatureProperty,
    moveFeaturesToMap,
    batchUpdateLOSFeatures,
    batchUpdateVisibilityFeatures,
    deleteLayerFeatures,
    isFeatureEffectivelyLocked
} from './feature.operations.js';

// ===== RE-EXPORTS FROM MAP OPERATIONS =====

export {
    getAllMapNamesStore,
    getMapOrder,
    setMapOrder,
    addMap,
    removeMap,
    renameMap,
    setCurrentMap,
    getCurrentMapName,
    getCurrentMapNameSync,
    setSchemaVersion,
    getMapDataStore,
    getCurrentBaseLayer,
    setBaseLayer,
    updateMapPosition,
    getMapPosition,
    hasMapSavedPosition,
    clearMapPosition,
    getFrequentColors,
    getMapBadgeColors,
    getAllMapBadgeColors
} from './map.operations.js';

// ===== RE-EXPORTS FROM LAYER OPERATIONS =====

export {
    getLayers,
    getActiveLayerIdSync,
    getVisibleLayerIds,
    createLayer,
    createLayerForImport,
    setActiveLayer,
    renameLayer,
    setLayerVisibility,
    setLayerLocked,
    reorderLayers,
    setMapLayers
} from './layer.operations.js';

// ===== RE-EXPORTS FROM GROUP OPERATIONS =====

export {
    createGroup,
    combineGroups,
    getMapGroups,
    getFeatureGroup,
    updateGroupProperty,
    ungroupFeatures
} from './group.operations.js';

// ===== RE-EXPORTS FROM SETTINGS OPERATIONS =====

export {
    getMapNotes,
    setMapNotes,
    getFrameStyle,
    setFrameStyle,
    getGridStyle,
    setGridStyle,
    getMapAnalysisLayersStates,
    storeImage,
    getImage,
    removeImage
} from './settings.operations.js';

// ===== RE-EXPORTS FROM CATALOG OPERATIONS =====

export {
    getCatalogLayers,
    addCatalogLayer,
    removeCatalogLayer,
    updateCatalogLayer,
    toggleCatalogLayerVisibility,
    getCatalogLayerById,
    hasCatalogLayer,
    validateCatalogLayerAvailability,
    processCatalogLayersOnImport,
    updateCatalogLayerStatus
} from './catalog.operations.js';

// ===== RE-EXPORTS FROM CESIUM 3D OPERATIONS =====

export {
    saveCameraPosition,
    getCameraPosition,
    hasSavedCameraPosition,
    clearCameraPosition,
    getAllCameraPositions,
    addMarker,
    getMarkers,
    getAllMarkers,
    getMarkerById,
    updateMarker,
    removeMarker,
    removeMarkersByTileset,
    loadCesium3dDataToMemory,
    clearCesium3dCache,
    setCesium3dDataForImport,
    getCesium3dDataForExport,
    DEFAULT_MARKER_STYLE,
    addMarkerImage,
    getMarkerImages,
    removeMarkerImage,
    // Measurement operations
    addMeasurement,
    getMeasurements,
    getAllMeasurements,
    getMeasurementById,
    updateMeasurement,
    removeMeasurement,
    addMeasurementImage,
    getMeasurementImages,
    removeMeasurementImage,
    // Viewshed operations
    addViewshed,
    getViewsheds,
    getAllViewsheds,
    getViewshedById,
    updateViewshed,
    removeViewshed,
    addViewshedImage,
    getViewshedImages,
    removeViewshedImage
} from './cesium3d.operations.js';

// ===== LEGACY COMPATIBILITY EXPORTS =====

export { SCHEMA_VERSION, MIN_SCHEMA_VERSION, MAX_SCHEMA_VERSION };
export { compareVersions, cleanFeature, isInternalProperty, getColorUsage };

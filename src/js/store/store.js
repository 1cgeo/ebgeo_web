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
    setAppSetting,
    getColorUsage
} from './repository.js';

import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';

// Import specialized operation modules
import { setFeatureDependencies } from './feature.operations.js';
import { setMapDependencies } from './map.operations.js';
import { setLayerDependencies } from './layer.operations.js';
import { setGroupDependencies } from './group.operations.js';

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
 * @param {import('../layer_manager.js').LayerManager} layerManager - Layer manager instance
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

    await mapManager.clearAllColorCaches();

    deps.layerManager.clearLayersCache();

    await setAppSetting('schemaVersion', SCHEMA_VERSION);

    deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
};

// ===== DELETE LAYER WITH FEATURES =====

// Import deleteLayerFeatures from feature operations
import { deleteLayerFeatures } from './feature.operations.js';
import { deleteLayerOnly } from './layer.operations.js';

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

import {
    addFeature,
    updateFeature,
    removeFeature,
    addFeatureToMap,
    removeFeatureFromMap
} from './feature.operations.js';

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

import { moveFeaturesToLayer as moveFeaturesToLayerBase } from './feature.operations.js';
import { getCurrentMapNameSync } from './map.operations.js';

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
    getFeatureLayer,
    getFeatureDisplayName,
    getFeatureDisplayNameFromStorage,
    getFeatureIconFromStorage,
    getAllSourceTypes,
    getAllStorageTypes,
    isValidSourceType,
    isValidStorageType,
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
    addFeatureSilent,
    removeFeatureSilent,
    addFeatures,
    getCurrentMapFeatures,
    getFeatureById,
    updateFeatureProperty,
    moveFeaturesToMap,
    batchUpdateLOSFeatures,
    batchUpdateVisibilityFeatures,
    deleteLayerFeatures,
    getLayerFeatures,
    isFeatureEffectivelyVisible,
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
    setLastActiveMap,
    setSchemaVersion,
    getMapDataStore,
    getCurrentBaseLayer,
    setBaseLayer,
    updateMapPosition,
    getMapPosition,
    hasMapSavedPosition,
    clearMapPosition,
    getFrequentColors
} from './map.operations.js';

// ===== RE-EXPORTS FROM LAYER OPERATIONS =====

export {
    getLayers,
    getLayerById,
    getActiveLayerIdSync,
    getActiveLayerId,
    getVisibleLayerIds,
    createLayer,
    createLayerForImport,
    setActiveLayer,
    setActiveLayerId,
    renameLayer,
    setLayerVisibility,
    setLayerLocked,
    reorderLayers,
    loadLayersToMemory,
    clearLayersCache,
    setMapLayers
} from './layer.operations.js';

// ===== RE-EXPORTS FROM GROUP OPERATIONS =====

export {
    createGroup,
    combineGroups,
    getMapGroups,
    getGroupById,
    getFeatureGroup,
    getGroupFeatures,
    isFeatureGrouped,
    updateGroupProperty,
    ungroupFeatures,
    removeFeatureFromAllGroups
} from './group.operations.js';

// ===== RE-EXPORTS FROM SETTINGS OPERATIONS =====

export {
    getMapNotes,
    setMapNotes,
    getFrameStyle,
    setFrameStyle,
    getGridStyle,
    setGridStyle,
    getMapHillshadeState,
    setMapHillshadeState,
    getMapAnalysisLayerState,
    setMapAnalysisLayerState,
    getMapAnalysisLayersStates,
    setMapAnalysisLayersStates,
    storeImage,
    getImage,
    removeImage,
    hasImage
} from './settings.operations.js';

// ===== LEGACY COMPATIBILITY EXPORTS =====

export { SCHEMA_VERSION, MIN_SCHEMA_VERSION, MAX_SCHEMA_VERSION };
export { compareVersions, cleanFeature, isInternalProperty, getColorUsage };

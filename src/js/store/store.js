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
    compareVersions
} from './repository.utils.js';
import { resetMemoryStore, memoryStore } from './memory-store.js';
import { setStoreErrorEventBus } from './store-errors.js';
import { registerStoreErrorListeners } from './store-error-listener.js';
import {
    initializeRepository,
    clearAllMapData,
    clearAllImageData,
    clearAllAppSettings,
    clearAllGroupData,
    clearAllLayerData,
    clearAllCesium3dData,
    clearAllStreetview360Data,
    clearAllBriefingData,
    setAppSetting,
    getColorUsage
} from './repository.js';

import mapManager from './store-state-manager.js';
import { mapResolver, awaitMapResolverReady } from './services/map-resolver.service.js';
import { EventTypes } from '../events';

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
    getCurrentMapNameSync,
    isCurrentMapLockedSync
} from './map.operations.js';
import {
    setLayerDependencies,
    deleteLayerOnly
} from './layer.operations.js';
import { setGroupDependencies } from './group.operations.js';
import { setCesium3dDependencies, loadCesium3dDataToMemory, clearCesium3dCache } from './cesium3d.operations.js';
import { setStreetview360Dependencies, loadStreetview360DataToMemory, clearStreetview360Cache } from './streetview360.operations.js';

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

    const dependencies = { eventBus, groupManager, layerManager };
    setFeatureDependencies(dependencies);
    setMapDependencies(dependencies);
    setLayerDependencies(dependencies);
    setGroupDependencies(dependencies);
    setCesium3dDependencies({ eventBus });
    setStreetview360Dependencies({ eventBus });

    setStoreErrorEventBus(eventBus);
    registerStoreErrorListeners(eventBus);
}

// ===== INITIALIZATION =====

/**
 * Loads all map-scoped data (groups, layers, 3D, 360) into memory.
 *
 * @param {string} mapName - Map to load
 * @returns {Promise<void>}
 */
async function loadMapDataToMemory(mapName) {
    await deps.groupManager.loadGroupsToMemory(mapName);
    await deps.layerManager.loadLayersToMemory(mapName);
    await loadCesium3dDataToMemory(mapName);
    await loadStreetview360DataToMemory(mapName);
}

/**
 * Initialize with last active map.
 *
 * @returns {Promise<string>} Last active map name
 */
export async function initializeWithLastActiveMap() {
    const lastActiveMap = await initializeRepository();
    await awaitMapResolverReady();
    await mapManager.setCurrentMap(lastActiveMap);
    await mapManager.initializeProjectColorCache();
    await loadMapDataToMemory(lastActiveMap);

    // Emit lock state so UI components created later can read it via isCurrentMapLockedSync().
    // Components that init before this resolves will pick it up via MAP_LOCK_CHANGED listener.
    const locked = memoryStore.lockedMaps.has(lastActiveMap);
    deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, { mapName: lastActiveMap, locked });

    return lastActiveMap;
}

// ===== CLEANUP OPERATIONS =====

/**
 * Clears all data from storage and reinitializes with defaults.
 *
 * @returns {Promise<void>}
 */
export async function clearAllDataStore() {
    resetMemoryStore();
    mapResolver.clear();
    await clearAllMapData();
    await clearAllImageData();
    await clearAllAppSettings();
    await clearAllGroupData();
    await clearAllLayerData();
    await clearAllCesium3dData();
    await clearAllStreetview360Data();
    await clearAllBriefingData();

    await mapManager.clearAllColorCaches();

    deps.layerManager.clearLayersCache();
    clearCesium3dCache();
    clearStreetview360Cache();

    await setAppSetting('schemaVersion', SCHEMA_VERSION);

    deps.eventBus.emit(EventTypes.ALL_DATA_CLEARED);

    const defaultMap = await initializeRepository();
    await mapManager.setCurrentMap(defaultMap);
    await loadMapDataToMemory(defaultMap);

    deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
}

// ===== DELETE LAYER WITH FEATURES =====

/**
 * Deletes a layer and all its features.
 *
 * @param {string} layerId - Layer ID to delete
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<Object>} Deletion result
 */
export async function deleteLayer(layerId, mapName = null) {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot delete layer.');
        return { success: false, reason: 'MAP_LOCKED' };
    }
    await deleteLayerFeatures(layerId, mapName);
    return deleteLayerOnly(layerId, mapName);
}

// ===== UNDO/REDO SYSTEM =====

/** Feature operation executors passed to the undo/redo engine. */
const undoRedoExecutors = {
    addFeature,
    updateFeature,
    removeFeature,
    addFeatureToMap,
    removeFeatureFromMap
};

/**
 * Undoes the last action.
 *
 * @returns {Promise<Object|false>} The undone action object, or false if nothing to undo
 */
export async function undoLastAction() {
    if (isCurrentMapLockedSync()) return false;

    try {
        return await mapManager.undoLastAction(undoRedoExecutors);
    } catch (error) {
        console.error('Undo failed:', error);
        return false;
    }
}

/**
 * Redoes the last undone action.
 *
 * @returns {Promise<Object|false>} The redone action object, or false if nothing to redo
 */
export async function redoLastAction() {
    if (isCurrentMapLockedSync()) return false;

    try {
        return await mapManager.redoLastAction(undoRedoExecutors);
    } catch (error) {
        console.error('Redo failed:', error);
        return false;
    }
}

// ===== BATCH UNDO/REDO =====

/**
 * Starts collecting undo actions into a single batch entry.
 * All recordAction() calls between start and commit are grouped.
 */
export function startBatchUndo() {
    return mapManager.startBatchCollection();
}

/**
 * Commits collected actions as a single batch undo entry.
 */
export function commitBatchUndo() {
    return mapManager.commitBatchCollection();
}

/**
 * Discards collected batch actions without recording.
 */
export function discardBatchUndo() {
    return mapManager.discardBatchCollection();
}

// ===== MOVE FEATURES TO LAYER =====

/**
 * Moves features to another layer and emits LAYERS_CHANGED on success.
 *
 * @param {Array} featureRefs - Array of layer IDs or feature references
 * @param {string} targetLayerId - Target layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function moveFeaturesToLayer(featureRefs, targetLayerId, mapName = null) {
    const modified = await moveFeaturesToLayerBase(featureRefs, targetLayerId, mapName);
    if (modified) {
        const targetMap = mapName || getCurrentMapNameSync();
        deps.eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: targetMap });
    }
}

// ===== RE-EXPORTS FROM CONSTANTS =====

export {
    FEATURE_TYPE_ICONS,
    FEATURE_TYPE_LAYERS,
    DEFAULT_MAP_NAME,
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
    isFeatureEffectivelyLocked,
    getLayerFeatures,
    buildLayerMappingForMove
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
    getCurrentMapIdSync,
    getCurrentMapInfoSync,
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
    getAllMapBadgeColors,
    isMapLocked,
    isCurrentMapLockedSync,
    toggleMapLock,
    setBriefingLockOverride
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
    hasMapNotes,
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
    updateCatalogLayerStatus,
    revalidateCatalogLayers
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
    updateMarker,
    removeMarker,
    loadCesium3dDataToMemory,
    clearCesium3dCache,
    setCesium3dDataForImport,
    getCesium3dDataForExport,
    DEFAULT_MARKER_STYLE,
    DEFAULT_MEASUREMENT_STYLE,
    addMarkerImage,
    getMarkerImages,
    removeMarkerImage,
    addMeasurement,
    getMeasurements,
    getAllMeasurements,
    getMeasurementById,
    updateMeasurement,
    removeMeasurement,
    addMeasurementImage,
    getMeasurementImages,
    removeMeasurementImage,
    addViewshed,
    getViewsheds,
    getAllViewsheds,
    getViewshedById,
    updateViewshed,
    removeViewshed,
    addViewshedImage,
    getViewshedImages,
    removeViewshedImage,
    removeMarkersByTileset,
    removeMeasurementsByTileset,
    removeViewshedsByTileset,
    removeAllFeaturesByTileset
} from './cesium3d.operations.js';

// ===== RE-EXPORTS FROM STREET VIEW 360 OPERATIONS =====

export {
    saveOrientation,
    getOrientation,
    hasOrientation,
    clearOrientation,
    getAllOrientations,
    addMarker360,
    getMarkers360,
    getAllMarkers360,
    getMarker360ById,
    updateMarker360,
    removeMarker360,
    removeMarkers360ByPhoto,
    addMarker360Image,
    getMarker360Images,
    removeMarker360Image,
    loadStreetview360DataToMemory,
    clearStreetview360Cache,
    getStreetview360DataForExport,
    setStreetview360DataForImport,
    DEFAULT_MARKER_360_STYLE
} from './streetview360.operations.js';

// ===== LEGACY COMPATIBILITY EXPORTS =====

export { SCHEMA_VERSION, MIN_SCHEMA_VERSION, MAX_SCHEMA_VERSION };
export { compareVersions, cleanFeature, isInternalProperty, getColorUsage };

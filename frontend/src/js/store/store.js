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
import { ATLAS_SCHEMA_VERSION } from './atlas/atlas.entity.js';
import { resetMemoryStore, memoryStore } from './memory-store.js';
import { setStoreErrorEventBus } from './store-errors.js';
import { registerStoreErrorListeners } from './store-error-listener.js';
import {
    initializeRepository,
    clearAllAtlasStores,
    setAppSetting,
    getColorUsage
} from './repository.js';

import mapManager from './store-state-manager.js';
import { mapResolver, awaitMapResolverReady } from './services/map-resolver.service.js';
import { EventTypes } from '../events';
import { sessionContext } from './sync/session-context.js';
import { loadStoreOrigin, isRemoteStoreSync, markStoreLocal } from './store-origin.js';
import { operationQueue } from './sync/operation-queue.js';

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
 * Unmounts the atlas that is currently mounted: drops the in-memory mirrors and EMPTIES
 * every per-atlas database, plus the outbound operation queue.
 *
 * UNMOUNT IS NOT DESTROY, and keeping the two apart is the point of this function. It
 * calls `clear()`, which empties a database and leaves it standing: the slot survives and
 * is immediately usable again, which is what every caller here wants (a logout, a switch
 * of atlas, a "clear everything"). DELETING the databases of a slot is a different
 * operation with a different owner (`dropAtlasDatabases`, reached by deleting a named
 * local atlas), and it must never be reached from here: it would destroy the workspace of
 * a user who only logged out.
 *
 * The queue goes with the atlas on purpose: it is global to the installation, so an
 * operation born in the atlas being abandoned would otherwise survive and be pushed into
 * whichever atlas is connected next (inv 2/3, same reason the atlas record is cleared).
 *
 * The list of databases is DERIVED (`clearAllAtlasStores`, from `STORE_DESCRIPTORS`), not
 * written out here. It used to be written out twice, once per caller below, with nothing
 * forcing the two copies to agree.
 *
 * @returns {Promise<void>}
 */
async function unmountCurrentAtlas() {
    resetMemoryStore();
    mapResolver.clear();
    await clearAllAtlasStores();
    await operationQueue.clear();
}

/**
 * Additive boot guard: if the local IndexedDB currently holds a REMOTE (server) atlas but
 * nobody is authenticated — the JWT expired, or the tab was closed without logging out —
 * that remote data must not remain editable offline. Discard it back to a blank local
 * atlas; the user must re-open from the server (when logged in) or work from a downloaded
 * `.ebgeo`.
 *
 * This NEVER fires for the standalone offline/local user: the origin marker defaults to
 * 'local' (and is absent for every pre-existing offline user), so their IndexedDB data and
 * `.ebgeo` workflow are completely untouched. Item 8 (session restore) runs BEFORE this, so
 * a returning authenticated user keeps their session and reconnects instead of being wiped.
 *
 * @returns {Promise<void>}
 */
async function enforceLocalStoreWhenLoggedOut() {
    await loadStoreOrigin();
    if (!isRemoteStoreSync() || sessionContext.isAuthenticated()) {
        return;
    }
    await unmountCurrentAtlas();
    await markStoreLocal();
}

/**
 * Initialize with last active map.
 *
 * @returns {Promise<string>} Last active map name
 */
export async function initializeWithLastActiveMap() {
    await enforceLocalStoreWhenLoggedOut();
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
    await unmountCurrentAtlas();

    await mapManager.clearAllColorCaches();

    deps.layerManager.clearLayersCache();
    clearCesium3dCache();
    clearStreetview360Cache();

    // A cleared store is a BRAND-NEW (empty) repository rebuilt at the current schema by
    // initializeRepository (getEmptyMapData already produces v2.2 structures) — stamp it at the
    // CURRENT version so the no-op Atlas migration chain does NOT re-run on every project open.
    // Migrations are only for OLD pre-existing repositories carrying data at an older version.
    await setAppSetting('schemaVersion', ATLAS_SCHEMA_VERSION);
    // A full clear always lands on a blank LOCAL atlas (the offline default). A subsequent
    // server connect re-marks the store REMOTE (markStoreRemote).
    await markStoreLocal();

    const defaultMap = await initializeRepository();
    await mapManager.setCurrentMap(defaultMap);
    await loadMapDataToMemory(defaultMap);

    // Emit AFTER the blank default map is current + loaded, so ALL_DATA_CLEARED listeners (notably the
    // base-layer control re-running setupMapFeatures) repopulate the live map sources from the now
    // EMPTY map — clearing every feature the old map left drawn on the canvas (no traces after logout).
    deps.eventBus.emit(EventTypes.ALL_DATA_CLEARED);

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
    shiftMapTemporalTimes,
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
    activateAtlasInitialMap,
    getCurrentMapName,
    getCurrentMapNameSync,
    getCurrentMapIdSync,
    getCurrentMapInfoSync,
    setSchemaVersion,
    getMapDataStore,
    hasAnyMapFeatures,
    getCurrentBaseLayer,
    setBaseLayer,
    updateMapPosition,
    getMapPosition,
    hasMapSavedPosition,
    clearMapPosition,
    getFrequentColors,
    getMapBadgeColors,
    getAllMapBadgeColors,
    getOrderedMapBadgeColors,
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
    setLayerOpacity,
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
    hasImage,
    removeImage
} from './settings.operations.js';

// ===== RE-EXPORTS FROM TEMPORAL OPERATIONS =====

export {
    getMapTemporalConfig,
    getMapTemporalConfigSync,
    isMapTemporalEnabled,
    isMapTemporalEnabledSync,
    setMapTemporalConfig,
    toggleMapTemporal
} from './temporal.operations.js';

// ===== RE-EXPORTS FROM CUSTOM ICON OPERATIONS =====

export {
    getCustomIcons,
    addCustomIcon,
    getCustomIconBlob,
    getCustomIconsForExport,
    restoreCustomIconsFromImport
} from './customIcons.operations.js';

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

// ===== RE-EXPORTS FROM STORE ORIGIN (local vs remote-temporary separation) =====

export {
    markStoreRemote,
    markStoreLocal,
    isRemoteStoreSync,
    getStoreOriginSync,
    loadStoreOrigin,
    StoreOriginKind
} from './store-origin.js';

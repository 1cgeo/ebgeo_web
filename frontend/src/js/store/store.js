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
import {
    loadStoreOrigin,
    isRemoteStoreSync,
    markStoreLocal,
    getStoreOriginSync,
    resolveTabMountOrigin
} from './store-origin.js';
import { purgeAllRemoteAtlases, purgeReachedAtlas } from './remote-atlas.api.js';
import { activateCurrentLocalAtlasScope, initLocalAtlases } from './local-atlas.api.js';
import { operationQueue } from './sync/operation-queue.js';
import { migratePendingOperationsToScopedQueues } from './sync/operation-queue-migration.js';

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
 * every DATA database of that atlas.
 *
 * UNMOUNT IS NOT DESTROY, and keeping the two apart is the point of this function. It
 * calls `clear()`, which empties a database and leaves it standing: the slot survives and
 * is immediately usable again, which is what every caller here wants (a logout, a switch
 * of atlas, a "clear everything"). DELETING the databases of a slot is a different
 * operation with a different owner (`dropAtlasDatabases`, reached by deleting a named
 * local atlas), and it must never be reached from here: it would destroy the workspace of
 * a user who only logged out.
 *
 * THE OUTBOUND QUEUE IS NO LONGER SWEPT ALONG BY DEFAULT, and that is the whole of P11 in
 * one line. It used to be, for a reason that has expired: while the queue was one global
 * table, an operation born in the atlas being abandoned would have been pushed into
 * whichever atlas connected next, so leaving it was a leak. It is now a database per atlas
 * (`atlas-namespace.js`, Decision 2b), so that leak is structurally impossible, and clearing
 * it here became a NEW loss: `openRemoteAtlas` activates the namespace of the atlas it is
 * opening and unmounts three lines later, which aimed this call at the pending work of the
 * atlas being opened, seconds before the `connect` that would have drained it.
 *
 * So emptying the queue is now a decision of the caller. `clearQueue` defaults to true here
 * because the direct callers of this function (the boot guard) are abandoning the data those
 * operations describe; `clearAllDataStore` derives its own default from `markLocal`, which is
 * where the two shapes of wipe are told apart.
 *
 * The list of databases is DERIVED (`clearAllAtlasStores`, from `STORE_DESCRIPTORS`), not
 * written out here. It used to be written out twice, once per caller below, with nothing
 * forcing the two copies to agree.
 *
 * @param {object} [options]
 * @param {boolean} [options.clearQueue=true] - Whether to also empty the outbound queue of
 *   the mounted atlas. Pass false when the caller is about to mount an atlas INTO this very
 *   namespace: the queue it would empty belongs to that atlas.
 * @returns {Promise<void>}
 */
async function unmountCurrentAtlas({ clearQueue = true } = {}) {
    resetMemoryStore();
    mapResolver.clear();
    await clearAllAtlasStores();
    if (clearQueue) {
        await operationQueue.clear();
    }
}

/**
 * Destroys every REMOTE atlas namespace registered on this machine, and re-points the store
 * at a local slot when the one it was using went with them.
 *
 * WHY IT IS DERIVED AND NOT AIMED. Each server atlas owns its own ten databases now
 * (`atlas-namespace.js` Decision 1), so "wipe the remote data" is no longer a fixed list of
 * names: it is whatever `remote-atlas.api.js` has registered, written by whichever tab
 * opened the atlas. Two consequences that make this function look wider than it is:
 *
 *   - it runs even when the origin marker says LOCAL, because the marker only describes
 *     the atlas THIS tab last mounted, while the residue is whatever ANY tab opened. An
 *     entry left by a tab that crashed is collected here, on the next boot with no session.
 *   - it is not part of unmounting an atlas. Unmounting empties the mounted one; this
 *     destroys every server namespace, and only ever runs when nobody is authenticated.
 *
 * IT IS CALLED BY NAME, NEVER AS A SIDE EFFECT. Two callers, and both mean "the session is
 * over": the boot guard below and `AccountControl._handleLogout`. It used to hang off
 * `clearAllDataStore` under a `!isAuthenticated` test, which made every anonymous wipe a
 * logout: the public-link visitor destroyed the namespace it had just registered.
 *
 * IT NO LONGER DESTROYS EVERYTHING UNCONDITIONALLY. A namespace another live client has mounted
 * is SPARED (`report.spared`, arbitrated by a Web Lock, Decision 5 of `atlas-namespace.js`), its
 * registry entry survives, and a deadline makes the reprieve temporary. The scope this tab had
 * mounted is never among them: the sweep lets go of its own mount before asking.
 *
 * @returns {Promise<import('./remote-atlas.api.js').RemotePurgeReport>}
 */
export async function discardRemoteAtlasNamespaces() {
    const report = await purgeAllRemoteAtlases();
    if (report.deactivated) {
        // The purge left no active scope on purpose (a destroyed scope must not be written
        // to again). A false here is not a failure: the repository bridge then activates the
        // legacy local databases, which is where a pre-namespace installation already was.
        activateCurrentLocalAtlasScope();
    }
    return report;
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
 * TWO GUARDS, NOT ONE, and the wider one comes first: with no session, no REMOTE NAMESPACE
 * may exist at all, whatever the marker says (`discardRemoteAtlasNamespaces`). Only then
 * does the marker decide whether the MOUNTED atlas also has to be emptied, which is the
 * pre-namespace case where server data sat in the unsuffixed databases.
 *
 * A SPARED NAMESPACE COUNTS AS REACHED (`purgeReachedAtlas`), and it has to: it appears in
 * neither `atlases` nor `adopted`, so a predicate that ignored it would answer false here and
 * send the second wipe over the legacy bridge, emptying the user's local slot #1 at boot,
 * without an error. The opposite half is P3: a registered namespace that never received a byte
 * does NOT count, because a destruction that never had anything to destroy must not talk this
 * guard out of the wipe that matters.
 *
 * AND THE SECOND GUARD IS CONDITIONAL NOW, which is the whole of `purgeReachedAtlas`. It runs
 * BEFORE `activateBootAtlasScope`, so the scope it empties is whatever the repository bridge
 * resolves, i.e. the UNSUFFIXED databases, i.e. the user's local slot #1. That was the right
 * target while a server atlas lived in those very databases; once the atlas owns a namespace the
 * sweep above has already emptied it, and running this second wipe would destroy local work in
 * order to finish a job that is already done.
 *
 * @returns {Promise<void>}
 */
async function enforceLocalStoreWhenLoggedOut() {
    await loadStoreOrigin();
    if (sessionContext.isAuthenticated()) {
        return;
    }
    const report = await discardRemoteAtlasNamespaces();

    if (!isRemoteStoreSync()) {
        return;
    }
    if (!purgeReachedAtlas(report, getStoreOriginSync().atlasId)) {
        await unmountCurrentAtlas();
    }
    await markStoreLocal();
}

/**
 * Activates the atlas namespace this boot works in, from the PERSISTED origin and the LIVE
 * session. It is the boot's single entry into `local-atlas.api.js`, and the one call that makes
 * the namespace machinery real for anything other than the schema migration.
 *
 * WHY IT COMES AFTER THE LOGGED-OUT GUARD, and not before. The guard's second wipe has to land on
 * the unsuffixed databases in the pre-namespace case (see `enforceLocalStoreWhenLoggedOut`), and
 * this call would have pointed the store at a registry slot before it ran, aiming that wipe at a
 * fresh empty slot and leaving the server data on disk unreferenced. Reading the origin AFTER the
 * guard is also what makes the two agree: the guard may have just re-marked the store LOCAL, and
 * passing the stale REMOTE marker here would ask for a namespace that no longer holds anything.
 *
 * AND IT IS THE ONE CALLER THAT ASKS THE QUESTION PER TAB. `getStoreOriginSync()` is the
 * INSTALLATION's answer, which is right for a tab that never mounted anything and wrong for one
 * that did: two tabs in two atlases share that marker, so a reload here would follow the
 * neighbour. `resolveTabMountOrigin` puts this tab's own mount pointer in front of it, and
 * `preferTabMountPointer` does the same for the choice of LOCAL slot
 * (`atlas-namespace.js`, Decision 6). The guard above deliberately keeps reading the global
 * marker: what it hunts is installation-wide residue that belongs to no tab.
 *
 * @returns {Promise<void>}
 */
async function activateBootAtlasScope() {
    await initLocalAtlases({
        origin: resolveTabMountOrigin(getStoreOriginSync()),
        isAuthenticated: sessionContext.isAuthenticated(),
        preferTabMountPointer: true
    });
    await routePendingOperationsToTheirAtlas();
}

/**
 * Sends the operations parked in the pre-namespace queue to the atlas they belong to.
 *
 * IT RUNS AFTER THE SCOPE IS ACTIVE, and it has to: the entries written before the stamp
 * existed carry no address, and the rule that places them ("they belong to the atlas mounted
 * at the time of the upgrade") has no subject until something is mounted.
 *
 * IT NEVER FAILS THE BOOT. The pass moves nothing it has not written and read back, so its
 * worst case is that pending work stays parked at the legacy address, which is where the
 * previous build kept it anyway. Turning that into a blank screen would trade a delay in
 * uploading for the loss of the whole session.
 * @returns {Promise<void>}
 */
async function routePendingOperationsToTheirAtlas() {
    try {
        const report = await migratePendingOperationsToScopedQueues();
        if (report.moved > 0 || report.failed > 0) {
            console.info(
                `Operation queue: ${report.moved} moved, ${report.kept} kept, ${report.failed} left behind`
            );
        }
    } catch (error) {
        console.warn('Operation queue migration failed; pending work stays where it is:', error);
    }
}

/**
 * Initialize with last active map.
 *
 * @returns {Promise<string>} Last active map name
 */
export async function initializeWithLastActiveMap() {
    await enforceLocalStoreWhenLoggedOut();
    await activateBootAtlasScope();
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
 * IT EMPTIES THE MOUNTED ATLAS AND NOTHING ELSE. This used to also sweep every registered
 * remote namespace whenever nobody was authenticated, and that condition was wrong in both
 * directions:
 *
 *   - it fired where it must not. The anonymous visitor of a public link registers a
 *     namespace and calls this three lines later (`index.js openPublicAtlasFromUrl`), so the
 *     wipe destroyed the namespace that same visit had just registered, and the public
 *     snapshot landed in the LOCAL slot instead. Same shape for the `.ebgeo` import and for
 *     "Limpar Tudo": they are not logouts, and they inherited a logout's behaviour.
 *   - it read the session instead of being told. A wipe is destructive, and what it destroys
 *     must be an argument, never something it infers about the world.
 *
 * The sweep is now called BY NAME on the two paths that mean "the session is over":
 * `enforceLocalStoreWhenLoggedOut` (boot guard) and `AccountControl._handleLogout`.
 * `discardRemoteAtlasNamespaces` is exported for the second one.
 *
 * MARKING LOCAL IS ALSO A DECISION OF THE CALLER now (`markLocal`, default true). The marker
 * is GLOBAL to the installation while a wipe belongs to one tab, so a tab that emptied its
 * own atlas was announcing "this machine is on a local atlas" on behalf of every other tab.
 * The caller that mounts an atlas next declares the origin; the caller that empties does not.
 *
 * THE OUTBOUND QUEUE FOLLOWS `markLocal` BY DEFAULT, and the coupling is meaning, not
 * coincidence. `markLocal: true` says "this wipe ENDS here, in a blank local store": the data
 * those pending operations describe is being abandoned with it, and keeping them would push
 * ghosts of deleted entities on the next connect. `markLocal: false` is passed by exactly the
 * three callers that mount a REMOTE atlas immediately afterwards (`openRemoteAtlas`,
 * `openPublicAtlasFromUrl`, `saveLocalToServer`), and by then the namespace is already the one
 * being opened, so the queue in reach is that atlas's own pending work. `clearQueue` is a
 * separate parameter and not a rename of `markLocal` so a caller that ever needs to split the
 * two can, instead of discovering the coupling by losing work.
 *
 * @param {object} [options]
 * @param {boolean} [options.markLocal=true] - Whether to leave the origin marker on LOCAL.
 *   Pass false when the caller mounts a REMOTE atlas straight after (it marks REMOTE itself)
 *   or when it must not speak for the whole installation.
 * @param {boolean} [options.clearQueue=markLocal] - Whether to also empty the outbound queue of
 *   the mounted atlas.
 *
 * @returns {Promise<void>}
 */
export async function clearAllDataStore({ markLocal = true, clearQueue = markLocal } = {}) {
    await unmountCurrentAtlas({ clearQueue });

    await mapManager.clearAllColorCaches();

    deps.layerManager.clearLayersCache();
    clearCesium3dCache();
    clearStreetview360Cache();

    // A cleared store is a BRAND-NEW (empty) repository rebuilt at the current schema by
    // initializeRepository (getEmptyMapData already produces v2.2 structures) — stamp it at the
    // CURRENT version so the no-op Atlas migration chain does NOT re-run on every project open.
    // Migrations are only for OLD pre-existing repositories carrying data at an older version.
    await setAppSetting('schemaVersion', ATLAS_SCHEMA_VERSION);
    if (markLocal) {
        await markStoreLocal();
    }

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

// ===== RE-EXPORTS FROM THE REMOTE ATLAS REGISTRY =====

// The connect path needs `activateRemoteAtlas` (it registers the namespace BEFORE the first
// write, which is the ordering the logout wipe depends on) and the unsynced-work rescue
// needs `adoptRemoteAtlasAsLocal`. Both are re-exported here because the call sites already
// import the facade, and reaching for the module directly is how a caller ends up using
// `activateScope(remoteScope(...))` instead, which skips the registration.

export { activateRemoteAtlas, listRemoteAtlases, purgeAllRemoteAtlases } from './remote-atlas.api.js';
export { adoptRemoteAtlasAsLocal } from './local-atlas.api.js';

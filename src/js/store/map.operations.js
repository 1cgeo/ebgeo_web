// Path: js/store/map.operations.js

/**
 * @fileoverview Map CRUD operations.
 */

import {
    getMapDataCompat,
    updateMapDataCompat,
    createMapCompat,
    deleteMapCompat,
    renameMapCompat,
    getAllMapKeysCompat,
    getSettingCompat,
    setSettingCompat,
    setMapNotesCompat,
    getRepository
} from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { memoryStore } from './memory-store.js';
import { mapResolver } from './services/map-resolver.service.js';
import config from '../config.js';
import { EventTypes } from '../events';
import { logMapOperation, logMapPositionOperation, logBaseLayerOperation, logAtlasSetting, OperationType, isOperationLoggingEnabled } from './sync/index.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { generateUUID, isValidUUID } from '../utilities/uuid.js';
import { createSyncMetadata, touchSyncMetadata } from './sync/sync-metadata.js';

// Repository aliases
const getMapData = getMapDataCompat;
const updateMapData = updateMapDataCompat;
const createMapData = createMapCompat;
const deleteMapData = deleteMapCompat;
const renameMapData = renameMapCompat;
const getAllMapNames = getAllMapKeysCompat;
const getAppSetting = getSettingCompat;
const setAppSetting = setSettingCompat;
const setMapNotesRepo = setMapNotesCompat;

async function getMapOrderRepo() {
    return await getSettingCompat('mapOrder') || [];
}

async function setMapOrderRepo(order) {
    await setSettingCompat('mapOrder', order);
}

// ===== DEPENDENCY INJECTION =====

/**
 * Module-level dependencies
 * @type {import('./store.types.js').StoreDependencies}
 */
const deps = {
    eventBus: null,
    groupManager: null,
    layerManager: null
};

/**
 * Sets dependencies for map operations.
 *
 * @param {import('./store.types.js').StoreDependencies} dependencies - Dependencies object
 */
export function setMapDependencies(dependencies) {
    Object.assign(deps, dependencies);
}

// ===== BRIEFING LOCK OVERRIDE =====

/**
 * When true, isCurrentMapLockedSync() always returns true.
 * Used during briefing edit/present modes to enforce read-only without persisting.
 */
let briefingLockOverride = false;

/**
 * Enables or disables the briefing lock override.
 * When active, all maps appear locked (read-only) without persisting the lock state.
 *
 * @param {boolean} active - True to force all maps locked
 */
export function setBriefingLockOverride(active) {
    briefingLockOverride = active;
    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, {
            mapName: memoryStore.currentMap,
            locked: active || memoryStore.lockedMaps.has(memoryStore.currentMap)
        });
    }
}

// ===== MAP CRUD OPERATIONS =====

/**
 * Gets all map names in order.
 *
 * @returns {Promise<string[]>} Array of map names
 */
export async function getAllMapNamesStore() {
    const allKeys = await getAllMapNames();

    // Storage keys are a mix of UUIDs (synced/atlas maps) and legacy names. Callers expect
    // display NAMES, so resolve each key (UUID→name) and de-dup — otherwise a peer's
    // UUID-keyed map renders as a raw UUID in the maps list (§item2). resolveToName is a
    // no-op for keys that are already names.
    const seen = new Set();
    const allMaps = [];
    for (const key of allKeys) {
        const name = mapResolver.resolveToName(key) || key;
        if (!seen.has(name)) {
            seen.add(name);
            allMaps.push(name);
        }
    }

    const savedOrder = await getMapOrderRepo();

    if (!savedOrder || savedOrder.length === 0) {
        return allMaps;
    }

    const orderedMaps = [];
    const remainingMaps = new Set(allMaps);

    for (const mapName of savedOrder) {
        if (remainingMaps.has(mapName)) {
            orderedMaps.push(mapName);
            remainingMaps.delete(mapName);
        }
    }

    for (const mapName of remainingMaps) {
        orderedMaps.push(mapName);
    }

    return orderedMaps;
}

/**
 * Gets the map order.
 *
 * @returns {Promise<string[]>} Ordered array of map names
 */
export async function getMapOrder() {
    return await getMapOrderRepo();
}

/**
 * Sets the map order.
 *
 * @param {string[]} orderArray - New map order
 * @returns {Promise<void>}
 */
export async function setMapOrder(orderArray) {
    await setMapOrderRepo(orderArray);
    // Sync the maps-list ordering as an atlas-level app setting (atlas.settings.mapOrder) so the
    // order converges across peers. Offline-safe: a no-op when not connected.
    await logAtlasSetting({ mapOrder: orderArray });
}

/**
 * Adds a new map.
 *
 * @param {string} mapName - Map name
 * @param {Object} [mapData=null] - Initial map data
 * @param {Object} [colorUsageData=null] - Color usage data
 * @param {Object} [notesData=null] - Notes data
 * @returns {Promise<Object>} Created map data
 */
export async function addMap(mapName, mapData = null, colorUsageData = null, notesData = null) {
    const perm = checkPermission(GuardAction.CREATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'addMap', reason: perm.reason });
        return null;
    }

    // When sync is active (connected to a remote atlas), store the new map UUID-keyed from the
    // start — the same keying synced/peer maps use — so a later snapshot re-apply (reconnect /
    // resync / a peer's import-merge-rename) updates the SAME entry instead of duplicating it
    // (a name-keyed local copy + a UUID-keyed snapshot copy of the same logical map).
    const syncActive = isOperationLoggingEnabled();
    const newMapData = await createMapData(mapName, mapData, { uuidKeyed: syncActive });

    const mapId = newMapData.id || mapName;
    if (mapId !== mapName) {
        mapResolver.registerMap(mapName, mapId);
    }

    mapManager.addMapToMemory(mapName);
    await mapManager.processMapColors(mapName, newMapData, colorUsageData);

    if (notesData && (notesData.title || notesData.description)) {
        await setMapNotesRepo(mapName, notesData);
    }

    logMapOperation(OperationType.CREATE, mapId, newMapData);

    // Announce the new map locally so listeners (maps list, locked banner) refresh and the
    // sync auto-flush trigger fires promptly instead of waiting a full interval (§item2).
    // The remote handler emits the same event when a peer's map arrives; the creator only
    // emits here, so there is no double-handling.
    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MAP_CREATED, { mapName, mapId });
    }

    return newMapData;
}

/**
 * Removes a map.
 *
 * @param {string} mapName - Map name to remove
 * @returns {Promise<import('./store.types.js').RemoveResult>} Removal result
 */
export async function removeMap(mapName) {
    const perm = checkPermission(GuardAction.DELETE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'removeMap', reason: perm.reason });
        return { success: false, reason: 'PERMISSION_DENIED' };
    }

    const allMaps = await getAllMapNames();

    if (allMaps.length <= 1) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'removeMap',
            reason: 'Não é possível deletar o último mapa'
        });
        return { success: false, reason: 'LAST_MAP' };
    }

    const mapData = await getMapData(mapName);
    if (!mapData || Object.keys(mapData).length === 0) {
        console.warn(`Tentativa de remover mapa inexistente: ${mapName}`);
        return { success: false, reason: 'MAP_NOT_FOUND' };
    }

    const mapId = mapResolver.resolveToId(mapName) || mapName;

    const currentMapName = mapManager.getCurrentMapName();
    const isCurrentMap = mapName === currentMapName;
    const remainingMaps = allMaps.filter(name => name !== mapName);

    await deleteMapData(mapName);

    if (isValidUUID(mapId)) {
        mapResolver.unregisterMapById(mapId);
    }

    await mapManager.removeMapFromMemory(mapName);
    await deps.groupManager.clearMapGroups(mapName);

    const colors = await getAppSetting('mapBadgeColors');
    if (colors?.[mapName]) {
        delete colors[mapName];
        await setMapBadgeColors(colors);
    }

    if (isCurrentMap) {
        await setCurrentMap(remainingMaps[0]);
    }

    logMapOperation(OperationType.DELETE, mapId, null, mapData);

    return {
        success: true,
        wasCurrentMap: isCurrentMap,
        remainingMapsCount: remainingMaps.length,
        newCurrentMap: isCurrentMap ? remainingMaps[0] : currentMapName
    };
}

/**
 * Renames a map.
 *
 * @param {string} oldName - Current map name
 * @param {string} newName - New map name
 * @returns {Promise<void>}
 */
export async function renameMap(oldName, newName) {
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'renameMap', reason: perm.reason });
        return;
    }

    if (memoryStore.lockedMaps.has(oldName)) {
        console.warn('Map is locked. Cannot rename.');
        return;
    }

    const oldMapData = await getMapData(oldName);
    const mapId = mapResolver.resolveToId(oldName) || oldName;

    await renameMapData(oldName, newName);
    mapManager.renameMapInMemory(oldName, newName);

    mapResolver.renameMap(oldName, newName);

    const order = await getMapOrderRepo();
    if (order?.length > 0) {
        const idx = order.indexOf(oldName);
        if (idx !== -1) {
            order[idx] = newName;
            await setMapOrderRepo(order);
        }
    }

    const colors = await getAppSetting('mapBadgeColors');
    if (colors?.[oldName]) {
        colors[newName] = colors[oldName];
        delete colors[oldName];
        await setMapBadgeColors(colors);
    }

    if (mapManager.getCurrentMapName() === newName) {
        await deps.groupManager.loadGroupsToMemory(newName);
    }

    const newMapData = await getMapData(newName);
    logMapOperation(OperationType.UPDATE, mapId, newMapData, oldMapData);
}

/**
 * Sets the current map.
 *
 * @param {string} mapName - Map name to set as current
 * @returns {Promise<void>}
 */
export async function setCurrentMap(mapName) {
    await mapManager.setCurrentMap(mapName);
    await deps.groupManager.loadGroupsToMemory(mapName);
    await deps.layerManager.loadLayersToMemory(mapName);

    const locked = memoryStore.lockedMaps.has(mapName);
    deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, { mapName, locked });
}

/**
 * Activates the atlas's map after connecting to a server atlas. Opening an atlas
 * pulls its maps into the store but leaves the app on the LOCAL default map
 * ("Principal"), so the user would not see (or sync onto) the shared content. Atlas
 * maps carry a real UUID `id` (the local default does not), so we switch to the
 * first UUID-keyed map. No-op when there is none (e.g. a brand-new empty atlas).
 *
 * @returns {Promise<string|null>} The activated map name, or null when none exists.
 */
export async function activateAtlasInitialMap() {
    const repo = getRepository();
    const all = await repo.getAllMaps();
    const entries = all instanceof Map ? [...all.entries()] : Object.entries(all || {});

    // This runs only AFTER connecting to a server atlas, where every map is UUID-keyed. A
    // NON-UUID-keyed map is therefore a local stray — the offline default ('Principal') recreated
    // on boot. If an atlas map shares that name, the stray SHADOWS it on name-based reads
    // (repo.getMap('Principal') direct-hits the stray's key), so the user would land on an EMPTY
    // map. Drop the strays so name resolution reaches the real (UUID-keyed) atlas map.
    const uuidMaps = [];
    for (const [key, data] of entries) {
        if (data && isValidUUID(data.id)) {
            uuidMaps.push(data);
        } else {
            // Local stray (no UUID id) — delete by its storage key so it can't shadow a remote map.
            await repo.deleteMap?.(key);
        }
    }

    let atlasMap = uuidMaps.find((m) => m && m.name) || uuidMaps[0];
    if (!atlasMap) {
        // Brand-new EMPTY atlas: no UUID-keyed map. Create a first atlas map so the user edits a
        // SYNCED map from the start — addMap assigns a UUID and logs a CREATE op that reaches
        // collaborators (§item3). Blocked for a viewer (returns null), which is fine.
        const created = await addMap('Mapa 1');
        if (!created) return null;
        atlasMap = created;
    }
    await setCurrentMap(atlasMap.name);
    return atlasMap.name;
}

/**
 * Gets the current map name (async, from IndexedDB).
 *
 * @returns {Promise<string>} Current map name
 */
export async function getCurrentMapName() {
    return await getAppSetting('lastActiveMap');
}

/**
 * Gets the current map name synchronously.
 *
 * @returns {string} Current map name
 */
export function getCurrentMapNameSync() {
    return mapManager.getCurrentMapName();
}

/**
 * Gets the current map UUID synchronously.
 * Uses MapResolverService for name -> ID resolution.
 *
 * @returns {string} Current map UUID (or name if resolver not initialized)
 */
export function getCurrentMapIdSync() {
    return mapManager.getCurrentMapId();
}

/**
 * Gets both current map name and ID synchronously.
 *
 * @returns {{name: string, id: string}} Object with name and id
 */
export function getCurrentMapInfoSync() {
    return mapManager.getCurrentMapInfo();
}

/**
 * Sets the last active map.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export async function setLastActiveMap(mapName) {
    await setAppSetting('lastActiveMap', mapName);
}

/**
 * Sets the schema version.
 *
 * @param {string} schemaVersion - Schema version
 * @returns {Promise<void>}
 */
export async function setSchemaVersion(schemaVersion) {
    await setAppSetting('schemaVersion', schemaVersion);
}

/**
 * Gets map data from storage.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<Object>} Map data
 */
export async function getMapDataStore(mapName) {
    return await getMapData(mapName);
}

/**
 * Whether ANY map in the store currently has at least one feature. Used to decide whether
 * replacing the local store (opening/creating a server atlas) would destroy local work and
 * therefore needs a confirmation + `.ebgeo` offer (inv 6).
 *
 * @returns {Promise<boolean>}
 */
export async function hasAnyMapFeatures() {
    const names = await getAllMapNamesStore();
    for (const name of names) {
        const data = await getMapData(name);
        const features = data?.features;
        if (features && Object.values(features).some((arr) => Array.isArray(arr) && arr.length > 0)) {
            return true;
        }
    }
    return false;
}

// ===== MAP CONFIGURATION =====

/**
 * Gets the current base layer for a map.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<string>} Base layer ID
 */
export async function getCurrentBaseLayer(mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    return currentMapData.baseLayer;
}

/**
 * Sets the base layer for a map.
 *
 * @param {string} layer - Base layer ID
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function setBaseLayer(layer, mapName = null) {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot change base layer.');
        return;
    }

    if (!config.basemaps[layer]?.enabled) {
        const fallback = config.getValidBasemapFallback();
        console.warn(`Base layer "${layer}" not enabled. Using "${fallback}".`);
        layer = fallback;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);
    const previousBaseLayer = currentMapData.baseLayer;

    currentMapData.baseLayer = layer;
    await updateMapData(targetMap, currentMapData);

    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    logBaseLayerOperation(OperationType.UPDATE, mapId, { baseLayer: layer }, { baseLayer: previousBaseLayer });
}

/**
 * Updates the map position.
 *
 * @param {number} center_lat - Center latitude
 * @param {number} center_long - Center longitude
 * @param {number} zoom - Zoom level
 * @param {number} bearing - Bearing
 * @param {number} pitch - Pitch
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function updateMapPosition(center_lat, center_long, zoom, bearing, pitch, mapName = null) {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot update position.');
        return;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMap);

    const existingPosition = currentMapData.savedPosition;
    const isUpdate = !!existingPosition?.id;
    const previousData = existingPosition ? { ...existingPosition } : null;

    const sync = existingPosition?.sync
        ? touchSyncMetadata(existingPosition.sync)
        : createSyncMetadata(null);

    currentMapData.savedPosition = {
        id: existingPosition?.id || generateUUID(),
        center_lat,
        center_long,
        zoom,
        bearing,
        pitch,
        savedAt: Date.now(),
        sync
    };

    // Legacy fields for backward compatibility
    currentMapData.center_lat = center_lat;
    currentMapData.center_long = center_long;
    currentMapData.zoom = zoom;
    currentMapData.bearing = bearing;
    currentMapData.pitch = pitch;

    await updateMapData(targetMap, currentMapData);

    const mapId = mapResolver.resolveToId(targetMap) || targetMap;
    const operationType = isUpdate ? OperationType.UPDATE : OperationType.CREATE;
    logMapPositionOperation(operationType, mapId, currentMapData.savedPosition, previousData);
}

/**
 * Gets the map position.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<import('./store.types.js').MapPosition>} Map position
 */
export async function getMapPosition(mapName) {
    const currentMapData = await getMapData(mapName);
    return {
        center_lat: currentMapData.center_lat,
        center_long: currentMapData.center_long,
        zoom: currentMapData.zoom,
        bearing: currentMapData.bearing,
        pitch: currentMapData.pitch
    };
}

const POSITION_FIELDS = ['center_lat', 'center_long', 'zoom', 'bearing', 'pitch'];

/**
 * Checks if a map has a saved position.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<boolean>} True if has saved position
 */
export async function hasMapSavedPosition(mapName = null) {
    const position = await getMapPosition(mapName);
    return POSITION_FIELDS.every(field => position[field] !== null);
}

/**
 * Clears the map position.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<void>}
 */
export async function clearMapPosition(mapName = null) {
    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot clear position.');
        return;
    }

    const targetMapName = mapName || mapManager.getCurrentMapName();
    const currentMapData = await getMapData(targetMapName);

    const existingPosition = currentMapData.savedPosition;
    const previousData = existingPosition ? { ...existingPosition } : null;
    const positionId = existingPosition?.id;

    delete currentMapData.savedPosition;

    for (const field of POSITION_FIELDS) {
        currentMapData[field] = null;
    }

    await updateMapData(targetMapName, currentMapData);

    if (positionId) {
        const mapId = mapResolver.resolveToId(targetMapName) || targetMapName;
        logMapPositionOperation(OperationType.DELETE, mapId, null, previousData);
    }
}

// ===== UNDO/REDO =====

/**
 * Undoes the last action.
 *
 * @param {Object} executeFunctions - Functions to execute undo
 * @returns {Promise<Object>} Undo result
 */
export async function undoLastAction(executeFunctions) {
    return await mapManager.undoLastAction(executeFunctions);
}

/**
 * Redoes the last undone action.
 *
 * @param {Object} executeFunctions - Functions to execute redo
 * @returns {Promise<Object>} Redo result
 */
export async function redoLastAction(executeFunctions) {
    return await mapManager.redoLastAction(executeFunctions);
}

// ===== COLOR TRACKING =====

/**
 * Gets frequently used colors.
 *
 * @param {number} [limit=10] - Maximum colors to return
 * @param {string} [scope='current'] - Scope ('current' or 'project')
 * @returns {string[]} Array of hex colors
 */
export function getFrequentColors(limit = 10, scope = 'current') {
    return mapManager.getFrequentColors(limit, scope);
}

// ===== MAP BADGE COLORS =====

/**
 * Map-badge palette: 10 visually-distinct hues (all ~600/700 weight, so white text reads
 * on them), ordered so that consecutive maps get strongly-contrasting neighbors. Colors are
 * assigned first-available (least-used) and persisted per map, so maps walk this sequence and
 * stay distinct until the palette is exhausted. This is the SINGLE source of a map's badge
 * color, shared by the current-map card, the maps-list badge, and the recent-map shortcut.
 */
const MAP_BADGE_COLORS = [
    '#2563eb', // blue
    '#dc2626', // red
    '#16a34a', // green
    '#9333ea', // purple
    '#ea580c', // orange
    '#0891b2', // cyan
    '#db2777', // pink
    '#65a30d', // lime
    '#4f46e5', // indigo
    '#ca8a04', // gold
];

/**
 * Finds the least-used color from the palette given current usage counts.
 *
 * @param {string[]} usedColors - Array of currently used color values
 * @returns {string} Least-used color from the palette
 */
function findLeastUsedColor(usedColors) {
    const colorCounts = {};
    for (const c of MAP_BADGE_COLORS) {
        colorCounts[c] = 0;
    }
    for (const c of usedColors) {
        if (colorCounts[c] !== undefined) {
            colorCounts[c]++;
        }
    }
    return MAP_BADGE_COLORS.reduce((min, c) =>
        colorCounts[c] < colorCounts[min] ? c : min
    , MAP_BADGE_COLORS[0]);
}

/**
 * Gets map badge colors from storage.
 *
 * @returns {Promise<Object>} Map of mapName -> color
 */
export async function getMapBadgeColors() {
    const colors = await getAppSetting('mapBadgeColors');
    return colors || {};
}

/**
 * Sets map badge colors to storage.
 *
 * @param {Object} colors - Map of mapName -> color
 * @returns {Promise<void>}
 */
export async function setMapBadgeColors(colors) {
    await setAppSetting('mapBadgeColors', colors);
    // datamodel-13: sync the full map-name→color object to the atlas. No-op offline
    // (operation logging disabled until connected); the backend deep-merges the
    // mapBadgeColors object into atlas.settings. Single chokepoint — add/remove/rename
    // all funnel through here.
    await logAtlasSetting({ mapBadgeColors: colors });
}

/**
 * Gets the badge color for a specific map.
 * If the map doesn't have a color, assigns one.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<string>} Hex color
 */
export async function getMapBadgeColor(mapName) {
    const colors = await getMapBadgeColors();

    if (colors[mapName]) {
        return colors[mapName];
    }

    const usedColors = Object.values(colors);
    const availableColor = MAP_BADGE_COLORS.find(c => !usedColors.includes(c));
    const newColor = availableColor || findLeastUsedColor(usedColors);

    colors[mapName] = newColor;
    await setMapBadgeColors(colors);
    return newColor;
}

/**
 * Removes the badge color for a map.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export async function removeMapBadgeColor(mapName) {
    const colors = await getMapBadgeColors();
    delete colors[mapName];
    await setMapBadgeColors(colors);
}

/**
 * Gets all map badge colors, assigning colors to maps that don't have one.
 *
 * @returns {Promise<Object>} Map of mapName -> color
 */
export async function getAllMapBadgeColors() {
    const allMaps = await getAllMapNames();
    const colors = await getMapBadgeColors();

    // Remove colors for maps that no longer exist
    const existingMapSet = new Set(allMaps);
    let changed = false;
    for (const mapName of Object.keys(colors)) {
        if (!existingMapSet.has(mapName)) {
            delete colors[mapName];
            changed = true;
        }
    }

    // Assign colors to maps that don't have one
    const usedColors = new Set(Object.values(colors));

    for (const mapName of allMaps) {
        if (!colors[mapName]) {
            const availableColor = MAP_BADGE_COLORS.find(c => !usedColors.has(c));
            const newColor = availableColor || findLeastUsedColor(Object.values(colors));

            colors[mapName] = newColor;
            usedColors.add(newColor);
            changed = true;
        }
    }

    if (changed) {
        await setMapBadgeColors(colors);
    }

    return colors;
}

/**
 * Derived (non-persistent) badge colors for the maps UI. Walks the distinct MAP_BADGE_COLORS
 * sequence by each map's POSITION in the canonical ordered name list, so neighbors never share
 * a hue and adjacent maps are always visibly different. Keyed by DISPLAY NAME — the exact key
 * every badge UI uses — so a map's color matches across the current-map card, the maps list,
 * and the recent-map rail (unlike the persisted store, which is keyed by raw UUID/name storage
 * keys and therefore misses on name lookups for synced maps).
 *
 * @returns {Promise<Object<string,string>>} Map of display name -> hex color
 */
export async function getOrderedMapBadgeColors() {
    const names = await getAllMapNamesStore();
    const colors = {};
    names.forEach((name, i) => {
        colors[name] = MAP_BADGE_COLORS[i % MAP_BADGE_COLORS.length];
    });
    return colors;
}

// ===== MAP LOCK (READ-ONLY) =====

/**
 * Gets lock state for a map (async, from IndexedDB).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} True if map is locked
 */
export async function isMapLocked(mapName = null) {
    const target = mapName || mapManager.getCurrentMapName();
    return !!(await getAppSetting(`mapLocked_${target}`));
}

/**
 * Gets lock state for current map (synchronous, from memory cache).
 * Use this in guards and hot paths that cannot await.
 *
 * @returns {boolean} True if current map is locked
 */
export function isCurrentMapLockedSync() {
    if (briefingLockOverride) return true;
    return memoryStore.lockedMaps.has(memoryStore.currentMap);
}

/**
 * Toggles lock state for a map.
 * Persists to IndexedDB, updates memory cache, emits MAP_LOCK_CHANGED.
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} New lock state
 */
export async function toggleMapLock(mapName = null) {
    const perm = checkPermission(GuardAction.LOCK_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, { operation: 'toggleMapLock', reason: perm.reason });
        return null;
    }

    const target = mapName || mapManager.getCurrentMapName();
    const current = await isMapLocked(target);
    const newState = !current;
    await setAppSetting(`mapLocked_${target}`, newState);
    if (newState) {
        memoryStore.lockedMaps.add(target);
    } else {
        memoryStore.lockedMaps.delete(target);
    }
    deps.eventBus.emit(EventTypes.MAP_LOCK_CHANGED, { mapName: target, locked: newState });
    return newState;
}

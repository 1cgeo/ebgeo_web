// Path: js/store/cesium3d.operations.js

/**
 * @fileoverview Cesium 3D CRUD operations.
 * Handles camera positions, markers, measurements, and viewsheds for 3D models.
 */

import { memoryStore } from './memory-store.js';
import { getCesium3dCompat, setCesium3dCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';
import { validateImageFile, processImageFile } from '../utilities/image_utils.js';
import { createSyncMetadata, touchSyncMetadata, isActive } from './sync/sync-metadata.js';
import { generateUUID } from '../utilities/uuid.js';
import { deepClone } from '../utilities/deep-utils.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { withSideDocument } from './document-lock.js';
import {
    logMarker3dOperation,
    logMeasurement3dOperation,
    logViewshed3dOperation,
    logCameraPosition3dOperation,
    OperationType
} from './sync/index.js';

/** @type {{ eventBus: import('../events/event_bus.js').EventBus | null }} */
const deps = { eventBus: null };

/**
 * Sets dependencies for cesium3d operations.
 * @param {{ eventBus: import('../events/event_bus.js').EventBus }} dependencies
 */
export function setCesium3dDependencies(dependencies) {
    deps.eventBus = dependencies.eventBus;
}

// ===== HELPERS =====

/**
 * Resolves map name, falling back to current map.
 * @param {string|null} mapName
 * @returns {string}
 */
function getTargetMapName(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/**
 * Permission gate for a 3D write. Emits STORE_OPERATION_BLOCKED when denied so the UI
 * shows the read-only toast, and — critically — stops the caller BEFORE the op is
 * queued: an op the server refuses (403) aborts the whole push batch and, since 403 is
 * not a permanent rejection, that batch is retried forever, freezing outbound sync
 * (including the comments a Comentarista IS allowed to write).
 *
 * The gate is hierarchical by construction (GuardAction → PermissionAction →
 * sessionContext.canPerformAction), so Manager/Owner/Admin pass without any closed
 * role list. Offline / local-only stores are always allowed (checkPermission, P1).
 *
 * @param {string} guardAction - Key from GuardAction
 * @param {string} operationName - Operation label carried in the error payload
 * @returns {boolean} True when the write may proceed
 */
function guardCesium3dWrite(guardAction, operationName) {
    const perm = checkPermission(guardAction);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: operationName,
            reason: perm.reason
        });
        return false;
    }
    return true;
}

/**
 * Gets cesium3d data from memory cache or loads from DB.
 * @param {string} mapName
 * @returns {Promise<Object>}
 */
async function getCesium3dDataWithCache(mapName) {
    if (memoryStore.cesium3d && memoryStore.cesium3d._mapName === mapName) {
        // Return a clone so mutators work on a throwaway copy. If the subsequent
        // persist fails, the live cache stays consistent with disk (mirrors
        // getMapDataCompat, which returns a fresh deserialized copy each call).
        return deepClone(memoryStore.cesium3d);
    }
    return getCesium3dCompat(mapName);
}

/**
 * Saves cesium3d data to memory cache and DB.
 * @param {string} mapName
 * @param {Object} data
 */
async function saveCesium3dData(mapName, data) {
    const dataToSave = { ...data };
    delete dataToSave._mapName;
    try {
        // Persistence-first: write to IndexedDB BEFORE updating the in-memory
        // cache, so a failed write cannot leave the cache diverged from disk.
        await setCesium3dCompat(mapName, dataToSave);
    } catch (error) {
        emitStoreError(StoreErrorEvents.STORE_PERSIST_ERROR, {
            operation: 'saveCesium3dData',
            error: error.message || String(error),
            timestamp: Date.now()
        });
        throw error;
    }
    memoryStore.cesium3d = { ...data, _mapName: mapName };
}

/**
 * Emits an event if the event bus is available.
 * @param {string} eventType
 * @param {Object} payload
 */
function emit(eventType, payload) {
    if (deps.eventBus) {
        deps.eventBus.emit(eventType, payload);
    }
}

/**
 * Gets the next auto-naming number for entities matching a pattern.
 * @param {Array} items - Existing items to scan
 * @param {RegExp} regex - Pattern with a capture group for the number
 * @param {function} [filter] - Optional filter predicate
 * @returns {number}
 */
function getNextAutoNumber(items, regex, filter) {
    let maxNumber = 0;
    for (const item of items) {
        if (filter && !filter(item)) continue;
        const match = item.properties?.nome?.match(regex);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) maxNumber = num;
        }
    }
    return maxNumber + 1;
}

/**
 * Reads user-defined default style from localStorage.
 * @param {string} storageKey
 * @returns {Object}
 */
function getUserDefaultStyle(storageKey) {
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved) return JSON.parse(saved);
    } catch (e) {
        console.warn(`Failed to parse saved style from ${storageKey}:`, e);
    }
    return {};
}

/**
 * Adds an image to an entity (marker, measurement, or viewshed).
 * @param {string} entityId - Entity ID
 * @param {File} file - Image file
 * @param {string} collectionKey - Key in cesium3d data ('markers', 'measurements', 'viewsheds')
 * @param {string} changeEvent - Event type to emit
 * @param {string|null} mapName
 * @param {Function} [logUpdate] - The entity's UPDATE sync logger (e.g. logMarker3dOperation). The
 *   image lives INLINE in the entity's `images[]`, so attaching it is an entity UPDATE that must
 *   propagate to peers (the `data` carries the new `images[]`); without this it stayed local.
 * @returns {Promise<Object|null>}
 */
async function addEntityImage(entityId, file, collectionKey, changeEvent, mapName, logUpdate) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, `addImage:${collectionKey}`)) return null;

    const validation = validateImageFile(file);
    if (!validation.valid) {
        console.warn(`Invalid image: ${validation.reason}`);
        return null;
    }

    try {
        const targetMap = getTargetMapName(mapName);
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data[collectionKey]) return null;

        const entityIndex = data[collectionKey].findIndex(e => e.id === entityId);
        if (entityIndex === -1) {
            console.warn(`Entity not found: ${entityId}`);
            return null;
        }

        const processedImage = await processImageFile(file);
        const imageData = {
            id: generateUUID(),
            name: file.name,
            type: file.type,
            size: file.size,
            data: processedImage.data,
            thumbnail: processedImage.thumbnail,
            addedAt: Date.now()
        };

        const entity = data[collectionKey][entityIndex];
        // Snapshot the pre-image state (shallow + a copy of images) for the op's oldData.
        const previousEntity = { ...entity, images: entity.images ? [...entity.images] : [] };
        if (!entity.images) entity.images = [];
        entity.images.push(imageData);
        entity.updatedAt = Date.now();
        entity.sync = touchSyncMetadata(entity.sync);

        await saveCesium3dData(targetMap, data);
        emit(changeEvent, { mapName: targetMap });

        // Persistence-first: only log the UPDATE op after the save succeeds.
        if (logUpdate) {
            logUpdate(OperationType.UPDATE, entityId, mapManager.getCurrentMapId(), entity, previousEntity);
        }

        return imageData;
    } catch (error) {
        console.error(`Error adding image to ${collectionKey}:`, error);
        return null;
    }
}

/**
 * Gets images for an entity.
 * @param {string} entityId
 * @param {string} collectionKey
 * @param {string|null} mapName
 * @returns {Promise<Array>}
 */
async function getEntityImages(entityId, collectionKey, mapName) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    const entity = (data[collectionKey] || []).find(e => e.id === entityId);
    return entity?.images || [];
}

/**
 * Removes an image from an entity.
 * @param {string} entityId
 * @param {string} imageId
 * @param {string} collectionKey
 * @param {string} changeEvent
 * @param {string|null} mapName
 * @param {Function} [logUpdate] - The entity's UPDATE sync logger (removing an inline image is an
 *   entity UPDATE that must propagate to peers).
 * @returns {Promise<boolean>}
 */
async function removeEntityImage(entityId, imageId, collectionKey, changeEvent, mapName, logUpdate) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, `removeImage:${collectionKey}`)) return false;

    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data[collectionKey]) return false;

    const entityIndex = data[collectionKey].findIndex(e => e.id === entityId);
    if (entityIndex === -1) return false;

    const entity = data[collectionKey][entityIndex];
    if (!entity.images) return false;

    const initialLength = entity.images.length;
    const previousEntity = { ...entity, images: [...entity.images] };
    entity.images = entity.images.filter(img => img.id !== imageId);

    if (entity.images.length < initialLength) {
        entity.updatedAt = Date.now();
        entity.sync = touchSyncMetadata(entity.sync);
        await saveCesium3dData(targetMap, data);
        emit(changeEvent, { mapName: targetMap });
        if (logUpdate) {
            logUpdate(OperationType.UPDATE, entityId, mapManager.getCurrentMapId(), entity, previousEntity);
        }
        return true;
    }
    return false;
}

/**
 * Removes all entities in a collection that belong to a specific tileset.
 * @param {string} tilesetId
 * @param {string} collectionKey
 * @param {string} changeEvent
 * @param {string|null} mapName
 * @param {Function} [logDelete] - The entity family's DELETE sync logger (e.g.
 *   logMarker3dOperation). A bulk removal is still a removal per entity: without one
 *   DELETE op each, wiping a tileset's entities stayed local and peers kept showing them.
 * @returns {Promise<number>}
 */
async function removeByTileset(tilesetId, collectionKey, changeEvent, mapName, logDelete) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, `removeByTileset:${collectionKey}`)) return 0;

    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data[collectionKey]) return 0;

    // Snapshot the entities being dropped so each one can carry its own oldData.
    const removed = data[collectionKey].filter(item => item.tilesetId === tilesetId);
    data[collectionKey] = data[collectionKey].filter(item => item.tilesetId !== tilesetId);

    if (removed.length > 0) {
        await saveCesium3dData(targetMap, data);
        emit(changeEvent, { mapName: targetMap });

        // getMapId(targetMap), NOT getCurrentMapId(): this function accepts an explicit
        // mapName and may operate on a map that is not the active one.
        const mapId = mapManager.getMapId(targetMap);
        for (const entity of removed) {
            logDelete?.(OperationType.DELETE, entity.id, mapId, null, entity);
        }
    }
    return removed.length;
}

// ===== CAMERA POSITION OPERATIONS =====

/**
 * Saves camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} position - Position { longitude, latitude, height }
 * @param {Object} orientation - Orientation { heading, pitch, roll }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<void>}
 */
export async function saveCameraPosition(tilesetId, position, orientation, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'saveCameraPosition')) return;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'saveCameraPosition', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        const existing = data.cameraPositions[tilesetId];
        const isUpdate = !!existing;
        const previousData = existing ? { ...existing } : null;

        const sync = existing?.sync
            ? touchSyncMetadata(existing.sync)
            : createSyncMetadata(null);

        data.cameraPositions[tilesetId] = {
            id: existing?.id || generateUUID(),
            tilesetId,
            position,
            orientation,
            savedAt: Date.now(),
            sync
        };

        await saveCesium3dData(targetMap, data);
        emit(EventTypes.CAMERA_3D_SAVED, { tilesetId, mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        const newPosition = data.cameraPositions[tilesetId];
        if (isUpdate) {
            logCameraPosition3dOperation(OperationType.UPDATE, newPosition.id, mapId, newPosition, previousData);
        } else {
            logCameraPosition3dOperation(OperationType.CREATE, newPosition.id, mapId, newPosition);
        }
    });
}

/**
 * Gets saved camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getCameraPosition(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.cameraPositions[tilesetId] || null;
}

/**
 * Checks if a tileset has a saved camera position.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function hasSavedCameraPosition(tilesetId, mapName = null) {
    const position = await getCameraPosition(tilesetId, mapName);
    return position !== null;
}

/**
 * Clears saved camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function clearCameraPosition(tilesetId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'clearCameraPosition')) return false;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'clearCameraPosition', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        const existing = data.cameraPositions[tilesetId];
        if (!existing) return false;

        const previousData = { ...existing };
        const positionId = existing.id || tilesetId;

        delete data.cameraPositions[tilesetId];
        await saveCesium3dData(targetMap, data);

        const mapId = mapManager.getCurrentMapId();
        logCameraPosition3dOperation(OperationType.DELETE, positionId, mapId, null, previousData);

        return true;
    });
}

/**
 * Gets all saved camera positions for a map.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Object with tilesetId as keys
 */
export async function getAllCameraPositions(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.cameraPositions || {};
}

// ===== MARKER OPERATIONS =====

/**
 * Default marker style configuration.
 */
export const DEFAULT_MARKER_STYLE = {
    markerColor: '#3f4fb5',
    markerSize: 32,
    markerOpacity: 1,
    showMarker: true,
    showLabel: true,
    labelText: '',
    labelColor: '#ffffff',
    labelBackgroundColor: '#3f4fb5',
    labelBackgroundOpacity: 0.9,
    labelSize: 14,
    labelOutlineColor: '#000000',
    labelOutlineWidth: 2
};

/**
 * Adds a new marker to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} markerData - Marker data { position, properties, style }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created marker
 */
export async function addMarker(tilesetId, markerData, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'addMarker')) return null;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'addMarker', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        const nextNumber = getNextAutoNumber(data.markers, /^Ponto #(\d+)$/);
        const defaultName = `Ponto #${nextNumber}`;
        const userDefaultStyle = getUserDefaultStyle('marker3d_default_style');

        const marker = {
            id: generateUUID(),
            tilesetId,
            position: markerData.position,
            properties: {
                nome: markerData.properties?.nome || defaultName,
                descricao: markerData.properties?.descricao || ''
            },
            style: {
                ...DEFAULT_MARKER_STYLE,
                ...userDefaultStyle,
                labelText: markerData.properties?.rotulo || '',
                ...(markerData.style || {})
            },
            sync: createSyncMetadata(null)
        };

        data.markers.push(marker);
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logMarker3dOperation(OperationType.CREATE, marker.id, mapId, marker);

        return marker;
    });
}

/**
 * Gets all markers for a specific tileset. Filters out soft-deleted markers.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMarkers(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers.filter(m => m.tilesetId === tilesetId && isActive(m.sync));
}

/**
 * Gets all markers for the current map. Filters out soft-deleted markers.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getAllMarkers(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.markers || []).filter(m => isActive(m.sync));
}

/**
 * Gets a marker by ID.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getMarkerById(markerId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers.find(m => m.id === markerId) || null;
}

/**
 * Updates a marker's properties, style, or position.
 *
 * Temporal validity (optional, additive) lives on `properties.temporalInicio`
 * and `properties.temporalFim` (epoch ms); pass them inside `updates.properties`
 * to persist a marker's visibility window.
 *
 * @param {string} markerId - Marker ID
 * @param {Object} updates - Properties to update { properties, style, position }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated marker or null if not found
 */
export async function updateMarker(markerId, updates, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'updateMarker')) return null;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'updateMarker', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        const markerIndex = data.markers.findIndex(m => m.id === markerId);
        if (markerIndex === -1) return null;

        const marker = data.markers[markerIndex];
        const oldMarker = { ...marker };

        if (updates.properties) {
            marker.properties = { ...marker.properties, ...updates.properties };
        }
        if (updates.style) {
            marker.style = { ...(marker.style || DEFAULT_MARKER_STYLE), ...updates.style };
        }
        if (updates.position) {
            marker.position = updates.position;
        }
        marker.sync = touchSyncMetadata(marker.sync);

        data.markers[markerIndex] = marker;
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logMarker3dOperation(OperationType.UPDATE, markerId, mapId, marker, oldMarker);

        return marker;
    });
}

/**
 * Removes a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMarker(markerId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeMarker')) return false;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'removeMarker', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        const deletedMarker = data.markers.find(m => m.id === markerId);
        if (!deletedMarker) return false;

        data.markers = data.markers.filter(m => m.id !== markerId);
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logMarker3dOperation(OperationType.DELETE, markerId, mapId, null, deletedMarker);

        return true;
    });
}

/**
 * Removes all markers for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>} Number of markers removed
 */
export async function removeMarkersByTileset(tilesetId, mapName = null) {
    return removeByTileset(tilesetId, 'markers', EventTypes.MARKERS_3D_CHANGED, mapName, logMarker3dOperation);
}

// ===== MEMORY OPERATIONS =====

/**
 * Loads cesium3d data to memory for a map.
 *
 * @param {string} mapName
 * @returns {Promise<void>}
 */
export async function loadCesium3dDataToMemory(mapName) {
    const data = await getCesium3dCompat(mapName);
    memoryStore.cesium3d = { ...data, _mapName: mapName };
}

/**
 * Clears cesium3d memory cache.
 */
export function clearCesium3dCache() {
    memoryStore.cesium3d = {
        cameraPositions: {},
        markers: [],
        measurements: [],
        viewsheds: [],
        _mapName: null
    };
}

// ===== IMPORT / EXPORT =====

/**
 * Sets cesium3d data for a map (used by import).
 *
 * @param {string} mapName
 * @param {Object} cesium3dData
 * @returns {Promise<void>}
 */
export async function setCesium3dDataForImport(mapName, cesium3dData) {
    const normalizedData = {
        cameraPositions: cesium3dData.cameraPositions || {},
        markers: cesium3dData.markers || [],
        measurements: cesium3dData.measurements || [],
        viewsheds: cesium3dData.viewsheds || []
    };

    await setCesium3dCompat(mapName, normalizedData);

    if (mapName === mapManager.getCurrentMapName()) {
        memoryStore.cesium3d = { ...normalizedData, _mapName: mapName };
        emit(EventTypes.MARKERS_3D_CHANGED, { mapName });
        emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName });
        emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName });
    }
}

/**
 * Gets cesium3d data for export. Returns null if no data exists.
 *
 * @param {string} mapName
 * @returns {Promise<Object|null>}
 */
export async function getCesium3dDataForExport(mapName) {
    const data = await getCesium3dCompat(mapName);

    const hasData = Object.keys(data.cameraPositions).length > 0
        || data.markers.length > 0
        || (data.measurements && data.measurements.length > 0)
        || (data.viewsheds && data.viewsheds.length > 0);

    if (!hasData) return null;

    return {
        cameraPositions: data.cameraPositions,
        markers: data.markers,
        measurements: data.measurements || [],
        viewsheds: data.viewsheds || []
    };
}

// ===== MARKER IMAGE OPERATIONS =====

/**
 * Adds an image to a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {File} file - Image file
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function addMarkerImage(markerId, file, mapName = null) {
    return addEntityImage(markerId, file, 'markers', EventTypes.MARKERS_3D_CHANGED, mapName, logMarker3dOperation);
}

/**
 * Gets all images for a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMarkerImages(markerId, mapName = null) {
    return getEntityImages(markerId, 'markers', mapName);
}

/**
 * Removes an image from a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string} imageId - Image ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMarkerImage(markerId, imageId, mapName = null) {
    return removeEntityImage(markerId, imageId, 'markers', EventTypes.MARKERS_3D_CHANGED, mapName, logMarker3dOperation);
}

// ===== MEASUREMENT OPERATIONS =====

/**
 * Default measurement style configuration.
 */
export const DEFAULT_MEASUREMENT_STYLE = {
    lineColor: '#FFFF00',
    lineWidth: 3,
    lineOpacity: 1,
    fillColor: '#FFFF00',
    fillOpacity: 0.2,
    labelColor: '#ffffff',
    labelSize: 14,
    labelOutlineColor: '#000000',
    labelOutlineWidth: 2,
    labelBackgroundColor: '#FFFF00',
    labelBackgroundOpacity: 0.8
};

/**
 * Adds a new measurement to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} measurementData - { type, positions, result, properties, style }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created measurement
 */
export async function addMeasurement(tilesetId, measurementData, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'addMeasurement')) return null;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'addMeasurement', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.measurements) data.measurements = [];

        const type = measurementData.type || 'distance';
        const prefix = type === 'distance' ? 'Distância' : 'Área';
        const nextNumber = getNextAutoNumber(
            data.measurements,
            new RegExp(`^${prefix} #(\\d+)$`),
            (m) => m.type === type
        );
        const defaultName = `${prefix} #${nextNumber}`;
        const userDefaultStyle = getUserDefaultStyle('measurement3d_default_style');

        const measurement = {
            id: generateUUID(),
            tilesetId,
            type,
            positions: measurementData.positions || [],
            result: measurementData.result || { value: 0, formatted: '' },
            properties: {
                nome: measurementData.properties?.nome || defaultName,
                descricao: measurementData.properties?.descricao || ''
            },
            style: {
                ...DEFAULT_MEASUREMENT_STYLE,
                ...userDefaultStyle,
                ...(measurementData.style || {})
            },
            images: [],
            sync: createSyncMetadata(null)
        };

        data.measurements.push(measurement);
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logMeasurement3dOperation(OperationType.CREATE, measurement.id, mapId, measurement);

        return measurement;
    });
}

/**
 * Gets all measurements for a specific tileset. Filters out soft-deleted.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMeasurements(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).filter(m => m.tilesetId === tilesetId && isActive(m.sync));
}

/**
 * Gets all measurements for the current map. Filters out soft-deleted.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getAllMeasurements(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).filter(m => isActive(m.sync));
}

/**
 * Gets a measurement by ID.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getMeasurementById(measurementId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).find(m => m.id === measurementId) || null;
}

/**
 * Updates a measurement's properties or style.
 *
 * @param {string} measurementId - Measurement ID
 * @param {Object} updates - { properties, style }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated measurement or null if not found
 */
export async function updateMeasurement(measurementId, updates, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'updateMeasurement')) return null;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'updateMeasurement', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.measurements) return null;

        const measurementIndex = data.measurements.findIndex(m => m.id === measurementId);
        if (measurementIndex === -1) return null;

        const measurement = data.measurements[measurementIndex];
        const oldMeasurement = { ...measurement };

        if (updates.properties) {
            measurement.properties = { ...measurement.properties, ...updates.properties };
        }
        if (updates.style) {
            measurement.style = { ...(measurement.style || DEFAULT_MEASUREMENT_STYLE), ...updates.style };
        }
        measurement.sync = touchSyncMetadata(measurement.sync);

        data.measurements[measurementIndex] = measurement;
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logMeasurement3dOperation(OperationType.UPDATE, measurementId, mapId, measurement, oldMeasurement);

        return measurement;
    });
}

/**
 * Removes a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMeasurement(measurementId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeMeasurement')) return false;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'removeMeasurement', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.measurements) return false;

        const deletedMeasurement = data.measurements.find(m => m.id === measurementId);
        if (!deletedMeasurement) return false;

        data.measurements = data.measurements.filter(m => m.id !== measurementId);
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logMeasurement3dOperation(OperationType.DELETE, measurementId, mapId, null, deletedMeasurement);

        return true;
    });
}

/**
 * Adds an image to a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {File} file - Image file
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function addMeasurementImage(measurementId, file, mapName = null) {
    return addEntityImage(measurementId, file, 'measurements', EventTypes.MEASUREMENTS_3D_CHANGED, mapName, logMeasurement3dOperation);
}

/**
 * Gets all images for a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getMeasurementImages(measurementId, mapName = null) {
    return getEntityImages(measurementId, 'measurements', mapName);
}

/**
 * Removes an image from a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string} imageId - Image ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeMeasurementImage(measurementId, imageId, mapName = null) {
    return removeEntityImage(measurementId, imageId, 'measurements', EventTypes.MEASUREMENTS_3D_CHANGED, mapName, logMeasurement3dOperation);
}

// ===== VIEWSHED OPERATIONS =====

/**
 * Adds a new viewshed to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} viewshedData - { position, targetPosition, terrainBaseHeight, direction, parameters, observerHeight, properties }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created viewshed
 */
export async function addViewshed(tilesetId, viewshedData, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'addViewshed')) return null;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'addViewshed', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.viewsheds) data.viewsheds = [];

        const nextNumber = getNextAutoNumber(data.viewsheds, /^Visibilidade #(\d+)$/);
        const defaultName = `Visibilidade #${nextNumber}`;

        const viewshed = {
            id: generateUUID(),
            tilesetId,
            position: viewshedData.position || { longitude: 0, latitude: 0, height: 0 },
            targetPosition: viewshedData.targetPosition || null,
            terrainBaseHeight: viewshedData.terrainBaseHeight ?? null,
            direction: viewshedData.direction || { heading: 0, pitch: 0 },
            parameters: viewshedData.parameters || { horizontalAngle: 150, verticalAngle: 120, distance: 10 },
            observerHeight: viewshedData.observerHeight ?? 1.5,
            properties: {
                nome: viewshedData.properties?.nome || defaultName,
                descricao: viewshedData.properties?.descricao || ''
            },
            images: [],
            sync: createSyncMetadata(null)
        };

        data.viewsheds.push(viewshed);
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logViewshed3dOperation(OperationType.CREATE, viewshed.id, mapId, viewshed);

        return viewshed;
    });
}

/**
 * Gets all viewsheds for a specific tileset. Filters out soft-deleted.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getViewsheds(tilesetId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).filter(v => v.tilesetId === tilesetId && isActive(v.sync));
}

/**
 * Gets all viewsheds for the current map. Filters out soft-deleted.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getAllViewsheds(mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).filter(v => isActive(v.sync));
}

/**
 * Gets a viewshed by ID.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function getViewshedById(viewshedId, mapName = null) {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).find(v => v.id === viewshedId) || null;
}

/**
 * Updates a viewshed's properties or observer height.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {Object} updates - { properties, observerHeight }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated viewshed or null if not found
 */
export async function updateViewshed(viewshedId, updates, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.CREATE_MARKER_3D, 'updateViewshed')) return null;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'updateViewshed', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.viewsheds) return null;

        const viewshedIndex = data.viewsheds.findIndex(v => v.id === viewshedId);
        if (viewshedIndex === -1) return null;

        const viewshed = data.viewsheds[viewshedIndex];
        const oldViewshed = { ...viewshed };

        if (updates.properties) {
            viewshed.properties = { ...viewshed.properties, ...updates.properties };
        }
        if (updates.observerHeight !== undefined) {
            viewshed.observerHeight = updates.observerHeight;
        }
        viewshed.sync = touchSyncMetadata(viewshed.sync);

        data.viewsheds[viewshedIndex] = viewshed;
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logViewshed3dOperation(OperationType.UPDATE, viewshedId, mapId, viewshed, oldViewshed);

        return viewshed;
    });
}

/**
 * Removes a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeViewshed(viewshedId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeViewshed')) return false;

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'removeViewshed', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.viewsheds) return false;

        const deletedViewshed = data.viewsheds.find(v => v.id === viewshedId);
        if (!deletedViewshed) return false;

        data.viewsheds = data.viewsheds.filter(v => v.id !== viewshedId);
        await saveCesium3dData(targetMap, data);
        emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logViewshed3dOperation(OperationType.DELETE, viewshedId, mapId, null, deletedViewshed);

        return true;
    });
}

/**
 * Adds an image to a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {File} file - Image file
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>}
 */
export async function addViewshedImage(viewshedId, file, mapName = null) {
    return addEntityImage(viewshedId, file, 'viewsheds', EventTypes.VIEWSHEDS_3D_CHANGED, mapName, logViewshed3dOperation);
}

/**
 * Gets all images for a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>}
 */
export async function getViewshedImages(viewshedId, mapName = null) {
    return getEntityImages(viewshedId, 'viewsheds', mapName);
}

/**
 * Removes an image from a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string} imageId - Image ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>}
 */
export async function removeViewshedImage(viewshedId, imageId, mapName = null) {
    return removeEntityImage(viewshedId, imageId, 'viewsheds', EventTypes.VIEWSHEDS_3D_CHANGED, mapName, logViewshed3dOperation);
}

// ===== BULK REMOVAL OPERATIONS =====

/**
 * Removes all measurements for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>}
 */
export async function removeMeasurementsByTileset(tilesetId, mapName = null) {
    return removeByTileset(tilesetId, 'measurements', EventTypes.MEASUREMENTS_3D_CHANGED, mapName, logMeasurement3dOperation);
}

/**
 * Removes all viewsheds for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>}
 */
export async function removeViewshedsByTileset(tilesetId, mapName = null) {
    return removeByTileset(tilesetId, 'viewsheds', EventTypes.VIEWSHEDS_3D_CHANGED, mapName, logViewshed3dOperation);
}

/**
 * Removes all features (markers, measurements, viewsheds) for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<{markers: number, measurements: number, viewsheds: number, total: number}>}
 */
export async function removeAllFeaturesByTileset(tilesetId, mapName = null) {
    if (!guardCesium3dWrite(GuardAction.DELETE_MARKER_3D, 'removeAllFeaturesByTileset')) {
        return { markers: 0, measurements: 0, viewsheds: 0, total: 0 };
    }

    const targetMap = getTargetMapName(mapName);
    // Leaf read-modify-write of the cesium3d document; see document-lock.js.
    return withSideDocument('cesium3d', targetMap, 'removeAllFeaturesByTileset', async () => {
        const data = await getCesium3dDataWithCache(targetMap);

        const belongs = (item) => item.tilesetId === tilesetId;

        // Snapshot each family's dropped entities so every one can carry its own oldData.
        const removedMarkers = data.markers.filter(belongs);
        data.markers = data.markers.filter(m => !belongs(m));

        const removedMeasurements = (data.measurements || []).filter(belongs);
        if (data.measurements) {
            data.measurements = data.measurements.filter(m => !belongs(m));
        }

        const removedViewsheds = (data.viewsheds || []).filter(belongs);
        if (data.viewsheds) {
            data.viewsheds = data.viewsheds.filter(v => !belongs(v));
        }

        const totalRemoved = removedMarkers.length + removedMeasurements.length + removedViewsheds.length;

        if (totalRemoved > 0) {
            await saveCesium3dData(targetMap, data);

            if (removedMarkers.length > 0) emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
            if (removedMeasurements.length > 0) emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
            if (removedViewsheds.length > 0) emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });

            // Persistence → emit → log, as in removeMarker. Without a DELETE op per entity
            // the bulk wipe stayed local and peers kept rendering the removed features.
            const mapId = mapManager.getMapId(targetMap);
            const families = [
                [removedMarkers, logMarker3dOperation],
                [removedMeasurements, logMeasurement3dOperation],
                [removedViewsheds, logViewshed3dOperation]
            ];
            for (const [entities, logDelete] of families) {
                for (const entity of entities) {
                    logDelete(OperationType.DELETE, entity.id, mapId, null, entity);
                }
            }
        }

        return {
            markers: removedMarkers.length,
            measurements: removedMeasurements.length,
            viewsheds: removedViewsheds.length,
            total: totalRemoved
        };
    });
}

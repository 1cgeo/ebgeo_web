// Path: js/store/streetview360.operations.js

/**
 * @fileoverview Store operations for Street View 360 data.
 * Handles CRUD operations for photo orientations and 360 markers.
 * Follows the same patterns as cesium3d.operations.js.
 */

import { memoryStore } from './memory-store.js';
import { getStreetview360Compat, setStreetview360Compat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';
import { validateImageFile, processImageFile } from '../utilities/image_utils.js';
import { createSyncMetadata, touchSyncMetadata, markDeleted, isActive } from './sync/sync-metadata.js';
import { generateUUID } from '../utilities/uuid.js';
import {
    logOrientation360Operation,
    logMarker360Operation,
    OperationType
} from './sync/index.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { deepClone } from '../utilities/deep-utils.js';
import { withSideDocument } from './document-lock.js';

// Alias for backward compatibility during migration
const getStreetview360Data = getStreetview360Compat;
const setStreetview360Data = setStreetview360Compat;

// ===== DEPENDENCY INJECTION =====

/**
 * Module-level dependencies
 * @type {{ eventBus: import('../events/event_bus.js').EventBus | null }}
 */
const deps = { eventBus: null };

/**
 * Initialize streetview360 module with dependencies.
 * Must be called once at application startup.
 * @param {{ eventBus: import('../events/event_bus.js').EventBus }} dependencies
 */
export function setStreetview360Dependencies({ eventBus }) {
    deps.eventBus = eventBus;
}

// ===== HELPER FUNCTIONS =====

/**
 * Gets current map name, using provided or falling back to current.
 * @param {string|null} mapName - Map name or null for current
 * @returns {string}
 */
function resolveMapName(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

/**
 * Permission gate for a 360 write. Emits STORE_OPERATION_BLOCKED when denied so the
 * UI shows the read-only toast, and — critically — stops the caller BEFORE the op is
 * queued: an op the server refuses (403) aborts the whole push batch and, since 403 is
 * not a permanent rejection, the batch is retried forever, freezing outbound sync.
 *
 * The gate is hierarchical by construction (GuardAction → PermissionAction →
 * sessionContext.canPerformAction), so Manager/Owner/Admin pass without any closed
 * role list. Offline / local-only stores are always allowed (checkPermission, P1).
 *
 * @param {string} guardAction - Key from GuardAction
 * @param {string} operationName - Operation label carried in the error payload
 * @returns {boolean} True when the write may proceed
 */
function guardStreetview360Write(guardAction, operationName) {
    const perm = checkPermission(guardAction);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: operationName,
            reason: perm.reason,
            required: perm.required
        });
        return false;
    }
    return true;
}

/**
 * Checks whether the memory cache holds data for the given map.
 * @param {string} mapName - Map name to check
 * @returns {boolean}
 */
function isCached(mapName) {
    return memoryStore.streetview360._mapName === mapName;
}

/**
 * Returns the cached markers array if the cache matches the map, otherwise null.
 * @param {string} mapName - Map name
 * @returns {Array|null}
 */
function getCachedMarkers(mapName) {
    return isCached(mapName) ? memoryStore.streetview360.markers : null;
}

/**
 * Filters an object's entries to only those with active sync metadata.
 * @param {Object} entries - Object keyed by string with sync metadata values
 * @returns {Object} Filtered entries
 */
function filterActiveEntries(entries) {
    const result = {};
    for (const [key, value] of Object.entries(entries)) {
        if (isActive(value.sync)) {
            result[key] = value;
        }
    }
    return result;
}

// ===== DEFAULT STYLES =====

/**
 * Default style for 360 markers
 */
export const DEFAULT_MARKER_360_STYLE = {
    markerColor: '#3f4fb5',
    markerSize: 12,
    markerOpacity: 1,
    showLabel: true,
    labelText: '',
    labelColor: '#ffffff',
    labelBackgroundColor: '#3f4fb5',
    labelBackgroundOpacity: 0.9,
    labelSize: 14
};

// ===== ORIENTATION OPERATIONS =====

/**
 * Saves camera orientation for a photo.
 * @param {string} photoName - Photo name/identifier
 * @param {Object} orientation - Orientation data
 * @param {number} orientation.lon - Horizontal rotation in degrees
 * @param {number} orientation.lat - Vertical rotation in degrees
 * @param {number} orientation.fov - Field of view in degrees
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<void>}
 */
export async function saveOrientation(photoName, orientation, mapName = null) {
    // Orientation is a distinct entity from a marker, but it rides the same EDIT
    // capability; a dedicated GuardAction key would need permission-guard.js, which is
    // outside this change.
    if (!guardStreetview360Write(GuardAction.CREATE_MARKER_360, 'saveOrientation')) return;

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'saveOrientation', async () => {
        const data = await getStreetview360Data(targetMap);

        const existing = data.orientations[photoName];
        const isUpdate = !!existing?.sync;
        const oldOrientation = existing ? { ...existing } : null;

        const sync = existing?.sync
            ? touchSyncMetadata(existing.sync)
            : createSyncMetadata(null);

        data.orientations[photoName] = {
            id: existing?.id || generateUUID(),
            photoName,
            lon: orientation.lon,
            lat: orientation.lat,
            fov: orientation.fov,
            savedAt: Date.now(),
            sync
        };

        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            memoryStore.streetview360.orientations[photoName] = data.orientations[photoName];
        }

        deps.eventBus?.emit(EventTypes.ORIENTATION_360_SAVED, { photoName, mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        const saved = data.orientations[photoName];
        if (isUpdate) {
            logOrientation360Operation(OperationType.UPDATE, saved.id, mapId, saved, oldOrientation);
        } else {
            logOrientation360Operation(OperationType.CREATE, saved.id, mapId, saved);
        }
    });
}

/**
 * Gets saved orientation for a photo.
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object|null>} Orientation data or null if not found
 */
export async function getOrientation(photoName, mapName = null) {
    const targetMap = resolveMapName(mapName);

    if (isCached(targetMap)) {
        const orientation = memoryStore.streetview360.orientations[photoName];
        return orientation && isActive(orientation.sync) ? orientation : null;
    }

    const data = await getStreetview360Data(targetMap);
    const orientation = data.orientations[photoName];
    return orientation && isActive(orientation.sync) ? orientation : null;
}

/**
 * Checks if a photo has a saved orientation.
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<boolean>} True if orientation exists
 */
export async function hasOrientation(photoName, mapName = null) {
    const orientation = await getOrientation(photoName, mapName);
    return orientation !== null;
}

/**
 * Clears saved orientation for a photo.
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<boolean>} True if orientation was removed
 */
export async function clearOrientation(photoName, mapName = null) {
    if (!guardStreetview360Write(GuardAction.DELETE_MARKER_360, 'clearOrientation')) return false;

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'clearOrientation', async () => {
        const data = await getStreetview360Data(targetMap);

        const orientation = data.orientations[photoName];
        if (!orientation || !isActive(orientation.sync)) {
            return false;
        }

        const oldOrientation = { ...orientation };
        orientation.sync = markDeleted(orientation.sync);
        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            memoryStore.streetview360.orientations[photoName] = orientation;
        }

        deps.eventBus?.emit(EventTypes.ORIENTATION_360_CLEARED, { photoName, mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logOrientation360Operation(OperationType.DELETE, orientation.id, mapId, null, oldOrientation);

        return true;
    });
}

/**
 * Gets all saved orientations for the current map.
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object>} Object with photoName keys and orientation values
 */
export async function getAllOrientations(mapName = null) {
    const targetMap = resolveMapName(mapName);

    if (isCached(targetMap)) {
        return filterActiveEntries(memoryStore.streetview360.orientations);
    }

    const data = await getStreetview360Data(targetMap);
    return filterActiveEntries(data.orientations || {});
}

// ===== MARKER CRUD OPERATIONS =====

/**
 * Adds a new 360 marker.
 * @param {string} photoName - Photo where marker is placed
 * @param {Object} markerData - Marker data
 * @param {Object} markerData.position - Position data (heading, pitch, distance)
 * @param {Object} [markerData.properties] - Properties (nome, descricao,
 *   plus optional temporal validity: temporalInicio/temporalFim as epoch ms).
 * @param {Object} [markerData.style] - Style overrides
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object>} Created marker
 */
export async function addMarker360(photoName, markerData, mapName = null) {
    if (!guardStreetview360Write(GuardAction.CREATE_MARKER_360, 'addMarker360')) return null;

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'addMarker360', async () => {
        const data = await getStreetview360Data(targetMap);

        const existingCount = data.markers.filter(m => m.photoName === photoName && isActive(m.sync)).length;

        const savedDefaultStyle = localStorage.getItem('default_marker_360_style');
        const defaultStyle = savedDefaultStyle ? JSON.parse(savedDefaultStyle) : DEFAULT_MARKER_360_STYLE;

        const marker = {
            id: generateUUID(),
            photoName,
            position: {
                heading: markerData.position.heading,
                pitch: markerData.position.pitch,
                distance: markerData.position.distance || 5
            },
            properties: {
                // Preserve any optional temporal validity (temporalInicio/temporalFim).
                ...markerData.properties,
                nome: markerData.properties?.nome || `Ponto #${existingCount + 1}`,
                descricao: markerData.properties?.descricao || ''
            },
            style: { ...defaultStyle, ...markerData.style },
            images: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sync: createSyncMetadata(null)
        };

        data.markers.push(marker);
        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            memoryStore.streetview360.markers.push(marker);
        }

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });

        const mapId = mapManager.getCurrentMapId();
        logMarker360Operation(OperationType.CREATE, marker.id, mapId, marker);

        return marker;
    });
}

/**
 * Gets markers for a specific photo.
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Array>} Array of markers for the photo
 */
export async function getMarkers360(photoName, mapName = null) {
    const targetMap = resolveMapName(mapName);
    const cached = getCachedMarkers(targetMap);

    if (cached) {
        return cached.filter(m => m.photoName === photoName && isActive(m.sync));
    }

    const data = await getStreetview360Data(targetMap);
    return data.markers.filter(m => m.photoName === photoName && isActive(m.sync));
}

/**
 * Gets all markers for the current map.
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Array>} Array of all markers
 */
export async function getAllMarkers360(mapName = null) {
    const targetMap = resolveMapName(mapName);
    const cached = getCachedMarkers(targetMap);

    if (cached) {
        return cached.filter(m => isActive(m.sync));
    }

    const data = await getStreetview360Data(targetMap);
    return (data.markers || []).filter(m => isActive(m.sync));
}

/**
 * Gets a marker by ID.
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object|null>} Marker or null if not found
 */
export async function getMarker360ById(markerId, mapName = null) {
    const targetMap = resolveMapName(mapName);
    const cached = getCachedMarkers(targetMap);
    const markers = cached || (await getStreetview360Data(targetMap)).markers;
    const marker = markers.find(m => m.id === markerId);
    return marker && isActive(marker.sync) ? marker : null;
}

/**
 * Updates a marker.
 * @param {string} markerId - Marker ID
 * @param {Object} updates - Updates to apply
 * @param {Object} [updates.properties] - Properties updates
 * @param {Object} [updates.style] - Style updates
 * @param {Object} [updates.position] - Position updates
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object|null>} Updated marker or null if not found
 */
export async function updateMarker360(markerId, updates, mapName = null) {
    if (!guardStreetview360Write(GuardAction.CREATE_MARKER_360, 'updateMarker360')) return null;

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'updateMarker360', async () => {
        const data = await getStreetview360Data(targetMap);

        const marker = data.markers.find(m => m.id === markerId);
        if (!marker || !isActive(marker.sync)) {
            return null;
        }

        const previousData = deepClone(marker);

        if (updates.properties) {
            marker.properties = { ...marker.properties, ...updates.properties };
        }
        if (updates.style) {
            marker.style = { ...marker.style, ...updates.style };
        }
        if (updates.position) {
            marker.position = { ...marker.position, ...updates.position };
        }

        marker.updatedAt = Date.now();
        marker.sync = touchSyncMetadata(marker.sync);

        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            const memIndex = memoryStore.streetview360.markers.findIndex(m => m.id === markerId);
            if (memIndex !== -1) {
                memoryStore.streetview360.markers[memIndex] = marker;
            }
        }

        // getMapId(targetMap), NOT the map NAME: the pre-flush guard drops any op whose
        // mapId is not a UUID, so passing the name silently discarded every update.
        await logMarker360Operation(OperationType.UPDATE, markerId, mapManager.getMapId(targetMap), marker, previousData);

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
        return marker;
    });
}

/**
 * Removes a marker (soft delete).
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<boolean>} True if marker was removed
 */
export async function removeMarker360(markerId, mapName = null) {
    if (!guardStreetview360Write(GuardAction.DELETE_MARKER_360, 'removeMarker360')) return false;

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'removeMarker360', async () => {
        const data = await getStreetview360Data(targetMap);

        const marker = data.markers.find(m => m.id === markerId);
        if (!marker || !isActive(marker.sync)) {
            return false;
        }

        const previousData = deepClone(marker);
        marker.sync = markDeleted(marker.sync);
        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            const memIndex = memoryStore.streetview360.markers.findIndex(m => m.id === markerId);
            if (memIndex !== -1) {
                memoryStore.streetview360.markers[memIndex] = marker;
            }
        }

        await logMarker360Operation(OperationType.DELETE, markerId, mapManager.getMapId(targetMap), null, previousData);

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
        return true;
    });
}

/**
 * Removes all markers for a specific photo (soft delete).
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<number>} Number of markers removed
 */
export async function removeMarkers360ByPhoto(photoName, mapName = null) {
    if (!guardStreetview360Write(GuardAction.DELETE_MARKER_360, 'removeMarkers360ByPhoto')) return 0;

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'removeMarkers360ByPhoto', async () => {
        const data = await getStreetview360Data(targetMap);

        /** @type {Array<{id: string, previous: Object}>} Pre-delete snapshots for the sync ops. */
        const removed = [];
        for (const marker of data.markers) {
            if (marker.photoName === photoName && isActive(marker.sync)) {
                const previous = deepClone(marker);
                marker.sync = markDeleted(marker.sync);
                removed.push({ id: marker.id, previous });
            }
        }

        if (removed.length === 0) {
            return 0;
        }

        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            for (const marker of memoryStore.streetview360.markers) {
                if (marker.photoName === photoName && isActive(marker.sync)) {
                    marker.sync = markDeleted(marker.sync);
                }
            }
        }

        // Bulk removal is still a removal per entity: without one DELETE op each, wiping a
        // photo's markers stayed local and peers kept showing them.
        const mapId = mapManager.getMapId(targetMap);
        for (const entry of removed) {
            await logMarker360Operation(OperationType.DELETE, entry.id, mapId, null, entry.previous);
        }

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
        return removed.length;
    });
}

// ===== MARKER IMAGE OPERATIONS =====

/**
 * Adds an image to a marker.
 * @param {string} markerId - Marker ID
 * @param {File} file - Image file
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object|null>} Image data or null if failed
 */
export async function addMarker360Image(markerId, file, mapName = null) {
    if (!guardStreetview360Write(GuardAction.CREATE_MARKER_360, 'addMarker360Image')) return null;

    const validation = validateImageFile(file);
    if (!validation.valid) {
        console.warn('Invalid image file:', validation.error);
        return null;
    }

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'addMarker360Image', async () => {
        const data = await getStreetview360Data(targetMap);

        const marker = data.markers.find(m => m.id === markerId);
        if (!marker || !isActive(marker.sync)) {
            return null;
        }

        const imageData = await processImageFile(file);
        const image = {
            id: generateUUID(),
            name: file.name,
            type: file.type,
            size: file.size,
            data: imageData.data,
            thumbnail: imageData.thumbnail,
            addedAt: Date.now()
        };

        const previousData = deepClone(marker);
        marker.images.push(image);
        marker.updatedAt = Date.now();
        marker.sync = touchSyncMetadata(marker.sync);

        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            const memMarker = memoryStore.streetview360.markers.find(m => m.id === markerId);
            if (memMarker) {
                memMarker.images = marker.images;
                memMarker.updatedAt = marker.updatedAt;
                memMarker.sync = marker.sync;
            }
        }

        // The image is inline in the marker's data → attaching it is a marker UPDATE that must sync to peers.
        await logMarker360Operation(OperationType.UPDATE, markerId, mapManager.getMapId(targetMap), marker, previousData);

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
        return image;
    });
}

/**
 * Gets images for a marker.
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Array>} Array of images
 */
export async function getMarker360Images(markerId, mapName = null) {
    const marker = await getMarker360ById(markerId, mapName);
    return marker?.images || [];
}

/**
 * Removes an image from a marker.
 * @param {string} markerId - Marker ID
 * @param {string} imageId - Image ID
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<boolean>} True if image was removed
 */
export async function removeMarker360Image(markerId, imageId, mapName = null) {
    if (!guardStreetview360Write(GuardAction.DELETE_MARKER_360, 'removeMarker360Image')) return false;

    const targetMap = resolveMapName(mapName);
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', targetMap, 'removeMarker360Image', async () => {
        const data = await getStreetview360Data(targetMap);

        const marker = data.markers.find(m => m.id === markerId);
        if (!marker || !isActive(marker.sync)) {
            return false;
        }

        const imgIndex = marker.images.findIndex(img => img.id === imageId);
        if (imgIndex === -1) {
            return false;
        }

        const previousData = deepClone(marker);
        marker.images.splice(imgIndex, 1);
        marker.updatedAt = Date.now();
        marker.sync = touchSyncMetadata(marker.sync);

        await setStreetview360Data(targetMap, data);

        if (isCached(targetMap)) {
            const memMarker = memoryStore.streetview360.markers.find(m => m.id === markerId);
            if (memMarker) {
                memMarker.images = marker.images;
                memMarker.updatedAt = marker.updatedAt;
                memMarker.sync = marker.sync;
            }
        }

        // Removing an inline image is a marker UPDATE that must sync to peers.
        await logMarker360Operation(OperationType.UPDATE, markerId, mapManager.getMapId(targetMap), marker, previousData);

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
        return true;
    });
}

// ===== MEMORY OPERATIONS =====

/**
 * Loads streetview360 data from IndexedDB to memory cache.
 * Called when switching maps.
 * @param {string} mapName - Map name to load
 * @returns {Promise<void>}
 */
export async function loadStreetview360DataToMemory(mapName) {
    const data = await getStreetview360Data(mapName);
    memoryStore.streetview360 = {
        orientations: data.orientations || {},
        markers: data.markers || [],
        _mapName: mapName
    };
}

/**
 * Clears the streetview360 memory cache.
 */
export function clearStreetview360Cache() {
    memoryStore.streetview360 = {
        orientations: {},
        markers: [],
        _mapName: null
    };
}

// ===== EXPORT/IMPORT OPERATIONS =====

/**
 * Gets streetview360 data formatted for export.
 * @param {string} mapName - Map name
 * @returns {Promise<Object|null>} Data for export or null if empty
 */
export async function getStreetview360DataForExport(mapName) {
    const data = await getStreetview360Data(mapName);

    const activeOrientations = filterActiveEntries(data.orientations || {});
    const activeMarkers = (data.markers || []).filter(m => isActive(m.sync));

    const hasData = Object.keys(activeOrientations).length > 0 || activeMarkers.length > 0;
    if (!hasData) {
        return null;
    }

    return {
        orientations: activeOrientations,
        markers: activeMarkers
    };
}

/**
 * Imports streetview360 data from an export.
 * Merges with existing data (orientations overwrite, markers get new IDs).
 * @param {string} mapName - Target map name
 * @param {Object} importData - Data to import
 * @returns {Promise<void>}
 */
export async function setStreetview360DataForImport(mapName, importData) {
    // Leaf read-modify-write of the sv360 document; see document-lock.js.
    return withSideDocument('sv360', mapName, 'setStreetview360DataForImport', async () => {
        const existingData = await getStreetview360Data(mapName);

        // Merge orientations (import overwrites existing), ensuring sync metadata
        const mergedOrientations = { ...existingData.orientations };
        for (const [key, orientation] of Object.entries(importData.orientations || {})) {
            mergedOrientations[key] = {
                ...orientation,
                id: orientation.id || generateUUID(),
                sync: orientation.sync || createSyncMetadata(null)
            };
        }

        // Regenerate marker IDs to avoid conflicts and ensure sync metadata
        const newMarkers = (importData.markers || []).map(marker => ({
            ...marker,
            id: generateUUID(),
            createdAt: marker.createdAt || Date.now(),
            updatedAt: marker.updatedAt || Date.now(),
            sync: marker.sync || createSyncMetadata(null)
        }));

        const activeExistingMarkers = existingData.markers.filter(m => isActive(m.sync));
        const mergedMarkers = [...activeExistingMarkers, ...newMarkers];

        await setStreetview360Data(mapName, {
            orientations: mergedOrientations,
            markers: mergedMarkers
        });

        if (isCached(mapName)) {
            memoryStore.streetview360.orientations = mergedOrientations;
            memoryStore.streetview360.markers = mergedMarkers;
        }

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName });
    });
}

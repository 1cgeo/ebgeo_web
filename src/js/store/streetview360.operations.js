// Path: js/store/streetview360.operations.js

/**
 * @fileoverview Store operations for Street View 360 data.
 * Handles CRUD operations for photo orientations and 360 markers.
 * Follows the same patterns as cesium3d.operations.js.
 */

import {
    getStreetview360Data,
    setStreetview360Data,
    memoryStore
} from './repository.js';
import mapManager from './store-state-manager.js';
import { EventTypes } from '../events/event_types.js';
import { IDUtils } from '../utilities/id_utils.js';
import { validateImageFile, processImageFile } from '../utilities/image_utils.js';

/**
 * Module-level dependencies injected via setStreetview360Dependencies()
 */
const deps = { eventBus: null };

/**
 * Initialize streetview360 module with dependencies.
 * Must be called once at application startup.
 * @param {Object} dependencies - Dependencies object
 * @param {import('../events/event_bus.js').EventBus} dependencies.eventBus - Event bus instance
 */
export function setStreetview360Dependencies({ eventBus }) {
    deps.eventBus = eventBus;
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
    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    data.orientations[photoName] = {
        lon: orientation.lon,
        lat: orientation.lat,
        fov: orientation.fov,
        savedAt: Date.now()
    };

    await setStreetview360Data(targetMap, data);

    // Update memory cache if current map
    if (memoryStore.streetview360._mapName === targetMap) {
        memoryStore.streetview360.orientations[photoName] = data.orientations[photoName];
    }

    deps.eventBus?.emit(EventTypes.ORIENTATION_360_SAVED, { photoName, mapName: targetMap });
}

/**
 * Gets saved orientation for a photo.
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object|null>} Orientation data or null if not found
 */
export async function getOrientation(photoName, mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();

    // Check memory cache first
    if (memoryStore.streetview360._mapName === targetMap) {
        return memoryStore.streetview360.orientations[photoName] || null;
    }

    const data = await getStreetview360Data(targetMap);
    return data.orientations[photoName] || null;
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
    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    if (!data.orientations[photoName]) {
        return false;
    }

    delete data.orientations[photoName];
    await setStreetview360Data(targetMap, data);

    // Update memory cache if current map
    if (memoryStore.streetview360._mapName === targetMap) {
        delete memoryStore.streetview360.orientations[photoName];
    }

    deps.eventBus?.emit(EventTypes.ORIENTATION_360_CLEARED, { photoName, mapName: targetMap });
    return true;
}

/**
 * Gets all saved orientations for the current map.
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object>} Object with photoName keys and orientation values
 */
export async function getAllOrientations(mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();

    // Check memory cache first
    if (memoryStore.streetview360._mapName === targetMap) {
        return { ...memoryStore.streetview360.orientations };
    }

    const data = await getStreetview360Data(targetMap);
    return data.orientations || {};
}

// ===== MARKER CRUD OPERATIONS =====

/**
 * Adds a new 360 marker.
 * @param {string} photoName - Photo where marker is placed
 * @param {Object} markerData - Marker data
 * @param {Object} markerData.position - Position data (heading, pitch, distance)
 * @param {Object} [markerData.properties] - Properties (nome, descricao)
 * @param {Object} [markerData.style] - Style overrides
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object>} Created marker
 */
export async function addMarker360(photoName, markerData, mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    // Count existing markers for this photo for auto-naming
    const existingCount = data.markers.filter(m => m.photoName === photoName).length;

    // Load user default style from localStorage if available
    const savedDefaultStyle = localStorage.getItem('default_marker_360_style');
    const defaultStyle = savedDefaultStyle ? JSON.parse(savedDefaultStyle) : DEFAULT_MARKER_360_STYLE;

    const marker = {
        id: IDUtils.generateUniqueId(),
        photoName,
        position: {
            heading: markerData.position.heading,
            pitch: markerData.position.pitch,
            distance: markerData.position.distance || 5
        },
        properties: {
            nome: markerData.properties?.nome || `Ponto #${existingCount + 1}`,
            descricao: markerData.properties?.descricao || ''
        },
        style: { ...defaultStyle, ...markerData.style },
        images: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    data.markers.push(marker);
    await setStreetview360Data(targetMap, data);

    // Update memory cache if current map
    if (memoryStore.streetview360._mapName === targetMap) {
        memoryStore.streetview360.markers.push(marker);
    }

    deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
    return marker;
}

/**
 * Gets markers for a specific photo.
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Array>} Array of markers for the photo
 */
export async function getMarkers360(photoName, mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();

    // Check memory cache first
    if (memoryStore.streetview360._mapName === targetMap) {
        return memoryStore.streetview360.markers.filter(m => m.photoName === photoName);
    }

    const data = await getStreetview360Data(targetMap);
    return data.markers.filter(m => m.photoName === photoName);
}

/**
 * Gets all markers for the current map.
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Array>} Array of all markers
 */
export async function getAllMarkers360(mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();

    // Check memory cache first
    if (memoryStore.streetview360._mapName === targetMap) {
        return [...memoryStore.streetview360.markers];
    }

    const data = await getStreetview360Data(targetMap);
    return data.markers || [];
}

/**
 * Gets a marker by ID.
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<Object|null>} Marker or null if not found
 */
export async function getMarker360ById(markerId, mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();

    // Check memory cache first
    if (memoryStore.streetview360._mapName === targetMap) {
        return memoryStore.streetview360.markers.find(m => m.id === markerId) || null;
    }

    const data = await getStreetview360Data(targetMap);
    return data.markers.find(m => m.id === markerId) || null;
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
    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    const index = data.markers.findIndex(m => m.id === markerId);
    if (index === -1) {
        return null;
    }

    const marker = data.markers[index];

    // Merge updates
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

    await setStreetview360Data(targetMap, data);

    // Update memory cache if current map
    if (memoryStore.streetview360._mapName === targetMap) {
        const memIndex = memoryStore.streetview360.markers.findIndex(m => m.id === markerId);
        if (memIndex !== -1) {
            memoryStore.streetview360.markers[memIndex] = marker;
        }
    }

    deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
    return marker;
}

/**
 * Removes a marker.
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<boolean>} True if marker was removed
 */
export async function removeMarker360(markerId, mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    const index = data.markers.findIndex(m => m.id === markerId);
    if (index === -1) {
        return false;
    }

    data.markers.splice(index, 1);
    await setStreetview360Data(targetMap, data);

    // Update memory cache if current map
    if (memoryStore.streetview360._mapName === targetMap) {
        const memIndex = memoryStore.streetview360.markers.findIndex(m => m.id === markerId);
        if (memIndex !== -1) {
            memoryStore.streetview360.markers.splice(memIndex, 1);
        }
    }

    deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
    return true;
}

/**
 * Removes all markers for a specific photo.
 * @param {string} photoName - Photo name/identifier
 * @param {string|null} mapName - Map name (uses current if null)
 * @returns {Promise<number>} Number of markers removed
 */
export async function removeMarkers360ByPhoto(photoName, mapName = null) {
    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    const initialCount = data.markers.length;
    data.markers = data.markers.filter(m => m.photoName !== photoName);
    const removedCount = initialCount - data.markers.length;

    if (removedCount > 0) {
        await setStreetview360Data(targetMap, data);

        // Update memory cache if current map
        if (memoryStore.streetview360._mapName === targetMap) {
            memoryStore.streetview360.markers = memoryStore.streetview360.markers.filter(
                m => m.photoName !== photoName
            );
        }

        deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
    }

    return removedCount;
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
    const validation = validateImageFile(file);
    if (!validation.valid) {
        console.warn('Invalid image file:', validation.error);
        return null;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    const marker = data.markers.find(m => m.id === markerId);
    if (!marker) {
        return null;
    }

    const imageData = await processImageFile(file);
    const image = {
        id: IDUtils.generateUniqueId(),
        name: file.name,
        type: file.type,
        size: file.size,
        data: imageData.data,
        thumbnail: imageData.thumbnail,
        addedAt: Date.now()
    };

    marker.images.push(image);
    marker.updatedAt = Date.now();

    await setStreetview360Data(targetMap, data);

    // Update memory cache if current map
    if (memoryStore.streetview360._mapName === targetMap) {
        const memMarker = memoryStore.streetview360.markers.find(m => m.id === markerId);
        if (memMarker) {
            memMarker.images = marker.images;
            memMarker.updatedAt = marker.updatedAt;
        }
    }

    deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
    return image;
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
    const targetMap = mapName || mapManager.getCurrentMapName();
    const data = await getStreetview360Data(targetMap);

    const marker = data.markers.find(m => m.id === markerId);
    if (!marker) {
        return false;
    }

    const imgIndex = marker.images.findIndex(img => img.id === imageId);
    if (imgIndex === -1) {
        return false;
    }

    marker.images.splice(imgIndex, 1);
    marker.updatedAt = Date.now();

    await setStreetview360Data(targetMap, data);

    // Update memory cache if current map
    if (memoryStore.streetview360._mapName === targetMap) {
        const memMarker = memoryStore.streetview360.markers.find(m => m.id === markerId);
        if (memMarker) {
            memMarker.images = marker.images;
            memMarker.updatedAt = marker.updatedAt;
        }
    }

    deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName: targetMap });
    return true;
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

    const hasOrientations = Object.keys(data.orientations).length > 0;
    const hasMarkers = data.markers.length > 0;

    if (!hasOrientations && !hasMarkers) {
        return null;
    }

    return {
        orientations: data.orientations,
        markers: data.markers
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
    const existingData = await getStreetview360Data(mapName);

    // Merge orientations (import overwrites existing)
    const mergedOrientations = {
        ...existingData.orientations,
        ...(importData.orientations || {})
    };

    // Regenerate marker IDs to avoid conflicts and merge
    const newMarkers = (importData.markers || []).map(marker => ({
        ...marker,
        id: IDUtils.generateUniqueId(),
        createdAt: marker.createdAt || Date.now(),
        updatedAt: marker.updatedAt || Date.now()
    }));

    const mergedMarkers = [...existingData.markers, ...newMarkers];

    await setStreetview360Data(mapName, {
        orientations: mergedOrientations,
        markers: mergedMarkers
    });

    // Update memory cache if this is the current map
    if (memoryStore.streetview360._mapName === mapName) {
        memoryStore.streetview360.orientations = mergedOrientations;
        memoryStore.streetview360.markers = mergedMarkers;
    }

    deps.eventBus?.emit(EventTypes.MARKERS_360_CHANGED, { mapName });
}

// Path: js/store/cesium3d.operations.js

/**
 * @fileoverview Cesium 3D CRUD operations.
 * Handles camera positions and markers for 3D models.
 */

import {
    getCesium3dData,
    setCesium3dData,
    memoryStore
} from './repository.js';
import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';
import {
    validateImageFile,
    processImageFile
} from '../utilities/image_utils.js';

// ===== DEPENDENCY INJECTION =====

/**
 * Module-level dependencies
 * @type {{ eventBus: import('../events/event_bus.js').EventBus | null }}
 */
const deps = {
    eventBus: null
};

/**
 * Sets dependencies for cesium3d operations.
 *
 * @param {{ eventBus: import('../events/event_bus.js').EventBus }} dependencies - Dependencies object
 */
export function setCesium3dDependencies(dependencies) {
    deps.eventBus = dependencies.eventBus;
}

// ===== HELPER FUNCTIONS =====

/**
 * Gets current map name, using provided or falling back to current.
 * @param {string|null} mapName - Map name or null for current
 * @returns {string} Map name
 */
const getTargetMapName = (mapName) => {
    return mapName || mapManager.getCurrentMapName();
};

/**
 * Gets cesium3d data from memory or loads from DB.
 * @param {string} mapName - Map name
 * @returns {Promise<Object>} Cesium3d data
 */
const getCesium3dDataWithCache = async (mapName) => {
    // Check memory cache first
    if (memoryStore.cesium3d && memoryStore.cesium3d._mapName === mapName) {
        return memoryStore.cesium3d;
    }
    // Load from DB
    return await getCesium3dData(mapName);
};

/**
 * Saves cesium3d data to both memory and DB.
 * @param {string} mapName - Map name
 * @param {Object} data - Cesium3d data
 */
const saveCesium3dData = async (mapName, data) => {
    // Update memory cache
    memoryStore.cesium3d = { ...data, _mapName: mapName };
    // Persist to DB
    const dataToSave = { ...data };
    delete dataToSave._mapName;
    await setCesium3dData(mapName, dataToSave);
};

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
export const saveCameraPosition = async (tilesetId, position, orientation, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    data.cameraPositions[tilesetId] = {
        tilesetId,
        position,
        orientation,
        savedAt: Date.now()
    };

    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.CAMERA_3D_SAVED, { tilesetId, mapName: targetMap });
    }
};

/**
 * Gets saved camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Camera position or null
 */
export const getCameraPosition = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.cameraPositions[tilesetId] || null;
};

/**
 * Checks if a tileset has a saved camera position.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if position exists
 */
export const hasSavedCameraPosition = async (tilesetId, mapName = null) => {
    const position = await getCameraPosition(tilesetId, mapName);
    return position !== null;
};

/**
 * Clears saved camera position for a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if position was removed
 */
export const clearCameraPosition = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (data.cameraPositions[tilesetId]) {
        delete data.cameraPositions[tilesetId];
        await saveCesium3dData(targetMap, data);
        return true;
    }
    return false;
};

/**
 * Gets all saved camera positions for current map.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Object with tilesetId as keys
 */
export const getAllCameraPositions = async (mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.cameraPositions || {};
};

// ===== MARKER OPERATIONS =====

/**
 * Generates unique marker ID.
 * @returns {string} Unique ID
 */
const generateMarkerId = () => {
    return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
};

/**
 * Gets the next marker number for auto-naming.
 * @param {Array} markers - Existing markers
 * @returns {number} Next marker number
 */
const getNextMarkerNumber = (markers) => {
    let maxNumber = 0;
    const regex = /^Ponto #(\d+)$/;

    for (const marker of markers) {
        const match = marker.properties?.nome?.match(regex);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) {
                maxNumber = num;
            }
        }
    }

    return maxNumber + 1;
};

/**
 * Default marker style configuration.
 */
export const DEFAULT_MARKER_STYLE = {
    // Marker style
    markerColor: '#3f4fb5',
    markerSize: 32,
    markerOpacity: 1,
    showMarker: true,
    // Label style
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
export const addMarker = async (tilesetId, markerData, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    // Get next marker number for auto-naming
    const nextNumber = getNextMarkerNumber(data.markers);
    const defaultName = `Ponto #${nextNumber}`;

    // Get user-defined default style from localStorage if available
    let userDefaultStyle = {};
    try {
        const savedStyle = localStorage.getItem('marker3d_default_style');
        if (savedStyle) {
            userDefaultStyle = JSON.parse(savedStyle);
        }
    } catch (e) {
        console.warn('Failed to parse saved marker style:', e);
    }

    const marker = {
        id: generateMarkerId(),
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
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    data.markers.push(marker);
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
    }

    return marker;
};

/**
 * Gets all markers for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of markers
 */
export const getMarkers = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers.filter(m => m.tilesetId === tilesetId);
};

/**
 * Gets all markers for the current map.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of all markers
 */
export const getAllMarkers = async (mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers || [];
};

/**
 * Gets a marker by ID.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Marker or null
 */
export const getMarkerById = async (markerId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers.find(m => m.id === markerId) || null;
};

/**
 * Updates a marker's properties.
 *
 * @param {string} markerId - Marker ID
 * @param {Object} updates - Properties to update { properties, style, position }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated marker or null if not found
 */
export const updateMarker = async (markerId, updates, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    const markerIndex = data.markers.findIndex(m => m.id === markerId);
    if (markerIndex === -1) return null;

    const marker = data.markers[markerIndex];

    // Update properties
    if (updates.properties) {
        marker.properties = { ...marker.properties, ...updates.properties };
    }
    // Update style
    if (updates.style) {
        marker.style = { ...(marker.style || DEFAULT_MARKER_STYLE), ...updates.style };
    }
    if (updates.position) {
        marker.position = updates.position;
    }
    marker.updatedAt = Date.now();

    data.markers[markerIndex] = marker;
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
    }

    return marker;
};

/**
 * Removes a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if marker was removed
 */
export const removeMarker = async (markerId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    const initialLength = data.markers.length;
    data.markers = data.markers.filter(m => m.id !== markerId);

    if (data.markers.length < initialLength) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
        }
        return true;
    }
    return false;
};

/**
 * Removes all markers for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>} Number of markers removed
 */
export const removeMarkersByTileset = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    const initialLength = data.markers.length;
    data.markers = data.markers.filter(m => m.tilesetId !== tilesetId);
    const removedCount = initialLength - data.markers.length;

    if (removedCount > 0) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
        }
    }
    return removedCount;
};

// ===== MEMORY OPERATIONS =====

/**
 * Loads cesium3d data to memory for a map.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<void>}
 */
export const loadCesium3dDataToMemory = async (mapName) => {
    const data = await getCesium3dData(mapName);
    memoryStore.cesium3d = { ...data, _mapName: mapName };
};

/**
 * Clears cesium3d memory cache.
 */
export const clearCesium3dCache = () => {
    memoryStore.cesium3d = {
        cameraPositions: {},
        markers: [],
        _mapName: null
    };
};

// ===== IMPORT OPERATIONS =====

/**
 * Sets cesium3d data for a map (for import).
 *
 * @param {string} mapName - Map name
 * @param {Object} cesium3dData - Cesium3d data to import
 * @returns {Promise<void>}
 */
export const setCesium3dDataForImport = async (mapName, cesium3dData) => {
    // Ensure data has correct structure
    const normalizedData = {
        cameraPositions: cesium3dData.cameraPositions || {},
        markers: cesium3dData.markers || []
    };

    await setCesium3dData(mapName, normalizedData);

    // Update memory if current map
    if (mapName === mapManager.getCurrentMapName()) {
        memoryStore.cesium3d = { ...normalizedData, _mapName: mapName };
        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName });
        }
    }
};

/**
 * Gets cesium3d data for export.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<Object|null>} Cesium3d data or null if empty
 */
export const getCesium3dDataForExport = async (mapName) => {
    const data = await getCesium3dData(mapName);

    // Return null if no data
    if (Object.keys(data.cameraPositions).length === 0 && data.markers.length === 0) {
        return null;
    }

    return {
        cameraPositions: data.cameraPositions,
        markers: data.markers
    };
};

// ===== MARKER IMAGE OPERATIONS =====

/**
 * Adds an image to a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {File} file - Image file to add
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Created image object or null on failure
 */
export const addMarkerImage = async (markerId, file, mapName = null) => {
    // Validate file using shared utility
    const validation = validateImageFile(file);
    if (!validation.valid) {
        console.warn(`Invalid image: ${validation.reason}`);
        return null;
    }

    try {
        const targetMap = getTargetMapName(mapName);
        const data = await getCesium3dDataWithCache(targetMap);

        const markerIndex = data.markers.findIndex(m => m.id === markerId);
        if (markerIndex === -1) {
            console.warn(`Marker not found: ${markerId}`);
            return null;
        }

        // Process image using shared utility
        const processedImage = await processImageFile(file);
        const imageId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);

        const imageData = {
            id: imageId,
            name: file.name,
            type: file.type,
            size: file.size,
            data: processedImage.data,
            thumbnail: processedImage.thumbnail,
            addedAt: Date.now()
        };

        // Initialize images array if not exists
        if (!data.markers[markerIndex].images) {
            data.markers[markerIndex].images = [];
        }
        data.markers[markerIndex].images.push(imageData);
        data.markers[markerIndex].updatedAt = Date.now();

        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
        }

        return imageData;
    } catch (error) {
        console.error('Error adding marker image:', error);
        return null;
    }
};

/**
 * Gets all images for a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of image objects
 */
export const getMarkerImages = async (markerId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    const marker = data.markers.find(m => m.id === markerId);
    return marker?.images || [];
};

/**
 * Removes an image from a marker.
 *
 * @param {string} markerId - Marker ID
 * @param {string} imageId - Image ID to remove
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if image was removed
 */
export const removeMarkerImage = async (markerId, imageId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    const markerIndex = data.markers.findIndex(m => m.id === markerId);
    if (markerIndex === -1) return false;

    const marker = data.markers[markerIndex];
    if (!marker.images) return false;

    const initialLength = marker.images.length;
    marker.images = marker.images.filter(img => img.id !== imageId);

    if (marker.images.length < initialLength) {
        marker.updatedAt = Date.now();
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
        }
        return true;
    }
    return false;
};

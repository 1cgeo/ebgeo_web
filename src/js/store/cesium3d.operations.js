// Path: js/store/cesium3d.operations.js

/**
 * @fileoverview Cesium 3D CRUD operations.
 * Handles camera positions and markers for 3D models.
 */

import { memoryStore } from './memory-store.js';
import { getCesium3dCompat, setCesium3dCompat } from './repositories/index.js';
import mapManager from './store-state-manager.js';
import { EventTypes } from '../events';
import {
    validateImageFile,
    processImageFile
} from '../utilities/image_utils.js';
import { createSyncMetadata, touchSyncMetadata, isActive } from './sync/sync-metadata.js';
import { generateUUID } from '../utilities/uuid.js';
import {
    logMarker3dOperation,
    logMeasurement3dOperation,
    logViewshed3dOperation,
    logCameraPosition3dOperation,
    OperationType
} from './sync/index.js';

// Alias for backward compatibility during migration
const getCesium3dData = getCesium3dCompat;
const setCesium3dData = setCesium3dCompat;

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

    // Check if this is an update or create
    const existingPosition = data.cameraPositions[tilesetId];
    const isUpdate = !!existingPosition;
    const previousData = existingPosition ? { ...existingPosition } : null;

    const sync = existingPosition?.sync
        ? touchSyncMetadata(existingPosition.sync)
        : createSyncMetadata(null);

    data.cameraPositions[tilesetId] = {
        id: existingPosition?.id || generateUUID(),
        tilesetId,
        position,
        orientation,
        savedAt: Date.now(),
        sync
    };

    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.CAMERA_3D_SAVED, { tilesetId, mapName: targetMap });
    }

    // Log operation for sync
    const mapId = mapManager.getCurrentMapId();
    const newPosition = data.cameraPositions[tilesetId];
    if (isUpdate) {
        logCameraPosition3dOperation(OperationType.UPDATE, newPosition.id, mapId, newPosition, previousData);
    } else {
        logCameraPosition3dOperation(OperationType.CREATE, newPosition.id, mapId, newPosition);
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

    const existingPosition = data.cameraPositions[tilesetId];
    if (existingPosition) {
        // Capture for logging
        const previousData = { ...existingPosition };
        const positionId = existingPosition.id || tilesetId;

        delete data.cameraPositions[tilesetId];
        await saveCesium3dData(targetMap, data);

        // Log operation for sync
        const mapId = mapManager.getCurrentMapId();
        logCameraPosition3dOperation(OperationType.DELETE, positionId, mapId, null, previousData);

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
 * Generates unique marker ID using UUID.
 * @returns {string} Unique UUID
 */
const generateMarkerId = () => {
    return generateUUID();
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
        sync: createSyncMetadata(null)
    };

    data.markers.push(marker);
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
    }

    // Log operation for sync
    const mapId = mapManager.getCurrentMapId();
    logMarker3dOperation(OperationType.CREATE, marker.id, mapId, marker);

    return marker;
};

/**
 * Gets all markers for a specific tileset.
 * Filters out soft-deleted markers.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of active markers
 */
export const getMarkers = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return data.markers.filter(m => m.tilesetId === tilesetId && isActive(m.sync));
};

/**
 * Gets all markers for the current map.
 * Filters out soft-deleted markers.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of all active markers
 */
export const getAllMarkers = async (mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.markers || []).filter(m => isActive(m.sync));
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

    // Capture old state for logging
    const oldMarker = { ...marker };

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
    // Update sync metadata
    marker.sync = touchSyncMetadata(marker.sync);

    data.markers[markerIndex] = marker;
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
    }

    // Log operation for sync
    const mapId = mapManager.getCurrentMapId();
    logMarker3dOperation(OperationType.UPDATE, markerId, mapId, marker, oldMarker);

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

    // Find marker for logging before removal
    const deletedMarker = data.markers.find(m => m.id === markerId);

    const initialLength = data.markers.length;
    data.markers = data.markers.filter(m => m.id !== markerId);

    if (data.markers.length < initialLength) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
        }

        // Log operation for sync
        const mapId = mapManager.getCurrentMapId();
        logMarker3dOperation(OperationType.DELETE, markerId, mapId, null, deletedMarker);

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
        measurements: [],
        viewsheds: [],
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
        markers: cesium3dData.markers || [],
        measurements: cesium3dData.measurements || [],
        viewsheds: cesium3dData.viewsheds || []
    };

    await setCesium3dData(mapName, normalizedData);

    // Update memory if current map
    if (mapName === mapManager.getCurrentMapName()) {
        memoryStore.cesium3d = { ...normalizedData, _mapName: mapName };
        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName });
            deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName });
            deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName });
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
    const hasData = Object.keys(data.cameraPositions).length > 0 ||
        data.markers.length > 0 ||
        (data.measurements && data.measurements.length > 0) ||
        (data.viewsheds && data.viewsheds.length > 0);

    if (!hasData) {
        return null;
    }

    return {
        cameraPositions: data.cameraPositions,
        markers: data.markers,
        measurements: data.measurements || [],
        viewsheds: data.viewsheds || []
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
        const imageId = generateUUID();

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

// ===== MEASUREMENT OPERATIONS =====

/**
 * Generates unique measurement ID using UUID.
 * @returns {string} Unique UUID
 */
const generateMeasurementId = () => {
    return generateUUID();
};

/**
 * Gets the next measurement number for auto-naming.
 * @param {Array} measurements - Existing measurements
 * @param {string} type - Measurement type ('distance' or 'area')
 * @returns {number} Next measurement number
 */
const getNextMeasurementNumber = (measurements, type) => {
    let maxNumber = 0;
    const prefix = type === 'distance' ? 'Distância' : 'Área';
    const regex = new RegExp(`^${prefix} #(\\d+)$`);

    for (const measurement of measurements) {
        if (measurement.type !== type) continue;
        const match = measurement.properties?.nome?.match(regex);
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
 * Adds a new measurement to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} measurementData - Measurement data { type, positions, result, properties }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created measurement
 */
export const addMeasurement = async (tilesetId, measurementData, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    // Ensure measurements array exists
    if (!data.measurements) {
        data.measurements = [];
    }

    // Get next measurement number for auto-naming
    const type = measurementData.type || 'distance';
    const nextNumber = getNextMeasurementNumber(data.measurements, type);
    const prefix = type === 'distance' ? 'Distância' : 'Área';
    const defaultName = `${prefix} #${nextNumber}`;

    const measurement = {
        id: generateMeasurementId(),
        tilesetId,
        type: type,
        positions: measurementData.positions || [],
        result: measurementData.result || { value: 0, formatted: '' },
        properties: {
            nome: measurementData.properties?.nome || defaultName,
            descricao: measurementData.properties?.descricao || ''
        },
        images: [],
        sync: createSyncMetadata(null)
    };

    data.measurements.push(measurement);
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
    }

    // Log operation for sync
    const mapId = mapManager.getCurrentMapId();
    logMeasurement3dOperation(OperationType.CREATE, measurement.id, mapId, measurement);

    return measurement;
};

/**
 * Gets all measurements for a specific tileset.
 * Filters out soft-deleted measurements.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of active measurements
 */
export const getMeasurements = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).filter(m => m.tilesetId === tilesetId && isActive(m.sync));
};

/**
 * Gets all measurements for the current map.
 * Filters out soft-deleted measurements.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of all active measurements
 */
export const getAllMeasurements = async (mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).filter(m => isActive(m.sync));
};

/**
 * Gets a measurement by ID.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Measurement or null
 */
export const getMeasurementById = async (measurementId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.measurements || []).find(m => m.id === measurementId) || null;
};

/**
 * Updates a measurement's properties.
 *
 * @param {string} measurementId - Measurement ID
 * @param {Object} updates - Properties to update { properties }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated measurement or null if not found
 */
export const updateMeasurement = async (measurementId, updates, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.measurements) return null;

    const measurementIndex = data.measurements.findIndex(m => m.id === measurementId);
    if (measurementIndex === -1) return null;

    const measurement = data.measurements[measurementIndex];

    // Capture old state for logging
    const oldMeasurement = { ...measurement };

    // Update properties
    if (updates.properties) {
        measurement.properties = { ...measurement.properties, ...updates.properties };
    }
    // Update sync metadata
    measurement.sync = touchSyncMetadata(measurement.sync);

    data.measurements[measurementIndex] = measurement;
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
    }

    // Log operation for sync
    const mapId = mapManager.getCurrentMapId();
    logMeasurement3dOperation(OperationType.UPDATE, measurementId, mapId, measurement, oldMeasurement);

    return measurement;
};

/**
 * Removes a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if measurement was removed
 */
export const removeMeasurement = async (measurementId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.measurements) return false;

    // Find measurement for logging before removal
    const deletedMeasurement = data.measurements.find(m => m.id === measurementId);

    const initialLength = data.measurements.length;
    data.measurements = data.measurements.filter(m => m.id !== measurementId);

    if (data.measurements.length < initialLength) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
        }

        // Log operation for sync
        const mapId = mapManager.getCurrentMapId();
        logMeasurement3dOperation(OperationType.DELETE, measurementId, mapId, null, deletedMeasurement);

        return true;
    }
    return false;
};

/**
 * Adds an image to a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {File} file - Image file to add
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Created image object or null on failure
 */
export const addMeasurementImage = async (measurementId, file, mapName = null) => {
    const validation = validateImageFile(file);
    if (!validation.valid) {
        console.warn(`Invalid image: ${validation.reason}`);
        return null;
    }

    try {
        const targetMap = getTargetMapName(mapName);
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.measurements) return null;

        const measurementIndex = data.measurements.findIndex(m => m.id === measurementId);
        if (measurementIndex === -1) {
            console.warn(`Measurement not found: ${measurementId}`);
            return null;
        }

        const processedImage = await processImageFile(file);
        const imageId = generateUUID();

        const imageData = {
            id: imageId,
            name: file.name,
            type: file.type,
            size: file.size,
            data: processedImage.data,
            thumbnail: processedImage.thumbnail,
            addedAt: Date.now()
        };

        if (!data.measurements[measurementIndex].images) {
            data.measurements[measurementIndex].images = [];
        }
        data.measurements[measurementIndex].images.push(imageData);
        data.measurements[measurementIndex].updatedAt = Date.now();

        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
        }

        return imageData;
    } catch (error) {
        console.error('Error adding measurement image:', error);
        return null;
    }
};

/**
 * Gets all images for a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of image objects
 */
export const getMeasurementImages = async (measurementId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    const measurement = (data.measurements || []).find(m => m.id === measurementId);
    return measurement?.images || [];
};

/**
 * Removes an image from a measurement.
 *
 * @param {string} measurementId - Measurement ID
 * @param {string} imageId - Image ID to remove
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if image was removed
 */
export const removeMeasurementImage = async (measurementId, imageId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.measurements) return false;

    const measurementIndex = data.measurements.findIndex(m => m.id === measurementId);
    if (measurementIndex === -1) return false;

    const measurement = data.measurements[measurementIndex];
    if (!measurement.images) return false;

    const initialLength = measurement.images.length;
    measurement.images = measurement.images.filter(img => img.id !== imageId);

    if (measurement.images.length < initialLength) {
        measurement.updatedAt = Date.now();
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
        }
        return true;
    }
    return false;
};

// ===== VIEWSHED OPERATIONS =====

/**
 * Generates unique viewshed ID using UUID.
 * @returns {string} Unique UUID
 */
const generateViewshedId = () => {
    return generateUUID();
};

/**
 * Gets the next viewshed number for auto-naming.
 * @param {Array} viewsheds - Existing viewsheds
 * @returns {number} Next viewshed number
 */
const getNextViewshedNumber = (viewsheds) => {
    let maxNumber = 0;
    const regex = /^Visibilidade #(\d+)$/;

    for (const viewshed of viewsheds) {
        const match = viewshed.properties?.nome?.match(regex);
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
 * Adds a new viewshed to a tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {Object} viewshedData - Viewshed data { position, direction, parameters, properties }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object>} Created viewshed
 */
export const addViewshed = async (tilesetId, viewshedData, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    // Ensure viewsheds array exists
    if (!data.viewsheds) {
        data.viewsheds = [];
    }

    // Get next viewshed number for auto-naming
    const nextNumber = getNextViewshedNumber(data.viewsheds);
    const defaultName = `Visibilidade #${nextNumber}`;

    const viewshed = {
        id: generateViewshedId(),
        tilesetId,
        position: viewshedData.position || { longitude: 0, latitude: 0, height: 0 },
        targetPosition: viewshedData.targetPosition || null, // Second click position for accurate recreation
        terrainBaseHeight: viewshedData.terrainBaseHeight ?? null, // Terrain height at click point (without observer)
        direction: viewshedData.direction || { heading: 0, pitch: 0 },
        parameters: viewshedData.parameters || { horizontalAngle: 150, verticalAngle: 120, distance: 10 },
        observerHeight: viewshedData.observerHeight ?? 1.5, // Height above terrain in meters
        properties: {
            nome: viewshedData.properties?.nome || defaultName,
            descricao: viewshedData.properties?.descricao || ''
        },
        images: [],
        sync: createSyncMetadata(null)
    };

    data.viewsheds.push(viewshed);
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
    }

    // Log operation for sync
    const mapId = mapManager.getCurrentMapId();
    logViewshed3dOperation(OperationType.CREATE, viewshed.id, mapId, viewshed);

    return viewshed;
};

/**
 * Gets all viewsheds for a specific tileset.
 * Filters out soft-deleted viewsheds.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of active viewsheds
 */
export const getViewsheds = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).filter(v => v.tilesetId === tilesetId && isActive(v.sync));
};

/**
 * Gets all viewsheds for the current map.
 * Filters out soft-deleted viewsheds.
 *
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of all active viewsheds
 */
export const getAllViewsheds = async (mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).filter(v => isActive(v.sync));
};

/**
 * Gets a viewshed by ID.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Viewshed or null
 */
export const getViewshedById = async (viewshedId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    return (data.viewsheds || []).find(v => v.id === viewshedId) || null;
};

/**
 * Updates a viewshed's properties.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {Object} updates - Properties to update { properties, observerHeight }
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Updated viewshed or null if not found
 */
export const updateViewshed = async (viewshedId, updates, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.viewsheds) return null;

    const viewshedIndex = data.viewsheds.findIndex(v => v.id === viewshedId);
    if (viewshedIndex === -1) return null;

    const viewshed = data.viewsheds[viewshedIndex];

    // Capture old state for logging
    const oldViewshed = { ...viewshed };

    // Update properties
    if (updates.properties) {
        viewshed.properties = { ...viewshed.properties, ...updates.properties };
    }
    // Update observer height
    if (updates.observerHeight !== undefined) {
        viewshed.observerHeight = updates.observerHeight;
    }
    // Update sync metadata
    viewshed.sync = touchSyncMetadata(viewshed.sync);

    data.viewsheds[viewshedIndex] = viewshed;
    await saveCesium3dData(targetMap, data);

    if (deps.eventBus) {
        deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
    }

    // Log operation for sync
    const mapId = mapManager.getCurrentMapId();
    logViewshed3dOperation(OperationType.UPDATE, viewshedId, mapId, viewshed, oldViewshed);

    return viewshed;
};

/**
 * Removes a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if viewshed was removed
 */
export const removeViewshed = async (viewshedId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.viewsheds) return false;

    // Find viewshed for logging before removal
    const deletedViewshed = data.viewsheds.find(v => v.id === viewshedId);

    const initialLength = data.viewsheds.length;
    data.viewsheds = data.viewsheds.filter(v => v.id !== viewshedId);

    if (data.viewsheds.length < initialLength) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
        }

        // Log operation for sync
        const mapId = mapManager.getCurrentMapId();
        logViewshed3dOperation(OperationType.DELETE, viewshedId, mapId, null, deletedViewshed);

        return true;
    }
    return false;
};

/**
 * Adds an image to a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {File} file - Image file to add
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Object|null>} Created image object or null on failure
 */
export const addViewshedImage = async (viewshedId, file, mapName = null) => {
    const validation = validateImageFile(file);
    if (!validation.valid) {
        console.warn(`Invalid image: ${validation.reason}`);
        return null;
    }

    try {
        const targetMap = getTargetMapName(mapName);
        const data = await getCesium3dDataWithCache(targetMap);

        if (!data.viewsheds) return null;

        const viewshedIndex = data.viewsheds.findIndex(v => v.id === viewshedId);
        if (viewshedIndex === -1) {
            console.warn(`Viewshed not found: ${viewshedId}`);
            return null;
        }

        const processedImage = await processImageFile(file);
        const imageId = generateUUID();

        const imageData = {
            id: imageId,
            name: file.name,
            type: file.type,
            size: file.size,
            data: processedImage.data,
            thumbnail: processedImage.thumbnail,
            addedAt: Date.now()
        };

        if (!data.viewsheds[viewshedIndex].images) {
            data.viewsheds[viewshedIndex].images = [];
        }
        data.viewsheds[viewshedIndex].images.push(imageData);
        data.viewsheds[viewshedIndex].updatedAt = Date.now();

        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
        }

        return imageData;
    } catch (error) {
        console.error('Error adding viewshed image:', error);
        return null;
    }
};

/**
 * Gets all images for a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<Array>} Array of image objects
 */
export const getViewshedImages = async (viewshedId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);
    const viewshed = (data.viewsheds || []).find(v => v.id === viewshedId);
    return viewshed?.images || [];
};

/**
 * Removes an image from a viewshed.
 *
 * @param {string} viewshedId - Viewshed ID
 * @param {string} imageId - Image ID to remove
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<boolean>} True if image was removed
 */
export const removeViewshedImage = async (viewshedId, imageId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.viewsheds) return false;

    const viewshedIndex = data.viewsheds.findIndex(v => v.id === viewshedId);
    if (viewshedIndex === -1) return false;

    const viewshed = data.viewsheds[viewshedIndex];
    if (!viewshed.images) return false;

    const initialLength = viewshed.images.length;
    viewshed.images = viewshed.images.filter(img => img.id !== imageId);

    if (viewshed.images.length < initialLength) {
        viewshed.updatedAt = Date.now();
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
        }
        return true;
    }
    return false;
};

// ===== BULK REMOVAL OPERATIONS =====

/**
 * Removes all measurements for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>} Number of measurements removed
 */
export const removeMeasurementsByTileset = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.measurements) return 0;

    const initialLength = data.measurements.length;
    data.measurements = data.measurements.filter(m => m.tilesetId !== tilesetId);
    const removedCount = initialLength - data.measurements.length;

    if (removedCount > 0) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
        }
    }
    return removedCount;
};

/**
 * Removes all viewsheds for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<number>} Number of viewsheds removed
 */
export const removeViewshedsByTileset = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    if (!data.viewsheds) return 0;

    const initialLength = data.viewsheds.length;
    data.viewsheds = data.viewsheds.filter(v => v.tilesetId !== tilesetId);
    const removedCount = initialLength - data.viewsheds.length;

    if (removedCount > 0) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
        }
    }
    return removedCount;
};

/**
 * Removes all features (markers, measurements, viewsheds) for a specific tileset.
 *
 * @param {string} tilesetId - Tileset ID
 * @param {string|null} mapName - Map name (null = current)
 * @returns {Promise<{markers: number, measurements: number, viewsheds: number, total: number}>} Count of removed features
 */
export const removeAllFeaturesByTileset = async (tilesetId, mapName = null) => {
    const targetMap = getTargetMapName(mapName);
    const data = await getCesium3dDataWithCache(targetMap);

    // Count markers to remove
    const initialMarkersLength = data.markers.length;
    data.markers = data.markers.filter(m => m.tilesetId !== tilesetId);
    const markersRemoved = initialMarkersLength - data.markers.length;

    // Count measurements to remove
    const initialMeasurementsLength = data.measurements?.length || 0;
    if (data.measurements) {
        data.measurements = data.measurements.filter(m => m.tilesetId !== tilesetId);
    }
    const measurementsRemoved = initialMeasurementsLength - (data.measurements?.length || 0);

    // Count viewsheds to remove
    const initialViewshedsLength = data.viewsheds?.length || 0;
    if (data.viewsheds) {
        data.viewsheds = data.viewsheds.filter(v => v.tilesetId !== tilesetId);
    }
    const viewshedsRemoved = initialViewshedsLength - (data.viewsheds?.length || 0);

    const totalRemoved = markersRemoved + measurementsRemoved + viewshedsRemoved;

    if (totalRemoved > 0) {
        await saveCesium3dData(targetMap, data);

        if (deps.eventBus) {
            if (markersRemoved > 0) {
                deps.eventBus.emit(EventTypes.MARKERS_3D_CHANGED, { mapName: targetMap });
            }
            if (measurementsRemoved > 0) {
                deps.eventBus.emit(EventTypes.MEASUREMENTS_3D_CHANGED, { mapName: targetMap });
            }
            if (viewshedsRemoved > 0) {
                deps.eventBus.emit(EventTypes.VIEWSHEDS_3D_CHANGED, { mapName: targetMap });
            }
        }
    }

    return {
        markers: markersRemoved,
        measurements: measurementsRemoved,
        viewsheds: viewshedsRemoved,
        total: totalRemoved
    };
};

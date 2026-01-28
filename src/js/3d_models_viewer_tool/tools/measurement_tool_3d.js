// Path: js/3d_models_viewer_tool/tools/measurement_tool_3d.js

/**
 * @fileoverview 3D Measurement tool wrapper for cesium-measure.
 * Provides persistence and selection for distance and area measurements.
 * Follows the same pattern as marker_tool_3d.js.
 */

import {
    addMeasurement,
    getMeasurements,
    updateMeasurement,
    removeMeasurement
} from '../../store/index.js';
import { getEventBus } from '../../store/services.js';
import { EventTypes } from '../../events/event_types.js';

// ===== MODULE STATE =====

let isToolActive = false;
let currentViewer = null;
let currentTilesetId = null;
let currentToolType = null; // 'distance' | 'area'
const measurementEntities = new Map(); // measurementId -> { entities: Cesium.Entity[], dataSource: Cesium.CustomDataSource }
let selectedMeasurementId = null;
let selectionHandler = null;

// ===== UTILITY FUNCTIONS =====

/**
 * Formats distance value.
 * @param {number} meters - Distance in meters
 * @returns {string} Formatted distance
 */
function formatDistance(meters) {
    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters.toFixed(2)} m`;
}

/**
 * Formats area value.
 * @param {number} sqMeters - Area in square meters
 * @returns {string} Formatted area
 */
function formatArea(sqMeters) {
    if (sqMeters >= 1000000) {
        return `${(sqMeters / 1000000).toFixed(2)} km²`;
    }
    if (sqMeters >= 10000) {
        return `${(sqMeters / 10000).toFixed(2)} ha`;
    }
    return `${sqMeters.toFixed(2)} m²`;
}

// ===== MEASUREMENT VISUALIZATION =====

/**
 * Creates Cesium entities for a measurement.
 * @param {Object} measurement - Measurement data
 * @returns {Object} Object with entities array
 */
function createMeasurementEntities(measurement) {
    if (!currentViewer || !window.Cesium) return null;

    const entities = [];
    const positions = measurement.positions.map(pos =>
        Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, pos.height || 0)
    );

    if (positions.length < 2) return null;

    const isSelected = selectedMeasurementId === measurement.id;
    const lineColor = isSelected ? Cesium.Color.CYAN : Cesium.Color.YELLOW;
    const fillColor = isSelected ? Cesium.Color.CYAN.withAlpha(0.3) : Cesium.Color.YELLOW.withAlpha(0.2);

    if (measurement.type === 'distance') {
        // Create line entity
        const lineEntity = currentViewer.entities.add({
            id: `measurement-3d-line-${measurement.id}`,
            polyline: {
                positions: positions,
                width: isSelected ? 4 : 2,
                material: lineColor,
                clampToGround: true,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            properties: {
                measurementId: measurement.id,
                measurementData: measurement
            }
        });
        entities.push(lineEntity);

        // Create point entities at vertices
        positions.forEach((pos, index) => {
            const pointEntity = currentViewer.entities.add({
                id: `measurement-3d-point-${measurement.id}-${index}`,
                position: pos,
                point: {
                    pixelSize: isSelected ? 10 : 8,
                    color: lineColor,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                },
                properties: {
                    measurementId: measurement.id,
                    measurementData: measurement
                }
            });
            entities.push(pointEntity);
        });

        // Create label at midpoint
        const midIndex = Math.floor(positions.length / 2);
        const labelPosition = positions[midIndex];
        const labelEntity = currentViewer.entities.add({
            id: `measurement-3d-label-${measurement.id}`,
            position: labelPosition,
            label: {
                text: measurement.result?.formatted || formatDistance(measurement.result?.value || 0),
                font: '14px Inter, sans-serif',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                outlineColor: Cesium.Color.BLACK,
                fillColor: Cesium.Color.WHITE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, -15),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                showBackground: true,
                backgroundColor: lineColor.withAlpha(0.8)
            },
            properties: {
                measurementId: measurement.id,
                measurementData: measurement
            }
        });
        entities.push(labelEntity);

    } else if (measurement.type === 'area') {
        // Close the polygon if not closed
        const polygonPositions = [...positions];
        if (positions.length >= 3) {
            // Create polygon entity
            const polygonEntity = currentViewer.entities.add({
                id: `measurement-3d-polygon-${measurement.id}`,
                polygon: {
                    hierarchy: new Cesium.PolygonHierarchy(polygonPositions),
                    material: fillColor,
                    outline: true,
                    outlineColor: lineColor,
                    outlineWidth: 2,
                    perPositionHeight: true
                },
                properties: {
                    measurementId: measurement.id,
                    measurementData: measurement
                }
            });
            entities.push(polygonEntity);

            // Create line around the polygon
            const lineEntity = currentViewer.entities.add({
                id: `measurement-3d-line-${measurement.id}`,
                polyline: {
                    positions: [...polygonPositions, polygonPositions[0]], // Close the loop
                    width: isSelected ? 4 : 2,
                    material: lineColor,
                    clampToGround: true,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                properties: {
                    measurementId: measurement.id,
                    measurementData: measurement
                }
            });
            entities.push(lineEntity);
        }

        // Create point entities at vertices
        positions.forEach((pos, index) => {
            const pointEntity = currentViewer.entities.add({
                id: `measurement-3d-point-${measurement.id}-${index}`,
                position: pos,
                point: {
                    pixelSize: isSelected ? 10 : 8,
                    color: lineColor,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                },
                properties: {
                    measurementId: measurement.id,
                    measurementData: measurement
                }
            });
            entities.push(pointEntity);
        });

        // Create label at centroid
        if (positions.length >= 3) {
            const centroid = Cesium.BoundingSphere.fromPoints(positions).center;
            const labelEntity = currentViewer.entities.add({
                id: `measurement-3d-label-${measurement.id}`,
                position: centroid,
                label: {
                    text: measurement.result?.formatted || formatArea(measurement.result?.value || 0),
                    font: '14px Inter, sans-serif',
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    outlineWidth: 2,
                    outlineColor: Cesium.Color.BLACK,
                    fillColor: Cesium.Color.WHITE,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    showBackground: true,
                    backgroundColor: lineColor.withAlpha(0.8)
                },
                properties: {
                    measurementId: measurement.id,
                    measurementData: measurement
                }
            });
            entities.push(labelEntity);
        }
    }

    return { entities };
}

/**
 * Removes measurement entities from the viewer.
 * @param {string} measurementId - Measurement ID
 */
function removeMeasurementEntities(measurementId) {
    const data = measurementEntities.get(measurementId);
    if (data && currentViewer) {
        data.entities.forEach(entity => {
            currentViewer.entities.remove(entity);
        });
        measurementEntities.delete(measurementId);
    }
}

/**
 * Clears all measurement entities from the viewer.
 */
function clearAllMeasurementEntities() {
    if (!currentViewer) return;

    for (const data of measurementEntities.values()) {
        data.entities.forEach(entity => {
            currentViewer.entities.remove(entity);
        });
    }
    measurementEntities.clear();
}

/**
 * Updates measurement entity visuals (e.g., selection highlight).
 * @param {string} measurementId - Measurement ID
 * @param {Object} measurement - Measurement data
 */
function updateMeasurementEntityVisuals(measurementId, measurement) {
    // Remove and recreate entities with updated visuals
    removeMeasurementEntities(measurementId);
    const entityData = createMeasurementEntities(measurement);
    if (entityData) {
        measurementEntities.set(measurementId, entityData);
    }
}

// ===== TOOL ACTIVATION =====

/**
 * Activates the measurement tool.
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @param {string} tilesetId - Current tileset ID
 * @param {string} type - Measurement type: 'distance' or 'area'
 */
export function activateMeasurementTool(viewer, tilesetId, type) {
    if (!viewer || !tilesetId || !type) {
        console.warn('Cannot activate measurement tool: missing parameters');
        return;
    }

    currentViewer = viewer;
    currentTilesetId = tilesetId;
    currentToolType = type;
    isToolActive = true;

    // Use cesium-measure library
    if (window.measure) {
        const options = {
            clampToGround: true,
            callback: async (result) => {
                await handleMeasurementComplete(result);
            }
        };

        if (type === 'distance') {
            window.measure.drawLineMeasureGraphics(options);
        } else if (type === 'area') {
            window.measure.drawAreaMeasureGraphics(options);
        }
    }

    viewer.canvas.style.cursor = 'crosshair';
}

/**
 * Deactivates the measurement tool.
 */
export function deactivateMeasurementTool() {
    isToolActive = false;
    currentToolType = null;

    if (window.measure) {
        if (window.measure.removeDrawLineMeasureGraphics) {
            window.measure.removeDrawLineMeasureGraphics();
        }
        if (window.measure.removeDrawAreaMeasureGraphics) {
            window.measure.removeDrawAreaMeasureGraphics();
        }
    }

    if (currentViewer) {
        currentViewer.canvas.style.cursor = '';
    }
}

/**
 * Handles measurement completion from cesium-measure.
 * @param {Object} result - Measurement result from cesium-measure
 */
async function handleMeasurementComplete(_result) {
    if (!currentViewer || !currentTilesetId || !currentToolType) return;

    // Extract positions from measure entities
    const positions = extractPositionsFromMeasure();
    if (positions.length < 2) {
        console.warn('Not enough positions for measurement');
        return;
    }

    // Calculate result
    let value = 0;
    let formatted = '';

    if (currentToolType === 'distance') {
        value = calculateDistance(positions);
        formatted = formatDistance(value);
    } else if (currentToolType === 'area') {
        value = calculateArea(positions);
        formatted = formatArea(value);
    }

    // Create measurement in store
    const measurementData = {
        type: currentToolType,
        positions: positions,
        result: { value, formatted }
    };

    const measurement = await addMeasurement(currentTilesetId, measurementData);

    // Clear cesium-measure entities (we'll use our own persistent entities)
    if (window.measure && window.measure._drawLayer) {
        window.measure._drawLayer.entities.removeAll();
    }

    // Create visual entities
    const entityData = createMeasurementEntities(measurement);
    if (entityData) {
        measurementEntities.set(measurement.id, entityData);
    }

    // Select the new measurement and emit event
    selectMeasurement(measurement.id);
    emitMeasurementClicked(measurement);

    // Deactivate the tool
    try {
        const { deactivateActiveTool3D } = await import('../map_3d.js');
        deactivateActiveTool3D();
    } catch (error) {
        console.warn('Could not deactivate tool:', error);
    }
}

/**
 * Extracts positions from cesium-measure's draw layer.
 * @returns {Array} Array of position objects
 */
function extractPositionsFromMeasure() {
    const positions = [];

    if (!window.measure || !window.measure._bindPositions) {
        return positions;
    }

    // cesium-measure stores positions in _bindPositions
    const cartesians = window.measure._bindPositions;
    if (cartesians && Array.isArray(cartesians)) {
        for (const cartesian of cartesians) {
            if (Cesium.defined(cartesian)) {
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                positions.push({
                    longitude: Cesium.Math.toDegrees(carto.longitude),
                    latitude: Cesium.Math.toDegrees(carto.latitude),
                    height: carto.height
                });
            }
        }
    }

    return positions;
}

/**
 * Calculates distance between points.
 * @param {Array} positions - Array of position objects
 * @returns {number} Distance in meters
 */
function calculateDistance(positions) {
    let totalDistance = 0;

    for (let i = 0; i < positions.length - 1; i++) {
        const p1 = positions[i];
        const p2 = positions[i + 1];

        const geodesic = new Cesium.EllipsoidGeodesic(
            Cesium.Cartographic.fromDegrees(p1.longitude, p1.latitude),
            Cesium.Cartographic.fromDegrees(p2.longitude, p2.latitude)
        );
        totalDistance += geodesic.surfaceDistance;
    }

    return totalDistance;
}

/**
 * Calculates area of a polygon.
 * @param {Array} positions - Array of position objects
 * @returns {number} Area in square meters
 */
function calculateArea(positions) {
    if (positions.length < 3) return 0;

    // Calculate area using geodesic method
    let area = 0;
    const n = positions.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lat1 = Cesium.Math.toRadians(positions[i].latitude);
        const lat2 = Cesium.Math.toRadians(positions[j].latitude);
        const lon1 = Cesium.Math.toRadians(positions[i].longitude);
        const lon2 = Cesium.Math.toRadians(positions[j].longitude);

        area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    // Earth's radius squared
    const R = 6371000;
    area = Math.abs(area * R * R / 2);

    return area;
}

// ===== SELECTION =====

/**
 * Selects a measurement (highlights it).
 * @param {string} measurementId - Measurement ID
 */
function selectMeasurement(measurementId) {
    // Deselect previous
    if (selectedMeasurementId && measurementEntities.has(selectedMeasurementId)) {
        // Refresh visuals without selection
        getMeasurementById(selectedMeasurementId).then(m => {
            if (m) updateMeasurementEntityVisuals(selectedMeasurementId, m);
        });
    }

    selectedMeasurementId = measurementId;

    // Highlight selected
    if (measurementId && measurementEntities.has(measurementId)) {
        getMeasurementById(measurementId).then(m => {
            if (m) updateMeasurementEntityVisuals(measurementId, m);
        });
    }
}

/**
 * Gets a measurement by ID (async wrapper).
 * @param {string} measurementId - Measurement ID
 * @returns {Promise<Object|null>} Measurement or null
 */
async function getMeasurementById(measurementId) {
    const { getMeasurementById: getById } = await import('../../store/index.js');
    return await getById(measurementId);
}

/**
 * Emits measurement clicked event.
 * @param {Object} measurement - Measurement data
 */
function emitMeasurementClicked(measurement) {
    const eventBus = getEventBus();
    if (eventBus) {
        eventBus.emit(EventTypes.MEASUREMENT_3D_CLICKED, {
            measurement,
            tilesetId: currentTilesetId
        });
    }
}

/**
 * Emits measurement deselected event.
 */
function emitMeasurementDeselected() {
    const eventBus = getEventBus();
    if (eventBus) {
        eventBus.emit(EventTypes.MEASUREMENT_3D_DESELECTED, {
            tilesetId: currentTilesetId
        });
    }
}

// ===== PUBLIC API =====

/**
 * Renders measurements for a tileset (when viewer opens).
 * @param {Cesium.Viewer} viewer - Cesium viewer
 * @param {string} tilesetId - Tileset ID
 */
export async function renderMeasurementsForTileset(viewer, tilesetId) {
    currentViewer = viewer;
    currentTilesetId = tilesetId;

    // Clear existing entities
    clearAllMeasurementEntities();

    // Load and render
    const measurements = await getMeasurements(tilesetId);
    for (const measurement of measurements) {
        const entityData = createMeasurementEntities(measurement);
        if (entityData) {
            measurementEntities.set(measurement.id, entityData);
        }
    }

    // Set up selection handler
    setupMeasurementSelectionHandler(viewer);
}

/**
 * Sets up handler for selecting measurements.
 * @param {Cesium.Viewer} viewer - Cesium viewer
 */
function setupMeasurementSelectionHandler(viewer) {
    // Remove existing handler
    if (selectionHandler) {
        selectionHandler.destroy();
        selectionHandler = null;
    }

    selectionHandler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

    selectionHandler.setInputAction((click) => {
        if (isToolActive) return;

        const pickedObject = viewer.scene.pick(click.position);

        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
            let measurementId = pickedObject.id.properties.measurementId;
            if (measurementId && typeof measurementId.getValue === 'function') {
                measurementId = measurementId.getValue();
            }

            if (measurementId) {
                let measurementData = pickedObject.id.properties.measurementData;
                if (measurementData && typeof measurementData.getValue === 'function') {
                    measurementData = measurementData.getValue();
                }

                if (measurementData) {
                    selectMeasurement(measurementId);
                    emitMeasurementClicked(measurementData);
                }

            }
        }

        // Don't deselect on empty click - let the marker handler do that
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/**
 * Updates a measurement's properties.
 * @param {string} measurementId - Measurement ID
 * @param {Object} updates - Properties to update
 * @returns {Promise<Object|null>} Updated measurement
 */
export async function updateMeasurementProperties(measurementId, updates) {
    const updatedMeasurement = await updateMeasurement(measurementId, updates);

    if (updatedMeasurement) {
        updateMeasurementEntityVisuals(measurementId, updatedMeasurement);
    }

    return updatedMeasurement;
}

/**
 * Deletes a measurement.
 * @param {string} measurementId - Measurement ID
 */
export async function deleteMeasurement(measurementId) {
    const result = await removeMeasurement(measurementId);

    if (result) {
        removeMeasurementEntities(measurementId);
        if (selectedMeasurementId === measurementId) {
            selectedMeasurementId = null;
        }
    }

    return result;
}

/**
 * Flies to a measurement's position.
 * @param {Object} measurement - Measurement data
 */
export function flyToMeasurement(measurement) {
    if (!currentViewer || !measurement || !measurement.positions?.length) return;

    const cartesians = measurement.positions.map(pos =>
        Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, pos.height || 0)
    );

    const boundingSphere = Cesium.BoundingSphere.fromPoints(cartesians);

    currentViewer.camera.flyToBoundingSphere(boundingSphere, {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), boundingSphere.radius * 3),
        duration: 1.5
    });

    selectMeasurement(measurement.id);
}

/**
 * Cleans up measurement tool resources.
 */
export function cleanupMeasurementTool() {
    deactivateMeasurementTool();
    clearAllMeasurementEntities();

    if (selectionHandler) {
        selectionHandler.destroy();
        selectionHandler = null;
    }

    currentViewer = null;
    currentTilesetId = null;
}

/**
 * Gets current tileset ID.
 * @returns {string|null} Current tileset ID
 */
export function getCurrentTilesetId() {
    return currentTilesetId;
}

/**
 * Checks if measurement tool is active.
 * @returns {boolean} True if active
 */
export function isMeasurementToolActive() {
    return isToolActive;
}

/**
 * Refreshes measurements for the current tileset.
 */
export async function refreshMeasurementsForCurrentTileset() {
    if (!currentViewer || !currentTilesetId) return;

    clearAllMeasurementEntities();

    if (selectedMeasurementId) {
        selectedMeasurementId = null;
        emitMeasurementDeselected();
    }

    const measurements = await getMeasurements(currentTilesetId);
    for (const measurement of measurements) {
        const entityData = createMeasurementEntities(measurement);
        if (entityData) {
            measurementEntities.set(measurement.id, entityData);
        }
    }
}

/**
 * Initializes measurement tool event listeners.
 */
export function initMeasurementToolListeners() {
    const eventBus = getEventBus();
    if (!eventBus) return;

    eventBus.on(EventTypes.LAYERS_CHANGED, () => {
        if (currentViewer && currentTilesetId) {
            refreshMeasurementsForCurrentTileset();
        }
    });
}

/**
 * Deselects the currently selected measurement.
 */
export function deselectCurrentMeasurement() {
    if (selectedMeasurementId) {
        const prevId = selectedMeasurementId;
        selectedMeasurementId = null;

        // Refresh visuals without selection
        getMeasurementById(prevId).then(m => {
            if (m) updateMeasurementEntityVisuals(prevId, m);
        });

        emitMeasurementDeselected();
    }
}

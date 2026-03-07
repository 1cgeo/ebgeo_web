// Path: js/3d_models_viewer_tool/tools/measurement_tool_3d.js

/**
 * @fileoverview 3D Measurement tool for distance and area measurements on Cesium tilesets.
 * Uses direct ScreenSpaceEventHandler for capturing positions (like marker_tool_3d.js).
 * Supports persistence, selection, and panel integration.
 */

import {
    addMeasurement,
    getMeasurements,
    updateMeasurement,
    removeMeasurement,
    DEFAULT_MEASUREMENT_STYLE
} from '@store/index.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { hexToCesiumColor } from '../services/cesium-color.js';

// ===== MODULE STATE =====

let isToolActive = false;
let currentViewer = null;
let currentTilesetId = null;
let currentToolType = null; // 'distance' | 'area'
let clickHandler = null;
let selectionHandler = null;

// Drawing state
let tempPositions = []; // Positions being drawn
let tempEntities = []; // Temporary entities during drawing
let previewPosition = null; // Current mouse position for rubber-band preview
let lastPreviewUpdate = 0; // Throttle preview updates
const PREVIEW_THROTTLE_MS = 50; // Update preview max every 50ms

// Persisted measurements
const measurementEntities = new Map(); // measurementId -> { entities: Cesium.Entity[] }
let selectedMeasurementId = null;

// ===== CONSTANTS =====

const COLORS = {
    TEMP_LINE: null, // Will be set when Cesium is available
    TEMP_FILL: null,
    SELECTED_LINE: null,
    SELECTED_FILL: null,
    DEFAULT_LINE: null,
    DEFAULT_FILL: null
};

function initColors() {
    if (!window.Cesium) return;
    COLORS.TEMP_LINE = Cesium.Color.ORANGE;
    COLORS.TEMP_FILL = Cesium.Color.ORANGE.withAlpha(0.2);
    COLORS.SELECTED_LINE = Cesium.Color.CYAN;
    COLORS.SELECTED_FILL = Cesium.Color.CYAN.withAlpha(0.3);
    COLORS.DEFAULT_LINE = Cesium.Color.YELLOW;
    COLORS.DEFAULT_FILL = Cesium.Color.YELLOW.withAlpha(0.2);
}

// ===== UTILITY FUNCTIONS =====

/**
 * Resolves measurement style with defaults.
 * @param {Object} [measurementStyle] - Style from measurement data
 * @returns {Object} Resolved style with all fields
 */
function resolveStyle(measurementStyle) {
    return { ...DEFAULT_MEASUREMENT_STYLE, ...(measurementStyle || {}) };
}

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

/**
 * Calculates 3D distance between points including height differences.
 * Uses Cartesian3.distance() for true 3D measurement (not just geodesic/horizontal).
 * @param {Array} positions - Array of position objects { longitude, latitude, height }
 * @returns {number} Distance in meters
 */
function calculateDistance(positions) {
    let totalDistance = 0;

    for (let i = 0; i < positions.length - 1; i++) {
        const p1 = positions[i];
        const p2 = positions[i + 1];

        // Use Cartesian3.distance for true 3D distance including height
        const c1 = Cesium.Cartesian3.fromDegrees(
            p1.longitude,
            p1.latitude,
            p1.height || 0
        );
        const c2 = Cesium.Cartesian3.fromDegrees(
            p2.longitude,
            p2.latitude,
            p2.height || 0
        );

        totalDistance += Cesium.Cartesian3.distance(c1, c2);
    }

    return totalDistance;
}

/**
 * Calculates area of a polygon.
 * @param {Array} positions - Array of position objects { longitude, latitude, height }
 * @returns {number} Area in square meters
 */
function calculateArea(positions) {
    if (positions.length < 3) return 0;

    // Calculate area using geodesic method (spherical excess formula)
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

/**
 * Gets click position on the 3D model.
 * @param {Object} click - Click event
 * @returns {Object|null} Position { longitude, latitude, height } or null
 */
function getClickPosition(click) {
    if (!currentViewer) return null;

    const cartesian = currentViewer.scene.pickPosition(click.position);
    if (!Cesium.defined(cartesian)) {
        return null;
    }

    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    return {
        longitude: Cesium.Math.toDegrees(cartographic.longitude),
        latitude: Cesium.Math.toDegrees(cartographic.latitude),
        height: cartographic.height
    };
}

// ===== TEMPORARY VISUALIZATION (during drawing) =====

/**
 * Clears all temporary entities.
 */
function clearTempEntities() {
    if (!currentViewer || currentViewer.isDestroyed()) {
        tempEntities = [];
        return;
    }

    for (const entity of tempEntities) {
        try {
            if (entity && currentViewer.entities.contains(entity)) {
                currentViewer.entities.remove(entity);
            }
        } catch (e) {
            console.warn('Error removing temp entity:', e);
        }
    }
    tempEntities = [];
}

/**
 * Updates temporary visualization during drawing.
 * Includes rubber-band preview to current mouse position.
 */
function updateTempVisualization() {
    if (!currentViewer || tempPositions.length === 0) return;

    // Ensure colors are initialized
    initColors();
    if (!COLORS.TEMP_LINE) return;

    // Clear existing temp entities
    clearTempEntities();

    // Build positions array including preview position for rubber-band effect
    const allPositions = [...tempPositions];
    if (previewPosition) {
        allPositions.push(previewPosition);
    }

    const cartesians = allPositions.map(pos =>
        Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, pos.height || 0)
    );

    // Add small vertex markers at each confirmed position (visual only, small to not interfere with picking)
    for (let i = 0; i < tempPositions.length; i++) {
        const pointEntity = currentViewer.entities.add({
            id: `temp-measurement-point-${i}`,
            position: Cesium.Cartesian3.fromDegrees(
                tempPositions[i].longitude,
                tempPositions[i].latitude,
                tempPositions[i].height || 0
            ),
            point: {
                pixelSize: 6, // Smaller to reduce interference with picking
                color: COLORS.TEMP_LINE,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                heightReference: Cesium.HeightReference.NONE
            }
        });
        tempEntities.push(pointEntity);
    }

    // Add line for distance (including preview position)
    if (currentToolType === 'distance' && cartesians.length >= 2) {
        const lineEntity = currentViewer.entities.add({
            id: 'temp-measurement-line',
            polyline: {
                positions: cartesians,
                width: 3,
                material: COLORS.TEMP_LINE,
                clampToGround: false,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        tempEntities.push(lineEntity);

        // Show current distance (including preview segment)
        const distance = calculateDistance(allPositions);
        const midIndex = Math.floor(cartesians.length / 2);
        const labelEntity = currentViewer.entities.add({
            id: 'temp-measurement-label',
            position: cartesians[midIndex],
            label: {
                text: formatDistance(distance),
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
                backgroundColor: COLORS.TEMP_LINE.withAlpha(0.8)
            }
        });
        tempEntities.push(labelEntity);

    } else if (currentToolType === 'area' && cartesians.length >= 3) {
        // Add polygon (including preview position)
        const polygonEntity = currentViewer.entities.add({
            id: 'temp-measurement-polygon',
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(cartesians),
                material: COLORS.TEMP_FILL,
                outline: true,
                outlineColor: COLORS.TEMP_LINE,
                outlineWidth: 2,
                perPositionHeight: true
            }
        });
        tempEntities.push(polygonEntity);

        // Add outline (closed loop including preview)
        const outlineEntity = currentViewer.entities.add({
            id: 'temp-measurement-outline',
            polyline: {
                positions: [...cartesians, cartesians[0]], // Close the loop
                width: 3,
                material: COLORS.TEMP_LINE,
                clampToGround: false,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        tempEntities.push(outlineEntity);

        // Show current area (including preview position)
        const area = calculateArea(allPositions);
        const centroid = Cesium.BoundingSphere.fromPoints(cartesians).center;
        const labelEntity = currentViewer.entities.add({
            id: 'temp-measurement-label',
            position: centroid,
            label: {
                text: formatArea(area),
                font: '14px Inter, sans-serif',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: 2,
                outlineColor: Cesium.Color.BLACK,
                fillColor: Cesium.Color.WHITE,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                showBackground: true,
                backgroundColor: COLORS.TEMP_LINE.withAlpha(0.8)
            }
        });
        tempEntities.push(labelEntity);
    }
}

// ===== MEASUREMENT VISUALIZATION (persisted) =====

/**
 * Creates Cesium entities for a persisted measurement.
 * @param {Object} measurement - Measurement data
 * @returns {Object} Object with entities array
 */
function createMeasurementEntities(measurement) {
    if (!currentViewer || !window.Cesium) return null;

    // Ensure colors are initialized (for selection highlighting)
    initColors();
    if (!COLORS.SELECTED_LINE) return null;

    const entities = [];
    const positions = measurement.positions.map(pos =>
        Cesium.Cartesian3.fromDegrees(pos.longitude, pos.latitude, pos.height || 0)
    );

    if (positions.length < 2) return null;

    const isSelected = selectedMeasurementId === measurement.id;
    const style = resolveStyle(measurement.style);

    // Always use custom style colors so user sees live preview while editing.
    // Selection is indicated by wider line and larger points only.
    const lineColor = hexToCesiumColor(style.lineColor, style.lineOpacity);
    const fillColor = hexToCesiumColor(style.fillColor, style.fillOpacity);
    const lineWidth = isSelected ? style.lineWidth + 1 : style.lineWidth;
    const pointColor = hexToCesiumColor(style.lineColor, style.lineOpacity);

    const labelFillColor = hexToCesiumColor(style.labelColor);
    const labelOutlineColor = hexToCesiumColor(style.labelOutlineColor);
    const labelBgColor = hexToCesiumColor(style.labelBackgroundColor, style.labelBackgroundOpacity);

    if (measurement.type === 'distance') {
        // Create line entity
        const lineEntity = currentViewer.entities.add({
            id: `measurement-3d-line-${measurement.id}`,
            polyline: {
                positions: positions,
                width: lineWidth,
                material: lineColor,
                clampToGround: false,
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
                    color: pointColor,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    heightReference: Cesium.HeightReference.NONE
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
                font: `${style.labelSize}px Inter, sans-serif`,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                outlineWidth: style.labelOutlineWidth,
                outlineColor: labelOutlineColor,
                fillColor: labelFillColor,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                pixelOffset: new Cesium.Cartesian2(0, -15),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                showBackground: true,
                backgroundColor: labelBgColor
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
                    width: lineWidth,
                    material: lineColor,
                    clampToGround: false,
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
                    color: pointColor,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    heightReference: Cesium.HeightReference.NONE
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
                    font: `${style.labelSize}px Inter, sans-serif`,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    outlineWidth: style.labelOutlineWidth,
                    outlineColor: labelOutlineColor,
                    fillColor: labelFillColor,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    showBackground: true,
                    backgroundColor: labelBgColor
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
    if (data && data.entities && currentViewer && !currentViewer.isDestroyed()) {
        for (const entity of data.entities) {
            try {
                if (entity && currentViewer.entities.contains(entity)) {
                    currentViewer.entities.remove(entity);
                }
            } catch (e) {
                console.warn('Error removing entity:', e);
            }
        }
        measurementEntities.delete(measurementId);
    }
}

/**
 * Clears all measurement entities from the viewer.
 */
function clearAllMeasurementEntities() {
    if (!currentViewer || currentViewer.isDestroyed()) {
        measurementEntities.clear();
        return;
    }

    for (const data of measurementEntities.values()) {
        if (data && data.entities) {
            for (const entity of data.entities) {
                try {
                    if (entity && currentViewer.entities.contains(entity)) {
                        currentViewer.entities.remove(entity);
                    }
                } catch (e) {
                    console.warn('Error removing entity:', e);
                }
            }
        }
    }
    measurementEntities.clear();
}

/**
 * Updates measurement entity visuals (e.g., selection highlight).
 * Updates colors and sizes in-place without removing/recreating entities.
 * @param {string} measurementId - Measurement ID
 * @param {Object} measurement - Measurement data
 */
function updateMeasurementEntityVisuals(measurementId, measurement) {
    // Rebuild entities to apply new styles accurately
    removeMeasurementEntities(measurementId);
    const entityData = createMeasurementEntities(measurement);
    if (entityData) {
        measurementEntities.set(measurementId, entityData);
    }
}

// ===== TOOL ACTIVATION =====

/**
 * Sets up click handler for drawing measurements.
 */
function setupClickHandler() {
    if (!currentViewer) return;

    // Remove existing handler
    if (clickHandler) {
        clickHandler.destroy();
        clickHandler = null;
    }

    clickHandler = new Cesium.ScreenSpaceEventHandler(currentViewer.canvas);

    // LEFT_CLICK - add point or select existing measurement
    clickHandler.setInputAction(async (click) => {
        if (!isToolActive) return;

        // Check if clicked on existing measurement (not temporary entities)
        const pickedObject = currentViewer.scene.pick(click.position);

        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
            // Skip temporary entities (they don't have measurementId)
            let measurementId = pickedObject.id.properties.measurementId;
            if (measurementId && typeof measurementId.getValue === 'function') {
                measurementId = measurementId.getValue();
            }

            if (measurementId) {
                // Clicked on existing measurement - select it
                let measurementData = pickedObject.id.properties.measurementData;
                if (measurementData && typeof measurementData.getValue === 'function') {
                    measurementData = measurementData.getValue();
                }

                if (measurementData) {
                    // Cancel current drawing if any
                    cancelDrawing();
                    selectMeasurement(measurementId);
                    emitMeasurementClicked(measurementData);

                    // Deactivate tool
                    try {
                        const { deactivateActiveTool3D } = await import('../map_3d.js');
                        deactivateActiveTool3D();
                    } catch (error) {
                        console.warn('Could not deactivate tool:', error);
                    }
                }
                return;
            }
        }

        // Get position on tileset/terrain
        const position = getClickPosition(click);
        if (!position) {
            // Don't spam console during drawing - this can happen when clicking on UI elements
            return;
        }

        // Add position to drawing
        tempPositions.push(position);
        updateTempVisualization();

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // RIGHT_CLICK - add vertex AND finish measurement
    clickHandler.setInputAction(async (click) => {
        if (!isToolActive) return;

        // Add the final vertex at right-click position
        const position = getClickPosition(click);
        if (position) {
            tempPositions.push(position);
            updateTempVisualization();
        }

        // Now finalize if we have enough points
        const minPoints = currentToolType === 'area' ? 3 : 2;
        if (tempPositions.length >= minPoints) {
            await finalizeMeasurement();
        }
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    // DOUBLE_CLICK - finish measurement (without adding extra point, since left click already added it)
    clickHandler.setInputAction(async () => {
        if (!isToolActive) return;

        const minPoints = currentToolType === 'area' ? 3 : 2;
        if (tempPositions.length >= minPoints) {
            await finalizeMeasurement();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    // MOUSE_MOVE - rubber-band preview (throttled for performance)
    clickHandler.setInputAction((movement) => {
        if (!isToolActive || tempPositions.length === 0) return;

        // Throttle updates for better performance
        const now = Date.now();
        if (now - lastPreviewUpdate < PREVIEW_THROTTLE_MS) return;
        lastPreviewUpdate = now;

        // Get current mouse position
        const position = getClickPosition({ position: movement.endPosition });
        if (position) {
            previewPosition = position;
            updateTempVisualization();
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

/**
 * Cancels current drawing.
 */
function cancelDrawing() {
    clearTempEntities();
    tempPositions = [];
    previewPosition = null;
}

/**
 * Finalizes the current measurement.
 */
async function finalizeMeasurement() {
    if (!currentViewer || !currentTilesetId || !currentToolType) return;

    if (tempPositions.length < 2) {
        cancelDrawing();
        return;
    }

    // Calculate result
    let value = 0;
    let formatted = '';

    if (currentToolType === 'distance') {
        value = calculateDistance(tempPositions);
        formatted = formatDistance(value);
    } else if (currentToolType === 'area') {
        if (tempPositions.length < 3) {
            cancelDrawing();
            return;
        }
        value = calculateArea(tempPositions);
        formatted = formatArea(value);
    }

    // Clear temporary visualization
    clearTempEntities();

    // Create measurement in store
    const measurementData = {
        type: currentToolType,
        positions: [...tempPositions],
        result: { value, formatted }
    };

    const measurement = await addMeasurement(currentTilesetId, measurementData);

    // Reset drawing state
    tempPositions = [];

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

    // Initialize colors if not done
    initColors();

    currentViewer = viewer;
    currentTilesetId = tilesetId;
    currentToolType = type;
    isToolActive = true;

    // Reset drawing state
    tempPositions = [];
    clearTempEntities();

    // Set up click handler for drawing
    setupClickHandler();

    // Change cursor to crosshair
    viewer.canvas.style.cursor = 'crosshair';
}

/**
 * Deactivates the measurement tool.
 */
export function deactivateMeasurementTool() {
    isToolActive = false;
    currentToolType = null;

    // Cancel any in-progress drawing
    cancelDrawing();

    // Destroy click handler
    if (clickHandler) {
        clickHandler.destroy();
        clickHandler = null;
    }

    if (currentViewer) {
        currentViewer.canvas.style.cursor = '';
    }
}

// ===== SELECTION =====

/**
 * Selects a measurement (highlights it).
 * SYNCHRONOUS to avoid race conditions.
 * @param {string} measurementId - Measurement ID
 */
function selectMeasurement(measurementId) {
    // Save previous selection
    const previousId = selectedMeasurementId;

    // Update selection state first
    selectedMeasurementId = measurementId;

    // Deselect previous - use sync function
    if (previousId && previousId !== measurementId && measurementEntities.has(previousId)) {
        updateMeasurementEntityVisualsToDefault(previousId);
    }

    // Highlight selected - use sync function
    if (measurementId && measurementEntities.has(measurementId)) {
        updateMeasurementEntityVisualsToSelected(measurementId);
    }
}

/**
 * Updates measurement entity visuals to selected state.
 * SYNCHRONOUS version.
 * @param {string} measurementId - Measurement ID
 */
function updateMeasurementEntityVisualsToSelected(measurementId) {
    const data = measurementEntities.get(measurementId);
    if (!data || !data.entities || !currentViewer || currentViewer.isDestroyed()) return;

    // Get measurement style for line width
    let storedMeasurement = null;
    for (const entity of data.entities) {
        if (entity.properties && entity.properties.measurementData) {
            let md = entity.properties.measurementData;
            if (md && typeof md.getValue === 'function') md = md.getValue();
            if (md) { storedMeasurement = md; break; }
        }
    }
    const style = resolveStyle(storedMeasurement?.style);

    // Keep user colors for live preview; only increase width/size for selection feedback
    for (const entity of data.entities) {
        try {
            if (entity.polyline) {
                entity.polyline.width = style.lineWidth + 1;
            }
            if (entity.point) {
                entity.point.pixelSize = 10;
            }
        } catch (e) {
            console.warn('Error updating entity visuals:', e);
        }
    }
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
    // Initialize colors
    initColors();

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

    // Set up selection handler (for when tool is not active)
    setupMeasurementSelectionHandler(viewer);
}

/**
 * Sets up handler for selecting measurements when tool is not active.
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
        // Don't handle if tool is active (tool handler takes priority)
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
                return;
            }
        }

        // Clicked on empty area - deselect measurement if one was selected
        if (selectedMeasurementId) {
            deselectCurrentMeasurement();
        }
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
    // Check if this is the selected measurement BEFORE deleting
    const wasSelected = selectedMeasurementId === measurementId;

    const result = await removeMeasurement(measurementId);

    if (result) {
        removeMeasurementEntities(measurementId);
        if (wasSelected) {
            selectedMeasurementId = null;
            // Emit deselected event to close the panel
            emitMeasurementDeselected();
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
    clearTempEntities();

    if (selectionHandler) {
        selectionHandler.destroy();
        selectionHandler = null;
    }

    currentViewer = null;
    currentTilesetId = null;
    selectedMeasurementId = null;
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
 * This function is SYNCHRONOUS to avoid race conditions when closing panels.
 */
export function deselectCurrentMeasurement() {
    if (selectedMeasurementId) {
        const prevId = selectedMeasurementId;
        selectedMeasurementId = null;

        // Update visuals SYNCHRONOUSLY - no async operations
        updateMeasurementEntityVisualsToDefault(prevId);

        emitMeasurementDeselected();
    }

    // Clear Cesium's selected entity
    if (currentViewer && !currentViewer.isDestroyed()) {
        currentViewer.selectedEntity = undefined;
    }
}

/**
 * Gets the currently selected measurement ID.
 * @returns {string|null} Selected measurement ID or null
 */
export function getSelectedMeasurementId() {
    return selectedMeasurementId;
}

/**
 * Updates measurement entity visuals to default (non-selected) state.
 * SYNCHRONOUS version - does not fetch from store.
 * @param {string} measurementId - Measurement ID
 */
function updateMeasurementEntityVisualsToDefault(measurementId) {
    const data = measurementEntities.get(measurementId);
    if (!data || !data.entities || !currentViewer || currentViewer.isDestroyed()) return;

    // Get measurement style from entity properties
    let storedMeasurement = null;
    for (const entity of data.entities) {
        if (entity.properties && entity.properties.measurementData) {
            let md = entity.properties.measurementData;
            if (md && typeof md.getValue === 'function') md = md.getValue();
            if (md) { storedMeasurement = md; break; }
        }
    }
    const style = resolveStyle(storedMeasurement?.style);

    const lineColor = hexToCesiumColor(style.lineColor, style.lineOpacity);
    const fillColor = hexToCesiumColor(style.fillColor, style.fillOpacity);

    for (const entity of data.entities) {
        try {
            if (entity.polyline) {
                entity.polyline.material = lineColor;
                entity.polyline.width = style.lineWidth;
            }
            if (entity.polygon) {
                entity.polygon.material = fillColor;
                entity.polygon.outlineColor = lineColor;
            }
            if (entity.point) {
                entity.point.color = lineColor;
                entity.point.pixelSize = 8;
            }
            if (entity.label) {
                entity.label.backgroundColor = hexToCesiumColor(style.labelBackgroundColor, style.labelBackgroundOpacity);
                entity.label.fillColor = hexToCesiumColor(style.labelColor);
                entity.label.outlineColor = hexToCesiumColor(style.labelOutlineColor);
                entity.label.outlineWidth = style.labelOutlineWidth;
                entity.label.font = `${style.labelSize}px Inter, sans-serif`;
            }
        } catch (e) {
            console.warn('Error updating entity visuals:', e);
        }
    }
}

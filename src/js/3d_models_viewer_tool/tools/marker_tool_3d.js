// Path: js/3d_models_viewer_tool/tools/marker_tool_3d.js

/**
 * @fileoverview 3D Marker tool for adding annotations to Cesium tilesets.
 * Allows users to place markers with labels on 3D models.
 * Supports customizable marker and label styles.
 */

import {
    addMarker,
    getMarkers,
    updateMarker,
    removeMarker,
    DEFAULT_MARKER_STYLE
} from '../../store/index.js';
import { getEventBus } from '../../store/services.js';
import { EventTypes } from '../../events/event_types.js';

// ===== MODULE STATE =====

let isToolActive = false;
let currentViewer = null;
let currentTilesetId = null;
let clickHandler = null;
const markerEntities = new Map(); // markerId -> Cesium.Entity
let selectedMarkerId = null;

// ===== UTILITY FUNCTIONS =====

/**
 * Converts hex color to Cesium.Color.
 * @param {string} hex - Hex color string (e.g., '#ff0000')
 * @param {number} [alpha=1] - Alpha value
 * @returns {Cesium.Color} Cesium color
 */
function hexToCesiumColor(hex, alpha = 1) {
    if (!hex) return Cesium.Color.WHITE.withAlpha(alpha);

    // Remove # if present
    hex = hex.replace('#', '');

    // Parse hex
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;

    return new Cesium.Color(r, g, b, alpha);
}

// ===== MARKER VISUALIZATION =====

/**
 * Creates a Cesium entity for a marker.
 * @param {Object} marker - Marker data
 * @returns {Cesium.Entity} Cesium entity
 */
function createMarkerEntity(marker) {
    if (!currentViewer || !window.Cesium) return null;

    const entityId = `marker-3d-${marker.id}`;

    // Check if entity already exists
    const existingEntity = currentViewer.entities.getById(entityId);
    if (existingEntity) {
        // Entity already exists, return it
        return existingEntity;
    }

    const position = Cesium.Cartesian3.fromDegrees(
        marker.position.longitude,
        marker.position.latitude,
        marker.position.height
    );

    // Get style with defaults
    const style = { ...DEFAULT_MARKER_STYLE, ...(marker.style || {}) };

    // Create billboard config (marker icon)
    const billboardConfig = style.showMarker ? {
        image: createMarkerIcon(style.markerColor, style.markerSize),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        scale: 1.0,
        color: Cesium.Color.WHITE.withAlpha(style.markerOpacity),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.NONE
    } : undefined;

    // Create label config
    const labelText = style.labelText || '';
    const labelConfig = (style.showLabel && labelText) ? {
        text: labelText,
        font: `${style.labelSize}px Inter, sans-serif`,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        outlineWidth: style.labelOutlineWidth,
        outlineColor: hexToCesiumColor(style.labelOutlineColor),
        fillColor: hexToCesiumColor(style.labelColor),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        pixelOffset: new Cesium.Cartesian2(0, style.showMarker ? -45 : 0),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: hexToCesiumColor(style.labelBackgroundColor, style.labelBackgroundOpacity)
    } : undefined;

    const entity = currentViewer.entities.add({
        id: entityId,
        position: position,
        billboard: billboardConfig,
        label: labelConfig,
        properties: {
            markerId: marker.id,
            markerData: marker
        }
    });

    return entity;
}

/**
 * Creates SVG data URL for marker icon.
 * @param {string} color - Marker fill color
 * @param {number} size - Marker size
 * @returns {string} Data URL
 */
function createMarkerIcon(color = '#3f4fb5', size = 32) {
    const height = Math.round(size * 1.375); // Maintain aspect ratio
    const svg = `<svg width="${size}" height="${height}" viewBox="0 0 32 44" xmlns="http://www.w3.org/2000/svg">
        <path d="M16,2 C9,2 3,8 3,15 C3,23 16,42 16,42 C16,42 29,23 29,15 C29,8 23,2 16,2 Z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="16" cy="15" r="6" fill="#ffffff"/>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Removes a marker entity from the viewer.
 * @param {string} markerId - Marker ID
 */
function removeMarkerEntity(markerId) {
    const entity = markerEntities.get(markerId);
    if (entity && currentViewer) {
        currentViewer.entities.remove(entity);
        markerEntities.delete(markerId);
    }
}

/**
 * Clears all marker entities from the viewer.
 */
function clearAllMarkerEntities() {
    if (!currentViewer) return;

    for (const entity of markerEntities.values()) {
        currentViewer.entities.remove(entity);
    }
    markerEntities.clear();
}

/**
 * Updates a marker entity's visual appearance.
 * @param {string} markerId - Marker ID
 * @param {Object} marker - Updated marker data
 */
function updateMarkerEntityVisuals(markerId, marker) {
    const entity = markerEntities.get(markerId);
    if (!entity) return;

    const style = { ...DEFAULT_MARKER_STYLE, ...(marker.style || {}) };

    // Update position if changed
    if (marker.position) {
        entity.position = Cesium.Cartesian3.fromDegrees(
            marker.position.longitude,
            marker.position.latitude,
            marker.position.height
        );
    }

    // Update billboard (marker icon)
    if (style.showMarker) {
        const isSelected = selectedMarkerId === markerId;
        entity.billboard = {
            image: createMarkerIcon(style.markerColor, style.markerSize),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            scale: new Cesium.ConstantProperty(isSelected ? 1.2 : 1.0),
            color: Cesium.Color.WHITE.withAlpha(style.markerOpacity),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: Cesium.HeightReference.NONE
        };
    } else {
        entity.billboard = undefined;
    }

    // Update label
    const labelText = style.labelText || '';
    if (style.showLabel && labelText) {
        entity.label = {
            text: labelText,
            font: `${style.labelSize}px Inter, sans-serif`,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineWidth: style.labelOutlineWidth,
            outlineColor: hexToCesiumColor(style.labelOutlineColor),
            fillColor: hexToCesiumColor(style.labelColor),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(0, style.showMarker ? -45 : 0),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: hexToCesiumColor(style.labelBackgroundColor, style.labelBackgroundOpacity)
        };
    } else {
        entity.label = undefined;
    }

    // Update stored marker data
    if (entity.properties) {
        entity.properties.markerData = marker;
    }
}

// ===== TOOL ACTIVATION =====

/**
 * Activates the marker tool.
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @param {string} tilesetId - Current tileset ID
 */
export function activateMarkerTool(viewer, tilesetId) {
    if (!viewer || !tilesetId) {
        console.warn('Cannot activate marker tool: missing viewer or tilesetId');
        return;
    }

    currentViewer = viewer;
    currentTilesetId = tilesetId;
    isToolActive = true;

    // Set up click handler for placing markers
    setupClickHandler();

    // Load and render existing markers
    loadAndRenderMarkers();

    // Change cursor to crosshair
    viewer.canvas.style.cursor = 'crosshair';
}

/**
 * Deactivates the marker tool.
 */
export function deactivateMarkerTool() {
    isToolActive = false;

    if (clickHandler) {
        clickHandler.destroy();
        clickHandler = null;
    }

    if (currentViewer) {
        currentViewer.canvas.style.cursor = '';
    }

    selectedMarkerId = null;
}

/**
 * Sets up click handler for the viewer.
 */
function setupClickHandler() {
    if (!currentViewer) return;

    // Remove existing handler
    if (clickHandler) {
        clickHandler.destroy();
    }

    clickHandler = new Cesium.ScreenSpaceEventHandler(currentViewer.canvas);

    // Left click - place marker or select existing
    clickHandler.setInputAction(async (click) => {
        if (!isToolActive) return;

        // Check if clicked on existing marker
        const pickedObject = currentViewer.scene.pick(click.position);

        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
            const markerId = pickedObject.id.properties.markerId?.getValue();
            if (markerId) {
                // Clicked on existing marker - emit event to open panel
                const markerData = pickedObject.id.properties.markerData?.getValue();
                if (markerData) {
                    selectMarker(markerId);
                    emitMarkerClicked(markerData);
                }
                return;
            }
        }

        // Get position on tileset/terrain
        const cartesian = currentViewer.scene.pickPosition(click.position);
        if (!Cesium.defined(cartesian)) {
            console.warn('Could not pick position on 3D model');
            return;
        }

        // Convert to cartographic
        const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        const position = {
            longitude: Cesium.Math.toDegrees(cartographic.longitude),
            latitude: Cesium.Math.toDegrees(cartographic.latitude),
            height: cartographic.height
        };

        // Create marker
        await createNewMarker(position);

    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/**
 * Creates a new marker at the given position.
 * @param {Object} position - { longitude, latitude, height }
 */
async function createNewMarker(position) {
    const markerData = {
        position,
        properties: {
            descricao: ''
        }
    };

    const marker = await addMarker(currentTilesetId, markerData);

    // Create visual entity
    const entity = createMarkerEntity(marker);
    if (entity) {
        markerEntities.set(marker.id, entity);
    }

    // Select the new marker and open panel
    selectMarker(marker.id);
    emitMarkerClicked(marker);

    // Deactivate the marker tool after adding
    try {
        const { deactivateActiveTool3D } = await import('../map_3d.js');
        deactivateActiveTool3D();
    } catch (error) {
        console.warn('Could not deactivate tool:', error);
    }
}

/**
 * Loads and renders markers for current tileset.
 */
async function loadAndRenderMarkers() {
    if (!currentTilesetId) return;

    const markers = await getMarkers(currentTilesetId);

    for (const marker of markers) {
        const entity = createMarkerEntity(marker);
        if (entity) {
            markerEntities.set(marker.id, entity);
        }
    }
}

/**
 * Selects a marker (highlights it).
 * @param {string} markerId - Marker ID
 */
function selectMarker(markerId) {
    // Deselect previous
    if (selectedMarkerId && markerEntities.has(selectedMarkerId)) {
        const prevEntity = markerEntities.get(selectedMarkerId);
        if (prevEntity.billboard) {
            prevEntity.billboard.scale = new Cesium.ConstantProperty(1.0);
        }
    }

    selectedMarkerId = markerId;

    // Highlight selected
    if (markerId && markerEntities.has(markerId)) {
        const entity = markerEntities.get(markerId);
        if (entity.billboard) {
            entity.billboard.scale = new Cesium.ConstantProperty(1.2);
        }
    }
}

/**
 * Emits marker clicked event.
 * @param {Object} marker - Marker data
 */
function emitMarkerClicked(marker) {
    const eventBus = getEventBus();
    if (eventBus) {
        eventBus.emit(EventTypes.MARKER_3D_CLICKED, {
            marker,
            tilesetId: currentTilesetId
        });
    }
}

/**
 * Emits marker deselected event.
 */
function emitMarkerDeselected() {
    const eventBus = getEventBus();
    if (eventBus) {
        eventBus.emit(EventTypes.MARKER_3D_DESELECTED, {
            tilesetId: currentTilesetId
        });
    }
}

// ===== PUBLIC API =====

/**
 * Renders markers for a tileset (when viewer opens but tool not active).
 * @param {Cesium.Viewer} viewer - Cesium viewer
 * @param {string} tilesetId - Tileset ID
 */
export async function renderMarkersForTileset(viewer, tilesetId) {
    currentViewer = viewer;
    currentTilesetId = tilesetId;

    // Clear any existing markers
    clearAllMarkerEntities();

    // Load and render
    const markers = await getMarkers(tilesetId);
    for (const marker of markers) {
        const entity = createMarkerEntity(marker);
        if (entity) {
            markerEntities.set(marker.id, entity);
        }
    }

    // Set up click handler for selecting markers (even when tool not active)
    setupMarkerSelectionHandler(viewer);
}

/**
 * Sets up handler for selecting markers when tool is not active.
 * @param {Cesium.Viewer} viewer - Cesium viewer
 */
function setupMarkerSelectionHandler(viewer) {
    // Remove existing handler if any
    if (viewer._markerSelectionHandler) {
        viewer._markerSelectionHandler.destroy();
        viewer._markerSelectionHandler = null;
    }

    // This is a passive handler that just detects clicks on markers
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

    handler.setInputAction((click) => {
        // Don't handle if tool is active (tool handler will handle it)
        if (isToolActive) return;

        const pickedObject = viewer.scene.pick(click.position);

        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
            // Get markerId - try both getValue() for Property and direct access
            let markerId = pickedObject.id.properties.markerId;
            if (markerId && typeof markerId.getValue === 'function') {
                markerId = markerId.getValue();
            }

            if (markerId) {
                // Get markerData - try both getValue() for Property and direct access
                let markerData = pickedObject.id.properties.markerData;
                if (markerData && typeof markerData.getValue === 'function') {
                    markerData = markerData.getValue();
                }

                if (markerData) {
                    selectMarker(markerId);
                    emitMarkerClicked(markerData);
                }
                return;
            }
        }

        // Clicked on empty area - deselect marker if one was selected
        if (selectedMarkerId) {
            selectMarker(null);
            emitMarkerDeselected();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Store for cleanup
    viewer._markerSelectionHandler = handler;
}

/**
 * Updates a marker's properties and refreshes the entity.
 * @param {string} markerId - Marker ID
 * @param {Object} updates - Properties to update { properties, style, position }
 * @returns {Promise<Object|null>} Updated marker
 */
export async function updateMarkerProperties(markerId, updates) {
    const updatedMarker = await updateMarker(markerId, updates);

    if (updatedMarker) {
        // Update visual representation
        updateMarkerEntityVisuals(markerId, updatedMarker);
    }

    return updatedMarker;
}

/**
 * Deletes a marker and removes its entity.
 * @param {string} markerId - Marker ID
 */
export async function deleteMarker(markerId) {
    const result = await removeMarker(markerId);

    if (result) {
        removeMarkerEntity(markerId);
        if (selectedMarkerId === markerId) {
            selectedMarkerId = null;
        }
    }

    return result;
}

/**
 * Flies to a marker's position with a good viewing angle.
 * Positions the camera at a distance and angle to look at the marker.
 * @param {Object} marker - Marker data
 */
export function flyToMarker(marker) {
    if (!currentViewer || !marker) return;

    const markerPosition = Cesium.Cartesian3.fromDegrees(
        marker.position.longitude,
        marker.position.latitude,
        marker.position.height
    );

    // Use flyToBoundingSphere with appropriate offset
    // This positions the camera at a distance looking at the marker
    const headingPitchRange = new Cesium.HeadingPitchRange(
        currentViewer.camera.heading || 0, // Maintain current heading
        Cesium.Math.toRadians(-25), // Look down at marker (slightly above horizontal)
        50 // Distance from marker in meters
    );

    currentViewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(markerPosition, 2), // Small bounding sphere around marker
        {
            offset: headingPitchRange,
            duration: 1.5
        }
    );

    // Select the marker
    selectMarker(marker.id);
}

/**
 * Cleans up marker tool resources.
 */
export function cleanupMarkerTool() {
    deactivateMarkerTool();
    clearAllMarkerEntities();

    if (currentViewer && currentViewer._markerSelectionHandler) {
        currentViewer._markerSelectionHandler.destroy();
        currentViewer._markerSelectionHandler = null;
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
 * Checks if marker tool is active.
 * @returns {boolean} True if active
 */
export function isMarkerToolActive() {
    return isToolActive;
}

/**
 * Refreshes markers for the current tileset.
 * Called when the active map changes to reload markers from the new map.
 */
export async function refreshMarkersForCurrentTileset() {
    if (!currentViewer || !currentTilesetId) return;

    // Clear existing markers
    clearAllMarkerEntities();

    // Deselect any selected marker and close panel
    if (selectedMarkerId) {
        selectedMarkerId = null;
        emitMarkerDeselected();
    }

    // Re-render markers for current tileset
    await loadAndRenderMarkers();
}

/**
 * Initializes marker tool event listeners.
 * Should be called once when the 3D viewer is initialized.
 */
export function initMarkerToolListeners() {
    const eventBus = getEventBus();
    if (!eventBus) return;

    // Listen for map changes to refresh markers
    eventBus.on(EventTypes.LAYERS_CHANGED, () => {
        // Only refresh if viewer is active
        if (currentViewer && currentTilesetId) {
            refreshMarkersForCurrentTileset();
        }
    });
}

/**
 * Deselects the currently selected marker and closes the panel.
 * Called when the 3D viewer is closed or marker panel is closed.
 */
export function deselectCurrentMarker() {
    if (selectedMarkerId) {
        selectMarker(null);
        emitMarkerDeselected();
    }

    // Clear Cesium's selected entity to remove the green selection box
    if (currentViewer && !currentViewer.isDestroyed()) {
        currentViewer.selectedEntity = undefined;
    }
}

/**
 * Gets the currently selected marker ID.
 * @returns {string|null} Selected marker ID or null
 */
export function getSelectedMarkerId() {
    return selectedMarkerId;
}

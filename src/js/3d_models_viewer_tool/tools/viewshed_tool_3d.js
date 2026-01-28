// Path: js/3d_models_viewer_tool/tools/viewshed_tool_3d.js

/**
 * @fileoverview 3D Viewshed tool wrapper for cesium-viewshed.
 * Provides persistence and selection for viewshed analysis.
 * Follows the same pattern as marker_tool_3d.js.
 */

import {
    addViewshed,
    getViewsheds,
    updateViewshed,
    removeViewshed
} from '../../store/index.js';
import { getEventBus } from '../../store/services.js';
import { EventTypes } from '../../events/event_types.js';

// ===== MODULE STATE =====

let isToolActive = false;
let currentViewer = null;
let currentTilesetId = null;
const viewshedObjects = new Map(); // viewshedId -> { cesiumViewshed: Cesium.ViewShed3D, originEntity: Cesium.Entity }
let selectedViewshedId = null;
let selectionHandler = null;
let pendingViewshed = null; // Temporary storage for viewshed being created

// Default viewshed parameters
const DEFAULT_VIEWSHED_PARAMS = {
    horizontalAngle: 150,
    verticalAngle: 120,
    distance: 500
};

// ===== UTILITY FUNCTIONS =====

/**
 * Creates an origin marker entity for a viewshed.
 * @param {Object} viewshed - Viewshed data
 * @returns {Cesium.Entity} Origin marker entity
 */
function createViewshedOriginEntity(viewshed) {
    if (!currentViewer || !window.Cesium) return null;

    const entityId = `viewshed-3d-origin-${viewshed.id}`;

    // Check if entity already exists
    const existingEntity = currentViewer.entities.getById(entityId);
    if (existingEntity) {
        return existingEntity;
    }

    // Calculate height: terrainBaseHeight + observerHeight
    let markerHeight;
    if (viewshed.terrainBaseHeight !== undefined && viewshed.terrainBaseHeight !== null) {
        markerHeight = viewshed.terrainBaseHeight + (viewshed.observerHeight ?? 1.5);
    } else {
        markerHeight = viewshed.position.height || 0;
    }

    const position = Cesium.Cartesian3.fromDegrees(
        viewshed.position.longitude,
        viewshed.position.latitude,
        markerHeight
    );

    const isSelected = selectedViewshedId === viewshed.id;

    const entity = currentViewer.entities.add({
        id: entityId,
        position: position,
        billboard: {
            image: createViewshedIcon(isSelected ? '#00FFFF' : '#FF8C00', 24),
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            scale: isSelected ? 1.2 : 1.0,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        properties: {
            viewshedId: viewshed.id,
            viewshedData: viewshed
        }
    });

    return entity;
}

/**
 * Creates SVG data URL for viewshed icon (eye).
 * @param {string} color - Icon color
 * @param {number} size - Icon size
 * @returns {string} Data URL
 */
function createViewshedIcon(color = '#FF8C00', size = 24) {
    const svg = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="${color}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="12" cy="12" r="4" fill="#ffffff"/>
        <circle cx="12" cy="12" r="2" fill="${color}"/>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/**
 * Creates a Cesium.ViewShed3D object from stored data (non-interactive).
 * @param {Object} viewshed - Viewshed data
 * @returns {Cesium.ViewShed3D|null} ViewShed3D object
 */
function createCesiumViewshed(viewshed) {
    if (!currentViewer || !window.Cesium || !Cesium.ViewShed3D) {
        return null;
    }

    // Validate that position data exists
    if (!viewshed.position || viewshed.position.longitude === undefined || viewshed.position.latitude === undefined) {
        console.warn('Invalid viewshed position data:', viewshed);
        return null;
    }

    try {
        // Calculate the observer height above terrain
        let observerFullHeight;

        if (viewshed.terrainBaseHeight !== undefined && viewshed.terrainBaseHeight !== null) {
            // New format: terrain base height + observer height above terrain
            observerFullHeight = viewshed.terrainBaseHeight + (viewshed.observerHeight ?? 1.5);
        } else {
            // Legacy format: use stored position height directly
            observerFullHeight = viewshed.position.height || 0;
        }

        // Create observer position (cameraPosition - first click)
        const cameraPosition = Cesium.Cartesian3.fromDegrees(
            viewshed.position.longitude,
            viewshed.position.latitude,
            observerFullHeight
        );

        let viewPosition;

        // Use stored targetPosition if available (new format)
        if (viewshed.targetPosition && viewshed.targetPosition.longitude !== undefined) {
            viewPosition = Cesium.Cartesian3.fromDegrees(
                viewshed.targetPosition.longitude,
                viewshed.targetPosition.latitude,
                viewshed.targetPosition.height || 0
            );
        } else {
            // Fallback: calculate target position based on direction and distance (legacy data)
            // This uses a simple forward projection from the camera position
            const distance = viewshed.parameters?.distance || DEFAULT_VIEWSHED_PARAMS.distance;

            // Create a local east-north-up frame
            const transform = Cesium.Transforms.eastNorthUpToFixedFrame(cameraPosition);

            // Get heading and pitch from stored direction
            const heading = Cesium.Math.toRadians(viewshed.direction?.heading || 0);
            const pitch = Cesium.Math.toRadians(viewshed.direction?.pitch || 0);

            // Calculate direction vector in local ENU frame
            // heading: 0 = north, pitch: 0 = horizontal, negative = looking down
            const cosP = Math.cos(pitch);
            const localDirection = new Cesium.Cartesian3(
                cosP * Math.sin(heading),  // East component
                cosP * Math.cos(heading),  // North component
                Math.sin(pitch)             // Up component
            );

            // Transform local direction to world coordinates
            const rotationMatrix = Cesium.Matrix4.getMatrix3(transform, new Cesium.Matrix3());
            const worldDirection = Cesium.Matrix3.multiplyByVector(rotationMatrix, localDirection, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(worldDirection, worldDirection);

            // Calculate view position
            viewPosition = Cesium.Cartesian3.add(
                cameraPosition,
                Cesium.Cartesian3.multiplyByScalar(worldDirection, distance, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
        }

        // Create ViewShed3D with both cameraPosition and viewPosition to skip interactive mode
        const viewShed3D = new Cesium.ViewShed3D(currentViewer, {
            cameraPosition: cameraPosition,
            viewPosition: viewPosition,
            horizontalAngle: viewshed.parameters?.horizontalAngle || DEFAULT_VIEWSHED_PARAMS.horizontalAngle,
            verticalAngle: viewshed.parameters?.verticalAngle || DEFAULT_VIEWSHED_PARAMS.verticalAngle,
            distance: viewshed.parameters?.distance || DEFAULT_VIEWSHED_PARAMS.distance
        });

        return viewShed3D;
    } catch (error) {
        console.warn('Failed to create ViewShed3D:', error);
        return null;
    }
}

/**
 * Removes viewshed objects from the viewer.
 * @param {string} viewshedId - Viewshed ID
 */
function removeViewshedObjects(viewshedId) {
    const data = viewshedObjects.get(viewshedId);
    if (data && currentViewer) {
        // Destroy Cesium ViewShed3D
        if (data.cesiumViewshed && data.cesiumViewshed.destroy) {
            data.cesiumViewshed.destroy();
        }

        // Remove origin entity
        if (data.originEntity) {
            currentViewer.entities.remove(data.originEntity);
        }

        viewshedObjects.delete(viewshedId);
    }
}

/**
 * Clears all viewshed objects from the viewer.
 */
function clearAllViewshedObjects() {
    if (!currentViewer) return;

    for (const data of viewshedObjects.values()) {
        if (data.cesiumViewshed && data.cesiumViewshed.destroy) {
            data.cesiumViewshed.destroy();
        }
        if (data.originEntity) {
            currentViewer.entities.remove(data.originEntity);
        }
    }
    viewshedObjects.clear();
}

/**
 * Updates viewshed visuals (selection highlight).
 * @param {string} viewshedId - Viewshed ID
 * @param {Object} viewshed - Viewshed data
 */
function updateViewshedVisuals(viewshedId, viewshed) {
    const data = viewshedObjects.get(viewshedId);
    if (!data || !data.originEntity) return;

    const isSelected = selectedViewshedId === viewshedId;
    const color = isSelected ? Cesium.Color.CYAN : Cesium.Color.ORANGE;

    // Update origin entity
    data.originEntity.billboard.image = createViewshedIcon(isSelected ? '#00FFFF' : '#FF8C00', 24);
    data.originEntity.billboard.scale = new Cesium.ConstantProperty(isSelected ? 1.2 : 1.0);

    if (data.originEntity.label) {
        data.originEntity.label.text = viewshed.properties?.nome || 'Visibilidade';
        data.originEntity.label.backgroundColor = color.withAlpha(0.8);
    }

    // Update stored data
    if (data.originEntity.properties) {
        data.originEntity.properties.viewshedData = viewshed;
    }
}

// ===== TOOL ACTIVATION =====

/**
 * Activates the viewshed tool.
 * @param {Cesium.Viewer} viewer - Cesium viewer instance
 * @param {string} tilesetId - Current tileset ID
 */
export function activateViewshedTool(viewer, tilesetId) {
    if (!viewer || !tilesetId) {
        console.warn('Cannot activate viewshed tool: missing parameters');
        return;
    }

    currentViewer = viewer;
    currentTilesetId = tilesetId;
    isToolActive = true;

    // Use cesium-viewshed library
    if (Cesium.ViewShed3D) {
        pendingViewshed = new Cesium.ViewShed3D(viewer, {
            horizontalAngle: DEFAULT_VIEWSHED_PARAMS.horizontalAngle,
            verticalAngle: DEFAULT_VIEWSHED_PARAMS.verticalAngle,
            distance: DEFAULT_VIEWSHED_PARAMS.distance,
            calback: function () {
                // Called when viewshed creation is complete
                handleViewshedComplete(pendingViewshed);
            }
        });
    }

    viewer.canvas.style.cursor = 'crosshair';
}

/**
 * Deactivates the viewshed tool.
 */
export function deactivateViewshedTool() {
    isToolActive = false;

    // Don't destroy pending viewshed if it was completed and saved
    if (pendingViewshed && !pendingViewshed._wasSaved) {
        pendingViewshed.destroy();
    }
    pendingViewshed = null;

    if (currentViewer) {
        currentViewer.canvas.style.cursor = '';
    }
}

/**
 * Handles viewshed completion from cesium-viewshed.
 * @param {Cesium.ViewShed3D} cesiumViewshed - The created viewshed
 */
async function handleViewshedComplete(cesiumViewshed) {
    if (!currentViewer || !currentTilesetId || !cesiumViewshed) return;

    // Extract cameraPosition (first click - observer position)
    const cameraPos = cesiumViewshed.cameraPosition;
    if (!Cesium.defined(cameraPos)) {
        console.warn('No camera position defined for viewshed');
        return;
    }

    // Extract viewPosition (second click - target position)
    const viewPos = cesiumViewshed.viewPosition;
    if (!Cesium.defined(viewPos)) {
        console.warn('No view position defined for viewshed');
        return;
    }

    // Convert cameraPosition to geographic
    const cameraCarto = Cesium.Cartographic.fromCartesian(cameraPos);
    const defaultObserverHeight = 1.5;

    // Store position and terrain base height
    const cameraPosition = {
        longitude: Cesium.Math.toDegrees(cameraCarto.longitude),
        latitude: Cesium.Math.toDegrees(cameraCarto.latitude),
        height: cameraCarto.height
    };

    // Terrain base height is the clicked point height
    const terrainBaseHeight = cameraCarto.height;

    // Convert viewPosition to geographic
    const viewCarto = Cesium.Cartographic.fromCartesian(viewPos);
    const viewPosition = {
        longitude: Cesium.Math.toDegrees(viewCarto.longitude),
        latitude: Cesium.Math.toDegrees(viewCarto.latitude),
        height: viewCarto.height
    };

    // Extract direction
    const direction = {
        heading: cesiumViewshed.heading || 0,
        pitch: cesiumViewshed.pitch || 0
    };

    // Extract parameters
    const parameters = {
        horizontalAngle: cesiumViewshed.horizontalAngle || DEFAULT_VIEWSHED_PARAMS.horizontalAngle,
        verticalAngle: cesiumViewshed.verticalAngle || DEFAULT_VIEWSHED_PARAMS.verticalAngle,
        distance: cesiumViewshed.distance || DEFAULT_VIEWSHED_PARAMS.distance
    };

    // Create viewshed in store - save both positions for recreation
    const viewshedData = {
        position: cameraPosition,           // Observer position (full height)
        targetPosition: viewPosition,       // Target position (second click)
        terrainBaseHeight: terrainBaseHeight, // Height of terrain at click point (without observer)
        direction,
        parameters,
        observerHeight: defaultObserverHeight  // Height above terrain
    };

    const viewshed = await addViewshed(currentTilesetId, viewshedData);

    // Mark as saved so it won't be destroyed when tool deactivates
    cesiumViewshed._wasSaved = true;

    // Create origin entity
    const originEntity = createViewshedOriginEntity(viewshed);

    // Store the objects
    viewshedObjects.set(viewshed.id, {
        cesiumViewshed: cesiumViewshed,
        originEntity: originEntity
    });

    // Select the new viewshed and emit event
    selectViewshed(viewshed.id);
    emitViewshedClicked(viewshed);

    // Deactivate the tool
    try {
        const { deactivateActiveTool3D } = await import('../map_3d.js');
        deactivateActiveTool3D();
    } catch (error) {
        console.warn('Could not deactivate tool:', error);
    }
}

// ===== SELECTION =====

/**
 * Selects a viewshed (highlights it).
 * @param {string} viewshedId - Viewshed ID
 */
function selectViewshed(viewshedId) {
    // Deselect previous
    if (selectedViewshedId && viewshedObjects.has(selectedViewshedId)) {
        getViewshedById(selectedViewshedId).then(v => {
            if (v) updateViewshedVisuals(selectedViewshedId, v);
        });
    }

    selectedViewshedId = viewshedId;

    // Highlight selected
    if (viewshedId && viewshedObjects.has(viewshedId)) {
        getViewshedById(viewshedId).then(v => {
            if (v) updateViewshedVisuals(viewshedId, v);
        });
    }
}

/**
 * Gets a viewshed by ID (async wrapper).
 * @param {string} viewshedId - Viewshed ID
 * @returns {Promise<Object|null>} Viewshed or null
 */
async function getViewshedById(viewshedId) {
    const { getViewshedById: getById } = await import('../../store/index.js');
    return await getById(viewshedId);
}

/**
 * Emits viewshed clicked event.
 * @param {Object} viewshed - Viewshed data
 */
function emitViewshedClicked(viewshed) {
    const eventBus = getEventBus();
    if (eventBus) {
        eventBus.emit(EventTypes.VIEWSHED_3D_CLICKED, {
            viewshed,
            tilesetId: currentTilesetId
        });
    }
}

/**
 * Emits viewshed deselected event.
 */
function emitViewshedDeselected() {
    const eventBus = getEventBus();
    if (eventBus) {
        eventBus.emit(EventTypes.VIEWSHED_3D_DESELECTED, {
            tilesetId: currentTilesetId
        });
    }
}

// ===== PUBLIC API =====

/**
 * Renders viewsheds for a tileset (when viewer opens).
 * @param {Cesium.Viewer} viewer - Cesium viewer
 * @param {string} tilesetId - Tileset ID
 */
export async function renderViewshedsForTileset(viewer, tilesetId) {
    currentViewer = viewer;
    currentTilesetId = tilesetId;

    // Clear existing objects
    clearAllViewshedObjects();

    // Load and render
    const viewsheds = await getViewsheds(tilesetId);
    for (const viewshed of viewsheds) {
        const cesiumViewshed = createCesiumViewshed(viewshed);
        const originEntity = createViewshedOriginEntity(viewshed);

        if (originEntity) {
            viewshedObjects.set(viewshed.id, {
                cesiumViewshed: cesiumViewshed,
                originEntity: originEntity
            });
        }
    }

    // Set up selection handler
    setupViewshedSelectionHandler(viewer);
}

/**
 * Sets up handler for selecting viewsheds.
 * @param {Cesium.Viewer} viewer - Cesium viewer
 */
function setupViewshedSelectionHandler(viewer) {
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
            let viewshedId = pickedObject.id.properties.viewshedId;
            if (viewshedId && typeof viewshedId.getValue === 'function') {
                viewshedId = viewshedId.getValue();
            }

            if (viewshedId) {
                let viewshedData = pickedObject.id.properties.viewshedData;
                if (viewshedData && typeof viewshedData.getValue === 'function') {
                    viewshedData = viewshedData.getValue();
                }

                if (viewshedData) {
                    selectViewshed(viewshedId);
                    emitViewshedClicked(viewshedData);
                }
                return;
            }
        }

        // Clicked on empty area - deselect viewshed if one was selected
        if (selectedViewshedId) {
            deselectCurrentViewshed();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

/**
 * Updates a viewshed's properties.
 * @param {string} viewshedId - Viewshed ID
 * @param {Object} updates - Properties to update
 * @returns {Promise<Object|null>} Updated viewshed
 */
export async function updateViewshedProperties(viewshedId, updates) {
    const updatedViewshed = await updateViewshed(viewshedId, updates);

    if (updatedViewshed) {
        updateViewshedVisuals(viewshedId, updatedViewshed);
    }

    return updatedViewshed;
}

/**
 * Updates the observer height for a viewshed and recalculates the visualization.
 * @param {string} viewshedId - Viewshed ID
 * @param {number} newHeight - New observer height in meters
 * @returns {Promise<Object|null>} Updated viewshed
 */
export async function updateViewshedObserverHeight(viewshedId, newHeight) {
    if (!currentViewer || !window.Cesium) return null;

    // Get current viewshed data BEFORE updating
    const viewshed = await getViewshedById(viewshedId);
    if (!viewshed) return null;

    // Get terrain base height
    let terrainBaseHeight;
    if (viewshed.terrainBaseHeight !== undefined && viewshed.terrainBaseHeight !== null) {
        terrainBaseHeight = viewshed.terrainBaseHeight;
    } else {
        // Legacy data: estimate terrain height from position - current observer height
        const currentObserverHeight = viewshed.observerHeight ?? 1.5;
        terrainBaseHeight = (viewshed.position.height || 0) - currentObserverHeight;
    }

    // Update the observer height in the store
    const updatedViewshed = await updateViewshed(viewshedId, { observerHeight: newHeight });
    if (!updatedViewshed) return null;

    // Get the viewshed objects
    const data = viewshedObjects.get(viewshedId);
    if (!data) return updatedViewshed;

    // Destroy the old Cesium ViewShed3D
    if (data.cesiumViewshed && data.cesiumViewshed.destroy) {
        try {
            data.cesiumViewshed.destroy();
        } catch (e) {
            console.warn('Error destroying old viewshed:', e);
        }
    }

    // Create viewshed data with proper terrainBaseHeight and new observerHeight
    // This uses the same path as createCesiumViewshed on reload
    const viewshedForRecreation = {
        ...updatedViewshed,
        terrainBaseHeight: terrainBaseHeight,
        observerHeight: newHeight
    };

    const newCesiumViewshed = createCesiumViewshed(viewshedForRecreation);
    data.cesiumViewshed = newCesiumViewshed;

    // Update the origin entity position
    if (data.originEntity) {
        const newFullHeight = terrainBaseHeight + newHeight;
        const newPosition = Cesium.Cartesian3.fromDegrees(
            viewshed.position.longitude,
            viewshed.position.latitude,
            newFullHeight
        );
        data.originEntity.position = newPosition;
    }

    return updatedViewshed;
}

/**
 * Deletes a viewshed.
 * @param {string} viewshedId - Viewshed ID
 */
export async function deleteViewshed(viewshedId) {
    const result = await removeViewshed(viewshedId);

    if (result) {
        removeViewshedObjects(viewshedId);
        if (selectedViewshedId === viewshedId) {
            selectedViewshedId = null;
        }
    }

    return result;
}

/**
 * Flies to a viewshed's position.
 * @param {Object} viewshed - Viewshed data
 */
export function flyToViewshed(viewshed) {
    if (!currentViewer || !viewshed) return;

    const position = Cesium.Cartesian3.fromDegrees(
        viewshed.position.longitude,
        viewshed.position.latitude,
        viewshed.position.height || 0
    );

    currentViewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(position, viewshed.parameters?.distance || 500),
        {
            offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), viewshed.parameters?.distance * 2 || 1000),
            duration: 1.5
        }
    );

    selectViewshed(viewshed.id);
}

/**
 * Cleans up viewshed tool resources.
 */
export function cleanupViewshedTool() {
    deactivateViewshedTool();
    clearAllViewshedObjects();

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
 * Checks if viewshed tool is active.
 * @returns {boolean} True if active
 */
export function isViewshedToolActive() {
    return isToolActive;
}

/**
 * Refreshes viewsheds for the current tileset.
 */
export async function refreshViewshedsForCurrentTileset() {
    if (!currentViewer || !currentTilesetId) return;

    clearAllViewshedObjects();

    if (selectedViewshedId) {
        selectedViewshedId = null;
        emitViewshedDeselected();
    }

    const viewsheds = await getViewsheds(currentTilesetId);
    for (const viewshed of viewsheds) {
        const cesiumViewshed = createCesiumViewshed(viewshed);
        const originEntity = createViewshedOriginEntity(viewshed);

        if (originEntity) {
            viewshedObjects.set(viewshed.id, {
                cesiumViewshed: cesiumViewshed,
                originEntity: originEntity
            });
        }
    }
}

/**
 * Initializes viewshed tool event listeners.
 */
export function initViewshedToolListeners() {
    const eventBus = getEventBus();
    if (!eventBus) return;

    eventBus.on(EventTypes.LAYERS_CHANGED, () => {
        if (currentViewer && currentTilesetId) {
            refreshViewshedsForCurrentTileset();
        }
    });
}

/**
 * Deselects the currently selected viewshed.
 */
export function deselectCurrentViewshed() {
    if (selectedViewshedId) {
        const prevId = selectedViewshedId;
        selectedViewshedId = null;

        getViewshedById(prevId).then(v => {
            if (v) updateViewshedVisuals(prevId, v);
        });

        emitViewshedDeselected();
    }
}

/**
 * Clears all viewshed visualizations (without deleting data).
 * Used by map_3d.js when clearing tools.
 */
export function clearAllViewField() {
    // Just clear visualizations, don't delete data
    for (const data of viewshedObjects.values()) {
        if (data.cesiumViewshed && data.cesiumViewshed.destroy) {
            data.cesiumViewshed.destroy();
        }
    }

    // Keep origin entities but destroy ViewShed3D objects
    for (const data of viewshedObjects.values()) {
        data.cesiumViewshed = null;
    }
}

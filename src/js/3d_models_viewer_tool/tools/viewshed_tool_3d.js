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
    removeViewshed,
    getViewshedById as getViewshedByIdStore
} from '../../store/index.js';
import { getEventBus } from '../../store/services.js';
import { EventTypes } from '../../events/event_types.js';

// ===== MODULE STATE =====

let isToolActive = false;
let currentViewer = null;
let currentTilesetId = null;
const viewshedObjects = new Map(); // viewshedId -> { cesiumViewsheds: Cesium.ViewShed3D[], originEntity: Cesium.Entity }
let selectedViewshedId = null;
let selectionHandler = null;
let pendingViewshed = null; // Temporary storage for viewshed being created

// Default viewshed parameters
const DEFAULT_VIEWSHED_PARAMS = {
    horizontalAngle: 120,
    verticalAngle: 120,
    distance: 500
};

// Maximum horizontal FOV supported by a single Cesium.ViewShed3D instance
const MAX_SINGLE_VIEWSHED_ANGLE = 150;

// ===== UTILITY FUNCTIONS =====

/**
 * Determines how many sub-viewshed objects are needed to cover the requested angle.
 * @param {number} horizontalAngle - Total horizontal angle in degrees (1-360)
 * @returns {number} Number of sub-viewsheds (1, 2, or 3)
 */
function computeSubViewshedCount(horizontalAngle) {
    if (horizontalAngle <= MAX_SINGLE_VIEWSHED_ANGLE) return 1;
    if (horizontalAngle <= MAX_SINGLE_VIEWSHED_ANGLE * 2) return 2;
    return 3;
}

/**
 * Rotates viewPosition around cameraPosition by the given angle in the local
 * East-North-Up horizontal plane (around the Up axis).
 * This changes the heading of the viewshed cone without altering distance or pitch.
 * @param {Cesium.Cartesian3} cameraPosition - Observer position (rotation center)
 * @param {Cesium.Cartesian3} viewPosition - Target position to rotate
 * @param {number} angleDegrees - Rotation angle in degrees (positive = clockwise from above)
 * @returns {Cesium.Cartesian3} New rotated viewPosition
 */
function rotateViewPositionAroundObserver(cameraPosition, viewPosition, angleDegrees) {
    if (Math.abs(angleDegrees) < 1e-6) {
        return Cesium.Cartesian3.clone(viewPosition, new Cesium.Cartesian3());
    }

    // Get ENU transform at observer position
    const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(cameraPosition);
    const enuInverse = Cesium.Matrix4.inverse(enuTransform, new Cesium.Matrix4());

    // Convert viewPosition to local ENU coordinates relative to observer
    const viewWorld = Cesium.Cartesian3.subtract(viewPosition, cameraPosition, new Cesium.Cartesian3());
    const localView = Cesium.Matrix4.multiplyByPointAsVector(enuInverse, viewWorld, new Cesium.Cartesian3());

    // Rotate around the Up axis (Z in ENU)
    // Positive angleDegrees = clockwise from above = standard navigation convention
    const angleRad = Cesium.Math.toRadians(angleDegrees);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // ENU: X=East, Y=North, Z=Up. Clockwise from above (North toward East) rotation:
    const rotatedLocal = new Cesium.Cartesian3(
        cosA * localView.x + sinA * localView.y,
        -sinA * localView.x + cosA * localView.y,
        localView.z
    );

    // Convert back to world coordinates
    const rotatedWorld = Cesium.Matrix4.multiplyByPointAsVector(enuTransform, rotatedLocal, new Cesium.Cartesian3());
    return Cesium.Cartesian3.add(cameraPosition, rotatedWorld, new Cesium.Cartesian3());
}

/**
 * Destroys an array of Cesium.ViewShed3D objects safely.
 * @param {Cesium.ViewShed3D[]} cesiumViewsheds - Array of viewsheds to destroy
 */
function destroyCesiumViewsheds(cesiumViewsheds) {
    if (!cesiumViewsheds) return;
    for (const vs of cesiumViewsheds) {
        if (vs && vs.destroy) {
            try {
                vs.destroy();
            } catch (e) {
                console.warn('Error destroying ViewShed3D:', e);
            }
        }
    }
}

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
 * Creates one or more Cesium.ViewShed3D objects from stored viewshed data.
 * For horizontalAngle <= 150°, creates a single ViewShed3D (original behavior).
 * For horizontalAngle > 150°, splits into 2 or 3 sub-viewsheds rotated to cover
 * the total sector symmetrically around the original heading direction.
 * @param {Object} viewshed - Viewshed data from the store
 * @returns {Cesium.ViewShed3D[]} Array of ViewShed3D objects (1, 2, or 3 elements)
 */
function createCesiumViewsheds(viewshed) {
    if (!currentViewer || !window.Cesium || !Cesium.ViewShed3D) {
        return [];
    }

    if (!viewshed.position || viewshed.position.longitude === undefined || viewshed.position.latitude === undefined) {
        console.warn('Invalid viewshed position data:', viewshed);
        return [];
    }

    try {
        // Calculate the observer height above terrain
        let observerFullHeight;

        if (viewshed.terrainBaseHeight !== undefined && viewshed.terrainBaseHeight !== null) {
            observerFullHeight = viewshed.terrainBaseHeight + (viewshed.observerHeight ?? 1.5);
        } else {
            observerFullHeight = viewshed.position.height || 0;
        }

        const cameraPosition = Cesium.Cartesian3.fromDegrees(
            viewshed.position.longitude,
            viewshed.position.latitude,
            observerFullHeight
        );

        const distance = viewshed.parameters?.distance || DEFAULT_VIEWSHED_PARAMS.distance;
        const totalHorizontalAngle = viewshed.parameters?.horizontalAngle || DEFAULT_VIEWSHED_PARAMS.horizontalAngle;
        const verticalAngle = viewshed.parameters?.verticalAngle || DEFAULT_VIEWSHED_PARAMS.verticalAngle;

        // Compute the base viewPosition (center direction of the sector)
        let baseViewPosition;

        if (viewshed.targetPosition && viewshed.targetPosition.longitude !== undefined) {
            const storedTarget = Cesium.Cartesian3.fromDegrees(
                viewshed.targetPosition.longitude,
                viewshed.targetPosition.latitude,
                viewshed.targetPosition.height || 0
            );
            const direction = Cesium.Cartesian3.subtract(storedTarget, cameraPosition, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(direction, direction);
            baseViewPosition = Cesium.Cartesian3.add(
                cameraPosition,
                Cesium.Cartesian3.multiplyByScalar(direction, distance, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
        } else {
            // Fallback: calculate from heading/pitch (legacy data)
            const transform = Cesium.Transforms.eastNorthUpToFixedFrame(cameraPosition);
            const heading = Cesium.Math.toRadians(viewshed.direction?.heading || 0);
            const pitch = Cesium.Math.toRadians(viewshed.direction?.pitch || 0);

            const cosP = Math.cos(pitch);
            const localDirection = new Cesium.Cartesian3(
                cosP * Math.sin(heading),
                cosP * Math.cos(heading),
                Math.sin(pitch)
            );

            const rotationMatrix = Cesium.Matrix4.getMatrix3(transform, new Cesium.Matrix3());
            const worldDirection = Cesium.Matrix3.multiplyByVector(rotationMatrix, localDirection, new Cesium.Cartesian3());
            Cesium.Cartesian3.normalize(worldDirection, worldDirection);

            baseViewPosition = Cesium.Cartesian3.add(
                cameraPosition,
                Cesium.Cartesian3.multiplyByScalar(worldDirection, distance, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
        }

        // Split into sub-viewsheds if angle exceeds the per-instance limit
        const count = computeSubViewshedCount(totalHorizontalAngle);
        const subAngle = totalHorizontalAngle / count;

        // Heading offsets so sub-viewsheds tile symmetrically around the center direction
        // count=1: [0], count=2: [-subAngle/2, +subAngle/2], count=3: [-subAngle, 0, +subAngle]
        const offsets = [];
        if (count === 1) {
            offsets.push(0);
        } else if (count === 2) {
            offsets.push(-subAngle / 2, subAngle / 2);
        } else {
            offsets.push(-subAngle, 0, subAngle);
        }

        // Each sub-viewshed's FOV is slightly reduced to prevent double-tinting at seams.
        // The cesium-viewshed shader uses strict greater-than (degJJ > spzj/2.0), so
        // pixels at the exact boundary pass both sub-viewsheds' checks. Both post-process
        // stages then apply mix() sequentially, causing visible color saturation at seams.
        // A 0.1° reduction per sub-viewshed creates imperceptible gaps that eliminate this.
        const renderAngle = count > 1 ? subAngle - 1.5 : subAngle;

        const result = [];
        for (const offset of offsets) {
            const rotatedViewPosition = rotateViewPositionAroundObserver(cameraPosition, baseViewPosition, offset);

            const vs = new Cesium.ViewShed3D(currentViewer, {
                cameraPosition: cameraPosition,
                viewPosition: rotatedViewPosition,
                horizontalAngle: renderAngle,
                verticalAngle: verticalAngle,
                distance: distance
            });
            result.push(vs);
        }

        return result;
    } catch (error) {
        console.warn('Failed to create ViewShed3D:', error);
        return [];
    }
}

/**
 * Removes viewshed objects from the viewer.
 * @param {string} viewshedId - Viewshed ID
 */
function removeViewshedObjects(viewshedId) {
    const data = viewshedObjects.get(viewshedId);
    if (data && currentViewer) {
        destroyCesiumViewsheds(data.cesiumViewsheds);

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
        destroyCesiumViewsheds(data.cesiumViewsheds);
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

    // Destroy pending viewshed if tool was deactivated before completion
    if (pendingViewshed) {
        try {
            pendingViewshed.destroy();
        } catch (_e) {
            // Already destroyed in handleViewshedComplete
        }
    }
    pendingViewshed = null;

    if (currentViewer) {
        currentViewer.canvas.style.cursor = '';
    }
}

/**
 * Handles viewshed completion from cesium-viewshed.
 * The interactive click handler places the observer at ground level (height += 0).
 * After capturing positions, the initial viewshed is destroyed and recreated
 * with a 1.5m observer height offset to simulate eye-level observation.
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

    // Destroy the interactive viewshed (placed at ground level) and recreate
    // with the 1.5m observer height offset applied for eye-level observation
    cesiumViewshed._wasSaved = false;
    try {
        cesiumViewshed.destroy();
    } catch (e) {
        console.warn('Error destroying interactive viewshed:', e);
    }
    pendingViewshed = null;

    // Recreate with proper observer height offset (same path as reload)
    const recreatedViewsheds = createCesiumViewsheds(viewshed);

    // Create origin entity
    const originEntity = createViewshedOriginEntity(viewshed);

    // Store the objects
    viewshedObjects.set(viewshed.id, {
        cesiumViewsheds: recreatedViewsheds,
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
    const previousId = selectedViewshedId;
    selectedViewshedId = viewshedId;

    // Deselect previous
    if (previousId && previousId !== viewshedId && viewshedObjects.has(previousId)) {
        getViewshedById(previousId).then(v => {
            if (v) updateViewshedVisuals(previousId, v);
        }).catch(() => {});
    }

    // Highlight selected
    if (viewshedId && viewshedObjects.has(viewshedId)) {
        getViewshedById(viewshedId).then(v => {
            if (v) updateViewshedVisuals(viewshedId, v);
        }).catch(() => {});
    }
}

/**
 * Gets a viewshed by ID (async wrapper).
 * @param {string} viewshedId - Viewshed ID
 * @returns {Promise<Object|null>} Viewshed or null
 */
async function getViewshedById(viewshedId) {
    return await getViewshedByIdStore(viewshedId);
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
        const cesiumViewsheds = createCesiumViewsheds(viewshed);
        const originEntity = createViewshedOriginEntity(viewshed);

        if (originEntity) {
            viewshedObjects.set(viewshed.id, {
                cesiumViewsheds: cesiumViewsheds,
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
 * Updates the distance for a viewshed and recreates the visualization.
 * @param {string} viewshedId - Viewshed ID
 * @param {number} newDistance - New distance in meters (1-5000)
 * @returns {Promise<Object|null>} Updated viewshed
 */
export async function updateViewshedDistance(viewshedId, newDistance) {
    if (!currentViewer || !window.Cesium) return null;

    const viewshed = await getViewshedById(viewshedId);
    if (!viewshed) return null;

    const updatedParams = { ...(viewshed.parameters || {}), distance: newDistance };
    const updatedViewshed = await updateViewshed(viewshedId, { parameters: updatedParams });
    if (!updatedViewshed) return null;

    const data = viewshedObjects.get(viewshedId);
    if (!data) return updatedViewshed;

    destroyCesiumViewsheds(data.cesiumViewsheds);
    data.cesiumViewsheds = createCesiumViewsheds(updatedViewshed);

    return updatedViewshed;
}

/**
 * Updates the horizontal angle for a viewshed and recreates the visualization.
 * @param {string} viewshedId - Viewshed ID
 * @param {number} newAngle - New horizontal angle in degrees (1-360)
 * @returns {Promise<Object|null>} Updated viewshed
 */
export async function updateViewshedHorizontalAngle(viewshedId, newAngle) {
    if (!currentViewer || !window.Cesium) return null;

    const viewshed = await getViewshedById(viewshedId);
    if (!viewshed) return null;

    const updatedParams = { ...(viewshed.parameters || {}), horizontalAngle: newAngle };
    const updatedViewshed = await updateViewshed(viewshedId, { parameters: updatedParams });
    if (!updatedViewshed) return null;

    const data = viewshedObjects.get(viewshedId);
    if (!data) return updatedViewshed;

    destroyCesiumViewsheds(data.cesiumViewsheds);
    data.cesiumViewsheds = createCesiumViewsheds(updatedViewshed);

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

    const data = viewshedObjects.get(viewshedId);
    if (!data) return updatedViewshed;

    destroyCesiumViewsheds(data.cesiumViewsheds);

    // Recreate with proper terrainBaseHeight and new observerHeight
    const viewshedForRecreation = {
        ...updatedViewshed,
        terrainBaseHeight: terrainBaseHeight,
        observerHeight: newHeight
    };

    data.cesiumViewsheds = createCesiumViewsheds(viewshedForRecreation);

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
        const cesiumViewsheds = createCesiumViewsheds(viewshed);
        const originEntity = createViewshedOriginEntity(viewshed);

        if (originEntity) {
            viewshedObjects.set(viewshed.id, {
                cesiumViewsheds: cesiumViewsheds,
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
        }).catch(() => {});

        emitViewshedDeselected();
    }
}

/**
 * Gets the currently selected viewshed ID.
 * @returns {string|null} Selected viewshed ID or null
 */
export function getSelectedViewshedId() {
    return selectedViewshedId;
}

/**
 * Clears all viewshed visualizations (without deleting data).
 * Used by map_3d.js when clearing tools.
 */
export function clearAllViewField() {
    // Just clear visualizations, don't delete data
    for (const data of viewshedObjects.values()) {
        destroyCesiumViewsheds(data.cesiumViewsheds);
        data.cesiumViewsheds = [];
    }
}

// Path: js/3d_models_viewer_tool/tools/viewshed_tool_3d.js

/**
 * @fileoverview 3D Viewshed tool wrapper.
 * Provides persistence and selection for viewshed analysis.
 * Follows the same pattern as marker_tool_3d.js.
 *
 * SINCE 2026-09-15 THE ENGINE IS OURS. Until then this file built `Cesium.ViewShed3D`, a class that
 * an obfuscated third-party `<script>` hung onto the Cesium namespace at runtime; it is now
 * `Viewshed3D` from `services/viewshed-3d.js`, imported like anything else (decision D15). Three
 * things the swap deliberately did NOT change, because they are contract with this file: the
 * misspelled `calback` option, the fields read back after the interactive gesture, and the
 * narrowing per sub-viewshed (`renderAngle` below, `SEAM_NARROWING_DEGREES` in
 * `services/viewshed-geometry.js`), which only works because the shader still compares with
 * strict `>`. That narrowing went to ZERO on 2026-09-16, after the seam was photographed close
 * up: any positive value is a blind wedge pointing exactly where the observer is aimed. The
 * measured table lives on the constant.
 */

import {
    addViewshed,
    getViewsheds,
    updateViewshed,
    removeViewshed,
    getViewshedById as getViewshedByIdStore
} from '@store/index.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { Viewshed3D } from '../services/viewshed-3d.js';
import { subViewshedLayout } from '../services/viewshed-geometry.js';
import { escolherAlvo } from '../services/pick-de-alvo.js';

// ===== MODULE STATE =====

let isToolActive = false;
let currentViewer = null;
let currentTilesetId = null;
const viewshedObjects = new Map(); // viewshedId -> { cesiumViewsheds: Viewshed3D[], originEntity: Cesium.Entity }
// The viewshed as the STORE had it when the scene last drew it: the baseline of the live
// reconcile (`syncViewshedsFromStore`), so an event that changed nothing here rebuilds nothing.
// Rebuilding a viewshed is not a repaint, it is a new depth render per sub-viewshed.
const loadedViewsheds = new Map(); // viewshedId -> viewshed data
// Bumped by every path that changes the scene from THIS client (the gesture completing, a panel
// edit, a deletion, a full render). A reconcile whose store read started before one of them may
// hand back a list without the viewshed the person has just placed, and applying it would remove
// that viewshed and close its panel; the reconcile reads again instead.
let localSceneEpoch = 0;
/** Coalescing window for scene repaints driven by viewshed ops (mirrors the marker tool). */
const VIEWSHED_REFRESH_DEBOUNCE_MS = 80;
let selectedViewshedId = null;
let selectionHandler = null;
let pendingViewshed = null; // Temporary storage for viewshed being created
// Unsubscribe callbacks for the module-level event listeners (paired in cleanup),
// mirroring `marker_tool_3d.js`, the only one of the three sibling tools that already
// had them. LATENT, not live: today the viewer is built once and `cleanup3DFeatures`
// only runs on beforeunload, so the cost is one stray listener per page. It becomes a
// real leak the day the viewer is torn down and rebuilt (an atlas switch, say), and it
// is the asymmetry with the sibling that would make that day silent.
const busUnsubscribers = [];

// Default viewshed parameters
const DEFAULT_VIEWSHED_PARAMS = {
    horizontalAngle: 120,
    verticalAngle: 120,
    distance: 500
};

/**
 * Eye height, in metres above the clicked point, of the observer a new viewshed is stored with.
 *
 * ONE CONSTANT FOR TWO PLACES, and the pair is why it is named: `handleViewshedComplete` stores it
 * as `observerHeight`, and `activateViewshedTool` hands it to the engine as `previewEyeHeight`, so
 * the sector previewed between the two clicks is drawn from the same eye the rebuilt analysis looks
 * from. With two literals, changing one would make the preview promise a sector that is not the one
 * computed.
 */
const DEFAULT_OBSERVER_HEIGHT = 1.5;

// ===== UTILITY FUNCTIONS =====

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
 * Destroys an array of Viewshed3D objects safely.
 * @param {Viewshed3D[]} cesiumViewsheds - Array of viewsheds to destroy
 */
function destroyCesiumViewsheds(cesiumViewsheds) {
    if (!cesiumViewsheds) return;
    for (const vs of cesiumViewsheds) {
        if (vs && vs.destroy) {
            try {
                vs.destroy();
            } catch (e) {
                console.warn('Error destroying Viewshed3D:', e);
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
 * Creates one or more Viewshed3D objects from stored viewshed data.
 * For horizontalAngle <= 150°, creates a single Viewshed3D (original behavior).
 * For horizontalAngle > 150°, splits into 2 or 3 sub-viewsheds rotated to cover
 * the total sector symmetrically around the original heading direction.
 * @param {Object} viewshed - Viewshed data from the store
 * @returns {Viewshed3D[]} Array of Viewshed3D objects (1, 2, or 3 elements)
 */
function createCesiumViewsheds(viewshed) {
    if (!currentViewer || !window.Cesium) {
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

        // THE SPLIT, THE SEAM NARROWING AND THE HEADING OFFSETS MOVED OUT IN 2026-09-15, into
        // `services/viewshed-geometry.js`, which has zero imports and is therefore reachable from
        // a node test. They were computed inline here for as long as they existed, inside a
        // function that pulls in the store and Cesium, which is why numbers that decide the
        // DRAWING had never been measured except through a screenshot.
        const { renderAngle, offsets } = subViewshedLayout(totalHorizontalAngle);

        const result = [];
        try {
            for (const offset of offsets) {
                const rotatedViewPosition = rotateViewPositionAroundObserver(cameraPosition, baseViewPosition, offset);

                const vs = new Viewshed3D(currentViewer, {
                    cameraPosition: cameraPosition,
                    viewPosition: rotatedViewPosition,
                    horizontalAngle: renderAngle,
                    verticalAngle: verticalAngle,
                    distance: distance
                });
                result.push(vs);
            }
        } catch (error) {
            // MEIO SETOR NA CENA E PIOR QUE NENHUM, e ate 2026-09-15 era o que sobrava. Um pedaco
            // que ja se desenhou fica na coleção de primitivas e na de pós-processamento, mas
            // NINGUÉM guarda a referência dele (a lista vazia é o que volta), então nenhum
            // `deleteViewshed` o alcança: ele pinta a tela até o F5. Desfazer o que já entrou é o
            // que torna a falha atômica.
            destroyCesiumViewsheds(result);
            throw error;
        }

        return result;
    } catch (error) {
        console.warn('Failed to create Viewshed3D:', error);
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

    // A gesture still pending from an earlier activation would keep its handler and, since the
    // preview exists, its wireframe: two instances would answer the same clicks. Every caller
    // deactivates first today; this makes the second activation safe without relying on that.
    if (pendingViewshed) {
        try {
            pendingViewshed.destroy();
        } catch (_e) {
            // destroy() is idempotent; a throw here means it was already torn down.
        }
        pendingViewshed = null;
    }

    currentViewer = viewer;
    currentTilesetId = tilesetId;
    isToolActive = true;

    // THE OPTION IS `calback`, WITH ONE L, and it is contract, not a typo to fix here: the class
    // inherited the spelling from the plugin it replaced. Correcting it on one side only gives an
    // interactive mode that never completes, and does it silently.
    pendingViewshed = new Viewshed3D(viewer, {
        horizontalAngle: DEFAULT_VIEWSHED_PARAMS.horizontalAngle,
        verticalAngle: DEFAULT_VIEWSHED_PARAMS.verticalAngle,
        distance: DEFAULT_VIEWSHED_PARAMS.distance,
        // The preview between the two clicks is drawn from the eye the analysis will be rebuilt
        // with, not from the ground under the first click (see `DEFAULT_OBSERVER_HEIGHT`).
        previewEyeHeight: DEFAULT_OBSERVER_HEIGHT,
        calback: function () {
            // Called when viewshed creation is complete
            handleViewshedComplete(pendingViewshed);
        }
    });

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
 * Handles viewshed completion from the interactive two-click gesture.
 * The interactive click handler places the observer at ground level (height += 0).
 * After capturing positions, the initial viewshed is destroyed and recreated
 * with a 1.5m observer height offset to simulate eye-level observation.
 * @param {Viewshed3D} cesiumViewshed - The created viewshed
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
    const defaultObserverHeight = DEFAULT_OBSERVER_HEIGHT;

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

    const viewer = currentViewer;
    const viewshed = await addViewshed(currentTilesetId, viewshedData);

    // Destroy the interactive viewshed (placed at ground level) and recreate
    // with the 1.5m observer height offset applied for eye-level observation
    cesiumViewshed._wasSaved = false;
    try {
        cesiumViewshed.destroy();
    } catch (e) {
        console.warn('Error destroying interactive viewshed:', e);
    }
    // ONLY THIS gesture's slot. During the write the tool may have been cleaned up and activated
    // again on a reopened viewer: nulling the new gesture here would orphan its handler, which would
    // keep answering clicks with nobody left to destroy it.
    if (pendingViewshed === cesiumViewshed) pendingViewshed = null;

    // TORN DOWN DURING THE WRITE. The analysis is stored; the viewer that would draw it is gone, and
    // the next opening draws it from the store like any other.
    if (!currentViewer || currentViewer !== viewer || currentViewer.isDestroyed?.()) return;

    // A REFUSED write returns null (role, lock, a map the atlas no longer has) and the store has
    // already said why; recreating it would draw an analysis that exists nowhere.
    if (viewshed) {
        localSceneEpoch += 1;
        loadedViewsheds.set(viewshed.id, viewshed);
        // The store's own VIEWSHEDS_3D_CHANGED has already scheduled a reconcile; whatever it may
        // have drawn for this id goes before the recreation, or its sub-viewsheds would be orphaned.
        removeViewshedObjects(viewshed.id);

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
    }

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
    localSceneEpoch += 1;

    // Clear existing objects
    clearAllViewshedObjects();

    // Load and render
    const viewsheds = await getViewsheds(tilesetId);
    // TORN DOWN OR SWITCHED DURING THE READ, the same check the live reconcile makes. The teardown
    // nulls `currentViewer` and destroys this viewer, whose `canvas` getter then throws; without the
    // check the selection handler below would be born on a dead viewer and never be destroyed.
    if (currentViewer !== viewer || currentTilesetId !== tilesetId || viewer.isDestroyed?.()) return;
    loadedViewsheds.clear();
    for (const viewshed of viewsheds) {
        loadedViewsheds.set(viewshed.id, viewshed);
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

        const pickedObject = escolherAlvo(viewer.scene, click.position);

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
        markLocalViewshedWrite(viewshedId, updatedViewshed);
        updateViewshedVisuals(viewshedId, updatedViewshed);
    }

    return updatedViewshed;
}

/**
 * Records that THIS client just changed a viewshed the scene already shows, so the live reconcile
 * neither rebuilds it again (the baseline already holds the stored copy) nor applies a store read
 * that started before the write (the epoch moves).
 * @param {string} viewshedId - Viewshed ID
 * @param {Object} stored - The viewshed as the store returned it
 */
function markLocalViewshedWrite(viewshedId, stored) {
    localSceneEpoch += 1;
    loadedViewsheds.set(viewshedId, stored);
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
    markLocalViewshedWrite(viewshedId, updatedViewshed);

    const data = viewshedObjects.get(viewshedId);
    if (!data) return updatedViewshed;

    destroyCesiumViewsheds(data.cesiumViewsheds);
    data.cesiumViewsheds = createCesiumViewsheds(updatedViewshed);

    // Refresca a COPIA que a entidade de origem carrega em `properties.viewshedData`: o painel
    // e reconstruido dela quando o marcador e clicado de novo, entao a copia velha fazia o
    // valor reverter na tela mesmo com o store ja gravado.
    updateViewshedVisuals(viewshedId, updatedViewshed);

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
    markLocalViewshedWrite(viewshedId, updatedViewshed);

    const data = viewshedObjects.get(viewshedId);
    if (!data) return updatedViewshed;

    destroyCesiumViewsheds(data.cesiumViewsheds);
    data.cesiumViewsheds = createCesiumViewsheds(updatedViewshed);

    updateViewshedVisuals(viewshedId, updatedViewshed);

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
    // The baseline is the STORED copy, not the one with the resolved terrain height drawn below:
    // it is what the next store read will be compared against.
    markLocalViewshedWrite(viewshedId, updatedViewshed);

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

    // A copia leva o viewshed COM o terrainBaseHeight resolvido, que e o mesmo objeto que
    // acabou de desenhar o cone: o painel reabre com o que esta na tela.
    updateViewshedVisuals(viewshedId, viewshedForRecreation);

    return updatedViewshed;
}

/**
 * Deletes a viewshed.
 * @param {string} viewshedId - Viewshed ID
 */
export async function deleteViewshed(viewshedId) {
    // Read the selection BEFORE the await: the persistence round-trip can be
    // interleaved with a click that moves the selection elsewhere.
    const wasSelected = selectedViewshedId === viewshedId;

    const result = await removeViewshed(viewshedId);

    if (result) {
        localSceneEpoch += 1;
        removeViewshedObjects(viewshedId);
        loadedViewsheds.delete(viewshedId);
        if (wasSelected) {
            selectedViewshedId = null;
            // Emit deselected event to close the panel (same contract as
            // deleteMeasurement). Without it the Delete-key path leaves the
            // feature panel open on a viewshed that no longer exists.
            emitViewshedDeselected();
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

    // Unsubscribe the module-level event listeners (paired with on() in init).
    for (const off of busUnsubscribers) {
        if (typeof off === 'function') off();
    }
    busUnsubscribers.length = 0;

    loadedViewsheds.clear();
    localSceneEpoch += 1;
    currentViewer = null;
    currentTilesetId = null;
    // As the measurement twin does: a selection that outlives its viewer would be drawn highlighted
    // on the next one, with no panel open for it.
    selectedViewshedId = null;
}

/**
 * Refreshes viewsheds for the current tileset.
 */
export async function refreshViewshedsForCurrentTileset() {
    const viewer = currentViewer;
    const tilesetId = currentTilesetId;
    if (!viewer || !tilesetId) return;

    localSceneEpoch += 1;
    clearAllViewshedObjects();

    if (selectedViewshedId) {
        selectedViewshedId = null;
        emitViewshedDeselected();
    }

    const viewsheds = await getViewsheds(tilesetId);
    // Same check as `renderViewshedsForTileset`: a read that outlived its viewer draws nothing.
    if (currentViewer !== viewer || currentTilesetId !== tilesetId || viewer.isDestroyed?.()) return;
    loadedViewsheds.clear();
    for (const viewshed of viewsheds) {
        loadedViewsheds.set(viewshed.id, viewshed);
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
 * Reconciles the scene against the store WITHOUT disturbing what the local user is doing.
 *
 * UNTIL 2026-09-22 NOTHING INSIDE THE 3D VIEWER LISTENED TO `VIEWSHEDS_3D_CHANGED`. A colleague's
 * viewshed reached this client, was written to the cesium3d side-store by the remote handler, the
 * event was emitted, and the scene only showed it after the viewer was closed and reopened; the
 * one the colleague deleted stayed on screen. Same defect, and same repair, as the marker tool
 * (`syncMarkersFromStore`, 2026-09-16) and the measurement tool (`syncMeasurementsFromStore`).
 *
 * WHAT IT LEAVES ALONE, and each one is a reason it does not reuse
 * `refreshViewshedsForCurrentTileset`, which clears everything and deselects:
 *  - the local SELECTION, dropped only when the selected viewshed itself was deleted;
 *  - every viewshed whose stored copy did not change: rebuilding one costs a new depth render per
 *    sub-viewshed, and the drawing it would produce is identical;
 *  - the INTERACTIVE GESTURE and its preview: `pendingViewshed` is not in `viewshedObjects`, so
 *    nothing here can reach it, and a read that started before the gesture landed is discarded
 *    (`localSceneEpoch`) instead of removing the viewshed the person has just placed.
 *
 * The drawing of a viewshed is not decided here: a rebuilt one goes through the same
 * `createCesiumViewsheds` and `createViewshedOriginEntity` as the first render.
 *
 * @returns {Promise<void>}
 */
export async function syncViewshedsFromStore() {
    const viewer = currentViewer;
    const tilesetId = currentTilesetId;
    if (!viewer || viewer.isDestroyed?.() || !tilesetId) return;

    let viewsheds = null;
    for (let tentativa = 0; tentativa < 3 && viewsheds === null; tentativa++) {
        const epoch = localSceneEpoch;
        const lidos = await getViewsheds(tilesetId);
        // The viewer may have switched model or been torn down during the read, and painting the
        // old model's viewsheds over the new one is worse than painting nothing.
        if (currentViewer !== viewer || currentTilesetId !== tilesetId || viewer.isDestroyed?.()) return;
        if (epoch === localSceneEpoch) viewsheds = lidos;
    }
    // A local writer kept moving under three reads in a row: its own VIEWSHEDS_3D_CHANGED is
    // already on the way and reconciles again, so doing nothing now loses nothing.
    if (viewsheds === null) return;

    const vivos = new Set();
    for (const viewshed of viewsheds) {
        vivos.add(viewshed.id);
        const anterior = loadedViewsheds.get(viewshed.id);
        loadedViewsheds.set(viewshed.id, viewshed);

        // Compared by whole content on purpose, like the marker tool: position, target, openings,
        // distance and observer height all decide the drawing, and a version stamp some write
        // path forgot to bump would leave the screen stale in silence.
        const mudou = !anterior || JSON.stringify(anterior) !== JSON.stringify(viewshed);
        if (!mudou && viewshedObjects.has(viewshed.id)) continue;

        removeViewshedObjects(viewshed.id);
        const cesiumViewsheds = createCesiumViewsheds(viewshed);
        const originEntity = createViewshedOriginEntity(viewshed);
        if (originEntity) {
            viewshedObjects.set(viewshed.id, { cesiumViewsheds, originEntity });
        } else {
            // Same rule as the first render: no origin, no entry. The cones must not outlive it.
            destroyCesiumViewsheds(cesiumViewsheds);
        }
    }

    for (const id of new Set([...viewshedObjects.keys(), ...loadedViewsheds.keys()])) {
        if (vivos.has(id)) continue;
        if (selectedViewshedId === id) {
            selectedViewshedId = null;
            emitViewshedDeselected();
        }
        removeViewshedObjects(id);
        loadedViewsheds.delete(id);
    }
}

/**
 * Initializes viewshed tool event listeners.
 * Called from `setupTools` on every viewer creation, so it is idempotent and keeps
 * the unsubscribe callbacks for `cleanupViewshedTool`.
 */
export function initViewshedToolListeners() {
    const eventBus = getEventBus();
    if (!eventBus) return;

    // Avoid double registration if called more than once.
    if (busUnsubscribers.length > 0) return;

    const offLayers = eventBus.on(EventTypes.LAYERS_CHANGED, () => {
        if (currentViewer && currentTilesetId) {
            refreshViewshedsForCurrentTileset();
        }
    });

    // CLOSING THE VIEWER ENDS THE GESTURE. `closeViewer` pauses the scene and does not deactivate
    // the active tool, so a gesture left after the first click kept its handler, and since the
    // preview exists it would also keep its wireframe: hidden while paused, and back on reopen,
    // frozen at the pointer's last position. The engine instance is dropped here at once (that is
    // what removes the preview and the handler), and map_3d then resets the button and the chip,
    // which it alone owns; its own pass through `deactivateViewshedTool` is a no-op by then.
    const offClosed = eventBus.on(EventTypes.VIEWER_3D_CLOSED, () => {
        if (!isToolActive) return;
        deactivateViewshedTool();
        import('../map_3d.js')
            .then(({ deactivateActiveTool3D }) => deactivateActiveTool3D())
            .catch((error) => console.warn('Could not deactivate tool:', error));
    });

    // THE SET OF VIEWSHEDS CHANGED, and the scene has to show it NOW (see
    // `syncViewshedsFromStore` for what went wrong while nobody listened).
    //
    // Coalesced for the marker tool's reason: a sync batch or a snapshot emits a burst, and each op
    // would otherwise cost a full read of the store. The reconciles are CHAINED, never overlapped:
    // two reads in flight could finish out of order and the older one would remove what the newer
    // one had just drawn.
    let refreshTimer = null;
    let syncChain = Promise.resolve();
    const offViewsheds = eventBus.on(EventTypes.VIEWSHEDS_3D_CHANGED, () => {
        if (!currentViewer || !currentTilesetId || refreshTimer !== null) return;
        refreshTimer = setTimeout(() => {
            refreshTimer = null;
            syncChain = syncChain.then(syncViewshedsFromStore).catch((err) => {
                console.error('Falha ao repintar as análises de visibilidade 3D:', err);
            });
        }, VIEWSHED_REFRESH_DEBOUNCE_MS);
    });
    busUnsubscribers.push(() => {
        if (refreshTimer !== null) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
    });

    busUnsubscribers.push(offLayers, offClosed, offViewsheds);
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

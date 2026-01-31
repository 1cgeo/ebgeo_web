// Path: js/street_view_tool/street_view_viewer.js

/**
 * @fileoverview Core Street View 360 viewer using Three.js.
 * Manages the 3D panoramic viewer state, rendering, and lifecycle.
 * Based on the patterns from 3d_models_viewer_tool/map_3d.js
 */

import * as THREE from '../../vendor/three/three.module.js';
import { getEventBus } from '../store/services.js';
import { EventTypes } from '../events/event_types.js';
import { NAV_CONSTANTS } from './navigation/constants.js';
import { getOrientation, saveOrientation, clearOrientation } from '../store';
import { showSuccess } from '../utilities/toast_service.js';
import { URLRouter } from '../url_router.js';

// ===== CONFIGURATION =====
const IMAGES_LOCATION = './street_view/IMG';
const METADATA_LOCATION = './street_view/METADATA';

// ===== GLOBAL STATE MANAGEMENT =====
const streetViewState = {
    isLoaded: false,
    isVisible: false,
    isPaused: false,
    loadPromise: null,
    scene: null,
    camera: null,
    renderer: null,
    mesh: null,
    material: null,
    navigator: null,
    currentPhotoName: null,
    currentInfo: null,
    modules: {},
    animationId: null,
    documentListeners: [],
    // Caches
    textureCache: new Map(),
    metadataCache: new Map(),
    sphereGeometry: null,
    // External references (set by control)
    miniMap: null,
    controlInstance: null
};

// Track if toolbar has been initialized
let toolbarInitialized = false;

// ===== HELPER FUNCTIONS =====

/**
 * Adds a document event listener and tracks it for cleanup
 */
function addDocumentListener(event, handler, options = false) {
    document.addEventListener(event, handler, options);
    streetViewState.documentListeners.push({ event, handler, options });
}

/**
 * Removes all tracked document listeners
 */
function removeAllDocumentListeners() {
    streetViewState.documentListeners.forEach(({ event, handler, options }) => {
        document.removeEventListener(event, handler, options);
    });
    streetViewState.documentListeners = [];
}

/**
 * Loads metadata for a photo with caching
 */
async function loadMetadataWithCache(name) {
    if (streetViewState.metadataCache.has(name)) {
        return streetViewState.metadataCache.get(name);
    }

    const response = await fetch(`${METADATA_LOCATION}/${name}.json`);
    const data = await response.json();
    streetViewState.metadataCache.set(name, data);
    return data;
}

/**
 * Gets mesh rotation Y from metadata
 */
function getMeshRotationY(data) {
    return data.camera?.mesh_rotation_y ? data.camera.mesh_rotation_y : 270;
}

// ===== THREE.JS INITIALIZATION =====

/**
 * Initializes the Three.js scene, camera, and renderer
 */
async function initThreeJS() {
    const container = document.getElementById('street-view-container');
    if (!container) {
        throw new Error('Street view container not found');
    }

    // Get container dimensions (accounts for sidebar offset)
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Create camera
    streetViewState.camera = new THREE.PerspectiveCamera(
        75,
        containerWidth / containerHeight,
        0.1,
        1000
    );
    streetViewState.camera.position.set(0, -0.1, 0);
    streetViewState.camera.rotation.order = 'YXZ';

    // Create scene
    streetViewState.scene = new THREE.Scene();
    streetViewState.scene.add(streetViewState.camera);

    // Create reusable sphere geometry
    if (!streetViewState.sphereGeometry) {
        streetViewState.sphereGeometry = new THREE.SphereGeometry(500, 60, 40);
        streetViewState.sphereGeometry.scale(-1, 1, 1);
    }

    // Create renderer
    streetViewState.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true // For screenshots
    });
    streetViewState.renderer.setPixelRatio(window.devicePixelRatio);
    streetViewState.renderer.setSize(containerWidth, containerHeight);
    container.appendChild(streetViewState.renderer.domElement);

    // Setup event listeners
    container.style.touchAction = 'none';
    container.addEventListener('pointerdown', onPointerDown);

    // Prevent right-click context menu
    container.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        return false;
    });

    addDocumentListener('wheel', onDocumentMouseWheel, { passive: true });
    addDocumentListener('pointermove', onPointerMoveGlobal, { passive: true });

    window.addEventListener('resize', onWindowResize);

    // Initialize navigator (lazy load)
    await initNavigator(container);

    streetViewState.isLoaded = true;
}

/**
 * Initializes the navigation system
 */
async function initNavigator(container) {
    try {
        const { StreetViewNavigator } = await import('./navigation/navigator.js');
        streetViewState.navigator = new StreetViewNavigator(
            container,
            streetViewState.miniMap,
            () => streetViewState.camera
        );
        await streetViewState.navigator.initialize();
    } catch (error) {
        console.warn('Failed to initialize navigator:', error);
    }
}

// ===== PHOTO LOADING =====

/**
 * Loads a photo and its metadata
 */
async function loadPhoto(photoName) {
    const data = await loadMetadataWithCache(photoName);
    streetViewState.currentInfo = data;
    streetViewState.currentPhotoName = photoName;

    // Apply defaults for missing metadata fields
    const cameraConfig = {
        ...data.camera,
        height: data.camera.height ?? NAV_CONSTANTS.DEFAULT_CAMERA_HEIGHT,
        north_correction: data.camera.north_correction ?? 0,
        ground_offset: data.camera.ground_offset ?? 0,
        distance_scale: data.camera.distance_scale ?? 1.0
    };

    // Process targets with defaults
    const targets = (data.targets || []).map(t => ({
        ...t,
        elevation: t.elevation ?? cameraConfig.ele,
        ground_offset: t.ground_offset ?? 0
    }));

    // Load texture
    const imagePath = `${IMAGES_LOCATION}/${data.camera.img}.jpg`;
    await loadTexture(imagePath, data);

    // Update minimap
    updateMiniMap(data.camera);

    // Update navigator
    if (streetViewState.navigator) {
        streetViewState.navigator.setPhoto(cameraConfig, targets);
    }

    // Check for saved orientation and apply it
    const savedOrientation = await getOrientation(photoName);
    setCameraOrientation(data, savedOrientation);

    // Update orientation button state
    updateOrientationButtonState(savedOrientation !== null);

    // Update URL with new photo name
    URLRouter.setPhoto360(photoName);

    // Emit photo changed event
    getEventBus().emit(EventTypes.STREETVIEW_360_PHOTO_CHANGED, {
        previousPhoto: streetViewState.currentPhotoName,
        currentPhoto: photoName
    });
}

/**
 * Loads a texture for the panorama sphere
 */
async function loadTexture(imagePath, data) {
    return new Promise((resolve) => {
        if (streetViewState.textureCache.has(imagePath)) {
            const texture = streetViewState.textureCache.get(imagePath);
            applyTexture(texture, data);
            resolve();
        } else {
            const loader = new THREE.TextureLoader();
            loader.load(imagePath, (loadedTexture) => {
                loadedTexture.colorSpace = THREE.SRGBColorSpace;
                streetViewState.textureCache.set(imagePath, loadedTexture);
                applyTexture(loadedTexture, data);
                resolve();
            });
        }
    });
}

/**
 * Applies a texture to the panorama sphere
 */
function applyTexture(texture, data) {
    if (streetViewState.mesh) {
        // Update existing mesh
        streetViewState.material.map = texture;
        streetViewState.material.needsUpdate = true;
    } else {
        // Create new mesh
        streetViewState.material = new THREE.MeshBasicMaterial({ map: texture });
        streetViewState.mesh = new THREE.Mesh(
            streetViewState.sphereGeometry,
            streetViewState.material
        );
        streetViewState.mesh.name = 'IMAGE_360';
        streetViewState.scene.add(streetViewState.mesh);
    }

    // Apply mesh rotation
    const offsetRad = THREE.MathUtils.degToRad(
        getMeshRotationY(data) - data.camera.heading
    );
    streetViewState.mesh.rotation.y = offsetRad;
}

/**
 * Sets camera orientation based on metadata or saved orientation
 * @param {Object} _data - Photo metadata (unused, kept for signature compatibility)
 * @param {Object|null} savedOrientation - Optional saved orientation to apply
 */
function setCameraOrientation(_data, savedOrientation = null) {
    if (savedOrientation) {
        // Apply saved orientation
        lon = savedOrientation.lon;
        lat = savedOrientation.lat;
        if (savedOrientation.fov && streetViewState.camera) {
            streetViewState.camera.fov = savedOrientation.fov;
            streetViewState.camera.updateProjectionMatrix();
        }
    } else {
        // Start with lon=0 which means looking at the original photo heading direction
        // The mesh is already rotated to align with the heading
        // User can then rotate from this starting point
        lon = 0;
        lat = 0;  // Start level (looking at horizon)
    }
}

// ===== MINIMAP =====

/**
 * Updates minimap position and icon
 */
function updateMiniMap(camera) {
    if (!streetViewState.miniMap) return;

    // Center minimap on camera position with higher zoom
    streetViewState.miniMap.flyTo({
        center: [camera.lon, camera.lat],
        zoom: 17,
        duration: 500
    });

    // Update selected photo filter
    if (streetViewState.miniMap.getLayer('selected')) {
        streetViewState.miniMap.setFilter('selected', ['==', 'nome_img', streetViewState.currentPhotoName]);
    }

    // Update icon direction
    setIconDirection(camera.heading);
}

/**
 * Sets the minimap icon direction
 */
function setIconDirection(degrees) {
    if (streetViewState.miniMap && streetViewState.miniMap.getLayer('selected')) {
        streetViewState.miniMap.setLayoutProperty('selected', 'icon-rotate', degrees);
    }
}

/**
 * Updates minimap icon based on current camera heading
 */
function updateCurrentHeading() {
    if (!streetViewState.currentInfo) return;

    // Get the original photo heading
    const imageHeading = streetViewState.currentInfo.camera?.heading ?? 0;

    // Calculate world heading based on user's lon rotation
    // lon=0 means looking at imageHeading direction
    // Drag right → lon decreases → looking left (counter-clockwise) → heading decreases
    // Drag left → lon increases → looking right (clockwise) → heading increases
    // So world heading = imageHeading + lon
    const worldHeading = (imageHeading + lon + 360) % 360;

    setIconDirection(worldHeading);
}

// ===== EVENT HANDLERS =====

let isUserInteracting = false;
let onPointerDownMouseX = 0;
let onPointerDownMouseY = 0;

// Camera rotation state (in degrees)
let lon = 0;  // Horizontal rotation (yaw)
let lat = 0;  // Vertical rotation (pitch)
let onPointerDownLon = 0;
let onPointerDownLat = 0;

function onPointerDown(event) {
    if (event.isPrimary === false) return;

    isUserInteracting = true;
    onPointerDownMouseX = event.clientX;
    onPointerDownMouseY = event.clientY;
    onPointerDownLon = lon;
    onPointerDownLat = lat;

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
}

function onPointerMove(event) {
    if (event.isPrimary === false || !isUserInteracting) return;

    // Base sensitivity adjusted by FOV - when zoomed in (lower FOV), reduce sensitivity
    // At FOV 75 (default), sensitivity is 0.1. At FOV 10 (max zoom), sensitivity is ~0.013
    const baseSensitivity = 0.1;
    const fovFactor = streetViewState.camera.fov / 75;
    const sensitivity = baseSensitivity * fovFactor;

    lon = (onPointerDownMouseX - event.clientX) * sensitivity + onPointerDownLon;
    lat = (event.clientY - onPointerDownMouseY) * sensitivity + onPointerDownLat;

    // Clamp vertical rotation to prevent flipping
    lat = Math.max(-85, Math.min(85, lat));
}

function onPointerUp(event) {
    if (event.isPrimary === false) return;
    isUserInteracting = false;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
}

function onPointerMoveGlobal(_event) {
    updateCurrentHeading();
}

const miniMapHovered = false;

function onDocumentMouseWheel(event) {
    if (miniMapHovered || !streetViewState.isVisible) return;

    const fov = streetViewState.camera.fov + event.deltaY * 0.05;
    streetViewState.camera.fov = THREE.MathUtils.clamp(fov, 10, 75);
    streetViewState.camera.updateProjectionMatrix();
}

function onWindowResize() {
    if (!streetViewState.camera || !streetViewState.renderer) return;

    const container = document.getElementById('street-view-container');
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    streetViewState.camera.aspect = containerWidth / containerHeight;
    streetViewState.camera.updateProjectionMatrix();
    streetViewState.renderer.setSize(containerWidth, containerHeight);

    if (streetViewState.navigator) {
        streetViewState.navigator.resize();
    }
}

// ===== ANIMATION LOOP =====

/**
 * Animation loop for rendering
 */
function animate() {
    if (!streetViewState.isVisible) {
        streetViewState.animationId = null;
        return;
    }

    streetViewState.animationId = requestAnimationFrame(animate);
    update();
}

/**
 * Update function called each frame
 */
function update() {
    // Convert lon/lat (degrees) to camera direction
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);

    // Calculate look-at target on sphere
    const target = new THREE.Vector3(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
    );

    streetViewState.camera.lookAt(target);
    updateCurrentHeading();

    // Render Three.js scene
    if (streetViewState.renderer && streetViewState.scene && streetViewState.camera) {
        streetViewState.renderer.render(streetViewState.scene, streetViewState.camera);
    }

    // Render navigation overlay with lon/lat in degrees
    if (streetViewState.navigator) {
        streetViewState.navigator.render(
            lon,
            lat,
            streetViewState.camera.fov
        );
    }
}

// ===== RENDERING CONTROL =====

/**
 * Pauses rendering to save resources when viewer is not visible
 */
function pauseRendering() {
    if (streetViewState.isPaused) return;

    streetViewState.isPaused = true;
    streetViewState.isVisible = false;

    if (streetViewState.animationId) {
        cancelAnimationFrame(streetViewState.animationId);
        streetViewState.animationId = null;
    }
}

/**
 * Resumes rendering when viewer becomes visible
 */
function resumeRendering() {
    streetViewState.isPaused = false;
    streetViewState.isVisible = true;

    if (!streetViewState.animationId) {
        animate();
    }
}

// ===== UI CONTROL =====

/**
 * Sets the full map visibility
 */
function setFullMap(full) {
    const mapSig = document.getElementById('map-sig');
    const miniMap = document.getElementById('mini-map-street-view');
    const streetViewContainer = document.getElementById('street-view-container');
    const closeBtn = document.getElementById('close-street-view-button');

    if (mapSig) mapSig.style.display = full ? 'block' : 'none';
    if (miniMap) miniMap.style.display = full ? 'none' : 'block';
    if (streetViewContainer) streetViewContainer.style.display = full ? 'none' : 'block';
    if (closeBtn) closeBtn.style.display = full ? 'none' : 'flex';
}

/**
 * Shows the 360 toolbar
 */
function showToolbar360() {
    const toolbar = document.getElementById('toolbar-360');
    if (toolbar) {
        toolbar.style.display = 'flex';
    }

    // Initialize toolbar if not done yet
    if (!toolbarInitialized) {
        initToolbar360();
        toolbarInitialized = true;
    }
}

/**
 * Hides the 360 toolbar
 */
function hideToolbar360() {
    const toolbar = document.getElementById('toolbar-360');
    if (toolbar) {
        toolbar.style.display = 'none';
    }
    hideActiveToolChip360();
}

/**
 * Initializes toolbar button handlers
 */
async function initToolbar360() {
    try {
        const {
            initToolbar360: init,
            onSaveOrientationClick,
            onClearOrientationClick,
            onAddMarkerClick,
            setMarkerButtonActive
        } = await import('./components/streetview-sidebar.js');

        init();

        // Register save orientation handler
        onSaveOrientationClick(handleSaveOrientation);

        // Register clear orientation handler
        onClearOrientationClick(handleClearOrientation);

        // Register marker tool handler
        onAddMarkerClick(() => handleToggleMarkerTool(setMarkerButtonActive));
    } catch (error) {
        console.warn('Failed to initialize toolbar:', error);
    }
}

/**
 * Handles toggling the marker tool
 * @param {Function} setMarkerButtonActive - Function to set button active state
 */
async function handleToggleMarkerTool(setMarkerButtonActive) {
    try {
        const {
            toggleMarkerTool,
            isMarkerToolActive
        } = await import('./tools/marker_tool_360.js');

        toggleMarkerTool(streetViewState.currentPhotoName, streetViewState.navigator);

        // Update button state
        setMarkerButtonActive(isMarkerToolActive());
    } catch (error) {
        console.error('Failed to toggle marker tool:', error);
    }
}

/**
 * Handles marker position click event from navigator
 * @param {Object} data - Event data with position and photoName
 */
async function handleMarkerPositionClicked(data) {
    const { position, photoName } = data;

    try {
        const { createMarkerAtPosition, setCurrentPhotoForMarker } = await import('./tools/marker_tool_360.js');

        // Ensure photo name is set
        setCurrentPhotoForMarker(photoName || streetViewState.currentPhotoName);

        // Create the marker
        const marker = await createMarkerAtPosition(position);

        if (marker && streetViewState.navigator) {
            // Reload markers to display the new one
            await loadMarkersForCurrentPhoto();
        }
    } catch (error) {
        console.error('Failed to create marker:', error);
    }
}

/**
 * Loads and displays markers for the current photo
 */
async function loadMarkersForCurrentPhoto() {
    if (!streetViewState.navigator || !streetViewState.currentPhotoName) return;

    try {
        const { getMarkers360 } = await import('../store');
        const markers = await getMarkers360(streetViewState.currentPhotoName);
        streetViewState.navigator.setPOIs(markers);
    } catch (error) {
        console.error('Failed to load markers:', error);
    }
}

/**
 * Handles LAYERS_CHANGED event to reload 360 data when user switches maps
 */
async function handleLayersChanged() {
    if (!streetViewState.isVisible || !streetViewState.currentPhotoName) return;

    try {
        // Reload markers for the current photo (they may have changed with the new map)
        await loadMarkersForCurrentPhoto();

        // Check and apply orientation for current photo (orientation may be different in new map)
        const savedOrientation = await getOrientation(streetViewState.currentPhotoName);
        updateOrientationButtonState(savedOrientation !== null);
    } catch (error) {
        console.error('Failed to reload 360 data after map change:', error);
    }
}

/**
 * Handles saving the current camera orientation
 */
async function handleSaveOrientation() {
    const photoName = streetViewState.currentPhotoName;
    if (!photoName) {
        console.warn('No photo loaded, cannot save orientation');
        return;
    }

    const orientation = {
        lon,
        lat,
        fov: streetViewState.camera?.fov || 75
    };

    try {
        await saveOrientation(photoName, orientation);
        updateOrientationButtonState(true);
        showSuccess('Orientação salva');
    } catch (error) {
        console.error('Failed to save orientation:', error);
    }
}

/**
 * Handles clearing the saved camera orientation
 */
async function handleClearOrientation() {
    const photoName = streetViewState.currentPhotoName;
    if (!photoName) {
        console.warn('No photo loaded, cannot clear orientation');
        return;
    }

    try {
        await clearOrientation(photoName);
        updateOrientationButtonState(false);
        showSuccess('Orientação removida');
    } catch (error) {
        console.error('Failed to clear orientation:', error);
    }
}

/**
 * Hides the active tool chip
 */
function hideActiveToolChip360() {
    const chip = document.getElementById('active-tool-chip-360');
    if (chip) {
        chip.classList.remove('visible');
        setTimeout(() => {
            if (!chip.classList.contains('visible')) {
                chip.style.display = 'none';
            }
        }, 200);
    }
}

/**
 * Updates the orientation button state based on whether orientation is saved
 * @param {boolean} hasSaved - Whether the current photo has a saved orientation
 */
function updateOrientationButtonState(hasSaved) {
    const saveBtn = document.getElementById('salvar-orientacao-360');
    const clearBtn = document.getElementById('limpar-orientacao-360');

    if (saveBtn) {
        if (hasSaved) {
            saveBtn.classList.add('has-saved');
            saveBtn.title = 'Atualizar orientação salva';
        } else {
            saveBtn.classList.remove('has-saved');
            saveBtn.title = 'Salvar orientação';
        }
    }

    if (clearBtn) {
        if (hasSaved) {
            clearBtn.style.display = 'flex';
        } else {
            clearBtn.style.display = 'none';
        }
    }
}

/**
 * Deactivates the currently active 360 tool
 */
export async function deactivateCurrentTool360() {
    hideActiveToolChip360();

    // Deactivate marker tool if active
    try {
        const { deactivateMarkerTool, isMarkerToolActive } = await import('./tools/marker_tool_360.js');
        if (isMarkerToolActive()) {
            deactivateMarkerTool();
        }
    } catch (_error) {
        // Tool module not loaded, ignore
    }
}

// ===== PUBLIC API =====

/**
 * Opens the 360 viewer with a specific photo
 * @param {string} photoName - Name of the photo to display
 * @param {Object} options - Options including miniMap reference and controlInstance
 */
export async function openViewer360WithPhoto(photoName, options = {}) {
    // Store external references
    if (options.miniMap) {
        streetViewState.miniMap = options.miniMap;
    }
    if (options.controlInstance) {
        streetViewState.controlInstance = options.controlInstance;
    }

    // Clear 2D selection
    try {
        const { getStateManagerInstance } = await import('../state/state_manager.js');
        const stateManager = getStateManagerInstance();
        stateManager.clearSelection();
        stateManager.closeFeaturePanel();
    } catch (error) {
        console.warn('Could not clear selection:', error);
    }

    // Update UI first so container is visible and has dimensions
    setFullMap(false);
    document.body.classList.add('streetview-active');
    showToolbar360();

    // Initialize or resume viewer (after container is visible)
    if (streetViewState.scene && streetViewState.isPaused) {
        // Resume existing viewer
        await loadPhoto(photoName);
        resumeRendering();
    } else if (!streetViewState.scene) {
        // Initialize new viewer
        await initThreeJS();
        await loadPhoto(photoName);
        resumeRendering();
    } else {
        // Viewer exists and is active, just load new photo
        await loadPhoto(photoName);
    }

    // Add close button listener
    const closeBtn = document.getElementById('close-street-view-button');
    if (closeBtn) {
        // Remove any existing listener first to avoid duplicates
        closeBtn.removeEventListener('click', closeViewer360);
        closeBtn.addEventListener('click', closeViewer360);
    }

    // Activate keyboard service
    try {
        const {
            activateKeyboardService360,
            setKeyboardCallbacks
        } = await import('./services/keyboard_service_360.js');

        // Set callbacks for keyboard actions
        setKeyboardCallbacks({
            rotateCamera: rotateCamera,
            zoomCamera: zoomCamera,
            toggleMarkerTool: () => {
                const btn = document.getElementById('add-marker-360');
                if (btn) btn.click();
            },
            saveOrientation: () => {
                const btn = document.getElementById('salvar-orientacao-360');
                if (btn) btn.click();
            },
            closeViewer: closeViewer360,
            deselectPOI: () => {
                if (streetViewState.navigator) {
                    return streetViewState.navigator.deselectPOI();
                }
                return false;
            },
            isToolActive: () => {
                // Check if any tool is active
                const chip = document.getElementById('active-tool-chip-360');
                return chip && chip.style.display !== 'none';
            }
        });

        activateKeyboardService360();
    } catch (error) {
        console.warn('Could not activate keyboard service:', error);
    }

    // Register event listeners for 360 features
    const eventBus = getEventBus();

    // Remove existing listener to avoid duplicates
    eventBus.off(EventTypes.MARKER_360_POSITION_CLICKED, handleMarkerPositionClicked);
    eventBus.on(EventTypes.MARKER_360_POSITION_CLICKED, handleMarkerPositionClicked);

    // Listen for marker changes to reload POIs
    eventBus.off(EventTypes.MARKERS_360_CHANGED, loadMarkersForCurrentPhoto);
    eventBus.on(EventTypes.MARKERS_360_CHANGED, loadMarkersForCurrentPhoto);

    // Listen for map/layer changes to reload 360 data when user switches maps
    eventBus.off(EventTypes.LAYERS_CHANGED, handleLayersChanged);
    eventBus.on(EventTypes.LAYERS_CHANGED, handleLayersChanged);

    // Load markers for the photo
    await loadMarkersForCurrentPhoto();

    // Update URL with photo name
    URLRouter.setPhoto360(photoName);

    // Emit event
    eventBus.emit(EventTypes.STREETVIEW_360_OPENED, { photoName });

    streetViewState.isVisible = true;
}

/**
 * Closes the 360 viewer
 */
export async function closeViewer360() {
    if (!streetViewState.isVisible) return;

    // Deselect POI
    if (streetViewState.navigator) {
        streetViewState.navigator.deselectPOI();
    }

    // Deactivate current tool
    deactivateCurrentTool360();

    // Pause rendering
    pauseRendering();

    // Remove close button listener
    const closeBtn = document.getElementById('close-street-view-button');
    if (closeBtn) {
        closeBtn.removeEventListener('click', closeViewer360);
    }

    // Update UI
    setFullMap(true);
    document.body.classList.remove('streetview-active');
    hideToolbar360();

    // Deactivate keyboard service
    try {
        const { deactivateKeyboardService360 } = await import('./services/keyboard_service_360.js');
        deactivateKeyboardService360();
    } catch (error) {
        console.warn('Could not deactivate keyboard service:', error);
    }

    // Remove event listeners
    const eventBus = getEventBus();
    eventBus.off(EventTypes.MARKER_360_POSITION_CLICKED, handleMarkerPositionClicked);
    eventBus.off(EventTypes.MARKERS_360_CHANGED, loadMarkersForCurrentPhoto);
    eventBus.off(EventTypes.LAYERS_CHANGED, handleLayersChanged);

    // Clear URL parameter
    URLRouter.clearPhoto360();

    // Emit event
    eventBus.emit(EventTypes.STREETVIEW_360_CLOSED, {});
}

/**
 * Navigates to a target photo
 * @param {string} targetName - Name of the target photo
 * @param {Function} callback - Optional callback after navigation
 */
export async function navigateToTarget(targetName, callback = () => {}) {
    // Deselect current POI
    if (streetViewState.navigator) {
        streetViewState.navigator.deselectPOI();
    }

    // Load the new photo directly
    await loadPhoto(targetName);

    // Load markers for the new photo
    await loadMarkersForCurrentPhoto();

    callback();
}

/**
 * Gets the current photo name
 * @returns {string|null} Current photo name
 */
export function getCurrentPhotoName() {
    return streetViewState.currentPhotoName;
}

/**
 * Gets the current viewer state
 * @returns {Object} Viewer state
 */
export function getViewer360State() {
    return {
        isLoaded: streetViewState.isLoaded,
        isVisible: streetViewState.isVisible,
        isPaused: streetViewState.isPaused,
        currentPhotoName: streetViewState.currentPhotoName,
        camera: streetViewState.camera,
        scene: streetViewState.scene,
        renderer: streetViewState.renderer
    };
}

/**
 * Checks if the 360 viewer is currently open
 * @returns {boolean} True if viewer is visible
 */
export function isStreetView360Open() {
    return streetViewState.isVisible === true;
}

/**
 * Gets the navigator instance
 * @returns {Object|null} Navigator instance
 */
export function getNavigator() {
    return streetViewState.navigator;
}

/**
 * Gets the camera FOV
 * @returns {number} Camera FOV in degrees
 */
export function getCameraFOV() {
    return streetViewState.camera?.fov || 75;
}

/**
 * Updates orientation button state (exported for external use)
 * @param {boolean} hasSaved - Whether orientation is saved
 */
export { updateOrientationButtonState };

/**
 * Gets current camera rotation in degrees
 * @returns {{lon: number, lat: number}} Camera rotation
 */
export function getCameraRotation() {
    return { lon, lat };
}

/**
 * Rotates the camera in a direction
 * @param {string} direction - 'left', 'right', 'up', 'down'
 */
export function rotateCamera(direction) {
    if (!streetViewState.camera) return;

    const rotationSpeed = 5;  // degrees

    switch (direction) {
        case 'left':
            lon -= rotationSpeed;
            break;
        case 'right':
            lon += rotationSpeed;
            break;
        case 'up':
            lat = Math.max(-85, lat - rotationSpeed);
            break;
        case 'down':
            lat = Math.min(85, lat + rotationSpeed);
            break;
    }
}

/**
 * Zooms the camera in or out
 * @param {string} direction - 'in' or 'out'
 */
export function zoomCamera(direction) {
    if (!streetViewState.camera) return;

    const zoomStep = 5;

    if (direction === 'in') {
        streetViewState.camera.fov = THREE.MathUtils.clamp(
            streetViewState.camera.fov - zoomStep,
            10,
            75
        );
    } else {
        streetViewState.camera.fov = THREE.MathUtils.clamp(
            streetViewState.camera.fov + zoomStep,
            10,
            75
        );
    }

    streetViewState.camera.updateProjectionMatrix();
}

/**
 * Cleans up all 360 features and destroys the viewer
 */
export function cleanupStreetViewFeatures() {
    // Stop animation loop
    if (streetViewState.animationId) {
        cancelAnimationFrame(streetViewState.animationId);
        streetViewState.animationId = null;
    }

    // Remove document listeners
    removeAllDocumentListeners();

    // Cleanup navigator
    if (streetViewState.navigator) {
        streetViewState.navigator.dispose();
        streetViewState.navigator = null;
    }

    // Cleanup Three.js resources
    if (streetViewState.scene) {
        // Clean main mesh
        if (streetViewState.mesh) {
            if (streetViewState.mesh.geometry !== streetViewState.sphereGeometry) {
                streetViewState.mesh.geometry.dispose();
            }
            if (streetViewState.mesh.material) {
                if (streetViewState.mesh.material.map) {
                    streetViewState.mesh.material.map.dispose();
                }
                streetViewState.mesh.material.dispose();
            }
            streetViewState.scene.remove(streetViewState.mesh);
            streetViewState.mesh = null;
        }
    }

    // Clean renderer
    if (streetViewState.renderer) {
        const container = document.getElementById('street-view-container');
        if (container && streetViewState.renderer.domElement.parentNode === container) {
            container.removeChild(streetViewState.renderer.domElement);
        }
        streetViewState.renderer.dispose();
        streetViewState.renderer = null;
    }

    // Clean cached resources
    if (streetViewState.sphereGeometry) {
        streetViewState.sphereGeometry.dispose();
        streetViewState.sphereGeometry = null;
    }

    // Clean texture cache
    streetViewState.textureCache.forEach(texture => texture.dispose());
    streetViewState.textureCache.clear();

    // Clear metadata cache
    streetViewState.metadataCache.clear();

    // Reset state
    streetViewState.scene = null;
    streetViewState.camera = null;
    streetViewState.material = null;
    streetViewState.isLoaded = false;
    streetViewState.isVisible = false;
    streetViewState.isPaused = false;
    streetViewState.currentPhotoName = null;
    streetViewState.currentInfo = null;

    // Remove body class
    document.body.classList.remove('streetview-active');
}

// Export for external access
export { streetViewState };

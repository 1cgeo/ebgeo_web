// Path: js/street_view_tool/street_view_viewer.js

/**
 * @fileoverview Core Street View 360 viewer using Three.js.
 * Manages the 3D panoramic viewer state, rendering, and lifecycle.
 * Based on the patterns from 3d_models_viewer_tool/map_3d.js
 */

import * as THREE from '../../vendor/three/three.module.js';
import config from '../config.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { getOrientation, saveOrientation, clearOrientation, getMarkers360 } from '@store';
import { showSuccess } from '@utils/toast_service.js';
import { LRUCache } from '@utils/lru-cache.js';
import { NAV_CONSTANTS } from './navigation/constants.js';
import {
    activateKeyboardService360,
    deactivateKeyboardService360,
    setKeyboardCallbacks
} from './services/keyboard_service_360.js';

// ===== CONFIGURATION =====

// Property name used in PMTiles to identify photos
const PHOTO_PROPERTY = 'photo_uuid';

// Cache limits
const TEXTURE_CACHE_MAX_SIZE = 30;  // Max textures to keep in memory (~30-50MB depending on resolution)
const METADATA_CACHE_MAX_SIZE = 100; // Metadata is small, can keep more

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
    // Caches with LRU eviction (textures dispose automatically when evicted)
    textureCache: new LRUCache(TEXTURE_CACHE_MAX_SIZE, (texture) => {
        if (texture && texture.dispose) {
            texture.dispose();
        }
    }),
    metadataCache: new LRUCache(METADATA_CACHE_MAX_SIZE),
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
 * Loads metadata for a photo with caching via the API service.
 */
async function loadMetadataWithCache(name) {
    if (streetViewState.metadataCache.has(name)) {
        return streetViewState.metadataCache.get(name);
    }

    const { fetchPhotoMetadata } = await import('./streetview-api.service.js');
    const data = await fetchPhotoMetadata(name);

    streetViewState.metadataCache.set(name, data);
    return data;
}

/**
 * Gets mesh rotation Y from metadata.
 * Default 180° aligns equirectangular center (U=0.5) with camera +X direction.
 * The heading is NOT subtracted — the image center already points at the heading.
 */
function getMeshRotationY(data) {
    return data.camera?.mesh_rotation_y ?? 180;
}

function getMeshRotationX(data) {
    return data.camera?.mesh_rotation_x ?? 0;
}

function getMeshRotationZ(data) {
    return data.camera?.mesh_rotation_z ?? 0;
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

    // Pinch-to-zoom touch listeners
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });

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
 * @param {string} photoName - Photo identifier
 * @param {number|null} [prevWorldHeading=null] - Previous world heading in degrees to preserve viewing direction
 */
async function loadPhoto(photoName, prevWorldHeading = null) {
    const data = await loadMetadataWithCache(photoName);
    streetViewState.currentInfo = data;
    streetViewState.currentPhotoName = photoName;

    // Apply defaults for missing metadata fields
    const cameraConfig = {
        ...data.camera,
        height: data.camera.height ?? NAV_CONSTANTS.DEFAULT_CAMERA_HEIGHT,
    };

    const targets = data.targets || [];

    // Load texture (may throw AbortError if superseded by a newer navigation)
    try {
        await loadTexture(data);
    } catch (error) {
        if (error.name === 'AbortError') return;
        throw error;
    }

    // If another loadPhoto call started while we were loading, bail out
    if (streetViewState.currentPhotoName !== photoName) return;

    // Update minimap
    updateMiniMap(data.camera);

    // Update photo info overlay (capture date above minimap)
    updatePhotoInfo(data);

    // Update navigator
    if (streetViewState.navigator) {
        streetViewState.navigator.setPhoto(cameraConfig, targets);
    }

    // Check for saved orientation and apply it
    const savedOrientation = await getOrientation(photoName);
    setCameraOrientation(data, savedOrientation, prevWorldHeading);

    // Update orientation button state
    updateOrientationButtonState(savedOrientation !== null);

    // Emit photo changed event
    getEventBus().emit(EventTypes.STREETVIEW_360_PHOTO_CHANGED, {
        previousPhoto: streetViewState.currentPhotoName,
        currentPhoto: photoName
    });
}

/**
 * Active AbortController for the current texture fetch.
 * Aborted when a new photo starts loading before the previous one finishes.
 */
let activeTextureAbort = null;

/**
 * Creates a Three.js texture from a fetched Blob.
 */
async function blobToTexture(blob) {
    const objectURL = URL.createObjectURL(blob);
    const texture = await new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(
            objectURL,
            (tex) => {
                URL.revokeObjectURL(objectURL);
                resolve(tex);
            },
            undefined,
            (error) => {
                URL.revokeObjectURL(objectURL);
                console.error('[street-view-viewer] TextureLoader failed:', error);
                reject(error instanceof Error ? error : new Error('TextureLoader failed to load image'));
            }
        );
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/**
 * Loads a texture for the panorama sphere with progressive loading.
 * When the API service is available, loads a low-res preview first
 * for instant feedback, then replaces it with the full-res image.
 * Cancels any in-flight fetch when a new load is requested.
 */
async function loadTexture(data) {
    // Cancel previous in-flight download
    if (activeTextureAbort) {
        activeTextureAbort.abort();
        activeTextureAbort = null;
    }

    const photoId = data.camera?.id || data.camera?.img;

    // Build cache keys
    const fullCacheKey = `full:${photoId}`;
    const previewCacheKey = `preview:${photoId}`;

    // Full-res cache hit — no network needed
    if (streetViewState.textureCache.has(fullCacheKey)) {
        const texture = streetViewState.textureCache.get(fullCacheKey);
        applyTexture(texture, data);
        return;
    }

    const controller = new AbortController();
    activeTextureAbort = controller;

    // Phase 1: Load preview for instant feedback
    try {
        if (streetViewState.textureCache.has(previewCacheKey)) {
            applyTexture(streetViewState.textureCache.get(previewCacheKey), data);
        } else {
            const { getPhotoImageUrl } = await import('./streetview-api.service.js');
            const previewUrl = getPhotoImageUrl(photoId, 'preview');
            const previewResponse = await fetch(previewUrl, { signal: controller.signal });
            if (activeTextureAbort !== controller) return;

            if (!previewResponse.ok) {
                console.warn(`[street-view-viewer] Preview fetch failed: HTTP ${previewResponse.status} for ${photoId}`);
            } else {
                const previewBlob = await previewResponse.blob();
                if (activeTextureAbort !== controller) return;

                const previewTexture = await blobToTexture(previewBlob);
                streetViewState.textureCache.set(previewCacheKey, previewTexture);

                if (activeTextureAbort === controller) {
                    applyTexture(previewTexture, data);
                }
            }
        }
    } catch (error) {
        // Preview is best-effort; continue to full-res load
        if (error.name === 'AbortError') return;
        console.warn('[street-view-viewer] Preview load failed (continuing to full-res):', error);
    }

    // Phase 2: Load full-resolution image
    try {
        const { getPhotoImageUrl } = await import('./streetview-api.service.js');
        const fullUrl = getPhotoImageUrl(photoId, 'full');

        const response = await fetch(fullUrl, { signal: controller.signal });

        if (!response.ok) {
            throw new Error(`Full-res fetch failed: HTTP ${response.status} for ${photoId}`);
        }

        const blob = await response.blob();

        if (activeTextureAbort !== controller) return;
        activeTextureAbort = null;

        const fullTexture = await blobToTexture(blob);
        streetViewState.textureCache.set(fullCacheKey, fullTexture);
        applyTexture(fullTexture, data);

        // Prefetch previews for navigation targets
        if (data.targets) {
            prefetchTargetPreviews(data.targets);
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (activeTextureAbort === controller) activeTextureAbort = null;
        console.error('[street-view-viewer] Full-res texture load failed:', error);
        throw error;
    }
}

/**
 * Prefetches preview textures for navigation targets in the background.
 * Uses low-priority fetch to avoid competing with the current photo load.
 */
async function prefetchTargetPreviews(targets) {
    const { getPhotoImageUrl } = await import('./streetview-api.service.js');

    for (const target of targets) {
        const targetId = target.id || target.img;
        if (!targetId) continue;

        const cacheKey = `preview:${targetId}`;
        if (streetViewState.textureCache.has(cacheKey)) continue;

        // Low-priority background fetch
        fetch(getPhotoImageUrl(targetId, 'preview'), { priority: 'low' })
            .then(r => r.blob())
            .then(blob => blobToTexture(blob))
            .then(tex => {
                // Only cache if not already cached (another navigation may have loaded it)
                if (!streetViewState.textureCache.has(cacheKey)) {
                    streetViewState.textureCache.set(cacheKey, tex);
                }
            })
            .catch((error) => {
                console.warn(`[street-view-viewer] Prefetch failed for target ${targetId}:`, error);
            });
    }
}

/**
 * Applies a texture to the panorama sphere.
 *
 * The equirectangular image center (U=0.5) already points at the camera heading.
 * After SphereGeometry.scale(-1,1,1), U=0.5 maps to -X in world space.
 * The camera looks at +X when lon=0.
 * A fixed 180° Y-rotation aligns U=0.5 from -X to +X.
 *
 * mesh_rotation_y from metadata can override this for non-standard stitching.
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
        streetViewState.mesh.rotation.order = 'ZXY';
        streetViewState.scene.add(streetViewState.mesh);
    }

    // Apply mesh rotation
    // Default: 180° aligns equirectangular center (heading direction) with camera +X
    // mesh_rotation_y in metadata can override for non-standard stitching pipelines
    const offsetRad = THREE.MathUtils.degToRad(getMeshRotationY(data));
    streetViewState.mesh.rotation.y = offsetRad;
    streetViewState.mesh.rotation.x = THREE.MathUtils.degToRad(getMeshRotationX(data));
    streetViewState.mesh.rotation.z = THREE.MathUtils.degToRad(getMeshRotationZ(data));

    // Force GPU texture upload now (outside the rAF loop).
    // Without this, the first render() inside the animation loop triggers a
    // synchronous VRAM upload of the high-res equirectangular image, causing
    // a long-frame violation in the requestAnimationFrame handler.
    const { renderer, scene, camera } = streetViewState;
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

/**
 * Sets camera orientation based on saved orientation or previous world heading.
 * Priority: savedOrientation > prevWorldHeading > default (lon=0, lat=0).
 * @param {Object} data - Photo metadata
 * @param {Object|null} savedOrientation - Optional saved orientation to apply
 * @param {number|null} prevWorldHeading - Previous world heading in degrees (for navigation continuity)
 */
function setCameraOrientation(data, savedOrientation = null, prevWorldHeading = null) {
    if (savedOrientation) {
        // Apply saved orientation
        lon = savedOrientation.lon;
        lat = savedOrientation.lat;
        if (savedOrientation.fov && streetViewState.camera) {
            streetViewState.camera.fov = savedOrientation.fov;
            streetViewState.camera.updateProjectionMatrix();
        }
    } else if (prevWorldHeading !== null) {
        // Preserve the viewing direction from the previous photo.
        // worldHeading = imageHeading + lon → lon = worldHeading - imageHeading
        const newImageHeading = data.camera?.heading ?? 0;
        lon = prevWorldHeading - newImageHeading;
        // Keep pitch level when navigating between photos
        lat = 0;
    } else {
        // First open: look at the original photo heading direction
        lon = 0;
        lat = 0;
    }
}

/**
 * Applies a target orientation to the camera.
 * Supports two modes:
 * - Direct: { lon, lat, fov } — values applied directly
 * - World heading: { worldHeading, pitch } — converted using current photo's image heading
 * @param {Object} orientation - Target orientation
 */
function applyTargetOrientation(orientation) {
    if (orientation.worldHeading !== undefined) {
        // Convert world heading to camera-relative lon
        const imageHeading = streetViewState.currentInfo?.camera?.heading ?? 0;
        lon = orientation.worldHeading - imageHeading;
    } else if (orientation.lon !== undefined) {
        lon = orientation.lon;
    }

    if (orientation.pitch !== undefined) {
        lat = orientation.pitch;
    } else if (orientation.lat !== undefined) {
        lat = orientation.lat;
    }

    if (orientation.fov && streetViewState.camera) {
        streetViewState.camera.fov = orientation.fov;
        streetViewState.camera.updateProjectionMatrix();
    }
}

// ===== PHOTO INFO OVERLAY =====

/**
 * Formats an ISO date string (YYYY-MM-DD) to Brazilian format (DD/MM/AAAA).
 * Returns the original string if parsing fails.
 * @param {string} isoDate - Date in ISO format
 * @returns {string} Formatted date
 */
function formatDateBR(isoDate) {
    const parts = isoDate.split('-');
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoDate;
}

/**
 * Updates the photo info overlay above the minimap with capture date.
 * @param {Object} data - Photo metadata from API
 */
function updatePhotoInfo(data) {
    const el = document.getElementById('streetview-photo-info');
    if (!el) return;

    const captureDate = data.captureDate;
    if (!captureDate) {
        el.style.display = 'none';
        return;
    }

    el.textContent = `Captura: ${formatDateBR(captureDate)}`;
    el.style.display = 'block';
}

/**
 * Hides the photo info overlay.
 */
function hidePhotoInfo() {
    const el = document.getElementById('streetview-photo-info');
    if (el) el.style.display = 'none';
}

// ===== MINIMAP =====

/**
 * Ensures the 'selected' layer exists on the minimap.
 * When opening via URL deep link, showPhotos() is never called
 * so the layer doesn't exist yet.
 */
function ensureSelectedLayer() {
    const miniMap = streetViewState.miniMap;
    if (!miniMap || miniMap.getLayer('selected')) return;

    // Need the source to be ready; it's added in setupMiniMapWithPMTiles
    const control = streetViewState.controlInstance;
    const sourceId = control?.streetViewPointsLayer?.['source'];
    if (!sourceId || !miniMap.getSource(sourceId)) return;

    // Need the icon image
    if (!miniMap.hasImage('point-selected')) return;

    const sourceLayer = control?.streetViewPointsLayer?.['source-layer']
        || config.streetView360?.pointsSourceLayer
        || 'fotos';

    miniMap.addLayer({
        'id': 'selected',
        'type': 'symbol',
        'source': sourceId,
        'source-layer': sourceLayer,
        'filter': ['==', PHOTO_PROPERTY, ''],
        'layout': {
            'icon-image': 'point-selected',
            'icon-allow-overlap': true
        }
    });
}

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

    // Ensure the 'selected' layer exists (deep link scenario)
    ensureSelectedLayer();

    // Update selected photo filter
    if (streetViewState.miniMap.getLayer('selected')) {
        streetViewState.miniMap.setFilter('selected', ['==', PHOTO_PROPERTY, streetViewState.currentPhotoName]);
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

// Reusable Vector3 for lookAt target (avoids allocation in render loop)
const _lookAtTarget = new THREE.Vector3();

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

function onDocumentMouseWheel(event) {
    if (!streetViewState.isVisible) return;

    // Don't change 360 FOV when scrolling over the minimap
    const miniMapEl = document.getElementById('mini-map-street-view');
    if (miniMapEl && miniMapEl.contains(event.target)) return;

    const fov = streetViewState.camera.fov + event.deltaY * 0.05;
    streetViewState.camera.fov = THREE.MathUtils.clamp(fov, 10, 75);
    streetViewState.camera.updateProjectionMatrix();
}

// ===== PINCH-TO-ZOOM (TOUCH) =====

let pinchStartDistance = 0;
let pinchStartFov = 75;

function onTouchStart(event) {
    if (event.touches.length === 2) {
        // Start pinch — record initial distance and FOV
        const dx = event.touches[1].clientX - event.touches[0].clientX;
        const dy = event.touches[1].clientY - event.touches[0].clientY;
        pinchStartDistance = Math.hypot(dx, dy);
        pinchStartFov = streetViewState.camera.fov;

        // Disable single-pointer drag while pinching
        isUserInteracting = false;
    }
}

function onTouchMove(event) {
    if (event.touches.length === 2 && pinchStartDistance > 0) {
        const dx = event.touches[1].clientX - event.touches[0].clientX;
        const dy = event.touches[1].clientY - event.touches[0].clientY;
        const currentDistance = Math.hypot(dx, dy);

        // Ratio > 1 means fingers spread apart (zoom in = lower FOV)
        const ratio = pinchStartDistance / currentDistance;
        const newFov = pinchStartFov * ratio;
        streetViewState.camera.fov = THREE.MathUtils.clamp(newFov, 10, 75);
        streetViewState.camera.updateProjectionMatrix();
    }
}

function onTouchEnd(event) {
    if (event.touches.length < 2) {
        pinchStartDistance = 0;
    }
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

    // Calculate look-at target on sphere (reuses pre-allocated Vector3)
    _lookAtTarget.set(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
    );

    streetViewState.camera.lookAt(_lookAtTarget);
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
    const minimapWrapper = document.getElementById('streetview-minimap-wrapper');
    const streetViewContainer = document.getElementById('street-view-container');
    const closeBtn = document.getElementById('close-street-view-button');

    if (mapSig) mapSig.style.display = full ? 'block' : 'none';
    if (minimapWrapper) minimapWrapper.style.display = full ? 'none' : 'block';
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
 * Handles share button click: builds a deep link URL and copies to clipboard.
 */
async function handleShare360Click(e) {
    e.stopPropagation();

    const photoName = streetViewState.currentPhotoName;
    if (!photoName) return;

    const { buildShareUrl360, copyShareUrl } = await import(
        '../deep-link/deep-link.js'
    );
    const url = buildShareUrl360(photoName, lon, lat, streetViewState.camera?.fov || 75);
    await copyShareUrl(url);
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
    } catch (error) {
        console.warn('[street-view-viewer] Tool module not loaded during deactivation:', error);
    }
}

// ===== PUBLIC API =====

/**
 * Opens the 360 viewer with a specific photo
 * @param {string} photoName - Name of the photo to display
 * @param {Object} options - Options including miniMap reference, controlInstance, and targetOrientation
 * @param {Object} [options.targetOrientation] - Optional orientation to apply after loading (e.g., {lon, lat, fov})
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

    // Trigger minimap resize after container becomes visible
    // MapLibre can't calculate dimensions correctly when container is hidden
    if (streetViewState.miniMap) {
        streetViewState.miniMap.resize();
    }

    // === CRITICAL SETUP: must run regardless of photo load success ===
    // Add close button listener BEFORE awaiting anything that can fail
    const closeBtn = document.getElementById('close-street-view-button');
    if (closeBtn) {
        // Remove any existing listener first to avoid duplicates
        closeBtn.removeEventListener('click', closeViewer360);
        closeBtn.addEventListener('click', closeViewer360);
    }

    // Activate keyboard service
    try {
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
                const chip = document.getElementById('active-tool-chip-360');
                return chip && chip.style.display !== 'none';
            }
        });

        activateKeyboardService360();
    } catch (error) {
        console.warn('Could not activate keyboard service:', error);
    }

    // Initialize share button
    const shareBtn360 = document.getElementById('share-360');
    if (shareBtn360) {
        shareBtn360.removeEventListener('click', handleShare360Click);
        shareBtn360.addEventListener('click', handleShare360Click);
    }

    // Register event listeners for 360 features
    const eventBus = getEventBus();

    eventBus.off(EventTypes.MARKER_360_POSITION_CLICKED, handleMarkerPositionClicked);
    eventBus.on(EventTypes.MARKER_360_POSITION_CLICKED, handleMarkerPositionClicked);

    eventBus.off(EventTypes.MARKERS_360_CHANGED, loadMarkersForCurrentPhoto);
    eventBus.on(EventTypes.MARKERS_360_CHANGED, loadMarkersForCurrentPhoto);

    eventBus.off(EventTypes.LAYERS_CHANGED, handleLayersChanged);
    eventBus.on(EventTypes.LAYERS_CHANGED, handleLayersChanged);

    // Mark as visible BEFORE init/load so closeViewer360 can always work.
    // resumeRendering() also sets this, but we need it as early as possible
    // to guarantee the close button is functional even if loading fails.
    streetViewState.isVisible = true;

    // === END CRITICAL SETUP ===

    // Initialize or resume viewer (after container is visible)
    // Wrapped in try-catch so that failures don't prevent the viewer from
    // being closeable or the UI from being functional
    try {
        if (streetViewState.scene && streetViewState.isPaused) {
            // Resume existing viewer
            await loadPhoto(photoName);
            resumeRendering();
            // Sync renderer/navigator canvas with current container size
            // (container may be narrower due to briefing panel)
            onWindowResize();
        } else if (!streetViewState.scene) {
            // Wait one frame so the browser can reflow after setFullMap(false).
            // Without this, container.clientWidth/clientHeight may still be 0
            // because style changes haven't been laid out yet (microtasks from
            // await import() don't trigger reflow). This causes the renderer
            // and navigator canvas to initialize at 0×0 → black screen.
            await new Promise(resolve => requestAnimationFrame(resolve));

            // Initialize new viewer (now container has correct dimensions)
            await initThreeJS();
            await loadPhoto(photoName);
            resumeRendering();
            // Safety net: re-sync dimensions after everything is initialized
            onWindowResize();
        } else {
            // Viewer exists and is active, just load new photo
            await loadPhoto(photoName);
        }
    } catch (error) {
        console.error('[street-view-viewer] Failed to initialize/load photo:', error);
        // Even if photo loading fails, ensure the animation loop is running
        // so the viewer isn't stuck in an unrecoverable black screen state
        if (streetViewState.scene && !streetViewState.animationId) {
            resumeRendering();
        }
    }

    // Apply target orientation override (e.g., when opening from layer tab to face a marker)
    if (options.targetOrientation) {
        applyTargetOrientation(options.targetOrientation);
    }

    // Load markers for the photo
    await loadMarkersForCurrentPhoto();

    // If minimap 'selected' layer wasn't ready during loadPhoto (deep link scenario),
    // retry once the minimap finishes loading its sources/images
    if (streetViewState.miniMap && !streetViewState.miniMap.getLayer('selected')) {
        const retryOnLoad = () => {
            ensureSelectedLayer();
            if (streetViewState.currentInfo?.camera) {
                updateMiniMap(streetViewState.currentInfo.camera);
            }
        };
        // sourcedata fires when vector tiles arrive; retry until layer is created
        const onSourceData = () => {
            retryOnLoad();
            if (streetViewState.miniMap.getLayer('selected')) {
                streetViewState.miniMap.off('sourcedata', onSourceData);
            }
        };
        streetViewState.miniMap.on('sourcedata', onSourceData);
        // Also try on idle (when map is fully done)
        streetViewState.miniMap.once('idle', retryOnLoad);
    }

    // Emit event
    eventBus.emit(EventTypes.STREETVIEW_360_OPENED, { photoName });
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

    // Remove share button listener
    const shareBtn360 = document.getElementById('share-360');
    if (shareBtn360) {
        shareBtn360.removeEventListener('click', handleShare360Click);
    }

    // Update UI
    setFullMap(true);
    document.body.classList.remove('streetview-active');
    hideToolbar360();
    hidePhotoInfo();

    // Deactivate keyboard service
    try {
        deactivateKeyboardService360();
    } catch (error) {
        console.warn('Could not deactivate keyboard service:', error);
    }

    // Remove event listeners
    const eventBus = getEventBus();
    eventBus.off(EventTypes.MARKER_360_POSITION_CLICKED, handleMarkerPositionClicked);
    eventBus.off(EventTypes.MARKERS_360_CHANGED, loadMarkersForCurrentPhoto);
    eventBus.off(EventTypes.LAYERS_CHANGED, handleLayersChanged);

    // Emit event
    eventBus.emit(EventTypes.STREETVIEW_360_CLOSED, {});
}

/**
 * Navigates to a target photo
 * @param {string} targetName - Name of the target photo
 * @param {Function|Object} callbackOrOptions - Optional callback after navigation, or options object
 * @param {Object} [callbackOrOptions.targetOrientation] - Orientation to apply after loading
 */
export async function navigateToTarget(targetName, callbackOrOptions = () => {}) {
    // Support both callback and options signatures
    let callback = () => {};
    let targetOrientation = null;
    if (typeof callbackOrOptions === 'function') {
        callback = callbackOrOptions;
    } else if (callbackOrOptions && typeof callbackOrOptions === 'object') {
        callback = callbackOrOptions.callback || (() => {});
        targetOrientation = callbackOrOptions.targetOrientation || null;
    }

    // Deselect current POI
    if (streetViewState.navigator) {
        streetViewState.navigator.deselectPOI();
    }

    // Capture current viewing direction before loading new photo.
    // The user's world heading = imageHeading + lon.
    // After loading, we compute the new lon so the world heading is preserved.
    const prevImageHeading = streetViewState.currentInfo?.camera?.heading ?? 0;
    const prevWorldHeading = prevImageHeading + lon;

    // Load the new photo directly
    await loadPhoto(targetName, prevWorldHeading);

    // Apply target orientation override (takes priority over preserved heading)
    if (targetOrientation) {
        applyTargetOrientation(targetOrientation);
    }

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

    // Remove window resize listener
    window.removeEventListener('resize', onWindowResize);

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

    // Clean renderer and container listeners
    if (streetViewState.renderer) {
        const container = document.getElementById('street-view-container');
        if (container) {
            container.removeEventListener('pointerdown', onPointerDown);
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);

            if (streetViewState.renderer.domElement.parentNode === container) {
                container.removeChild(streetViewState.renderer.domElement);
            }
        }
        streetViewState.renderer.dispose();
        streetViewState.renderer = null;
    }

    // Clean cached resources
    if (streetViewState.sphereGeometry) {
        streetViewState.sphereGeometry.dispose();
        streetViewState.sphereGeometry = null;
    }

    // Clean texture cache (LRU cache calls dispose callback automatically)
    streetViewState.textureCache.clear();

    // Clear metadata cache
    streetViewState.metadataCache.clear();

    // Reinitialize caches for potential reuse
    streetViewState.textureCache = new LRUCache(TEXTURE_CACHE_MAX_SIZE, (texture) => {
        if (texture && texture.dispose) {
            texture.dispose();
        }
    });
    streetViewState.metadataCache = new LRUCache(METADATA_CACHE_MAX_SIZE);

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

/**
 * Gets the geographic coordinates of the current photo from metadata.
 * Used by briefing system to store the flyTo target for 360 slides.
 * @returns {Promise<{longitude: number, latitude: number}|null>}
 */
export async function getCurrentPhotoGeoPosition() {
    const name = streetViewState.currentPhotoName;
    if (!name) return null;

    try {
        const metadata = await loadMetadataWithCache(name);
        if (metadata?.camera?.lon != null && metadata?.camera?.lat != null) {
            return { longitude: metadata.camera.lon, latitude: metadata.camera.lat };
        }
    } catch (error) {
        console.warn('Failed to get photo geo position:', error);
    }
    return null;
}

/**
 * Sets the camera rotation (lon/lat in degrees).
 * The render loop will apply this on the next frame.
 * @param {number} newLon - Horizontal rotation in degrees
 * @param {number} newLat - Vertical rotation in degrees
 */
export function setCameraRotation(newLon, newLat) {
    lon = newLon;
    lat = THREE.MathUtils.clamp(newLat, -85, 85);
}

/**
 * Sets the camera FOV (field of view).
 * @param {number} fov - FOV in degrees (clamped 10-75)
 */
export function setCameraFOV(fov) {
    if (!streetViewState.camera) return;
    streetViewState.camera.fov = THREE.MathUtils.clamp(fov, 10, 75);
    streetViewState.camera.updateProjectionMatrix();
}

// Export for external access
export { streetViewState };

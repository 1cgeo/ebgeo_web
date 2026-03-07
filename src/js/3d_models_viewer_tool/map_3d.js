// Path: js/3d_models_viewer_tool/map_3d.js
import config from '@js/config.js';
import {
    saveCameraPosition,
    getCameraPosition,
    hasSavedCameraPosition,
    clearCameraPosition,
    isCurrentMapLockedSync
} from '@store/index.js';
import { showSuccess } from '@utils/index.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import {
    setKeyboardCallbacks3D,
    activateKeyboardService3D,
    deactivateKeyboardService3D,
    confirmAndDelete3DFeature
} from './services/keyboard-service-3d.js';
import {
    applyCesiumPreLoadPatches,
    applyCesiumPostLoadPatches
} from './services/cesium-compat.js';
import { hideLoading3DScreen } from '@ui/loading-screen-3d.js';

// ===== GLOBAL STATE MANAGEMENT =====
let cesiumState = {
    isLoaded: false,
    isVisible: false,
    isPaused: false,
    loadPromise: null,
    viewer: null,
    loadedTilesets: {},
    resizeObserver: null,
    modules: {},
    currentTilesetId: null,  // Track currently active tileset
    screenSpaceHandler: null  // Track ScreenSpaceEventHandler for cleanup
};

// Track if navigation help has been initialized
let navHelpInitialized = false;

// Store event handler references for cleanup
const navHelpHandlers = {
    documentClick: null,
    documentKeydown: null
};

// ===== LAZY LOADING =====
function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

/**
 * Loads Cesium library and initializes the 3D map
 * Disables Cesium Ion completely to use only local resources
 * @returns {Promise} Promise that resolves when Cesium is loaded and initialized
 */
async function loadCesiumAndInit() {
    if (cesiumState.loadPromise) {
        return cesiumState.loadPromise;
    }

    cesiumState.loadPromise = (async () => {
        try {
            await loadScript('./vendors/cesium/Cesium.js');
            await waitForGlobal('Cesium', 5000);

            // Disable Cesium Ion to use only local resources
            if (Cesium.Ion) {
                Cesium.Ion.defaultAccessToken = undefined;
                if (Cesium.Ion.defaultServer) {
                    Cesium.Ion.defaultServer = new Cesium.Resource({ url: 'about:blank' });
                }
            }

            if (Cesium.RequestScheduler) {
                const originalRequest = Cesium.RequestScheduler.request;
                Cesium.RequestScheduler.request = function (...args) {
                    const request = args[0];
                    if (request.url && request.url.includes('api.cesium.com')) {
                        console.warn('Blocked Ion request:', request.url);
                        return Promise.reject(new Error('Ion requests are disabled'));
                    }
                    return originalRequest.apply(this, args);
                };
            }

            // Compatibility patches for cesium-viewshed/cesium-measure (built for ~1.100)
            applyCesiumPreLoadPatches(Cesium);

            await Promise.all([
                loadScript('./vendors/cesium/cesium-measure.js'),
                loadScript('./vendors/cesium/cesium-viewshed.js')
            ]);

            applyCesiumPostLoadPatches(Cesium);

            await initCesiumMap();

            cesiumState.isLoaded = true;

        } catch (error) {
            console.error('Error loading Cesium:', error);
            cesiumState.loadPromise = null;
            throw error;
        }
    })();

    return cesiumState.loadPromise;
}

function waitForGlobal(globalName, timeout = 5000) {
    return new Promise((resolve, reject) => {
        if (window[globalName]) {
            resolve();
            return;
        }

        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window[globalName]) {
                clearInterval(checkInterval);
                resolve();
            } else if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                reject(new Error(`Global ${globalName} not available after ${timeout}ms`));
            }
        }, 100);
    });
}

async function initCesiumMap() {
    const { bounds } = config.map3d;
    const extent = new Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
    Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

    const terrainProviderConfig = config.createTerrainProvider();
    const imageryProviderConfig = config.createImageryProvider();

    // Cesium 1.107+ uses async fromUrl() for terrain providers
    let terrainProvider;
    try {
        if (terrainProviderConfig.provider === 'CesiumTerrainProvider') {
            terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(
                terrainProviderConfig.url,
                {
                    requestVertexNormals: terrainProviderConfig.requestVertexNormals || false,
                    requestWaterMask: false,
                    requestMetadata: false
                }
            );
        } else {
            terrainProvider = new Cesium.EllipsoidTerrainProvider();
        }
    } catch (error) {
        console.warn('Error creating terrain provider, using ellipsoid:', error);
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }

    // Cesium 1.107+ uses baseLayer instead of imageryProvider
    let baseLayer = false;
    if (imageryProviderConfig) {
        try {
            let imageryProvider;
            switch (imageryProviderConfig.provider) {
                case 'UrlTemplateImageryProvider':
                    imageryProvider = new Cesium.UrlTemplateImageryProvider({
                        url: imageryProviderConfig.url,
                        maximumLevel: imageryProviderConfig.maximumLevel || 18,
                        minimumLevel: imageryProviderConfig.minimumLevel || 0,
                        tileWidth: imageryProviderConfig.tileWidth || 256,
                        tileHeight: imageryProviderConfig.tileHeight || 256
                    });
                    break;
                case 'WebMapServiceImageryProvider':
                    imageryProvider = new Cesium.WebMapServiceImageryProvider({
                        url: imageryProviderConfig.url,
                        layers: imageryProviderConfig.layers
                    });
                    break;
                case 'SingleTileImageryProvider':
                    imageryProvider = new Cesium.SingleTileImageryProvider({
                        url: imageryProviderConfig.url
                    });
                    break;
            }
            if (imageryProvider) {
                baseLayer = new Cesium.ImageryLayer(imageryProvider);
            }
        } catch (error) {
            console.warn('Error creating imagery provider:', error);
            baseLayer = false;
        }
    }

    const viewer = new Cesium.Viewer("map-3d", {
        ...config.map3d.viewer,
        terrainProvider: terrainProvider,
        baseLayer: baseLayer,
        contextOptions: {
            webgl: {
                preserveDrawingBuffer: true,
                powerPreference: "default"
            }
        },
    });

    if (!baseLayer) {
        viewer.imageryLayers.removeAll();
    }

    viewer.terrainProvider = terrainProvider;

    const scene = viewer.scene;
    scene.globe.baseColor = Cesium.Color.BLACK;
    viewer.bottomContainer.style.display = "none";

    // Custom camera controls matching navigation help:
    // Left drag = orbit/pan, Right drag = rotate/tilt, Wheel = zoom, Middle drag = tilt
    // In 3D mode: rotateEventTypes = orbit around globe ("mover visão")
    // tiltEventTypes = change camera pitch ("inclinar/rotacionar visão")
    const controller = scene.screenSpaceCameraController;
    controller.rotateEventTypes = Cesium.CameraEventType.LEFT_DRAG;
    controller.tiltEventTypes = [
        Cesium.CameraEventType.RIGHT_DRAG,
        Cesium.CameraEventType.MIDDLE_DRAG,
        Cesium.CameraEventType.PINCH,
    ];
    controller.zoomEventTypes = [
        Cesium.CameraEventType.WHEEL,
        Cesium.CameraEventType.PINCH,
    ];
    controller.lookEventTypes = {
        eventType: Cesium.CameraEventType.LEFT_DRAG,
        modifier: Cesium.KeyboardEventModifier.SHIFT,
    };

    cesiumState.viewer = viewer;

    await loadTilesets(viewer);
    await setupTools(viewer);

    return viewer;
}

async function loadTilesets(viewer) {
    for (const tilesetConfig of config.tilesets) {
        try {
            const isGlb = tilesetConfig.type === 'glb';
            const primitive = isGlb
                ? await createGlbModel(viewer, tilesetConfig)
                : await createOptimizedTileset(viewer, tilesetConfig);

            cesiumState.loadedTilesets[tilesetConfig.id.toLowerCase()] = {
                tileset: primitive,
                location: tilesetConfig.locate
            };
        } catch (error) {
            console.warn(`Failed to load ${tilesetConfig.type || '3dtiles'} ${tilesetConfig.id}:`, error);
        }
    }
}

async function createOptimizedTileset(viewer, tilesetConfig) {
    // Cesium 1.107+ uses fromUrl() instead of constructor + readyPromise
    const tileset = await Cesium.Cesium3DTileset.fromUrl(tilesetConfig.url, {
        maximumScreenSpaceError: tilesetConfig.maximumScreenSpaceError ?? 16,
        preferLeaves: false,
        skipLevelOfDetail: true,
        baseScreenSpaceError: 1024,
        skipScreenSpaceErrorFactor: 16,
        skipLevels: 1,
        cacheBytes: 1073741824,
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorDensity: 0.00278,
        dynamicScreenSpaceErrorFactor: 2.0,
        dynamicScreenSpaceErrorHeightFalloff: 0.25,
        cullWithChildrenBounds: true,
        cullRequestsWhileMoving: true,
        cullRequestsWhileMovingMultiplier: 60.0,
        foveatedScreenSpaceError: true,
    });

    viewer.scene.primitives.add(tileset);

    const heightOffset = tilesetConfig.heightOffset;
    const boundingSphere = tileset.boundingSphere;
    const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
    const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0.0);
    const offset = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, heightOffset);
    const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);

    if (tilesetConfig.default) {
        const { lat, lon, height } = tilesetConfig.locate;
        const destination = Cesium.Cartesian3.fromDegrees(lon, lat, height);
        viewer.camera.setView({ destination });
    }

    return tileset;
}

/**
 * Creates and loads a GLB model into the Cesium scene.
 * @param {Object} viewer - The Cesium viewer
 * @param {Object} tilesetConfig - Model configuration from config.tilesets (type: 'glb')
 * @returns {Promise<Object>} The loaded model primitive
 */
async function createGlbModel(viewer, tilesetConfig) {
    const { lon, lat } = tilesetConfig.position;
    const heightOffset = tilesetConfig.heightOffset || 0;
    const { heading = 0, pitch = 0, roll = 0 } = tilesetConfig.rotation || {};
    const scale = tilesetConfig.scale || 1.0;

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, heightOffset);
    const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(heading),
        Cesium.Math.toRadians(pitch),
        Cesium.Math.toRadians(roll)
    );
    const modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr);

    if (scale !== 1.0) {
        Cesium.Matrix4.multiplyByUniformScale(modelMatrix, scale, modelMatrix);
    }

    const modelOptions = {
        url: tilesetConfig.url,
        modelMatrix,
        minimumPixelSize: tilesetConfig.minimumPixelSize ?? 0,
        allowPicking: true,
    };
    if (tilesetConfig.maximumScale !== undefined) {
        modelOptions.maximumScale = tilesetConfig.maximumScale;
    }

    const model = await Cesium.Model.fromGltfAsync(modelOptions);
    viewer.scene.primitives.add(model);

    return model;
}

async function setupTools(viewer) {
    window.map = viewer;

    const measure = new Cesium.Measure(viewer);
    window.measure = measure;

    initCesiumEventHandlers();

    try {
        const mouseCoordModule = await import('./tools/mouse_coordinates_3d.js');
        cesiumState.modules.mouseCoordinates = mouseCoordModule;

        const screenshotModule = await import('./tools/screenshot_tool.js');
        cesiumState.modules.screenshot = screenshotModule;

        const markerModule = await import('./tools/marker_tool_3d.js');
        cesiumState.modules.markers = markerModule;

        // Initialize marker tool event listeners for map change detection
        if (markerModule.initMarkerToolListeners) {
            markerModule.initMarkerToolListeners();
        }

        // Load new measurement tool
        const measurementModule = await import('./tools/measurement_tool_3d.js');
        cesiumState.modules.measurements = measurementModule;

        if (measurementModule.initMeasurementToolListeners) {
            measurementModule.initMeasurementToolListeners();
        }

        // Load new viewshed tool
        const viewshedToolModule = await import('./tools/viewshed_tool_3d.js');
        cesiumState.modules.viewshedTool = viewshedToolModule;

        if (viewshedToolModule.initViewshedToolListeners) {
            viewshedToolModule.initViewshedToolListeners();
        }

    } catch (error) {
        console.warn('Some 3D modules failed to load:', error);
    }
}

// ===== PERFORMANCE MANAGEMENT =====

/**
 * Pauses 3D rendering to save resources when viewer is not visible
 * Disables camera controls and hides primitives
 */
function pauseRendering() {
    if (!cesiumState.viewer || cesiumState.isPaused) return;

    cesiumState.isPaused = true;
    cesiumState.isVisible = false;

    // Remove class from body for sidebar visibility
    document.body.classList.remove('cesium-active');

    const scene = cesiumState.viewer.scene;

    scene.requestRenderMode = true;
    scene.primitives.show = false;
    scene.groundPrimitives.show = false;
    cesiumState.viewer.clock.shouldAnimate = false;
    scene.screenSpaceCameraController.enableInputs = false;
}

/**
 * Resumes 3D rendering when viewer becomes visible again
 * Re-enables camera controls and shows primitives
 */
function resumeRendering() {
    if (!cesiumState.viewer) return;

    // Always add class to body for sidebar visibility (even on first open)
    document.body.classList.add('cesium-active');

    // If not paused, just ensure visibility state is correct
    if (!cesiumState.isPaused) {
        cesiumState.isVisible = true;
        return;
    }

    cesiumState.isPaused = false;
    cesiumState.isVisible = true;

    const scene = cesiumState.viewer.scene;

    scene.requestRenderMode = false;
    scene.primitives.show = true;
    scene.groundPrimitives.show = true;
    cesiumState.viewer.clock.shouldAnimate = true;
    scene.screenSpaceCameraController.enableInputs = true;
    scene.requestRender();
}

// ===== MEMORY CLEANUP =====

/**
 * Cleans up all 3D features and destroys the Cesium viewer
 * Removes all tilesets, entities, and event listeners to prevent memory leaks
 */
export function cleanup3DFeatures() {
    try {
        if (cesiumState.modules.viewshedTool) {
            cesiumState.modules.viewshedTool.clearAllViewField();
        }

        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.cleanupMouseCoordinates3D();
        }

        // Cleanup marker tool
        if (cesiumState.modules.markers && cesiumState.modules.markers.cleanupMarkerTool) {
            cesiumState.modules.markers.cleanupMarkerTool();
        }

        // Cleanup measurement tool
        if (cesiumState.modules.measurements && cesiumState.modules.measurements.cleanupMeasurementTool) {
            cesiumState.modules.measurements.cleanupMeasurementTool();
        }

        // Cleanup viewshed tool
        if (cesiumState.modules.viewshedTool && cesiumState.modules.viewshedTool.cleanupViewshedTool) {
            cesiumState.modules.viewshedTool.cleanupViewshedTool();
        }
    } catch (error) {
        console.warn('Error cleaning modules:', error);
    }

    // Cleanup ScreenSpaceEventHandler
    if (cesiumState.screenSpaceHandler) {
        cesiumState.screenSpaceHandler.destroy();
        cesiumState.screenSpaceHandler = null;
    }

    if (cesiumState.viewer && !cesiumState.viewer.isDestroyed()) {
        const scene = cesiumState.viewer.scene;

        Object.values(cesiumState.loadedTilesets).forEach(({ tileset }) => {
            if (tileset && !tileset.isDestroyed()) {
                scene.primitives.remove(tileset);
            }
        });

        cesiumState.viewer.entities.removeAll();
        cesiumState.viewer.dataSources.removeAll();
        scene.primitives.removeAll();
        scene.groundPrimitives.removeAll();
        cesiumState.viewer.destroy();
    }

    if (cesiumState.resizeObserver) {
        cesiumState.resizeObserver.disconnect();
        cesiumState.resizeObserver = null;
    }

    // Cleanup navigation help document listeners to prevent memory leaks
    if (navHelpHandlers.documentClick) {
        document.removeEventListener('click', navHelpHandlers.documentClick);
        navHelpHandlers.documentClick = null;
    }
    if (navHelpHandlers.documentKeydown) {
        document.removeEventListener('keydown', navHelpHandlers.documentKeydown);
        navHelpHandlers.documentKeydown = null;
    }
    navHelpInitialized = false;

    cesiumState = {
        isLoaded: false,
        isVisible: false,
        isPaused: false,
        loadPromise: null,
        viewer: null,
        loadedTilesets: {},
        resizeObserver: null,
        modules: {},
        currentTilesetId: null,
        screenSpaceHandler: null
    };

    window.map = null;
    window.measure = null;
}

// ===== TOOLS INITIALIZATION =====

/**
 * Initializes 3D tools (mouse coordinates, etc.)
 */
function init3DFeatures() {
    if (!cesiumState.viewer) return;

    try {
        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.initMouseCoordinates3D(cesiumState.viewer);
        }
    } catch (error) {
        console.warn('Error initializing 3D tools:', error);
    }
}

// Track currently active tool
let activeToolId = null;

// Tool display names for the active chip
const TOOL_NAMES_3D = {
    'visualizacao': 'Análise de Visibilidade',
    'distancia': 'Medir Distância',
    'area': 'Medir Área',
    'add-marker-3d': 'Adicionar Marcador'
};

function activeTool() {
    const toolId = this.id;
    if (!toolId || !cesiumState.viewer) return;

    // Skip help button - handled separately
    if (toolId === 'help-3d') return;

    // Block tool activation when map is locked
    if (isCurrentMapLockedSync()) return;

    // Skip non-toggleable tools and camera buttons (handled separately)
    const nonToggleable = ['salvar-camera', 'limpar-camera', 'share-3d'];

    if (nonToggleable.includes(toolId)) {
        // Camera buttons have their own handlers
        return;
    }

    // Toggle logic for toggleable tools
    const isCurrentlyActive = this.classList.contains('active');

    if (isCurrentlyActive) {
        // Deactivate current tool
        this.classList.remove('active');
        activeToolId = null;
        deactivateAllActiveTools();
        hideActiveToolChip3D();
        return;
    }

    // Deactivate all other tools first
    deactivateAllToolButtons();
    deactivateAllActiveTools();

    // Activate this tool
    this.classList.add('active');
    activeToolId = toolId;
    showActiveToolChip3D(toolId);

    switch (toolId) {
        case 'distancia':
            if (cesiumState.modules.measurements && _currentTilesetId) {
                cesiumState.modules.measurements.activateMeasurementTool(
                    cesiumState.viewer, _currentTilesetId, 'distance'
                );
            }
            break;
        case 'area':
            if (cesiumState.modules.measurements && _currentTilesetId) {
                cesiumState.modules.measurements.activateMeasurementTool(
                    cesiumState.viewer, _currentTilesetId, 'area'
                );
            }
            break;
        case 'visualizacao':
            if (cesiumState.modules.viewshedTool && _currentTilesetId) {
                cesiumState.modules.viewshedTool.activateViewshedTool(
                    cesiumState.viewer, _currentTilesetId
                );
            }
            break;
        case 'add-marker-3d':
            if (cesiumState.modules.markers && _currentTilesetId) {
                cesiumState.modules.markers.activateMarkerTool(cesiumState.viewer, _currentTilesetId);
            }
            break;
    }
}

function showActiveToolChip3D(toolId) {
    const chip = document.getElementById('active-tool-chip-3d');
    const nameSpan = document.getElementById('active-tool-chip-3d-name');

    if (!chip || !nameSpan) return;

    nameSpan.textContent = TOOL_NAMES_3D[toolId] || toolId;
    chip.style.display = 'block';

    // Trigger animation
    requestAnimationFrame(() => {
        chip.classList.add('visible');
    });
}

function hideActiveToolChip3D() {
    const chip = document.getElementById('active-tool-chip-3d');
    if (!chip) return;

    chip.classList.remove('visible');

    // Hide after animation
    setTimeout(() => {
        if (!chip.classList.contains('visible')) {
            chip.style.display = 'none';
        }
    }, 200);
}

function deactivateAllToolButtons() {
    const buttons = document.querySelectorAll('#toolbar-3d .button-tool-3d');
    buttons.forEach(btn => btn.classList.remove('active'));
}

function handleClickGoTo() {
    const targetId = this.id;
    if (!targetId || !cesiumState.viewer) return;

    removeAllTools();

    const tilesetData = cesiumState.loadedTilesets[targetId];
    if (tilesetData) {
        const { location } = tilesetData;
        cesiumState.viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                location.lon,
                location.lat,
                location.height
            ),
            duration: 2.0
        });
    }
}

// ===== UTILITIES =====

/**
 * Deactivates all active tools without removing persisted features.
 */
function deactivateAllActiveTools() {
    try {
        // Deactivate measurement tool
        if (cesiumState.modules.measurements) {
            cesiumState.modules.measurements.deactivateMeasurementTool();
        }

        // Deactivate viewshed tool
        if (cesiumState.modules.viewshedTool) {
            cesiumState.modules.viewshedTool.deactivateViewshedTool();
        }

        // Deactivate marker tool
        if (cesiumState.modules.markers) {
            cesiumState.modules.markers.deactivateMarkerTool();
        }

        // Clear any measure library state (for ephemeral drawing)
        if (window.measure) {
            if (window.measure.removeDrawLineMeasureGraphics) {
                window.measure.removeDrawLineMeasureGraphics();
            }
            if (window.measure.removeDrawAreaMeasureGraphics) {
                window.measure.removeDrawAreaMeasureGraphics();
            }
        }

    } catch (error) {
        console.warn('Error deactivating tools:', error);
    }
}

/**
 * Legacy function - now just deactivates tools.
 * @deprecated Use deactivateAllActiveTools instead
 */
function removeAllTools() {
    deactivateAllActiveTools();
}

/**
 * Takes a screenshot of the 3D viewer.
 * @returns {Promise<boolean>} True if screenshot was taken successfully
 */
export async function take3DScreenshot() {
    if (!cesiumState.isVisible || !cesiumState.viewer) {
        console.warn('3D viewer is not open');
        return false;
    }

    if (cesiumState.modules.screenshot) {
        const success = await cesiumState.modules.screenshot.takeScreenshot(cesiumState.viewer);
        return success;
    }

    return false;
}

// ===== EVENT HANDLERS =====
document.querySelectorAll('#locate-3d-container button').forEach(btn => {
    btn.addEventListener('click', handleClickGoTo);
});

function initCesiumEventHandlers() {
    if (typeof Cesium !== 'undefined' && cesiumState.viewer) {
        // Clean up existing handler if any
        if (cesiumState.screenSpaceHandler) {
            cesiumState.screenSpaceHandler.destroy();
            cesiumState.screenSpaceHandler = null;
        }

        const handler = new Cesium.ScreenSpaceEventHandler(cesiumState.viewer.canvas);
        handler.setInputAction(function () {
            // Placeholder for future click handling on 3D scene
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Store handler for later cleanup
        cesiumState.screenSpaceHandler = handler;
        return handler;
    }
    return null;
}

// ===== 3D MODELS VIEWER =====

let currentTileset = null;
let _currentTilesetId = null;

// ===== CAMERA POSITION FUNCTIONS =====

/**
 * Saves the current camera position for the active tileset.
 * @returns {Promise<boolean>} True if position was saved
 */
export async function saveCurrentCameraPosition() {
    if (!cesiumState.viewer || !_currentTilesetId) {
        console.warn('Cannot save camera: no viewer or tileset');
        return false;
    }

    const camera = cesiumState.viewer.camera;
    const cartographic = camera.positionCartographic;

    const position = {
        longitude: Cesium.Math.toDegrees(cartographic.longitude),
        latitude: Cesium.Math.toDegrees(cartographic.latitude),
        height: cartographic.height
    };

    const orientation = {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll
    };

    await saveCameraPosition(_currentTilesetId, position, orientation);
    updateCameraButtonState(true);
    return true;
}

/**
 * Restores saved camera position for a tileset.
 * @param {string} tilesetId - Tileset ID
 * @returns {Promise<boolean>} True if position was restored
 */
async function restoreCameraPosition(tilesetId) {
    const savedPosition = await getCameraPosition(tilesetId);

    if (savedPosition && cesiumState.viewer) {
        const cameraParams = {
            destination: Cesium.Cartesian3.fromDegrees(
                savedPosition.position.longitude,
                savedPosition.position.latitude,
                savedPosition.position.height
            ),
            orientation: {
                heading: savedPosition.orientation.heading,
                pitch: savedPosition.orientation.pitch,
                roll: savedPosition.orientation.roll
            }
        };

        cesiumState.viewer.camera.setView(cameraParams);
        return true;
    }
    return false;
}

/**
 * Clears the saved camera position for the active tileset.
 * @returns {Promise<boolean>} True if position was cleared
 */
export async function clearCurrentCameraPosition() {
    if (!_currentTilesetId) {
        return false;
    }

    const result = await clearCameraPosition(_currentTilesetId);
    if (result) {
        updateCameraButtonState(false);
    }
    return result;
}

/**
 * Checks if current tileset has a saved camera position.
 * @returns {Promise<boolean>} True if position exists
 */
export async function currentTilesetHasSavedPosition() {
    if (!_currentTilesetId) {
        return false;
    }
    return await hasSavedCameraPosition(_currentTilesetId);
}

/**
 * Updates the visual state of camera buttons based on saved position.
 * @param {boolean} hasSavedPosition - Whether position is saved
 */
function updateCameraButtonState(hasSavedPosition) {
    const saveBtn = document.getElementById('salvar-camera');
    const clearBtn = document.getElementById('limpar-camera');
    const flyBtn = document.getElementById('voar-camera');

    if (saveBtn) {
        saveBtn.classList.toggle('has-saved', hasSavedPosition);
    }

    if (clearBtn) {
        clearBtn.style.display = hasSavedPosition ? 'flex' : 'none';
    }

    // Fly button is always visible when a tileset is loaded
    if (flyBtn) {
        flyBtn.style.display = _currentTilesetId ? 'flex' : 'none';
    }
}

/**
 * Loads a single tileset and positions camera at its location.
 * @param {Cesium.Viewer} viewer - The Cesium viewer instance
 * @param {string} tilesetId - ID of the tileset to load
 * @returns {Promise<Cesium.Cesium3DTileset>} The loaded tileset
 */
async function loadSingleTileset(viewer, tilesetId) {
    if (!viewer || viewer.isDestroyed()) {
        throw new Error('Invalid or destroyed viewer');
    }

    if (currentTileset) {
        viewer.scene.primitives.remove(currentTileset);
        if (!currentTileset.isDestroyed()) {
            currentTileset.destroy();
        }
        currentTileset = null;
        _currentTilesetId = null;
    }

    const tilesetConfig = config.tilesets.find(t => t.id === tilesetId);
    if (!tilesetConfig) {
        throw new Error(`Tileset ${tilesetId} not found in config.tilesets`);
    }

    const isGlb = tilesetConfig.type === 'glb';
    currentTileset = isGlb
        ? await createGlbModel(viewer, tilesetConfig)
        : await createOptimizedTileset(viewer, tilesetConfig);
    _currentTilesetId = tilesetId;
    cesiumState.currentTilesetId = tilesetId;

    // Check for saved camera position
    const hasSavedPosition = await restoreCameraPosition(tilesetId);

    if (!hasSavedPosition) {
        // Use default location from config
        const defaultDestination = Cesium.Cartesian3.fromDegrees(
            tilesetConfig.locate.lon,
            tilesetConfig.locate.lat,
            tilesetConfig.locate.height
        );
        viewer.camera.setView({ destination: defaultDestination });
    }

    // Update button state
    updateCameraButtonState(hasSavedPosition);

    // Render markers for this tileset (without activating the tool)
    if (cesiumState.modules.markers) {
        await cesiumState.modules.markers.renderMarkersForTileset(viewer, tilesetId);
    }

    // Render measurements for this tileset
    if (cesiumState.modules.measurements) {
        await cesiumState.modules.measurements.renderMeasurementsForTileset(viewer, tilesetId);
    }

    // Render viewsheds for this tileset
    if (cesiumState.modules.viewshedTool) {
        await cesiumState.modules.viewshedTool.renderViewshedsForTileset(viewer, tilesetId);
    }

    return currentTileset;
}

/**
 * Reloads 3D features (markers, measurements, viewsheds) for a tileset
 * without reloading the tileset itself. Used when the active map changes
 * while the 3D viewer stays open on the same model.
 * @param {Cesium.Viewer} viewer - The Cesium viewer instance
 * @param {string} tilesetId - Tileset ID
 */
export async function reloadFeaturesForTileset(viewer, tilesetId) {
    if (!viewer || viewer.isDestroyed()) return;

    if (cesiumState.modules.markers) {
        await cesiumState.modules.markers.renderMarkersForTileset(viewer, tilesetId);
    }

    if (cesiumState.modules.measurements) {
        await cesiumState.modules.measurements.renderMeasurementsForTileset(viewer, tilesetId);
    }

    if (cesiumState.modules.viewshedTool) {
        await cesiumState.modules.viewshedTool.renderViewshedsForTileset(viewer, tilesetId);
    }
}

/**
 * Initializes Cesium with a specific tileset using lazy loading.
 * @param {string} tilesetId - ID of the tileset to load
 * @returns {Promise<Cesium.Viewer>} The Cesium viewer instance
 */
async function loadCesiumAndInitWithTileset(tilesetId) {
    if (!cesiumState.viewer) {
        await loadCesiumAndInit();

        const primitives = cesiumState.viewer.scene.primitives;
        for (let i = primitives.length - 1; i >= 0; i--) {
            const primitive = primitives.get(i);
            if (primitive instanceof Cesium.Cesium3DTileset ||
                primitive instanceof Cesium.Model) {
                primitives.remove(primitive);
                if (!primitive.isDestroyed()) {
                    primitive.destroy();
                }
            }
        }
    }

    await loadSingleTileset(cesiumState.viewer, tilesetId);

    return cesiumState.viewer;
}

function registerToolEventListeners() {
    setTimeout(() => {
        const buttons = document.querySelectorAll('.button-tool-3d');

        if (buttons.length === 0) {
            console.warn('3D tool buttons not found');
            return;
        }

        buttons.forEach(btn => {
            btn.removeEventListener('click', activeTool);
            btn.addEventListener('click', activeTool);
        });

        // Initialize navigation help popup
        initNavigationHelp();

        // Initialize active tool chip close button
        initActiveToolChip3D();

        // Initialize camera buttons
        initCameraButtons();

        // Apply map lock state to 3D toolbar
        const toolbar3d = document.getElementById('toolbar-3d');
        if (toolbar3d) {
            toolbar3d.classList.toggle('map-locked', isCurrentMapLockedSync());
            try {
                const eventBus = getEventBus();
                eventBus.on(EventTypes.MAP_LOCK_CHANGED, () => {
                    toolbar3d.classList.toggle('map-locked', isCurrentMapLockedSync());
                });
            } catch { /* EventBus not available */ }
        }
    }, 100);
}

/**
 * Initializes camera save/clear button handlers
 */
function initCameraButtons() {
    const saveBtn = document.getElementById('salvar-camera');
    const clearBtn = document.getElementById('limpar-camera');

    if (saveBtn) {
        // Remove existing listeners
        saveBtn.replaceWith(saveBtn.cloneNode(true));
        const newSaveBtn = document.getElementById('salvar-camera');

        newSaveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isCurrentMapLockedSync()) return;
            const success = await saveCurrentCameraPosition();
            if (success) {
                showSuccess('Posição da câmera salva!');
            }
        });
    }

    if (clearBtn) {
        // Remove existing listeners
        clearBtn.replaceWith(clearBtn.cloneNode(true));
        const newClearBtn = document.getElementById('limpar-camera');

        newClearBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isCurrentMapLockedSync()) return;
            const success = await clearCurrentCameraPosition();
            if (success) {
                showSuccess('Posição da câmera removida');
            }
        });
    }

    const flyBtn = document.getElementById('voar-camera');
    if (flyBtn) {
        // Remove existing listeners
        flyBtn.replaceWith(flyBtn.cloneNode(true));
        const newFlyBtn = document.getElementById('voar-camera');

        // Fly again works even in locked mode
        newFlyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!_currentTilesetId || !cesiumState.viewer) return;

            // Try saved position first, fall back to default tileset location
            const restored = await restoreCameraPosition(_currentTilesetId);
            if (!restored) {
                const tilesetConfig = config.tilesets.find(t => t.id === _currentTilesetId);
                if (tilesetConfig?.locate) {
                    cesiumState.viewer.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(
                            tilesetConfig.locate.lon,
                            tilesetConfig.locate.lat,
                            tilesetConfig.locate.height
                        ),
                        duration: 2.0
                    });
                }
            }
        });
    }

    // Share button (copies deep link URL to clipboard)
    const shareBtn = document.getElementById('share-3d');
    if (shareBtn) {
        shareBtn.replaceWith(shareBtn.cloneNode(true));
        const newShareBtn = document.getElementById('share-3d');

        newShareBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!cesiumState.viewer || !_currentTilesetId) return;

            const camera = cesiumState.viewer.camera;
            const cartographic = camera.positionCartographic;

            const { buildShareUrl3D, copyShareUrl } = await import(
                '../deep-link/deep-link.js'
            );
            const url = buildShareUrl3D(
                _currentTilesetId,
                Cesium.Math.toDegrees(cartographic.longitude),
                Cesium.Math.toDegrees(cartographic.latitude),
                cartographic.height,
                camera.heading,
                camera.pitch,
                camera.roll
            );
            await copyShareUrl(url);
        });
    }
}

/**
 * Initializes the active tool chip close button and ESC key handler
 */
function initActiveToolChip3D() {
    const closeBtn = document.getElementById('active-tool-chip-3d-close');

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            deactivateCurrentTool3D();
        });
    }
}

/**
 * Deactivates the currently active 3D tool
 */
function deactivateCurrentTool3D() {
    if (activeToolId) {
        const activeBtn = document.getElementById(activeToolId);
        if (activeBtn) {
            activeBtn.classList.remove('active');
        }
        activeToolId = null;
        removeAllTools();
        hideActiveToolChip3D();
    }
}

/**
 * Initializes the navigation help popup functionality
 */
function initNavigationHelp() {
    // Prevent multiple initializations
    if (navHelpInitialized) return;

    const helpBtn = document.getElementById('help-3d');
    const popup = document.getElementById('nav-help-popup');

    if (!helpBtn || !popup) return;

    // Toggle popup on button click
    helpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !popup.hidden;

        if (isOpen) {
            closeNavHelp();
        } else {
            openNavHelp();
        }
    });

    // Tab switching
    const tabs = popup.querySelectorAll('.nav-help-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // Update tabs
            tabs.forEach(t => {
                t.classList.toggle('active', t.dataset.tab === targetTab);
                t.setAttribute('aria-selected', t.dataset.tab === targetTab);
            });

            // Update panels
            popup.querySelectorAll('.nav-help-panel').forEach(panel => {
                panel.classList.toggle('active', panel.dataset.panel === targetTab);
            });
        });
    });

    // Close on outside click - store reference for potential cleanup
    navHelpHandlers.documentClick = (e) => {
        const popup = document.getElementById('nav-help-popup');
        const helpBtn = document.getElementById('help-3d');
        if (popup && !popup.hidden && !popup.contains(e.target) && e.target !== helpBtn && !helpBtn?.contains(e.target)) {
            closeNavHelp();
        }
    };
    document.addEventListener('click', navHelpHandlers.documentClick);

    // Note: Escape key handling is now done by keyboard-service-3d.js
    // The navHelpHandlers.documentKeydown is kept only for cleanup reference
    navHelpHandlers.documentKeydown = null;

    navHelpInitialized = true;
}

function openNavHelp() {
    const helpBtn = document.getElementById('help-3d');
    const popup = document.getElementById('nav-help-popup');

    if (!popup) return;

    popup.hidden = false;
    helpBtn?.setAttribute('aria-expanded', 'true');
}

function closeNavHelp() {
    const helpBtn = document.getElementById('help-3d');
    const popup = document.getElementById('nav-help-popup');

    if (!popup) return;

    popup.hidden = true;
    helpBtn?.setAttribute('aria-expanded', 'false');
}

/**
 * Opens the 3D viewer with a specific tileset.
 * @param {string} tilesetId - ID of the tileset to display
 */
export async function openViewerWithTileset(tilesetId) {
    // Clear 2D map selection and close feature panel before opening 3D viewer
    try {
        const { getStateManagerInstance } = await import('../state/state_manager.js');
        const stateManager = getStateManagerInstance();
        stateManager.clearSelection();
        stateManager.closeFeaturePanel();
    } catch (error) {
        console.warn('Could not clear selection:', error);
    }

    const viewerExists = cesiumState.viewer && !cesiumState.viewer.isDestroyed();

    if (viewerExists) {
        await switchTileset(tilesetId);
        resumeRendering();
    } else {
        await loadCesiumAndInitWithTileset(tilesetId);
        init3DFeatures();
        resumeRendering();
    }

    registerToolEventListeners();

    // Dismiss the 3D loading screen — model is loaded and camera is in position
    hideLoading3DScreen();

    cesiumState.isVisible = true;

    // Configure and activate 3D keyboard service
    setKeyboardCallbacks3D({
        activateTool: (toolId) => {
            const button = document.getElementById(toolId);
            if (button) {
                button.click();
            }
        },
        deactivateCurrentTool: () => {
            deactivateCurrentTool3D();
        },
        deleteSelectedFeature: async () => {
            await confirmAndDelete3DFeature();
        },
        isHelpPopupOpen: () => {
            const popup = document.getElementById('nav-help-popup');
            return popup && !popup.hidden;
        },
        closeHelpPopup: () => {
            closeNavHelp();
        }
    });
    activateKeyboardService3D();

    // Emit event to notify UI components that 3D viewer is now open
    const eventBus = getEventBus();
    if (eventBus) {
        eventBus.emit(EventTypes.VIEWER_3D_OPENED, { tilesetId });
    }
}

/**
 * Closes the 3D viewer by pausing rendering without destroying it
 */
export function closeViewer() {
    if (cesiumState.viewer && !cesiumState.viewer.isDestroyed() && cesiumState.isVisible) {
        // Deselect any selected marker and close its panel
        if (cesiumState.modules.markers && cesiumState.modules.markers.deselectCurrentMarker) {
            cesiumState.modules.markers.deselectCurrentMarker();
        }

        // Deselect any selected measurement and close its panel
        if (cesiumState.modules.measurements && cesiumState.modules.measurements.deselectCurrentMeasurement) {
            cesiumState.modules.measurements.deselectCurrentMeasurement();
        }

        // Deselect any selected viewshed and close its panel
        if (cesiumState.modules.viewshedTool && cesiumState.modules.viewshedTool.deselectCurrentViewshed) {
            cesiumState.modules.viewshedTool.deselectCurrentViewshed();
        }

        pauseRendering();
        cesiumState.isVisible = false;

        // Deactivate 3D keyboard service (re-enables global shortcuts)
        deactivateKeyboardService3D();

        // Emit event to notify UI components that 3D viewer is now closed
        const eventBus = getEventBus();
        if (eventBus) {
            eventBus.emit(EventTypes.VIEWER_3D_CLOSED, {});
        }
    }
}

/**
 * Deactivates the currently active 3D tool and hides the tool chip.
 * Called after completing a tool action (e.g., adding a marker).
 */
export function deactivateActiveTool3D() {
    deactivateAllToolButtons();
    removeAllTools();
    hideActiveToolChip3D();

    // Deactivate marker tool if active
    if (cesiumState.modules.markers) {
        cesiumState.modules.markers.deactivateMarkerTool();
    }

    // Deactivate measurement tool if active
    if (cesiumState.modules.measurements) {
        cesiumState.modules.measurements.deactivateMeasurementTool();
    }

    // Deactivate viewshed tool if active
    if (cesiumState.modules.viewshedTool) {
        cesiumState.modules.viewshedTool.deactivateViewshedTool();
    }
}

function cleanupActiveTools() {
    try {
        if (cesiumState.modules.viewshedTool) {
            cesiumState.modules.viewshedTool.clearAllViewField();
        }
    } catch (error) {
        console.warn('Error cleaning tools:', error);
    }

    if (window.measure && window.measure._drawLayer) {
        window.measure._drawLayer.entities.removeAll();
        if (window.measure.removeDrawLineMeasureGraphics) {
            window.measure.removeDrawLineMeasureGraphics();
        }
        if (window.measure.removeDrawAreaMeasureGraphics) {
            window.measure.removeDrawAreaMeasureGraphics();
        }
    }

    if (cesiumState.viewer && !cesiumState.viewer.isDestroyed()) {
        cesiumState.viewer.entities.removeAll();
    }
}

/**
 * Switches to a different tileset when viewer is already open
 * @param {string} newTilesetId - ID of the new tileset to load
 */
async function switchTileset(newTilesetId) {
    if (!cesiumState.viewer || cesiumState.viewer.isDestroyed()) return;

    cleanupActiveTools();
    await loadSingleTileset(cesiumState.viewer, newTilesetId);
    init3DFeatures();
}

/**
 * Checks if the 3D viewer is currently visible/open.
 * This is the single source of truth for 3D viewer state.
 * @returns {boolean} True if viewer is visible
 */
export function isViewer3DOpen() {
    return cesiumState.isVisible === true;
}

/**
 * Returns the Cesium viewer instance.
 * @returns {Cesium.Viewer|null} The viewer or null if not initialized
 */
export function getCesiumViewer() {
    return cesiumState.viewer;
}

/**
 * Returns the current active tileset ID.
 * @returns {string|null} The tileset ID or null
 */
export function getCurrentTilesetId() {
    return _currentTilesetId;
}

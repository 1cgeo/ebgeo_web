// Path: js/map_3d.js
import config from './config.js';

// ===== GLOBAL STATE MANAGEMENT =====
let cesiumState = {
    isLoaded: false,
    isVisible: false,
    isPaused: false,
    loadPromise: null,
    viewer: null,
    loadedTilesets: {},
    resizeObserver: null,
    // Cache for dynamically loaded modules
    modules: {}
};

// ===== LAZY LOADING =====
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Check if already loaded
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

export async function loadCesiumAndInit() {
    if (cesiumState.loadPromise) {
        return cesiumState.loadPromise;
    }

    cesiumState.loadPromise = new Promise(async (resolve, reject) => {
        try {

            // Load scripts in correct order
            await loadScript('./vendors/cesium/Cesium.js');

            // Wait for Cesium to be available globally
            await waitForGlobal('Cesium', 5000);

            // ===== COMPLETELY DISABLE CESIUM ION =====
            // Remove any token that might be configured
            if (Cesium.Ion) {
                Cesium.Ion.defaultAccessToken = undefined;
                // Disable Ion's default server
                if (Cesium.Ion.defaultServer) {
                    Cesium.Ion.defaultServer = new Cesium.Resource({ url: 'about:blank' });
                }
            }

            // Configure local terrain and imagery providers BEFORE creating the viewer
            if (Cesium.createWorldTerrain) {
                // Prevent automatic creation of Ion terrain
                const originalCreateWorldTerrain = Cesium.createWorldTerrain;
                Cesium.createWorldTerrain = function () {
                    return new Cesium.EllipsoidTerrainProvider();
                };
            }

            if (Cesium.createWorldImagery) {
                // Prevent automatic creation of Ion imagery
                const originalCreateWorldImagery = Cesium.createWorldImagery;
                Cesium.createWorldImagery = function () {
                    return false;
                };
            }

            // Disable requests to Ion
            if (Cesium.RequestScheduler) {
                // Block any request to api.cesium.com
                const originalRequest = Cesium.RequestScheduler.request;
                Cesium.RequestScheduler.request = function (request) {
                    if (request.url && request.url.includes('api.cesium.com')) {
                        console.warn('Blocked Ion request:', request.url);
                        return Promise.reject(new Error('Ion requests are disabled'));
                    }
                    return originalRequest.apply(this, arguments);
                };
            }

            // Load Cesium dependencies
            await Promise.all([
                loadScript('./vendors/cesium/cesium-measure.js'),
                loadScript('./vendors/cesium/cesium-viewshed.js')
            ]);

            // Initialize the map
            await initCesiumMap();

            cesiumState.isLoaded = true;
            resolve();

        } catch (error) {
            console.error('Error loading Cesium:', error);
            cesiumState.loadPromise = null; // Allow retry
            reject(error);
        }
    });

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

    // Basic extent configuration
    const { bounds } = config.map3d;
    const extent = new Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
    Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

    // ===== BASIC PROVIDERS =====
    const terrainProviderConfig = config.createTerrainProvider();
    const imageryProviderConfig = config.createImageryProvider();

    // Create terrain provider (simplified)
    let terrainProvider;
    try {
        if (terrainProviderConfig.provider === 'CesiumTerrainProvider') {
            terrainProvider = new Cesium.CesiumTerrainProvider({
                url: terrainProviderConfig.url,
                // Only essential settings
                requestVertexNormals: terrainProviderConfig.requestVertexNormals || false,
                requestWaterMask: false, // Simplified
                requestMetadata: false   // Simplified
            });
        } else {
            terrainProvider = new Cesium.EllipsoidTerrainProvider();
        }
    } catch (error) {
        console.warn('Warning: Error creating terrain provider, using ellipsoid:', error);
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }

    // Create imagery provider (simplified)
    let imageryProvider = false;
    if (imageryProviderConfig) {
        try {
            switch (imageryProviderConfig.provider) {
                case 'UrlTemplateImageryProvider':
                    imageryProvider = new Cesium.UrlTemplateImageryProvider({
                        url: imageryProviderConfig.url,
                        // Essential imagery settings
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
        } catch (error) {
            console.warn('Warning: Error creating imagery provider:', error);
            imageryProvider = false;
        }
    }

    // ===== MINIMAL VIEWER CONFIGURATION =====
    const viewer = new Cesium.Viewer("map-3d", {
        // Basic UI settings
        ...config.map3d.viewer,

        // Providers
        terrainProvider: terrainProvider,
        imageryProvider: imageryProvider,

        // Essential functionality settings
        contextOptions: {
            webgl: {
                // ONLY essentials for screenshots
                preserveDrawingBuffer: true,
                // Use defaults for the rest
                powerPreference: "default"
            }
        },
    });


    // ===== ONLY ESSENTIAL SETTINGS =====

    // If imagery was disabled, remove default layers
    if (!imageryProvider) {
        viewer.imageryLayers.removeAll();
    }

    // Force the configured terrain provider
    viewer.terrainProvider = terrainProvider;

    // Minimal scene settings
    const scene = viewer.scene;

    // Keep only essentials:
    scene.globe.baseColor = Cesium.Color.BLACK;
    viewer.bottomContainer.style.display = "none";


    cesiumState.viewer = viewer;

    // Basic setup (without over-engineering)
    await loadTilesets(viewer);
    await setupTools(viewer);

    return viewer;
}

async function loadTilesets(viewer) {
    // Use tilesets from configuration
    for (const tilesetConfig of config.tilesets) {
        try {
            const tileset = await createOptimizedTileset(viewer, tilesetConfig);
            cesiumState.loadedTilesets[tilesetConfig.id.toLowerCase()] = {
                tileset: tileset,
                location: tilesetConfig.locate
            };
        } catch (error) {
            console.warn(`Failed to load tileset ${tilesetConfig.id}:`, error);
        }
    }
}

async function createOptimizedTileset(viewer, tilesetConfig) {
    const tileset = new Cesium.Cesium3DTileset({
        url: tilesetConfig.url,
        maximumScreenSpaceError: 16,
        maximumMemoryUsage: 512,
        preferLeaves: false, // Better for large tilesets
        skipLevelOfDetail: true,
        baseScreenSpaceError: 1024,
        skipScreenSpaceErrorFactor: 16,
        skipLevels: 1,
        cacheBytes: 1073741824, // 1 GB
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorDensity: 0.00278,
        dynamicScreenSpaceErrorFactor: 2.0, // Reduced from 4
        dynamicScreenSpaceErrorHeightFalloff: 0.25,
        cullWithChildrenBounds: true,
        cullRequestsWhileMoving: true,
        cullRequestsWhileMovingMultiplier: 60.0,
        foveatedScreenSpaceError: true,
    });

    viewer.scene.primitives.add(tileset);

    await tileset.readyPromise;

    // Apply transformations
    const heightOffset = tilesetConfig.heightOffset;
    const boundingSphere = tileset.boundingSphere;
    const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
    const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0.0);
    const offset = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, heightOffset);
    const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);

    if (tilesetConfig.default) {
        const { lat, lon, height } = tilesetConfig.locate;
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        });
    }

    return tileset;
}

async function setupTools(viewer) {
    // Initialize existing tools with the new viewer
    window.map = viewer; // Compatibility with existing code

    // Optimized tools setup
    const measure = new Cesium.Measure(viewer);
    window.measure = measure;

    // Initialize Cesium event handlers
    initCesiumEventHandlers();

    // Load tool modules dynamically
    try {
        // Load and initialize 3D mouse coordinates
        const mouseCoordModule = await import('./control_3d/mouse_coordinates_3d.js');
        cesiumState.modules.mouseCoordinates = mouseCoordModule;

        // Load viewshed module
        const viewshedModule = await import('./control_3d/viewshed.js');
        cesiumState.modules.viewshed = viewshedModule;

        // Load screenshot module
        const screenshotModule = await import('./control_3d/screenshot_tool.js');
        cesiumState.modules.screenshot = screenshotModule;


    } catch (error) {
        console.warn('Warning: Some 3D modules failed to load:', error);
    }
}

// ===== PERFORMANCE MANAGEMENT =====
export function pauseRendering() {
    if (!cesiumState.viewer || cesiumState.isPaused) return;

    cesiumState.isPaused = true;
    cesiumState.isVisible = false;

    const scene = cesiumState.viewer.scene;

    // Stop continuous rendering
    scene.requestRenderMode = true;

    // Hide primitives to save VRAM
    scene.primitives.show = false;
    scene.groundPrimitives.show = false;

    // Stop animations
    cesiumState.viewer.clock.shouldAnimate = false;

    // Stop unnecessary camera controls
    scene.screenSpaceCameraController.enableInputs = false;

    // Clear texture cache if possible
    if (scene.context && scene.context._textureCache) {
        // scene.context._textureCache.clear(); // Warning: private API
    }
}

export function resumeRendering() {
    if (!cesiumState.viewer || !cesiumState.isPaused) return;

    cesiumState.isPaused = false;
    cesiumState.isVisible = true;

    const scene = cesiumState.viewer.scene;

    // Resume rendering
    scene.requestRenderMode = false;

    // Show primitives
    scene.primitives.show = true;
    scene.groundPrimitives.show = true;

    // Resume animations if needed
    cesiumState.viewer.clock.shouldAnimate = true;

    // Re-enable controls
    scene.screenSpaceCameraController.enableInputs = true;

    // Force an initial render
    scene.requestRender();
}

// ===== COMPLETE MEMORY CLEANUP =====
export function cleanup3DFeatures() {

    // Clean tools using dynamically loaded modules (NO ORBIT)
    try {
        if (cesiumState.modules.viewshed) {
            cesiumState.modules.viewshed.clearAllViewField();
        }

        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.cleanupMouseCoordinates3D();
        }
    } catch (error) {
        console.warn('Error cleaning modules:', error);
    }

    // Clean measurement tools
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
        // Remove all event listeners
        const scene = cesiumState.viewer.scene;

        // Clean tilesets
        Object.values(cesiumState.loadedTilesets).forEach(({ tileset }) => {
            if (tileset && !tileset.isDestroyed()) {
                scene.primitives.remove(tileset);
            }
        });

        // Clean entities
        cesiumState.viewer.entities.removeAll();

        // Clean data sources
        cesiumState.viewer.dataSources.removeAll();

        // Clean primitives
        scene.primitives.removeAll();
        scene.groundPrimitives.removeAll();

        // Destroy viewer
        cesiumState.viewer.destroy();
    }

    // Clean resize observer
    if (cesiumState.resizeObserver) {
        cesiumState.resizeObserver.disconnect();
        cesiumState.resizeObserver = null;
    }

    // Reset state
    cesiumState = {
        isLoaded: false,
        isVisible: false,
        isPaused: false,
        loadPromise: null,
        viewer: null,
        loadedTilesets: {},
        resizeObserver: null,
        modules: {}
    };

    // Clean global references
    window.map = null;
    window.measure = null;
}

// ===== EXISTING TOOLS =====
export function init3DFeatures() {
    if (!cesiumState.viewer) return;

    try {
        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.initMouseCoordinates3D(cesiumState.viewer);
        }
    } catch (error) {
        console.warn('Error initializing 3D tools:', error);
    }
}

export function activeTool() {
    const toolId = $(this).attr('id');
    if (!toolId || !cesiumState.viewer) return;
    switch (toolId) {
        case 'limpar':
            removeAllTools();
            break;
        case 'distancia':
            if (window.measure && window.measure.drawLineMeasureGraphics) {
                window.measure.drawLineMeasureGraphics({
                    clampToGround: true,
                    callback: () => { }
                });
            }
            break;
        case 'area':
            if (window.measure && window.measure.drawAreaMeasureGraphics) {
                window.measure.drawAreaMeasureGraphics({
                    clampToGround: true,
                    callback: () => { }
                });
            }
            break;
        case 'visualizacao':
            if (cesiumState.modules.viewshed) {
                cesiumState.modules.viewshed.addViewField(cesiumState.viewer);
            }
            break;
        case 'screenshot-3d':
            handleScreenshot();
            break;
    }
}

export function handleClickGoTo() {
    const targetId = $(this).attr('id');
    if (!targetId || !cesiumState.viewer) return;

    removeAllTools();

    const tilesetData = cesiumState.loadedTilesets[targetId];
    if (tilesetData) {
        const { location } = tilesetData;
        // Simple navigation without orbit
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
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function removeAllTools() {
    if (!window.measure) return;

    try {
        if (window.measure._drawLayer) {
            window.measure._drawLayer.entities.removeAll();
        }
        if (window.measure.removeDrawLineMeasureGraphics) {
            window.measure.removeDrawLineMeasureGraphics();
        }
        if (window.measure.removeDrawAreaMeasureGraphics) {
            window.measure.removeDrawAreaMeasureGraphics();
        }

        if (cesiumState.modules.viewshed) {
            cesiumState.modules.viewshed.clearAllViewField();
        }

    } catch (error) {
        console.warn('Error removing tools:', error);
    }
}

function handleScreenshot() {
    if (cesiumState.modules.screenshot) {
        const success = cesiumState.modules.screenshot.takeScreenshot(cesiumState.viewer);
        if (success) {
            const button = document.getElementById('screenshot-3d');
            if (button) {
                const originalBg = button.style.backgroundColor;
                button.style.backgroundColor = '#28a745';
                setTimeout(() => {
                    button.style.backgroundColor = originalBg;
                }, 500);
            }
        }
    }
}

// ===== EVENT HANDLERS FOR COMPATIBILITY =====
$('#locate-3d-container button').on('click', handleClickGoTo);

// Cesium handler will be initialized after loading
function initCesiumEventHandlers() {
    if (typeof Cesium !== 'undefined' && cesiumState.viewer) {
        const handler = new Cesium.ScreenSpaceEventHandler(cesiumState.viewer.canvas);
        handler.setInputAction(function (event) {
            const scratchRectangle = new Cesium.Rectangle();
            const pickedPosition = cesiumState.viewer.scene.pickPosition(event.position);
            if (Cesium.defined(pickedPosition)) {
                const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(pickedPosition);
                const lon = Cesium.Math.toDegrees(carto.longitude);
                const lat = Cesium.Math.toDegrees(carto.latitude);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        return handler;
    }
    return null;
}
// ===== NEW FUNCTIONS FOR 3D MODELS VIEWER =====
// Added to support 3D models viewer tool
// (Single tileset loading instead of loading all)

let currentTileset = null;
let currentTilesetId = null;

/**
 * Loads a single tileset (instead of all)
 */
async function loadSingleTileset(viewer, tilesetId) {
    // 0. Validate viewer
    if (!viewer || viewer.isDestroyed()) {
        throw new Error('Invalid or destroyed viewer');
    }

    // 1. Clear previous tileset
    if (currentTileset) {
        viewer.scene.primitives.remove(currentTileset);
        if (!currentTileset.isDestroyed()) {
            currentTileset.destroy();
        }
        currentTileset = null;
        currentTilesetId = null;
    }

    // 2. Find configuration
    const tilesetConfig = config.tilesets.find(t => t.id === tilesetId);
    if (!tilesetConfig) {
        throw new Error(`Tileset ${tilesetId} not found in config.tilesets`);
    }

    // 3. Create tileset
    currentTileset = await createOptimizedTileset(viewer, tilesetConfig);
    currentTilesetId = tilesetId;

    // 4. Fly to location
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
            tilesetConfig.locate.lon,
            tilesetConfig.locate.lat,
            tilesetConfig.locate.height
        ),
        duration: 2.0
    });

    return currentTileset;
}

/**
 * Initializes Cesium with a specific tileset (lazy loading)
 */
async function loadCesiumAndInitWithTileset(tilesetId) {
    if (!cesiumState.viewer) {
        // First time - use existing function to load Cesium and create viewer
        await loadCesiumAndInit();

        // Clear automatically loaded tilesets
        const primitives = cesiumState.viewer.scene.primitives;
        for (let i = primitives.length - 1; i >= 0; i--) {
            const primitive = primitives.get(i);
            if (primitive instanceof Cesium.Cesium3DTileset) {
                primitives.remove(primitive);
                if (!primitive.isDestroyed()) {
                    primitive.destroy();
                }
            }
        }
    }

    // Load specific tileset
    await loadSingleTileset(cesiumState.viewer, tilesetId);

    return cesiumState.viewer;
}

/**
 * Registers event listeners for 3D tool buttons
 */
function registerToolEventListeners() {
    // Use setTimeout to ensure DOM is ready
    setTimeout(() => {
        const buttons = $('.button-tool-3d');

        if (buttons.length === 0) {
            console.warn('Warning: 3D tool buttons not found');
            return;
        }

        // Remove old listeners to avoid duplication
        buttons.off('click');

        // Register tool listeners
        buttons.on('click', activeTool);

        console.log(`${buttons.length} 3D tool buttons registered`);
    }, 100);
}

/**
 * Opens the 3D viewer with a specific tileset
 * (Public function called by the tool)
 */
export async function openViewerWithTileset(tilesetId) {
    // Check if viewer exists AND has not been destroyed
    const viewerExists = cesiumState.viewer && !cesiumState.viewer.isDestroyed();

    if (viewerExists) {
        // Viewer already exists and is valid - just switch tileset
        await switchTileset(tilesetId);
        resumeRendering();
    } else {
        // First opening OR viewer was destroyed - load everything
        await loadCesiumAndInitWithTileset(tilesetId);
        init3DFeatures();
        resumeRendering();
    }

    // Always register event listeners when opening viewer (even on reopening)
    registerToolEventListeners();

    cesiumState.isVisible = true;
}

/**
 * Closes the 3D viewer (pause without destroying)
 * (Public function called by the tool)
 */
export function closeViewer() {
    if (cesiumState.viewer && !cesiumState.viewer.isDestroyed() && cesiumState.isVisible) {
        pauseRendering();
        cesiumState.isVisible = false;
    }
}

/**
 * Cleans only active tools without destroying the viewer
 * (Lightweight version of cleanup3DFeatures for model switching)
 */
function cleanupActiveTools() {
    // Clean tools using loaded modules
    try {
        if (cesiumState.modules.viewshed) {
            cesiumState.modules.viewshed.clearAllViewField();
        }
    } catch (error) {
        console.warn('Error cleaning tools:', error);
    }

    // Clean measurement tools
    if (window.measure && window.measure._drawLayer) {
        window.measure._drawLayer.entities.removeAll();
        if (window.measure.removeDrawLineMeasureGraphics) {
            window.measure.removeDrawLineMeasureGraphics();
        }
        if (window.measure.removeDrawAreaMeasureGraphics) {
            window.measure.removeDrawAreaMeasureGraphics();
        }
    }

    // Clean entities (but don't destroy the viewer)
    if (cesiumState.viewer && !cesiumState.viewer.isDestroyed()) {
        cesiumState.viewer.entities.removeAll();
    }
}

/**
 * Switches tileset (when viewer is already open)
 * (Public function called by the tool when clicking another marker)
 */
export async function switchTileset(newTilesetId) {
    if (!cesiumState.viewer || cesiumState.viewer.isDestroyed()) return;

    // Clean only active tools (DO NOT destroy the viewer!)
    cleanupActiveTools();

    // Load new tileset
    await loadSingleTileset(cesiumState.viewer, newTilesetId);

    // Reinitialize tools
    init3DFeatures();
}
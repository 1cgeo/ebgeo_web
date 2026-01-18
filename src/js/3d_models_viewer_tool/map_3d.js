// Path: js/3d_models_viewer_tool/map_3d.js
import config from '../config.js';

// ===== GLOBAL STATE MANAGEMENT =====
let cesiumState = {
    isLoaded: false,
    isVisible: false,
    isPaused: false,
    loadPromise: null,
    viewer: null,
    loadedTilesets: {},
    resizeObserver: null,
    modules: {}
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

    cesiumState.loadPromise = new Promise(async (resolve, reject) => {
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

            if (Cesium.createWorldTerrain) {
                const originalCreateWorldTerrain = Cesium.createWorldTerrain;
                Cesium.createWorldTerrain = function () {
                    return new Cesium.EllipsoidTerrainProvider();
                };
            }

            if (Cesium.createWorldImagery) {
                const originalCreateWorldImagery = Cesium.createWorldImagery;
                Cesium.createWorldImagery = function () {
                    return false;
                };
            }

            if (Cesium.RequestScheduler) {
                const originalRequest = Cesium.RequestScheduler.request;
                Cesium.RequestScheduler.request = function (request) {
                    if (request.url && request.url.includes('api.cesium.com')) {
                        console.warn('Blocked Ion request:', request.url);
                        return Promise.reject(new Error('Ion requests are disabled'));
                    }
                    return originalRequest.apply(this, arguments);
                };
            }

            await Promise.all([
                loadScript('./vendors/cesium/cesium-measure.js'),
                loadScript('./vendors/cesium/cesium-viewshed.js')
            ]);

            await initCesiumMap();

            cesiumState.isLoaded = true;
            resolve();

        } catch (error) {
            console.error('Error loading Cesium:', error);
            cesiumState.loadPromise = null;
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
    const { bounds } = config.map3d;
    const extent = new Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
    Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

    const terrainProviderConfig = config.createTerrainProvider();
    const imageryProviderConfig = config.createImageryProvider();

    let terrainProvider;
    try {
        if (terrainProviderConfig.provider === 'CesiumTerrainProvider') {
            terrainProvider = new Cesium.CesiumTerrainProvider({
                url: terrainProviderConfig.url,
                requestVertexNormals: terrainProviderConfig.requestVertexNormals || false,
                requestWaterMask: false,
                requestMetadata: false
            });
        } else {
            terrainProvider = new Cesium.EllipsoidTerrainProvider();
        }
    } catch (error) {
        console.warn('Error creating terrain provider, using ellipsoid:', error);
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }

    let imageryProvider = false;
    if (imageryProviderConfig) {
        try {
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
        } catch (error) {
            console.warn('Error creating imagery provider:', error);
            imageryProvider = false;
        }
    }

    const viewer = new Cesium.Viewer("map-3d", {
        ...config.map3d.viewer,
        terrainProvider: terrainProvider,
        imageryProvider: imageryProvider,
        contextOptions: {
            webgl: {
                preserveDrawingBuffer: true,
                powerPreference: "default"
            }
        },
    });

    if (!imageryProvider) {
        viewer.imageryLayers.removeAll();
    }

    viewer.terrainProvider = terrainProvider;

    const scene = viewer.scene;
    scene.globe.baseColor = Cesium.Color.BLACK;
    viewer.bottomContainer.style.display = "none";

    cesiumState.viewer = viewer;

    await loadTilesets(viewer);
    await setupTools(viewer);

    return viewer;
}

async function loadTilesets(viewer) {
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

    await tileset.readyPromise;

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
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, height)
        });
    }

    return tileset;
}

async function setupTools(viewer) {
    window.map = viewer;

    const measure = new Cesium.Measure(viewer);
    window.measure = measure;

    initCesiumEventHandlers();

    try {
        const mouseCoordModule = await import('./tools/mouse_coordinates_3d.js');
        cesiumState.modules.mouseCoordinates = mouseCoordModule;

        const viewshedModule = await import('./tools/viewshed.js');
        cesiumState.modules.viewshed = viewshedModule;

        const screenshotModule = await import('./tools/screenshot_tool.js');
        cesiumState.modules.screenshot = screenshotModule;

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
    if (!cesiumState.viewer || !cesiumState.isPaused) return;

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
        if (cesiumState.modules.viewshed) {
            cesiumState.modules.viewshed.clearAllViewField();
        }

        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.cleanupMouseCoordinates3D();
        }
    } catch (error) {
        console.warn('Error cleaning modules:', error);
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

function activeTool() {
    const toolId = this.id;
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

// ===== EVENT HANDLERS =====
document.querySelectorAll('#locate-3d-container button').forEach(btn => {
    btn.addEventListener('click', handleClickGoTo);
});

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

// ===== 3D MODELS VIEWER =====

let currentTileset = null;
let currentTilesetId = null;

/**
 * Loads a single tileset and flies to its location
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
        currentTilesetId = null;
    }

    const tilesetConfig = config.tilesets.find(t => t.id === tilesetId);
    if (!tilesetConfig) {
        throw new Error(`Tileset ${tilesetId} not found in config.tilesets`);
    }

    currentTileset = await createOptimizedTileset(viewer, tilesetConfig);
    currentTilesetId = tilesetId;

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
 * Initializes Cesium with a specific tileset using lazy loading
 * @param {string} tilesetId - ID of the tileset to load
 * @returns {Promise<Cesium.Viewer>} The Cesium viewer instance
 */
async function loadCesiumAndInitWithTileset(tilesetId) {
    if (!cesiumState.viewer) {
        await loadCesiumAndInit();

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

        console.log(`${buttons.length} 3D tool buttons registered`);
    }, 100);
}

/**
 * Opens the 3D viewer with a specific tileset
 * @param {string} tilesetId - ID of the tileset to display
 */
export async function openViewerWithTileset(tilesetId) {
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

    cesiumState.isVisible = true;
}

/**
 * Closes the 3D viewer by pausing rendering without destroying it
 */
export function closeViewer() {
    if (cesiumState.viewer && !cesiumState.viewer.isDestroyed() && cesiumState.isVisible) {
        pauseRendering();
        cesiumState.isVisible = false;
    }
}

function cleanupActiveTools() {
    try {
        if (cesiumState.modules.viewshed) {
            cesiumState.modules.viewshed.clearAllViewField();
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

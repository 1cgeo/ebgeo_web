// Path: js\map_3d.js

// ===== GESTÃO DE ESTADO GLOBAL =====
let cesiumState = {
    isLoaded: false,
    isVisible: false,
    isPaused: false,
    loadPromise: null,
    viewer: null,
    loadedTilesets: {},
    resizeObserver: null,
    // Cache para módulos carregados dinamicamente
    modules: {}
};

// ===== CARREGAMENTO LAZY =====
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Verifica se já foi carregado
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
            
            // Carrega scripts em ordem correta
            await loadScript('./vendors/cesium/Cesium.js');
            
            // Aguarda Cesium estar disponível globalmente
            await waitForGlobal('Cesium', 5000);
            
            // Carrega dependências do Cesium
            await Promise.all([
                loadScript('./vendors/cesium/cesium-measure.js'),
                loadScript('./vendors/cesium/cesium-viewshed.js')
            ]);
            
            // Inicializa o mapa
            await initCesiumMap();
            
            cesiumState.isLoaded = true;
            resolve();
            
        } catch (error) {
            console.error('❌ Erro ao carregar Cesium:', error);
            cesiumState.loadPromise = null; // Permite retry
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
    // Configuração do extent - movido do arquivo map.js original
    const bounds = {
        "west": -44.449656,
        "south": -22.455922,
        "east": -44.449654,
        "north": -22.455920
    };
    
    const extent = new Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
    Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

    // Configuração otimizada do viewer
    const viewer = new Cesium.Viewer("map-3d", {
        // Configurações básicas
        infoBox: false,
        shouldAnimate: false,
        vrButton: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        baseLayerPicker: false,
        navigationHelpButton: true,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        
        // Otimizações de performance
        requestRenderMode: true, // Render apenas quando necessário
        maximumRenderTimeChange: Infinity, // Não limita tempo de render
        
        // Configurações de terreno e atmosfera
        terrainProvider: undefined, // Evita carregar terreno desnecessário inicialmente
        skyAtmosphere: new Cesium.SkyAtmosphere()
    });
    
    // Otimizações de cena
    const scene = viewer.scene;
    scene.globe.baseColor = Cesium.Color.BLACK;
    scene.skyAtmosphere.show = true;
    scene.skyBox.show = true;
    scene.sun.show = false; // Economiza processamento
    scene.moon.show = false;
    
    // Oculta container inferior
    viewer.bottomContainer.style.display = "none";
    
    // Otimizações de camera
    scene.screenSpaceCameraController.enableCollisionDetection = false;
    
    // Configurações de rendering
    scene.fxaa = false; // Desabilita anti-aliasing para melhor performance
    if (scene.postProcessStages && scene.postProcessStages.fxaa) {
        scene.postProcessStages.fxaa.enabled = false;
    }
    
    // Gerenciamento de requests
    Cesium.RequestScheduler.maximumRequestsPerServer = 18;
    
    cesiumState.viewer = viewer;
    
    // Setup resize observer para performance
    setupResizeObserver();
    
    // Carrega tilesets
    await loadTilesets(viewer);
    
    // Setup ferramentas
    await setupTools(viewer);
    
    return viewer;
}

function setupResizeObserver() {
    if (!ResizeObserver) return;
    
    cesiumState.resizeObserver = new ResizeObserver(
        debounce(() => {
            if (cesiumState.viewer && cesiumState.isVisible) {
                cesiumState.viewer.resize();
            }
        }, 150)
    );
    
    const container = document.getElementById('map-3d-container');
    if (container) {
        cesiumState.resizeObserver.observe(container);
    }
}

async function loadTilesets(viewer) {
    const tilesetConfigs = [
        {
            url: "/3d/AMAN/tileset.json",
            heightOffset: 50,
            id: "AMAN",
            default: true,
            locate: { lat: -22.455921, lon: -44.449655, height: 2200 }
        },
        {
            url: "/3d/ESA/tileset.json",
            heightOffset: 75,
            id: "ESA",
            locate: { lon: -45.25666459926732, lat: -21.703613735103637, height: 1500 }
        },
        {
            url: "/3d/PCL/tileset.json",
            heightOffset: 35,
            id: "PCL",
            locate: { lon: -44.47332385414955, lat: -22.43976556982974, height: 1000 }
        }
    ];
    
    for (const config of tilesetConfigs) {
        try {
            const tileset = await createOptimizedTileset(viewer, config);
            cesiumState.loadedTilesets[config.id.toLowerCase()] = {
                tileset: tileset,
                location: config.locate
            };
        } catch (error) {
            console.warn(`Failed to load tileset ${config.id}:`, error);
        }
    }
}

async function createOptimizedTileset(viewer, config) {
    const tileset = new Cesium.Cesium3DTileset({
        url: config.url,
        maximumScreenSpaceError: 16,
        maximumMemoryUsage: 512,
        preferLeaves: false, // Melhor para tilesets grandes
        skipLevelOfDetail: true,
        baseScreenSpaceError: 1024,
        skipScreenSpaceErrorFactor: 16,
        skipLevels: 1,
        cacheBytes: 1073741824, // 1 GB
        dynamicScreenSpaceError: true,
        dynamicScreenSpaceErrorDensity: 0.00278,
        dynamicScreenSpaceErrorFactor: 2.0, // Reduzido de 4
        dynamicScreenSpaceErrorHeightFalloff: 0.25,
        cullWithChildrenBounds: true,
        cullRequestsWhileMoving: true,
        cullRequestsWhileMovingMultiplier: 60.0,
        foveatedScreenSpaceError: true,
    });
    
    viewer.scene.primitives.add(tileset);
    
    await tileset.readyPromise;
    
    // Aplica transformações
    const heightOffset = config.heightOffset;
    const boundingSphere = tileset.boundingSphere;
    const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);
    const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0.0);
    const offset = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, heightOffset);
    const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
    
    if (config.default) {
        const { lat, lon, height } = config.locate;
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
        });
    }
    
    return tileset;
}

async function setupTools(viewer) {
    // Inicializa ferramentas existentes com o novo viewer
    window.map = viewer; // Compatibilidade com código existente
    
    // Setup de ferramentas otimizado
    const measure = new Cesium.Measure(viewer);
    window.measure = measure;
    
    // Inicializa event handlers do Cesium
    initCesiumEventHandlers();
    
    // Carrega módulos das ferramentas dinamicamente
    try {
        // Carrega e inicializa mouse coordinates 3D
        const mouseCoordModule = await import('./control_3d/mouse_coordinates_3d.js');
        cesiumState.modules.mouseCoordinates = mouseCoordModule;
        
        // Carrega módulo de órbita
        const orbitModule = await import('./control_3d/orbit_control.js');
        cesiumState.modules.orbitControl = orbitModule;
        
        // Carrega módulo de viewshed
        const viewshedModule = await import('./control_3d/viewshed.js');
        cesiumState.modules.viewshed = viewshedModule;
        
        // Carrega módulo de screenshot
        const screenshotModule = await import('./control_3d/screenshot_tool.js');
        cesiumState.modules.screenshot = screenshotModule;
        
        
    } catch (error) {
        console.warn('⚠️ Alguns módulos 3D falharam ao carregar:', error);
    }
}

// ===== GESTÃO DE PERFORMANCE =====
export function pauseRendering() {
    if (!cesiumState.viewer || cesiumState.isPaused) return;
    
    cesiumState.isPaused = true;
    cesiumState.isVisible = false;
    
    const scene = cesiumState.viewer.scene;
    
    // Para renderização contínua
    scene.requestRenderMode = true;
    
    // Oculta primitives para economizar VRAM
    scene.primitives.show = false;
    scene.groundPrimitives.show = false;
    
    // Para animações
    cesiumState.viewer.clock.shouldAnimate = false;
    
    // Para controles de câmera desnecessários
    scene.screenSpaceCameraController.enableInputs = false;
    
    // Limpa cache de texturas se possível
    if (scene.context && scene.context._textureCache) {
        // scene.context._textureCache.clear(); // Cuidado: API privada
    }
}

export function resumeRendering() {
    if (!cesiumState.viewer || !cesiumState.isPaused) return;
    
    cesiumState.isPaused = false;
    cesiumState.isVisible = true;
    
    const scene = cesiumState.viewer.scene;
    
    // Retoma renderização
    scene.requestRenderMode = false;
    
    // Mostra primitives
    scene.primitives.show = true;
    scene.groundPrimitives.show = true;
    
    // Retoma animações se necessário
    cesiumState.viewer.clock.shouldAnimate = true;
    
    // Reabilita controles
    scene.screenSpaceCameraController.enableInputs = true;
    
    // Força um render inicial
    scene.requestRender();
}

// ===== LIMPEZA COMPLETA DE MEMÓRIA =====
export function cleanup3DFeatures() {
    
    // Para órbita e limpa ferramentas usando módulos carregados dinamicamente
    try {
        if (cesiumState.modules.orbitControl) {
            cesiumState.modules.orbitControl.stopOrbit();
            cesiumState.modules.orbitControl.cleanupOrbitControl();
        }
        
        if (cesiumState.modules.viewshed) {
            cesiumState.modules.viewshed.clearAllViewField();
        }
        
        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.cleanupMouseCoordinates3D();
        }
    } catch (error) {
        console.warn('Erro na limpeza de módulos:', error);
    }
    
    // Limpa ferramentas de medição
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
        // Remove todos os event listeners
        const scene = cesiumState.viewer.scene;
        
        // Limpa tilesets
        Object.values(cesiumState.loadedTilesets).forEach(({ tileset }) => {
            if (tileset && !tileset.isDestroyed()) {
                scene.primitives.remove(tileset);
            }
        });
        
        // Limpa entities
        cesiumState.viewer.entities.removeAll();
        
        // Limpa data sources
        cesiumState.viewer.dataSources.removeAll();
        
        // Limpa primitives
        scene.primitives.removeAll();
        scene.groundPrimitives.removeAll();
        
        // Destroy viewer
        cesiumState.viewer.destroy();
    }
    
    // Limpa resize observer
    if (cesiumState.resizeObserver) {
        cesiumState.resizeObserver.disconnect();
        cesiumState.resizeObserver = null;
    }
    
    // Reset estado
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
    
    // Limpa referências globais
    window.map = null;
    window.measure = null;
}

// ===== FERRAMENTAS EXISTENTES (Compatibilidade) =====
export function init3DFeatures() {
    if (!cesiumState.viewer) return;
    
    
    try {
        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.initMouseCoordinates3D(cesiumState.viewer);
        }
        
        if (cesiumState.modules.orbitControl) {
            cesiumState.modules.orbitControl.initOrbitControl(cesiumState.viewer);
        }
    } catch (error) {
        console.warn('Erro ao inicializar ferramentas 3D:', error);
    }
}

export function activeTool() {
    const toolId = $(this).attr('id');
    if (!toolId || !cesiumState.viewer) return;
    
    removeAllTools();
    
    switch (toolId) {
        case 'distancia':
            if (window.measure && window.measure.drawLineMeasureGraphics) {
                window.measure.drawLineMeasureGraphics({ 
                    clampToGround: true, 
                    callback: () => {} 
                });
            }
            break;
        case 'area':
            if (window.measure && window.measure.drawAreaMeasureGraphics) {
                window.measure.drawAreaMeasureGraphics({ 
                    clampToGround: true, 
                    callback: () => {} 
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
    if (tilesetData && cesiumState.modules.orbitControl) {
        const { tileset, location } = tilesetData;
        cesiumState.modules.orbitControl.flyToAndOrbit(location, tileset);
    }
}

// ===== UTILITÁRIOS =====
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
        
        if (cesiumState.modules.orbitControl) {
            cesiumState.modules.orbitControl.stopOrbit();
        }
    } catch (error) {
        console.warn('Erro ao remover ferramentas:', error);
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

// ===== EVENT HANDLERS PARA COMPATIBILIDADE =====
$('#locate-3d-container button').on('click', handleClickGoTo);

// Handler do Cesium será inicializado após carregamento
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
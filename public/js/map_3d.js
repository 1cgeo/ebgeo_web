// Path: js\map_3d.js
import config from './config.js';

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
            
            // ===== DESABILITA COMPLETAMENTE O CESIUM ION =====
            // Remove qualquer token que possa estar configurado
            if (Cesium.Ion) {
                Cesium.Ion.defaultAccessToken = undefined;
                // Desabilita o servidor padrão do Ion
                if (Cesium.Ion.defaultServer) {
                    Cesium.Ion.defaultServer = new Cesium.Resource({ url: 'about:blank' });
                }
            }
            
            // Configura terrain e imagery providers locais ANTES de criar o viewer
            if (Cesium.createWorldTerrain) {
                // Impede criação automática de terreno do Ion
                const originalCreateWorldTerrain = Cesium.createWorldTerrain;
                Cesium.createWorldTerrain = function() {
                    return new Cesium.EllipsoidTerrainProvider();
                };
            }
            
            if (Cesium.createWorldImagery) {
                // Impede criação automática de imagery do Ion
                const originalCreateWorldImagery = Cesium.createWorldImagery;
                Cesium.createWorldImagery = function() {
                    return false;
                };
            }
            
            // Desabilita requests para Ion
            if (Cesium.RequestScheduler) {
                // Bloqueia qualquer request para api.cesium.com
                const originalRequest = Cesium.RequestScheduler.request;
                Cesium.RequestScheduler.request = function(request) {
                    if (request.url && request.url.includes('api.cesium.com')) {
                        console.warn('Blocked Ion request:', request.url);
                        return Promise.reject(new Error('Ion requests are disabled'));
                    }
                    return originalRequest.apply(this, arguments);
                };
            }
            
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
    const { bounds } = config.map3d;
    
    const extent = new Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    Cesium.Camera.DEFAULT_VIEW_RECTANGLE = extent;
    Cesium.Camera.DEFAULT_VIEW_FACTOR = 0;

    // ===== CRIAÇÃO DE PROVIDERS LOCAIS BASEADOS NO CONFIG =====
    const terrainProviderConfig = config.createTerrainProvider();
    const imageryProviderConfig = config.createImageryProvider();
    
    // Criar terrain provider
    let terrainProvider;
    try {
        switch (terrainProviderConfig.provider) {
            case 'CesiumTerrainProvider':
                terrainProvider = new Cesium.CesiumTerrainProvider({
                    url: terrainProviderConfig.url,
                    requestVertexNormals: terrainProviderConfig.requestVertexNormals,
                    requestWaterMask: terrainProviderConfig.requestWaterMask,
                    requestMetadata: terrainProviderConfig.requestMetadata,
                    credit: terrainProviderConfig.credit
                });
                break;
            case 'EllipsoidTerrainProvider':
            default:
                terrainProvider = new Cesium.EllipsoidTerrainProvider();
                break;
        }
    } catch (error) {
        console.warn('⚠️ Erro ao criar terrain provider, usando ellipsoid:', error);
        terrainProvider = new Cesium.EllipsoidTerrainProvider();
    }
    
    // Criar imagery provider
    let imageryProvider = false; // Padrão sem imagery
    if (imageryProviderConfig) {
        try {
            switch (imageryProviderConfig.provider) {
                case 'UrlTemplateImageryProvider':
                    imageryProvider = new Cesium.UrlTemplateImageryProvider({
                        url: imageryProviderConfig.url,
                        maximumLevel: imageryProviderConfig.maximumLevel,
                        minimumLevel: imageryProviderConfig.minimumLevel,
                        tileWidth: imageryProviderConfig.tileWidth,
                        tileHeight: imageryProviderConfig.tileHeight,
                        credit: imageryProviderConfig.credit
                    });
                    break;
                case 'WebMapServiceImageryProvider':
                    imageryProvider = new Cesium.WebMapServiceImageryProvider({
                        url: imageryProviderConfig.url,
                        layers: imageryProviderConfig.layers,
                        ...imageryProviderConfig
                    });
                    break;
                case 'SingleTileImageryProvider':
                    imageryProvider = new Cesium.SingleTileImageryProvider({
                        url: imageryProviderConfig.url,
                        ...imageryProviderConfig
                    });
                    break;
            }
        } catch (error) {
            console.warn('⚠️ Erro ao criar imagery provider, desabilitando imagery:', error);
            imageryProvider = false;
        }
    }
    
    // Configuração otimizada do viewer
    const viewer = new Cesium.Viewer("map-3d", {
        ...config.map3d.viewer,
        // FORÇA providers locais sem Ion
        terrainProvider: terrainProvider,
        imageryProvider: imageryProvider,
        skyAtmosphere: false, // Recria depois manualmente
        baseLayerPicker: false,
        geocoder: false,
        // Força configurações offline
        terrainExaggeration: 1.0,
        shadows: false,
        contextOptions: {
            webgl: {
                powerPreference: "high-performance"
            }
        }
    });
    
    // Se imagery foi desabilitado, remove layers padrão
    if (!imageryProvider) {
        viewer.imageryLayers.removeAll();
    }
    
    // Força o terrain provider configurado
    viewer.terrainProvider = terrainProvider;
    
    // Otimizações de cena
    const scene = viewer.scene;
    scene.globe.baseColor = Cesium.Color.BLACK;
    
    // Garante que o terrain provider configurado está sendo usado
    scene.globe.terrainProvider = terrainProvider;
    scene.globe.depthTestAgainstTerrain = terrainProviderConfig.provider === 'CesiumTerrainProvider';
    
    // Recria atmosfera manualmente para evitar dependências Ion
    scene.skyAtmosphere = new Cesium.SkyAtmosphere(scene.globe.ellipsoid);
    scene.skyAtmosphere.show = true;
    scene.skyBox.show = true;
    scene.sun.show = false; // Economiza processamento
    scene.moon.show = false;
    
    // Configurações de render baseadas no tipo de terrain
    scene.fog.enabled = false;
    scene.globe.enableLighting = false;
    scene.globe.dynamicAtmosphereLighting = false;
    scene.globe.dynamicAtmosphereLightingFromSun = false;
    
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
    
    // ===== VERIFICAÇÃO FINAL - GARANTE QUE NÃO HÁ REQUESTS PARA ION =====
    // Log qualquer tentativa de request para debugar
    const originalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        const xhr = new originalXHR();
        const originalOpen = xhr.open;
        xhr.open = function(method, url, ...args) {
            if (url && url.includes('api.cesium.com')) {
                console.warn('Blocked XHR request to Ion:', url);
                throw new Error('Ion requests are disabled');
            }
            return originalOpen.apply(this, [method, url, ...args]);
        };
        return xhr;
    };
    
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
    // Usar tilesets da configuração
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
    
    // Limpa ferramentas usando módulos carregados dinamicamente (SEM ÓRBITA)
    try {
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

// ===== FERRAMENTAS EXISTENTES =====
export function init3DFeatures() {
    if (!cesiumState.viewer) return;
    
    try {
        if (cesiumState.modules.mouseCoordinates) {
            cesiumState.modules.mouseCoordinates.initMouseCoordinates3D(cesiumState.viewer);
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
    if (tilesetData) {
        const { location } = tilesetData;
        // Navegação simples sem órbita
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
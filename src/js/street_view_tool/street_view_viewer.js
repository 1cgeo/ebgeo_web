// Path: js/street_view_tool/street_view_viewer.js

/**
 * @fileoverview Core Street View 360 viewer using Three.js.
 * Manages the 3D panoramic viewer state, rendering, and lifecycle.
 * Based on the patterns from 3d_models_viewer_tool/map_3d.js
 *
 * A FONTE DA TEXTURA TEM DOIS CAMINHOS, e so isso muda por causa da piramide.
 * `loadTexture` pinta o preview, sonda o `tiles.json` da foto e, quando a
 * piramide existe, compoe a panoramica por tiles (ver tile-loader.js).
 * Sem piramide cai no full de sempre, e o 404 e o caminho NORMAL: 28 dos 29
 * projetos ainda nao tem tiles gerados.
 *
 * O QUE NAO MUDA: a esfera invertida, a ordem de rotacao ZXY da malha, a camera
 * YXZ, o navigator e todo o overlay 2D. A UV tem de continuar identica, e e por
 * isso que o carregador entrega UMA textura de canvas, e nunca uma grade de
 * quadros.
 */

import * as THREE from '../../vendor/three/three.module.js';
import config from '../config.js';
import { createTileLoader } from './tile-loader.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import {
    getOrientation,
    saveOrientation,
    clearOrientation,
    getMarkers360,
    isMapTemporalEnabledSync,
    getControl
} from '@store';
import { isTemporallyVisible } from '@js/temporal/temporal-model.js';
import { showSuccess } from '@utils/toast_service.js';
import { LRUCache } from '@utils/lru-cache.js';
import {
    initFloorSelector,
    setActiveFloor,
    getActiveFloor,
    getActiveFloorPlan,
    resetFloorSelector
} from './components/floor-selector-360.js';
import {
    initCompass360,
    updateCompass360,
    destroyCompass360
} from './components/compass-360.js';
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

// Retry config for image fetches (mitigates HTTP/2 proxy errors)
const FETCH_MAX_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 500;

// Escape hatch for on-demand rendering: `?render=always` restores the old
// draw-every-frame behaviour, to isolate a suspected missing invalidation.
const ALWAYS_RENDER = (() => {
    try {
        return new URLSearchParams(window.location.search).get('render') === 'always';
    } catch {
        return false;
    }
})();

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
    // Dirty flag for on-demand rendering (see update()/requestRender())
    needsRender: true,
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
 * Requests a redraw on the next animation frame.
 *
 * Every code path that changes what the viewer shows must call this: camera
 * movement, zoom, resize, texture arrival, photo change, marker changes. If a
 * path is missed the view appears frozen — `?render=always` isolates that.
 */
export function requestRender() {
    streetViewState.needsRender = true;
}

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
 * Resolves once `el` has a non-zero layout size, or after `timeoutMs`.
 *
 * Polls on animation frames rather than awaiting a fixed number of them: the
 * number needed is not a property of the code, it is a property of how much else
 * the browser is doing. On a warm app one frame suffices; on a cold boot (a shared
 * link opening the viewer while the rest of the app still lays out) it can be many.
 *
 * Resolving on TIMEOUT rather than rejecting is deliberate — the caller can still
 * build a viewer that is merely mis-sized, and `onWindowResize()` afterwards can
 * repair that. Throwing here would trade a bad size for no viewer at all.
 *
 * @param {HTMLElement|null} el - Element to wait on
 * @param {number} [timeoutMs=3000] - Give up after this long
 * @returns {Promise<boolean>} true if a real size was observed, false on timeout
 */
function waitForElementSize(el, timeoutMs = 3000) {
    if (!el) return Promise.resolve(false);
    if (el.clientWidth > 0 && el.clientHeight > 0) return Promise.resolve(true);

    return new Promise(resolve => {
        const deadline = performance.now() + timeoutMs;
        const check = () => {
            if (el.clientWidth > 0 && el.clientHeight > 0) {
                resolve(true);
                return;
            }
            if (performance.now() >= deadline) {
                console.warn(
                    '[street-view-viewer] container still has no size after',
                    timeoutMs, 'ms — initializing anyway'
                );
                resolve(false);
                return;
            }
            requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
    });
}

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

    window.addEventListener('resize', onWindowResize);

    // Initialize navigator (lazy load)
    await initNavigator(container);

    // A faixa de bussola entra com o visualizador e sai com ele. Ela nao depende
    // da foto, so do rumo, entao nao ha o que refazer ao navegar.
    initCompass360(container);

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
            () => streetViewState.camera,
            requestRender
        );
        // Vinculo 360 -> minimapa: passar o mouse num marcador acende o ponto
        // correspondente na planta.
        streetViewState.navigator.onHoverChange = setMinimapHoveredPhoto;
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
    // Capture the photo we are navigating FROM before overwriting currentPhotoName,
    // so the STREETVIEW_360_PHOTO_CHANGED payload carries a real previousPhoto.
    const previousPhotoName = streetViewState.currentPhotoName;
    const data = await loadMetadataWithCache(photoName);
    streetViewState.currentInfo = data;
    streetViewState.currentPhotoName = photoName;

    // camera_height is inert in the relative marker model; the navigator only
    // reads lon/lat/heading. (The old DEFAULT_CAMERA_HEIGHT fallback pointed at
    // a constant that no longer exists and fed the removed ground model.)
    const cameraConfig = { ...data.camera };

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

    // Andar da foto que acabou de abrir. Depois do texto e do navigator, para
    // uma falha aqui nao impedir a foto de aparecer.
    await syncFloorSelector(data);

    // Emit photo changed event
    getEventBus().emit(EventTypes.STREETVIEW_360_PHOTO_CHANGED, {
        previousPhoto: previousPhotoName,
        currentPhoto: photoName
    });
}

/**
 * Keeps the floor picker in step with the photo now open.
 *
 * Handles both directions in one place. A click on the strip switches floor and
 * the map layers follow; walking through a cross-floor target switches the
 * photo and THE STRIP follows. Without the second direction the user would take
 * the stairs and the map would stay on the floor they left.
 *
 * @param {Object} data - Photo metadata from the API
 */
async function syncFloorSelector(data) {
    const container = document.getElementById('street-view-container');
    if (!container) return;

    const nivel = data.camera?.floor_level ?? null;

    const temAndares = await initFloorSelector(container, data.projectSlug, {
        initialLevel: nivel,
        onChange: (level, floor) => {
            getEventBus().emit(EventTypes.STREETVIEW_360_FLOOR_CHANGED, {
                level,
                plan: floor?.plan ?? null,
                hasFloors: true
            });
        }
    });

    if (!temAndares) {
        // Projeto externo: manda os mapas voltarem a mostrar tudo, senao um
        // filtro do projeto anterior sobreviveria a troca de levantamento.
        getEventBus().emit(EventTypes.STREETVIEW_360_FLOOR_CHANGED, {
            level: null,
            plan: null,
            hasFloors: false
        });
        return;
    }

    // Atravessou uma escada: o setActiveFloor dispara o onChange sozinho.
    // Quando o andar ja era o mesmo ele devolve false, e ai o emit abaixo cobre
    // a PRIMEIRA montagem, que nao passa pelo onChange.
    if (!setActiveFloor(nivel)) {
        getEventBus().emit(EventTypes.STREETVIEW_360_FLOOR_CHANGED, {
            level: getActiveFloor(),
            plan: getActiveFloorPlan(),
            hasFloors: true
        });
    }
}

/**
 * Active AbortController for the current texture fetch.
 * Aborted when a new photo starts loading before the previous one finishes.
 */
let activeTextureAbort = null;

/**
 * Fetches a URL as a Blob with retry logic to handle transient HTTP/2 proxy errors.
 * Validates Content-Length to detect truncated responses from proxy issues.
 * @param {string} url - URL to fetch
 * @param {object} options - fetch options (may include signal for abort)
 * @param {number} [retries=FETCH_MAX_RETRIES] - remaining retry attempts
 * @returns {Promise<Blob>}
 */
async function fetchBlobWithRetry(url, options, retries = FETCH_MAX_RETRIES) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const expectedLength = response.headers.get('Content-Length');
        if (expectedLength && blob.size !== parseInt(expectedLength, 10)) {
            throw new Error(`Truncated response: got ${blob.size}/${expectedLength} bytes`);
        }
        return blob;
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (retries <= 0) throw error;
        if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        console.warn(`[street-view-viewer] Fetch failed (${retries} retries left): ${error.message}`);
        await new Promise(r => setTimeout(r, FETCH_RETRY_DELAY_MS));
        return fetchBlobWithRetry(url, options, retries - 1);
    }
}

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

// ===== PIRAMIDE DE TILES =====

/**
 * Estado do caminho por tiles.
 *
 * `carregador` e UM so, criado na primeira foto com piramide e reaproveitado por
 * todas as outras: ele guarda bitmaps, fila e requisicoes em voo, e um por foto
 * vazaria tudo isso a cada troca.
 *
 * `controlador` e o AbortController da carga que mandou compor. Ele identifica a
 * carga, e nao a foto: e ele que reprova um tile que chega depois de o operador
 * ja ter andado para a proxima foto.
 *
 * `dados` guarda os metadados da foto em composicao. Eles alimentam DUAS contas:
 * a rotacao da malha que `applyTexture` aplica, e a conversao de camera de
 * `informarCameraAoTiles`.
 */
const tiles = {
    carregador: null,
    texturaPendente: null,
    controlador: null,
    dados: null,
    naEsfera: false
};

// Reaproveitados a cada frame para converter a direcao da camera em coordenada
// da IMAGEM. Alocar no laco de render geraria lixo 60 vezes por segundo.
const _dirImagem = new THREE.Vector3();
const _rotacaoMalha = new THREE.Quaternion();
const _eulerMalha = new THREE.Euler();

/**
 * Cria, uma unica vez, o carregador de tiles deste visualizador.
 *
 * Tardio de proposito: ele le MAX_TEXTURE_SIZE do contexto WebGL, que so existe
 * depois de initThreeJS montar o renderer.
 *
 * A raiz da API NAO vai como parametro: o carregador ja a tira de
 * `config.streetView360.serviceUrl`, a mesma que endereca a foto e a planta.
 * Repeti-la aqui criaria uma segunda maneira de descobri-la, e duas maneiras
 * divergem em silencio.
 *
 * @returns {Object|null} o carregador, ou null se o renderer ainda nao subiu
 */
function garantirCarregadorTiles() {
    if (tiles.carregador) return tiles.carregador;

    const renderer = streetViewState.renderer;
    if (!renderer) return null;

    tiles.carregador = createTileLoader({
        gl: renderer.getContext(),
        onTextura: (textura) => {
            // A textura NAO entra na esfera aqui. O canvas acaba de nascer em
            // branco, e aplica-lo agora piscaria preto ate o preview pintar,
            // justo onde hoje a foto anterior segura a tela. Fica pendente.
            //
            // `deTiles` marca a POSSE: enquanto ela vale, quem descarta a
            // textura e o carregador, que ja troca a sua a cada nivel novo.
            textura.userData = { isFull: true, deTiles: true };
            tiles.texturaPendente = textura;
        },
        onEstatisticas: (estat) => {
            // Ha pintura no canvas: agora ele pode substituir a esfera. O
            // carregador publica estatistica depois do preview e depois de cada
            // tile, entao este e o primeiro instante seguro.
            if (tiles.texturaPendente && estat.msPrimeiraPintura !== null) {
                aplicarTexturaDeTiles();
            }
        }
    });

    // Cache HTTP normal, e nao o `no-store` com que o carregador nasce. Aquele
    // existe para o piloto medir rede; aqui o tile sai `immutable` por um ano e
    // reler do disco e exatamente o ganho que se quer.
    tiles.carregador.ignorarCache('default');
    return tiles.carregador;
}

/**
 * Poe a textura de tiles na esfera.
 *
 * ELA NAO ENTRA NO `textureCache`, e isso nao e esquecimento. O LRU guarda
 * TEXTURE_CACHE_MAX_SIZE = 30 texturas e foi dimensionado para imagens de 30 a
 * 50 MB no TOTAL. A textura de tiles e um canvas: 6144x3072 RGBA custa 75 MB
 * CADA, e o nivel mais fino da piramide do museu_cms (7680x3840) chega a
 * 118 MB. Trinta delas passariam de 2 GB, e o navegador morre. O canvas ainda
 * se refaz a cada troca de nivel, entao guardar a versao velha seria guardar
 * lixo caro.
 */
function aplicarTexturaDeTiles() {
    const nova = tiles.texturaPendente;
    tiles.texturaPendente = null;
    if (!nova || !tiles.dados) return;

    // Carga obsoleta: o operador ja andou para outra foto. A condicao cobra um
    // controlador nao nulo porque `largarTiles` o zera, e `activeTextureAbort`
    // tambem termina nulo depois de um full bem sucedido: dois nulos iguais
    // deixariam passar justamente a textura que se quer barrar.
    if (!tiles.controlador || tiles.controlador !== activeTextureAbort) return;

    tiles.naEsfera = true;
    applyTexture(nova, tiles.dados);
}

/**
 * Diz se a esfera ja mostra a composicao por tiles DESTA carga.
 * O preview nao pode entrar por cima dela: ele chegaria depois e rebaixaria uma
 * imagem que ja esta detalhada.
 * @param {AbortController} controlador - controlador da carga em curso
 * @returns {boolean}
 */
function tilesJaNaEsfera(controlador) {
    return tiles.naEsfera && tiles.controlador === controlador;
}

/**
 * Larga a foto do carregador de tiles e recolhe a textura que ele renuncia.
 * Chamado quando a piramide nao existe, ou falhou, e a esfera volta ao full.
 *
 * O contrato de posse do carregador nao admite descarte em dobro: `soltarFoto`
 * devolve a textura VIVA, e so dai em diante ela e nossa.
 */
function largarTiles() {
    tiles.texturaPendente = null;
    tiles.controlador = null;
    tiles.dados = null;
    tiles.naEsfera = false;
    if (!tiles.carregador) return;

    const orfa = tiles.carregador.soltarFoto();
    if (!orfa) return;

    if (streetViewState.material?.map === orfa) {
        // Ainda na esfera: descartar agora deixaria uma textura morta na tela
        // durante a carga inteira do full. `orfaDeTiles` marca que ela nao tem
        // mais dono, e `applyTexture` a descarta ao tomar o lugar dela. Sem essa
        // marca ninguem a descartaria, porque ela nunca entrou no LRU.
        orfa.userData.deTiles = false;
        orfa.userData.orfaDeTiles = true;
        return;
    }
    orfa.dispose();
}

/**
 * Destroi o carregador de tiles e o estado dele. So para o teardown da cena.
 */
function descartarCarregadorTiles() {
    tiles.texturaPendente = null;
    tiles.controlador = null;
    tiles.dados = null;
    tiles.naEsfera = false;
    if (!tiles.carregador) return;

    tiles.carregador.dispose();
    tiles.carregador = null;
}

/**
 * Diz ao carregador de tiles para onde a camera olha, em coordenada da IMAGEM.
 *
 * A CONVERSAO E OBRIGATORIA, e nao um refinamento. A malha carrega as rotacoes
 * da calibracao (mesh_rotation_y vale 180 por padrao), entao o `lon` da camera e
 * a longitude da equirretangular diferem por essa rotacao: entregar o lon cru
 * pediria a coluna errada de tiles, e o sintoma seria borrao nas costas do
 * operador, sem erro nenhum no console. Desfazer a rotacao da malha pelo
 * quaternion inverso resolve os tres eixos de uma vez, e nao so o Y.
 *
 * A rotacao sai dos METADADOS, e nao de `mesh.rotation`. As duas sao a mesma
 * coisa depois que a foto entra na esfera, mas durante a troca de foto a malha
 * ainda carrega a calibracao da ANTERIOR, e e justo ai que o carregador escolhe
 * o primeiro conjunto de tiles. A ordem de Euler tem de ser a mesma ZXY que
 * `applyTexture` usa, senao as duas contas divergem quando X ou Z nao sao zero.
 *
 * Chamado a cada frame: a comparacao la dentro e barata e o recalculo pesado
 * fica no debounce do carregador.
 */
function informarCameraAoTiles() {
    const carregador = tiles.carregador;
    const renderer = streetViewState.renderer;
    const camera = streetViewState.camera;
    if (!carregador || !renderer || !camera || !tiles.dados) return;

    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    _dirImagem.set(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
    );

    _eulerMalha.set(
        THREE.MathUtils.degToRad(getMeshRotationX(tiles.dados)),
        THREE.MathUtils.degToRad(getMeshRotationY(tiles.dados)),
        THREE.MathUtils.degToRad(getMeshRotationZ(tiles.dados)),
        'ZXY'
    );
    _rotacaoMalha.setFromEuler(_eulerMalha).invert();
    _dirImagem.applyQuaternion(_rotacaoMalha);

    // O acos pede o argumento preso em [-1, 1]: erro de ponto flutuante devolve
    // 1.0000000000000002 no zenite, e o NaN que sai daqui contamina a escolha.
    const y = Math.min(1, Math.max(-1, _dirImagem.y));
    const latImagem = 90 - THREE.MathUtils.radToDeg(Math.acos(y));
    const lonImagem = THREE.MathUtils.radToDeg(Math.atan2(_dirImagem.z, _dirImagem.x));

    // A largura do BUFFER, que ja inclui o devicePixelRatio, e nao a do
    // container: e o numero que a conta de largura necessaria pede.
    //
    // E AQUI QUE O ZOOM MANDA NO NIVEL. A fov cai de 75 para 10, a largura
    // necessaria cresce quase sete vezes, e o carregador sobe de nivel assim que
    // a histerese dele solta. Sem esta linha o zoom ficaria borrado justo onde o
    // full de hoje mostra detalhe.
    carregador.atualizarCamera({
        lon: lonImagem,
        lat: latImagem,
        fov: camera.fov,
        largura: renderer.domElement.width,
        altura: renderer.domElement.height
    });
}

/**
 * Tenta compor a panoramica pela piramide de tiles.
 *
 * @param {string} photoId - uuid da foto
 * @param {Object} data - metadados da foto, para rotacao e conversao de camera
 * @param {AbortController} controlador - controlador desta carga
 * @returns {Promise<boolean>} true quando o full NAO deve ser carregado, ou
 *   porque os tiles assumiram, ou porque uma carga mais nova mandou
 */
async function tentarTiles(photoId, data, controlador) {
    const carregador = garantirCarregadorTiles();
    if (!carregador || !photoId) return false;

    tiles.controlador = controlador;
    tiles.dados = data;
    tiles.naEsfera = false;
    tiles.texturaPendente = null;

    // A camera vai ANTES do pedido. O carregador escolhe nivel e conjunto
    // visivel na hora em que le o descritor, e sem esta linha a primeira foto da
    // sessao usaria a camera padrao dele (1920x1080, fov 75, olhando o meridiano
    // zero) e baixaria tiles que o operador nao esta vendo.
    informarCameraAoTiles();

    try {
        // Devolve o descritor, ou null quando outra foto tomou o lugar desta no
        // meio do caminho. Os dois casos mandam a mesma coisa aqui: o full desta
        // carga nao entra, ou desenharia a foto velha por cima da nova.
        await carregador.carregarFoto(photoId);
        return true;
    } catch (error) {
        // Carga obsoleta: o carregador ja e de outra foto, e mexer nele agora
        // atrapalharia quem chegou depois. O abort da foto anterior tambem cai
        // aqui, e e este o ramo certo para ele.
        if (error?.name === 'AbortError' || activeTextureAbort !== controlador) return true;

        // 404 e o CAMINHO NORMAL, e nao excecao: 28 dos 29 projetos nao tem
        // piramide gerada. So o que nao for 404 merece barulho no console.
        if (error?.status !== 404) {
            console.warn('[street-view-viewer] Tiles indisponiveis, caindo no full:', error);
        }
        largarTiles();
        return false;
    }
}

/**
 * Loads a texture for the panorama sphere with progressive loading.
 * When the API service is available, loads a low-res preview first
 * for instant feedback, then tiles (when the photo has a pyramid) or the
 * full-res image. Cancels any in-flight fetch when a new load is requested.
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
        // O carregador tem de largar a foto ANTERIOR aqui. Sem isso ele seguiria
        // baixando os tiles dela, e o debounce da camera repintaria o canvas
        // velho por cima desta foto.
        largarTiles();
        const texture = streetViewState.textureCache.get(fullCacheKey);
        applyTexture(texture, data);
        return;
    }

    const controller = new AbortController();
    activeTextureAbort = controller;

    const { getPhotoImageUrl } = await import('./streetview-api.service.js');

    // A sonda do tiles.json parte JUNTO do preview, e nao depois dele. Ela
    // responde 404 na esmagadora maioria das fotos, e enfileira-la atras do
    // preview atrasaria o full de todo mundo em uma volta de rede inteira.
    const sonda = tentarTiles(photoId, data, controller);

    // Phase 1: Load preview for instant feedback
    try {
        if (streetViewState.textureCache.has(previewCacheKey)) {
            if (!tilesJaNaEsfera(controller)) {
                applyTexture(streetViewState.textureCache.get(previewCacheKey), data);
            }
        } else {
            const previewUrl = getPhotoImageUrl(photoId, 'preview');
            const previewBlob = await fetchBlobWithRetry(previewUrl, { signal: controller.signal });
            if (activeTextureAbort !== controller) return;

            const previewTexture = await blobToTexture(previewBlob);
            streetViewState.textureCache.set(previewCacheKey, previewTexture);

            // A composicao por tiles pode ter vencido a corrida com o preview: os
            // dois partiram juntos, e o fundo do carregador e um WebP de 13 KB.
            // Aplicar o preview por cima dela rebaixaria a imagem.
            if (activeTextureAbort === controller && !tilesJaNaEsfera(controller)) {
                applyTexture(previewTexture, data);
            }
        }
    } catch (error) {
        // Preview is best-effort; continue to full-res load
        if (error.name === 'AbortError') return;
        console.warn('[street-view-viewer] Preview load failed (continuing to full-res):', error);
    }

    // Phase 2: a piramide, quando a foto tiver uma. O carregador ja assumiu a
    // esfera, e o full nao entra: baixa-lo pagaria os 2,5 MB que os tiles
    // existem para nao pagar.
    if (await sonda) {
        if (activeTextureAbort !== controller) return;
        if (data.targets) {
            prefetchTargetPreviews(data.targets);
        }
        return;
    }

    // Phase 3: Load full-resolution image. Sem piramide, o caminho de sempre.
    try {
        const fullUrl = getPhotoImageUrl(photoId, 'full');
        const blob = await fetchBlobWithRetry(fullUrl, { signal: controller.signal });

        if (activeTextureAbort !== controller) return;

        const fullTexture = await blobToTexture(blob);
        if (activeTextureAbort !== controller) return;
        activeTextureAbort = null;
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

        // Low-priority background fetch with retry
        fetchBlobWithRetry(getPhotoImageUrl(targetId, 'preview'), { priority: 'low' }, 1)
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
 * Descarta a textura que SAI da esfera, e so ela.
 *
 * Quase nenhuma textura passa por aqui: preview e full vivem no `textureCache`,
 * que ja descarta sozinho o que despeja, e descartar de novo mataria uma textura
 * que o LRU ainda considera viva. A textura de tiles e a excecao, porque nunca
 * entra no cache (ver `aplicarTexturaDeTiles`). Enquanto o carregador for dono
 * dela quem descarta e ele; depois de `largarTiles` ela fica marcada como orfa,
 * e ai ninguem mais a descartaria.
 *
 * @param {THREE.Texture|null} antiga - textura que estava na esfera
 * @param {THREE.Texture} nova - textura que assume
 */
function descartarSeOrfaDeTiles(antiga, nova) {
    if (!antiga || antiga === nova) return;
    if (!antiga.userData?.orfaDeTiles) return;
    antiga.dispose();
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
        descartarSeOrfaDeTiles(streetViewState.material.map, texture);
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

    // A new texture (preview or full) changes what is on screen without touching
    // the camera, so the dirty flag has to be raised explicitly.
    requestRender();
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
    const sourceId = control?.pointsSourceRef?.id;
    if (!sourceId || !miniMap.getSource(sourceId)) return;

    // Need the icon image
    if (!miniMap.hasImage('point-selected')) return;

    const sourceLayer = control?.pointsSourceRef?.sourceLayer
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
 * Ensures the minimap has a layer that highlights the photo under the pointer.
 *
 * Built the same way as the 'selected' layer, and for the same reason: the
 * minimap draws every photo from the vector tiles, so highlighting one is a
 * matter of filtering a layer, not of adding a marker.
 *
 * A CIRCLE, deliberately, and NOT the 'point-selected' icon this reused before.
 * That icon is an ARROW: it means "you are here, looking that way", and it is
 * rotated by setIconDirection to carry the heading. Borrowing it for hover put a
 * direction arrow on a photo whose direction is irrelevant — the pointer is
 * merely passing over it — and made the hovered photo indistinguishable from the
 * one the operator is actually standing in. A ring states "this one" and nothing
 * more, which is the entire meaning of hover.
 */
function ensureHoveredLayer() {
    const miniMap = streetViewState.miniMap;
    if (!miniMap || miniMap.getLayer('hovered')) return;

    const control = streetViewState.controlInstance;
    const sourceId = control?.pointsSourceRef?.id;
    if (!sourceId || !miniMap.getSource(sourceId)) return;

    const sourceLayer = control?.pointsSourceRef?.sourceLayer
        || config.streetView360?.pointsSourceLayer
        || 'fotos';

    miniMap.addLayer({
        'id': 'hovered',
        'type': 'circle',
        'source': sourceId,
        'source-layer': sourceLayer,
        'filter': ['==', PHOTO_PROPERTY, ''],
        'paint': {
            // Hollow ring: the photo dot underneath stays visible inside it, so the
            // highlight adds emphasis instead of covering what it points at.
            'circle-radius': 9,
            'circle-color': 'rgba(0, 0, 0, 0)',
            'circle-stroke-width': 3,
            // --color-warning (design-tokens.css): distinct from the red 'selected'
            // pin and from the blue trajectory lines, so all three read apart.
            'circle-stroke-color': '#f59e0b'
        }
    });
}

/**
 * Highlights on the minimap the target the pointer is over in the 360 view.
 *
 * One half of a two-way link: pointing at a sphere in the photograph lights up
 * where it is on the map, so the operator can tell which way out is which
 * without walking there first.
 *
 * @param {string|null} photoId - Photo UUID, or null to clear
 */
export function setMinimapHoveredPhoto(photoId) {
    const miniMap = streetViewState.miniMap;
    if (!miniMap) return;

    ensureHoveredLayer();
    if (!miniMap.getLayer('hovered')) return;

    miniMap.setFilter('hovered', ['==', PHOTO_PROPERTY, photoId ?? '']);
}

/**
 * Highlights in the 360 view the target the pointer is over ON THE MINIMAP.
 * The other half of the link.
 *
 * @param {string|null} photoId - Photo UUID, or null to clear
 */
export function setHoveredFromMinimap(photoId) {
    const navigator = streetViewState.navigator;
    if (!navigator?.renderer) return;

    navigator.renderer.setHoveredMarker(photoId);
    setMinimapHoveredPhoto(photoId);
    requestRender();
}

/**
 * Updates minimap position and icon
 */
function updateMiniMap(camera) {
    const miniMap = streetViewState.miniMap;
    if (!miniMap) return;

    // The minimap shares the viewer's opening race (see waitForElementSize): on a
    // deep link its container is still 0×0 when the first photo lands. A MapLibre
    // map with no size cannot fly anywhere — the animation resolves against a
    // zero-sized viewport and the map stays at its initial centre, which is why a
    // shared link used to show a blank blue square: that is the ocean at 0°,0°,
    // and the tiles it requested were literally z12/2048/2048.
    //
    // So: give it its size first, and JUMP rather than fly for that first framing.
    // Flying from null island to Brazil is a 500 ms sweep across the planet that
    // nobody asked to watch; later moves, between neighbouring photos, still fly.
    const container = miniMap.getContainer();
    const wasUnsized = !container || container.clientWidth === 0 || container.clientHeight === 0;
    if (wasUnsized) {
        miniMap.resize();
    }

    const move = wasUnsized ? miniMap.jumpTo.bind(miniMap) : miniMap.flyTo.bind(miniMap);
    move({
        center: [camera.lon, camera.lat],
        zoom: 17,
        ...(wasUnsized ? {} : { duration: 500 })
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
 * Sets the minimap icon direction.
 *
 * The 'selected' pin is ALREADY directional — its icon is an arrow, rotated here
 * to the current view heading. A separate translucent triangle (the "view cone")
 * used to be drawn on top of it as a second direction indicator; it was removed
 * because two marks for one fact read as two facts, and the cone's apex sat on
 * the same point as the pin, so the pair looked like a rendering artifact rather
 * than a field of view.
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
    updateCompass360(worldHeading);
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
// rAF handle of an in-flight turnViewBy() sweep (null when not turning).
let turnAnimationId = null;

/** Stops an in-flight automatic view turn, leaving the view where it got to. */
function cancelViewTurn() {
    if (turnAnimationId !== null) {
        cancelAnimationFrame(turnAnimationId);
        turnAnimationId = null;
    }
}

// Reusable Vector3 for lookAt target (avoids allocation in render loop)
const _lookAtTarget = new THREE.Vector3();

function onPointerDown(event) {
    if (event.isPrimary === false) return;

    // A drag takes precedence over an automatic sweep: leaving the turn running
    // would fight the pointer for `lon` and the view would drift under the hand.
    cancelViewTurn();

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

// Last state the viewer was actually drawn with, for change detection.
const _lastDrawn = { lon: null, lat: null, fov: null, width: 0, height: 0 };

/**
 * Detects whether anything about the camera changed since the last drawn frame.
 *
 * Comparing the resulting state is deliberate: the camera is mutated from many
 * places (drag, wheel, pinch, keyboard, saved orientations, deep links, external
 * setCameraFOV), and requiring each of them to remember to invalidate would be a
 * standing invitation to a frozen screen.
 *
 * @returns {boolean} True when the scene must be redrawn
 */
function cameraChangedSinceLastFrame() {
    const camera = streetViewState.camera;
    if (!camera) return false;

    const canvas = streetViewState.renderer?.domElement;
    const width = canvas?.width ?? 0;
    const height = canvas?.height ?? 0;

    if (
        _lastDrawn.lon === lon &&
        _lastDrawn.lat === lat &&
        _lastDrawn.fov === camera.fov &&
        _lastDrawn.width === width &&
        _lastDrawn.height === height
    ) {
        return false;
    }

    _lastDrawn.lon = lon;
    _lastDrawn.lat = lat;
    _lastDrawn.fov = camera.fov;
    _lastDrawn.width = width;
    _lastDrawn.height = height;
    return true;
}

/**
 * Update function called each frame.
 *
 * The camera math is cheap and always runs, but the two expensive draws (the
 * WebGL scene and the Canvas 2D navigation overlay) only fire when something
 * actually changed. A still scene therefore costs almost nothing, which matters
 * on the tablets used in the field.
 */
function update() {
    // Os dois passos dos tiles ficam ANTES da guarda de frame parado, e nao
    // depois: o carregador precisa saber da camera mesmo quando nada mudou, e o
    // tile que chega com a camera parada tem de acender a cena sozinho, senao
    // ele fica invisivel ate o operador encostar no mouse.
    informarCameraAoTiles();

    // Uma unica subida de textura por frame: por tile, cada needsUpdate
    // reenviaria o canvas INTEIRO para a GPU.
    if (tiles.carregador?.aplicarAtualizacoes()) {
        streetViewState.needsRender = true;
    }

    if (!cameraChangedSinceLastFrame() && !streetViewState.needsRender && !ALWAYS_RENDER) {
        return;
    }
    streetViewState.needsRender = false;

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
 * Filters 360 markers by temporal validity when the active map has the temporal
 * module enabled. When temporal is off (or the cursor is unavailable/NaN) every
 * marker is returned unchanged.
 * @param {Array} markers - Markers for the current photo.
 * @returns {Array} Markers visible at the current temporal cursor.
 */
function filterMarkersByTemporal(markers) {
    if (!isMapTemporalEnabledSync()) return markers;

    const cursor = getControl('TemporalControl')?.getCursor();
    if (!Number.isFinite(cursor)) return markers;

    return markers.filter(marker => isTemporallyVisible(marker.properties, cursor));
}

/**
 * Loads and displays markers for the current photo, applying the temporal
 * visibility filter. Re-running this (e.g. on cursor change) replaces the
 * navigator POI set, so markers that fall outside the active temporal window
 * are removed from the panorama.
 */
// Signature (visible marker ids) of the POI set currently applied to the
// navigator, so temporal refreshes can skip rebuilds when nothing changed.
let lastTemporalPoiSignature = null;

async function loadMarkersForCurrentPhoto() {
    if (!streetViewState.navigator || !streetViewState.currentPhotoName) return;

    try {
        const markers = await getMarkers360(streetViewState.currentPhotoName);
        const visible = filterMarkersByTemporal(markers);
        lastTemporalPoiSignature = visible.map(m => m.id).join(',');
        streetViewState.navigator.setPOIs(visible);
    } catch (error) {
        console.error('Failed to load markers:', error);
    }
}

/**
 * Re-applies the temporal filter to the current photo's markers when the
 * timeline cursor moves or the map temporal config changes. TEMPORAL_CURSOR_CHANGED
 * fires every animation frame during playback, so the POI set is rebuilt only
 * when the set of visible markers actually changes.
 */
async function handleTemporalRefresh() {
    if (!streetViewState.isVisible || !streetViewState.navigator || !streetViewState.currentPhotoName) return;

    try {
        const markers = await getMarkers360(streetViewState.currentPhotoName);
        const visible = filterMarkersByTemporal(markers);
        const signature = visible.map(m => m.id).join(',');
        if (signature === lastTemporalPoiSignature) return;
        lastTemporalPoiSignature = signature;
        streetViewState.navigator.setPOIs(visible);
    } catch (error) {
        console.error('Failed to refresh 360 markers:', error);
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

    eventBus.off(EventTypes.TEMPORAL_CURSOR_CHANGED, handleTemporalRefresh);
    eventBus.on(EventTypes.TEMPORAL_CURSOR_CHANGED, handleTemporalRefresh);

    eventBus.off(EventTypes.MAP_TEMPORAL_CHANGED, handleTemporalRefresh);
    eventBus.on(EventTypes.MAP_TEMPORAL_CHANGED, handleTemporalRefresh);

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
            // Wait for the container to actually HAVE a size before building the
            // renderer, because initThreeJS reads clientWidth/clientHeight and a
            // 0×0 read is unrecoverable: the WebGL canvas keeps its default
            // 300×150 and the panorama renders black forever after.
            //
            // This used to await a single rAF, on the assumption that one frame
            // is enough for the reflow from setFullMap(false). It is enough when
            // the app is already up and the operator clicks a photo — and NOT
            // enough on a shared deep link, where the viewer opens during boot and
            // the container is still 0×0 a frame later. Symptom: black panorama,
            // no error anywhere, every network request a clean 200.
            await waitForElementSize(document.getElementById('street-view-container'));

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
                streetViewState.miniMapSourceDataHandler = null;
            }
        };
        // Track the handler so closeViewer360 can detach it if the 'selected' layer
        // never gets created (e.g. viewer closed before tiles load) — otherwise it
        // keeps firing on the persistent minimap for the rest of the session.
        streetViewState.miniMapSourceDataHandler = onSourceData;
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

    // An automatic turn outlives the viewer otherwise: its rAF keeps firing and
    // keeps calling requestRender on a torn-down scene.
    cancelViewTurn();

    // Deselect POI
    if (streetViewState.navigator) {
        streetViewState.navigator.deselectPOI();
    }

    // Deactivate current tool
    deactivateCurrentTool360();

    // Pause rendering
    pauseRendering();

    // Detach the deep-link minimap retry listener if it never self-removed.
    if (streetViewState.miniMap && streetViewState.miniMapSourceDataHandler) {
        streetViewState.miniMap.off('sourcedata', streetViewState.miniMapSourceDataHandler);
        streetViewState.miniMapSourceDataHandler = null;
    }

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
    eventBus.off(EventTypes.TEMPORAL_CURSOR_CHANGED, handleTemporalRefresh);
    eventBus.off(EventTypes.MAP_TEMPORAL_CHANGED, handleTemporalRefresh);

    // O seletor sai junto com o visualizador, cache de projeto incluido: manter
    // os andares do levantamento anterior faria a proxima abertura mostrar uma
    // barra com andares que a nova nao tem.
    resetFloorSelector();

    // A faixa de bussola NAO sai aqui, ao contrario do seletor de andar. Fechar
    // o visualizador so pausa a cena: o initThreeJS roda uma vez so, e reabrir
    // cai no ramo "resume". Destruir a faixa no fechamento a apagaria a partir da
    // segunda abertura, sem erro nenhum. Ela sai no dispose, com a cena.
    // O container fica display:none enquanto fechado, entao ela nao aparece.

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
 * Turns the view by a RELATIVE azimuth, animating the sweep.
 *
 * Used by the edge arrows: an arrow says "there is a target off to that side", so
 * acting on it should bring it INTO VIEW, not teleport the operator to it. The
 * turn is animated because an instant snap gives no sense of which way the view
 * swung, and losing your bearing is the one thing a panorama must not do.
 *
 * `lon` is the yaw offset from the photo's own heading, and increasing it turns
 * clockwise (the same convention as `updateCurrentHeading`), so a positive
 * `deltaDeg` (a target to the RIGHT) turns right.
 *
 * @param {number} deltaDeg - Relative azimuth to turn by, in degrees
 * @param {number} [durationMs=450] - Sweep duration; 0 applies it immediately
 */
export function turnViewBy(deltaDeg, durationMs = 450) {
    if (!streetViewState.camera || !Number.isFinite(deltaDeg)) return;

    if (durationMs <= 0) {
        lon += deltaDeg;
        requestRender();
        return;
    }

    // A new turn supersedes one still in flight; otherwise two sweeps fight over
    // `lon` and the view stutters between them.
    cancelViewTurn();

    const startLon = lon;
    const startedAt = performance.now();

    const step = (now) => {
        const t = Math.min(1, (now - startedAt) / durationMs);
        // easeInOutQuad: starts and ends still, so the sweep reads as deliberate.
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        lon = startLon + deltaDeg * eased;
        requestRender();

        if (t < 1) {
            turnAnimationId = requestAnimationFrame(step);
        } else {
            turnAnimationId = null;
        }
    };

    turnAnimationId = requestAnimationFrame(step);
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

    // O carregador de tiles sai ANTES da malha, e o `dispose()` dele ja descarta
    // a textura que ainda for sua. Soltar a referencia em seguida impede o
    // descarte em dobro logo abaixo, que mataria a mesma textura duas vezes.
    descartarCarregadorTiles();
    if (streetViewState.material?.map?.userData?.deTiles) {
        streetViewState.material.map = null;
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

    // A faixa de bussola sai com a cena, e nao com o fechamento: e aqui que o
    // initThreeJS volta a poder rodar, entao e aqui que a faixa pode ser refeita.
    destroyCompass360();

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

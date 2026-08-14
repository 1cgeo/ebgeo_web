// Path: js/calibration/preview-viewer.js
/**
 * @fileoverview Mini preview viewer for the calibration interface.
 * Two modes:
 * - Rear view (default): shows the current photo rotated 180°, green border,
 *   camera slaved to main viewer (opposite direction), markers rendered on overlay
 * - Target view: shows the selected target's photo, orange border, action buttons,
 *   independent camera orbit
 */

import * as THREE from '../../vendor/three/three.module.js';
import { getPhotoImageUrl } from './api.js';
import { StreetViewProjector } from './projector.js';
import { state, isTargetHidden, onChange } from './state.js';
import { drawArmillarySphere, rankOpacity } from './renderer.js';
import { layoutDirections } from './navigator.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const PREVIEW_WIDTH = 576;
const PREVIEW_HEIGHT = 396;

// Border and label colors per view mode live in `css/calibracao.css`, on the
// `.cal-preview--rear` / `.cal-preview--target` modifiers.


// ============================================================================
// MODULE STATE
// ============================================================================

let camera, scene, renderer, sphere, material;
let containerEl = null;
let canvasEl = null;
let navigateBtn = null;
let addTargetBtn = null;
let closeBtn = null;
let hideTargetBtn = null;
let animationFrameId = null;
let onNavigateCallback = null;
let onCloseCallback = null;
let onAddTargetCallback = null;
let onHideCallback = null;
let unsubscribeStateChange = null;

// Camera orbit
let lon = 0;
let lat = 0;
const fov = 75;

// Drag state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartLon = 0;
let dragStartLat = 0;

// Current state
let currentTargetId = null;
let currentMode = 'rear'; // 'rear' | 'target'
let rearPhotoId = null;
// Foto cuja textura esta atualmente aplicada na esfera (evita recarregar a
// mesma textura ao alternar target -> rear quando nada mudou).
let currentSpherePhotoId = null;
let rearRotationY = 180;
let rearRotationX = 0;
let rearRotationZ = 0;

// Marker overlay (rear view only)
let markerCanvas = null;
let markerCtx = null;
let markerProjector = null;
let rearTargets = [];
let rearCameraConfig = null;

// Reusable Vector3
const _lookAtTarget = new THREE.Vector3();
const textureLoader = new THREE.TextureLoader();

// Token de geracao para descartar carregamentos de textura obsoletos quando
// showRearView/showPreview/hidePreview sao chamados em sequencia rapida.
let loadGeneration = 0;

// Config reutilizavel do projetor de markers (evita alocar objeto por frame).
const _rearProjectorConfig = {};
// Assinatura do ultimo config aplicado ao projetor (evita setCameraConfig por frame).
let _lastRearConfigKey = '';

// ── Dirty-check dos markers do rear view ──
// Redesenha os markers apenas quando a camera (lon/lat) ou o estado relevante
// muda, em vez de a cada frame. Saida visual identica.
let rearMarkersDirty = true;
let _lastRearMarkerLon = NaN;
let _lastRearMarkerLat = NaN;

// ── Dirty-check da cena Three.js do preview ──
// O painel e pequeno e passa a maior parte do tempo estatico (a visao traseira
// so se move quando o visualizador principal gira). Sem isto o painel executava
// um lookAt + renderer.render por frame indefinidamente, inclusive escondido e
// atras do mapa do projeto, que tem o proprio contexto WebGL.
let previewNeedsRender = true;
let _lastRenderLon = NaN;
let _lastRenderLat = NaN;

/**
 * Marca a cena do preview para um novo render no proximo frame.
 */
function markPreviewNeedsRender() {
    previewNeedsRender = true;
}

/**
 * Applies the view-mode modifier on the container. Border color and label color
 * are fixed per mode and live in `css/calibracao.css`, on the
 * `.cal-preview--rear` / `.cal-preview--target` modifiers.
 * @param {'rear'|'target'} mode - The view mode to apply
 */
function applyModeClass(mode) {
    if (!containerEl) return;
    containerEl.classList.toggle('cal-preview--rear', mode === 'rear');
    containerEl.classList.toggle('cal-preview--target', mode === 'target');
}

/**
 * Marca os markers do rear view para redesenho no proximo frame.
 */
function markRearMarkersDirty() {
    rearMarkersDirty = true;
    // Os markers sao desenhados num canvas 2D sobreposto, mas o estado que os
    // move (rotacoes de malha, selecao) tambem gira a esfera.
    markPreviewNeedsRender();
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Creates the preview viewer container and Three.js scene.
 * @param {HTMLElement} parentContainer - The viewer container to append to
 * @param {Object} [options] - Options
 * @param {Function} [options.onNavigate] - Called with photoId when user clicks navigate button
 * @param {Function} [options.onClose] - Called when close button is clicked
 */
export function initPreviewViewer(parentContainer, options = {}) {
    onNavigateCallback = options.onNavigate || null;
    onCloseCallback = options.onClose || null;

    // Create overlay container
    containerEl = document.createElement('div');
    containerEl.id = 'preview-viewer';
    containerEl.classList.add('cal-preview');
    applyModeClass('rear');
    // Size stays in JS: the very same constants drive the WebGL renderer and the
    // marker canvas, so repeating them in the stylesheet would let the container
    // and the canvas drift apart.
    containerEl.style.width = `${PREVIEW_WIDTH}px`;
    containerEl.style.height = `${PREVIEW_HEIGHT}px`;
    // Visibility is runtime state, toggled by show*/hide* below.
    containerEl.style.display = 'none';
    parentContainer.appendChild(containerEl);

    // Label
    const label = document.createElement('div');
    label.id = 'preview-viewer-label';
    label.classList.add('cal-preview__label');
    containerEl.appendChild(label);

    // Close button
    closeBtn = document.createElement('button');
    closeBtn.id = 'preview-viewer-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.classList.add('cal-preview__close');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onCloseCallback) onCloseCallback();
    });
    containerEl.appendChild(closeBtn);

    // Navigate button
    navigateBtn = document.createElement('button');
    navigateBtn.id = 'preview-viewer-navigate';
    navigateBtn.textContent = 'Ir para esta foto \u2192';
    navigateBtn.classList.add('cal-preview__btn', 'cal-preview__btn--navigate');
    navigateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onNavigateCallback && currentTargetId) onNavigateCallback(currentTargetId);
    });
    containerEl.appendChild(navigateBtn);

    // Add target button (for nearby photos)
    addTargetBtn = document.createElement('button');
    addTargetBtn.id = 'preview-viewer-add';
    addTargetBtn.textContent = 'Adicionar Conexao';
    addTargetBtn.classList.add('cal-preview__btn', 'cal-preview__btn--add');
    addTargetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onAddTargetCallback && currentTargetId) onAddTargetCallback(currentTargetId);
    });
    containerEl.appendChild(addTargetBtn);

    // Hide target button
    hideTargetBtn = document.createElement('button');
    hideTargetBtn.id = 'preview-viewer-hide';
    hideTargetBtn.textContent = 'Ocultar';
    hideTargetBtn.classList.add('cal-preview__btn', 'cal-preview__btn--hide');
    hideTargetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onHideCallback) onHideCallback();
    });
    containerEl.appendChild(hideTargetBtn);

    // Every action button starts hidden; show*/hide* below drive them.
    hideAllButtons();

    // ── Three.js setup ──
    camera = new THREE.PerspectiveCamera(75, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.1, 1000);
    camera.position.set(0, -0.1, 0);
    camera.rotation.order = 'YXZ';

    scene = new THREE.Scene();
    scene.add(camera);

    const geometry = new THREE.SphereGeometry(500, 40, 30);
    geometry.scale(-1, 1, 1);

    material = new THREE.MeshBasicMaterial({ color: 0x111111 });
    sphere = new THREE.Mesh(geometry, material);
    sphere.rotation.order = 'ZXY'; // Match main viewer rotation order
    scene.add(sphere);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT);

    canvasEl = renderer.domElement;
    canvasEl.classList.add('cal-preview__canvas');
    containerEl.appendChild(canvasEl);

    // ── Marker overlay canvas (for rear view markers) ──
    markerCanvas = document.createElement('canvas');
    markerCanvas.width = PREVIEW_WIDTH;
    markerCanvas.height = PREVIEW_HEIGHT;
    markerCanvas.classList.add('cal-preview__overlay');
    containerEl.appendChild(markerCanvas);
    markerCtx = markerCanvas.getContext('2d');
    markerProjector = new StreetViewProjector(PREVIEW_WIDTH, PREVIEW_HEIGHT);

    // Events (for orbiting the preview — only active in target mode)
    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', onPointerUp);

    // Prevent clicks from propagating to main viewer
    containerEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    containerEl.addEventListener('click', (e) => e.stopPropagation());
    containerEl.addEventListener('wheel', (e) => e.stopPropagation());

    // Qualquer mudanca de estado (selecao, override, hidden, sliders) redesenha
    // os markers do rear view no proximo frame.
    unsubscribeStateChange = onChange(markRearMarkersDirty);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Shows the rear view of the current photo (rotated 180°).
 * @param {string} photoId - Current photo UUID
 * @param {number} meshRotationY - Current mesh rotation Y in degrees
 * @param {number} [meshRotationX=0] - Current mesh rotation X in degrees
 * @param {number} [meshRotationZ=0] - Current mesh rotation Z in degrees
 */
export async function showRearView(photoId, meshRotationY, meshRotationX = 0, meshRotationZ = 0) {
    if (!containerEl) return;

    currentMode = 'rear';
    currentTargetId = null;
    rearRotationY = meshRotationY;
    rearRotationX = meshRotationX;
    rearRotationZ = meshRotationZ;
    markRearMarkersDirty();

    // Set rear view appearance
    applyModeClass('rear');
    const label = document.getElementById('preview-viewer-label');
    if (label) {
        label.textContent = 'Visao Traseira';
    }

    // Hide all action buttons in rear view
    hideAllButtons();

    // Set sphere rotation (180° offset on Y, negate X/Z for rear view).
    // With Euler order ZXY (Rz·Rx·Ry), flipping Y by 180° inverts the
    // local X and Z axes, so corrections must be negated to stay aligned.
    if (sphere) {
        sphere.rotation.y = THREE.MathUtils.degToRad(meshRotationY + 180);
        sphere.rotation.x = THREE.MathUtils.degToRad(-meshRotationX);
        sphere.rotation.z = THREE.MathUtils.degToRad(-meshRotationZ);
    }

    // Reset camera orbit
    lon = 0;
    lat = 0;

    containerEl.style.display = 'block';
    markPreviewNeedsRender();

    // Start animation if not running
    if (!animationFrameId) animate();

    // Recarrega a textura quando muda a foto traseira OU quando a esfera nao
    // esta exibindo essa foto (ex.: voltando de um target via showPreview sem
    // passar por hidePreview). Sem isso, a esfera ficaria com a imagem do
    // target enquanto o modo ja e 'rear'.
    if (rearPhotoId !== photoId || currentSpherePhotoId !== photoId) {
        rearPhotoId = photoId;
        currentSpherePhotoId = photoId;

        const generation = ++loadGeneration;
        const previewUrl = getPhotoImageUrl(photoId, 'preview');
        const fullUrl = getPhotoImageUrl(photoId, 'full');

        try {
            await loadTexture(previewUrl, true, generation);
        } catch {
            // Preview failed
        }

        if (currentMode === 'rear' && rearPhotoId === photoId) {
            try {
                await loadTexture(fullUrl, false, generation);
            } catch (err) {
                console.error('Preview viewer: failed to load full image:', err);
            }
        }
    }
}

/**
 * Updates the rear view rotation when calibration parameters change.
 * Only acts in rear view mode.
 * @param {number} meshRotationY - Current mesh rotation Y in degrees
 * @param {number} meshRotationX - Current mesh rotation X in degrees
 * @param {number} meshRotationZ - Current mesh rotation Z in degrees
 */
export function updateRearViewRotation(meshRotationY, meshRotationX, meshRotationZ) {
    if (currentMode !== 'rear' || !sphere) return;
    rearRotationY = meshRotationY;
    rearRotationX = meshRotationX;
    rearRotationZ = meshRotationZ;
    sphere.rotation.y = THREE.MathUtils.degToRad(meshRotationY + 180);
    sphere.rotation.x = THREE.MathUtils.degToRad(-meshRotationX);
    sphere.rotation.z = THREE.MathUtils.degToRad(-meshRotationZ);
    // Arrastar o slider gira a esfera sem mexer na camera do preview.
    markPreviewNeedsRender();
}

/**
 * Syncs the rear view camera direction with the main viewer.
 * In rear mode, the camera is slaved to the main viewer (same lon/lat).
 * Because the sphere has +180° rotation, this shows the opposite direction.
 * @param {number} mainLonDeg - Main viewer lon in degrees
 * @param {number} mainLatDeg - Main viewer lat in degrees
 * @param {number} _mainFov - Main viewer field of view in degrees. Recebido e NAO usado: a vista
 *   traseira tem FOV proprio e fixo, e o ESLint da casa exige o prefixo `_` para dizer isso.
 */
export function syncRearViewCamera(mainLonDeg, mainLatDeg, _mainFov) {
    if (currentMode !== 'rear') return;
    lon = mainLonDeg;
    lat = Math.max(-85, Math.min(85, mainLatDeg));
}

/**
 * Sets the target data for rendering markers on the rear view.
 * @param {Array} targets - Array of target objects from the API
 * @param {Object} cameraConfig - Camera metadata { heading, lon, lat }
 */
export function setRearViewTargets(targets, cameraConfig) {
    rearTargets = targets || [];
    rearCameraConfig = cameraConfig;
    if (markerProjector) {
        markerProjector.setCameraConfig(cameraConfig);
    }
    // Invalida o cache do config do projetor de markers (sera reaplicado com os
    // valores editados no proximo renderRearMarkers).
    _lastRearConfigKey = '';
    markRearMarkersDirty();
}

/**
 * Shows the preview viewer with the given target photo.
 * @param {string} targetId - Target photo UUID
 * @param {string} displayName - Display name for the label
 * @param {number} [meshRotationY=180] - Mesh rotation Y for the target photo
 * @param {number} [meshRotationX=0] - Mesh rotation X for the target photo
 * @param {number} [meshRotationZ=0] - Mesh rotation Z for the target photo
 */
export async function showPreview(targetId, displayName, meshRotationY = 180, meshRotationX = 0, meshRotationZ = 0) {
    if (!containerEl) return;

    // Don't reload if same target
    if (currentTargetId === targetId && currentMode === 'target') {
        containerEl.style.display = 'block';
        // Reexibir o painel exige repintar: o loop pula o render enquanto ele
        // esta escondido, entao o canvas pode estar com o conteudo defasado.
        markPreviewNeedsRender();
        return;
    }

    currentMode = 'target';
    currentTargetId = targetId;
    containerEl.style.display = 'block';

    // Set target view appearance
    applyModeClass('target');
    const label = document.getElementById('preview-viewer-label');
    if (label) {
        label.textContent = `Target: ${displayName}`;
    }

    // Show target action buttons
    if (closeBtn) closeBtn.style.display = 'block';
    if (navigateBtn) navigateBtn.style.display = 'block';

    // Clear marker overlay (no markers in target mode)
    clearMarkerOverlay();

    // Reset camera
    lon = 0;
    lat = 0;

    // Set mesh rotation
    if (sphere) {
        sphere.rotation.y = THREE.MathUtils.degToRad(meshRotationY);
        sphere.rotation.x = THREE.MathUtils.degToRad(meshRotationX);
        sphere.rotation.z = THREE.MathUtils.degToRad(meshRotationZ);
    }
    markPreviewNeedsRender();

    // Start animation if not running
    if (!animationFrameId) animate();

    // Load panorama (preview first for speed, then full)
    currentSpherePhotoId = targetId;
    const generation = ++loadGeneration;
    const previewUrl = getPhotoImageUrl(targetId, 'preview');
    const fullUrl = getPhotoImageUrl(targetId, 'full');

    try {
        await loadTexture(previewUrl, true, generation);
    } catch {
        // Preview failed
    }

    // Only load full if still showing same target
    if (currentTargetId === targetId) {
        try {
            await loadTexture(fullUrl, false, generation);
        } catch (err) {
            console.error('Preview viewer: failed to load full image:', err);
        }
    }
}

/**
 * Switches back to rear view (called when target is deselected).
 * Does NOT hide the preview viewer.
 */
export function hidePreview() {
    if (!containerEl) return;

    onAddTargetCallback = null;
    if (addTargetBtn) addTargetBtn.style.display = 'none';

    // Switch back to rear view if a photo is loaded
    if (rearPhotoId) {
        currentMode = 'rear';
        currentTargetId = null;
        markRearMarkersDirty();

        applyModeClass('rear');
        const label = document.getElementById('preview-viewer-label');
        if (label) {
            label.textContent = 'Visao Traseira';
        }

        hideAllButtons();

        if (sphere) {
            sphere.rotation.y = THREE.MathUtils.degToRad(rearRotationY + 180);
            sphere.rotation.x = THREE.MathUtils.degToRad(-rearRotationX);
            sphere.rotation.z = THREE.MathUtils.degToRad(-rearRotationZ);
        }
        markPreviewNeedsRender();

        lon = 0;
        lat = 0;

        // Recarrega a textura da foto traseira apenas se a esfera nao a estiver
        // exibindo (ex.: voltando de um target). Se ja estiver, evita o
        // decode/upload de GPU redundante.
        if (currentSpherePhotoId !== rearPhotoId) {
            currentSpherePhotoId = rearPhotoId;
            const generation = ++loadGeneration;
            const previewUrl = getPhotoImageUrl(rearPhotoId, 'preview');
            const fullUrl = getPhotoImageUrl(rearPhotoId, 'full');
            loadTexture(previewUrl, true, generation).catch(() => {});
            loadTexture(fullUrl, false, generation).catch(() => {});
        }

        if (!animationFrameId) animate();
    } else {
        containerEl.style.display = 'none';
        currentTargetId = null;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }
}

/**
 * Shows or hides the "Adicionar Conexao" button on the preview viewer.
 * @param {boolean} visible - Whether to show the add button
 * @param {Function|null} [onAdd=null] - Callback when add button is clicked
 */
export function showAddButton(visible, onAdd = null) {
    onAddTargetCallback = onAdd;
    if (addTargetBtn) {
        addTargetBtn.style.display = visible ? 'block' : 'none';
    }
}

/**
 * Mostra ou esconde a acao de ocultar o alvo na visao traseira.
 *
 * O botao "Definir com Clique" saiu daqui: ele gravava override de rumo e
 * distancia, e o icone nao e mais calibravel. Ele tinha ficado orfao, visivel na
 * tela e sem efeito ao clique.
 *
 * @param {boolean} visible - Se deve mostrar o botao
 * @param {Object} [options] - Opcoes
 * @param {Function} [options.onHide] - Callback do botao de ocultar
 * @param {boolean} [options.isHidden] - Estado atual do alvo
 */
export function showTargetActions(visible, options = {}) {
    onHideCallback = options.onHide || null;

    if (hideTargetBtn) {
        hideTargetBtn.style.display = visible ? 'block' : 'none';
        if (visible) {
            hideTargetBtn.textContent = options.isHidden ? 'Mostrar' : 'Ocultar';
        }
    }
}

/**
 * Updates the hide button text without recreating it.
 * @param {boolean} isHidden - Whether the target is currently hidden
 */
export function updateHideButtonState(isHidden) {
    if (hideTargetBtn) {
        hideTargetBtn.textContent = isHidden ? 'Mostrar' : 'Ocultar';
    }
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function hideAllButtons() {
    if (closeBtn) closeBtn.style.display = 'none';
    if (navigateBtn) navigateBtn.style.display = 'none';
    if (addTargetBtn) addTargetBtn.style.display = 'none';
    if (hideTargetBtn) hideTargetBtn.style.display = 'none';
}

function clearMarkerOverlay() {
    if (markerCtx) {
        markerCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    }
}

// ============================================================================
// TEXTURE LOADING
// ============================================================================

function loadTexture(url, isPreview, generation = loadGeneration) {
    return new Promise((resolve, reject) => {
        textureLoader.load(
            url,
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;

                // Carga obsoleta (outro show*/hide* foi disparado): descarta.
                if (generation !== loadGeneration) {
                    texture.dispose();
                    resolve();
                    return;
                }

                if (isPreview && material.map && material.map.userData?.isFull) {
                    texture.dispose();
                    resolve();
                    return;
                }

                if (material.map) {
                    material.map.dispose();
                }

                texture.userData = { isFull: !isPreview };
                material.map = texture;
                material.color.set(0xffffff);
                material.needsUpdate = true;
                // A textura chega fora do ciclo de interacao: sem isto a esfera
                // so apareceria no proximo movimento de camera.
                markPreviewNeedsRender();
                resolve();
            },
            undefined,
            (err) => reject(err)
        );
    });
}

// ============================================================================
// INPUT HANDLERS (target mode orbit only)
// ============================================================================

function onPointerDown(e) {
    // No orbit in rear mode (camera is slaved to main viewer)
    if (currentMode === 'rear') return;

    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartLon = lon;
    dragStartLat = lat;
    canvasEl.setPointerCapture(e.pointerId);
    e.stopPropagation();
}

function onPointerMove(e) {
    if (!isDragging || currentMode === 'rear') return;
    e.stopPropagation();

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    const sensitivity = 0.15;
    lon = dragStartLon - dx * sensitivity;
    lat = dragStartLat + dy * sensitivity;
    lat = Math.max(-85, Math.min(85, lat));
}

function onPointerUp(e) {
    isDragging = false;
    e.stopPropagation();
}

// ============================================================================
// MARKER RENDERING (rear view only)
// ============================================================================

/**
 * Projects and renders navigation markers on the rear view overlay canvas.
 * Uses the same relative-horizon projection as the main navigator, for the rear
 * view camera.
 */
function renderRearMarkers() {
    if (!markerCtx || currentMode !== 'rear' || !rearCameraConfig) {
        clearMarkerOverlay();
        return;
    }

    // Use current edited state values (same values the main navigator uses)
    // so that markers stay in sync when the user adjusts sliders.
    // Lido ANTES do dirty-check: os sliders de altura/escala usam silent=true
    // durante o arraste (sem notify/onChange), entao precisamos detectar a
    // mudanca aqui para manter os markers do rear em sincronia ao vivo.
    // Altura de camera, escala de distancia e escala de marcador nao influenciam
    // mais o icone, entao saem da assinatura do dirty-check.

    // Assinatura do config do projetor (reaproveitada no dirty-check e no
    // setCameraConfig). Inclui os valores editados via slider.
    const configKey = `${rearCameraConfig.lon}|${rearCameraConfig.lat}|${rearCameraConfig.heading}`;

    // Dirty-check: redesenha quando a camera (lon/lat), o estado de selecao
    // (rearMarkersDirty) ou os valores editados via slider (configKey) mudam.
    const cameraMoved = lon !== _lastRearMarkerLon || lat !== _lastRearMarkerLat;
    const configChanged = configKey !== _lastRearConfigKey;
    if (!rearMarkersDirty && !cameraMoved && !configChanged) {
        return;
    }
    rearMarkersDirty = false;
    _lastRearMarkerLon = lon;
    _lastRearMarkerLat = lat;

    markerCtx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    if (!rearTargets.length || !markerProjector) {
        // Sem targets: marca o config como aplicado para nao redesenhar a cada
        // frame ocioso (o canvas ja foi limpo acima).
        _lastRearConfigKey = configKey;
        return;
    }

    // Atualiza o config do projetor reaproveitando um objeto unico e so
    // chama setCameraConfig quando algum valor relevante muda (evita alocacao
    // e reatribuicao por frame).
    if (configChanged) {
        Object.assign(_rearProjectorConfig, rearCameraConfig);
        markerProjector.setCameraConfig(_rearProjectorConfig);
        _lastRearConfigKey = configKey;
    }

    // Compute projection yaw for rear view.
    // Main viewer: worldHeading = imageHeading + lon → yaw = -worldHeading * PI/180
    // Rear view: sphere has +180° extra rotation, so effective heading = imageHeading + 180 + lon
    const imageHeading = rearCameraConfig.heading ?? 0;
    const rearWorldHeading = imageHeading + 180 + lon;
    const yaw = -(rearWorldHeading * Math.PI) / 180;
    const pitch = (lat * Math.PI) / 180;

    // Pre-computa as invariantes trig do frame para reaproveitar em metersToScreen.
    markerProjector.beginFrame(yaw, pitch, fov);

    // Mesma foto, logo o mesmo arranjo por direcao do overlay principal, e o
    // mesmo desenho. Antes esta tela projetava pelo modelo de chao, ou seja,
    // mostrava os alvos em lugar diferente do resto do sistema.
    const layout = layoutDirections(rearTargets, fov, markerProjector, rearCameraConfig);

    for (const target of rearTargets) {
        const placement = layout.get(target.id);
        if (!placement) continue;   // alem do limite por direcao

        const meters = markerProjector.lonLatToMeters(
            target.lon, target.lat,
            rearCameraConfig.lon, rearCameraConfig.lat
        );
        const bearing = ((((Math.atan2(meters.x, -meters.z) * 180) / Math.PI) + 360) % 360);

        // A altura entra na propria projecao, igual ao navigator principal: o
        // icone e desenhado no seu proprio elevationDeg. O modelo antigo somava
        // um baseOffset em pixel e subtraia um placement.rise, ambos mortos hoje
        // (HORIZON_BASE_OFFSET_REL e placement.rise nao existem), o que fazia
        // translate(x, NaN) e a esfera nao desenhava.
        const projected = markerProjector.projectOnHorizon(bearing, yaw, pitch, fov, placement.elevationDeg);
        if (!projected.visible) continue;

        const isSelected = target.id === state.selectedTargetId;
        const hidden = isTargetHidden(target.id);

        markerCtx.save();
        markerCtx.translate(projected.screenX, projected.screenY);
        drawArmillarySphere(markerCtx, placement.radius, {
            highlighted: false,
            selected: isSelected,
            hidden,
            // A vista de tras desenha o MESMO marcador da vista principal, e a
            // marca de andar tem de ir junto: dois desenhos do mesmo alvo com
            // aparencia diferente foi o que fez as copias divergirem antes.
            floorDelta: (typeof target.floor_level === 'number'
                && typeof rearCameraConfig?.floor_level === 'number')
                ? target.floor_level - rearCameraConfig.floor_level : 0,
            floorLevel: target.floor_level ?? null,
            floorLabel: target.floor_label ?? null,
            opacity: rankOpacity(placement.rank, isSelected),
        });
        markerCtx.restore();
    }
}

// ============================================================================
// RENDER LOOP
// ============================================================================

function animate() {
    animationFrameId = requestAnimationFrame(animate);

    if (!camera || !scene || !renderer) return;

    // Painel fechado: nao ha o que mostrar, e o custo de render nao volta a
    // ninguem. O loop continua para retomar sozinho quando ele reabrir.
    if (containerEl && containerEl.style.display === 'none') return;

    const cameraMoved = lon !== _lastRenderLon || lat !== _lastRenderLat;
    if (previewNeedsRender || cameraMoved) {
        const phi = THREE.MathUtils.degToRad(90 - lat);
        const theta = THREE.MathUtils.degToRad(lon);

        _lookAtTarget.set(
            500 * Math.sin(phi) * Math.cos(theta),
            500 * Math.cos(phi),
            500 * Math.sin(phi) * Math.sin(theta)
        );
        camera.lookAt(_lookAtTarget);

        renderer.render(scene, camera);

        previewNeedsRender = false;
        _lastRenderLon = lon;
        _lastRenderLat = lat;
    }

    // Render markers in rear view mode (tem o proprio dirty-check dentro)
    if (currentMode === 'rear') {
        renderRearMarkers();
    }
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Disposes the preview viewer and releases GPU resources.
 */
export function disposePreviewViewer() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (canvasEl) {
        canvasEl.removeEventListener('pointerdown', onPointerDown);
        canvasEl.removeEventListener('pointermove', onPointerMove);
        canvasEl.removeEventListener('pointerup', onPointerUp);
    }

    if (unsubscribeStateChange) {
        unsubscribeStateChange();
        unsubscribeStateChange = null;
    }

    if (material?.map) {
        material.map.dispose();
    }
    material?.dispose();
    sphere?.geometry.dispose();
    renderer?.dispose();

    if (containerEl?.parentElement) {
        containerEl.parentElement.removeChild(containerEl);
    }

    scene = null;
    camera = null;
    renderer = null;
    sphere = null;
    material = null;
    containerEl = null;
    canvasEl = null;
    navigateBtn = null;
    addTargetBtn = null;
    closeBtn = null;
    hideTargetBtn = null;
    currentTargetId = null;
    rearPhotoId = null;
    currentSpherePhotoId = null;
    currentMode = 'rear';
    onNavigateCallback = null;
    onCloseCallback = null;
    onAddTargetCallback = null;
    onHideCallback = null;
    markerCanvas = null;
    markerCtx = null;
    markerProjector = null;
    rearTargets = [];
    rearCameraConfig = null;

    // Estado do dirty-check e por cena: uma re-inicializacao comeca com um
    // canvas novo e vazio, que precisa de um primeiro render incondicional.
    previewNeedsRender = true;
    rearMarkersDirty = true;
    _lastRenderLon = NaN;
    _lastRenderLat = NaN;
}

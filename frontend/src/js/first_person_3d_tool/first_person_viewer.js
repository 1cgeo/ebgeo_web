// Path: js/first_person_3d_tool/first_person_viewer.js

/**
 * @fileoverview Core first-person (Gaussian splatting) viewer.
 *
 * Ported from `main.ts` of the museu-gs prototype, restructured to follow the
 * lifecycle of this app's other viewers — `street_view_tool/street_view_viewer.js`
 * and `3d_models_viewer_tool/map_3d.js`:
 *
 *   - module state lives in ONE object (`fpState`);
 *   - the container already exists in index.html and only changes visibility;
 *   - the FIRST open builds the scene, the following ones merely resume it;
 *   - closing PAUSES the render loop instead of destroying anything;
 *   - `cleanupFirstPersonFeatures()` is the real teardown.
 *
 * WHAT WAS ADDED relative to the prototype: teardown. The original is a
 * single-use page that never releases anything; here the viewer opens and
 * closes many times per session, so every listener, the ResizeObserver and the
 * animation frame are tracked and released.
 *
 * WHAT WAS DROPPED: the block LOD path, the `?sh=/?pr=/?ctx=` performance
 * switches, the collision debug mesh and the user annotations — all out of MVP
 * scope. The engine settings those switches used to toggle are FIXED here at
 * the values LEIAME.md measured (see `createSceneViewer` and
 * `applyEngineQualityDefaults`).
 *
 * LAZY MODULE: nothing imports this file statically. Reach it with
 * `await import('@js/first_person_3d_tool/first_person_viewer.js')`.
 */

import {
    BackgroundMode,
    Color,
    Object3D,
    PerspectiveCamera,
    SplatLoader,
    SplatUtils,
    Vector3,
    createViewer,
    setViewerConfig
} from '@manycore/aholo-viewer';

import { getEventBus } from '@store/services.js';
import { getControl } from '@store/control.registry.js';
import { EventTypes } from '@events/event_types.js';
import { showError, showWarning } from '@utils/toast_service.js';
import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
// The measuring card is the 2D tool's card. Same component, same panel, same
// unit selector — see showMeasurementResults().
import { createDistanceResultsPanel } from '@js/measurement_tool/measurement-results-panel.js';

import { FP_DEFAULTS } from './walk/constants.js';
import { WalkMode } from './walk/walk-mode.js';
import { FpMarkersLayer } from './components/markers-layer-fp.js';
import { FpMeasurementTool } from './tools/measurement_tool_fp.js';
import {
    getFirstPersonSceneById,
    resolveSceneAssets,
    resolveMarkerPhotoUrl,
    loadSceneMarkers,
    loadSceneCollision
} from './scene-config.service.js';
import {
    setKeyboardCallbacksFp,
    activateKeyboardServiceFp,
    deactivateKeyboardServiceFp
} from './services/keyboard-service-fp.js';

// =============================================================================
// DOM CONTRACT
// =============================================================================

/** Element ids this viewer drives. They all live in index.html. */
const DOM_IDS = {
    container: 'first-person-container',
    canvas: 'first-person-canvas',
    loading: 'first-person-loading',
    loadingMessage: 'first-person-loading-message',
    closeButton: 'close-first-person-button',
    toolbar: 'toolbar-fp',
    measureButton: 'measure-fp',
    labelsButton: 'labels-fp',
    shareButton: 'share-fp',
    map2d: 'map-sig'
};

/** Class names owned by `src/css/first-person-3d.css`. */
const CSS = {
    containerOpen: 'fp3d-container--open',
    containerMeasuring: 'fp3d-container--measuring',
    toolbarVisible: 'toolbar-fp--visible',
    closeButtonVisible: 'close-first-person-button--visible',
    buttonActive: 'button-tool-fp--active',
    bodyActive: 'first-person-active',
    hidden: 'fp3d-hidden'
};

/** Camera clip planes, in metres. Near is tight: the walker's nose is 12 cm from a wall. */
const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 500;

/** Longest frame the physics is allowed to swallow at once, in seconds. */
const MAX_FRAME_SECONDS = 0.1;

// =============================================================================
// MODULE STATE
// =============================================================================

/**
 * Everything the viewer owns, in one place — same shape as `streetViewState`.
 * A field is null exactly when the thing it names has not been built yet.
 */
const fpState = {
    isVisible: false,
    isPaused: false,

    sceneId: null,
    scene: null,

    viewer: null,
    camera: null,
    splat: null,
    splatLayer: null,
    collision: null,

    walk: null,
    markers: null,
    measurement: null,

    animationId: null,
    lastFrameTime: 0,

    resizeObserver: null,
    listenersBound: false,
    openPromise: null,

    /** Cursor in normalized device coordinates, refreshed by mousemove. */
    cursor: { ndcX: 0, ndcY: 0, inside: false },
    /** Where the last mousedown landed, for the drag-versus-click test. */
    pointerDownX: 0,
    pointerDownY: 0,

    /** Results card currently mounted in the application panel, or null. */
    resultsPanel: null,

    /** Pose captured on close, so reopening the same scene resumes where it stopped. */
    lastPose: null
};

setupCleanup(fpState);

// =============================================================================
// DOM HELPERS
// =============================================================================

/**
 * Look up every element of the DOM contract.
 * @returns {Object<string, HTMLElement|null>} Elements keyed like DOM_IDS
 */
function getDom() {
    const dom = {};
    for (const [key, id] of Object.entries(DOM_IDS)) {
        dom[key] = document.getElementById(id);
    }
    return dom;
}

/**
 * Resolves once `el` has a non-zero layout size, or after `timeoutMs`.
 *
 * Same race as the 360 viewer: the render surface is read for width and height,
 * and a 0x0 read is unrecoverable — the canvas keeps a default size and the
 * scene renders into a stamp forever after. Polls animation frames because the
 * number of frames needed is a property of how busy the browser is, not of this
 * code. Resolving on timeout rather than rejecting is deliberate: a mis-sized
 * viewer is still repairable by the ResizeObserver, no viewer at all is not.
 *
 * @param {HTMLElement|null} el - Element to wait on
 * @param {number} [timeoutMs=3000] - Give up after this long
 * @returns {Promise<boolean>} True if a real size was observed
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
                    '[first-person] container has no size after', timeoutMs,
                    'ms — initialising anyway'
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
 * Size of the render surface, in CSS pixels.
 * @returns {{width: number, height: number}} Viewport size, never zero
 */
function readViewportSize() {
    const el = document.getElementById(DOM_IDS.canvas)
        || document.getElementById(DOM_IDS.container);
    return {
        width: Math.max(1, el?.clientWidth ?? 1),
        height: Math.max(1, el?.clientHeight ?? 1)
    };
}

/**
 * Show the loading overlay with a message.
 * @param {string} message - pt-BR status line
 */
function showLoadingFp(message) {
    const el = document.getElementById(DOM_IDS.loading);
    if (!el) return;
    // Only the stage line is written. The logo and the progress bar are static
    // markup in index.html — writing textContent on the overlay itself, as an
    // earlier version did, would delete them.
    const line = document.getElementById(DOM_IDS.loadingMessage);
    if (line) line.textContent = message;
    el.classList.remove(CSS.hidden);
}

/** Hide the loading overlay. */
function hideLoadingFp() {
    document.getElementById(DOM_IDS.loading)?.classList.add(CSS.hidden);
}

/**
 * Show or hide the whole first-person UI: container, toolbar, close button and
 * the 2D map underneath.
 *
 * Class based, never inline styles: `.fp3d-container` is `display:none` in the
 * stylesheet and `--open` is what reveals it. The 2D map is hidden with the
 * module's own `.fp3d-hidden` utility so this file needs no rule of its own.
 *
 * @param {boolean} visible - True while the viewer is on screen
 */
function setFirstPersonUiVisible(visible) {
    const dom = getDom();

    dom.container?.classList.toggle(CSS.containerOpen, visible);
    dom.toolbar?.classList.toggle(CSS.toolbarVisible, visible);
    dom.closeButton?.classList.toggle(CSS.closeButtonVisible, visible);
    dom.map2d?.classList.toggle(CSS.hidden, visible);
    document.body.classList.toggle(CSS.bodyActive, visible);

    if (!visible) {
        dom.container?.classList.remove(CSS.containerMeasuring);
        hideLoadingFp();
    }
}

// =============================================================================
// ENGINE SETUP
// =============================================================================

/**
 * Build the aholo viewer with the settings LEIAME.md measured.
 *
 * The engine inherits `antialiasing` and `preserveDrawingBuffer` ON when the
 * third argument is empty. Neither touches the splat raster: the context MSAA
 * only applies to meshes, and the preserved buffer only serves whoever reads
 * the canvas back through toDataURL. Turning both off measured 1.59x at
 * 1920x1080 (10.8 ms down to 6.8 ms) against 2% noise between repetitions, and
 * a pixel-by-pixel comparison of the two configurations found 0.00% of pixels
 * different. It is free speed, so it is the default here with no escape hatch.
 *
 * @param {HTMLElement} el - Element the canvas is mounted into
 * @returns {Object} The aholo viewer
 */
function createSceneViewer(el) {
    const viewer = createViewer('first-person', el, {
        antialiasing: false,
        preserveDrawingBuffer: false
    });

    // No axis gizmo: this is a room seen from inside, not a model on a turntable.
    viewer.config.coordinateSystem.enabled.set(false);

    setViewerConfig(viewer, {
        pipeline: {
            Background: {
                background: {
                    active: BackgroundMode.BasicBackground,
                    // Near black. The scene is an indoor capture; a bright sky
                    // background would light nothing and only wash out the walls.
                    basic: { color: new Color(0.06, 0.06, 0.07) }
                },
                // No ground grid: the floor is part of the capture.
                ground: { enabled: false }
            },
            Splatting: { enabled: true },
            // TAA accumulates across frames; walking makes every frame different,
            // so it buys smearing rather than smoothing.
            TAA: { enabled: false }
        }
    });

    applyEngineQualityDefaults(viewer);
    return viewer;
}

/**
 * Write one engine config signal, tolerating a key that a newer engine dropped.
 * @param {Object} root - Config subtree to walk
 * @param {string} path - Dotted path inside it
 * @param {number|boolean} value - Value to set
 */
function setEngineSignal(root, path, value) {
    try {
        let node = root;
        for (const part of path.split('.')) {
            node = node?.[part];
        }
        if (!node || typeof node.set !== 'function') {
            console.warn(`[first-person] engine key missing: ${path}`);
            return;
        }
        node.set(value);
    } catch (error) {
        console.warn(`[first-person] failed to apply ${path}:`, error);
    }
}

/**
 * Quality settings fixed by decision, both measured on 2026-08-13.
 *
 * `detailCullingThreshold = 0`: the engine drops any gaussian covering less
 * than one square pixel. In a room full of small instruments on shelves, that
 * is exactly the distant piece that disappears. Zero draws everything.
 *
 * `highPrecisionEnabled = true`: exact depth ordering. In the cheap mode the
 * engine resolves two splats per key pixel and the ordering error shows up as
 * layers swapping WHILE TURNING. Honest caveat: a still-frame comparison cannot
 * see that defect, so this one is chosen on principle — what the measurement
 * establishes is the cost, and the cost is low (the two together are 10% of a
 * frame, 7.2 ms against 7.1 ms at 1920x1080, inside the noise).
 *
 * The public typing hides half of the `Splatting` keys, so the path used is
 * `viewer.config.effects.Splatting`, which exposes the whole configuration.
 *
 * @param {Object} viewer - The aholo viewer
 */
function applyEngineQualityDefaults(viewer) {
    const splatting = viewer.config?.effects?.Splatting;
    if (!splatting) {
        console.warn('[first-person] Splatting configuration unavailable');
        return;
    }
    setEngineSignal(splatting, 'raster.detailCullingThreshold', 0);
    setEngineSignal(splatting, 'sort.highPrecisionEnabled', true);
}

/**
 * Download and mount the scene's splat model.
 * @param {Object} viewer - The aholo viewer
 * @param {string} splatUrl - Address of the .sog file
 * @returns {Promise<{splat: Object, splatLayer: Object}>} Mounted splat and its layer
 */
async function loadSplat(viewer, splatUrl) {
    const splatLayer = new Object3D();
    viewer.getScene().add(splatLayer);

    const response = await fetch(splatUrl);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} em ${splatUrl}`);
    }

    const data = await SplatLoader.parseSplatData(
        SplatLoader.SplatFileType.SOG,
        new Uint8Array(await response.arrayBuffer()),
        // `Compressed` is this engine's fidelity ceiling. `Raw`, which would
        // keep floats, fails at load: "RawSplatData is not supported create
        // splat". Do not try again.
        SplatLoader.SplatPackType.Compressed
    );

    const splat = await SplatUtils.createSplat(data);
    splatLayer.add(splat);
    return { splat, splatLayer };
}

// =============================================================================
// SCENE LIFECYCLE
// =============================================================================

/**
 * Build everything for a scene: engine, camera, splat, collision, walk mode and
 * the two overlays. Runs once per scene; reopening the same scene skips it.
 *
 * @param {Object} scene - Scene entry from config
 * @param {Object} dom - Element references from getDom()
 */
async function initScene(scene, dom) {
    const assets = resolveSceneAssets(scene);
    const fov = Number.isFinite(scene.fov) && scene.fov > 0 ? scene.fov : FP_DEFAULTS.fov;

    const viewer = createSceneViewer(dom.canvas);
    fpState.viewer = viewer;

    const { width, height } = readViewportSize();
    const camera = new PerspectiveCamera(fov, width / height, CAMERA_NEAR, CAMERA_FAR);
    // Both cullings are the camera's, not the splat raster's, and both throw
    // away geometry the walker is standing inside of.
    camera.enableFrustumCulling = false;
    camera.enableDetailCulling = false;
    viewer.setCamera(camera);
    fpState.camera = camera;

    showLoadingFp('Carregando o modelo 3D...');
    const { splat, splatLayer } = await loadSplat(viewer, assets.splatUrl);
    fpState.splat = splat;
    fpState.splatLayer = splatLayer;

    showLoadingFp('Carregando a colisão...');
    const collision = await loadSceneCollision(scene);
    fpState.collision = collision;
    if (!collision) {
        // Not fatal: without the octree the visitor floats and neither the tape
        // nor label occlusion work, but the scene is still worth looking at.
        console.warn('[first-person] scene has no octree: no collision, tape measure or occlusion');
    }

    // The walk controller takes the engine's own canvas container, which is the
    // element the pointer events land on.
    const walk = new WalkMode(viewer.canvasContainer ?? dom.canvas);
    walk.moveSpeed = Number.isFinite(scene.velocidade) && scene.velocidade > 0
        ? scene.velocidade
        : FP_DEFAULTS.walkSpeed;
    if (collision) {
        walk.loadVoxelCollision(collision.metadata, collision.nodes, collision.leafData);
    }
    fpState.walk = walk;

    const voxels = collision?.voxels ?? null;
    const markers = new FpMarkersLayer(
        dom.container, fov, voxels,
        (foto) => resolveMarkerPhotoUrl(scene, foto),
        { id: scene.id, name: scene.name }
    );
    markers.setMarkers(await loadSceneMarkers(scene));
    fpState.markers = markers;

    fpState.measurement = new FpMeasurementTool(dom.container, fov, voxels);

    observeResize(dom);
    syncToolButtons();
}

/**
 * Keep the camera aspect and the render surface in step with the container.
 * @param {Object} dom - Element references
 */
function observeResize(dom) {
    if (fpState.resizeObserver || !dom.container) return;

    fpState.resizeObserver = new ResizeObserver(() => {
        const { width, height } = readViewportSize();
        if (fpState.camera) {
            fpState.camera.aspect = width / height;
        }
        fpState.viewer?.resize();
    });
    fpState.resizeObserver.observe(dom.container);
}

/**
 * Place the walker.
 *
 * Priority: the deep link's pose, then where the visitor stopped last time,
 * then the scene's surveyed start pose, then the origin (the walk controller
 * lifts it out of any solid voxel it lands in).
 *
 * @param {Object|null} pose - {x, y, z, yaw, pitch}, all optional
 */
function applyPose(pose) {
    if (!fpState.walk) return;

    const fallback = fpState.lastPose ?? fpState.scene?.poseInicial ?? {};
    const source = pose ?? fallback;
    const value = (key) => (Number.isFinite(source?.[key]) ? source[key] : 0);

    fpState.walk.startAtPose(
        new Vector3(value('x'), value('y'), value('z')),
        value('yaw'),
        value('pitch')
    );
}

// =============================================================================
// INPUT — pointer
// =============================================================================

/**
 * Read the cursor off the EVENT, in -1..1 device coordinates.
 *
 * Straight from the event and never from the previous frame's copy: reusing it
 * puts the point where the cursor was up to 100 ms ago, and that is visible.
 *
 * @param {MouseEvent} event - Source event
 */
function readCursor(event) {
    const container = document.getElementById(DOM_IDS.container);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    fpState.cursor.ndcX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    fpState.cursor.ndcY = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    fpState.cursor.inside = true;
}

/** @param {MouseEvent} event - Mouse move over the scene */
function onSceneMouseMove(event) {
    readCursor(event);
}

/** The cursor left the scene, so there is no aim point any more. */
function onSceneMouseLeave() {
    fpState.cursor.inside = false;
}

/** @param {MouseEvent} event - Mouse down over the scene */
function onSceneMouseDown(event) {
    fpState.pointerDownX = event.clientX;
    fpState.pointerDownY = event.clientY;
}

/**
 * Right click pins the LAST vertex and closes the measurement — the same two
 * things `_onContextMenu` does in the 2D distance tool. Closing without pinning
 * would cost the user the point they were aiming at when they decided to stop.
 *
 * No drag test here, unlike the left button: while the tape is on the right
 * button turns nothing (`toggleMeasure` lends it away), so there is no other
 * gesture it could have meant. With the tape off this returns early and the
 * button is the camera's again.
 *
 * `preventDefault` is belt and braces — walk-mode also suppresses the menu for
 * events inside the container — but this handler must not depend on the other
 * one running first.
 *
 * @param {MouseEvent} event - Context menu event over the scene
 */
function onSceneContextMenu(event) {
    event.preventDefault();

    const { measurement, camera, cursor } = fpState;
    if (!measurement?.active || !camera) return;

    // Ignored on a closed measurement, exactly as the 2D tool ignores it: there
    // is nothing left to pin, and pinning a lone point only to close on it would
    // wipe the drawing and leave the user with nothing.
    if (measurement.finalized) return;

    readCursor(event);
    measurement.point(camera, cursor.ndcX, cursor.ndcY);
    measurement.addPoint();
    finalizeMeasurement(false);
}

/**
 * Double click closes the measurement too, dropping the vertex its own first
 * click just pinned.
 * @param {MouseEvent} event - Double click over the scene
 */
function onSceneDblClick(event) {
    if (!fpState.measurement?.active) return;
    event.preventDefault();
    finalizeMeasurement(true);
}

/**
 * What separates looking from clicking is the DRAG, not the button: a release
 * more than a few pixels from the press turned the camera and means nothing
 * else. The tape and the labels both want the left button, so whichever is on
 * wins it — which is why turning one on turns the other off.
 *
 * @param {MouseEvent} event - Mouse up over the scene
 */
function onSceneMouseUp(event) {
    const { walk, markers, measurement, camera, cursor } = fpState;
    if (event.button !== 0 || !walk || !camera) return;

    // A release that lands on a label belongs to the label, which has its own
    // handler. Without this guard clicking a label would ALSO capture the
    // pointer, because mouseup runs before click.
    //
    // The marker CARD is not tested here: it is the application feature panel,
    // which lives in the sidebar and therefore outside this container, so its
    // events never reach this listener.
    if (event.target instanceof Element && event.target.closest('.fp3d-label')) {
        return;
    }

    const dragged = Math.hypot(
        event.clientX - fpState.pointerDownX,
        event.clientY - fpState.pointerDownY
    ) > FP_DEFAULTS.clickTolerancePx;
    if (dragged) return;

    readCursor(event);

    if (measurement?.active) {
        // Clicking a closed measurement starts a new one, so the card that
        // describes the old one has to come down with it.
        if (measurement.finalized) {
            hideMeasurementResults();
        }
        measurement.point(camera, cursor.ndcX, cursor.ndcY);
        measurement.addPoint();
        return;
    }

    // No tool on: a click on the clean scene closes whatever card is open. The
    // labels themselves are DOM buttons and were already filtered out above, so
    // reaching here means the click landed on the scene and not on an item.
    if (markers?.panelOpen) {
        markers.closePanel();
    }
}

// =============================================================================
// INPUT — tools
// =============================================================================

/**
 * Turn the measuring tape on or off, and keep everything that depends on it in
 * step: the labels stop taking clicks, the cursor becomes a crosshair, and the
 * toolbar button lights up.
 *
 * @param {boolean} [force] - Desired state; omit to toggle
 * @returns {boolean} The state the tape ended in
 */
function toggleMeasure(force) {
    const measurement = fpState.measurement;
    if (!measurement) return false;

    const next = typeof force === 'boolean' ? force : !measurement.active;
    if (next && !measurement.available) {
        showWarning('Cena sem malha de colisão: a trena não está disponível');
        return false;
    }

    measurement.setActive(next);
    if (!measurement.active) {
        hideMeasurementResults();
    }
    // While measuring, the right button belongs to the tape, not to the camera.
    fpState.walk?.setLookWithRightButton(!measurement.active);
    fpState.markers?.setInteractive(!measurement.active);
    document.getElementById(DOM_IDS.container)
        ?.classList.toggle(CSS.containerMeasuring, measurement.active);
    syncToolButtons();
    return measurement.active;
}

/**
 * Close the measurement and put the results card up.
 *
 * Bound to right click and to double click, the two gestures the 2D distance
 * tool uses. `dropLast` exists because the double click's FIRST click already
 * pinned a vertex where the second one is closing.
 *
 * @param {boolean} [dropLast=false] - Discard the last vertex before closing
 * @returns {boolean} True when a measurement actually closed
 */
function finalizeMeasurement(dropLast = false) {
    const measurement = fpState.measurement;
    if (!measurement?.active || !measurement.finalize(dropLast)) {
        return false;
    }
    showMeasurementResults();
    return true;
}

/**
 * Show the shared results card in the application panel.
 *
 * Reuses `createDistanceResultsPanel` and `sidebarControl.showToolPanel` — the
 * same card and the same panel the 2D distance tool raises. Building a card of
 * this module's own would mean two readings of one measurement and two places to
 * fix a unit bug.
 *
 * No "Salvar como feição" button: `onSave` is left out on purpose, because
 * nothing inside this viewer persists. The panel already renders without it,
 * which is the path a locked map takes in 2D.
 */
function showMeasurementResults() {
    const measurement = fpState.measurement;
    const sidebarControl = getControl('sidebarControl');
    if (!measurement || !sidebarControl?.showToolPanel) return;

    const { segmentDistances, totalDistance } = measurement.getResults();

    fpState.resultsPanel = createDistanceResultsPanel({
        segmentDistances,
        totalDistance,
        onClear: () => toggleMeasure(false),
        onUnitChange: ({ unit }) => measurement.setDisplayUnit(unit)
    });

    sidebarControl.showToolPanel(
        fpState.resultsPanel,
        'Medição de Distância',
        () => { fpState.resultsPanel = null; },
        () => toggleMeasure(false)
    );
}

/** Take the results card down, if one is up. */
function hideMeasurementResults() {
    if (!fpState.resultsPanel) return;
    getControl('sidebarControl')?.hideToolPanel?.(false, false);
    fpState.resultsPanel = null;
}

/**
 * Toggle the curated labels (L).
 * @returns {boolean} True when the labels are now visible
 */
function toggleLabels() {
    const visible = fpState.markers?.toggleLabels() ?? false;
    syncToolButtons();
    return visible;
}

/**
 * Light a toolbar toggle and keep its accessible state truthful.
 *
 * Both toggle buttons carry `aria-pressed` in index.html, so the attribute is
 * written alongside the class: a lit button that still reports `false` to a
 * screen reader is worse than no state at all.
 *
 * @param {HTMLButtonElement|null} button - Toolbar button
 * @param {boolean} active - Whether the tool it drives is on
 */
function setToolButtonState(button, active) {
    if (!button) return;
    button.classList.toggle(CSS.buttonActive, active);
    button.setAttribute('aria-pressed', String(active));
}

/** Reflect tool state on the toolbar buttons. */
function syncToolButtons() {
    const dom = getDom();
    setToolButtonState(dom.measureButton, fpState.measurement?.active === true);
    // Labels start ON, so the button starts lit.
    setToolButtonState(dom.labelsButton, fpState.markers?.labelsVisible !== false);
    if (dom.measureButton) {
        dom.measureButton.disabled = fpState.measurement?.available === false;
    }
}

// =============================================================================
// INPUT — Escape cascade
// =============================================================================
//
// The cascade itself lives in `services/keyboard-service-fp.js`, which calls
// these three in order and stops at the first one that returns a truthy value:
// an open card first, then a measurement still being drawn, then the tape
// itself.

/**
 * Escape 1 — close the marker card.
 * @returns {boolean} True when a card was open
 */
function closeMarkerPanel() {
    if (!fpState.markers?.panelOpen) return false;
    fpState.markers.closePanel();
    return true;
}

/**
 * Escape 2 — close the measurement being drawn, exactly as a right click would.
 *
 * With a single vertex pinned there is nothing to close: `finalize` drops it and
 * reports false, and the Escape then falls through to the next step. That is the
 * right outcome — a lone point is not a measurement worth a card.
 *
 * @returns {boolean} True when a measurement closed
 */
function finishMeasurement() {
    if (!fpState.measurement?.inProgress) return false;
    // Consume the key either way: the user asked to end the drawing, and it
    // ended, card or no card.
    finalizeMeasurement(false);
    return true;
}

/**
 * Escape 3 — turn the measuring tape off.
 * @returns {boolean} True when it was on
 */
function disableMeasurement() {
    if (!fpState.measurement?.active) return false;
    toggleMeasure(false);
    return true;
}

/** Share the current pose as a deep link. */
async function onShareClick() {
    try {
        const { handleShareFpClick } = await import('./tools/share_tool_fp.js');
        await handleShareFpClick();
    } catch (error) {
        console.error('[first-person] failed to share:', error);
    }
}

/**
 * Bind every DOM listener the viewer owns. Called once, on the first open; all
 * of them are tracked and released by cleanupFirstPersonFeatures().
 *
 * @param {Object} dom - Element references
 */
function bindListeners(dom) {
    if (fpState.listenersBound) return;

    addDomListener(fpState, dom.container, 'mousemove', onSceneMouseMove);
    addDomListener(fpState, dom.container, 'mouseleave', onSceneMouseLeave);
    addDomListener(fpState, dom.container, 'mousedown', onSceneMouseDown);
    addDomListener(fpState, dom.container, 'mouseup', onSceneMouseUp);
    addDomListener(fpState, dom.container, 'contextmenu', onSceneContextMenu);
    addDomListener(fpState, dom.container, 'dblclick', onSceneDblClick);

    addDomListener(fpState, dom.closeButton, 'click', closeFirstPersonViewer);
    addDomListener(fpState, dom.measureButton, 'click', () => toggleMeasure());
    addDomListener(fpState, dom.labelsButton, 'click', () => toggleLabels());
    addDomListener(fpState, dom.shareButton, 'click', onShareClick);

    fpState.listenersBound = true;
}

/**
 * Hand the keyboard service the actions it drives.
 *
 * The names are the service's, not this file's — it owns the key table and the
 * Escape cascade, so the viewer supplies verbs and asks nothing about keys.
 *
 */
function registerKeyboardCallbacks() {
    setKeyboardCallbacksFp({
        toggleMeasurement: () => toggleMeasure(),
        toggleLabels,
        undoMeasurement: () => fpState.measurement?.undo(),
        clearMeasurement: () => {
            hideMeasurementResults();
            fpState.measurement?.clear();
        },
        closeMarkerPanel,
        finishMeasurement,
        disableMeasurement
    });
}

// =============================================================================
// FRAME LOOP
// =============================================================================

/**
 * One frame, in the exact order the prototype established.
 *
 * Walk first, because everything downstream reads the camera it produced; then
 * the render; then the two overlays, which project against the camera matrix of
 * THIS frame. Projecting before the render would draw labels one frame behind
 * the scene they annotate, which reads as the labels sliding on the objects.
 *
 * @param {number} dt - Seconds since the previous frame
 */
function renderFrame(dt) {
    const { viewer, camera, walk, markers, measurement, cursor } = fpState;
    if (!viewer || !camera || !walk) return;

    walk.update(dt);

    const state = walk.getCameraState();
    camera.scale.copy(state.scale);
    camera.rotation.copy(state.rotation);
    camera.position.copy(state.position);
    camera.updateMatrixWorld(true);

    // The splat sorter only reorders when the viewer considers the frame new,
    // and walking changes the depth order every frame.
    viewer.forceNextFrameRender = true;
    viewer.render();

    const { width, height } = readViewportSize();
    markers?.update(camera, width, height);

    if (measurement?.active && cursor.inside) {
        measurement.point(camera, cursor.ndcX, cursor.ndcY);
    }
    measurement?.update(camera, width, height);

}

/** Animation loop. Stops itself the moment the viewer stops being visible. */
function animate() {
    if (!fpState.isVisible) {
        fpState.animationId = null;
        return;
    }
    fpState.animationId = requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min(MAX_FRAME_SECONDS, (now - fpState.lastFrameTime) / 1000);
    fpState.lastFrameTime = now;
    renderFrame(dt);
}

/** Stop drawing, keeping every resource alive for the next open. */
function pauseRendering() {
    if (fpState.isPaused) return;
    fpState.isPaused = true;
    fpState.isVisible = false;

    if (fpState.animationId) {
        cancelAnimationFrame(fpState.animationId);
        fpState.animationId = null;
    }
}

/** Resume drawing. */
function resumeRendering() {
    fpState.isPaused = false;
    fpState.isVisible = true;
    fpState.lastFrameTime = performance.now();

    if (!fpState.animationId) {
        animate();
    }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Open the first-person viewer on a scene.
 *
 * Serialized against itself: two clicks on the same card must not build two
 * engines on the same canvas.
 *
 * @param {string} sceneId - Scene id, i.e. the id of the `config.tilesets` row
 *   carrying `viewer: 'firstPerson'` (see scene-config.service.js)
 * @param {Object} [options] - Open options
 * @param {Object} [options.pose] - {x, y, z, yaw, pitch} from a deep link
 * @returns {Promise<void>}
 */
export async function openFirstPersonViewer(sceneId, options = {}) {
    if (fpState.openPromise) {
        await fpState.openPromise.catch(() => {});
    }
    fpState.openPromise = doOpenFirstPersonViewer(sceneId, options);
    try {
        await fpState.openPromise;
    } finally {
        fpState.openPromise = null;
    }
}

/**
 * The actual open sequence.
 * @param {string} sceneId - Scene id
 * @param {Object} options - Open options
 * @returns {Promise<void>}
 */
async function doOpenFirstPersonViewer(sceneId, options) {
    const scene = getFirstPersonSceneById(sceneId);
    if (!scene) {
        console.error(`[first-person] scene not found: ${sceneId}`);
        showError('Cena 3D não encontrada');
        return;
    }

    const dom = getDom();
    if (!dom.container || !dom.canvas) {
        console.error('[first-person] viewer container missing from index.html');
        showError('Não foi possível abrir a cena 3D');
        return;
    }

    // Another scene is mounted: a splat scene is a whole engine's worth of GPU
    // memory, so it is torn down rather than kept warm beside the new one.
    if (fpState.viewer && fpState.sceneId !== sceneId) {
        cleanupFirstPersonFeatures();
    }

    // Clear the 2D selection, exactly as the other two viewers do.
    try {
        const { getStateManagerInstance } = await import('@js/state/state_manager.js');
        const stateManager = getStateManagerInstance();
        stateManager.clearSelection();
        stateManager.closeFeaturePanel();
    } catch (error) {
        console.warn('[first-person] could not clear the 2D selection:', error);
    }

    fpState.scene = scene;
    fpState.sceneId = sceneId;

    // UI first, so the container has a size before the engine reads one.
    setFirstPersonUiVisible(true);
    showLoadingFp('Preparando a cena...');

    // === CRITICAL SETUP: runs before anything that can fail ===
    // Visible BEFORE the load, so the close button works even if the load fails.
    fpState.isVisible = true;
    // Bound here rather than inside initScene for the same reason: a scene whose
    // splat 404s must still be closeable by its own close button.
    bindListeners(dom);

    try {
        registerKeyboardCallbacks();
        activateKeyboardServiceFp();
    } catch (error) {
        console.warn('[first-person] keyboard service unavailable:', error);
    }
    // === END CRITICAL SETUP ===

    try {
        if (!fpState.viewer) {
            await waitForElementSize(dom.canvas);
            await initScene(scene, dom);
        }
        applyPose(options.pose ?? null);
        fpState.viewer?.resize();
        // The toolbar is shared DOM that survives a close, and the tool state it
        // reflects lives in components that also survive. Re-sync on every open,
        // not only on the first: a reopen otherwise shows the labels button dark
        // while the labels are on.
        syncToolButtons();
        resumeRendering();
    } catch (error) {
        console.error('[first-person] failed to open the scene:', error);
        showError('Erro ao carregar a cena 3D');
        // A half-built scene is worse than none: the next attempt would take
        // the "resume" branch and find an engine with no splat and no walker,
        // which is a black screen with no error to show for it.
        cleanupFirstPersonFeatures();
        // A failed open still LEAVES the viewer, so whoever tracks "the scene is
        // open" (the 3D control, the deep link) has to hear about it. The close
        // event is the only signal they subscribe to.
        getEventBus().emit(EventTypes.FIRST_PERSON_CLOSED, { sceneId });
        return;
    }

    hideLoadingFp();
    getEventBus().emit(EventTypes.FIRST_PERSON_OPENED, { sceneId });
}

/**
 * Close the viewer: pause the render, drop the active tool, release the pointer
 * and give the 2D map back. Nothing is destroyed — reopening the same scene
 * resumes it, and the real teardown is cleanupFirstPersonFeatures().
 *
 * Idempotent: the control and the keyboard service may both ask for a close.
 *
 * @returns {Promise<void>}
 */
export async function closeFirstPersonViewer() {
    if (!fpState.isVisible) return;

    // Remember where the visitor stopped, so reopening resumes instead of
    // teleporting them back to the door.
    fpState.lastPose = getFirstPersonViewerState();

    pauseRendering();
    toggleMeasure(false);
    fpState.markers?.closePanel();
    fpState.walk?.disable();

    // Hands the global shortcuts back to the 2D map. Skipping it would leave the
    // app with no keyboard at all after the viewer closed.
    try {
        deactivateKeyboardServiceFp();
    } catch (error) {
        console.warn('[first-person] failed to deactivate the keyboard service:', error);
    }

    setFirstPersonUiVisible(false);
    getEventBus().emit(EventTypes.FIRST_PERSON_CLOSED, { sceneId: fpState.sceneId });
}

/**
 * Is the viewer on screen?
 * @returns {boolean} True while open
 */
export function isFirstPersonViewerOpen() {
    return fpState.isVisible === true;
}

/**
 * Current pose, for sharing and for the deep link.
 * @returns {{sceneId: string, x: number, y: number, z: number, yaw: number, pitch: number}|null}
 *   Pose, or null when no scene is mounted
 */
export function getFirstPersonViewerState() {
    if (!fpState.walk || !fpState.sceneId) return null;

    const { position, rotation } = fpState.walk.getCameraState();
    return {
        sceneId: fpState.sceneId,
        x: position.x,
        y: position.y,
        z: position.z,
        // The walk controller keeps the camera as a 'YXZ' Euler: .y is the
        // heading and .x the elevation, both in radians.
        yaw: rotation.y,
        pitch: rotation.x
    };
}

/**
 * Real teardown: everything this module built is released here.
 *
 * Called on app cleanup, and also when the visitor switches to a different
 * scene. After it, the next open rebuilds from scratch.
 */
export function cleanupFirstPersonFeatures() {
    if (fpState.animationId) {
        cancelAnimationFrame(fpState.animationId);
        fpState.animationId = null;
    }

    // The results card lives in the application panel, outside this module's
    // container, so nothing below would take it down on its own.
    hideMeasurementResults();

    if (fpState.resizeObserver) {
        fpState.resizeObserver.disconnect();
        fpState.resizeObserver = null;
    }

    // Every DOM listener this module registered (scene pointer events, close
    // button and the three toolbar buttons).
    cleanup(fpState);
    fpState.listenersBound = false;

    // Each component releases its own listeners, timers and detached nodes.
    fpState.measurement?.destroy();
    fpState.markers?.destroy();
    fpState.walk?.destroy();
    fpState.measurement = null;
    fpState.markers = null;
    fpState.walk = null;

    // The splat is the heavy GPU object; drop it before the engine goes, so the
    // textures are released rather than orphaned.
    try {
        fpState.splat?.destroy?.();
        fpState.splatLayer?.destroy?.();
    } catch (error) {
        console.warn('[first-person] failed to dispose the splat:', error);
    }
    fpState.splat = null;
    fpState.splatLayer = null;

    if (fpState.viewer && !fpState.viewer.isDestroyed) {
        try {
            fpState.viewer.destroy();
        } catch (error) {
            console.warn('[first-person] failed to destroy the viewer:', error);
        }
    }
    fpState.viewer = null;
    fpState.camera = null;
    fpState.collision = null;

    // Idempotent. Skipping it on the app-teardown path would leave the GLOBAL
    // shortcuts disabled for the rest of the session, with no viewer left to
    // blame.
    try {
        deactivateKeyboardServiceFp();
    } catch (error) {
        console.warn('[first-person] failed to deactivate the keyboard service:', error);
    }

    fpState.isVisible = false;
    fpState.isPaused = false;
    fpState.scene = null;
    fpState.sceneId = null;
    fpState.lastPose = null;
    fpState.cursor.inside = false;

    setFirstPersonUiVisible(false);
}

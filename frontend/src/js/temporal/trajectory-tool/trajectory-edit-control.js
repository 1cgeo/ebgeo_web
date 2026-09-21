// Path: js/temporal/trajectory-tool/trajectory-edit-control.js

/**
 * @fileoverview Trajectory editor for the selected feature, modelled on the line
 * tool's vertex editing.
 *
 * When a trajectory-capable feature (point / military_symbol /
 * coordination_measure) is selected, its trajectory is shown as a connecting path
 * plus edit handles in a GeoJSON layer: a numbered VERTEX handle per keypoint and
 * a MIDPOINT handle per segment. Drag a vertex to move it (keeps its time); drag a
 * midpoint to INSERT a keypoint (time = average of its neighbours); right-click or
 * long-press a vertex to remove it. "Adicionar no mapa" enters append mode — each
 * map click appends a keypoint at the current timeline instant. Per-point time
 * editing and the waypoint list live in the feature's attribute panel (the
 * `onChange` callback keeps it in sync).
 *
 * TRÊS COISAS QUE ESTE ARQUIVO GANHOU EM 2026-09-21, cada uma com o porquê no seu próprio
 * ponto, e as três amarradas entre si:
 *  - o arrasto de alça é de PONTEIRO com captura, não de mouse, senão nada disto obedece a um
 *    dedo (ver `_setupEditListeners`);
 *  - por isso mesmo o `preventDefault` da descida deixa o `click` passar, e o gerente de
 *    seleção precisa de `isHandleAt` para não ler como "clicou no vazio" o clique que acabou
 *    de INSERIR um ponto-chave;
 *  - e toda edição daqui é desfazível, uma entrada de Ctrl+Z por gesto (ver `_persist`).
 */

import { showToast, showSuccess } from '@utils/index.js';
import { deepClone } from '@utils/deep-utils.js';
import {
    registerControl,
    getControl,
    getEventBus,
    getStateManager,
    updateFeatureProperty,
    getStorageTypeFromSource,
    getMapTemporalConfigSync,
} from '@store';
import { EventTypes } from '@events/event_types.js';
import { getSnappingService } from '@js/snapping/snapping.service.js';
import { isTouchDevice, getPointerPosition } from '@utils/pointer-utils.js';
import { setupVertexRemoveLongPress } from '@js/draw_tools/drawing-touch-helpers.js';
import { handleHitBox } from '@tools/helpers/feature-hit-test.helpers.js';
import { queryHoverFeatures } from '@tools/helpers/hover-query.helpers.js';
import { normalizeTrajectory } from '../temporal-model.js';
import { unitToMs } from '../temporal.utils.js';
import { TRAJECTORY_TYPE_TO_SOURCE, TRAJECTORY_TYPE_TO_CONTROL } from '../temporal.constants.js';
import { updateSourceFeatureProperty } from '../temporal-render.service.js';
import {
    buildPathCollection,
    buildHandleCollection,
    moveKeypoint,
    insertKeypointAtSegment,
    removeKeypoint,
} from './trajectory-edit-geometry.js';

const PATH_SOURCE = 'trajectory-edit-path';
const HANDLE_SOURCE = 'trajectory-edit-handles';
const HIGHLIGHT_SOURCE = 'trajectory-edit-highlight';
const PATH_LAYER = 'trajectory-edit-path-layer';
const MIDPOINT_LAYER = 'trajectory-edit-midpoint-layer';
const HIGHLIGHT_LAYER = 'trajectory-edit-highlight-layer';
const VERTEX_LAYER = 'trajectory-edit-vertex-layer';
const VERTEX_LABEL_LAYER = 'trajectory-edit-vertex-label-layer';

export class TrajectoryEditControl {
    constructor() {
        this._map = null;
        this._toolManager = null;
        this._feature = null;
        this._featureType = null;
        this._onChange = null;

        this._adding = false;
        this._addSnapshot = null;
        this._lastAdded = null;
        this._toolbar = null;
        this._countEl = null;
        this._toolbarLayoutUnsub = null;
        this._unsubscribers = [];

        // Handle drag state (vertex move / midpoint insert).
        this._editing = false;
        this._dragType = null;   // 'vertex' | 'midpoint'
        this._dragIndex = null;
        this._dragMoved = false;
        this._previewPos = null; // [lng, lat]
        this._rafId = null;
        this._pendingPreview = false;
        this._cleanupLongPress = null;
        this._editListenersActive = false;
        this._activeEditPointerId = null;

        this._onClick = this._onClick.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
        this._onEditPointerDown = this._onEditPointerDown.bind(this);
        this._onEditPointerMove = this._onEditPointerMove.bind(this);
        this._onEditPointerUp = this._onEditPointerUp.bind(this);
        this._onEditPointerCancel = this._onEditPointerCancel.bind(this);
        this._onHoverMove = this._onHoverMove.bind(this);
        this._onCanvasContextMenu = this._onCanvasContextMenu.bind(this);
        this._performPreview = this._performPreview.bind(this);
    }

    onAdd(map, toolManager = null) {
        this._map = map;
        this._toolManager = toolManager;
        const bus = getEventBus();
        if (bus) {
            // Clear the trajectory display when the feature panel closes (deselect).
            this._unsubscribers.push(bus.on(EventTypes.FEATURE_PANEL_CLOSED, () => this.hide()));
        }
        // THE SELECTION OWNS THE DISPLAY, not the panel. "Panel closed" and "feature deselected"
        // are not the same event: `expandSidebar` (state_manager.js) tucks the feature panel
        // away by zeroing `ui.featurePanelOpen` WITHOUT emitting FEATURE_PANEL_CLOSED, on
        // purpose, because the feature stays selected. A deselect that comes next finds the flag
        // already false, `closeFeaturePanel` returns early, the event never fires, and the path
        // stayed drawn over a map with nothing selected (reported 2026-09-20: select, open the
        // Maps tab, click the map). The panel event above stays as the fast path.
        //
        // The check is deferred one microtask so a clear-then-reselect of the SAME feature in one
        // tick reads the final selection instead of tearing the display down in between.
        const state = getStateManager();
        if (state?.subscribe) {
            this._unsubscribers.push(state.subscribe('selection.features', () => {
                if (this._selectionCheckQueued) return;
                this._selectionCheckQueued = true;
                queueMicrotask(() => {
                    this._selectionCheckQueued = false;
                    this._hideIfDeselected();
                });
            }));
        }
        // Mutual exclusivity with tools: activating any tool/viewer stops trajectory
        // editing (and entering add mode deactivates the active tool — see startAdding).
        if (toolManager?.on) {
            const onToolActivated = () => this.hide();
            toolManager.on('toolActivated', onToolActivated);
            toolManager.on('viewerActivated', onToolActivated);
            this._unsubscribers.push(() => {
                toolManager.off('toolActivated', onToolActivated);
                toolManager.off('viewerActivated', onToolActivated);
            });
        }
        return null;
    }

    onRemove() {
        this.hide();
        this._unsubscribers.forEach((off) => off && off());
        this._unsubscribers = [];
        this._map = null;
    }

    /** @returns {boolean} Whether append mode is active. */
    isAdding() {
        return this._adding;
    }

    // ===== Display (shown while the feature is selected) =====

    /**
     * Shows the trajectory of a feature (path + edit handles). Replaces any
     * previously shown feature.
     * @param {Object} feature - The selected trajectory feature.
     * @param {{onChange?: function}} [options] - onChange fires after edits (panel sync).
     */
    show(feature, options = {}) {
        if (!this._map || !feature?.properties) return;
        // The other half of "the selection owns the display": the panel content that calls this
        // is built ASYNCHRONOUSLY (`createFeaturePanelContent` awaits several sections first), so
        // a build still in flight when the person deselects reaches this line AFTER the selection
        // emptied, and no later selection change would ever take the path down again.
        if (!this._isSelected(feature)) return;

        if (typeof options.onChange === 'function') this._onChange = options.onChange;

        if (this._feature && this._feature.properties?.id !== feature.properties.id) {
            this._exitAdding(false);
        }
        this._feature = feature;
        this._featureType = feature.properties.source;

        this._ensureLayers();
        this._renderAll();
        // Re-show for the same feature must not stack listeners: tear down first so
        // _setupEditListeners is idempotent (avoids duplicate map.on / long-press leak).
        this._teardownEditListeners();
        this._setupEditListeners();
    }

    /** Re-renders the path + handles for the currently shown feature (after a panel edit). */
    refreshDisplay() {
        if (this._feature) this._renderAll();
    }

    /**
     * Emphasises the vertex at `index` with a halo (driven by the panel's waypoint
     * list on hover). Pass a non-index (e.g. null) to clear the highlight.
     * @param {number|null} index - Keypoint index (time-ordered), or null to clear.
     */
    highlightVertex(index) {
        const source = this._map?.getSource(HIGHLIGHT_SOURCE);
        if (!source) return;
        const pts = normalizeTrajectory(this._feature?.properties?.trajetoria);
        const kp = Number.isInteger(index) && index >= 0 && index < pts.length ? pts[index] : null;
        source.setData({
            type: 'FeatureCollection',
            features: kp
                ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [kp.lng, kp.lat] }, properties: {} }]
                : [],
        });
    }

    /**
     * Hides the display when the feature it shows is no longer in the selection.
     * A feature that is STILL selected keeps its trajectory (multi-select, a sidebar tab over
     * the panel), which is why this asks the selection and not the panel.
     * @private
     */
    _hideIfDeselected() {
        if (!this._map || !this._feature) return;
        if (!this._isSelected(this._feature)) this.hide();
    }

    /**
     * Whether a feature is in the current selection.
     * @private
     * @param {Object} feature
     * @returns {boolean}
     */
    _isSelected(feature) {
        const id = String(feature?.properties?.id);
        const selected = getStateManager()?.getSelectedFeatures?.() || [];
        return selected.some((entry) => String(entry.id) === id);
    }

    /** Clears the trajectory display and exits add/edit mode. */
    hide() {
        this._exitAdding(false);
        this._teardownEditListeners();
        this._removeLayers();
        this._feature = null;
        this._featureType = null;
        this._onChange = null;
    }

    // ===== Append mode (point by point at the end) =====

    /** Enters append mode for the currently-shown feature. */
    startAdding() {
        if (!this._feature || this._adding) return;
        // Trajectory editing and tools are mutually exclusive: turn off any active tool.
        this._toolManager?.deactivateCurrentTool?.();
        this._adding = true;
        this._addSnapshot = deepClone(this._feature.properties?.trajetoria || []);
        this._lastAdded = null;

        // Seed the anchor (point 0) at the feature's established position when the
        // trajectory is empty, so the path always starts where the feature already is.
        this._ensureAnchorPoint();

        this._buildToolbar();
        this._map.on('click', this._onClick);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._map.getCanvas().style.cursor = 'crosshair';
    }

    _onClick(e) {
        const arr = this._ensureArray();
        const kp = { t: this._nextAppendTime(), lng: e.lngLat.lng, lat: e.lngLat.lat };
        arr.push(kp);
        this._lastAdded = kp;
        this._normalizeInPlace();
        this._renderAll();
        this._updateCount();
        this._onChange?.();
    }

    /** Removes the most recently appended keypoint (append mode right-click / undo). */
    _removeLastAdded() {
        const arr = this._feature?.properties?.trajetoria;
        if (!Array.isArray(arr) || arr.length === 0) return;
        const i = this._lastAdded ? arr.indexOf(this._lastAdded) : arr.length - 1;
        if (i < 0) return;
        // Never undo away the anchor (earliest keypoint = the feature's start position).
        if (arr[i] === normalizeTrajectory(arr)[0]) return;
        arr.splice(i, 1);
        this._lastAdded = null;
        this._renderAll();
        this._updateCount();
        this._onChange?.();
    }

    _onKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this._exitAdding(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this._exitAdding(false);
        }
    }

    _exitAdding(commit) {
        if (!this._adding) return;
        this._adding = false;

        this._map.off('click', this._onClick);
        document.removeEventListener('keydown', this._onKeyDown, true);
        // A toolActivated listener can stop append mode AFTER the next tool has
        // set its cursor. Cleanup must not overwrite that new owner's state.
        if (!this._toolManager?.activeTool) this._map.getCanvas().style.cursor = '';
        this._removeToolbar();

        if (!commit && this._addSnapshot && this._feature?.properties) {
            const arr = this._ensureArray();
            arr.length = 0;
            arr.push(...this._addSnapshot.map((k) => ({ ...k })));
        }
        this._normalizeInPlace();
        this._renderAll();
        // O CANCELAMENTO não é gesto de edição: ele repõe o instantâneo tomado na entrada do
        // modo, então uma entrada de Ctrl+Z ali desfaria uma mudança que ninguém fez. A sessão
        // inteira de acréscimo, ao contrário, vale UMA entrada, e é este o ponto em que ela
        // persiste (cada clique no mapa só mexe no array vivo).
        this._persist({ recordUndo: commit });

        if (commit) {
            const n = (this._feature?.properties?.trajetoria || []).length;
            showSuccess(`Trajetória salva (${n} ponto${n === 1 ? '' : 's'})`);
        }

        this._addSnapshot = null;
        this._lastAdded = null;
        this._onChange?.();
    }

    _currentCursorTime() {
        const t = getControl('TemporalControl')?.getCursor?.();
        if (Number.isFinite(t)) return t;
        const step = unitToMs(getMapTemporalConfigSync().unidade);
        const arr = this._feature?.properties?.trajetoria || [];
        const last = arr[arr.length - 1];
        return last ? last.t + step : Date.now();
    }

    /**
     * Time for the next appended keypoint: one timeline step past the current last
     * keypoint, so each map click extends the path forward (append to the END) —
     * re-entering append mode on an existing trajectory keeps adding at the tail
     * instead of dropping points at the cursor instant. Falls back to the cursor
     * (then now) only when there are no keypoints yet.
     * @returns {number} Epoch ms for the appended keypoint.
     */
    _nextAppendTime() {
        const arr = this._feature?.properties?.trajetoria;
        if (Array.isArray(arr) && arr.length > 0) {
            const sorted = normalizeTrajectory(arr);
            const last = sorted[sorted.length - 1];
            const step = unitToMs(getMapTemporalConfigSync().unidade);
            return last.t + (Number.isFinite(step) && step > 0 ? step : 60_000);
        }
        return this._currentCursorTime();
    }

    /**
     * Seeds keypoint 0 at the feature's established position when the trajectory is
     * empty, timed at the earliest timeline instant so it sorts first and stays the
     * undeletable anchor (the start of the movement path).
     */
    _ensureAnchorPoint() {
        const arr = this._ensureArray();
        if (arr.length > 0) return;
        const home = this._featureHomeCoords();
        if (!home) return;
        arr.push({ t: this._anchorTime(), lng: home[0], lat: home[1] });
        this._renderAll();
        this._onChange?.();
    }

    /** The feature's home (authored, non-displaced) coordinates, or null. */
    _featureHomeCoords() {
        const props = this._feature?.properties;
        if (Array.isArray(props?._temporalHome) && props._temporalHome.length >= 2) {
            return props._temporalHome;
        }
        const coords = this._feature?.geometry?.coordinates;
        return Array.isArray(coords) && coords.length >= 2 ? coords : null;
    }

    /** Earliest sensible instant for the anchor: timeline start, else feature start, else cursor. */
    _anchorTime() {
        const bounds = getControl('TemporalControl')?.getBounds?.();
        if (bounds && Number.isFinite(bounds.inicio)) return bounds.inicio;
        const inicio = this._feature?.properties?.temporalInicio;
        if (Number.isFinite(inicio)) return inicio;
        return this._currentCursorTime();
    }

    /** @returns {boolean} Whether `index` is the undeletable anchor (earliest keypoint). */
    _isAnchorIndex(index) {
        return index === 0;
    }

    // ===== Handle editing (move / insert / remove) =====

    /**
     * O ARRASTO DE ALÇA É DE PONTEIRO, E NÃO DE MOUSE, desde 2026-09-21 (achado E5).
     *
     * ELE NÃO FUNCIONAVA COM O DEDO. `map.on('mousedown'|'mousemove'|'mouseup')` são ouvintes de
     * MOUSE que o MapLibre registra no DOM e não sintetiza a partir do toque; o contêiner do
     * canvas declara `touch-action: none` e o próprio MapLibre dá `preventDefault` no `touchmove`,
     * de modo que o arrasto consome o gesto e nenhum evento de compatibilidade nasce. No tablet
     * as alças apareciam e não obedeciam: dava para REMOVER ponto-chave (toque longo, que é de
     * `touchstart`) e não dava para mover nem inserir. As onze ferramentas de desenho já tinham
     * feito esta travessia; esta é a cópia do modelo do polígono
     * (`draw_tools/polygon_tool/add_polygon_control.js`).
     *
     * A CAPTURA DE PONTEIRO é o que faz o arrasto sobreviver à saída do dedo da alça: sem ela, o
     * primeiro movimento por cima de outro elemento entregaria os eventos a ele.
     *
     * O HOVER CONTINUA DE MOUSE, de propósito: ele só decide o formato do cursor, que não existe
     * num dedo. Um `pointermove` permanente no contêiner pagaria uma consulta de alça por
     * movimento de toque para não mudar nada.
     */
    _setupEditListeners() {
        const map = this._map;
        if (!map) return;
        this._editListenersActive = true;
        map.getCanvasContainer().addEventListener('pointerdown', this._onEditPointerDown);
        // Drive the hover cursor from a continuous mousemove (like the line tool's
        // onHoverMove) rather than per-layer mouseenter/leave: the boundary events
        // only fire once, so anything that re-asserts the canvas cursor afterwards
        // (MapLibre's idle grab, dragPan) would leave it stuck. Querying every move
        // keeps the affordance correct.
        map.on('mousemove', this._onHoverMove);
        map.getCanvas().addEventListener('contextmenu', this._onCanvasContextMenu, true);

        if (isTouchDevice()) {
            this._cleanupLongPress = setupVertexRemoveLongPress(map, {
                handleLayerId: VERTEX_LAYER,
                onVertexRemove: (handle) => this._commitRemove(handle?.properties?.index),
            });
        }
    }

    _teardownEditListeners() {
        const map = this._map;
        this._cancelPreview();
        if (!map) return;
        const container = map.getCanvasContainer();
        container.removeEventListener('pointerdown', this._onEditPointerDown);
        this._detachDragListeners();
        map.off('mousemove', this._onHoverMove);
        map.getCanvas().removeEventListener('contextmenu', this._onCanvasContextMenu, true);
        // hide() also runs when this editor was never shown. Only release the
        // interactions we owned, and never clobber a newly activated tool.
        if (!this._toolManager?.activeTool) {
            if (this._editing) map.dragPan.enable();
            if (this._editListenersActive && !this._adding) map.getCanvas().style.cursor = '';
        }
        this._editListenersActive = false;
        if (this._cleanupLongPress) {
            this._cleanupLongPress();
            this._cleanupLongPress = null;
        }
        this._resetDrag();
    }

    /** Drops the per-drag pointer listeners and releases the capture, if any. @private */
    _detachDragListeners() {
        const container = this._map?.getCanvasContainer?.();
        if (!container) return;
        container.removeEventListener('pointermove', this._onEditPointerMove);
        container.removeEventListener('pointerup', this._onEditPointerUp);
        container.removeEventListener('pointercancel', this._onEditPointerCancel);
        if (this._activeEditPointerId !== null && this._activeEditPointerId !== undefined) {
            try {
                container.releasePointerCapture(this._activeEditPointerId);
            } catch {
                // O navegador já pode tê-lo soltado (pointercancel), e tentar de novo levanta.
                // A captura é conveniência, nunca invariante.
            }
            this._activeEditPointerId = null;
        }
    }

    /** Continuous hover: re-applies the handle cursor on every move (idle when dragging/adding). */
    _onHoverMove(e) {
        if (this._adding || this._editing) return;
        this._setHoverCursorAt(e?.point);
    }

    /**
     * Sets the cursor for whatever handle is under `point`. Distinct affordances so
     * the action is obvious before clicking — and deliberately NOT `grab` for a
     * vertex, since MapLibre's idle canvas cursor is already `grab` (pan) and the two
     * would be indistinguishable:
     *  - vertex   → `move`  (reposition the keypoint)
     *  - midpoint → `copy`  ("+", inserts a new keypoint)
     *  - neither  → `''`    (falls back to MapLibre's pan cursor)
     * @param {{x:number,y:number}} [point] - Screen point to query.
     */
    _setHoverCursorAt(point) {
        const type = point ? this._queryHandle(point)?.properties?.handleType : null;
        let cursor = '';
        if (type === 'midpoint') cursor = 'copy';
        else if (type === 'vertex') cursor = 'move';
        this._map.getCanvas().style.cursor = cursor;
    }

    _onEditPointerDown(e) {
        if (this._adding) return;
        if (e.button === 2) return; // right-click → contextmenu
        // SÓ O PONTEIRO PRIMÁRIO: num toque de dois dedos o segundo chega aqui como um
        // `pointerdown` próprio e começaria um segundo arrasto da mesma alça, com o dedo errado.
        if (e.isPrimary === false) return;

        const container = this._map.getCanvasContainer();
        const point = getPointerPosition(e, container);
        const handle = this._queryHandle(point);
        if (!handle) return;

        this._editing = true;
        this._dragType = handle.properties.handleType;
        this._dragIndex = handle.properties.index;
        this._dragMoved = false;
        this._previewPos = handle.geometry.coordinates.slice();
        this._map.dragPan.disable();
        // While dragging: vertex = grabbing (holding/repositioning), midpoint keeps
        // "copy" (+) since releasing creates a new keypoint. Both differ from the
        // hover cursors (move / copy) and from MapLibre's idle pan cursor (grab).
        this._map.getCanvas().style.cursor = this._dragType === 'midpoint' ? 'copy' : 'grabbing';

        this._activeEditPointerId = e.pointerId;
        try {
            container.setPointerCapture(e.pointerId);
        } catch {
            // Sem captura o arrasto ainda funciona enquanto o dedo não sair do elemento.
            this._activeEditPointerId = null;
        }
        container.addEventListener('pointermove', this._onEditPointerMove);
        container.addEventListener('pointerup', this._onEditPointerUp);
        // `pointercancel` É OBRIGATÓRIO NO TOQUE: gesto de sistema, notificação ou o navegador
        // assumindo o gesto interrompem o arrasto sem um `pointerup`, e sem este par a bandeira
        // ficaria presa em verdadeiro e o ouvinte de movimento vazaria.
        container.addEventListener('pointercancel', this._onEditPointerCancel);

        // `preventDefault` CANCELA OS EVENTOS DE MOUSE DE COMPATIBILIDADE E NÃO CANCELA O
        // `click`, que é a razão de `tool_manager/click-after-drag.js` existir e de este editor
        // publicar `isHandleAt` para o gerente de seleção (achado E3).
        e.preventDefault();
    }

    _onEditPointerMove(e) {
        if (!this._editing) return;
        if (e.isPrimary === false) return;
        // O EVENTO É DOM: `e.point` e `e.lngLat` do evento de mapa do MapLibre não existem num
        // `PointerEvent`, então a posição de tela e a coordenada se derivam aqui.
        const point = getPointerPosition(e, this._map.getCanvasContainer());
        const lngLat = this._map.unproject([point.x, point.y]);

        const excludeId = this._feature?.properties?.id;
        const snapping = getSnappingService();
        const snap = snapping?.resolve(this._map, point, lngLat, excludeId) ?? lngLat;
        this._previewPos = [snap.lng, snap.lat];
        this._dragMoved = true;

        if (snap.snapped) snapping.showIndicator(this._map, snap, snap.snapType);
        else snapping?.hideIndicator(this._map);

        if (!this._pendingPreview) {
            this._pendingPreview = true;
            this._rafId = requestAnimationFrame(this._performPreview);
        }
    }

    _performPreview() {
        this._pendingPreview = false;
        this._rafId = null;
        if (!this._editing || !this._previewPos) return;
        const preview = this._applyDrag(this._dragType, this._dragIndex, this._previewPos);
        if (!preview) return;
        this._map.getSource(PATH_SOURCE)?.setData(buildPathCollection(preview));
        this._map.getSource(HANDLE_SOURCE)?.setData(buildHandleCollection(preview));
    }

    _onEditPointerUp(e) {
        this._detachDragListeners();
        if (!this._editing) return;
        const type = this._dragType;
        const index = this._dragIndex;
        const pos = this._previewPos;
        const moved = this._dragMoved;

        getSnappingService()?.hideIndicator(this._map);
        this._map.dragPan.enable();
        // Restore the hover cursor for whatever handle is still under the pointer,
        // so the affordance doesn't go blank until the next mouse move off-and-on.
        this._setHoverCursorAt(e ? getPointerPosition(e, this._map.getCanvasContainer()) : null);
        this._resetDrag();

        if (!pos) return;
        // A vertex needs an actual drag to move; a midpoint commits on click or drag
        // (clicking a midpoint splits the segment at its centre).
        if (type === 'vertex' && !moved) {
            this._renderAll(); // discard any preview, restore the real positions
            return;
        }
        const next = this._applyDrag(type, index, pos);
        if (!next) {
            this._renderAll();
            return;
        }
        this._setTrajectory(next);
        this._renderAll();
        this._persist();
        this._onChange?.();
    }

    /**
     * UM GESTO CANCELADO NÃO ESCREVE, e é aqui que este editor se afasta do modelo do polígono,
     * que liga o cancelamento ao mesmo tratador do `pointerup`. A diferença é o que está em jogo:
     * um `pointercancel` sobre uma alça de PONTO MÉDIO com o dedo parado seria indistinguível de
     * um toque, e o toque INSERE um ponto-chave. Uma notificação do sistema no meio do gesto
     * passaria a acrescentar pontos à rota. O desfecho certo é descartar a prévia e redesenhar a
     * trajetória que a store tem.
     */
    _onEditPointerCancel() {
        this._detachDragListeners();
        if (!this._editing) return;
        getSnappingService()?.hideIndicator(this._map);
        this._map.dragPan.enable();
        this._map.getCanvas().style.cursor = '';
        this._resetDrag();
        this._renderAll();
    }

    /** Pure preview/commit transform for a drag (no side effects). */
    _applyDrag(type, index, [lng, lat]) {
        const traj = this._feature?.properties?.trajetoria;
        return type === 'midpoint'
            ? insertKeypointAtSegment(traj, index, lng, lat)
            : moveKeypoint(traj, index, lng, lat);
    }

    /** Removes the keypoint at `index` (right-click / long-press), then persists. */
    _commitRemove(index) {
        // The first keypoint anchors the feature's start position and is fixed.
        if (this._isAnchorIndex(index)) {
            showToast('O ponto inicial (posição da feição) não pode ser removido.', 'info');
            return;
        }
        const next = removeKeypoint(this._feature?.properties?.trajetoria, index);
        if (!next) return;
        this._setTrajectory(next);
        this._renderAll();
        this._persist();
        this._onChange?.();
    }

    _onCanvasContextMenu(e) {
        if (!this._feature) return;
        if (this._adding) {
            e.preventDefault();
            this._removeLastAdded();
            return;
        }
        const canvas = this._map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const point = [e.clientX - rect.left, e.clientY - rect.top];
        // A MESMA caixa de acerto e a mesma peneira de camadas da descida: consultar por um
        // PONTO exigia acertar os 9px do círculo, e nomear a camada direto LEVANTA quando ela
        // não está no estilo (o editor remove as dele em `_removeLayers`).
        const handles = queryHoverFeatures(this._map, handleHitBox(point), [VERTEX_LAYER]);
        const vertex = handles.find((f) => f.properties?.handleType === 'vertex');
        if (!vertex) return; // let the app context menu show
        e.preventDefault();
        e.stopPropagation();
        this._commitRemove(vertex.properties.index);
    }

    /**
     * The handle under a screen point, or null.
     *
     * THE QUERY IS A BOX AND NÃO UM PONTO, a mesma `handleHitBox` das ferramentas de desenho: a
     * alça tem 9px de raio e a ponta de um dedo cobre cerca de 34, então um ponto só acertava
     * quando o toque caía dentro do círculo. `queryHoverFeatures` ainda peneira as camadas pelo
     * estilo, porque o MapLibre LEVANTA ao receber um id que não está lá e este editor remove as
     * dele em `_removeLayers`.
     * @param {{x:number,y:number}} point - Screen point, canvas-relative.
     * @returns {Object|null}
     */
    _queryHandle(point) {
        // Vertex layer sits above the midpoint layer, so an overlapping vertex wins.
        const handles = queryHoverFeatures(this._map, handleHitBox(point), [VERTEX_LAYER, MIDPOINT_LAYER]);
        return handles.find((f) => f.properties?.role === 'handle') || null;
    }

    /**
     * CLICAR NUMA ALÇA NÃO É CLICAR NO VAZIO, e até 2026-09-21 o gerente de seleção achava que
     * era (achado E3, medido no navegador).
     *
     * O QUE ACONTECIA: clicar num ponto médio inseria o ponto-chave (3 viravam 4) e, no MESMO
     * gesto, a seleção ia a zero e o painel fechava. O `pointerdown` do arrasto de alça dá
     * `preventDefault`, o que cancela os eventos de mouse de compatibilidade e NÃO cancela o
     * `click`; a regra de fim de arrasto (`tool_manager/click-after-drag.js`) só descarta cliques
     * que ANDARAM mais de 3px, e inserir por clique não anda. O clique chegava inteiro a
     * `_handleMapClick`, caía longe do ícone da feição (os vértices 2..N ficam onde a rota passa)
     * e desselecionava. A isenção que já existia lá cobria só o modo de ACRÉSCIMO (`isAdding`).
     *
     * O PREDICADO É SEM ESTADO de propósito. Uma bandeira "consumi este clique", posta na descida
     * e lida no clique, fica presa quando o clique não chega (um `pointercancel`, um arrasto que
     * o MapLibre engole) e come o clique SEGUINTE, que é um desselecionar que não acontece e que
     * ninguém relaciona com a trajetória. Perguntar pela alça a cada clique se corrige sozinho.
     *
     * Vale para o ponto médio (depois de inserir há um VÉRTICE exatamente sob o cursor) e para o
     * vértice clicado sem arrastar (a alça continua lá).
     *
     * @param {{x:number,y:number}} point - Screen point of the click, canvas-relative.
     * @returns {boolean} True when one of this editor's handles is under `point`.
     */
    isHandleAt(point) {
        if (!this._map || !this._feature || !point) return false;
        try {
            return this._queryHandle(point) !== null;
        } catch {
            // Um mapa em reconstrução de estilo pode levantar na consulta. Falhar aqui devolve o
            // comportamento anterior (o clique segue e desseleciona), nunca uma seleção presa.
            return false;
        }
    }

    _resetDrag() {
        this._editing = false;
        this._dragType = null;
        this._dragIndex = null;
        this._dragMoved = false;
        this._previewPos = null;
    }

    _cancelPreview() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._pendingPreview = false;
    }

    // ===== Trajectory array (kept by reference so the panel list stays in sync) =====

    _ensureArray() {
        if (!Array.isArray(this._feature.properties.trajetoria)) {
            this._feature.properties.trajetoria = [];
        }
        return this._feature.properties.trajetoria;
    }

    /** Replaces the live array's contents in place, preserving its reference. */
    _setTrajectory(next) {
        const arr = this._ensureArray();
        arr.length = 0;
        arr.push(...next);
    }

    /** Sorts/validates the live array in place, preserving its reference. */
    _normalizeInPlace() {
        const arr = this._feature?.properties?.trajetoria;
        if (!Array.isArray(arr)) return;
        const sorted = normalizeTrajectory(arr);
        arr.length = 0;
        arr.push(...sorted);
    }

    // ===== Rendering =====

    _renderAll() {
        const traj = this._feature?.properties?.trajetoria;
        this._map?.getSource(PATH_SOURCE)?.setData(buildPathCollection(traj));
        this._map?.getSource(HANDLE_SOURCE)?.setData(buildHandleCollection(traj));
    }

    /**
     * Declares the three editor sources. They stay OUT of the geojson dispatcher and keep
     * writing with `setData`, on purpose: no `promoteId` (path/handle features carry an
     * `index`, never a stable `properties.id`, so every diff key would be null), the whole
     * collection is rebuilt from the keypoint array on each render anyway, and `_performPreview`
     * rewrites them once per animation frame during a drag, which is exactly the no-gap cadence
     * where back-to-back `updateData` calls were measured to drop each other. They are also
     * removed outright in `_removeLayers`, so there is no source to own between sessions.
     */
    _ensureLayers() {
        const map = this._map;
        if (!map.getSource(PATH_SOURCE)) {
            map.addSource(PATH_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getSource(HANDLE_SOURCE)) {
            map.addSource(HANDLE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getSource(HIGHLIGHT_SOURCE)) {
            map.addSource(HIGHLIGHT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!map.getLayer(PATH_LAYER)) {
            map.addLayer({
                id: PATH_LAYER,
                type: 'line',
                source: PATH_SOURCE,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': '#16a34a', 'line-width': 3, 'line-dasharray': [2, 1.5] },
            });
        }
        if (!map.getLayer(MIDPOINT_LAYER)) {
            map.addLayer({
                id: MIDPOINT_LAYER,
                type: 'circle',
                source: HANDLE_SOURCE,
                filter: ['==', ['get', 'handleType'], 'midpoint'],
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#ffffff',
                    'circle-opacity': 0.9,
                    'circle-stroke-color': '#16a34a',
                    'circle-stroke-width': 2,
                },
            });
        }
        if (!map.getLayer(HIGHLIGHT_LAYER)) {
            map.addLayer({
                id: HIGHLIGHT_LAYER,
                type: 'circle',
                source: HIGHLIGHT_SOURCE,
                paint: {
                    'circle-radius': 14,
                    'circle-opacity': 0,
                    'circle-stroke-color': '#f59e0b',
                    'circle-stroke-width': 3,
                },
            });
        }
        if (!map.getLayer(VERTEX_LAYER)) {
            map.addLayer({
                id: VERTEX_LAYER,
                type: 'circle',
                source: HANDLE_SOURCE,
                filter: ['==', ['get', 'handleType'], 'vertex'],
                paint: {
                    'circle-radius': 9,
                    'circle-color': '#16a34a',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2.5,
                },
            });
        }
        if (!map.getLayer(VERTEX_LABEL_LAYER)) {
            map.addLayer({
                id: VERTEX_LABEL_LAYER,
                type: 'symbol',
                source: HANDLE_SOURCE,
                filter: ['==', ['get', 'handleType'], 'vertex'],
                layout: {
                    'text-field': ['get', 'label'],
                    'text-size': 12,
                    'text-font': ['Noto Sans Bold'],
                    'text-allow-overlap': true,
                    'text-ignore-placement': true,
                },
                paint: { 'text-color': '#ffffff' },
            });
        }
    }

    _removeLayers() {
        const map = this._map;
        if (!map) return;
        for (const id of [VERTEX_LABEL_LAYER, VERTEX_LAYER, HIGHLIGHT_LAYER, MIDPOINT_LAYER, PATH_LAYER]) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(HIGHLIGHT_SOURCE)) map.removeSource(HIGHLIGHT_SOURCE);
        if (map.getSource(HANDLE_SOURCE)) map.removeSource(HANDLE_SOURCE);
        if (map.getSource(PATH_SOURCE)) map.removeSource(PATH_SOURCE);
    }

    // ===== Persistence =====

    /**
     * Persists the live trajectory array.
     *
     * TODA EDIÇÃO DE TRAJETÓRIA É DESFAZÍVEL desde 2026-09-21 (achado E2). Antes, só o arrasto do
     * PRIMEIRO ponto-chave era: ele cai no ramo da âncora, que grava pelo controle dono
     * (`updateFeatures` → `updateFeature`), e `updateFeature` registra ação de desfazer. Os
     * demais gestos gravavam por `updateFeatureProperty`, que não registrava nada, então o mesmo
     * gesto tinha duas regras e arrastar o vértice 2 era irreversível. A escrita de propriedade
     * ganhou o desfazer como opção EXPLÍCITA (o padrão continua sem, porque ela é a escrita do
     * olho de visibilidade e do cadeado, em laço sobre seleção múltipla), e cada gesto daqui
     * acende a opção uma vez: um arrasto, uma inserção, uma remoção e a SESSÃO INTEIRA de
     * "Adicionar no mapa" valem cada uma UMA entrada de Ctrl+Z, porque o acréscimo só persiste
     * ao sair do modo.
     *
     * QUEM REPINTA: o desfazer não volta por aqui. `map/undo-redo.runner.js` desseleciona (o que
     * derruba este editor pelo ouvinte de seleção), inverte a ação e reconstrói o mapa base, que
     * é o que repõe a fonte do MapLibre a partir da store. É o mesmo caminho de qualquer outra
     * ação, e por isso não há repintura especial de trajetória a escrever.
     *
     * @param {{recordUndo?: boolean}} [options] - `recordUndo: false` grava sem entrada de
     *   desfazer (o CANCELAMENTO do modo de acréscimo, que só repõe o instantâneo de entrada).
     */
    _persist({ recordUndo = true } = {}) {
        const props = this._feature?.properties;
        if (!props) return;
        const sorted = normalizeTrajectory(props.trajetoria);

        // The anchor (kp 0) is bound 1:1 to the feature's home position. If it moved
        // (anchor vertex dragged), relocate the feature too and persist geometry +
        // trajectory together through the owning control, so both land consistently.
        if (this._syncHomeToAnchor(sorted[0])) {
            const control = getControl(TRAJECTORY_TYPE_TO_CONTROL[this._featureType]);
            if (control?.updateFeatures) {
                // Este ramo já era desfazível: `updateFeatures(…, true)` chama `updateFeature`,
                // que registra a ação sozinho. Ele não tem (nem precisa de) a opção.
                control.updateFeatures([this._feature], true);
            } else {
                // updateFeatureProperty keys by STORAGE type — convert the source type.
                updateFeatureProperty(
                    getStorageTypeFromSource(this._featureType), props.id, 'trajetoria', sorted,
                    null, { recordUndo },
                );
            }
            getControl('TemporalControl')?.sync();
            return;
        }

        const sourceId = TRAJECTORY_TYPE_TO_SOURCE[this._featureType];
        if (sourceId) {
            updateSourceFeatureProperty(this._map, sourceId, props.id, 'trajetoria', sorted);
        }
        // updateFeatureProperty keys by STORAGE type ('points'), not the source type
        // ('point') held in _featureType — convert or the store write silently fails.
        updateFeatureProperty(
            getStorageTypeFromSource(this._featureType), props.id, 'trajetoria', sorted,
            null, { recordUndo },
        );
        getControl('TemporalControl')?.sync();
    }

    /**
     * Binds the feature's home (authoring) position to the trajectory anchor (kp 0):
     * relocating the anchor relocates the feature's initial position. Updates
     * `_temporalHome` when the feature is currently displaced (temporal active), else
     * its geometry coordinates. The owning control then persists geometry + store.
     * @param {{lng:number, lat:number}|undefined} anchor - The earliest keypoint.
     * @returns {boolean} True when the home position changed.
     */
    _syncHomeToAnchor(anchor) {
        const feature = this._feature;
        if (!anchor || !feature?.properties) return false;
        if (!Number.isFinite(anchor.lng) || !Number.isFinite(anchor.lat)) return false;

        const props = feature.properties;
        if (Array.isArray(props._temporalHome)) {
            if (props._temporalHome[0] === anchor.lng && props._temporalHome[1] === anchor.lat) return false;
            props._temporalHome = [anchor.lng, anchor.lat];
            return true;
        }
        const cur = feature.geometry?.coordinates;
        if (Array.isArray(cur) && cur[0] === anchor.lng && cur[1] === anchor.lat) return false;
        if (feature.geometry && Array.isArray(cur)) {
            feature.geometry.coordinates = [anchor.lng, anchor.lat];
            return true;
        }
        return false;
    }

    // ===== On-screen append toolbar =====

    _buildToolbar() {
        this._removeToolbar();
        const bar = document.createElement('div');
        bar.className = 'trajectory-edit-toolbar';
        bar.innerHTML = `
            <span class="trajectory-edit-toolbar__hint">Clique no mapa</span>
            <span class="trajectory-edit-toolbar__count"></span>
            <button type="button" class="trajectory-edit-toolbar__btn trajectory-edit-toolbar__cancel">Cancelar</button>
            <button type="button" class="trajectory-edit-toolbar__btn trajectory-edit-toolbar__done">Concluir</button>
        `;
        document.body.appendChild(bar);
        this._toolbar = bar;
        this._countEl = bar.querySelector('.trajectory-edit-toolbar__count');

        bar.querySelector('.trajectory-edit-toolbar__cancel').addEventListener('click', () => this._exitAdding(false));
        bar.querySelector('.trajectory-edit-toolbar__done').addEventListener('click', () => this._exitAdding(true));
        this._updateCount();

        // Keep the bar aligned with the active-tool chip slot: shift with the
        // sidebar / feature panel exactly like the chip does (via data-sidebar-state).
        this._updateToolbarSidebarState();
        this._toolbarLayoutUnsub = getEventBus()?.on(
            EventTypes.UI_LAYOUT_CHANGED,
            () => this._updateToolbarSidebarState()
        );
    }

    _updateToolbarSidebarState() {
        if (!this._toolbar) return;
        let sm;
        try {
            sm = getStateManager();
        } catch {
            sm = null;
        }
        const expanded = sm?.getUnsafe?.('sidebar.expanded') || sm?.getUnsafe?.('ui.featurePanelOpen') || false;
        this._toolbar.dataset.sidebarState = expanded ? 'expanded' : 'collapsed';
    }

    _updateCount() {
        if (!this._countEl) return;
        const n = (this._feature?.properties?.trajetoria || []).length;
        this._countEl.textContent = `${n} ponto${n === 1 ? '' : 's'}`;
    }

    _removeToolbar() {
        if (this._toolbarLayoutUnsub) {
            this._toolbarLayoutUnsub();
            this._toolbarLayoutUnsub = null;
        }
        if (this._toolbar) {
            this._toolbar.remove();
            this._toolbar = null;
            this._countEl = null;
        }
    }

    destroy() {
        this.onRemove();
    }
}

/**
 * Creates, attaches and registers the trajectory edit control.
 * @param {Object} map - MapLibre map instance.
 * @param {Object} [toolManager] - ToolManager, for mutual exclusivity with tools.
 * @returns {TrajectoryEditControl}
 */
export function createTrajectoryEditControl(map, toolManager) {
    const control = new TrajectoryEditControl();
    control.onAdd(map, toolManager);
    registerControl('TrajectoryEditControl', control);
    return control;
}

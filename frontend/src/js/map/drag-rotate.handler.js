// Path: js/map/drag-rotate.handler.js
import {
    DRAG_MODE,
    LEFT_BUTTON,
    MIDDLE_BUTTON,
    clampPitch,
    computeCameraDelta,
    exceedsDragThreshold,
    resolveDragMode
} from './drag-rotate.model.js';

/**
 * Mouse-only camera gesture: Ctrl drags the pitch, Shift drags the bearing,
 * Ctrl+Shift drags both, and the MIDDLE BUTTON drags both with no modifier at
 * all. The native `dragRotate` is disabled at map creation, so this is the only
 * source of mouse-driven rotation.
 *
 * Touch is deliberately NOT handled here: two-finger zoom/rotate is left to
 * MapLibre's own `touchZoomRotate`, which has activation thresholds. The custom
 * two-finger path that used to live here fired from the first pixel and summed
 * with the native handler, which is what made pinch-zoom jitter and rotate.
 */
const CURSOR_BY_MODE = {
    [DRAG_MODE.PITCH]: 'ns-resize',
    [DRAG_MODE.BEARING]: 'ew-resize',
    [DRAG_MODE.BOTH]: 'grabbing'
};

class DragRotateHandler {
    constructor(map) {
        this._map = map;
        this._canvas = null;
        this._mode = DRAG_MODE.NONE;
        /** O botão que começou o gesto: é ELE que tem o direito de terminá-lo. */
        this._button = LEFT_BUTTON;
        this._engaged = false;
        this._startPoint = null;
        this._accumDx = 0;
        this._accumDy = 0;
        this._originalCursor = '';
        this._dragPanWasEnabled = false;
        this._swallowClick = null;
        this._swallowTipo = null;
        this._swallowTimer = null;

        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onWindowBlur = this._onWindowBlur.bind(this);
    }

    enable() {
        if (!this._map) return;

        this._canvas = this._map.getCanvasContainer();
        if (!this._canvas) return;

        this._canvas.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('mousemove', this._onMouseMove);
        // A lost mouseup (Alt+Tab mid-drag) would otherwise leave dragPan disabled.
        window.addEventListener('blur', this._onWindowBlur);
    }

    disable() {
        if (this._canvas) {
            this._canvas.removeEventListener('mousedown', this._onMouseDown);
        }

        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('mousemove', this._onMouseMove);
        window.removeEventListener('blur', this._onWindowBlur);

        this._endDrag();
        // `_endDrag` may have just armed the one-tick click swallow; tearing the
        // handler down must not leave a window listener (and a timer) behind.
        this._disarmClickSwallow();
    }

    _onMouseDown(e) {
        const mode = resolveDragMode(e);
        if (mode === DRAG_MODE.NONE) return;

        this._mode = mode;
        this._button = e.button ?? LEFT_BUTTON;
        this._engaged = false;
        this._startPoint = { x: e.clientX, y: e.clientY };
        this._accumDx = 0;
        this._accumDy = 0;

        // O AUTOSCROLL DO NAVEGADOR MORRE AQUI, e é o `preventDefault` do fim deste método que o
        // mata: no Windows, o botão do meio abre aquele alvo de rolagem automática, e com ele na
        // tela o movimento do ponteiro rola a página em vez de girar o mapa.
        //
        // dragPan must go down at mousedown: MapLibre's mousePan accepts
        // Shift+left button, so it would pan while we rotate.
        this._dragPanWasEnabled = Boolean(this._map.dragPan?.isEnabled?.());
        if (this._dragPanWasEnabled) {
            this._map.dragPan.disable();
        }

        e.preventDefault();
    }

    _onMouseMove(e) {
        if (this._mode === DRAG_MODE.NONE || !this._startPoint) return;

        const dx = e.clientX - this._startPoint.x;
        const dy = e.clientY - this._startPoint.y;
        this._startPoint = { x: e.clientX, y: e.clientY };

        this._accumDx += dx;
        this._accumDy += dy;

        if (!this._engaged) {
            if (!exceedsDragThreshold(this._accumDx, this._accumDy)) return;
            this._engage();
        }

        const { bearingDelta, pitchDelta } = computeCameraDelta(this._mode, dx, dy);

        // Um jumpTo para os dois eixos: `setBearing` e `setPitch` sao cada um um jumpTo
        // completo (matriz refeita, cascata de eventos move/rotate/pitch, repintura), entao o
        // gesto Ctrl+Shift pagava isso duas vezes por mousemove.
        const target = {};
        if (bearingDelta !== 0) {
            target.bearing = this._map.getBearing() + bearingDelta;
        }
        if (pitchDelta !== 0) {
            target.pitch = clampPitch(
                this._map.getPitch() + pitchDelta,
                this._map.getMinPitch(),
                this._map.getMaxPitch()
            );
        }
        if (target.bearing !== undefined || target.pitch !== undefined) {
            this._map.jumpTo(target);
        }
    }

    _onMouseUp(e) {
        // SÓ O BOTÃO QUE COMEÇOU TERMINA. Era uma comparação com o esquerdo fixo, pela mesma
        // razão que continua valendo: um clique com o direito (menu de contexto) solto no meio do
        // arrasto não pode encerrar o gesto, porque encerrar reabilita o dragPan com o esquerdo
        // ainda apertado e o MapLibre retoma a panorâmica do ponto velho do mousedown. Com o
        // botão do meio no gesto, o esquerdo fixo tinha o efeito oposto e pior: o `mouseup` do
        // meio chega com `button === 1` e o arrasto NUNCA terminaria.
        if (e && e.button !== this._button) return;
        this._endDrag();
    }

    _onWindowBlur() {
        this._endDrag();
    }

    _engage() {
        this._engaged = true;
        if (this._canvas) {
            this._originalCursor = this._canvas.style.cursor;
            this._canvas.style.cursor = CURSOR_BY_MODE[this._mode] ?? 'grabbing';
        }
    }

    _endDrag() {
        if (this._mode === DRAG_MODE.NONE) return;

        const wasEngaged = this._engaged;

        this._mode = DRAG_MODE.NONE;
        this._startPoint = null;
        this._accumDx = 0;
        this._accumDy = 0;

        // Restore dragPan only if it was on at mousedown, so a drawing tool that
        // already had it off keeps it off. Known limit: a tool activated by
        // keyboard DURING the drag (which disables dragPan) gets it re-enabled
        // here, because this snapshot predates that call. There are 15 sites
        // calling dragPan.disable() in the app; a snapshot is the only thing that
        // survives all of them without a registry nobody would keep up to date.
        if (this._dragPanWasEnabled) {
            this._map.dragPan?.enable?.();
            this._dragPanWasEnabled = false;
        }

        if (wasEngaged && this._canvas) {
            this._canvas.style.cursor = this._originalCursor;
        }
        this._engaged = false;

        if (wasEngaged) {
            // O BOTÃO DO MEIO NÃO DISPARA `click`, e sim `auxclick`: engolir o evento errado
            // deixaria passar o que se queria comer e comeria um clique que ninguém deu.
            this._swallowClickAfterDrag(this._button === MIDDLE_BUTTON ? 'auxclick' : 'click');
        }
        this._button = LEFT_BUTTON;
    }

    /**
     * Swallows the synthetic `click` the browser fires at the end of the drag.
     *
     * The browser fires `click` after mousedown+mouseup on the same element even
     * when the pointer travelled hundreds of pixels, and MapLibre's own
     * `suppressClick` only covers gestures ITS handlers drove — this one is ours,
     * so nothing suppresses it. The click then reaches `map.on('click')`, where
     * `selection_manager` deselects everything on empty ground and
     * `comment_tool/comment-overlay.js` plants a comment pin: a rotation would
     * silently undo the selection the person was rotating around.
     *
     * Capture phase on `window` is what makes this work: MapLibre listens on the
     * canvas container, so stopping propagation above it beats every listener
     * below. Only armed when the drag actually ENGAGED (past the 3 px threshold),
     * so a Shift+click that never moved still selects.
     * @param {string} [tipo='click'] - O evento a engolir (o botao do meio dispara `auxclick`).
     * @private
     */
    _swallowClickAfterDrag(tipo = 'click') {
        if (this._swallowClick) return;

        this._swallowTipo = tipo;
        this._swallowClick = (event) => {
            event.stopPropagation();
            event.preventDefault();
        };
        window.addEventListener(tipo, this._swallowClick, true);
        // One tick only: the click we are eating is dispatched synchronously
        // right after this mouseup, so anything later is a real click.
        this._swallowTimer = setTimeout(() => this._disarmClickSwallow(), 0);
    }

    /** @private */
    _disarmClickSwallow() {
        if (this._swallowTimer) {
            clearTimeout(this._swallowTimer);
            this._swallowTimer = null;
        }
        if (this._swallowClick) {
            window.removeEventListener(this._swallowTipo ?? 'click', this._swallowClick, true);
            this._swallowClick = null;
            this._swallowTipo = null;
        }
    }
}

export default DragRotateHandler;

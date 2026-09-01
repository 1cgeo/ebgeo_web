// Path: js/map/drag-rotate.handler.js
import {
    DRAG_MODE,
    clampPitch,
    computeCameraDelta,
    exceedsDragThreshold,
    resolveDragMode
} from './drag-rotate.model.js';

/**
 * Mouse-only camera gesture: Ctrl drags the pitch, Shift drags the bearing,
 * Ctrl+Shift drags both. The native `dragRotate` is disabled at map creation,
 * so this is the only source of mouse-driven rotation.
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
        this._engaged = false;
        this._startPoint = null;
        this._accumDx = 0;
        this._accumDy = 0;
        this._originalCursor = '';
        this._dragPanWasEnabled = false;

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
    }

    _onMouseDown(e) {
        const mode = resolveDragMode(e);
        if (mode === DRAG_MODE.NONE) return;

        this._mode = mode;
        this._engaged = false;
        this._startPoint = { x: e.clientX, y: e.clientY };
        this._accumDx = 0;
        this._accumDy = 0;

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

        if (bearingDelta !== 0) {
            this._map.setBearing(this._map.getBearing() + bearingDelta);
        }
        if (pitchDelta !== 0) {
            const nextPitch = clampPitch(
                this._map.getPitch() + pitchDelta,
                this._map.getMinPitch(),
                this._map.getMaxPitch()
            );
            this._map.setPitch(nextPitch);
        }
    }

    _onMouseUp(e) {
        // Only the left button drives the gesture. A right-click (context menu)
        // released mid-drag must not end it: ending it re-enables dragPan while
        // the left button is still down, and MapLibre would resume panning from
        // the stale mousedown point.
        if (e && e.button !== 0) return;
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

        this._mode = DRAG_MODE.NONE;
        this._startPoint = null;
        this._accumDx = 0;
        this._accumDy = 0;

        // Restore dragPan only if it was on at mousedown, so a drawing tool that
        // already had it off keeps it off. Known limit: a tool activated by
        // keyboard DURING the drag (which disables dragPan) gets it re-enabled
        // here, because this snapshot predates that call.
        if (this._dragPanWasEnabled) {
            this._map.dragPan?.enable?.();
            this._dragPanWasEnabled = false;
        }

        if (this._engaged && this._canvas) {
            this._canvas.style.cursor = this._originalCursor;
        }
        this._engaged = false;
    }
}

export default DragRotateHandler;

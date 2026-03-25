// Path: js/map/drag-rotate.handler.js
import { createTwoFingerDragHandler } from '../utilities/pointer-utils';

const PITCH_MIN = 0;
const PITCH_MAX = 85;
const MOUSE_BEARING_SENSITIVITY = 0.5;
const MOUSE_PITCH_SENSITIVITY = 0.2;
const TOUCH_PITCH_SENSITIVITY = 0.3;

class DragRotateHandler {
    constructor(map) {
        this._map = map;
        this._canvas = null;
        this._isRotating = false;
        this._startPoint = null;
        this._originalCursor = '';
        this._initialBearing = 0;
        this._initialPitch = 0;
        this._cleanupTwoFingerDrag = null;

        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
    }

    enable() {
        if (!this._map) return;

        this._canvas = this._map.getCanvasContainer();
        if (!this._canvas) return;

        this._canvas.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mouseup', this._onMouseUp);
        window.addEventListener('mousemove', this._onMouseMove);
        this._setupTwoFingerDrag();
    }

    disable() {
        if (this._canvas) {
            this._canvas.removeEventListener('mousedown', this._onMouseDown);
        }

        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('mousemove', this._onMouseMove);

        if (this._cleanupTwoFingerDrag) {
            this._cleanupTwoFingerDrag();
            this._cleanupTwoFingerDrag = null;
        }

        if (this._isRotating) {
            this._endRotation();
        }
    }

    _setupTwoFingerDrag() {
        this._cleanupTwoFingerDrag = createTwoFingerDragHandler(
            this._canvas,
            {
                onStart: () => {
                    this._initialBearing = this._map.getBearing();
                    this._initialPitch = this._map.getPitch();
                    this._beginRotation();
                },
                onMove: (angleDelta, midpointDelta) => {
                    this._map.setBearing(this._initialBearing + angleDelta);

                    const pitchDelta = -midpointDelta.y * TOUCH_PITCH_SENSITIVITY;
                    const newPitch = clampPitch(this._initialPitch + pitchDelta);
                    this._map.setPitch(newPitch);
                },
                onEnd: () => {
                    this._endRotation();
                }
            }
        );
    }

    _onMouseDown(e) {
        if (!e.ctrlKey || e.button !== 0) return;

        this._isRotating = true;
        this._startPoint = { x: e.clientX, y: e.clientY };
        this._beginRotation();
        e.preventDefault();
    }

    _onMouseMove(e) {
        if (!this._isRotating || !this._startPoint) return;

        const dx = e.clientX - this._startPoint.x;
        const dy = e.clientY - this._startPoint.y;

        this._map.setBearing(this._map.getBearing() - dx * MOUSE_BEARING_SENSITIVITY);
        this._map.setPitch(clampPitch(this._map.getPitch() - dy * MOUSE_PITCH_SENSITIVITY));

        this._startPoint = { x: e.clientX, y: e.clientY };
    }

    _onMouseUp() {
        if (this._isRotating) {
            this._endRotation();
        }
    }

    _beginRotation() {
        this._isRotating = true;
        this._map.dragPan.disable();
        this._originalCursor = this._canvas.style.cursor;
        this._canvas.style.cursor = 'grabbing';
    }

    _endRotation() {
        this._isRotating = false;
        this._startPoint = null;
        this._map.dragPan.enable();

        if (this._canvas) {
            this._canvas.style.cursor = this._originalCursor;
        }
    }
}

function clampPitch(value) {
    return Math.max(PITCH_MIN, Math.min(PITCH_MAX, value));
}

export default DragRotateHandler;

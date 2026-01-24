// Path: js/map/drag-rotate.handler.js
import { createTwoFingerDragHandler } from '../utilities/pointer-utils';

class DragRotateHandler {
    constructor(map) {
        this._map = map;
        this._canvas = null;
        this._isRotating = false;
        this._startPoint = null;
        this._originalCursor = '';

        // Two-finger touch state
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

        if (this._canvas) {
            // Mouse: Ctrl+drag
            this._canvas.addEventListener('mousedown', this._onMouseDown);
            window.addEventListener('mouseup', this._onMouseUp);
            window.addEventListener('mousemove', this._onMouseMove);

            // Touch: Two-finger drag para rotação e pitch
            this._setupTwoFingerDrag();
        }
    }

    /**
     * Configura two-finger drag para rotação (bearing) e inclinação (pitch)
     * - Rotação horizontal dos dedos: muda bearing
     * - Arrastar dois dedos verticalmente: muda pitch
     */
    _setupTwoFingerDrag() {
        this._cleanupTwoFingerDrag = createTwoFingerDragHandler(
            this._canvas,
            {
                onStart: (initialState) => {
                    this._initialBearing = this._map.getBearing();
                    this._initialPitch = this._map.getPitch();
                    this._isRotating = true;
                    this._map.dragPan.disable();
                    this._originalCursor = this._canvas.style.cursor;
                    this._canvas.style.cursor = 'grabbing';
                },
                onMove: (angleDelta, midpointDelta) => {
                    // Rotação: ângulo entre os dedos
                    const newBearing = this._initialBearing + angleDelta;
                    this._map.setBearing(newBearing);

                    // Pitch: movimento vertical do ponto médio
                    // Arrastar para cima = aumenta pitch, para baixo = diminui
                    const pitchDelta = -midpointDelta.y * 0.3;
                    const newPitch = Math.max(0, Math.min(85, this._initialPitch + pitchDelta));
                    this._map.setPitch(newPitch);
                },
                onEnd: () => {
                    this._endRotation();
                }
            }
        );
    }

    disable() {
        if (this._canvas) {
            this._canvas.removeEventListener('mousedown', this._onMouseDown);
        }

        window.removeEventListener('mouseup', this._onMouseUp);
        window.removeEventListener('mousemove', this._onMouseMove);

        // Cleanup two-finger drag handler
        if (this._cleanupTwoFingerDrag) {
            this._cleanupTwoFingerDrag();
            this._cleanupTwoFingerDrag = null;
        }

        if (this._isRotating) {
            this._endRotation();
        }
    }

    _onMouseDown(e) {
        if (e.ctrlKey && e.button === 0) {
            this._startRotation(e);
        }
    }

    _onMouseMove(e) {
        if (!this._isRotating) return;

        this._updateRotation(e);
    }

    _onMouseUp(e) {
        if (this._isRotating) {
            this._endRotation();
        }
    }

    _startRotation(e) {
        this._isRotating = true;
        this._startPoint = { x: e.clientX, y: e.clientY };

        this._map.dragPan.disable();

        this._originalCursor = this._canvas.style.cursor;
        this._canvas.style.cursor = 'grabbing';

        e.preventDefault();
    }

    _updateRotation(e) {
        if (!this._startPoint) return;

        const endPoint = { x: e.clientX, y: e.clientY };
        const dx = endPoint.x - this._startPoint.x;
        const dy = endPoint.y - this._startPoint.y;

        const currentBearing = this._map.getBearing();
        const currentPitch = this._map.getPitch();

        const newBearing = currentBearing - dx * 0.5;
        this._map.setBearing(newBearing);

        const newPitch = Math.max(0, Math.min(85, currentPitch - dy * 0.2));
        this._map.setPitch(newPitch);

        this._startPoint = endPoint;
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

export default DragRotateHandler;

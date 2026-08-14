// Path: js/draw_tools/drawing-touch-helpers.js
/**
 * Touch helpers for drawing tools (line, polygon, etc.)
 * Provides finish button and touch-specific interactions
 */

import { isTouchDevice, createLongPressHandler } from '../utilities/pointer-utils';

/**
 * Creates and manages a "Finish" button for touch devices
 * Used to replace right-click for finishing line/polygon drawing
 */
export class DrawingFinishButton {
    constructor(options = {}) {
        this._onFinish = options.onFinish;
        this._onUndo = options.onUndo;
        this._container = null;
        this._finishBtn = null;
        this._undoBtn = null;
        this._isVisible = false;
    }

    /**
     * Show the finish button (call when drawing starts on touch device)
     */
    show() {
        if (!isTouchDevice() || this._isVisible) return;

        this._createContainer();
        this._isVisible = true;
    }

    /**
     * Hide and remove the finish button
     */
    hide() {
        if (!this._isVisible) return;

        if (this._container && this._container.parentNode) {
            this._container.remove();
        }
        this._container = null;
        this._finishBtn = null;
        this._undoBtn = null;
        this._isVisible = false;
    }

    /**
     * Update button state based on points count
     * @param {number} pointsCount - Number of points drawn
     * @param {number} minPoints - Minimum points required to finish (2 for line, 3 for polygon)
     */
    updateState(pointsCount, minPoints = 2) {
        if (!this._finishBtn) return;

        const canFinish = pointsCount >= minPoints;
        this._finishBtn.disabled = !canFinish;
        this._finishBtn.style.opacity = canFinish ? '1' : '0.5';

        if (this._undoBtn) {
            const canUndo = pointsCount > 0;
            this._undoBtn.disabled = !canUndo;
            this._undoBtn.style.opacity = canUndo ? '1' : '0.5';
        }
    }

    /**
     * Create the button container with finish and undo buttons
     * @private
     */
    _createContainer() {
        this._container = document.createElement('div');
        this._container.className = 'drawing-touch-controls';
        this._container.innerHTML = `
            <button class="drawing-undo-btn" disabled>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 10h10a5 5 0 0 1 5 5v2"/>
                    <polyline points="3 10 8 5"/>
                    <polyline points="3 10 8 15"/>
                </svg>
            </button>
            <button class="drawing-finish-btn" disabled>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>Finalizar</span>
            </button>
        `;

        this._finishBtn = this._container.querySelector('.drawing-finish-btn');
        this._undoBtn = this._container.querySelector('.drawing-undo-btn');

        this._finishBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._onFinish && !this._finishBtn.disabled) {
                this._onFinish();
            }
        });

        this._undoBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this._onUndo && !this._undoBtn.disabled) {
                this._onUndo();
            }
        });

        document.body.appendChild(this._container);
    }

    /**
     * Cleanup
     */
    destroy() {
        this.hide();
        this._onFinish = null;
        this._onUndo = null;
    }
}

/**
 * Creates long-press handler for vertex removal in edit mode
 * @param {Object} map - MapLibre map instance
 * @param {Object} options - Configuration options
 * @param {string} options.handleLayerId - Layer ID for edit handles
 * @param {Function} options.onVertexRemove - Callback when vertex should be removed
 * @returns {Function} Cleanup function
 */
export function setupVertexRemoveLongPress(map, options) {
    const { handleLayerId, onVertexRemove } = options;
    const canvas = map.getCanvasContainer();

    return createLongPressHandler(
        canvas,
        (e, position) => {
            // Get canvas-relative coordinates
            const rect = canvas.getBoundingClientRect();
            const point = [position.x - rect.left, position.y - rect.top];

            // Query for vertex handles at touch point
            const handleFeatures = map.queryRenderedFeatures(point, {
                layers: [handleLayerId]
            });

            // Find vertex handle (not midpoint)
            const vertexHandle = handleFeatures.find(f =>
                f.properties.handleType === 'vertex'
            );

            if (vertexHandle && onVertexRemove) {
                onVertexRemove(vertexHandle);
            }
        },
        { duration: 500, moveThreshold: 10 }
    );
}


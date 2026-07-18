// Path: js/briefing/components/presentation-controls.js

/**
 * @fileoverview Presentation controls component.
 * Floating control bar for navigating briefing presentations.
 *
 * Features:
 * - Previous/Next slide navigation
 * - First/Last slide navigation
 * - Slide counter display
 * - Fullscreen toggle
 * - Exit presentation button
 * - Auto-hide after inactivity
 *
 * @module briefing/components/presentation-controls
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
    trackTimer
} from '@utils/event-cleanup.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const CONTROL_ICONS = {
    previous: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,

    next: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,

    first: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>`,

    last: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`,

    fullscreen: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,

    exitFullscreen: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>`,

    exit: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,

    textPanel: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`
};

const CONFIG = {
    /** Auto-hide delay in milliseconds */
    AUTO_HIDE_DELAY: 3000,
    /** Position: 'bottom-center', 'bottom-right', etc */
    POSITION: 'bottom-center'
};

// ============================================================================
// PRESENTATION CONTROLS
// ============================================================================

/**
 * Presentation controls component.
 * Provides navigation and control buttons for briefing presentations.
 */
export class PresentationControls {
    /**
     * @param {Object} callbacks - Event callbacks
     * @param {Function} callbacks.onPrevious - Called when previous is clicked
     * @param {Function} callbacks.onNext - Called when next is clicked
     * @param {Function} callbacks.onFirst - Called when first is clicked
     * @param {Function} callbacks.onLast - Called when last is clicked
     * @param {Function} callbacks.onFullscreen - Called when fullscreen is toggled
     * @param {Function} callbacks.onExit - Called when exit is clicked
     * @param {Function} [callbacks.onToggleTextPanel] - Called when text panel toggle is clicked
     */
    constructor(callbacks = {}) {
        this._callbacks = callbacks;

        // State
        this._isVisible = false;
        this._isAutoHide = true;
        this._isFullscreen = false;
        this._currentIndex = 0;
        this._totalSlides = 0;
        this._autoHideTimer = null;
        this._isTextPanelVisible = true;

        // DOM elements
        this._container = null;
        this._counterEl = null;
        this._fullscreenBtn = null;
        this._textPanelBtn = null;
        this._prevBtn = null;
        this._nextBtn = null;

        // Bound handlers for cleanup
        this._onMouseMove = this._handleMouseMove.bind(this);

        setupCleanup(this);
    }

    /**
     * Creates and mounts the controls to the DOM.
     * @param {HTMLElement} [parent=document.body] - Parent element
     */
    mount(parent = document.body) {
        if (this._container) {
            this.unmount();
        }

        this._createUI();
        parent.appendChild(this._container);
        this._isVisible = true;

        // Setup auto-hide on mouse move
        if (this._isAutoHide) {
            document.addEventListener('mousemove', this._onMouseMove);
            this._startAutoHideTimer();
        }
    }

    /**
     * Unmounts the controls from the DOM.
     */
    unmount() {
        // Remove mouse move listener
        document.removeEventListener('mousemove', this._onMouseMove);

        // Clear auto-hide timer
        if (this._autoHideTimer) {
            clearTimeout(this._autoHideTimer);
            this._autoHideTimer = null;
        }

        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._isVisible = false;
    }

    /**
     * Updates the slide counter.
     * @param {number} index - Current slide index (0-based)
     * @param {number} total - Total number of slides
     */
    updateCounter(index, total) {
        this._currentIndex = index;
        this._totalSlides = total;

        if (this._counterEl) {
            this._counterEl.textContent = `${index + 1} / ${total}`;
        }

        this._updateButtonStates();
    }

    /**
     * Sets the fullscreen state.
     * @param {boolean} isFullscreen - Whether currently fullscreen
     */
    setFullscreen(isFullscreen) {
        this._isFullscreen = isFullscreen;

        if (this._fullscreenBtn) {
            this._fullscreenBtn.innerHTML = isFullscreen
                ? CONTROL_ICONS.exitFullscreen
                : CONTROL_ICONS.fullscreen;
            this._fullscreenBtn.title = isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia';
        }
    }

    /**
     * Sets the text panel visibility state.
     * @param {boolean} isVisible - Whether text panel is visible
     */
    setTextPanelVisible(isVisible) {
        this._isTextPanelVisible = isVisible;

        if (this._textPanelBtn) {
            this._textPanelBtn.classList.toggle('active', isVisible);
        }
    }

    /**
     * Shows the controls.
     */
    show() {
        if (this._container) {
            this._container.classList.remove('hidden');
            this._isVisible = true;
            this._resetAutoHideTimer();
        }
    }

    /**
     * Hides the controls.
     */
    hide() {
        if (this._container) {
            this._container.classList.add('hidden');
            this._isVisible = false;
        }
    }

    /**
     * Enables auto-hide behavior.
     */
    enableAutoHide() {
        this._isAutoHide = true;
        document.addEventListener('mousemove', this._onMouseMove);
        this._startAutoHideTimer();
    }

    /**
     * Disables auto-hide behavior.
     */
    disableAutoHide() {
        this._isAutoHide = false;
        document.removeEventListener('mousemove', this._onMouseMove);
        if (this._autoHideTimer) {
            clearTimeout(this._autoHideTimer);
            this._autoHideTimer = null;
        }
        this.show();
    }

    /**
     * Creates the controls UI.
     * @private
     */
    _createUI() {
        // Main container
        this._container = document.createElement('div');
        this._container.className = 'briefing-controls';
        this._container.dataset.position = CONFIG.POSITION;

        // First button
        const firstBtn = this._createButton('first', CONTROL_ICONS.first, 'Primeiro Slide', () => {
            this._callbacks.onFirst?.();
        });
        this._container.appendChild(firstBtn);

        // Previous button
        this._prevBtn = this._createButton('previous', CONTROL_ICONS.previous, 'Slide Anterior', () => {
            this._callbacks.onPrevious?.();
        });
        this._container.appendChild(this._prevBtn);

        // Counter
        this._counterEl = document.createElement('span');
        this._counterEl.className = 'briefing-controls-counter';
        this._counterEl.textContent = '1 / 1';
        this._container.appendChild(this._counterEl);

        // Next button
        this._nextBtn = this._createButton('next', CONTROL_ICONS.next, 'Próximo Slide', () => {
            this._callbacks.onNext?.();
        });
        this._container.appendChild(this._nextBtn);

        // Last button
        const lastBtn = this._createButton('last', CONTROL_ICONS.last, 'Último Slide', () => {
            this._callbacks.onLast?.();
        });
        this._container.appendChild(lastBtn);

        // Separator
        const sep1 = document.createElement('div');
        sep1.className = 'briefing-controls-separator';
        this._container.appendChild(sep1);

        // Text panel toggle button
        this._textPanelBtn = this._createButton('textPanel', CONTROL_ICONS.textPanel, 'Mostrar/Ocultar Texto', () => {
            this._callbacks.onToggleTextPanel?.();
        });
        this._textPanelBtn.classList.add('active');
        this._container.appendChild(this._textPanelBtn);

        // Fullscreen button
        this._fullscreenBtn = this._createButton('fullscreen', CONTROL_ICONS.fullscreen, 'Tela Cheia', () => {
            this._callbacks.onFullscreen?.();
        });
        this._container.appendChild(this._fullscreenBtn);

        // Separator
        const sep2 = document.createElement('div');
        sep2.className = 'briefing-controls-separator';
        this._container.appendChild(sep2);

        // Exit button
        const exitBtn = this._createButton('exit', CONTROL_ICONS.exit, 'Sair da Apresentação', () => {
            this._callbacks.onExit?.();
        });
        exitBtn.classList.add('briefing-controls-exit');
        this._container.appendChild(exitBtn);

        // Initial button states
        this._updateButtonStates();

        // Prevent click events from hiding controls
        addDomListener(this, this._container, 'mouseenter', () => {
            if (this._autoHideTimer) {
                clearTimeout(this._autoHideTimer);
                this._autoHideTimer = null;
            }
        });

        addDomListener(this, this._container, 'mouseleave', () => {
            if (this._isAutoHide) {
                this._startAutoHideTimer();
            }
        });
    }

    /**
     * Creates a control button.
     * @private
     * @param {string} name - Button name
     * @param {string} icon - Button icon SVG
     * @param {string} title - Button tooltip
     * @param {Function} onClick - Click handler
     * @returns {HTMLButtonElement}
     */
    _createButton(name, icon, title, onClick) {
        const btn = document.createElement('button');
        btn.className = `briefing-controls-btn briefing-controls-${name}`;
        btn.innerHTML = icon;
        btn.title = title;
        addDomListener(this, btn, 'click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    /**
     * Updates the button disabled states.
     * @private
     */
    _updateButtonStates() {
        const isFirst = this._currentIndex === 0;
        const isLast = this._currentIndex >= this._totalSlides - 1;

        if (this._prevBtn) {
            this._prevBtn.disabled = isFirst;
        }
        if (this._nextBtn) {
            this._nextBtn.disabled = isLast;
        }
    }

    /**
     * Handles mouse move for auto-hide.
     * @private
     */
    _handleMouseMove() {
        this.show();
        this._resetAutoHideTimer();
    }

    /**
     * Starts the auto-hide timer.
     * @private
     */
    _startAutoHideTimer() {
        if (!this._isAutoHide) return;

        if (this._autoHideTimer) {
            clearTimeout(this._autoHideTimer);
        }

        this._autoHideTimer = setTimeout(() => {
            this.hide();
            this._autoHideTimer = null;
        }, CONFIG.AUTO_HIDE_DELAY);

        trackTimer(this, this._autoHideTimer);
    }

    /**
     * Resets the auto-hide timer.
     * @private
     */
    _resetAutoHideTimer() {
        if (this._isAutoHide) {
            this._startAutoHideTimer();
        }
    }

    /**
     * Checks if controls are visible.
     * @returns {boolean}
     */
    isVisible() {
        return this._isVisible;
    }

    /**
     * Gets the controls container.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroys the controls.
     */
    destroy() {
        this.unmount();
    }
}

/**
 * Creates a new presentation controls instance.
 * @param {Object} callbacks - Event callbacks
 * @returns {PresentationControls}
 */
export function createPresentationControls(callbacks) {
    return new PresentationControls(callbacks);
}

export default PresentationControls;

// Path: js/briefing/components/presentation-text-panel.js

/**
 * @fileoverview Presentation panel component.
 * Right-side panel that displays slide content and integrated navigation controls
 * during briefing presentations.
 *
 * Layout:
 * ┌──────────────────────────┐
 * │ Title (fixed, top)       │
 * ├──────────────────────────┤
 * │ Content (flex: 1,        │
 * │ overflow-y: auto,        │
 * │ scrollable)              │
 * ├──────────────────────────┤
 * │ Controls (fixed, bottom) │
 * │ [<<][<] 1 de 5 [>][>>]  │
 * │ [Texto][Tela Cheia][Sair]│
 * └──────────────────────────┘
 *
 * @module briefing/components/presentation-text-panel
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';
import { sanitizeQuillHtml } from '../../utilities/quill-helpers.js';

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

    // "Skip forward" icon shown during animation (bar + triangle = skip to end)
    skipForward: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>`,

    // Crosshair icon for restoring saved slide position
    restorePosition: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
};

const DEFAULT_CONFIG = {
    width: 520,
    backgroundColor: 'rgba(255, 255, 255, 0.95)'
};

// ============================================================================
// PRESENTATION TEXT PANEL
// ============================================================================

/**
 * Presentation panel with integrated navigation controls.
 * Displays slide content and provides navigation during briefing presentations.
 */
export class PresentationTextPanel {
    /**
     * @param {Object} [config] - Panel configuration
     * @param {number} [config.width=520] - Panel width in pixels
     * @param {string} [config.backgroundColor] - Panel background color
     * @param {Object} [callbacks] - Navigation callbacks
     * @param {Function} [callbacks.onPrevious] - Previous slide
     * @param {Function} [callbacks.onNext] - Next slide
     * @param {Function} [callbacks.onFirst] - First slide
     * @param {Function} [callbacks.onLast] - Last slide
     * @param {Function} [callbacks.onRestorePosition] - Restore saved slide position
     * @param {Function} [callbacks.onGoToSlide] - Navigate to specific slide (0-based index)
     * @param {Function} [callbacks.onFullscreen] - Toggle fullscreen
     * @param {Function} [callbacks.onToggleText] - Toggle text visibility
     * @param {Function} [callbacks.onExit] - Exit presentation
     */
    constructor(config = {}, callbacks = {}) {
        this._config = { ...DEFAULT_CONFIG, ...config };
        this._callbacks = callbacks;

        // State
        this._isVisible = false;
        this._isFullscreen = false;
        this._isDropdownOpen = false;
        this._currentSlide = null;
        this._currentIndex = 0;
        this._totalSlides = 0;
        this._slides = [];

        // DOM elements
        this._container = null;
        this._titleEl = null;
        this._contentEl = null;
        this._counterEl = null;
        this._prevBtn = null;
        this._nextBtn = null;
        this._firstBtn = null;
        this._lastBtn = null;
        this._restorePositionBtn = null;
        this._fullscreenBtn = null;
        this._slideDropdown = null;

        setupCleanup(this);
    }

    /**
     * Creates and mounts the panel to the DOM.
     * @param {HTMLElement} [parent=document.body] - Parent element
     */
    mount(parent = document.body) {
        if (this._container) {
            this.unmount();
        }

        this._createUI();
        parent.appendChild(this._container);
        this._isVisible = true;
    }

    /**
     * Unmounts the panel from the DOM.
     */
    unmount() {
        this._closeSlideDropdown();
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._isVisible = false;
    }

    /**
     * Sets the current slide content and updates controls.
     * @param {Object} slide - Slide data
     * @param {number} index - Current slide index (0-based)
     * @param {number} total - Total number of slides
     */
    setSlide(slide, index, total) {
        this._currentSlide = slide;
        this._currentIndex = index;
        this._totalSlides = total;

        this._renderContent();
        this._updateButtonStates();
    }

    /**
     * Sets the full slides array for the go-to-slide dropdown.
     * @param {Array<Object>} slides - All slides in the briefing
     */
    setSlides(slides) {
        this._slides = slides || [];
    }

    /**
     * Updates the slide counter and button states.
     * @param {number} index - Current slide index (0-based)
     * @param {number} total - Total number of slides
     */
    updateCounter(index, total) {
        this._currentIndex = index;
        this._totalSlides = total;

        if (this._counterEl && !this._isDropdownOpen) {
            this._counterEl.textContent = `${index + 1} de ${total}`;
        }

        this._updateButtonStates();
    }

    /**
     * Sets the fullscreen state (updates icon).
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
     * Updates the next button appearance to indicate animation state.
     * When transitioning, shows a "skip forward" icon so the user knows
     * pressing it will complete the current animation.
     * @param {boolean} isTransitioning - Whether a slide transition is in progress
     */
    setTransitioning(isTransitioning) {
        this._isTransitioning = isTransitioning;
        if (this._nextBtn) {
            this._nextBtn.innerHTML = isTransitioning
                ? CONTROL_ICONS.skipForward
                : CONTROL_ICONS.next;
            this._nextBtn.title = isTransitioning
                ? 'Pular Animação'
                : 'Próximo Slide';
            // Enable next button during transitions so the user can skip the animation
            if (isTransitioning) {
                this._nextBtn.disabled = false;
            } else {
                this._updateButtonStates();
            }
        }
    }

    /**
     * Shows the panel.
     */
    show() {
        if (this._container) {
            this._container.classList.remove('hidden');
            this._isVisible = true;
        }
    }

    /**
     * Hides the panel.
     */
    hide() {
        if (this._container) {
            this._container.classList.add('hidden');
            this._isVisible = false;
        }
    }

    /**
     * Toggles the panel visibility.
     * @returns {boolean} New visibility state
     */
    toggle() {
        if (this._isVisible) {
            this.hide();
        } else {
            this.show();
        }
        return this._isVisible;
    }

    /**
     * Checks if the panel is visible.
     * @returns {boolean}
     */
    isVisible() {
        return this._isVisible;
    }

    /**
     * Gets the panel container element.
     * @returns {HTMLElement|null}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroys the panel.
     */
    destroy() {
        this.unmount();
    }

    // =========================================================================
    // UI CREATION
    // =========================================================================

    /**
     * Creates the panel UI with three sections: title, content, controls.
     * @private
     */
    _createUI() {
        // Main container
        this._container = document.createElement('div');
        this._container.className = 'briefing-text-panel';

        // Apply styles
        this._container.style.width = `${this._config.width}px`;
        this._container.style.setProperty('--panel-bg-color', this._config.backgroundColor);

        // === Title section (fixed top) ===
        const titleSection = document.createElement('div');
        titleSection.className = 'briefing-text-panel__title';

        this._titleEl = document.createElement('h2');
        this._titleEl.className = 'briefing-text-panel__title-text';
        titleSection.appendChild(this._titleEl);

        this._container.appendChild(titleSection);

        // === Content section (scrollable) ===
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'briefing-text-panel__content';
        this._container.appendChild(this._contentEl);

        // === Controls section (fixed bottom) ===
        const controlsSection = document.createElement('div');
        controlsSection.className = 'briefing-text-panel__controls';

        // Navigation row
        const navRow = document.createElement('div');
        navRow.className = 'briefing-text-panel__nav';

        this._firstBtn = this._createButton(CONTROL_ICONS.first, 'Primeiro Slide', () => {
            this._callbacks.onFirst?.();
        });
        navRow.appendChild(this._firstBtn);

        this._prevBtn = this._createButton(CONTROL_ICONS.previous, 'Slide Anterior', () => {
            this._callbacks.onPrevious?.();
        });
        navRow.appendChild(this._prevBtn);

        this._counterEl = document.createElement('span');
        this._counterEl.className = 'briefing-text-panel__counter';
        this._counterEl.textContent = '1 de 1';
        this._counterEl.title = 'Clique para ir a um slide específico';
        addDomListener(this, this._counterEl, 'click', () => this._openSlideDropdown());
        navRow.appendChild(this._counterEl);

        this._nextBtn = this._createButton(CONTROL_ICONS.next, 'Próximo Slide', () => {
            this._callbacks.onNext?.();
        });
        navRow.appendChild(this._nextBtn);

        this._lastBtn = this._createButton(CONTROL_ICONS.last, 'Último Slide', () => {
            this._callbacks.onLast?.();
        });
        navRow.appendChild(this._lastBtn);

        this._restorePositionBtn = this._createButton(
            CONTROL_ICONS.restorePosition,
            'Voltar à Posição Salva',
            () => { this._callbacks.onRestorePosition?.(); }
        );
        this._restorePositionBtn.classList.add('briefing-text-panel__btn--restore');
        navRow.appendChild(this._restorePositionBtn);

        controlsSection.appendChild(navRow);

        // Actions row
        const actionsRow = document.createElement('div');
        actionsRow.className = 'briefing-text-panel__actions';

        this._fullscreenBtn = this._createButton(CONTROL_ICONS.fullscreen, 'Tela Cheia', () => {
            this._callbacks.onFullscreen?.();
        });
        actionsRow.appendChild(this._fullscreenBtn);

        const exitBtn = this._createButton(CONTROL_ICONS.exit, 'Sair da Apresentação', () => {
            this._callbacks.onExit?.();
        });
        exitBtn.classList.add('briefing-text-panel__btn--exit');
        actionsRow.appendChild(exitBtn);

        controlsSection.appendChild(actionsRow);

        this._container.appendChild(controlsSection);

        // EBGeo logo branding (bottom of panel)
        const logoEl = document.createElement('img');
        logoEl.className = 'briefing-text-panel__logo';
        logoEl.src = '/images/logo_ebgeo.webp';
        logoEl.alt = 'EBGeo';
        this._container.appendChild(logoEl);

        // Render initial content
        this._renderContent();
    }

    /**
     * Creates a control button.
     * @private
     * @param {string} icon - SVG icon HTML
     * @param {string} title - Button tooltip
     * @param {Function} onClick - Click handler
     * @returns {HTMLButtonElement}
     */
    _createButton(icon, title, onClick) {
        const btn = document.createElement('button');
        btn.className = 'briefing-text-panel__btn';
        btn.innerHTML = icon;
        btn.title = title;
        addDomListener(this, btn, 'click', (e) => {
            e.stopPropagation();
            onClick();
        });
        return btn;
    }

    // =========================================================================
    // RENDERING
    // =========================================================================

    /**
     * Renders the slide content (title + rich text).
     * @private
     */
    _renderContent() {
        if (!this._container) return;

        // Title
        if (this._titleEl) {
            this._titleEl.textContent = this._currentSlide?.title || '';
        }

        // Content (sanitized HTML from Quill)
        if (this._contentEl) {
            const content = this._currentSlide?.content || '';
            this._contentEl.innerHTML = content ? sanitizeQuillHtml(content) : '';
        }

        // Counter
        if (this._counterEl && !this._isDropdownOpen) {
            this._counterEl.textContent = this._totalSlides > 0
                ? `${this._currentIndex + 1} de ${this._totalSlides}`
                : '';
        }
    }

    /**
     * Opens a dropdown list of slides above the counter for quick navigation.
     * @private
     */
    _openSlideDropdown() {
        if (this._isDropdownOpen || this._totalSlides <= 1) return;
        this._isDropdownOpen = true;

        this._slideDropdown = document.createElement('div');
        this._slideDropdown.className = 'briefing-text-panel__slide-dropdown';

        this._slides.forEach((slide, index) => {
            const item = document.createElement('button');
            item.className = 'briefing-text-panel__slide-dropdown-item';
            if (index === this._currentIndex) {
                item.classList.add('briefing-text-panel__slide-dropdown-item--active');
            }

            const number = document.createElement('span');
            number.className = 'briefing-text-panel__slide-dropdown-number';
            number.textContent = `${index + 1}`;
            item.appendChild(number);

            const title = document.createElement('span');
            title.className = 'briefing-text-panel__slide-dropdown-title';
            title.textContent = slide.title || `Slide ${index + 1}`;
            item.appendChild(title);

            addDomListener(this, item, 'click', (e) => {
                e.stopPropagation();
                this._closeSlideDropdown();
                if (index !== this._currentIndex) {
                    this._callbacks.onGoToSlide?.(index);
                }
            });

            this._slideDropdown.appendChild(item);
        });

        // Anchor dropdown to the nav row
        const navRow = this._counterEl.closest('.briefing-text-panel__nav');
        if (navRow) {
            navRow.appendChild(this._slideDropdown);
        }

        // Scroll active item into view
        const activeItem = this._slideDropdown.querySelector(
            '.briefing-text-panel__slide-dropdown-item--active'
        );
        if (activeItem) {
            activeItem.scrollIntoView({ block: 'center' });
        }

        // Close on outside click (next tick to avoid the opening click)
        requestAnimationFrame(() => {
            this._dropdownOutsideHandler = (e) => {
                if (this._slideDropdown && !this._slideDropdown.contains(e.target)) {
                    this._closeSlideDropdown();
                }
            };
            document.addEventListener('click', this._dropdownOutsideHandler, true);
        });
    }

    /**
     * Closes the slide dropdown list.
     * @private
     */
    _closeSlideDropdown() {
        if (!this._isDropdownOpen) return;
        this._isDropdownOpen = false;

        if (this._dropdownOutsideHandler) {
            document.removeEventListener('click', this._dropdownOutsideHandler, true);
            this._dropdownOutsideHandler = null;
        }

        if (this._slideDropdown) {
            removeElement(this._slideDropdown);
            this._slideDropdown = null;
        }
    }

    /**
     * Updates navigation button disabled states.
     * @private
     */
    _updateButtonStates() {
        const isFirst = this._currentIndex === 0;
        const isLast = this._currentIndex >= this._totalSlides - 1;

        if (this._firstBtn) this._firstBtn.disabled = isFirst;
        if (this._prevBtn) this._prevBtn.disabled = isFirst;
        if (this._nextBtn) this._nextBtn.disabled = isLast;
        if (this._lastBtn) this._lastBtn.disabled = isLast;
    }
}

/**
 * Creates a new presentation text panel.
 * @param {Object} [config] - Panel configuration
 * @param {Object} [callbacks] - Navigation callbacks
 * @returns {PresentationTextPanel}
 */
export function createPresentationTextPanel(config, callbacks) {
    return new PresentationTextPanel(config, callbacks);
}

export default PresentationTextPanel;

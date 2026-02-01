// Path: js/briefing/components/presentation-text-panel.js

/**
 * @fileoverview Presentation text panel component.
 * Floating panel that displays slide content during briefing presentations.
 *
 * Features:
 * - Configurable position (left/right)
 * - Configurable width
 * - Configurable background color
 * - Collapse/expand functionality
 * - Slide title and rich text content display
 * - Progress indicator
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

const PANEL_ICONS = {
    collapse: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    expand: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`
};

const DEFAULT_CONFIG = {
    position: 'left',
    width: 350,
    backgroundColor: 'rgba(255, 255, 255, 0.95)'
};

// ============================================================================
// PRESENTATION TEXT PANEL
// ============================================================================

/**
 * Presentation text panel component.
 * Displays slide content during briefing presentations.
 */
export class PresentationTextPanel {
    /**
     * @param {Object} [config] - Panel configuration
     * @param {string} [config.position='left'] - Panel position ('left' or 'right')
     * @param {number} [config.width=350] - Panel width in pixels
     * @param {string} [config.backgroundColor='rgba(255, 255, 255, 0.95)'] - Panel background color
     */
    constructor(config = {}) {
        this._config = { ...DEFAULT_CONFIG, ...config };

        // State
        this._isVisible = false;
        this._isCollapsed = false;
        this._currentSlide = null;
        this._currentIndex = 0;
        this._totalSlides = 0;

        // DOM elements
        this._container = null;
        this._headerEl = null;
        this._titleEl = null;
        this._contentEl = null;
        this._progressEl = null;
        this._toggleBtn = null;

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
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._isVisible = false;
    }

    /**
     * Updates the panel configuration.
     * @param {Object} config - New configuration
     */
    updateConfig(config) {
        this._config = { ...this._config, ...config };

        if (this._container) {
            this._applyStyles();
        }
    }

    /**
     * Sets the current slide content.
     * @param {Object} slide - Slide data
     * @param {number} index - Current slide index (0-based)
     * @param {number} total - Total number of slides
     */
    setSlide(slide, index, total) {
        this._currentSlide = slide;
        this._currentIndex = index;
        this._totalSlides = total;

        this._renderContent();
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
     * Collapses the panel content.
     */
    collapse() {
        if (this._container && !this._isCollapsed) {
            this._container.classList.add('collapsed');
            this._isCollapsed = true;
            this._updateToggleButton();
        }
    }

    /**
     * Expands the panel content.
     */
    expand() {
        if (this._container && this._isCollapsed) {
            this._container.classList.remove('collapsed');
            this._isCollapsed = false;
            this._updateToggleButton();
        }
    }

    /**
     * Toggles the collapsed state.
     * @returns {boolean} New collapsed state
     */
    toggleCollapse() {
        if (this._isCollapsed) {
            this.expand();
        } else {
            this.collapse();
        }
        return this._isCollapsed;
    }

    /**
     * Checks if the panel is visible.
     * @returns {boolean}
     */
    isVisible() {
        return this._isVisible;
    }

    /**
     * Checks if the panel is collapsed.
     * @returns {boolean}
     */
    isCollapsed() {
        return this._isCollapsed;
    }

    /**
     * Creates the panel UI.
     * @private
     */
    _createUI() {
        // Main container
        this._container = document.createElement('div');
        this._container.className = 'briefing-text-panel';
        this._container.dataset.position = this._config.position;

        // Header with toggle button
        this._headerEl = document.createElement('div');
        this._headerEl.className = 'briefing-text-panel-header';

        this._toggleBtn = document.createElement('button');
        this._toggleBtn.className = 'briefing-text-panel-toggle';
        this._toggleBtn.title = 'Recolher/Expandir';
        addDomListener(this, this._toggleBtn, 'click', () => this.toggleCollapse());
        this._headerEl.appendChild(this._toggleBtn);
        this._updateToggleButton();

        this._container.appendChild(this._headerEl);

        // Title
        this._titleEl = document.createElement('h2');
        this._titleEl.className = 'briefing-text-panel-title';
        this._container.appendChild(this._titleEl);

        // Content area
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'briefing-text-panel-content';
        this._container.appendChild(this._contentEl);

        // Progress indicator
        this._progressEl = document.createElement('div');
        this._progressEl.className = 'briefing-text-panel-progress';
        this._container.appendChild(this._progressEl);

        // Apply styles
        this._applyStyles();

        // Render initial content
        this._renderContent();
    }

    /**
     * Applies configuration styles to the panel.
     * @private
     */
    _applyStyles() {
        if (!this._container) return;

        // Position
        this._container.dataset.position = this._config.position;

        // Width
        this._container.style.width = `${this._config.width}px`;

        // Background color
        this._container.style.setProperty('--panel-bg-color', this._config.backgroundColor);
    }

    /**
     * Updates the toggle button icon.
     * @private
     */
    _updateToggleButton() {
        if (!this._toggleBtn) return;

        const isLeft = this._config.position === 'left';

        if (this._isCollapsed) {
            // When collapsed, show expand icon (pointing inward)
            this._toggleBtn.innerHTML = isLeft ? PANEL_ICONS.expand : PANEL_ICONS.collapse;
        } else {
            // When expanded, show collapse icon (pointing outward)
            this._toggleBtn.innerHTML = isLeft ? PANEL_ICONS.collapse : PANEL_ICONS.expand;
        }
    }

    /**
     * Renders the slide content.
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

        // Progress
        if (this._progressEl) {
            this._progressEl.textContent = this._totalSlides > 0
                ? `Slide ${this._currentIndex + 1} de ${this._totalSlides}`
                : '';
        }
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
}

/**
 * Creates a new presentation text panel.
 * @param {Object} [config] - Panel configuration
 * @returns {PresentationTextPanel}
 */
export function createPresentationTextPanel(config) {
    return new PresentationTextPanel(config);
}

export default PresentationTextPanel;

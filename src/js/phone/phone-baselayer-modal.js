// Path: js/phone/phone-baselayer-modal.js

/**
 * @fileoverview Standalone modal overlay for base layer selection on phone layout.
 * Displays a centered card with a 3-column thumbnail grid of available base layers.
 * Tapping a thumbnail fires the registered callback and closes the modal.
 * Tapping the dark backdrop also closes the modal.
 */

import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';
import { LAYER_THUMBNAILS } from '@js/base-layer-selector/base-layer-selector.constants.js';

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Modal overlay for base layer selection on phone.
 * Replaces the previous pattern of injecting the grid into the bottom sheet.
 */
export class PhoneBaseLayerModal {
    constructor() {
        setupCleanup(this);

        /** @private @type {HTMLElement|null} */
        this._el = null;

        /** @private @type {HTMLElement|null} */
        this._card = null;

        /** @private @type {HTMLElement|null} */
        this._grid = null;

        /** @private @type {boolean} */
        this._isOpen = false;

        /** @private @type {string|null} */
        this._activeLayerId = null;

        /** @private @type {Array<[string, Object]>} */
        this._basemaps = [];

        /** @private @type {Function|null} */
        this._selectCb = null;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Build the modal DOM and append to the given parent element.
     * @param {HTMLElement} parent - Container to mount into
     */
    mount(parent) {
        this._buildDOM();
        parent.appendChild(this._el);
        this._bindEvents();
    }

    /**
     * Clean up all listeners and remove the modal from the DOM.
     */
    destroy() {
        cleanup(this);
        removeElement(this._el);
        this._el = null;
        this._card = null;
        this._grid = null;
        this._selectCb = null;
        this._basemaps = [];
        this._activeLayerId = null;
    }

    /**
     * Set the available basemaps and rebuild the thumbnail grid.
     * @param {Array<[string, Object]>} basemaps - Enabled basemap tuples from config.getEnabledBasemaps()
     */
    setBasemaps(basemaps) {
        this._basemaps = basemaps;
        this._renderGrid();
    }

    /**
     * Highlight the currently active base layer.
     * @param {string} layerId - Layer identifier to mark as active
     */
    setActiveLayer(layerId) {
        this._activeLayerId = layerId;
        this._updateActiveState();
    }

    /**
     * Show the modal overlay.
     */
    open() {
        if (!this._el) return;
        this._isOpen = true;
        this._el.classList.add('phone-baselayer-modal--open');
    }

    /**
     * Hide the modal overlay.
     */
    close() {
        if (!this._el) return;
        this._isOpen = false;
        this._el.classList.remove('phone-baselayer-modal--open');
    }

    /**
     * Register callback for base layer selection.
     * @param {Function} cb - (layerId: string, index: number) => void
     */
    onSelect(cb) {
        this._selectCb = cb;
    }

    // ========================================================================
    // DOM CONSTRUCTION
    // ========================================================================

    /** @private */
    _buildDOM() {
        // Root overlay
        this._el = document.createElement('div');
        this._el.className = 'phone-baselayer-modal';

        // Centered card
        this._card = document.createElement('div');
        this._card.className = 'phone-baselayer-modal__card';

        // Title
        const title = document.createElement('div');
        title.className = 'phone-baselayer-modal__title';
        title.textContent = 'Camada Base';

        // Grid container
        this._grid = document.createElement('div');
        this._grid.className = 'phone-baselayer-modal__grid';

        this._card.appendChild(title);
        this._card.appendChild(this._grid);
        this._el.appendChild(this._card);
    }

    /**
     * Render the thumbnail grid from the current basemaps data.
     * @private
     */
    _renderGrid() {
        if (!this._grid) return;
        this._grid.textContent = '';

        this._basemaps.forEach(([id, cfg], index) => {
            const btn = document.createElement('button');
            btn.className = 'phone-baselayer-modal__item';
            btn.dataset.layerId = id;

            if (id === this._activeLayerId) {
                btn.classList.add('phone-baselayer-modal__item--active');
            }

            // Thumbnail
            const thumb = document.createElement('div');
            thumb.className = 'phone-baselayer-modal__thumb';

            const thumbnailConfig = LAYER_THUMBNAILS[id];
            const imageUrl = cfg.image || thumbnailConfig?.thumbnail;

            if (imageUrl) {
                // Dynamic value — exception to no-inline-styles rule
                thumb.style.backgroundImage = `url(${imageUrl})`;
            } else {
                // Fallback gradient (dynamic computed value)
                thumb.style.background = thumbnailConfig?.fallbackGradient
                    || 'linear-gradient(135deg, #ccc 0%, #999 100%)';
            }

            // Label
            const label = document.createElement('span');
            label.className = 'phone-baselayer-modal__label';
            label.textContent = thumbnailConfig?.label || cfg.name || id;

            btn.appendChild(thumb);
            btn.appendChild(label);
            this._grid.appendChild(btn);

            // Handle item tap
            addDomListener(this, btn, 'click', () => {
                if (this._selectCb) {
                    this._selectCb(id, index);
                }
                this.close();
            });
        });
    }

    // ========================================================================
    // STATE UPDATES
    // ========================================================================

    /**
     * Update the active visual state on all grid items.
     * @private
     */
    _updateActiveState() {
        if (!this._grid) return;
        const items = this._grid.querySelectorAll('.phone-baselayer-modal__item');
        items.forEach(item => {
            if (item.dataset.layerId === this._activeLayerId) {
                item.classList.add('phone-baselayer-modal__item--active');
            } else {
                item.classList.remove('phone-baselayer-modal__item--active');
            }
        });
    }

    // ========================================================================
    // EVENT BINDING
    // ========================================================================

    /** @private */
    _bindEvents() {
        // Close on backdrop tap (click on root overlay, not on the card)
        addDomListener(this, this._el, 'click', (e) => {
            if (e.target === this._el) {
                this.close();
            }
        });
    }
}

// Path: js/phone/phone-fabs.js

/**
 * @fileoverview Floating action buttons for the phone layout.
 * Stacked vertically on the right edge (top to bottom):
 * - Compass: resets bearing, auto-hides when north-up
 * - Zoom group: +/- buttons in a shared container
 * - Base Layer: opens base layer picker via callback
 *
 * Repositions when bottom sheet state changes to avoid overlap.
 */

import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';

// -------------------------------------------------------------------------
// SVG icon helpers (static markup, safe for innerHTML)
// -------------------------------------------------------------------------

/** @returns {string} */
function layersIconSvg() {
    return `<svg class="phone-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        <polyline points="2 17 12 22 22 17"/>
        <polyline points="2 12 12 17 22 12"/>
    </svg>`;
}

/** @returns {string} */
function zoomInIconSvg() {
    return `<svg class="phone-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`;
}

/** @returns {string} */
function zoomOutIconSvg() {
    return `<svg class="phone-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`;
}

/** @returns {string} */
function compassIconSvg() {
    return `<svg class="phone-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12,2 15,14 12,22 9,14"/><line x1="12" y1="2" x2="12" y2="6" stroke="red" stroke-width="2.5"/>
    </svg>`;
}

/** Bearing threshold below which the compass hides (degrees). */
const COMPASS_HIDE_THRESHOLD = 1;

/**
 * Phone floating action buttons component.
 */
export class PhoneFabs {
    /**
     * @param {Object} options
     * @param {Object} options.map - MapLibre map instance
     */
    constructor({ map }) {
        /** @private */
        this._map = map;
        /** @private */
        this._container = null;
        /** @private */
        this._compassBtn = null;
        /** @private */
        this._baseLayerBtn = null;
        /** @private */
        this._baseLayerTapCallback = null;
        /** @private */
        this._baseLayerNames = [];
        /** @private */
        this._currentBaseLayerIndex = 0;
        /** @private */
        this._rotateHandler = null;

        setupCleanup(this);
    }

    /**
     * Append the FAB container to a parent element.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        this._container = document.createElement('div');
        this._container.className = 'phone-fab-container';

        // 1. Compass FAB (hidden by default when bearing ≈ 0)
        this._compassBtn = this._createFab('compass', 'Redefinir norte', compassIconSvg());
        this._compassBtn.classList.add('phone-fab--compass', 'phone-fab--compass-hidden');
        this._container.appendChild(this._compassBtn);

        addDomListener(this, this._compassBtn, 'click', () => {
            this._map.easeTo({ bearing: 0 });
        });

        // 2. Zoom group (+/-)
        const zoomGroup = document.createElement('div');
        zoomGroup.className = 'phone-fab-group';

        const zoomInBtn = this._createFab('zoom-in', 'Aproximar', zoomInIconSvg());
        const zoomOutBtn = this._createFab('zoom-out', 'Afastar', zoomOutIconSvg());
        zoomGroup.appendChild(zoomInBtn);
        zoomGroup.appendChild(zoomOutBtn);
        this._container.appendChild(zoomGroup);

        addDomListener(this, zoomInBtn, 'click', () => this._map.zoomIn());
        addDomListener(this, zoomOutBtn, 'click', () => this._map.zoomOut());

        // 3. Base Layer FAB
        this._baseLayerBtn = this._createFab('baselayer', 'Camada base', layersIconSvg());
        this._container.appendChild(this._baseLayerBtn);

        addDomListener(this, this._baseLayerBtn, 'click', () => {
            if (typeof this._baseLayerTapCallback === 'function') {
                this._baseLayerTapCallback();
            }
        });

        // Listen to map rotation to show/hide + rotate compass
        this._rotateHandler = () => this._updateCompass();
        this._map.on('rotate', this._rotateHandler);

        // Sync initial compass state
        this._updateCompass();

        parent.appendChild(this._container);
    }

    /**
     * Remove container and clean up all listeners.
     */
    destroy() {
        if (this._rotateHandler && this._map) {
            this._map.off('rotate', this._rotateHandler);
            this._rotateHandler = null;
        }
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._compassBtn = null;
        this._baseLayerBtn = null;
        this._baseLayerTapCallback = null;
    }

    /**
     * Reposition FABs based on bottom sheet state.
     * @param {'peek' | 'half' | 'full'} state
     */
    onSheetStateChange(state) {
        if (!this._container) return;

        if (state === 'half' || state === 'full') {
            this._container.classList.add('phone-fab-container--shifted');
        } else {
            this._container.classList.remove('phone-fab-container--shifted');
        }
    }

    /**
     * Register a callback invoked when the user taps the base layer FAB.
     * @param {Function} callback - () => void
     */
    onBaseLayerTap(callback) {
        this._baseLayerTapCallback = callback;
    }

    /**
     * Hide the FAB container (e.g., during move mode).
     */
    hide() {
        if (this._container) {
            this._container.classList.add('phone-fab-container--hidden');
        }
    }

    /**
     * Show the FAB container.
     */
    show() {
        if (this._container) {
            this._container.classList.remove('phone-fab-container--hidden');
        }
    }

    /**
     * Set the list of base layer display names for reference.
     * @param {string[]} names
     */
    setBaseLayerNames(names) {
        this._baseLayerNames = names;
        this._currentBaseLayerIndex = 0;
    }

    /**
     * Update the active base layer index (called by orchestrator after selection).
     * @param {number} index
     */
    setActiveBaseLayerIndex(index) {
        this._currentBaseLayerIndex = index;
    }

    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------

    /**
     * Create a single FAB button element.
     * @private
     * @param {string} action - data-action value
     * @param {string} ariaLabel - Accessible label
     * @param {string} iconHtml - SVG icon markup (static, safe)
     * @returns {HTMLButtonElement}
     */
    _createFab(action, ariaLabel, iconHtml) {
        const btn = document.createElement('button');
        btn.className = 'phone-fab';
        btn.dataset.action = action;
        btn.setAttribute('aria-label', ariaLabel);
        // Static SVG icons — no user data, safe for innerHTML
        btn.innerHTML = iconHtml;
        return btn;
    }

    /**
     * Update compass visibility and rotation based on current map bearing.
     * @private
     */
    _updateCompass() {
        if (!this._compassBtn) return;

        const bearing = this._map.getBearing();
        const nearNorth = Math.abs(bearing) < COMPASS_HIDE_THRESHOLD;

        if (nearNorth) {
            this._compassBtn.classList.add('phone-fab--compass-hidden');
        } else {
            this._compassBtn.classList.remove('phone-fab--compass-hidden');
        }

        // Rotate the icon to point north regardless of map bearing
        const icon = this._compassBtn.querySelector('.phone-fab__icon');
        if (icon) {
            icon.style.transform = `rotate(${-bearing}deg)`;
        }
    }
}

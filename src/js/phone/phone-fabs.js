// Path: js/phone/phone-fabs.js

/**
 * @fileoverview Floating action buttons for the phone layout.
 * Two FABs stacked vertically on the right edge:
 * - My Location: geolocates user and flies map to their position
 * - Base Layer: cycles through base layers with toast feedback
 *
 * Repositions when bottom sheet state changes to avoid overlap.
 */

import { showToast } from '@utils';
import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';

/**
 * SVG markup for the layers icon.
 * @returns {string}
 */
function layersIconSvg() {
    return `<svg class="phone-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"/>
        <polyline points="2 17 12 22 22 17"/>
        <polyline points="2 12 12 17 22 12"/>
    </svg>`;
}

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
        this._baseLayerBtn = null;
        /** @private */
        this._baseLayerCallback = null;
        /** @private */
        this._baseLayerNames = [];
        /** @private */
        this._currentBaseLayerIndex = 0;

        setupCleanup(this);
    }

    /**
     * Append the FAB container to a parent element.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        this._container = document.createElement('div');
        this._container.className = 'phone-fab-container';

        // Base Layer FAB (only FAB on phone)
        this._baseLayerBtn = this._createFab('baselayer', 'Camada base', layersIconSvg());
        this._container.appendChild(this._baseLayerBtn);

        // Event listeners
        addDomListener(this, this._baseLayerBtn, 'click', this._handleBaseLayerCycle.bind(this));

        parent.appendChild(this._container);
    }

    /**
     * Remove container and clean up all listeners.
     */
    destroy() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._baseLayerBtn = null;
        this._baseLayerCallback = null;
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
     * Register a callback invoked when the user cycles the base layer.
     * The callback receives the new base layer name and its index.
     * @param {Function} callback - (name: string, index: number) => void
     */
    onBaseLayerCycle(callback) {
        this._baseLayerCallback = callback;
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
     * Set the list of base layer display names for cycling.
     * @param {string[]} names
     */
    setBaseLayerNames(names) {
        this._baseLayerNames = names;
        this._currentBaseLayerIndex = 0;
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
     * Handle Base Layer cycle tap.
     * @private
     */
    _handleBaseLayerCycle() {
        if (this._baseLayerNames.length === 0) return;

        this._currentBaseLayerIndex =
            (this._currentBaseLayerIndex + 1) % this._baseLayerNames.length;

        const layerName = this._baseLayerNames[this._currentBaseLayerIndex];
        showToast('Camada: ' + layerName, 'info');

        if (typeof this._baseLayerCallback === 'function') {
            this._baseLayerCallback(layerName, this._currentBaseLayerIndex);
        }
    }
}

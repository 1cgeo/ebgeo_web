// Path: js/bottom-controls/components/feature-toggle.js

/**
 * @fileoverview Feature toggle button component.
 * Toggle button with label for feature activation.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/**
 * Feature toggle component.
 */
export class FeatureToggle {
    /**
     * @param {Object} config - Toggle configuration
     * @param {Function} onToggle - Toggle callback
     */
    constructor(config, onToggle) {
        this._config = config;
        this._onToggle = onToggle;
        this._button = null;
        this._isActive = false;
        this._isDisabled = false;

        setupCleanup(this);
    }

    /**
     * Renders the toggle button.
     * @returns {HTMLButtonElement}
     */
    render() {
        this._button = document.createElement('button');
        this._button.className = 'feature-toggle-btn';
        this._button.id = `feature-toggle-${this._config.id}`;
        this._button.dataset.active = 'false';
        this._button.title = this._config.label;
        this._button.setAttribute('aria-label', this._config.label);
        this._button.setAttribute('aria-pressed', 'false');

        this._button.innerHTML = `
            <span class="feature-toggle-icon">${this._config.icon}</span>
            <span class="feature-toggle-label">${this._config.label}</span>
        `;

        addDomListener(this, this._button, 'click', () => {
            if (!this._isDisabled && this._onToggle) {
                this._onToggle(this._config, !this._isActive);
            }
        });

        return this._button;
    }

    /**
     * Sets the active state.
     * @param {boolean} active
     */
    setActive(active) {
        this._isActive = active;
        if (this._button) {
            this._button.dataset.active = active.toString();
            this._button.setAttribute('aria-pressed', active.toString());
        }
    }

    /**
     * Gets the active state.
     * @returns {boolean}
     */
    isActive() {
        return this._isActive;
    }

    /**
     * Sets the disabled state.
     * @param {boolean} disabled
     */
    setDisabled(disabled) {
        this._isDisabled = disabled;
        if (this._button) {
            this._button.disabled = disabled;
            this._button.classList.toggle('disabled', disabled);
        }
    }

    /**
     * Gets the button element.
     * @returns {HTMLButtonElement|null}
     */
    getElement() {
        return this._button;
    }

    /**
     * Gets the toggle ID.
     * @returns {string}
     */
    getId() {
        return this._config.id;
    }

    /**
     * Destroys the component.
     */
    destroy() {
        cleanup(this);
        removeElement(this._button);
        this._button = null;
    }
}

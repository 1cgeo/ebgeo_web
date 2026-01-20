// Path: js/bottom-controls/components/nav-button.js

/**
 * @fileoverview Navigation button component.
 * Simple icon button for map navigation actions.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';

/**
 * Navigation button component.
 */
export class NavButton {
    /**
     * @param {Object} config - Button configuration
     * @param {Function} onClick - Click callback
     */
    constructor(config, onClick) {
        this._config = config;
        this._onClick = onClick;
        this._button = null;
        this._isActive = false;

        setupCleanup(this);
    }

    /**
     * Renders the navigation button.
     * @returns {HTMLButtonElement}
     */
    render() {
        this._button = document.createElement('button');
        this._button.className = 'nav-btn';
        this._button.id = `nav-btn-${this._config.id}`;
        this._button.dataset.active = 'false';
        this._button.title = this._config.label;
        this._button.setAttribute('aria-label', this._config.label);

        this._button.innerHTML = this._config.icon;

        addDomListener(this, this._button, 'click', () => {
            if (this._onClick) {
                this._onClick(this._config);
            }
        });

        return this._button;
    }

    /**
     * Sets the active state (for toggleable buttons like fullscreen).
     * @param {boolean} active
     */
    setActive(active) {
        this._isActive = active;
        if (this._button) {
            this._button.dataset.active = active.toString();

            // Swap icon if active variant exists
            if (this._config.iconActive) {
                this._button.innerHTML = active
                    ? this._config.iconActive
                    : this._config.icon;
            }
        }
    }

    /**
     * Sets rotation transform (for compass).
     * @param {number} degrees - Rotation in degrees
     */
    setRotation(degrees) {
        if (this._button) {
            this._button.style.transform = `rotate(${degrees}deg)`;
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
     * Destroys the component.
     */
    destroy() {
        cleanup(this);
        removeElement(this._button);
        this._button = null;
    }
}

// Path: js/toolbar/components/tool-button.js

/**
 * @fileoverview Individual tool button component.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '../../utilities/event-cleanup.js';

/**
 * Tool button component.
 */
export class ToolButton {
    /**
     * @param {Object} config - Tool configuration
     * @param {string} config.id - Tool identifier
     * @param {string} config.label - Display label
     * @param {string} config.icon - SVG icon HTML
     * @param {string} config.shortcut - Keyboard shortcut
     * @param {string} config.controlKey - Key to access control in controls map
     * @param {boolean} [config.requiresTerrain] - Whether tool requires terrain
     * @param {Function} onClick - Click handler
     * @param {string} layout - 'grid' or 'list'
     */
    constructor(config, onClick, layout = 'list') {
        this._config = config;
        this._onClick = onClick;
        this._layout = layout;
        this._button = null;
        this._isActive = false;
        this._isDisabled = false;

        setupCleanup(this);
    }

    /**
     * Renders the tool button.
     * @returns {HTMLButtonElement}
     */
    render() {
        this._button = document.createElement('button');
        this._button.className = 'toolbar-tool-btn';
        this._button.dataset.toolId = this._config.id;
        this._button.dataset.active = 'false';
        this._button.setAttribute('aria-label', this._config.label);
        this._button.title = `${this._config.label} (${this._config.shortcut})`;

        if (this._layout === 'grid') {
            // Grid: icon only (uses native title tooltip)
            this._button.innerHTML = this._config.icon;
        } else {
            // List: icon + label + shortcut
            this._button.innerHTML = `
                ${this._config.icon}
                <span class="tool-label">${this._config.label}</span>
                <span class="tool-shortcut">${this._config.shortcut}</span>
            `;
        }

        addDomListener(this, this._button, 'click', (e) => {
            e.stopPropagation();
            if (!this._isDisabled && this._onClick) {
                this._onClick(this._config);
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
        }
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
     * Gets the tool ID.
     * @returns {string}
     */
    getId() {
        return this._config.id;
    }

    /**
     * Gets the control key.
     * @returns {string}
     */
    getControlKey() {
        return this._config.controlKey;
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

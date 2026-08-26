// Path: js/toolbar/components/tool-button.js

/**
 * @fileoverview Individual tool button component.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

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
            // Grid: icon + shortcut badge
            this._button.innerHTML = `
                ${this._config.icon}
                <span class="tool-shortcut-badge">${this._config.shortcut}</span>
            `;
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
     * Sets the LOADING state: the tool is coming over the network.
     *
     * Marca `data-loading="true"` no botão e o desabilita de verdade. Os dois lados servem:
     * o atributo é o que o teste de ponta a ponta espera sumir antes de clicar no mapa (com
     * carga tardia, o clique no botão volta antes de a ferramenta existir), e o `disabled`
     * é o que impede o segundo clique de entrar duas vezes em `setActiveTool`.
     *
     * @param {boolean} loading
     */
    setLoading(loading) {
        if (!this._button) return;
        if (loading) {
            this._button.dataset.loading = 'true';
        } else {
            delete this._button.dataset.loading;
        }
        // Não mexe em `_isDisabled`: quem manda no desabilitado permanente é `setDisabled`
        // (terreno ausente), e sobrescrevê-lo aqui reabriria um botão que devia continuar preso.
        this._button.disabled = loading || this._isDisabled;
    }

    /**
     * Sets the disabled state.
     * @param {boolean} disabled
     * @param {string|null} [reason] - Tooltip reason shown when disabled
     */
    setDisabled(disabled, reason = null) {
        this._isDisabled = disabled;
        if (this._button) {
            this._button.disabled = disabled;
            this._button.classList.toggle('disabled', disabled);
            this._button.title = disabled && reason
                ? reason
                : `${this._config.label} (${this._config.shortcut})`;
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

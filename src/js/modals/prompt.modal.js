// Path: js/modals/prompt.modal.js

/**
 * @fileoverview Simple prompt modal to replace browser's native prompt().
 * Provides a customizable input modal with confirm/cancel actions.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/**
 * Simple prompt modal class.
 * Replaces the browser's native prompt() with a styled modal.
 */
export class PromptModal {
    /**
     * @param {Object} config - Modal configuration
     * @param {string} config.title - Modal title
     * @param {string} [config.placeholder] - Input placeholder
     * @param {string} [config.defaultValue] - Default input value
     * @param {string} [config.confirmText] - Confirm button text
     * @param {string} [config.cancelText] - Cancel button text
     */
    constructor(config = {}) {
        this._config = {
            title: config.title || 'Digite um valor',
            placeholder: config.placeholder || '',
            defaultValue: config.defaultValue || '',
            confirmText: config.confirmText || 'Confirmar',
            cancelText: config.cancelText || 'Cancelar'
        };
        this._overlay = null;
        this._container = null;
        this._input = null;
        this._resolvePromise = null;
        this._previousActiveElement = null;

        setupCleanup(this);
    }

    /**
     * Shows the prompt modal and returns a promise with the result.
     * @returns {Promise<string|null>} The input value or null if cancelled
     */
    show() {
        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            this._previousActiveElement = document.activeElement;
            this._render();
            document.body.appendChild(this._overlay);

            // Animate in
            requestAnimationFrame(() => {
                this._overlay.dataset.visible = 'true';
                this._input.focus();
                this._input.select();
            });
        });
    }

    /**
     * Creates the modal DOM structure.
     * @private
     */
    _render() {
        // Overlay
        this._overlay = document.createElement('div');
        this._overlay.className = 'modal-overlay prompt-modal-overlay';
        this._overlay.setAttribute('role', 'dialog');
        this._overlay.setAttribute('aria-modal', 'true');
        this._overlay.dataset.visible = 'false';

        // Container
        this._container = document.createElement('div');
        this._container.className = 'modal-container prompt-modal-container';

        // Body
        const body = document.createElement('div');
        body.className = 'prompt-modal-body';

        // Title
        const title = document.createElement('label');
        title.className = 'prompt-modal-title';
        title.textContent = this._config.title;
        body.appendChild(title);

        // Input
        this._input = document.createElement('input');
        this._input.type = 'text';
        this._input.className = 'prompt-modal-input';
        this._input.placeholder = this._config.placeholder;
        this._input.value = this._config.defaultValue;
        body.appendChild(this._input);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'prompt-modal-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'prompt-modal-btn prompt-modal-btn-cancel';
        cancelBtn.textContent = this._config.cancelText;
        addDomListener(this, cancelBtn, 'click', () => this._cancel());
        actions.appendChild(cancelBtn);

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'prompt-modal-btn prompt-modal-btn-confirm';
        confirmBtn.textContent = this._config.confirmText;
        addDomListener(this, confirmBtn, 'click', () => this._confirm());
        actions.appendChild(confirmBtn);

        body.appendChild(actions);
        this._container.appendChild(body);

        this._overlay.appendChild(this._container);

        // Event listeners
        this._setupListeners();
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        // Close on overlay click
        addDomListener(this, this._overlay, 'click', (e) => {
            if (e.target === this._overlay) {
                this._cancel();
            }
        });

        // Handle keyboard
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape') {
                this._cancel();
            } else if (e.key === 'Enter') {
                this._confirm();
            }
        });
    }

    /**
     * Confirms the input.
     * @private
     */
    _confirm() {
        const value = this._input.value;
        this._close(value);
    }

    /**
     * Cancels the input.
     * @private
     */
    _cancel() {
        this._close(null);
    }

    /**
     * Closes the modal.
     * @private
     * @param {string|null} value - The result value
     */
    _close(value) {
        this._overlay.dataset.visible = 'false';

        // Wait for animation
        setTimeout(() => {
            this._destroy();
            if (this._previousActiveElement) {
                this._previousActiveElement.focus();
            }
            if (this._resolvePromise) {
                this._resolvePromise(value);
            }
        }, 200);
    }

    /**
     * Destroys the modal.
     * @private
     */
    _destroy() {
        cleanup(this);
        removeElement(this._overlay);
        this._overlay = null;
        this._container = null;
        this._input = null;
    }
}

/**
 * Shows a prompt modal and returns the user input.
 * Convenience function to replace browser's prompt().
 *
 * @param {string} title - The prompt title/question
 * @param {string} [defaultValue=''] - Default input value
 * @returns {Promise<string|null>} The input value or null if cancelled
 *
 * @example
 * const name = await showPrompt('Nome do novo mapa:');
 * if (name) {
 *     // User entered a value
 * }
 *
 * @example
 * const newName = await showPrompt('Novo nome:', 'Valor atual');
 */
export async function showPrompt(title, defaultValue = '') {
    const modal = new PromptModal({
        title,
        defaultValue
    });
    return modal.show();
}

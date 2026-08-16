// Path: js/modals/confirm.modal.js

/**
 * @fileoverview Confirm modal to replace browser's native confirm().
 * Provides a customizable confirmation dialog with confirm/cancel actions.
 *
 * Also serves the N-way variant (`showChoice`): the same dialog with an arbitrary set of labelled
 * actions instead of yes/no. It exists because a two-button confirm forces a false dilemma whenever
 * the safe extra option is "do the thing, but keep my data". Live caller: the rescued-slot question
 * in `open-atlas.service.js`. (Its three-way sibling, the "trabalho local não salvo" guard, was
 * removed in 2026-08-16 — opening a server project stopped touching the local atlas, so the dialog
 * threatened a destruction that no longer happened.)
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/** Maps an N-way choice variant onto the existing confirm-button styles (no new CSS). */
const CHOICE_VARIANT_CLASS = Object.freeze({
    ghost: 'confirm-modal-btn-cancel',
    primary: 'confirm-modal-btn-confirm',
    danger: 'confirm-modal-btn-confirm confirm-modal-btn-destructive',
});

/**
 * Confirm modal class.
 * Replaces the browser's native confirm() with a styled modal.
 */
export class ConfirmModal {
    /**
     * @param {Object} config - Modal configuration
     * @param {string} config.title - Modal title
     * @param {string} [config.message] - Modal message (supports \n for line breaks)
     * @param {string} [config.confirmText] - Confirm button text
     * @param {string} [config.cancelText] - Cancel button text
     * @param {boolean} [config.destructive] - If true, shows confirm button in red
     * @param {Array<{id: string, label: string, variant?: 'ghost'|'primary'|'danger'}>} [config.choices]
     *   N-way mode: renders these buttons instead of cancel/confirm and resolves with the chosen
     *   `id` (or `null` when dismissed). `confirmText`/`cancelText`/`destructive` are ignored.
     */
    constructor(config = {}) {
        this._config = {
            title: config.title || 'Confirmar',
            message: config.message || '',
            confirmText: config.confirmText || 'Confirmar',
            cancelText: config.cancelText || 'Cancelar',
            destructive: config.destructive || false,
            choices: Array.isArray(config.choices) && config.choices.length ? config.choices : null
        };
        this._overlay = null;
        this._container = null;
        this._resolvePromise = null;
        this._previousActiveElement = null;

        setupCleanup(this);
    }

    /**
     * Shows the confirm modal and returns a promise with the result.
     * @returns {Promise<boolean|string|null>} `true`/`false` in confirm mode; the chosen `id`
     *   (or `null` when dismissed) in N-way mode.
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
                // Focus cancel button by default for safety
                const cancelBtn = this._container.querySelector('.confirm-modal-btn-cancel');
                if (cancelBtn) {
                    cancelBtn.focus();
                }
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
        this._overlay.className = 'modal-overlay confirm-modal-overlay';
        this._overlay.setAttribute('role', 'alertdialog');
        this._overlay.setAttribute('aria-modal', 'true');
        this._overlay.setAttribute('aria-labelledby', 'confirm-modal-title');
        this._overlay.setAttribute('aria-describedby', 'confirm-modal-message');
        this._overlay.dataset.visible = 'false';

        // Container
        this._container = document.createElement('div');
        this._container.className = 'modal-container confirm-modal-container';

        // Body
        const body = document.createElement('div');
        body.className = 'confirm-modal-body';

        // Title
        const title = document.createElement('h3');
        title.className = 'confirm-modal-title';
        title.id = 'confirm-modal-title';
        title.textContent = this._config.title;
        body.appendChild(title);

        // Message (if provided)
        if (this._config.message) {
            const message = document.createElement('div');
            message.className = 'confirm-modal-message';
            message.id = 'confirm-modal-message';

            // Support line breaks in message
            const lines = this._config.message.split('\n');
            lines.forEach((line, index) => {
                if (index > 0) {
                    message.appendChild(document.createElement('br'));
                }
                message.appendChild(document.createTextNode(line));
            });

            body.appendChild(message);
        }

        // Actions
        const actions = document.createElement('div');
        actions.className = 'confirm-modal-actions';

        if (this._config.choices) {
            for (const choice of this._config.choices) {
                const btn = document.createElement('button');
                btn.className = `confirm-modal-btn ${CHOICE_VARIANT_CLASS[choice.variant] || CHOICE_VARIANT_CLASS.primary}`;
                btn.dataset.testid = `confirm-choice-${choice.id}`;
                btn.textContent = choice.label;
                addDomListener(this, btn, 'click', () => this._close(choice.id));
                actions.appendChild(btn);
            }
        } else {
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'confirm-modal-btn confirm-modal-btn-cancel';
            cancelBtn.textContent = this._config.cancelText;
            addDomListener(this, cancelBtn, 'click', () => this._cancel());
            actions.appendChild(cancelBtn);

            const confirmBtn = document.createElement('button');
            confirmBtn.className = `confirm-modal-btn confirm-modal-btn-confirm${this._config.destructive ? ' confirm-modal-btn-destructive' : ''}`;
            confirmBtn.textContent = this._config.confirmText;
            addDomListener(this, confirmBtn, 'click', () => this._confirm());
            actions.appendChild(confirmBtn);
        }

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

        // Handle keyboard. In N-way mode Enter is deliberately inert: with three labelled actions
        // there is no "the" confirm, and guessing one would let a blind Enter discard local work.
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape') {
                this._cancel();
            } else if (e.key === 'Enter' && !this._config.choices) {
                this._confirm();
            }
        });
    }

    /**
     * Confirms the action.
     * @private
     */
    _confirm() {
        this._close(true);
    }

    /**
     * Cancels the action (Esc / overlay click / the cancel button).
     * @private
     */
    _cancel() {
        this._close(this._config.choices ? null : false);
    }

    /**
     * Closes the modal.
     * @private
     * @param {boolean|string|null} result - The result value
     */
    _close(result) {
        this._overlay.dataset.visible = 'false';

        // Wait for animation
        setTimeout(() => {
            this._destroy();
            if (this._previousActiveElement) {
                this._previousActiveElement.focus();
            }
            if (this._resolvePromise) {
                this._resolvePromise(result);
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
    }
}

/**
 * Shows a confirm modal and returns the user's choice.
 * Convenience function to replace browser's confirm().
 *
 * @param {string} title - The confirm title/question
 * @param {Object} [options] - Additional options
 * @param {string} [options.message] - Additional message text
 * @param {string} [options.confirmText='Confirmar'] - Confirm button text
 * @param {string} [options.cancelText='Cancelar'] - Cancel button text
 * @param {boolean} [options.destructive=false] - Show confirm button in red
 * @returns {Promise<boolean>} True if confirmed, false if cancelled
 *
 * @example
 * // Simple confirmation
 * const confirmed = await showConfirm('Deletar este item?');
 * if (confirmed) {
 *     // User confirmed
 * }
 *
 * @example
 * // Destructive action with custom buttons
 * const confirmed = await showConfirm('Deletar permanentemente?', {
 *     message: 'Esta ação não pode ser desfeita.',
 *     confirmText: 'Deletar',
 *     cancelText: 'Manter',
 *     destructive: true
 * });
 */
export async function showConfirm(title, options = {}) {
    const modal = new ConfirmModal({
        title,
        message: options.message,
        confirmText: options.confirmText,
        cancelText: options.cancelText,
        destructive: options.destructive
    });
    return modal.show();
}

/**
 * Shows an N-way dialog: the same surface as {@link showConfirm}, but with an arbitrary set of
 * labelled actions instead of yes/no. Use it when the honest answer set has more than two members —
 * forcing such a decision through a confirm hides the option the user actually wants.
 *
 * Dismissing (Esc or clicking the backdrop) resolves `null`, never a choice: dismissal must always
 * be the inert outcome. Enter is inert too — see `_setupListeners`.
 *
 * @param {string} title - The question.
 * @param {Object} options
 * @param {string} [options.message] - Supporting text (supports `\n`).
 * @param {Array<{id: string, label: string, variant?: 'ghost'|'primary'|'danger'}>} options.choices
 *   Rendered left to right. Put the reversible option first and the destructive one last.
 * @returns {Promise<string|null>} The chosen `id`, or `null` if dismissed.
 *
 * @example
 * const choice = await showChoice('Este atlas tem trabalho resgatado neste computador', {
 *     choices: [
 *         { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
 *         { id: 'discard', label: 'Descartar o resgate e abrir', variant: 'danger' },
 *     ],
 * });
 */
export async function showChoice(title, { message, choices } = {}) {
    const modal = new ConfirmModal({ title, message, choices });
    return modal.show();
}

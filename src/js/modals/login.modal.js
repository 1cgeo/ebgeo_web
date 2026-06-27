// Path: js/modals/login.modal.js

/**
 * @fileoverview Login modal for backend authentication.
 * Collects username + password and delegates submission to an injected
 * callback. On success the modal closes; on failure it stays open and shows
 * an inline error message. No syncEngine import here — the account control
 * wires the actual authentication.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '@utils/event-cleanup.js';

/**
 * Header icon (user / login).
 */
const LOGIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

/**
 * Login modal.
 * @extends ModalBase
 */
export class LoginModal extends ModalBase {
    /**
     * @param {Object} options - Modal options
     * @param {function({username: string, password: string}): Promise<*>} options.onSubmit
     *   Submission handler. Resolve to close the modal; reject to keep it open
     *   and display the rejection message inline.
     * @param {function(): void} [options.onRegister]
     *   Called when the user clicks "Criar conta"; opens the signup flow.
     */
    constructor(options = {}) {
        super({
            id: 'login-modal',
            title: 'Entrar',
            icon: LOGIN_ICON,
            destroyOnHide: true
        });

        this._onSubmit = options.onSubmit || (() => Promise.resolve());
        this._onRegister = options.onRegister || null;
        this._submitting = false;
    }

    /**
     * Renders the modal content and appends it to the document.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'login-modal';
        this._container.classList.add('login-modal__container');

        const body = this.getBody();
        body.appendChild(this._createBrand());
        body.appendChild(this._createForm());

        this._setupListeners();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Builds the brand header (EBGeo logo + wordmark + tagline) shown above the form.
     * @private
     * @returns {HTMLElement}
     */
    _createBrand() {
        const brand = document.createElement('div');
        brand.className = 'login-modal__brand';

        const logo = document.createElement('img');
        logo.className = 'login-modal__logo';
        logo.src = '/images/logo_ebgeo.webp';
        logo.alt = 'EBGeo';
        logo.width = 72;
        logo.height = 72;
        brand.appendChild(logo);

        const title = document.createElement('h2');
        title.className = 'login-modal__brand-title';
        title.textContent = 'EBGeo';
        brand.appendChild(title);

        const tagline = document.createElement('p');
        tagline.className = 'login-modal__brand-tagline';
        tagline.textContent = 'Entre para colaborar nos seus atlas';
        brand.appendChild(tagline);

        return brand;
    }

    /**
     * Builds the login form DOM.
     * @private
     * @returns {HTMLElement}
     */
    _createForm() {
        const form = document.createElement('form');
        form.className = 'login-modal__form';

        // Username field
        const userField = document.createElement('div');
        userField.className = 'login-modal__field settings-field';

        const userLabel = document.createElement('label');
        userLabel.className = 'settings-field__label';
        userLabel.setAttribute('for', 'login-username');
        userLabel.textContent = 'Usuário';
        userField.appendChild(userLabel);

        const userInput = document.createElement('input');
        userInput.type = 'text';
        userInput.id = 'login-username';
        userInput.className = 'login-modal__input';
        userInput.autocomplete = 'username';
        userInput.dataset.testid = 'login-username';
        userField.appendChild(userInput);

        form.appendChild(userField);

        // Password field
        const passField = document.createElement('div');
        passField.className = 'login-modal__field settings-field';

        const passLabel = document.createElement('label');
        passLabel.className = 'settings-field__label';
        passLabel.setAttribute('for', 'login-password');
        passLabel.textContent = 'Senha';
        passField.appendChild(passLabel);

        const passInput = document.createElement('input');
        passInput.type = 'password';
        passInput.id = 'login-password';
        passInput.className = 'login-modal__input';
        passInput.autocomplete = 'current-password';
        passInput.dataset.testid = 'login-password';
        passField.appendChild(passInput);

        form.appendChild(passField);

        // Inline error (hidden until populated)
        const error = document.createElement('div');
        error.className = 'login-modal__error';
        error.dataset.testid = 'login-error';
        error.setAttribute('role', 'alert');
        error.hidden = true;
        form.appendChild(error);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'login-modal__actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'prompt-modal-btn prompt-modal-btn-cancel';
        cancelBtn.dataset.testid = 'login-cancel';
        cancelBtn.textContent = 'Cancelar';
        actions.appendChild(cancelBtn);

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'prompt-modal-btn prompt-modal-btn-confirm';
        submitBtn.dataset.testid = 'login-submit';
        submitBtn.textContent = 'Entrar';
        actions.appendChild(submitBtn);

        form.appendChild(actions);

        // Secondary: create-account affordance — only when a register handler is wired (the caller
        // wires it only where self-registration is enabled, so this is never a dead-end 404).
        this._registerBtn = null;
        if (this._onRegister) {
            const secondary = document.createElement('div');
            secondary.className = 'login-modal__secondary';

            const registerBtn = document.createElement('button');
            registerBtn.type = 'button';
            registerBtn.className = 'login-modal__link';
            registerBtn.dataset.testid = 'login-register';
            registerBtn.textContent = 'Não tem conta? Criar conta';
            secondary.appendChild(registerBtn);

            form.appendChild(secondary);
            this._registerBtn = registerBtn;
        }

        this._form = form;
        this._userInput = userInput;
        this._passInput = passInput;
        this._errorEl = error;
        this._submitBtn = submitBtn;
        this._cancelBtn = cancelBtn;

        return form;
    }

    /**
     * Wires form-specific listeners.
     * @private
     */
    _setupListeners() {
        addDomListener(this, this._form, 'submit', (e) => {
            e.preventDefault();
            this._handleSubmit();
        });

        addDomListener(this, this._cancelBtn, 'click', () => this._cancel());

        if (this._registerBtn) {
            addDomListener(this, this._registerBtn, 'click', () => {
                this._close();
                if (this._onRegister) this._onRegister();
            });
        }
    }

    /**
     * Runs the submit handler and reacts to its outcome.
     * @private
     */
    async _handleSubmit() {
        if (this._submitting) return;

        const username = this._userInput.value.trim();
        const password = this._passInput.value;

        this._clearError();
        this._setSubmitting(true);

        try {
            await this._onSubmit({ username, password });
            this._close();
        } catch (error) {
            const message = error?.message || 'Falha ao entrar. Tente novamente.';
            this._showError(message);
        } finally {
            this._setSubmitting(false);
        }
    }

    /**
     * Cancels and closes the modal.
     * @private
     */
    _cancel() {
        this._close();
    }

    /**
     * Hides and destroys the modal.
     * @private
     */
    _close() {
        this.destroy();
    }

    /**
     * Toggles the submitting/loading state.
     * @private
     * @param {boolean} submitting
     */
    _setSubmitting(submitting) {
        this._submitting = submitting;
        if (this._submitBtn) {
            this._submitBtn.disabled = submitting;
        }
    }

    /**
     * Shows an inline error message.
     * @private
     * @param {string} message
     */
    _showError(message) {
        if (!this._errorEl) return;
        this._errorEl.textContent = message;
        this._errorEl.hidden = false;
    }

    /**
     * Clears the inline error message.
     * @private
     */
    _clearError() {
        if (!this._errorEl) return;
        this._errorEl.textContent = '';
        this._errorEl.hidden = true;
    }
}

/**
 * Shows the login modal.
 * @param {Object} options
 * @param {function({username: string, password: string}): Promise<*>} options.onSubmit
 *   Submission handler. Resolve to close; reject to keep open with an inline error.
 * @param {function(): void} [options.onRegister] Opens the signup flow ("Criar conta").
 * @returns {LoginModal} The modal instance.
 */
export function showLoginModal({ onSubmit, onRegister } = {}) {
    const modal = new LoginModal({ onSubmit, onRegister });
    modal.render();
    modal.show();
    return modal;
}

// Path: js/modals/signup.modal.js

/**
 * @fileoverview Self-registration ("Criar conta") modal.
 * Collects the new-account fields and delegates submission to an injected
 * callback (the account control wires the actual `syncEngine.register`). On
 * success the modal closes; on failure it stays open and shows an inline error.
 * Reuses the `login-modal__*` visual block (shared auth-modal styling lives in
 * account.css) so login and signup look identical. No syncEngine import here.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '@utils/event-cleanup.js';
import { apiClient } from '@store/sync/api-client.js';
import config from '@js/config.js';

/** Header icon (user-plus / create account). */
const SIGNUP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>`;

/**
 * Signup modal.
 * @extends ModalBase
 */
export class SignupModal extends ModalBase {
    /**
     * @param {Object} options
     * @param {function(Object): Promise<*>} options.onSubmit
     *   Submission handler receiving `{ nome, username, password, posto_graduacao,
     *   organizacao_militar }`. Resolve to close the modal; reject to keep it open
     *   and display the rejection message inline.
     * @param {function(): void} [options.onBackToLogin]
     *   Called when the user clicks "Já tenho conta — Entrar".
     */
    constructor(options = {}) {
        super({
            id: 'signup-modal',
            title: 'Criar conta',
            icon: SIGNUP_ICON,
            destroyOnHide: true
        });

        this._onSubmit = options.onSubmit || (() => Promise.resolve());
        this._onBackToLogin = options.onBackToLogin || null;
        this._onRegistered = options.onRegistered || null;
        this._submitting = false;
    }

    /**
     * Renders the modal content and appends it to the document.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'signup-modal';
        // Reuse the login container styling (shared auth-modal look).
        this._container.classList.add('login-modal__container');

        const body = this.getBody();
        body.appendChild(this._createBrand());
        body.appendChild(this._createForm());

        this._setupListeners();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Builds the brand header (EBGeo logo + wordmark + tagline).
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
        tagline.textContent = 'Crie sua conta para colaborar nos atlas';
        brand.appendChild(tagline);

        return brand;
    }

    /**
     * Adds a labelled input field to a form, returning the input element.
     * @private
     * @param {HTMLElement} form
     * @param {{ id: string, label: string, type?: string, autocomplete?: string,
     *   testid: string, required?: boolean }} spec
     * @returns {HTMLInputElement}
     */
    _addField(form, spec) {
        const field = document.createElement('div');
        field.className = 'login-modal__field settings-field';

        const label = document.createElement('label');
        label.className = 'settings-field__label';
        label.setAttribute('for', spec.id);
        label.textContent = spec.label;
        field.appendChild(label);

        const input = document.createElement('input');
        input.type = spec.type || 'text';
        input.id = spec.id;
        input.className = 'login-modal__input';
        if (spec.autocomplete) input.autocomplete = spec.autocomplete;
        input.dataset.testid = spec.testid;
        if (spec.required) input.required = true;
        field.appendChild(input);

        form.appendChild(field);
        return input;
    }

    /**
     * Adds a labelled <select> (controlled-value combo box) to a form.
     * @private
     * @param {HTMLElement} form
     * @param {{ id: string, label: string, testid: string, required?: boolean,
     *   placeholder?: string }} spec
     * @param {Array<{ value: string, label: string }>} options
     * @returns {HTMLSelectElement}
     */
    _addSelectField(form, spec, options) {
        const field = document.createElement('div');
        field.className = 'login-modal__field settings-field';

        const label = document.createElement('label');
        label.className = 'settings-field__label';
        label.setAttribute('for', spec.id);
        label.textContent = spec.label;
        field.appendChild(label);

        const select = document.createElement('select');
        select.id = spec.id;
        select.className = 'login-modal__input login-modal__select';
        select.dataset.testid = spec.testid;
        if (spec.required) select.required = true;

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = spec.placeholder || 'Selecione…';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);

        for (const opt of options) {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        }

        field.appendChild(select);
        form.appendChild(field);
        return select;
    }

    /**
     * Maps a backend controlled-list (config.postos / config.organizacoesMilitares)
     * to <select> options, ordered by sort_order. The option VALUE is the row id
     * (FK stored in users.rank_id / organization_id); the label is the display name.
     * @private
     * @param {Array<{ id: string, name: string, sort_order?: number }>|undefined} list
     * @returns {Array<{ value: string, label: string }>}
     */
    _domainOptions(list) {
        if (!Array.isArray(list)) return [];
        return list
            .filter((item) => item && item.id && item.name)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((item) => ({ value: item.id, label: item.name }));
    }

    /**
     * Builds the signup form DOM.
     * @private
     * @returns {HTMLElement}
     */
    _createForm() {
        const form = document.createElement('form');
        form.className = 'login-modal__form';

        this._nomeInput = this._addField(form, {
            id: 'signup-nome', label: 'Nome completo', autocomplete: 'name',
            testid: 'signup-nome', required: true
        });
        this._userInput = this._addField(form, {
            id: 'signup-username', label: 'Usuário', autocomplete: 'username',
            testid: 'signup-username', required: true
        });
        this._emailInput = this._addField(form, {
            id: 'signup-email', label: 'E-mail', type: 'email', autocomplete: 'email',
            testid: 'signup-email', required: true
        });
        this._passInput = this._addField(form, {
            id: 'signup-password', label: 'Senha', type: 'password',
            autocomplete: 'new-password', testid: 'signup-password', required: true
        });
        this._passConfirmInput = this._addField(form, {
            id: 'signup-password-confirm', label: 'Confirmar senha', type: 'password',
            autocomplete: 'new-password', testid: 'signup-password-confirm', required: true
        });
        // Posto/Graduação and Organização Militar are controlled lists served by the
        // backend (/config). When present they render as required dropdowns; if the
        // backend served none (misconfig/offline), fall back to a required text input
        // so signup is never hard-blocked.
        const postoOpts = this._domainOptions(config.postos);
        const omOpts = this._domainOptions(config.organizacoesMilitares);

        this._postoInput = postoOpts.length
            ? this._addSelectField(form, {
                id: 'signup-posto', label: 'Posto/Graduação',
                testid: 'signup-posto', required: true,
                placeholder: 'Selecione o posto/graduação'
            }, postoOpts)
            : this._addField(form, {
                id: 'signup-posto', label: 'Posto/Graduação',
                testid: 'signup-posto', required: true
            });

        this._omInput = omOpts.length
            ? this._addSelectField(form, {
                id: 'signup-om', label: 'Organização Militar',
                testid: 'signup-om', required: true,
                placeholder: 'Selecione a organização militar'
            }, omOpts)
            : this._addField(form, {
                id: 'signup-om', label: 'Organização Militar',
                testid: 'signup-om', required: true
            });

        // Inline error (hidden until populated)
        const error = document.createElement('div');
        error.className = 'login-modal__error';
        error.dataset.testid = 'signup-error';
        error.setAttribute('role', 'alert');
        error.hidden = true;
        form.appendChild(error);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'login-modal__actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'prompt-modal-btn prompt-modal-btn-cancel';
        cancelBtn.dataset.testid = 'signup-cancel';
        cancelBtn.textContent = 'Cancelar';
        actions.appendChild(cancelBtn);

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.className = 'prompt-modal-btn prompt-modal-btn-confirm';
        submitBtn.dataset.testid = 'signup-submit';
        submitBtn.textContent = 'Criar conta';
        actions.appendChild(submitBtn);

        form.appendChild(actions);

        // Secondary: back to login
        const secondary = document.createElement('div');
        secondary.className = 'login-modal__secondary';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'login-modal__link';
        backBtn.dataset.testid = 'signup-back-to-login';
        backBtn.textContent = 'Já tenho conta — Entrar';
        secondary.appendChild(backBtn);

        // O LINK QUE O E-MAIL DO SISTEMA JÁ PROMETIA E NÃO EXISTIA. `sendAccountExistsEmail`
        // (`backend/src/utils/mailer.js`) manda, por extenso, "use a opção de reenviar a
        // confirmação na tela de cadastro", e esta tela não tinha nenhuma: quem seguisse a
        // instrução procurava um botão inexistente. Usa o endereço digitado no formulário acima,
        // que é o único que esta tela conhece.
        const resendBtn = document.createElement('button');
        resendBtn.type = 'button';
        resendBtn.className = 'login-modal__link';
        resendBtn.dataset.testid = 'signup-resend-verification';
        resendBtn.textContent = 'Não recebeu a confirmação? Reenviar';
        secondary.appendChild(resendBtn);

        form.appendChild(secondary);

        this._form = form;
        this._errorEl = error;
        this._submitBtn = submitBtn;
        this._cancelBtn = cancelBtn;
        this._backBtn = backBtn;
        this._resendBtn = resendBtn;

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
        addDomListener(this, this._cancelBtn, 'click', () => this._close());
        addDomListener(this, this._backBtn, 'click', () => {
            this._close();
            if (this._onBackToLogin) this._onBackToLogin();
        });
        addDomListener(this, this._resendBtn, 'click', () => this._handleResend());
    }

    /**
     * Re-sends the confirmation e-mail to the address typed above.
     *
     * It reports the SAME outcome whether or not that address has a pending account, mirroring the
     * route, which answers one 200 for both. Saying "enviamos" only for real accounts would turn
     * this convenience into the account oracle that `register` was rewritten to remove.
     * @private
     * @returns {Promise<void>}
     */
    async _handleResend() {
        const email = this._emailInput.value.trim();
        this._clearError();
        if (!email) {
            this._showError('Digite o e-mail do cadastro para receber um novo link.');
            return;
        }
        this._resendBtn.disabled = true;
        try {
            await apiClient.resendVerification({ email });
            this._showError('Se houver confirmação pendente para esse endereço, enviamos um novo link.');
        } catch {
            this._showError('Não foi possível reenviar agora. Tente de novo em instantes.');
        } finally {
            this._resendBtn.disabled = false;
        }
    }

    /**
     * Validates the form and runs the submit handler.
     * @private
     */
    async _handleSubmit() {
        if (this._submitting) return;

        const nome = this._nomeInput.value.trim();
        const username = this._userInput.value.trim();
        const email = this._emailInput.value.trim();
        const password = this._passInput.value;
        const passwordConfirm = this._passConfirmInput.value;
        const posto = this._postoInput.value.trim();
        const om = this._omInput.value.trim();

        this._clearError();

        if (!nome || !username || !email || !password) {
            this._showError('Preencha nome, usuário, e-mail e senha.');
            return;
        }
        // Password match is a basic local check — validate it before the controlled-list selects so
        // a mismatch is reported regardless of posto/OM.
        if (password !== passwordConfirm) {
            this._showError('As senhas não coincidem.');
            return;
        }
        if (!posto || !om) {
            this._showError('Selecione o posto/graduação e a organização militar.');
            return;
        }

        this._setSubmitting(true);
        try {
            await this._onSubmit({
                nome,
                username,
                email,
                password,
                rank_id: posto,
                organization_id: om
            });
            this._close();
            // ANUNCIA DEPOIS DE FECHAR, e é por isso que existe um gancho separado do `onSubmit`.
            // Enquanto o anúncio morava dentro do `onSubmit`, este `await` só terminava quando a
            // pessoa dispensava o diálogo, então o formulário de cadastro ficava montado atrás
            // dele COM A SENHA DIGITADA, e ao dispensar sobrava a tela do mapa anônimo sem
            // próximo passo. Fechar primeiro também garante que o diálogo não empilhe sobre um
            // formulário que já não serve para nada.
            if (this._onRegistered) this._onRegistered({ email });
        } catch (error) {
            this._showError(error?.message || 'Falha ao criar a conta. Tente novamente.');
        } finally {
            this._setSubmitting(false);
        }
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
        if (this._submitBtn) this._submitBtn.disabled = submitting;
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
 * Shows the signup modal.
 * @param {Object} options
 * @param {function(Object): Promise<*>} options.onSubmit Submission handler.
 * @param {function(): void} [options.onBackToLogin] Back-to-login handler.
 * @returns {SignupModal} The modal instance.
 */
export function showSignupModal({ onSubmit, onBackToLogin, onRegistered } = {}) {
    const modal = new SignupModal({ onSubmit, onBackToLogin, onRegistered });
    modal.render();
    modal.show();
    return modal;
}

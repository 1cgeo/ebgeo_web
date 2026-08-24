// Path: js/modals/login.modal.js

/**
 * @fileoverview Login modal for backend authentication.
 * Collects username + password and delegates submission to an injected
 * callback. On success the modal closes; on failure it stays open and shows
 * an inline error message. No syncEngine import here — the account control
 * wires the actual authentication.
 *
 * "ESQUECI MINHA SENHA" LIVES HERE, and the reason it is not injected like `onSubmit` is the
 * reason it did not exist at all until 2026-08-23: the rule was already true, and it was written
 * ONLY inside an e-mail (`sendAccountExistsEmail`, `backend/src/utils/mailer.js`), which is the
 * one place nobody looks after losing a password. The panel states the administrator path in
 * every deployment, and adds the e-mail path where the server actually offers it.
 *
 * TWO IMPORTS THAT THE ORIGINAL FILE DID NOT HAVE, and both are deliberate rather than drift.
 * `apiClient` because the recovery talks to two anonymous routes that no caller of this modal
 * owns (the account control wires the SESSION, and a recovery happens precisely when there is
 * none). `config` because the e-mail half must be gated on `features.password_reset_email`: those
 * routes are mounted only where the server can deliver account mail, so offering the form
 * elsewhere would promise a message nobody sends. Neither import drags the store — `api-client`
 * and `config` are leaf modules of the three pages that show this screen.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '@utils/event-cleanup.js';
import { apiClient } from '@store/sync/api-client.js';
import { loginFailureMessage } from './login-failure.model.js';
import config from '@js/config.js';
import {
    ADMIN_RECOVERY_TEXT,
    CODE_PASTE_HINT,
    CODE_REQUESTED_TEXT,
    EMAIL_RECOVERY_INTRO,
    MAX_PASSWORD_LENGTH,
    PASSWORD_RULE_TEXT,
    RESET_DONE_TEXT,
    RESET_SESSION_WARNING,
    emailRecoveryEnabled,
    normalizeRecoveryCode,
    recoveryErrorMessage,
    validateRecoveryRequest,
    validateRecoveryReset,
} from './password-recovery.model.js';

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

        /** @private Whether the recovery panel is on screen. */
        this._recoveryOpen = false;
        /** @private Whether a recovery request is in flight. */
        this._recoveryBusy = false;
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

        // A SAÍDA QUE FALTAVA PARA QUEM NÃO CONFIRMOU O E-MAIL. Ela não é decoração do erro: sem
        // ela a pessoa não entra (o login recusa), não redefine a senha (a consulta de recuperação
        // só acha endereço CONFIRMADO, de propósito) e o único botão de reenvio do produto vivia no
        // diálogo pós-cadastro, que some ao primeiro clique. Fica escondido até o servidor devolver
        // `EMAIL_NOT_VERIFIED`, e só ele o revela: um botão permanente aqui convidaria todo mundo a
        // gastar o limitador da rota.
        const errorAction = document.createElement('button');
        errorAction.type = 'button';
        errorAction.className = 'login-modal__link';
        errorAction.dataset.testid = 'login-resend-verification';
        errorAction.textContent = 'Reenviar e-mail de confirmação';
        errorAction.hidden = true;
        form.appendChild(errorAction);
        this._errorActionEl = errorAction;
        addDomListener(this, errorAction, 'click', () => this._resendVerification());

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

        // Secondary: recovery affordance. UNCONDITIONAL, unlike "Criar conta" below, because the
        // path it leads to (ask the administrator) exists in every deployment. What varies inside
        // the panel is whether the e-mail half is offered.
        const recoveryRow = document.createElement('div');
        recoveryRow.className = 'login-modal__secondary';

        const recoveryBtn = document.createElement('button');
        recoveryBtn.type = 'button';
        recoveryBtn.className = 'login-modal__link';
        recoveryBtn.dataset.testid = 'login-forgot-password';
        recoveryBtn.textContent = 'Esqueci minha senha';
        recoveryRow.appendChild(recoveryBtn);
        form.appendChild(recoveryRow);
        this._recoveryBtn = recoveryBtn;

        // The panel itself, built once and toggled by `hidden`, so a half-typed code survives an
        // accidental collapse.
        this._recoveryPanel = this._createRecoveryPanel();
        form.appendChild(this._recoveryPanel);

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
     * Builds the "Esqueci minha senha" panel.
     *
     * IT ALWAYS CARRIES THE ADMINISTRATOR SENTENCE, and only sometimes the e-mail forms. That
     * ordering is the point of the whole panel: the rule that is true everywhere goes first, and
     * the optional path is added under it. Where the e-mail path is off, the panel is still worth
     * opening, because until now the product said this in no interface at all.
     * @private
     * @returns {HTMLElement}
     */
    _createRecoveryPanel() {
        const panel = document.createElement('div');
        panel.className = 'login-modal__recovery';
        panel.dataset.testid = 'login-recovery-panel';
        panel.hidden = true;

        const adminNote = document.createElement('p');
        adminNote.className = 'login-modal__hint';
        adminNote.textContent = ADMIN_RECOVERY_TEXT;
        panel.appendChild(adminNote);

        this._recoveryEmailInput = null;
        this._recoveryCodeInput = null;
        this._recoveryPassInput = null;
        this._recoveryConfirmInput = null;
        this._recoveryRequestBtn = null;
        this._recoveryResetBtn = null;

        // GATED ON THE SERVER'S OWN FLAG, never on trying and catching a 404: the routes are
        // mounted only where account mail can be delivered (`canDeliverAccountMail`), and
        // `GET /api/config` reports exactly that predicate.
        if (emailRecoveryEnabled(config)) {
            const intro = document.createElement('p');
            intro.className = 'login-modal__hint';
            intro.textContent = EMAIL_RECOVERY_INTRO;
            panel.appendChild(intro);

            this._recoveryEmailInput = this._recoveryField({
                id: 'login-recovery-email',
                label: 'E-mail da conta',
                type: 'email',
                autocomplete: 'email',
                parent: panel,
            });

            this._recoveryRequestBtn = this._recoveryButton({
                label: 'Enviar código por e-mail',
                testid: 'login-recovery-request',
                parent: panel,
            });

            const paste = document.createElement('p');
            paste.className = 'login-modal__hint';
            paste.textContent = CODE_PASTE_HINT;
            panel.appendChild(paste);

            this._recoveryCodeInput = this._recoveryField({
                id: 'login-recovery-code',
                label: 'Código recebido',
                type: 'text',
                autocomplete: 'one-time-code',
                parent: panel,
            });
            this._recoveryPassInput = this._recoveryField({
                id: 'login-recovery-password',
                label: 'Nova senha',
                type: 'password',
                autocomplete: 'new-password',
                maxLength: MAX_PASSWORD_LENGTH,
                parent: panel,
            });
            this._recoveryConfirmInput = this._recoveryField({
                id: 'login-recovery-confirm',
                label: 'Confirmar a nova senha',
                type: 'password',
                autocomplete: 'new-password',
                maxLength: MAX_PASSWORD_LENGTH,
                parent: panel,
            });

            const rule = document.createElement('p');
            rule.className = 'login-modal__hint';
            rule.textContent = `${PASSWORD_RULE_TEXT} ${RESET_SESSION_WARNING}`;
            panel.appendChild(rule);

            this._recoveryResetBtn = this._recoveryButton({
                label: 'Redefinir senha',
                testid: 'login-recovery-reset',
                parent: panel,
            });
        }

        // One message area for the panel, with `role="status"`: it carries an outcome, and a
        // failure is told apart by the class, never by the colour alone.
        const message = document.createElement('div');
        message.className = 'login-modal__recovery-message';
        message.dataset.testid = 'login-recovery-message';
        message.setAttribute('role', 'status');
        message.hidden = true;
        panel.appendChild(message);
        this._recoveryMessageEl = message;

        return panel;
    }

    /**
     * Builds one labelled field of the recovery panel, appending it to `parent`.
     * @private
     * @param {{ id: string, label: string, type: string, autocomplete?: string,
     *   maxLength?: number, parent: HTMLElement }} spec
     * @returns {HTMLInputElement}
     */
    _recoveryField(spec) {
        const field = document.createElement('div');
        field.className = 'login-modal__field settings-field';

        const label = document.createElement('label');
        label.className = 'settings-field__label';
        label.setAttribute('for', spec.id);
        label.textContent = spec.label;
        field.appendChild(label);

        const input = document.createElement('input');
        input.type = spec.type;
        input.id = spec.id;
        input.className = 'login-modal__input';
        input.dataset.testid = spec.id;
        if (spec.autocomplete) input.autocomplete = spec.autocomplete;
        if (spec.maxLength) input.maxLength = spec.maxLength;
        field.appendChild(input);

        spec.parent.appendChild(field);
        return input;
    }

    /**
     * Builds one action button of the recovery panel, appending it to `parent`.
     * @private
     * @param {{ label: string, testid: string, parent: HTMLElement }} spec
     * @returns {HTMLButtonElement}
     */
    _recoveryButton(spec) {
        const row = document.createElement('div');
        row.className = 'login-modal__recovery-actions';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'prompt-modal-btn prompt-modal-btn-confirm';
        button.dataset.testid = spec.testid;
        button.textContent = spec.label;
        row.appendChild(button);

        spec.parent.appendChild(row);
        return button;
    }

    /**
     * Shows or clears the panel's message.
     * @private
     * @param {string} text
     * @param {'info'|'error'} [tone]
     */
    _setRecoveryMessage(text, tone = 'info') {
        if (!this._recoveryMessageEl) return;
        this._recoveryMessageEl.textContent = text;
        this._recoveryMessageEl.hidden = !text;
        this._recoveryMessageEl.classList.toggle('is-error', tone === 'error');
        // A failure has to be announced, not just shown: `status` is polite and a person who
        // just pressed a button and got an error is exactly who must not miss it.
        this._recoveryMessageEl.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    }

    /**
     * Toggles the recovery panel.
     * @private
     */
    _toggleRecovery() {
        this._recoveryOpen = !this._recoveryOpen;
        if (this._recoveryPanel) this._recoveryPanel.hidden = !this._recoveryOpen;
        if (this._recoveryBtn) {
            this._recoveryBtn.textContent = this._recoveryOpen
                ? 'Voltar para o login'
                : 'Esqueci minha senha';
        }
        if (this._recoveryOpen && this._recoveryEmailInput) {
            // Carries over what the person already typed in the login box, when it looks like an
            // address: they are recovering the account they just failed to enter.
            const typed = this._userInput?.value?.trim() ?? '';
            if (!this._recoveryEmailInput.value && typed.includes('@')) {
                this._recoveryEmailInput.value = typed;
            }
            this._recoveryEmailInput.focus();
        }
    }

    /**
     * Asks the server to mail a reset code.
     *
     * REPORTS THE SAME SENTENCE ON EVERY SUCCESS, because the server answers the same way for a
     * known and an unknown address. Saying "e-mail enviado" would put back, in the interface, the
     * account oracle the uniform 200 exists to close.
     * @private
     */
    async _requestRecoveryCode() {
        if (this._recoveryBusy || !this._recoveryEmailInput) return;

        const check = validateRecoveryRequest({ email: this._recoveryEmailInput.value });
        if (!check.valid) {
            this._setRecoveryMessage(check.message, 'error');
            return;
        }

        this._setRecoveryBusy(true);
        try {
            await apiClient.forgotPassword(this._recoveryEmailInput.value.trim());
            this._setRecoveryMessage(CODE_REQUESTED_TEXT);
        } catch (error) {
            this._setRecoveryMessage(
                recoveryErrorMessage(error, 'Não foi possível pedir o código agora.'),
                'error'
            );
        } finally {
            this._setRecoveryBusy(false);
        }
    }

    /**
     * Redeems a code and writes the new password.
     * @private
     */
    async _submitRecoveryReset() {
        if (this._recoveryBusy || !this._recoveryCodeInput) return;

        const form = {
            code: normalizeRecoveryCode(this._recoveryCodeInput.value),
            newPassword: this._recoveryPassInput?.value ?? '',
            confirmPassword: this._recoveryConfirmInput?.value ?? '',
        };

        const check = validateRecoveryReset(form);
        if (!check.valid) {
            this._setRecoveryMessage(check.message, 'error');
            return;
        }

        this._setRecoveryBusy(true);
        try {
            await apiClient.resetPasswordWithToken(form.code, form.newPassword);
            // The secret is wiped from the DOM the instant it stops being needed: these boxes
            // hold a single-use credential and a brand-new password.
            this._recoveryCodeInput.value = '';
            if (this._recoveryPassInput) this._recoveryPassInput.value = '';
            if (this._recoveryConfirmInput) this._recoveryConfirmInput.value = '';
            this._setRecoveryMessage(RESET_DONE_TEXT);
            if (this._passInput) this._passInput.value = '';
        } catch (error) {
            this._setRecoveryMessage(
                recoveryErrorMessage(error, 'Não foi possível redefinir a senha.'),
                'error'
            );
        } finally {
            this._setRecoveryBusy(false);
        }
    }

    /**
     * Toggles the busy state of the panel's two buttons.
     * @private
     * @param {boolean} busy
     */
    _setRecoveryBusy(busy) {
        this._recoveryBusy = busy;
        if (this._recoveryRequestBtn) this._recoveryRequestBtn.disabled = busy;
        if (this._recoveryResetBtn) this._recoveryResetBtn.disabled = busy;
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

        if (this._recoveryBtn) {
            addDomListener(this, this._recoveryBtn, 'click', () => this._toggleRecovery());
        }
        if (this._recoveryRequestBtn) {
            addDomListener(this, this._recoveryRequestBtn, 'click', () => this._requestRecoveryCode());
        }
        if (this._recoveryResetBtn) {
            addDomListener(this, this._recoveryResetBtn, 'click', () => this._submitRecoveryReset());
        }

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
            // O CÓDIGO DECIDE, NÃO A MENSAGEM. O servidor distingue cinco recusas de login e esta
            // tela olhava só o texto, então a única com uma SAÍDA acionável (o e-mail não
            // confirmado) chegava como mais uma frase vermelha sem próximo passo.
            //
            // E A FALHA QUE NÃO É RECUSA GANHA FRASE PRÓPRIA. `buildApiErrorMessage` cai no código
            // HTTP cru quando o corpo não traz mensagem, e o erro de rede do navegador escapava
            // inteiro: quem derrubasse o backend via "HTTP 502" ou "Failed to fetch" num campo de
            // senha, que lê como "errei a senha". A classificação já existia
            // (`@utils/request-failure.js`) e era consumida pelo boot e pelas páginas sem mapa;
            // este modal simplesmente não a importava.
            this._showError(loginFailureMessage(error), {
                canResendVerification: error?.code === 'EMAIL_NOT_VERIFIED'
            });
        } finally {
            this._setSubmitting(false);
        }
    }

    /**
     * Re-sends the confirmation e-mail for the username typed in the form.
     *
     * BY USERNAME, because that is what this screen has. The route accepts either, always answers
     * the same 200, and always mails the address REGISTERED on the account, so nothing here says
     * whether that account exists; the outcome message says the same thing for both reasons.
     * @private
     * @returns {Promise<void>}
     */
    async _resendVerification() {
        const username = this._userInput?.value.trim();
        if (!username) return;
        this._errorActionEl.disabled = true;
        try {
            await apiClient.resendVerification({ username });
            this._showError('Se a confirmação ainda estiver pendente, enviamos um novo link para o '
                + 'e-mail cadastrado.');
        } catch {
            this._showError('Não foi possível reenviar o e-mail agora. Tente de novo em instantes.',
                { canResendVerification: true });
        } finally {
            this._errorActionEl.disabled = false;
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
    _showError(message, { canResendVerification = false } = {}) {
        if (!this._errorEl) return;
        this._errorEl.textContent = message;
        this._errorEl.hidden = false;
        // Escrito em TODA passada, nunca só quando aparece: um botão que só sabe se revelar fica
        // na tela depois do erro seguinte, oferecendo uma saída que já não é a desta recusa.
        if (this._errorActionEl) this._errorActionEl.hidden = !canResendVerification;
    }

    /**
     * Clears the inline error message.
     * @private
     */
    _clearError() {
        if (!this._errorEl) return;
        this._errorEl.textContent = '';
        this._errorEl.hidden = true;
        if (this._errorActionEl) this._errorActionEl.hidden = true;
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

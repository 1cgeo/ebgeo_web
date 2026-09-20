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
 * IT IS TWO MUTUALLY EXCLUSIVE VIEWS SINCE 2026-09-20, not one screen with a panel that unfolds.
 * The recovery affordance used to EXPAND under the login form, so both were on screen at once and
 * the dialog started to scroll: the person who had just failed to enter had to scroll past the two
 * boxes that failed them to reach the one that helps. Now "Esqueci minha senha" REPLACES the login
 * view, and the way back is a command of its own ("Voltar para entrar") plus `Escape`, which in the
 * recovery view goes back instead of closing. Which view (and which of the two recovery steps) is
 * decided by `nextLoginView`, a pure function in `password-recovery.model.js` with a node test;
 * this file only applies the answer to the DOM.
 *
 * THE PASSWORD BOX IS EMPTIED ON THE WAY IN, and the username is not. The person is in the
 * recovery view precisely because the secret they typed does not work, so carrying it across is a
 * credential left in the DOM for nothing; the username is an identifier they will need again the
 * moment they come back. It is the same rule the reset already followed, which wipes the new
 * password and the code the instant they stop being needed.
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
import { attachPasswordVisibility } from '@ui/password-visibility.js';
import { apiClient } from '@store/sync/api-client.js';
import { loginFailureMessage } from './login-failure.model.js';
import config from '@js/config.js';
import {
    ADMIN_ONLY_RECOVERY_TEXT,
    ADMIN_RECOVERY_TEXT,
    CODE_PASTE_HINT,
    CODE_REQUESTED_TEXT,
    EMAIL_RECOVERY_INTRO,
    LoginFocus,
    LoginView,
    LoginViewAction,
    MAX_PASSWORD_LENGTH,
    PASSWORD_RULE_TEXT,
    RESET_DONE_TEXT,
    RESET_SESSION_WARNING,
    RecoveryStep,
    emailRecoveryEnabled,
    nextLoginView,
    normalizeRecoveryCode,
    recoveryErrorMessage,
    validateRecoveryRequest,
    validateRecoveryReset,
} from './password-recovery.model.js';

/**
 * Header icon (user / login).
 */
const LOGIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

/** Leading arrow of the "Voltar para entrar" command. Static markup, no user data. */
const BACK_ARROW_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

/** The id of the recovery view's own heading, which names the dialog while that view is up. */
const RECOVERY_TITLE_ID = 'login-modal-recovery-title';

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

        /** @private Which of the two mutually exclusive views is on screen. */
        this._view = LoginView.LOGIN;
        /** @private Which step of the recovery view is on screen. */
        this._step = RecoveryStep.REQUEST;
        /** @private Whether this deployment offers recovery by e-mail at all. */
        this._emailRecovery = emailRecoveryEnabled(config);
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

        // TWO SIBLINGS, never a panel nested in the form: the recovery inputs used to live inside
        // the login `<form>`, so Enter in the e-mail box submitted the LOGIN credentials.
        this._loginViewEl = document.createElement('div');
        this._loginViewEl.className = 'login-modal__view';
        this._loginViewEl.dataset.testid = 'login-view';
        this._loginViewEl.appendChild(this._createBrand());
        this._loginViewEl.appendChild(this._createForm());
        body.appendChild(this._loginViewEl);

        this._recoveryViewEl = this._createRecoveryView();
        body.appendChild(this._recoveryViewEl);

        this._setupListeners();
        this._applyView({ view: LoginView.LOGIN, step: RecoveryStep.REQUEST, focus: null });

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
        this._addReveal(passInput, 'login-password-reveal');

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
     * Builds the "Recuperar senha" view: a heading, the way back, and the two steps.
     *
     * IT ALWAYS CARRIES THE ADMINISTRATOR SENTENCE, and only sometimes the e-mail forms. That
     * ordering is the point of the whole view: the rule that is true everywhere goes first, and
     * the optional path is added under it. Where the e-mail path is off, the view is still worth
     * opening, because until 2026-08-23 the product said this in no interface at all.
     *
     * THE TWO STEPS ARE A HEIGHT DECISION, not a wizard for its own sake: asking for a code and
     * redeeming it are eleven elements together, which does not fit in the 85vh a 768-pixel screen
     * gives this dialog. Split, each step fits with room to spare, and the split matches the wait
     * that physically separates them (the message has to arrive).
     * @private
     * @returns {HTMLElement}
     */
    _createRecoveryView() {
        const view = document.createElement('section');
        view.className = 'login-modal__view login-modal__recovery';
        view.dataset.testid = 'login-recovery-view';
        view.hidden = true;

        // THE WAY BACK IS THE FIRST THING IN THE VIEW, in reading order and in tab order, because
        // it is the one command that is right for every reason a person lands here by mistake.
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'login-modal__back';
        back.dataset.testid = 'login-recovery-back';
        const arrow = document.createElement('span');
        arrow.className = 'login-modal__back-icon';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.innerHTML = BACK_ARROW_ICON;
        back.appendChild(arrow);
        const backLabel = document.createElement('span');
        backLabel.textContent = 'Voltar para entrar';
        back.appendChild(backLabel);
        view.appendChild(back);
        this._recoveryBackBtn = back;

        const title = document.createElement('h2');
        title.className = 'login-modal__view-title';
        title.id = RECOVERY_TITLE_ID;
        title.textContent = 'Recuperar senha';
        view.appendChild(title);

        this._recoveryEmailInput = null;
        this._recoveryCodeInput = null;
        this._recoveryPassInput = null;
        this._recoveryConfirmInput = null;
        this._recoveryRequestBtn = null;
        this._recoveryResetBtn = null;
        this._recoveryHaveCodeBtn = null;
        this._recoveryAskAgainBtn = null;
        this._recoveryResetStep = null;

        this._recoveryRequestStep = this._createRecoveryRequestStep();
        view.appendChild(this._recoveryRequestStep);

        // GATED ON THE SERVER'S OWN FLAG, never on trying and catching a 404: the routes are
        // mounted only where account mail can be delivered (`canDeliverAccountMail`), and
        // `GET /api/config` reports exactly that predicate.
        if (this._emailRecovery) {
            this._recoveryResetStep = this._createRecoveryResetStep();
            view.appendChild(this._recoveryResetStep);
        }

        // ONE MESSAGE AREA FOR BOTH STEPS, and it lives OUTSIDE them on purpose: the outcome of
        // asking for a code has to survive the step change that the same answer triggers.
        const message = document.createElement('div');
        message.className = 'login-modal__recovery-message';
        message.dataset.testid = 'login-recovery-message';
        message.setAttribute('role', 'status');
        message.hidden = true;
        view.appendChild(message);
        this._recoveryMessageEl = message;

        // THE WAY OUT OF A CODE THAT NEVER ARRIVES, under the outcome and not above the form.
        // It is drawn only on the step where a code is expected, and only where a code is offered
        // at all: where it is not, the sentence that replaces the whole view already said it.
        this._recoveryFallbackEl = null;
        if (this._emailRecovery) {
            const fallback = document.createElement('p');
            fallback.className = 'login-modal__hint';
            fallback.dataset.testid = 'login-recovery-fallback';
            fallback.textContent = ADMIN_RECOVERY_TEXT;
            fallback.hidden = true;
            view.appendChild(fallback);
            this._recoveryFallbackEl = fallback;
        }

        return view;
    }

    /**
     * Step one of the recovery view: the path that always exists, plus the request form where the
     * e-mail path is mounted.
     * @private
     * @returns {HTMLFormElement}
     */
    _createRecoveryRequestStep() {
        const step = document.createElement('form');
        step.className = 'login-modal__recovery-step';
        step.dataset.testid = 'login-recovery-step-request';
        // Our own pt-BR complaint, not the browser's bubble: `type="email"` would otherwise be
        // validated natively on submit and `validateRecoveryRequest` would never speak.
        step.noValidate = true;

        // ONE SENTENCE, and it is the one that answers "what do I do here": type your address,
        // a code comes. The administrator path used to open this screen and now closes it, as the
        // way out of a code that never arrived (`ADMIN_RECOVERY_TEXT`, under the outcome).
        const intro = document.createElement('p');
        intro.className = 'login-modal__hint';
        intro.textContent = this._emailRecovery ? EMAIL_RECOVERY_INTRO : ADMIN_ONLY_RECOVERY_TEXT;
        step.appendChild(intro);

        if (this._emailRecovery) {
            this._recoveryEmailInput = this._recoveryField({
                id: 'login-recovery-email',
                label: 'E-mail da conta',
                type: 'email',
                autocomplete: 'email',
                parent: step,
            });

            const actions = this._recoveryButton({
                label: 'Enviar código por e-mail',
                testid: 'login-recovery-request',
                parent: step,
                secondary: {
                    label: 'Já tenho um código',
                    testid: 'login-recovery-have-code',
                },
            });
            this._recoveryRequestBtn = actions.button;
            this._recoveryHaveCodeBtn = actions.secondary;
        }

        return step;
    }

    /**
     * Step two of the recovery view: redeem the code and write the new password.
     * @private
     * @returns {HTMLFormElement}
     */
    _createRecoveryResetStep() {
        const step = document.createElement('form');
        step.className = 'login-modal__recovery-step';
        step.dataset.testid = 'login-recovery-step-reset';
        step.noValidate = true;
        step.hidden = true;

        const paste = document.createElement('p');
        paste.className = 'login-modal__hint';
        paste.textContent = CODE_PASTE_HINT;
        step.appendChild(paste);

        this._recoveryCodeInput = this._recoveryField({
            id: 'login-recovery-code',
            label: 'Código recebido',
            type: 'text',
            autocomplete: 'one-time-code',
            parent: step,
        });
        this._recoveryPassInput = this._recoveryField({
            id: 'login-recovery-password',
            label: 'Nova senha',
            type: 'password',
            revealTestid: 'login-recovery-password-reveal',
            autocomplete: 'new-password',
            maxLength: MAX_PASSWORD_LENGTH,
            parent: step,
        });
        this._recoveryConfirmInput = this._recoveryField({
            id: 'login-recovery-confirm',
            label: 'Confirmar a nova senha',
            type: 'password',
            revealTestid: 'login-recovery-confirm-reveal',
            autocomplete: 'new-password',
            maxLength: MAX_PASSWORD_LENGTH,
            parent: step,
        });

        // TWO SHORT LINES, not one paragraph: the rule for the box above and the cost of pressing
        // the button below are different facts, and running them together made both unreadable.
        for (const text of [PASSWORD_RULE_TEXT, RESET_SESSION_WARNING]) {
            const line = document.createElement('p');
            line.className = 'login-modal__hint';
            line.textContent = text;
            step.appendChild(line);
        }

        const actions = this._recoveryButton({
            label: 'Redefinir senha',
            testid: 'login-recovery-reset',
            parent: step,
            secondary: {
                label: 'Pedir outro código',
                testid: 'login-recovery-ask-again',
            },
        });
        this._recoveryResetBtn = actions.button;
        this._recoveryAskAgainBtn = actions.secondary;

        return step;
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
        // Every password box of this dialog gets the same eye the sign-up form has. It attaches
        // AFTER the input has a parent, because the helper wraps the input where it stands.
        // The eye's testid is a LITERAL in the spec above, never `${spec.id}-reveal`: the census
        // of e2e testids reads literals only, and a composed id is neither checked nor protected.
        if (spec.revealTestid) this._addReveal(input, spec.revealTestid);
        return input;
    }

    /**
     * Builds the actions row of one recovery step, appending it to `parent`.
     *
     * THE SECONDARY LINK SHARES THE ROW instead of taking a line of its own, and that is a height
     * decision like the step split above: on the reset step it is the difference between fitting
     * in 85vh of a 768-pixel screen and scrolling.
     * @private
     * @param {{ label: string, testid: string, parent: HTMLElement,
     *   secondary?: { label: string, testid: string } }} spec
     * @returns {{ button: HTMLButtonElement, secondary: (HTMLButtonElement|null) }}
     */
    _recoveryButton(spec) {
        const row = document.createElement('div');
        row.className = 'login-modal__recovery-actions';

        let secondary = null;
        if (spec.secondary) {
            secondary = document.createElement('button');
            secondary.type = 'button';
            secondary.className = 'login-modal__link';
            secondary.dataset.testid = spec.secondary.testid;
            secondary.textContent = spec.secondary.label;
            row.appendChild(secondary);
        }

        // `submit`, so Enter in any box of the step does what the step is for.
        const button = document.createElement('button');
        button.type = 'submit';
        button.className = 'prompt-modal-btn prompt-modal-btn-confirm';
        button.dataset.testid = spec.testid;
        button.textContent = spec.label;
        row.appendChild(button);

        spec.parent.appendChild(row);
        return { button, secondary };
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
     * Runs one view transition through the pure reducer and applies the answer.
     * @private
     * @param {string} action - One of `LoginViewAction`.
     */
    _dispatchView(action) {
        this._applyView(nextLoginView(
            { view: this._view, step: this._step },
            action,
            { emailEnabled: this._emailRecovery }
        ));
    }

    /**
     * Puts one view (and one recovery step) on screen.
     *
     * THE HIDDEN VIEW USES `hidden`, not a class, so nothing in it is tabbable and no screen
     * reader announces a form that is not there. The dialog's accessible name follows, because a
     * dialog still called "Entrar" while showing "Recuperar senha" names the wrong screen.
     * @private
     * @param {{ view: string, step: string, focus: (string|null) }} next
     */
    _applyView(next) {
        const entering = next.view === LoginView.RECOVERY && this._view !== LoginView.RECOVERY;
        this._view = next.view;
        this._step = next.step;

        const recovery = next.view === LoginView.RECOVERY;
        if (this._loginViewEl) this._loginViewEl.hidden = recovery;
        if (this._recoveryViewEl) this._recoveryViewEl.hidden = !recovery;
        if (this._recoveryRequestStep) {
            this._recoveryRequestStep.hidden = next.step !== RecoveryStep.REQUEST;
        }
        if (this._recoveryResetStep) {
            this._recoveryResetStep.hidden = next.step !== RecoveryStep.RESET;
        }
        if (this._recoveryFallbackEl) {
            this._recoveryFallbackEl.hidden = next.step !== RecoveryStep.RESET;
        }
        this._overlay?.setAttribute(
            'aria-labelledby',
            recovery ? RECOVERY_TITLE_ID : `${this._config.id}-title`
        );

        if (entering) this._enterRecovery();
        this._focusFor(next.focus)?.focus();
    }

    /**
     * Carries over what is worth carrying, and wipes what is not, on the way into recovery.
     * @private
     */
    _enterRecovery() {
        // The password that just failed is a secret with nothing left to do: it is cleared, while
        // the username survives because the person needs it again on the way back.
        if (this._passInput) this._passInput.value = '';
        this._hideReveals();
        this._clearError();

        if (!this._recoveryEmailInput) return;
        // Carries over what the person already typed in the login box, when it looks like an
        // address: they are recovering the account they just failed to enter.
        const typed = this._userInput?.value?.trim() ?? '';
        if (!this._recoveryEmailInput.value && typed.includes('@')) {
            this._recoveryEmailInput.value = typed;
        }
    }

    /**
     * Resolves a focus role to the element that plays it right now.
     *
     * FALLS BACK TO THE WAY OUT, never to nothing: where the e-mail path is off there is no box to
     * focus, and a transition that focuses nothing leaves the focus on a control that just went
     * `hidden`, which drops it to the document body.
     * @private
     * @param {string|null} focus - One of `LoginFocus`.
     * @returns {HTMLElement|null}
     */
    _focusFor(focus) {
        switch (focus) {
            case LoginFocus.RECOVERY_EMAIL:
                return this._recoveryEmailInput ?? this._recoveryBackBtn ?? null;
            case LoginFocus.RECOVERY_CODE:
                return this._recoveryCodeInput ?? this._recoveryBackBtn ?? null;
            case LoginFocus.RECOVERY_BACK:
                return this._recoveryBackBtn ?? null;
            case LoginFocus.LOGIN_FORGOT:
                return this._recoveryBtn ?? this._userInput ?? null;
            default:
                return null;
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
            // The step advances on the UNIFORM answer, which is the only one there is: the server
            // says the same thing for a known and an unknown address, so the form to paste the
            // code is shown either way. It reveals nothing that the sentence above does not.
            this._dispatchView(LoginViewAction.CODE_REQUESTED);
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
            this._hideReveals();
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
            addDomListener(this, this._recoveryBtn, 'click',
                () => this._dispatchView(LoginViewAction.OPEN_RECOVERY));
        }
        if (this._recoveryBackBtn) {
            addDomListener(this, this._recoveryBackBtn, 'click',
                () => this._dispatchView(LoginViewAction.BACK_TO_LOGIN));
        }
        if (this._recoveryRequestStep) {
            addDomListener(this, this._recoveryRequestStep, 'submit', (e) => {
                e.preventDefault();
                this._requestRecoveryCode();
            });
        }
        if (this._recoveryResetStep) {
            addDomListener(this, this._recoveryResetStep, 'submit', (e) => {
                e.preventDefault();
                this._submitRecoveryReset();
            });
        }
        if (this._recoveryHaveCodeBtn) {
            addDomListener(this, this._recoveryHaveCodeBtn, 'click',
                () => this._dispatchView(LoginViewAction.HAVE_CODE));
        }
        if (this._recoveryAskAgainBtn) {
            addDomListener(this, this._recoveryAskAgainBtn, 'click',
                () => this._dispatchView(LoginViewAction.ASK_AGAIN));
        }

        // ESCAPE IS INTERCEPTED IN THE CAPTURE PHASE, and that is the whole mechanism: `ModalBase`
        // listens for it on `document` in the bubble phase and closes unconditionally, so the only
        // way for the recovery view to answer it FIRST is to run before that listener and stop the
        // event. In the login view nothing is stopped and the base closes the dialog as always.
        addDomListener(this, document, 'keydown', (e) => this._handleEscapeCapture(e),
            { capture: true });

        if (this._registerBtn) {
            addDomListener(this, this._registerBtn, 'click', () => {
                this._close();
                if (this._onRegister) this._onRegister();
            });
        }
    }

    /**
     * Answers `Escape` before `ModalBase` does, and only where the answer differs.
     * @private
     * @param {KeyboardEvent} e
     */
    _handleEscapeCapture(e) {
        if (e.key !== 'Escape' || !this._isOpen) return;
        // ONLY THE TOPMOST DIALOG ANSWERS. This listener runs in the capture phase on `document`
        // and stops the event for the whole tree, so a confirm or a menu opened ON TOP of this
        // dialog would lose its own Escape to it. Whoever is last in the document is on top.
        const dialogos = document.querySelectorAll('.modal-overlay');
        if (dialogos.length && dialogos[dialogos.length - 1] !== this._overlay) return;
        const next = nextLoginView(
            { view: this._view, step: this._step },
            LoginViewAction.ESCAPE,
            { emailEnabled: this._emailRecovery }
        );
        if (next.closesModal) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this._applyView(next);
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
     * Puts the show/hide eye on one password input and remembers it for release.
     * @private
     * @param {HTMLInputElement} input - A password input that already has a parent
     * @param {string} testid - `data-testid` of the eye button
     */
    _addReveal(input, testid) {
        if (!this._reveals) this._reveals = [];
        this._reveals.push(attachPasswordVisibility(input, { testid }));
    }

    /**
     * Hides every revealed password. Called wherever a password value is cleared: a field that
     * is emptied but left revealed shows the NEXT password typed there in clear text.
     * @private
     */
    _hideReveals() {
        for (const reveal of this._reveals ?? []) reveal.hide();
    }

    /**
     * Releases the eyes. Idempotent, because `hide()` and `destroy()` both reach it.
     * @private
     */
    _releaseReveals() {
        for (const reveal of this._reveals ?? []) reveal.destroy();
        this._reveals = [];
    }

    /** Hides the modal, releasing the composed controls first. */
    hide() {
        this._releaseReveals();
        super.hide();
    }

    /** Destroys the modal, releasing the composed controls first. */
    destroy() {
        this._releaseReveals();
        super.destroy();
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
/** The instance currently on screen, so a second request reuses it instead of stacking. */
let aberto = null;

export function showLoginModal({ onSubmit, onRegister } = {}) {
    // ONE DIALOG AT A TIME. Two quick activations of the same button (a double click, Enter held
    // down) used to build two overlays with the SAME element ids, so every `<label for>` pointed
    // at the first one, and two document-level key listeners answered each Escape.
    if (aberto?._isOpen) {
        aberto._overlay?.querySelector('input')?.focus();
        return aberto;
    }
    const modal = new LoginModal({ onSubmit, onRegister });
    modal.render();
    modal.show();
    aberto = modal;
    return modal;
}

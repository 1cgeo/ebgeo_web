// Path: js/modals/signup.modal.js

/**
 * @fileoverview Self-registration ("Criar conta") modal.
 * Collects the new-account fields and delegates submission to an injected
 * callback (the account control wires the actual `syncEngine.register`). On
 * success the modal closes; on failure it stays open and shows an inline error.
 * Reuses the `login-modal__*` input/error/action chrome (shared auth-modal styling) and adds its
 * own `signup-modal__*` block for the wide two-column layout. No syncEngine import here.
 *
 * WHY IT IS TWO COLUMNS, and why that is not decoration. Eight fields stacked in a 460px dialog
 * measured 1048px of content against 653px of dialog: everything from "Posto/Graduação" down —
 * the two controlled lists, the lotação note, the submit button and the "já tenho conta" link —
 * lived below the fold, so the form asked people to scroll to find out that it was not finished.
 * The fields are grouped by what they are FOR (identificação / acesso / posto e unidade), because
 * a two-column grid with no grouping just makes the reading order ambiguous.
 *
 * THE ORGANISATION IS A COMBOBOX, THE RANK IS NOT, and the asymmetry is the decision. The list of
 * units is long, alphabetical and full of near-identical names, which is a search; the list of
 * ranks is short and ordered by HIERARCHY, which is exactly the order a filter destroys. A native
 * `<select>` also remains the better control on a phone, where the OS draws its own picker.
 *
 * THE COMBOBOX SUBMITS AN ID, NEVER TEXT. `ui/searchable-select.js` keeps `value` empty until a
 * row is picked, so free text that matches nothing is refused here with a sentence that says so,
 * instead of reaching the server as a name it cannot resolve.
 */

import { ModalBase } from './modal.base.js';
import { addDomListener } from '@utils/event-cleanup.js';
import { apiClient } from '@store/sync/api-client.js';
import config from '@js/config.js';
import { createSearchableSelect } from '@ui/searchable-select.js';
import { attachPasswordVisibility } from '@ui/password-visibility.js';
import { avaliarConfirmacao, bytesDaSenha, MAX_SENHA_BYTES } from '@ui/password-match.model.js';
import { PASSWORD_HEAVY_TEXT, validateRecoveryRequest } from './password-recovery.model.js';

/**
 * The help line under "Organização Militar", in the vocabulary of the statute.
 *
 * THE FIELD IS REQUIRED AND SAID NOTHING, which is the reading it invited: a mandatory
 * "Organização Militar" on a form that also asks for rank looks like the field that decides what
 * the account may do. It decides nothing. `CONSTITUICAO.md` 1.5 says the organisation declared at
 * signup is LOTAÇÃO and does not authorise anything; 10.5 says it stays self-declared and that
 * nobody verifies it. What actually binds role and production scope is the administrator
 * (`users.producer_org_id`, guarded by the CHECK `users_producer_scope_check`), never this field.
 *
 * IT IS EXPORTED SO A NODE TEST CAN READ IT. The words are the whole content of the fix, and a
 * constant inlined in the DOM builder would only be reachable through a browser.
 */
export const LOTACAO_HINT = 'Sua lotação, declarada por você: ninguém a verifica, e ela não '
    + 'autoriza nada. Papel e escopo de produção são concedidos por um administrador.';

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
        this._reveals = [];
    }

    /**
     * Renders the modal content and appends it to the document.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'signup-modal';
        // Reuse the login container styling (shared auth-modal look) and widen it for the grid.
        this._container.classList.add('login-modal__container', 'signup-modal__container');

        const body = this.getBody();
        body.appendChild(this._createBrand());
        body.appendChild(this._createForm());

        this._setupListeners();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Builds the brand header (EBGeo logo + wordmark + tagline).
     *
     * HORIZONTAL, unlike the login dialog's stacked one: the centred 72px lozenge cost about
     * 150px of a 653px dialog, which is a quarter of the budget spent saying the name of the app
     * the person is already inside.
     * @private
     * @returns {HTMLElement}
     */
    _createBrand() {
        const brand = document.createElement('div');
        brand.className = 'signup-modal__brand';

        const logo = document.createElement('img');
        logo.className = 'signup-modal__logo';
        logo.src = '/images/logo_ebgeo.webp';
        logo.alt = 'EBGeo';
        logo.width = 48;
        logo.height = 48;
        brand.appendChild(logo);

        const texts = document.createElement('div');
        texts.className = 'signup-modal__brand-texts';

        const title = document.createElement('h2');
        title.className = 'signup-modal__brand-title';
        title.textContent = 'Criar conta no EBGeo';
        texts.appendChild(title);

        const tagline = document.createElement('p');
        tagline.className = 'signup-modal__brand-tagline';
        tagline.textContent = 'Preencha os dados abaixo para colaborar nos atlas';
        texts.appendChild(tagline);

        brand.appendChild(texts);
        return brand;
    }

    /**
     * Adds a titled group of fields, returning the two-column grid to fill.
     * @private
     * @param {HTMLElement} form
     * @param {string} legenda - Group title, in pt-BR.
     * @param {string} [modificador] - BEM modifier for the grid (e.g. 'lotacao' for uneven columns).
     * @returns {HTMLElement} The grid element the fields go into.
     */
    _addSection(form, legenda, modificador) {
        const section = document.createElement('fieldset');
        section.className = 'signup-modal__section';

        const caption = document.createElement('legend');
        caption.className = 'signup-modal__legend';
        caption.textContent = legenda;
        section.appendChild(caption);

        const grid = document.createElement('div');
        grid.className = modificador
            ? `signup-modal__grid signup-modal__grid--${modificador}`
            : 'signup-modal__grid';
        section.appendChild(grid);

        form.appendChild(section);
        return grid;
    }

    /**
     * Adds a labelled input field to a container, returning the input element.
     * @private
     * @param {HTMLElement} parent
     * @param {{ id: string, label: string, type?: string, autocomplete?: string,
     *   testid: string, required?: boolean }} spec
     * @returns {HTMLInputElement}
     */
    _addField(parent, spec) {
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

        parent.appendChild(field);
        return input;
    }

    /**
     * Adds a labelled `<select>` (controlled-value list) to a container.
     * @private
     * @param {HTMLElement} parent
     * @param {{ id: string, label: string, testid: string, required?: boolean,
     *   placeholder?: string }} spec
     * @param {Array<{ value: string, label: string }>} options
     * @returns {HTMLSelectElement}
     */
    _addSelectField(parent, spec, options) {
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
        parent.appendChild(field);
        return select;
    }

    /**
     * Maps a backend controlled-list (config.postos / config.organizacoesMilitares)
     * to options, ordered by sort_order. The option VALUE is the row id
     * (FK stored in users.rank_id / organization_id); the label is the display name.
     * @private
     * O RÓTULO É INJETÁVEL pela mesma razão de `buildDomainOptions` no painel: a OM se escreve
     * pelo nome e o POSTO pela abreviatura (`1º Ten`, e não "Primeiro Tenente").
     * A SIGLA VIAJA JUNTO porque o combobox filtra por ela: quem sabe "DSG" não deveria ter de
     * lembrar o nome por extenso para achar a própria unidade.
     * @param {Array<{ id: string, name: string, sigla?: string, sort_order?: number }>|undefined} list
     * @param {(item: Object) => string} [rotulo] - How to write one item.
     * @returns {Array<{ value: string, label: string, sigla: string|null }>}
     */
    _domainOptions(list, rotulo = (item) => item.name) {
        if (!Array.isArray(list)) return [];
        return list
            .filter((item) => item && item.id && item.name)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((item) => ({
                value: item.id,
                label: rotulo(item) || item.name,
                sigla: item.sigla ?? null,
            }));
    }

    /**
     * Builds the signup form DOM. Adds NO listeners: `_setupListeners` does that, which is what
     * lets a node test build this tree over a minimal fake `document`.
     * @private
     * @returns {HTMLElement}
     */
    _createForm() {
        const form = document.createElement('form');
        form.className = 'login-modal__form signup-modal__form';
        // OUR OWN pt-BR COMPLAINTS, not the browser's bubble, as the two recovery forms already do.
        // With native validation on, a `required` field stopped the `submit` event itself, so the
        // empty-field branches of `_handleSubmit` were unreachable: coverage with the look of
        // validation. The price is that the e-mail SHAPE is now checked there too.
        form.noValidate = true;

        const identidade = this._addSection(form, 'Identificação');
        this._nomeInput = this._addField(identidade, {
            id: 'signup-nome', label: 'Nome completo', autocomplete: 'name',
            testid: 'signup-nome', required: true
        });
        this._nomeGuerraInput = this._addField(identidade, {
            id: 'signup-nome-guerra', label: 'Nome de guerra',
            testid: 'signup-nome-guerra', required: false,
        });

        const acesso = this._addSection(form, 'Acesso');
        this._userInput = this._addField(acesso, {
            id: 'signup-username', label: 'Usuário', autocomplete: 'username',
            testid: 'signup-username', required: true
        });
        this._emailInput = this._addField(acesso, {
            id: 'signup-email', label: 'E-mail', type: 'email', autocomplete: 'email',
            testid: 'signup-email', required: true
        });
        this._passInput = this._addField(acesso, {
            id: 'signup-password', label: 'Senha', type: 'password',
            autocomplete: 'new-password', testid: 'signup-password', required: true
        });
        this._passConfirmInput = this._addField(acesso, {
            id: 'signup-password-confirm', label: 'Confirmar senha', type: 'password',
            autocomplete: 'new-password', testid: 'signup-password-confirm', required: true
        });

        // THE LIVE VERDICT, and it keeps its line whether or not it has words: a notice that only
        // takes up space once it speaks makes the whole form jump under the cursor at the very
        // moment the person is typing into it.
        const match = document.createElement('p');
        match.className = 'signup-modal__match';
        match.id = 'signup-password-match';
        match.dataset.testid = 'signup-password-match';
        match.setAttribute('aria-live', 'polite');
        this._passConfirmInput.parentElement.appendChild(match);
        this._passConfirmInput.setAttribute('aria-describedby', match.id);
        this._matchEl = match;

        // These values are UUIDs from the server, never free-form names.
        const postoOpts = this._domainOptions(config.postos, (p) => p.abrev || p.name);
        const omOpts = this._domainOptions(config.organizacoesMilitares);

        const lotacao = this._addSection(form, 'Posto e unidade', 'lotacao');
        this._postoInput = this._addSelectField(lotacao, {
            id: 'signup-posto', label: 'Posto/Graduação',
            testid: 'signup-posto', required: true,
        }, postoOpts);

        this._omCombo = createSearchableSelect({
            id: 'signup-om',
            label: 'Organização Militar',
            testid: 'signup-om',
            items: omOpts,
            placeholder: 'Digite o nome ou a sigla…',
            emptyText: 'Nenhuma unidade encontrada',
            required: true,
            disabled: !omOpts.length,
            fieldClass: 'login-modal__field settings-field',
            inputClass: 'login-modal__input',
        });
        lotacao.appendChild(this._omCombo.element);

        this._postoInput.disabled = !postoOpts.length;
        this._domainsUnavailable = !postoOpts.length || !omOpts.length;

        // The hint goes INSIDE the field, so it stays attached to the control, and it is announced
        // with the control through `aria-describedby`.
        const omHint = document.createElement('p');
        omHint.className = 'login-modal__hint signup-modal__hint';
        omHint.id = 'signup-om-hint';
        omHint.dataset.testid = 'signup-om-hint';
        omHint.textContent = LOTACAO_HINT;
        this._omCombo.input.setAttribute('aria-describedby', omHint.id);
        this._omCombo.element.appendChild(omHint);

        // Inline error (hidden until populated)
        const error = document.createElement('div');
        error.className = 'login-modal__error';
        error.dataset.testid = 'signup-error';
        error.setAttribute('role', 'alert');
        error.hidden = true;
        form.appendChild(error);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'login-modal__actions signup-modal__actions';

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
        secondary.className = 'login-modal__secondary signup-modal__secondary';

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
        if (this._domainsUnavailable) {
            submitBtn.disabled = true;
            this._showError('Não foi possível carregar os postos e organizações. Reabra o cadastro após atualizar a página.');
        }

        return form;
    }

    /**
     * Wires form-specific listeners and attaches the two composed controls (the combobox and the
     * reveal buttons), which is also where they start owning listeners of their own.
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

        this._omCombo.mount();

        this._reveals = [
            attachPasswordVisibility(this._passInput, { testid: 'signup-password-reveal' }),
            attachPasswordVisibility(this._passConfirmInput, {
                testid: 'signup-password-confirm-reveal',
            }),
        ];

        addDomListener(this, this._passInput, 'input', () => this._refreshPasswordMatch());
        addDomListener(this, this._passConfirmInput, 'input', () => this._refreshPasswordMatch());
    }

    /**
     * Paints the live confirmation verdict. The decision itself is pure and lives in
     * `ui/password-match.model.js`; this only writes what it decided.
     * @private
     */
    _refreshPasswordMatch() {
        if (!this._matchEl) return;
        const { estado, mensagem } = avaliarConfirmacao(
            this._passInput.value,
            this._passConfirmInput.value,
        );
        // Assigning the SAME text still replaces the text node, and a polite live region reads
        // that as news: typing a mismatching confirmation repeated the sentence on every key.
        const classe = `signup-modal__match signup-modal__match--${estado}`;
        if (this._matchEl.textContent !== mensagem) this._matchEl.textContent = mensagem;
        if (this._matchEl.className !== classe) this._matchEl.className = classe;
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
        if (this._submitting || this._domainsUnavailable) return;

        const nome = this._nomeInput.value.trim();
        const username = this._userInput.value.trim();
        const email = this._emailInput.value.trim();
        const password = this._passInput.value;
        const passwordConfirm = this._passConfirmInput.value;
        const posto = this._postoInput.value.trim();
        const om = this._omCombo.value;

        this._clearError();

        if (!nome || !username || !email || !password) {
            this._showError('Preencha nome, usuário, e-mail e senha.');
            return;
        }
        const emailCheck = validateRecoveryRequest({ email });
        if (!emailCheck.valid) {
            this._showError(emailCheck.message);
            return;
        }
        // Password match is a basic local check — validate it before the controlled lists so
        // a mismatch is reported regardless of posto/OM.
        if (password !== passwordConfirm) {
            this._showError('As senhas não coincidem.');
            return;
        }
        if (bytesDaSenha(password) > MAX_SENHA_BYTES) {
            this._showError(PASSWORD_HEAVY_TEXT);
            return;
        }
        if (!posto) {
            this._showError('Selecione o posto/graduação.');
            return;
        }
        if (!om) {
            // TYPED IS NOT CHOSEN: the combobox submits the unit's id, and text that was never
            // resolved to a row has none. Saying only "selecione a organização militar" over a
            // field that visibly has words in it reads as a broken form.
            this._showError(this._omCombo.text.trim()
                ? 'Escolha a organização militar na lista: o nome digitado não foi reconhecido.'
                : 'Selecione a organização militar.');
            this._omCombo.input.focus();
            return;
        }

        this._setSubmitting(true);
        try {
            await this._onSubmit({
                nome,
                nome_guerra: this._nomeGuerraInput.value.trim() || null,
                username,
                email,
                password,
                rank_id: posto,
                organization_id: om
            });
            if (!this.isOpen()) return;
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
     * Releases the two composed controls. Idempotent, because BOTH exits reach it: `hide()` (the
     * X, the overlay, Escape) and `destroy()`. The combobox owns a portal list parked on
     * `document.body` and document-level listeners, neither of which `ModalBase` can know about.
     * @private
     */
    _releaseFields() {
        if (this._omCombo) {
            this._omCombo.destroy();
            this._omCombo = null;
        }
        for (const reveal of this._reveals) reveal.destroy();
        this._reveals = [];
    }

    /** Hides the modal, releasing the composed controls first. */
    hide() {
        this._releaseFields();
        super.hide();
    }

    /** Destroys the modal, releasing the composed controls first. */
    destroy() {
        this._releaseFields();
        super.destroy();
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
        if (this._submitBtn) this._submitBtn.disabled = submitting || this._domainsUnavailable;
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
/** The instance currently on screen, so a second request reuses it instead of stacking. */
let aberto = null;

export function showSignupModal({ onSubmit, onBackToLogin, onRegistered } = {}) {
    // ONE DIALOG AT A TIME. Two quick activations of the same button (a double click, Enter held
    // down) used to build two overlays with the SAME element ids, so every `<label for>` pointed
    // at the first one, and two document-level key listeners answered each Escape.
    if (aberto?._isOpen) {
        aberto._overlay?.querySelector('input')?.focus();
        return aberto;
    }
    const modal = new SignupModal({ onSubmit, onBackToLogin, onRegistered });
    modal.render();
    modal.show();
    aberto = modal;
    return modal;
}

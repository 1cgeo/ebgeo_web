// Path: js/modals/account-settings.modal.js

/**
 * @fileoverview "Minha conta": the screen where a signed-in person reads their own record,
 * edits what they are allowed to edit, changes their own password and obtains an API key.
 *
 * WHY IT EXISTS. Four routes of `backend/src/modules/users/users.routes.js` were mounted,
 * gated by `auth`, audited and documented, and reached by nothing: `GET /users/me`,
 * `PUT /users/me`, `PUT /users/me/password` and `POST /users/me/api-key/rotate`. The last one
 * is the one that mattered most: the API key is a vigent feature of the server, with an audit
 * action of its own (`API_KEY_ROTATE`) and a wiki page, and no human being could obtain one
 * through any interface, their own or an administrator's.
 *
 * THE FOUR FACTS THE SCREEN IS BUILT AROUND, all measured against the server, not assumed:
 *
 *   1. `PUT /users/me` ACCEPTS TWO FIELDS. `updateProfileSchema` is `{ nome, rank_id }` and
 *      nothing else. `organization_id` (the posting) and `producer_org_id` (the production
 *      scope) are refused on purpose, and refused SILENTLY: `stripUnknown` drops them and the
 *      route answers 200 having changed nothing. So they are shown READ ONLY, with the note
 *      saying who does change them, because not knowing your own role is precisely what this
 *      screen fixes.
 *
 *   2. `GET /users/me` DOES NOT CARRY THE GLOBAL ROLE. Its query (`FIND_USER_BY_ID`,
 *      `backend/src/modules/users/users.queries.js`) selects the profile columns plus `email`
 *      and `email_verified`, and NOT `role` nor `producer_org_id`. Those two come from
 *      `GET /auth/me`, whose same-named query lives in
 *      `backend/src/modules/auth/auth.queries.js` and does select them. Hence TWO reads on
 *      open. Do not "simplify" this into one call from the users route: the role would quietly
 *      disappear from the screen.
 *
 *   4. THE E-MAIL IS READ HERE AND CHANGED SOMEWHERE ELSE. `updateProfileSchema` does not
 *      accept it; `PUT /users/me/email` does, and it asks for the current password and answers
 *      with an invitation to the NEW mailbox rather than with a changed account. So the address
 *      sits in the read-only block with its confirmation state spelled out, and the change has
 *      a section of its own that says, before the click, that nothing moves until the link in
 *      the other mailbox is followed. Both facts were measured against `requestEmailChange`
 *      (`backend/src/modules/users/users.service.js`); see `account-settings.model.js`.
 *
 *   3. CHANGING THE PASSWORD ENDS THIS SESSION TOO. `updatePassword`
 *      (`backend/src/modules/users/users.service.js`) runs `REVOKE_ALL_USER_TOKENS`, which
 *      revokes the refresh family AND stamps `users.sessions_valid_from`; the route returns no
 *      new token pair. The warning therefore says "inclusive esta", which is the measured
 *      truth, and it is shown BEFORE the button, not after the 401.
 *
 * THE API KEY IS THE DELICATE PART, and three properties drive its design:
 *   - The response of the rotation is the ONLY time the key is readable. No route reads it
 *     back. So it is revealed in a block with a copy button, guarded by a confirmation on
 *     close when it was never copied, and the sentence saying it is unreadable afterwards is
 *     on screen the whole time.
 *   - Rotating invalidates the previous key INSTANTLY (no overlap window), so the click is
 *     destructive and asks first, naming the consequence.
 *   - NOTHING TELLS US WHETHER A KEY EXISTS. No route and no query of the users module selects
 *     `api_key`. The screen therefore never claims one way or the other; it says so.
 *   The key never goes to `console`, never to a `title`, never to `localStorage`. It lives in
 *   one field of the instance and dies with the modal.
 *
 * The pure half (bounds, sentences, validation, section state) is in
 * `modals/account-settings.model.js`, which has zero imports and is unit tested.
 *
 * Exports {@link showAccountSettingsModal}, whose signature is a contract with the callers that
 * open it by dynamic `import()`.
 */

import { ModalBase } from './modal.base.js';
import { showConfirm } from './confirm.modal.js';
import {
    addScopedDomListener,
    clearScopedListeners,
    trackTimer,
} from '@utils/event-cleanup.js';
import { apiClient } from '@store/sync/api-client.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import config from '@js/config.js';
// Import DIRETO por arquivo: `ui/role-labels.js` tem ZERO imports, e é essa propriedade que
// permite usá-lo daqui sem arrastar nada para `atlas.html` e `admin.html`, que bootam sem a
// store e também abrem esta tela.
import { globalRoleBadge, getGlobalRoleDescription } from '@js/ui/role-labels.js';
import {
    ADMIN_ONLY_FIELDS_NOTE,
    API_KEY_COPY_NOW_TEXT,
    API_KEY_DISCARD_CONFIRM_MESSAGE,
    API_KEY_DISCARD_CONFIRM_TITLE,
    API_KEY_ONE_TIME_WARNING,
    API_KEY_ROTATE_CONFIRM_MESSAGE,
    API_KEY_ROTATE_CONFIRM_TITLE,
    API_KEY_UNKNOWN_STATE_TEXT,
    EMAIL_CHANGE_PASSWORD_NOTE,
    EMAIL_CHANGE_SENT_TEXT,
    EMAIL_CHANGE_WARNING,
    EMAIL_UNVERIFIED_HINT,
    MAX_EMAIL_LENGTH,
    MAX_NAME_LENGTH,
    PASSWORD_RULE_TEXT,
    PASSWORD_SESSION_WARNING,
    accountErrorMessage,
    apiKeySectionState,
    emailPresentation,
    hasUncopiedKey,
    profilePatch,
    validateEmailChangeForm,
    validatePasswordForm,
    validateProfileDraft,
} from './account-settings.model.js';

/** Scope name for the listeners of a rebuildable section. */
const LISTENER_SCOPE = 'account-settings-body';

/** How long the copy button shows its confirmation. */
const COPIED_FEEDBACK_MS = 1600;

const USER_ICON = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
    </svg>
`;

/**
 * @private Creates an element with an optional class and text.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/**
 * @private The active rank list served by `GET /api/config`, as `<select>` options.
 *
 * The list comes from the config singleton (already hydrated on all three pages that can open
 * this screen) rather than from `GET /ranks`, which would be a second round trip for the same
 * rows. `listPostos` (`backend/src/modules/config/config.service.js`) already filters
 * `is_active = true` and orders by `sort_order`.
 * @returns {Array<{ value: string, label: string }>}
 */
function rankOptions() {
    const list = Array.isArray(config?.postos) ? config.postos : [];
    return list
        .filter((item) => item && item.id && item.name)
        .map((item) => ({ value: String(item.id), label: String(item.name) }));
}

/**
 * @private Display name of an organization id, from the config singleton.
 *
 * Returns an empty string when the id is not in the list, which happens for a DEACTIVATED
 * organization (`listOrganizacoesMilitares` serves only active ones). The caller says so in
 * words instead of printing a bare uuid the person cannot act on.
 * @param {*} orgId
 * @returns {string}
 */
function organizationName(orgId) {
    if (!orgId) return '';
    const list = Array.isArray(config?.organizacoesMilitares) ? config.organizacoesMilitares : [];
    const found = list.find((item) => item && String(item.id) === String(orgId));
    return found?.name ? String(found.name) : '';
}

/**
 * The "Minha conta" modal.
 */
export class AccountSettingsModal extends ModalBase {
    /**
     * @param {Object} [options]
     * @param {() => void} [options.onClosed] - Called once, after the modal actually closes.
     */
    constructor({ onClosed } = {}) {
        super({
            id: 'account-settings-modal',
            title: 'Minha conta',
            icon: USER_ICON,
            destroyOnHide: true,
        });

        /** @private @type {Object|null} The profile as `GET /users/me` last returned it. */
        this._profile = null;
        /** @private @type {Object|null} The identity document of `GET /auth/me` (role + scope). */
        this._identity = null;
        /** @private */
        this._loading = true;
        /** @private @type {string} */
        this._loadError = '';
        /** @private */
        this._saving = false;
        /** @private @type {string} */
        this._profileError = '';

        /** @private Whether the e-mail-change request is in flight. */
        this._changingEmail = false;
        /** @private @type {string} */
        this._emailError = '';
        /** @private @type {string} */
        this._emailDone = '';

        /** @private */
        this._changingPassword = false;
        /** @private @type {string} */
        this._passwordError = '';
        /** @private @type {string} */
        this._passwordDone = '';

        /**
         * @private The API key section. `apiKey` is the ONLY place the secret lives, and it is
         * never written anywhere else: no storage, no log, no attribute.
         * @type {{ rotating: boolean, apiKey: string, error: string, copied: boolean }}
         */
        this._key = { rotating: false, apiKey: '', error: '', copied: false };

        /** @private Guards re-entering the close confirmation. */
        this._askingToDiscard = false;
        /** @private @type {(() => void)|null} Resolves the promise of `showAccountSettingsModal`. */
        this._onClosed = typeof onClosed === 'function' ? onClosed : null;
    }

    /**
     * Renders the shell and starts the initial read.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'account-settings-modal';
        this.getContainer().classList.add('account-settings-modal-container');
        document.body.appendChild(overlay);
        this._renderBody();
        this._load();
        return overlay;
    }

    /**
     * Closes the modal, unless a key is on screen that was never copied.
     *
     * The guard sits in `hide()` and not on the close button because Escape and the overlay
     * click reach the same method, and those are exactly the distracted gestures that would
     * throw the key away. `showConfirm` is asynchronous, so this returns early and calls
     * `super.hide()` from the resolution.
     */
    hide() {
        if (!this._isOpen) {
            super.hide();
            return;
        }
        if (!hasUncopiedKey(this._key)) {
            this._finishHide();
            return;
        }
        if (this._askingToDiscard) return;
        this._askingToDiscard = true;
        showConfirm(API_KEY_DISCARD_CONFIRM_TITLE, {
            message: API_KEY_DISCARD_CONFIRM_MESSAGE,
            confirmText: 'Fechar mesmo assim',
            cancelText: 'Voltar e copiar',
            destructive: true,
        }).then((confirmed) => {
            this._askingToDiscard = false;
            if (confirmed) {
                this._key = { rotating: false, apiKey: '', error: '', copied: false };
                this._finishHide();
            }
        });
    }

    /**
     * @private Actually closes, wiping the secret from the instance first.
     */
    _finishHide() {
        this._key = { rotating: false, apiKey: '', error: '', copied: false };
        clearScopedListeners(this, LISTENER_SCOPE);
        super.hide();
        const done = this._onClosed;
        this._onClosed = null;
        if (done) done();
    }

    // ===== DATA =====

    /**
     * @private Reads BOTH documents: the editable profile and the identity (role + scope).
     *
     * They are separate routes with different columns; see the fileoverview. `Promise.all`
     * because neither depends on the other, and a failure of either is one failure of the
     * screen: showing half a record would be worse than saying the read failed.
     */
    async _load() {
        this._loading = true;
        this._loadError = '';
        this._renderBody();
        try {
            const [profile, identity] = await Promise.all([
                apiClient.getMyProfile(),
                apiClient.getMe(),
            ]);
            if (!this.getBody()) return; // closed while the request was in flight
            this._profile = profile || null;
            this._identity = identity || null;
            this._loading = false;
        } catch (error) {
            if (!this.getBody()) return;
            this._loading = false;
            this._loadError = accountErrorMessage(
                error,
                'Não foi possível ler os seus dados agora.'
            );
        }
        this._renderBody();
    }

    /**
     * @private Saves the profile edit, sending only what changed.
     */
    async _saveProfile() {
        const body = this.getBody();
        if (!body || this._saving) return;

        const draft = {
            nome: body.querySelector('[data-field="nome"]')?.value ?? '',
            rank_id: body.querySelector('[data-field="rank"]')?.value ?? '',
        };

        const check = validateProfileDraft(draft);
        if (!check.valid) {
            this._profileError = check.message;
            this._renderBody();
            return;
        }

        const patch = profilePatch(this._profile || {}, draft);
        if (!patch) {
            this._profileError = 'Nada mudou nos seus dados.';
            this._renderBody();
            return;
        }

        this._saving = true;
        this._profileError = '';
        this._renderBody();
        try {
            const updated = await apiClient.updateMyProfile(patch);
            if (!this.getBody()) return;
            this._profile = updated || this._profile;
            this._saving = false;
            this._renderBody();
            showSuccess('Os seus dados foram atualizados.');
        } catch (error) {
            if (!this.getBody()) return;
            this._saving = false;
            this._profileError = accountErrorMessage(
                error,
                'Não foi possível salvar os seus dados.'
            );
            this._renderBody();
        }
    }

    /**
     * @private Asks the server to move the account's e-mail to another address.
     *
     * NOTHING IS RE-READ ON SUCCESS, and that is not an oversight: the account still carries the
     * old address, because the route only mints an invitation. Refreshing the profile here would
     * redraw exactly the same row and suggest that nothing happened.
     */
    async _changeEmail() {
        const body = this.getBody();
        if (!body || this._changingEmail) return;

        const form = {
            email: body.querySelector('[data-field="email-novo"]')?.value ?? '',
            currentPassword: body.querySelector('[data-field="email-senha"]')?.value ?? '',
            currentEmail: this._profile?.email ?? '',
        };

        const check = validateEmailChangeForm(form);
        if (!check.valid) {
            this._emailError = check.message;
            this._emailDone = '';
            this._renderBody();
            return;
        }

        this._changingEmail = true;
        this._emailError = '';
        this._emailDone = '';
        this._renderBody();
        try {
            await apiClient.requestEmailChange(form.email, form.currentPassword);
            if (!this.getBody()) return;
            this._changingEmail = false;
            this._emailDone = EMAIL_CHANGE_SENT_TEXT;
            this._renderBody();
            showSuccess('Pedido registrado. Confirme pelo link enviado ao endereço novo.');
        } catch (error) {
            if (!this.getBody()) return;
            this._changingEmail = false;
            this._emailError = accountErrorMessage(
                error,
                'Não foi possível pedir a troca de e-mail.'
            );
            this._renderBody();
        }
    }

    /**
     * @private Changes the password, after a confirmation that names the consequence.
     */
    async _changePassword() {
        const body = this.getBody();
        if (!body || this._changingPassword) return;

        const form = {
            currentPassword: body.querySelector('[data-field="senha-atual"]')?.value ?? '',
            newPassword: body.querySelector('[data-field="senha-nova"]')?.value ?? '',
            confirmPassword: body.querySelector('[data-field="senha-confirma"]')?.value ?? '',
        };

        const check = validatePasswordForm(form);
        if (!check.valid) {
            this._passwordError = check.message;
            this._passwordDone = '';
            this._renderBody();
            return;
        }

        const confirmed = await showConfirm('Trocar a senha e encerrar as sessões?', {
            message: PASSWORD_SESSION_WARNING,
            confirmText: 'Trocar a senha',
            cancelText: 'Cancelar',
            destructive: true,
        });
        if (!confirmed || !this.getBody()) return;

        this._changingPassword = true;
        this._passwordError = '';
        this._passwordDone = '';
        this._renderBody();
        try {
            await apiClient.updateMyPassword(form.currentPassword, form.newPassword);
            if (!this.getBody()) return;
            this._changingPassword = false;
            this._passwordDone = 'Senha trocada. Todas as sessões desta conta foram encerradas, '
                + 'inclusive esta: entre de novo com a senha nova.';
            this._renderBody();
            showSuccess('Senha trocada. Entre de novo com a senha nova.');
        } catch (error) {
            if (!this.getBody()) return;
            this._changingPassword = false;
            this._passwordError = accountErrorMessage(
                error,
                'Não foi possível trocar a senha.'
            );
            this._renderBody();
        }
    }

    /**
     * @private Rotates the API key, after a destructive confirmation.
     */
    async _rotateKey() {
        if (this._key.rotating) return;

        const confirmed = await showConfirm(API_KEY_ROTATE_CONFIRM_TITLE, {
            message: API_KEY_ROTATE_CONFIRM_MESSAGE,
            confirmText: 'Gerar chave nova',
            cancelText: 'Cancelar',
            destructive: true,
        });
        if (!confirmed || !this.getBody()) return;

        this._key = { rotating: true, apiKey: '', error: '', copied: false };
        this._renderBody();
        try {
            const result = await apiClient.rotateMyApiKey();
            if (!this.getBody()) return;
            const chave = typeof result?.apiKey === 'string' ? result.apiKey : '';
            this._key = chave
                ? { rotating: false, apiKey: chave, error: '', copied: false }
                : {
                    rotating: false,
                    apiKey: '',
                    copied: false,
                    error: 'O servidor respondeu sem a chave. Tente gerar de novo.',
                };
            this._renderBody();
        } catch (error) {
            if (!this.getBody()) return;
            this._key = {
                rotating: false,
                apiKey: '',
                copied: false,
                error: accountErrorMessage(error, 'Não foi possível gerar a chave.'),
            };
            this._renderBody();
        }
    }

    /**
     * @private Copies the revealed key. Only a SUCCESSFUL write marks it copied, because the
     * flag is what decides whether closing the modal is allowed to be silent.
     * @param {HTMLElement} button
     */
    async _copyKey(button) {
        const chave = this._key.apiKey;
        if (!chave) return;
        try {
            await navigator.clipboard.writeText(chave);
            this._key = { ...this._key, copied: true };
            button.textContent = 'Copiada';
            button.classList.add('is-copied');
            const timer = setTimeout(() => {
                if (button.isConnected) {
                    button.textContent = 'Copiar chave';
                    button.classList.remove('is-copied');
                }
            }, COPIED_FEEDBACK_MS);
            trackTimer(this, timer);
            this._renderBody();
        } catch {
            showError('Não foi possível copiar. Selecione a chave e copie à mão.');
        }
    }

    // ===== RENDER =====

    /**
     * @private Rebuilds the whole body from state.
     */
    _renderBody() {
        const body = this.getBody();
        if (!body) return;
        clearScopedListeners(this, LISTENER_SCOPE);
        body.textContent = '';

        const root = el('div', 'account-settings');
        root.appendChild(this._renderProfileSection());
        // The e-mail section comes BEFORE the password one because it is the recovery channel of
        // the password: someone who cannot get in reads this screen top-down, and the address is
        // what they have to get right first.
        root.appendChild(this._renderEmailSection());
        root.appendChild(this._renderPasswordSection());
        root.appendChild(this._renderKeySection());
        body.appendChild(root);
    }

    /**
     * @private Section header.
     * @param {string} titulo
     * @param {string} descricao
     * @returns {HTMLElement}
     */
    _sectionHeader(titulo, descricao) {
        const wrap = el('div', 'account-settings__section-header');
        wrap.appendChild(el('h3', 'account-settings__section-title', titulo));
        if (descricao) {
            wrap.appendChild(el('p', 'account-settings__section-hint', descricao));
        }
        return wrap;
    }

    /**
     * @private A read-only "label: value" row.
     * @param {string} rotulo
     * @param {string} valor
     * @param {string} [nota]
     * @returns {HTMLElement}
     */
    _readonlyRow(rotulo, valor, nota = '') {
        const row = el('div', 'account-settings__readonly-row');
        row.appendChild(el('span', 'account-settings__readonly-label', rotulo));
        const value = el('span', 'account-settings__readonly-value', valor);
        row.appendChild(value);
        if (nota) {
            row.appendChild(el('span', 'account-settings__readonly-note', nota));
        }
        return row;
    }

    /**
     * @private A labelled text/password input.
     * @param {{ field: string, label: string, type?: string, value?: string,
     *   autocomplete?: string, maxLength?: number }} spec
     * @returns {HTMLElement}
     */
    _inputField(spec) {
        const field = el('div', 'account-settings__field');
        const id = `account-settings-${spec.field}`;
        const label = el('label', 'account-settings__label', spec.label);
        label.setAttribute('for', id);
        field.appendChild(label);

        const input = document.createElement('input');
        input.className = 'account-settings__input';
        input.id = id;
        input.type = spec.type || 'text';
        input.value = spec.value || '';
        input.dataset.field = spec.field;
        input.dataset.testid = id;
        if (spec.autocomplete) input.autocomplete = spec.autocomplete;
        if (spec.maxLength) input.maxLength = spec.maxLength;
        field.appendChild(input);
        return field;
    }

    /**
     * @private A button that carries the section's action.
     * @param {{ label: string, variant?: string, disabled?: boolean, testid?: string,
     *   onClick: () => void }} spec
     * @returns {HTMLElement}
     */
    _actionButton(spec) {
        const button = el('button', `account-settings__btn account-settings__btn--${spec.variant || 'primary'}`, spec.label);
        button.type = 'button';
        if (spec.testid) button.dataset.testid = spec.testid;
        if (spec.disabled) button.disabled = true;
        else addScopedDomListener(this, LISTENER_SCOPE, button, 'click', spec.onClick);
        return button;
    }

    /**
     * @private A warning box. It is a box, not a sentence in the flow, because it has to be
     * seen before the click and not read past.
     * @param {string} texto
     * @returns {HTMLElement}
     */
    _warningBox(texto) {
        const box = el('div', 'account-settings__warning');
        box.setAttribute('role', 'note');
        box.appendChild(el('span', 'account-settings__warning-mark', '!'));
        box.appendChild(el('p', 'account-settings__warning-text', texto));
        return box;
    }

    /**
     * @private An inline failure message. A failure NEVER looks like an empty list: it carries
     * its own class, its own colour and `role="alert"`.
     * @param {string} texto
     * @returns {HTMLElement}
     */
    _errorBox(texto) {
        const box = el('div', 'account-settings__state account-settings__state--error', texto);
        box.setAttribute('role', 'alert');
        return box;
    }

    /**
     * @private "Meus dados": what the person may edit, plus what only an administrator changes.
     * @returns {HTMLElement}
     */
    _renderProfileSection() {
        const section = el('section', 'account-settings__section');
        section.dataset.section = 'perfil';
        section.appendChild(this._sectionHeader(
            'Meus dados',
            'O que esta conta guarda sobre você, e o que você mesmo pode mudar.'
        ));

        if (this._loading) {
            section.appendChild(el(
                'div',
                'account-settings__state account-settings__state--loading',
                'Carregando os seus dados...'
            ));
            return section;
        }

        if (this._loadError) {
            section.appendChild(this._errorBox(this._loadError));
            section.appendChild(this._actionButton({
                label: 'Tentar de novo',
                variant: 'ghost',
                testid: 'account-settings-retry',
                onClick: () => this._load(),
            }));
            return section;
        }

        const profile = this._profile || {};
        const identity = this._identity || {};

        const readonly = el('div', 'account-settings__readonly');
        readonly.appendChild(this._readonlyRow('Usuário', profile.username || 'não informado'));

        const badge = globalRoleBadge(identity.role, {
            orgName: organizationName(identity.producer_org_id),
        });
        if (badge) {
            readonly.appendChild(this._readonlyRow(
                'Papel no sistema',
                badge.label,
                getGlobalRoleDescription(identity.role)
            ));
        } else {
            readonly.appendChild(this._readonlyRow(
                'Papel no sistema',
                'não informado pelo servidor'
            ));
        }

        // THE ADDRESS AND ITS STATE, in the read-only block and not in the form below, because
        // it is not editable HERE: it moves through `PUT /users/me/email`, which asks for the
        // password and re-verifies. The state is spelled out rather than implied by a colour,
        // and "não confirmado" is exactly the fact that used to be invisible to the only person
        // able to spot a typo.
        const email = emailPresentation(profile);
        readonly.appendChild(this._readonlyRow(
            'E-mail',
            email.state === 'absent' ? email.status : `${email.address} (${email.status})`,
            email.state === 'unverified' ? EMAIL_UNVERIFIED_HINT : ''
        ));

        readonly.appendChild(this._readonlyRow(
            'Lotação',
            profile.organizacao_militar || 'não informada'
        ));

        if (identity.producer_org_id) {
            const nome = organizationName(identity.producer_org_id);
            readonly.appendChild(this._readonlyRow(
                'OM de produção',
                nome || 'OM fora da lista de ativas',
                'É a OM cujos itens de catálogo e projetos 360 você mantém.'
            ));
        }

        section.appendChild(readonly);
        section.appendChild(el('p', 'account-settings__section-hint', ADMIN_ONLY_FIELDS_NOTE));

        const form = el('div', 'account-settings__form');
        form.appendChild(this._inputField({
            field: 'nome',
            label: 'Nome completo',
            value: profile.nome || '',
            autocomplete: 'name',
            maxLength: MAX_NAME_LENGTH,
        }));
        form.appendChild(this._renderRankField(profile));
        section.appendChild(form);

        if (this._profileError) {
            section.appendChild(this._errorBox(this._profileError));
        }

        const actions = el('div', 'account-settings__actions');
        actions.appendChild(this._actionButton({
            label: this._saving ? 'Salvando...' : 'Salvar alterações',
            disabled: this._saving,
            testid: 'account-settings-save-profile',
            onClick: () => this._saveProfile(),
        }));
        section.appendChild(actions);

        return section;
    }

    /**
     * @private The rank field: a select when the controlled list arrived, a plain notice when it
     * did not. An empty list and a failed config are NOT the same thing, so the notice says the
     * list is unavailable instead of drawing an empty dropdown.
     * @param {Object} profile
     * @returns {HTMLElement}
     */
    _renderRankField(profile) {
        const field = el('div', 'account-settings__field');
        const id = 'account-settings-rank';
        const label = el('label', 'account-settings__label', 'Posto ou graduação');
        label.setAttribute('for', id);
        field.appendChild(label);

        const options = rankOptions();
        if (options.length === 0) {
            field.appendChild(el(
                'p',
                'account-settings__field-note',
                'A lista de postos não veio do servidor, então este campo não pode ser editado agora.'
            ));
            const atual = el(
                'p',
                'account-settings__field-note',
                `Valor atual: ${profile.posto_graduacao || 'não informado'}.`
            );
            field.appendChild(atual);
            return field;
        }

        const select = document.createElement('select');
        select.className = 'account-settings__input';
        select.id = id;
        select.dataset.field = 'rank';
        select.dataset.testid = id;

        const vazio = document.createElement('option');
        vazio.value = '';
        vazio.textContent = 'Não informado';
        select.appendChild(vazio);

        const atualId = profile.rank_id ? String(profile.rank_id) : '';
        let encontrou = false;
        for (const option of options) {
            const node = document.createElement('option');
            node.value = option.value;
            node.textContent = option.label;
            if (option.value === atualId) {
                node.selected = true;
                encontrou = true;
            }
            select.appendChild(node);
        }
        // The rank on the record may be DEACTIVATED, and `config.postos` only serves active
        // rows. Without this branch the select would silently show "Não informado" and a save
        // would clear a value the person never touched.
        if (atualId && !encontrou) {
            const node = document.createElement('option');
            node.value = atualId;
            node.textContent = `${profile.posto_graduacao || 'Posto atual'} (fora de uso)`;
            node.selected = true;
            select.appendChild(node);
        }

        field.appendChild(select);
        return field;
    }

    /**
     * @private "Trocar o e-mail": an invitation to another mailbox, not a write to the account.
     *
     * The section is drawn only once the profile is READ, because the form needs the current
     * address to refuse a no-op change without a round trip, and because a person who cannot see
     * their current e-mail has no business being offered a new one.
     * @returns {HTMLElement}
     */
    _renderEmailSection() {
        const section = el('section', 'account-settings__section');
        section.dataset.section = 'email';
        section.appendChild(this._sectionHeader(
            'Trocar o e-mail',
            'O endereço para onde vão a confirmação da conta e a recuperação de senha.'
        ));

        if (this._loading || this._loadError) {
            // Nothing to say yet, and nothing to offer: the profile section above already reports
            // the loading state and the failure, and repeating either here would just be noise.
            return section;
        }

        const atual = emailPresentation(this._profile || {});
        section.appendChild(this._readonlyRow(
            'E-mail atual',
            atual.state === 'absent' ? atual.status : `${atual.address} (${atual.status})`
        ));
        section.appendChild(this._warningBox(EMAIL_CHANGE_WARNING));

        const form = el('div', 'account-settings__form');
        form.appendChild(this._inputField({
            field: 'email-novo',
            label: 'Novo e-mail',
            type: 'email',
            autocomplete: 'email',
            maxLength: MAX_EMAIL_LENGTH,
        }));
        form.appendChild(this._inputField({
            field: 'email-senha',
            label: 'Senha atual',
            type: 'password',
            autocomplete: 'current-password',
        }));
        section.appendChild(form);
        section.appendChild(el('p', 'account-settings__section-hint', EMAIL_CHANGE_PASSWORD_NOTE));

        if (this._emailError) {
            section.appendChild(this._errorBox(this._emailError));
        }
        if (this._emailDone) {
            const ok = el('div', 'account-settings__state account-settings__state--done', this._emailDone);
            ok.setAttribute('role', 'status');
            section.appendChild(ok);
        }

        const actions = el('div', 'account-settings__actions');
        actions.appendChild(this._actionButton({
            label: this._changingEmail ? 'Enviando...' : 'Enviar confirmação',
            disabled: this._changingEmail,
            testid: 'account-settings-change-email',
            onClick: () => this._changeEmail(),
        }));
        section.appendChild(actions);

        return section;
    }

    /**
     * @private "Trocar a senha": the rule before the attempt, the cost before the click.
     * @returns {HTMLElement}
     */
    _renderPasswordSection() {
        const section = el('section', 'account-settings__section');
        section.dataset.section = 'senha';
        section.appendChild(this._sectionHeader(
            'Trocar a senha',
            'Você precisa da senha atual para definir uma nova.'
        ));

        section.appendChild(el('p', 'account-settings__section-hint', PASSWORD_RULE_TEXT));
        section.appendChild(this._warningBox(PASSWORD_SESSION_WARNING));

        const form = el('div', 'account-settings__form');
        form.appendChild(this._inputField({
            field: 'senha-atual',
            label: 'Senha atual',
            type: 'password',
            autocomplete: 'current-password',
        }));
        form.appendChild(this._inputField({
            field: 'senha-nova',
            label: 'Nova senha',
            type: 'password',
            autocomplete: 'new-password',
            maxLength: 100,
        }));
        form.appendChild(this._inputField({
            field: 'senha-confirma',
            label: 'Confirmar a nova senha',
            type: 'password',
            autocomplete: 'new-password',
            maxLength: 100,
        }));
        section.appendChild(form);

        if (this._passwordError) {
            section.appendChild(this._errorBox(this._passwordError));
        }
        if (this._passwordDone) {
            const ok = el('div', 'account-settings__state account-settings__state--done', this._passwordDone);
            ok.setAttribute('role', 'status');
            section.appendChild(ok);
        }

        const actions = el('div', 'account-settings__actions');
        actions.appendChild(this._actionButton({
            label: this._changingPassword ? 'Trocando...' : 'Trocar a senha',
            variant: 'danger',
            disabled: this._changingPassword,
            testid: 'account-settings-change-password',
            onClick: () => this._changePassword(),
        }));
        section.appendChild(actions);

        return section;
    }

    /**
     * @private "Chave de API": the one-time secret, its cost and its limits.
     * @returns {HTMLElement}
     */
    _renderKeySection() {
        const section = el('section', 'account-settings__section');
        section.dataset.section = 'chave';
        section.appendChild(this._sectionHeader(
            'Chave de API',
            'Credencial para integração de máquina a máquina, fora do navegador.'
        ));

        // No promise the server does not keep: the key IS the whole account, it has no scope and
        // no expiry, and rotating is the only revocation (cláusula 10.7 de CONSTITUICAO.md).
        section.appendChild(el(
            'p',
            'account-settings__section-hint',
            'A chave carrega exatamente as suas permissões, não tem prazo de validade e não tem '
            + 'escopo reduzido. A única forma de invalidá-la é gerar outra. No navegador continue '
            + 'usando o seu login normal.'
        ));
        section.appendChild(el('p', 'account-settings__section-hint', API_KEY_UNKNOWN_STATE_TEXT));
        section.appendChild(this._warningBox(API_KEY_ONE_TIME_WARNING));

        const estado = apiKeySectionState(this._key);

        if (estado === 'error') {
            section.appendChild(this._errorBox(this._key.error));
        }

        if (estado === 'revealed') {
            section.appendChild(this._renderRevealedKey());
        }

        const actions = el('div', 'account-settings__actions');
        actions.appendChild(this._actionButton({
            label: estado === 'rotating' ? 'Gerando...' : 'Gerar chave nova',
            variant: 'danger',
            disabled: estado === 'rotating',
            testid: 'account-settings-rotate-key',
            onClick: () => this._rotateKey(),
        }));
        section.appendChild(actions);

        return section;
    }

    /**
     * @private The block that shows the key. `textContent` only: the key never becomes an
     * attribute value (no `title`, no `value` echoed into the DOM as markup) and never leaves
     * this instance.
     * @returns {HTMLElement}
     */
    _renderRevealedKey() {
        const box = el('div', 'account-settings__key');
        box.dataset.testid = 'account-settings-key-box';

        box.appendChild(el('p', 'account-settings__key-label', 'Sua chave nova'));

        const code = el('code', 'account-settings__key-value', this._key.apiKey);
        code.dataset.testid = 'account-settings-key-value';
        box.appendChild(code);

        const actions = el('div', 'account-settings__key-actions');
        const copy = el('button', 'account-settings__btn account-settings__btn--primary', 'Copiar chave');
        copy.type = 'button';
        copy.dataset.testid = 'account-settings-copy-key';
        addScopedDomListener(this, LISTENER_SCOPE, copy, 'click', () => this._copyKey(copy));
        actions.appendChild(copy);
        box.appendChild(actions);

        const aviso = el('p', 'account-settings__key-warning', API_KEY_COPY_NOW_TEXT);
        aviso.setAttribute('role', 'alert');
        box.appendChild(aviso);

        if (this._key.copied) {
            box.appendChild(el(
                'p',
                'account-settings__key-note',
                'Chave copiada para a área de transferência.'
            ));
        }

        return box;
    }
}

/**
 * Opens the "Minha conta" screen.
 *
 * THE SIGNATURE IS A CONTRACT: no arguments, and the promise resolves when the modal closes.
 * Callers open it by dynamic `import()` so the screen stays out of the eager payload of the
 * pages that never show it.
 * @returns {Promise<void>} Resolves when the person closes the modal.
 */
export function showAccountSettingsModal() {
    return new Promise((resolve) => {
        const modal = new AccountSettingsModal({ onClosed: resolve });
        modal.render();
        modal.show();
    });
}

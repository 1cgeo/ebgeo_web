// Path: js/modals/create-atlas.modal.js

/**
 * @fileoverview Create-atlas modal with inline sharing options (§item5).
 *
 * Collects a new atlas NAME plus optional sharing intent BEFORE the atlas exists:
 *   - Public link: a switch; when on, the created atlas is made public (read).
 *   - Add people: a debounced user search; picked users are staged locally with a
 *     read/write permission.
 *
 * Because there is no atlasId yet, sharing is staged locally and handed to the caller via
 * onCreate(name, { isPublic, members }); the caller creates the atlas and applies the public
 * link + member shares against the backend (owner-only routes the creator satisfies). Reuses
 * the sharing-modal CSS (`sharing-*`) so it needs no new styles.
 *
 * Exports {@link showCreateAtlasModal}.
 */

import { ModalBase } from './modal.base.js';
import {
    addScopedDomListener,
    clearScopedListeners,
    trackTimer,
} from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { apiClient } from '@store/sync/api-client.js';

/** Debounce (ms) for the user-search input. */
const SEARCH_DEBOUNCE_MS = 300;
/** Minimum query length the backend accepts for user search. */
const SEARCH_MIN_CHARS = 2;
/** Default permission staged when a searched user is picked. */
const DEFAULT_GRANT_PERMISSION = 'write';
/** Grantable permission levels (pt-BR labels) — mirrors sharing.modal.js. */
const PERMISSION_LEVELS = [
    { value: 'read', label: 'Leitura' },
    { value: 'comment', label: 'Comentário' },
    { value: 'write', label: 'Edição' },
    { value: 'manage', label: 'Gestão' },
];

/** Static SVG icons (currentColor). */
const ICONS = {
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    remove: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

/**
 * Create-atlas modal class.
 * @extends ModalBase
 */
export class CreateAtlasModal extends ModalBase {
    /**
     * @param {Object} [options]
     * @param {Function} [options.onCreate] - Called with (name, { isPublic, members }); returns
     *   a Promise (resolve closes the modal, reject keeps it open).
     */
    constructor({ onCreate, defaultName = '' } = {}) {
        super({
            id: 'create-atlas-modal',
            title: 'Novo atlas',
            icon: ICONS.folder,
            destroyOnHide: true,
        });
        this._onCreate = typeof onCreate === 'function' ? onCreate : null;
        /** Nome sugerido. Enviar um atlas local ao servidor ja sabe como ele se chama, e fazer a
         *  pessoa digitar de novo o nome que esta na tela e trabalho que a tela podia poupar. */
        this._defaultName = typeof defaultName === 'string' ? defaultName : '';
        /** @type {boolean} */
        this._isPublic = false;
        /** @type {Array<{userId:string, username:string, nome:string, permission:string}>} */
        this._members = [];
        /** @type {boolean} Network/submit-in-flight guard. */
        this._busy = false;
        /** @type {number|null} */
        this._searchTimer = null;
        /** @type {number} Monotonic token to drop stale search responses. */
        this._searchSeq = 0;
    }

    /**
     * Renders the modal shell + body.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'create-atlas-modal';
        this.getContainer().classList.add('sharing-modal-container');

        const body = this.getBody();
        body.innerHTML = this._renderBodyHtml();
        this._setupListeners();

        document.body.appendChild(overlay);
        return overlay;
    }

    // ===== RENDER =====

    /** @private */
    _renderBodyHtml() {
        return `
            <div class="sharing">
                <section class="sharing-section">
                    <div class="settings-field">
                        <label class="settings-field__label" for="create-atlas-name">Nome do atlas</label>
                        <div class="sharing-search">
                            <input type="text" id="create-atlas-name" class="sharing-search__input"
                                   data-action="name" data-testid="create-atlas-name"
                                   placeholder="Ex.: Operação Fronteira" autocomplete="off" maxlength="120"
                                   aria-label="Nome do atlas">
                        </div>
                    </div>
                </section>
                ${this._renderPublicSection()}
                ${this._renderMembersSection()}
                ${this._renderAddSection()}
                <div class="project-picker__actions">
                    <button type="button" class="prompt-modal-btn prompt-modal-btn-cancel"
                            data-action="cancel" data-testid="create-atlas-cancel">Cancelar</button>
                    <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm"
                            data-action="confirm" data-testid="create-atlas-confirm">Criar</button>
                </div>
            </div>
        `;
    }

    /** @private */
    _renderPublicSection() {
        return `
            <section class="sharing-section">
                <div class="settings-field">
                    <div class="sharing-toggle-row">
                        <div class="sharing-toggle-row__text">
                            <span class="settings-field__label">Link público</span>
                            <span class="settings-field__description">
                                Qualquer pessoa com o link pode visualizar este atlas, sem precisar entrar.
                            </span>
                        </div>
                        <button type="button" role="switch"
                                class="sharing-switch${this._isPublic ? ' sharing-switch--on' : ''}"
                                aria-checked="${this._isPublic ? 'true' : 'false'}"
                                aria-label="Ativar link público"
                                data-action="toggle-public" data-testid="create-atlas-public-toggle">
                            <span class="sharing-switch__thumb" aria-hidden="true"></span>
                        </button>
                    </div>
                </div>
            </section>
        `;
    }

    /** @private */
    _renderMembersSection() {
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Membros</h3>
                <div class="sharing-members" data-members>
                    ${this._renderMembersInner()}
                </div>
            </section>
        `;
    }

    /** @private */
    _renderMembersInner() {
        if (!this._members.length) {
            return '<div class="sharing__empty">Ninguém ainda</div>';
        }
        return this._members.map((m) => this._renderMemberItem(m)).join('');
    }

    /**
     * @private
     * @param {{userId:string, username:string, nome:string, permission:string}} member
     */
    _renderMemberItem(member) {
        const userId = String(member?.userId ?? '');
        const nome = member?.nome ?? member?.username ?? '';
        const username = member?.username ?? '';
        const current = PERMISSION_LEVELS.some((p) => p.value === member?.permission) ? member.permission : 'write';
        const color = escapeHtml(getPresenceColor(userId));
        const initials = escapeHtml(getInitials(nome));
        const options = PERMISSION_LEVELS.map((p) =>
            `<option value="${p.value}"${current === p.value ? ' selected' : ''}>${p.label}</option>`
        ).join('');
        return `
            <div class="sharing-member" data-user-id="${escapeHtml(userId)}">
                <span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                    <span class="sharing-member__username">@${escapeHtml(username)}</span>
                </div>
                <select class="sharing-member__permission" data-action="permission"
                        aria-label="Permissão de ${escapeHtml(nome)}">
                    ${options}
                </select>
                <button type="button" class="sharing-member__remove" data-action="remove"
                        aria-label="Remover ${escapeHtml(nome)}">${ICONS.remove}</button>
            </div>
        `;
    }

    /** @private */
    _renderAddSection() {
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Adicionar pessoas</h3>
                <div class="sharing-search">
                    <span class="sharing-search__icon" aria-hidden="true">${ICONS.search}</span>
                    <input type="text" class="sharing-search__input" data-action="search"
                           data-testid="create-atlas-user-search" placeholder="Buscar por nome ou usuário…"
                           autocomplete="off" aria-label="Buscar pessoas">
                </div>
                <div class="sharing-results" data-results hidden></div>
            </section>
        `;
    }

    /**
     * @private
     * @param {Array<{id:string, username:string, nome:string}>} results
     */
    _renderResults(results) {
        const memberIds = new Set(this._members.map((m) => String(m.userId)));
        const pickable = results.filter((u) => !memberIds.has(String(u?.id)));
        if (!results.length) return '<div class="sharing-results__empty">Nenhum usuário encontrado</div>';
        if (!pickable.length) return '<div class="sharing-results__empty">Todos já adicionados</div>';

        return pickable.map((u) => {
            const id = String(u?.id ?? '');
            const nome = u?.nome ?? u?.username ?? '';
            const username = u?.username ?? '';
            const color = escapeHtml(getPresenceColor(id));
            const initials = escapeHtml(getInitials(nome));
            return `
                <button type="button" class="sharing-result" data-action="add"
                        data-user-id="${escapeHtml(id)}" data-username="${escapeHtml(username)}"
                        data-nome="${escapeHtml(nome)}">
                    <span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>
                    <span class="sharing-result__info">
                        <span class="sharing-member__name">${escapeHtml(nome)}</span>
                        <span class="sharing-member__username">@${escapeHtml(username)}</span>
                    </span>
                </button>
            `;
        }).join('');
    }

    // ===== LISTENERS =====

    /** @private */
    _setupListeners() {
        const body = this.getBody();

        const cancel = body.querySelector('[data-action="cancel"]');
        if (cancel) addScopedDomListener(this, 'body', cancel, 'click', () => this.hide());

        const confirm = body.querySelector('[data-action="confirm"]');
        if (confirm) addScopedDomListener(this, 'body', confirm, 'click', () => this._handleCreate());

        const toggle = body.querySelector('[data-action="toggle-public"]');
        if (toggle) addScopedDomListener(this, 'body', toggle, 'click', () => this._handleTogglePublic());

        const search = body.querySelector('[data-action="search"]');
        if (search) addScopedDomListener(this, 'body', search, 'input', () => this._handleSearchInput(search.value));

        const nameInput = body.querySelector('[data-action="name"]');
        if (nameInput) {
            addScopedDomListener(this, 'body', nameInput, 'keydown', (e) => {
                if (e.key === 'Enter') this._handleCreate();
            });
            if (this._defaultName) {
                nameInput.value = this._defaultName;
                // Selecionado, nao so preenchido: aceitar e Enter, e trocar e digitar por cima.
                nameInput.select();
            }
            nameInput.focus();
        }

        this._wireMemberRows();
    }

    /** @private Wires the (re-rendered) member rows via the clearable 'members' scope. */
    _wireMemberRows() {
        const body = this.getBody();
        clearScopedListeners(this, 'members');
        body.querySelectorAll('.sharing-member').forEach((row) => {
            const userId = row.dataset.userId;
            const select = row.querySelector('[data-action="permission"]');
            if (select) {
                addScopedDomListener(this, 'members', select, 'change', () =>
                    this._setMemberPermission(userId, select.value));
            }
            const remove = row.querySelector('[data-action="remove"]');
            if (remove) {
                addScopedDomListener(this, 'members', remove, 'click', () => this._removeMember(userId));
            }
        });
    }

    /** @private Re-renders only the members list and re-wires its rows. */
    _refreshMembers() {
        const container = this.getBody()?.querySelector('[data-members]');
        if (!container) return;
        container.innerHTML = this._renderMembersInner();
        this._wireMemberRows();
    }

    // ===== HANDLERS =====

    /** @private */
    _handleTogglePublic() {
        this._isPublic = !this._isPublic;
        const toggle = this.getBody()?.querySelector('[data-action="toggle-public"]');
        if (toggle) {
            toggle.classList.toggle('sharing-switch--on', this._isPublic);
            toggle.setAttribute('aria-checked', this._isPublic ? 'true' : 'false');
        }
    }

    /**
     * @private
     * @param {string} userId
     * @param {'read'|'comment'|'write'|'manage'} permission
     */
    _setMemberPermission(userId, permission) {
        const member = this._members.find((m) => String(m.userId) === String(userId));
        if (member) member.permission = PERMISSION_LEVELS.some((p) => p.value === permission) ? permission : 'write';
    }

    /**
     * @private
     * @param {string} userId
     */
    _removeMember(userId) {
        this._members = this._members.filter((m) => String(m.userId) !== String(userId));
        this._refreshMembers();
    }

    /**
     * @private Stages a searched user as a member (default Edição) and resets the search.
     * @param {string} userId
     * @param {string} username
     * @param {string} nome
     */
    _addMember(userId, username, nome) {
        if (!userId || this._members.some((m) => String(m.userId) === String(userId))) return;
        this._members.push({ userId, username, nome, permission: DEFAULT_GRANT_PERMISSION });
        this._refreshMembers();

        const input = this.getBody()?.querySelector('[data-action="search"]');
        if (input) input.value = '';
        this._searchSeq++; // invalidate any in-flight search
        this._renderResultsInto([]);
        this._setResultsHidden(true);
    }

    /**
     * @private Debounces the user-search query; short queries clear the results.
     * @param {string} value
     */
    _handleSearchInput(value) {
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
        const q = value.trim();
        if (q.length < SEARCH_MIN_CHARS) {
            this._renderResultsInto([]);
            this._setResultsHidden(true);
            return;
        }
        const timer = setTimeout(() => this._runSearch(q), SEARCH_DEBOUNCE_MS);
        this._searchTimer = timer;
        trackTimer(this, timer, 'timeout');
    }

    /**
     * @private Performs the search and renders results, dropping stale responses.
     * @param {string} q
     */
    async _runSearch(q) {
        const seq = ++this._searchSeq;
        try {
            const results = await apiClient.searchUsers(q);
            if (seq !== this._searchSeq) return;
            this._renderResultsInto(Array.isArray(results) ? results : []);
            this._setResultsHidden(false);
        } catch {
            if (seq !== this._searchSeq) return;
            this._renderResultsInto([]);
            this._setResultsHidden(false);
        }
    }

    /**
     * @private Renders results into the container and wires the add buttons.
     * @param {Array} results
     */
    _renderResultsInto(results) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        clearScopedListeners(this, 'results');
        container.innerHTML = results.length ? this._renderResults(results) : '';
        container.querySelectorAll('[data-action="add"]').forEach((btn) => {
            addScopedDomListener(this, 'results', btn, 'click', () =>
                this._addMember(btn.dataset.userId, btn.dataset.username, btn.dataset.nome));
        });
    }

    /** @private */
    _setResultsHidden(hidden) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (container) container.hidden = hidden;
    }

    /** @private Validates the name and hands the staged result to the caller. */
    async _handleCreate() {
        if (this._busy || !this._onCreate) return;
        const nameInput = this.getBody()?.querySelector('[data-action="name"]');
        const name = (nameInput?.value || '').trim();
        if (!name) {
            nameInput?.focus();
            return;
        }
        this._busy = true;
        try {
            await this._onCreate(name, { isPublic: this._isPublic, members: this._members.slice() });
            this.hide();
        } catch {
            this._busy = false; // keep the dialog open on failure
        }
    }

    /** Hides the modal, clearing scoped listeners + the search timer first. */
    hide() {
        clearScopedListeners(this, 'body');
        clearScopedListeners(this, 'members');
        clearScopedListeners(this, 'results');
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
        super.hide();
    }
}

/**
 * Shows the create-atlas modal.
 * @param {Object} [options] - See {@link CreateAtlasModal} constructor.
 * @returns {CreateAtlasModal} The modal instance.
 */
export function showCreateAtlasModal(options = {}) {
    const modal = new CreateAtlasModal(options);
    modal.render();
    modal.show();
    return modal;
}

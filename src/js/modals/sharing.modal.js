// Path: js/modals/sharing.modal.js

/**
 * @fileoverview Atlas sharing modal.
 *
 * Lets the atlas OWNER manage who can see/edit a project:
 *   - Public link: a toggle that enables/disables an anonymous read link, with a
 *     copy-to-clipboard affordance.
 *   - Members: the list of users the atlas is shared with, each with a permission
 *     select (Leitura/Edição → read/write) and a destructive remove button.
 *   - Add people: a debounced user search; picking a result grants 'write' by default.
 *
 * The modal is standalone — it receives an `atlasId` and talks to the backend via
 * `apiClient` (sharing/searchUsers REST routes). The caller decides whether to show
 * it (the backend also enforces owner-only on every mutation). All mutations re-read
 * the canonical sharing config so the UI never drifts from the server.
 *
 * Exports {@link showSharingModal}.
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
import { showError, showSuccess } from '@utils/toast_service.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showConfirm } from '@modals/index.js';

/** Debounce (ms) for the user-search input. */
const SEARCH_DEBOUNCE_MS = 300;
/** Minimum query length the backend accepts for user search. */
const SEARCH_MIN_CHARS = 2;
/** How long the "Copiado" feedback stays on the copy button. */
const COPY_FEEDBACK_MS = 1800;
/** Default permission granted when a searched user is picked. */
const DEFAULT_GRANT_PERMISSION = 'write';
/** Permission levels offered in the member dropdown (pt-BR labels, ascending access). */
const PERMISSION_LEVELS = [
    { value: 'read', label: 'Leitura' },
    { value: 'comment', label: 'Comentário' },
    { value: 'write', label: 'Edição' },
    { value: 'manage', label: 'Gestão' },
];

/**
 * Icons used by the modal (inline SVG, currentColor).
 */
const ICONS = {
    share: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>`,
    link: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    remove: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`,
};

/**
 * Sharing modal class.
 * @extends ModalBase
 */
export class SharingModal extends ModalBase {
    /**
     * @param {string} atlasId - Atlas to manage sharing for.
     * @param {Object} [options]
     * @param {string} [options.atlasName] - Display name for the header title.
     */
    constructor(atlasId, { atlasName } = {}) {
        const name = atlasName ? String(atlasName) : '';
        super({
            id: 'sharing-modal',
            title: name ? `Compartilhar ${name}` : 'Compartilhar',
            icon: ICONS.share,
            destroyOnHide: true,
        });

        this._atlasId = atlasId;
        /** @type {boolean} */
        this._isPublic = false;
        /** @type {string|null} */
        this._publicLink = null;
        /** @type {Array<{userId:string, username:string, nome:string, permission:string}>} */
        this._shares = [];
        /** @type {{userId:string, username:string, nome:string}|null} The atlas owner (badge + transfer). */
        this._owner = null;
        /** @type {boolean} Network-in-flight guard (one mutation at a time). */
        this._busy = false;
        /** @type {number|null} Pending debounced-search timer id. */
        this._searchTimer = null;
        /** @type {number} Monotonic token so out-of-order search responses are dropped. */
        this._searchSeq = 0;
    }

    /**
     * Renders the modal shell and kicks off the initial load.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'sharing-modal';
        this.getContainer().classList.add('sharing-modal-container');

        const body = this.getBody();
        body.innerHTML = this._renderLoading();

        document.body.appendChild(overlay);

        // Fire-and-forget initial fetch (loading state already shown).
        this._load();

        return overlay;
    }

    // ===== DATA =====

    /** @private Fetches the sharing config and (re)renders the body. */
    async _load() {
        try {
            const cfg = await apiClient.getSharing(this._atlasId);
            this._isPublic = Boolean(cfg?.isPublic);
            this._publicLink = cfg?.publicLink ?? null;
            this._owner = cfg?.owner ?? null;
            this._shares = Array.isArray(cfg?.shares) ? cfg.shares : [];
            this._renderBody();
        } catch {
            this._renderError();
        }
    }

    // ===== RENDER =====

    /** @private */
    _renderLoading() {
        return `
            <div class="sharing__state" data-testid="sharing-loading">
                <span class="sharing__spinner" aria-hidden="true"></span>
                <span>Carregando…</span>
            </div>
        `;
    }

    /** @private Renders the error state (with a retry button) into the body. */
    _renderError() {
        clearScopedListeners(this, 'body');
        const body = this.getBody();
        body.innerHTML = `
            <div class="sharing__state sharing__state--error" data-testid="sharing-error">
                <p>Não foi possível carregar o compartilhamento.</p>
                <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm" data-action="retry">
                    Tentar novamente
                </button>
            </div>
        `;
        const retry = body.querySelector('[data-action="retry"]');
        if (retry) {
            addScopedDomListener(this, 'body', retry, 'click', () => {
                body.innerHTML = this._renderLoading();
                this._load();
            });
        }
    }

    /** @private Renders the full body (public + members + add) and wires listeners. */
    _renderBody() {
        clearScopedListeners(this, 'body');
        const body = this.getBody();
        body.innerHTML = `
            <div class="sharing">
                ${this._renderPublicSection()}
                ${this._renderMembersSection()}
                ${this._renderAddSection()}
            </div>
        `;
        this._setupBodyListeners();
    }

    /** @private */
    _renderPublicSection() {
        const linkRow = this._isPublic
            ? `
                <div class="sharing-link" data-testid="sharing-public-link-row">
                    <span class="sharing-link__icon" aria-hidden="true">${ICONS.link}</span>
                    <input type="text" class="sharing-link__input" data-testid="sharing-public-link"
                           value="${escapeHtml(this._publicLink ?? '')}" readonly aria-label="Link público">
                    <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm sharing-link__copy"
                            data-action="copy" data-testid="sharing-copy-link">
                        ${ICONS.copy}<span>Copiar</span>
                    </button>
                </div>
            `
            : '';

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
                                data-action="toggle-public" data-testid="sharing-public-toggle">
                            <span class="sharing-switch__thumb" aria-hidden="true"></span>
                        </button>
                    </div>
                    ${linkRow}
                </div>
            </section>
        `;
    }

    /** @private */
    _renderMembersSection() {
        const ownerRow = this._owner ? this._renderOwnerItem(this._owner) : '';
        const shareRows = this._shares.length
            ? this._shares.map((s) => this._renderMemberItem(s)).join('')
            : (this._owner ? '' : this._renderEmptyMembers());
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Membros</h3>
                <div class="sharing-members">
                    ${ownerRow}
                    ${shareRows}
                </div>
            </section>
        `;
    }

    /**
     * @private Renders the atlas owner row (read-only — a "(dono)" badge, no controls).
     * @param {{userId:string, username:string, nome:string}} owner
     */
    _renderOwnerItem(owner) {
        const userId = String(owner?.userId ?? '');
        const nome = owner?.nome ?? owner?.username ?? '';
        const username = owner?.username ?? '';
        const color = escapeHtml(getPresenceColor(userId));
        const initials = escapeHtml(getInitials(nome));
        return `
            <div class="sharing-member" data-testid="sharing-owner-item">
                <span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                    <span class="sharing-member__username">@${escapeHtml(username)}</span>
                </div>
                <span class="sharing-member__owner-badge">Gestor (dono)</span>
            </div>
        `;
    }

    /** @private */
    _renderEmptyMembers() {
        return `
            <div class="sharing__empty" data-testid="sharing-empty">
                Ninguém ainda
            </div>
        `;
    }

    /**
     * @private
     * @param {{userId:string, username:string, nome:string, permission:string}} share
     */
    _renderMemberItem(share) {
        const userId = String(share?.userId ?? '');
        const nome = share?.nome ?? share?.username ?? '';
        const username = share?.username ?? '';
        const current = PERMISSION_LEVELS.some((p) => p.value === share?.permission) ? share.permission : 'read';
        const color = escapeHtml(getPresenceColor(userId));
        const initials = escapeHtml(getInitials(nome));
        const options = PERMISSION_LEVELS.map((p) =>
            `<option value="${p.value}"${current === p.value ? ' selected' : ''}>${p.label}</option>`
        ).join('');
        // Only the current owner may hand ownership to a member.
        const transferBtn = sessionContext.role === 'owner'
            ? `<button type="button" class="sharing-member__transfer" data-action="transfer"
                        data-testid="sharing-member-transfer" aria-label="Tornar ${escapeHtml(nome)} o dono">Tornar dono</button>`
            : '';

        return `
            <div class="sharing-member" data-testid="sharing-member-item" data-user-id="${escapeHtml(userId)}">
                <span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                    <span class="sharing-member__username">@${escapeHtml(username)}</span>
                </div>
                ${transferBtn}
                <select class="sharing-member__permission" data-action="permission"
                        data-testid="sharing-member-permission" aria-label="Permissão de ${escapeHtml(nome)}">
                    ${options}
                </select>
                <button type="button" class="sharing-member__remove" data-action="remove"
                        data-testid="sharing-member-remove" aria-label="Remover ${escapeHtml(nome)}">
                    ${ICONS.remove}
                </button>
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
                           data-testid="sharing-user-search" placeholder="Buscar por nome ou usuário…"
                           autocomplete="off" aria-label="Buscar pessoas">
                </div>
                <div class="sharing-results" data-results hidden></div>
            </section>
        `;
    }

    /**
     * @private
     * @param {Array<{id:string, username:string, nome:string, posto_graduacao?:string, organizacao_militar?:string}>} results
     */
    _renderResults(results) {
        const memberIds = new Set(this._shares.map((s) => String(s.userId)));
        const pickable = results.filter((u) => !memberIds.has(String(u?.id)));

        if (!results.length) {
            return '<div class="sharing-results__empty">Nenhum usuário encontrado</div>';
        }
        if (!pickable.length) {
            return '<div class="sharing-results__empty">Todos já são membros</div>';
        }

        return pickable.map((u) => {
            const id = String(u?.id ?? '');
            const nome = u?.nome ?? u?.username ?? '';
            const username = u?.username ?? '';
            const color = escapeHtml(getPresenceColor(id));
            const initials = escapeHtml(getInitials(nome));
            return `
                <button type="button" class="sharing-result" data-action="add"
                        data-testid="sharing-search-result" data-user-id="${escapeHtml(id)}">
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

    /** @private Wires the (re-rendered) body's controls via the clearable 'body' scope. */
    _setupBodyListeners() {
        const body = this.getBody();

        const toggle = body.querySelector('[data-action="toggle-public"]');
        if (toggle) {
            addScopedDomListener(this, 'body', toggle, 'click', () => this._handleTogglePublic());
        }

        const copy = body.querySelector('[data-action="copy"]');
        if (copy) {
            addScopedDomListener(this, 'body', copy, 'click', () => this._handleCopyLink(copy));
        }

        body.querySelectorAll('.sharing-member').forEach((row) => {
            const userId = row.dataset.userId;
            const select = row.querySelector('[data-action="permission"]');
            if (select) {
                addScopedDomListener(this, 'body', select, 'change', () =>
                    this._handleChangePermission(userId, select.value));
            }
            const remove = row.querySelector('[data-action="remove"]');
            if (remove) {
                addScopedDomListener(this, 'body', remove, 'click', () =>
                    this._handleRemove(userId));
            }
            const transfer = row.querySelector('[data-action="transfer"]');
            if (transfer) {
                const nome = row.querySelector('.sharing-member__name')?.textContent ?? '';
                addScopedDomListener(this, 'body', transfer, 'click', () =>
                    this._handleTransfer(userId, nome));
            }
        });

        const searchInput = body.querySelector('[data-action="search"]');
        if (searchInput) {
            addScopedDomListener(this, 'body', searchInput, 'input', () =>
                this._handleSearchInput(searchInput.value));
        }
    }

    // ===== HANDLERS =====

    /** @private Enables/disables public sharing, then re-reads the config. */
    async _handleTogglePublic() {
        if (this._busy) return;
        this._busy = true;
        const next = !this._isPublic;
        try {
            if (next) {
                await apiClient.enablePublicSharing(this._atlasId);
            } else {
                await apiClient.disablePublicSharing(this._atlasId);
            }
            await this._load();
        } catch {
            showError('Não foi possível atualizar o link público.');
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Copies the public link to the clipboard with inline feedback.
     * @param {HTMLElement} btn - The copy button (for the transient label swap).
     */
    async _handleCopyLink(btn) {
        const link = this._publicLink;
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            this._flashCopied(btn);
        } catch {
            showError('Não foi possível copiar o link.');
        }
    }

    /**
     * @private Briefly shows a "Copiado" confirmation on the copy button.
     * @param {HTMLElement} btn
     */
    _flashCopied(btn) {
        btn.classList.add('copied');
        btn.innerHTML = `${ICONS.check}<span>Copiado</span>`;
        const timer = setTimeout(() => {
            if (!btn.isConnected) return;
            btn.classList.remove('copied');
            btn.innerHTML = `${ICONS.copy}<span>Copiar</span>`;
        }, COPY_FEEDBACK_MS);
        trackTimer(this, timer, 'timeout');
    }

    /**
     * @private Updates a member's permission, then re-reads the config.
     * @param {string} userId
     * @param {'read'|'write'} permission
     */
    async _handleChangePermission(userId, permission) {
        if (this._busy || !userId) return;
        this._busy = true;
        try {
            await apiClient.updateShare(this._atlasId, userId, permission);
            await this._load();
        } catch {
            showError('Não foi possível alterar a permissão.');
            await this._load(); // resync the select to the server's truth
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Revokes a member's access, then re-reads the config.
     * @param {string} userId
     */
    async _handleRemove(userId) {
        if (this._busy || !userId) return;
        this._busy = true;
        try {
            await apiClient.removeShare(this._atlasId, userId);
            await this._load();
        } catch {
            showError('Não foi possível remover o membro.');
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Transfers ownership to a member (owner-only). After a confirmation, calls the API
     * and re-reads the config. The current user stops being the owner (becomes a Gestor); the WS
     * `atlas_owner_changed` broadcast re-gates the rest of the UI.
     * @param {string} userId
     * @param {string} nome - Display name for the confirmation copy.
     */
    async _handleTransfer(userId, nome) {
        if (this._busy || !userId) return;
        const ok = await showConfirm(
            `Tornar ${nome || 'este membro'} o novo dono do projeto? Você deixará de ser o dono e passará a Gestor.`,
            { destructive: true, confirmText: 'Transferir' }
        );
        if (!ok) return;
        this._busy = true;
        try {
            await apiClient.transferOwnership(this._atlasId, userId);
            showSuccess('Propriedade transferida.');
            await this._load();
        } catch {
            showError('Não foi possível transferir a propriedade.');
        } finally {
            this._busy = false;
        }
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
            if (seq !== this._searchSeq) return; // a newer query superseded this one
            const list = Array.isArray(results) ? results : [];
            this._renderResultsInto(list);
            this._setResultsHidden(false);
        } catch {
            if (seq !== this._searchSeq) return;
            this._renderResultsInto([]);
            this._setResultsHidden(false);
        }
    }

    /**
     * @private Renders results HTML into the container and wires the add buttons.
     * @param {Array} results
     */
    _renderResultsInto(results) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        clearScopedListeners(this, 'results');
        container.innerHTML = results.length ? this._renderResults(results) : '';
        container.querySelectorAll('[data-action="add"]').forEach((btn) => {
            addScopedDomListener(this, 'results', btn, 'click', () =>
                this._handleAdd(btn.dataset.userId));
        });
    }

    /** @private */
    _setResultsHidden(hidden) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        container.hidden = hidden;
    }

    /**
     * @private Grants a searched user write access, clears the search, re-reads config.
     * @param {string} userId
     */
    async _handleAdd(userId) {
        if (this._busy || !userId) return;
        // Guard against double-adding someone already a member.
        if (this._shares.some((s) => String(s.userId) === String(userId))) return;
        this._busy = true;
        try {
            await apiClient.addShare(this._atlasId, userId, DEFAULT_GRANT_PERMISSION);
            this._searchSeq++; // invalidate any in-flight search
            await this._load();
            // Reset the search UI after a successful add.
            const input = this.getBody()?.querySelector('[data-action="search"]');
            if (input) input.value = '';
            this._renderResultsInto([]);
            this._setResultsHidden(true);
        } catch {
            showError('Não foi possível adicionar a pessoa.');
        } finally {
            this._busy = false;
        }
    }

    /**
     * Hides the modal, clearing scoped listeners first.
     */
    hide() {
        clearScopedListeners(this, 'body');
        clearScopedListeners(this, 'results');
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
        super.hide();
    }
}

/**
 * Shows the atlas sharing modal.
 *
 * The caller is responsible for deciding whether to offer sharing (owner-only);
 * the backend independently enforces owner-only on every mutation.
 *
 * @param {string} atlasId - Atlas to manage sharing for.
 * @param {Object} [options]
 * @param {string} [options.atlasName] - Display name shown in the header title.
 * @returns {SharingModal} The modal instance.
 */
export function showSharingModal(atlasId, options = {}) {
    const modal = new SharingModal(atlasId, options);
    modal.render();
    modal.show();
    return modal;
}

// Path: js/modals/project-picker.modal.js

/**
 * @fileoverview Project picker modal.
 * Lists backend atlas projects as clickable rows and optionally allows
 * creating a new project. Used by the account orchestrator after login.
 */

import { ModalBase } from './modal.base.js';
import { PromptModal } from './prompt.modal.js';
import { addDomListener, addScopedDomListener, clearScopedListeners } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';

/**
 * Icons used in the modal.
 */
const ICONS = {
    folder: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>`,
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>`,
    globe: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`
};

/**
 * Permission chip labels (Google-Docs-style role tags), keyed by the backend's
 * `user_permission` value. Unknown/missing permissions render no chip.
 */
const PERMISSION_LABELS = Object.freeze({
    owner: 'Proprietário',
    write: 'Edição',
    read: 'Leitura'
});

/** Relative-time formatter (pt-BR, "há 2 dias" / "ontem" style). */
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/**
 * Formats an ISO/parseable timestamp as a pt-BR relative phrase ("há 2 dias",
 * "há 5 minutos"). Falls back to an absolute short date for spans of a week or
 * more, and returns '' for missing/unparseable input (caller omits the part).
 * @param {string|number|Date} [value] - The `updated_at` value.
 * @returns {string} Relative phrase, or '' when undeterminable.
 */
function formatRelativeTime(value) {
    if (value == null || value === '') return '';
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return '';

    const diffMs = then - Date.now();
    const diffSec = Math.round(diffMs / 1000);
    const absSec = Math.abs(diffSec);

    const MIN = 60;
    const HOUR = 3600;
    const DAY = 86400;

    if (absSec < MIN) return RELATIVE_TIME_FORMAT.format(diffSec, 'second');
    if (absSec < HOUR) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / MIN), 'minute');
    if (absSec < DAY) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / HOUR), 'hour');
    if (absSec < DAY * 7) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / DAY), 'day');

    // A week or more out: an absolute short date reads better than "há 12 dias".
    return new Date(then).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

/**
 * Project picker modal class.
 * @extends ModalBase
 */
export class ProjectPickerModal extends ModalBase {
    /**
     * @param {Object} options - Modal options
     * @param {Array<{id:string, name:string, owner_nome?:string, updated_at?:string,
     *   user_permission?:('owner'|'write'|'read'), is_public?:boolean}>} [options.projects]
     *   Atlas records (as returned by `apiClient.listAtlas()`) to list.
     * @param {Function} options.onPick - Called with the picked atlas id; returns a Promise
     *   (resolve closes the modal).
     * @param {Function} [options.onCreate] - Optional; called with a new project name when the
     *   "Novo projeto" button is used; returns a Promise (resolve closes the modal).
     */
    constructor(options = {}) {
        super({
            id: 'project-picker-modal',
            title: 'Abrir do servidor',
            icon: ICONS.folder,
            destroyOnHide: true
        });

        this._projects = Array.isArray(options.projects) ? options.projects : [];
        this._onPick = options.onPick || (() => Promise.resolve());
        this._onCreate = typeof options.onCreate === 'function' ? options.onCreate : null;
        this._busy = false;
    }

    /**
     * Renders the modal content.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'project-picker-modal';

        const body = this.getBody();
        body.innerHTML = this._createBodyContent();

        this._setupListeners();

        document.body.appendChild(overlay);
        return overlay;
    }

    /**
     * Creates the body content HTML.
     * @private
     * @returns {string}
     */
    _createBodyContent() {
        return `
            <div class="project-picker">
                <div class="project-picker__list" role="listbox" aria-label="Projetos do servidor">
                    ${this._renderProjectsList()}
                </div>
                ${this._renderActions()}
            </div>
        `;
    }

    /**
     * Renders the projects list HTML.
     * @private
     * @returns {string}
     */
    _renderProjectsList() {
        if (this._projects.length === 0) {
            return `
                <div class="project-picker__empty">
                    Nenhum projeto disponível no servidor
                </div>
            `;
        }

        return this._projects.map((project) => this._renderProjectItem(project)).join('');
    }

    /**
     * Renders a single project row, Google-Docs style: avatar + name, a subtitle
     * line with author and last-modified time, an optional "Público" badge, and a
     * permission chip on the right.
     * @private
     * @param {Object} project - Atlas record from `apiClient.listAtlas()`.
     * @returns {string}
     */
    _renderProjectItem(project) {
        const rawId = String(project?.id ?? '');
        const id = escapeHtml(rawId);
        const name = escapeHtml(project?.name ?? '');
        // Avatar with the atlas initials on a stable per-atlas color (same
        // palette used for presence), keyed on the atlas id so the badge
        // hue is recognizable and consistent for a given project.
        const initials = escapeHtml(getInitials(project?.name ?? ''));
        const color = escapeHtml(getPresenceColor(rawId));

        const permission = project?.user_permission;
        const subtitle = this._buildSubtitle(project);
        const publicBadge = project?.is_public
            ? `<span class="project-picker__public" title="Compartilhado por link público">
                   ${ICONS.globe}<span>Público</span>
               </span>`
            : '';
        const permissionChip = PERMISSION_LABELS[permission]
            ? `<span class="project-picker__chip project-picker__chip--${escapeHtml(permission)}">
                   ${escapeHtml(PERMISSION_LABELS[permission])}
               </span>`
            : '';
        const ariaLabel = escapeHtml(
            subtitle.text ? `${project?.name ?? ''} — ${subtitle.plain}` : (project?.name ?? '')
        );

        return `
            <button type="button" class="project-picker__item" role="option"
                    data-testid="project-picker-item" data-atlas-id="${id}"
                    aria-label="${ariaLabel}">
                <span class="project-picker__badge" aria-hidden="true"
                      style="background-color: ${color};">${initials}</span>
                <span class="project-picker__main">
                    <span class="project-picker__name">${name}</span>
                    ${subtitle.text ? `<span class="project-picker__meta">${subtitle.text}</span>` : ''}
                </span>
                <span class="project-picker__tags">
                    ${publicBadge}
                    ${permissionChip}
                </span>
            </button>
        `;
    }

    /**
     * Builds the subtitle line ("por Você · modificado há 2 dias"). The author is
     * "Você" for owned atlases, else the owner's display name. The modified part is
     * omitted when `updated_at` is missing/unparseable.
     * @private
     * @param {Object} project
     * @returns {{ text: string, plain: string }} Escaped HTML and a plain-text variant.
     */
    _buildSubtitle(project) {
        const author = project?.user_permission === 'owner'
            ? 'Você'
            : (project?.owner_nome ?? '').trim();

        const parts = [];
        if (author) parts.push(`por ${author}`);

        const relative = formatRelativeTime(project?.updated_at);
        if (relative) parts.push(`modificado ${relative}`);

        const plain = parts.join(' · ');
        return { text: escapeHtml(plain), plain };
    }

    /**
     * Renders the footer actions HTML.
     * @private
     * @returns {string}
     */
    _renderActions() {
        const createBtn = this._onCreate
            ? `<button type="button" class="prompt-modal-btn prompt-modal-btn-confirm project-picker__create"
                       data-testid="project-picker-create">
                   ${ICONS.plus}
                   <span>Novo projeto</span>
               </button>`
            : '';

        return `
            <div class="project-picker__actions">
                <button type="button" class="prompt-modal-btn prompt-modal-btn-cancel project-picker__cancel"
                        data-testid="project-picker-cancel">
                    Cancelar
                </button>
                ${createBtn}
            </div>
        `;
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupListeners() {
        const body = this.getBody();

        const cancelBtn = body.querySelector('.project-picker__cancel');
        addDomListener(this, cancelBtn, 'click', () => this.hide());

        const createBtn = body.querySelector('.project-picker__create');
        if (createBtn) {
            addDomListener(this, createBtn, 'click', () => this._handleCreate());
        }

        const items = body.querySelectorAll('.project-picker__item');
        items.forEach((item) => {
            addScopedDomListener(this, 'rows', item, 'click', () => {
                this._handlePick(item.dataset.atlasId);
            });
        });
    }

    /**
     * Handles picking a project row.
     * @private
     * @param {string} atlasId - Selected atlas id
     */
    async _handlePick(atlasId) {
        if (this._busy || !atlasId) return;
        this._busy = true;
        try {
            await this._onPick(atlasId);
            this.hide();
        } catch {
            this._busy = false;
        }
    }

    /**
     * Handles creating a new project. Uses the design-system prompt modal
     * (not the native browser prompt) to collect the new project's name.
     * @private
     */
    async _handleCreate() {
        if (this._busy || !this._onCreate) return;

        // Stable testids let e2e drive the new (non-native) create flow.
        const prompt = new PromptModal({
            title: 'Nome do novo projeto',
            placeholder: 'Ex.: Operação Fronteira',
            confirmText: 'Criar',
            inputTestid: 'project-picker-create-input',
            confirmTestid: 'project-picker-create-confirm'
        });
        const name = await prompt.show();

        if (name === null) return;
        const trimmed = name.trim();
        if (!trimmed) return;

        this._busy = true;
        try {
            await this._onCreate(trimmed);
            this.hide();
        } catch {
            this._busy = false;
        }
    }

    /**
     * Hides the modal, clearing scoped row listeners first.
     */
    hide() {
        clearScopedListeners(this, 'rows');
        super.hide();
    }
}

/**
 * Helper to show the project picker modal.
 * @param {Object} options - See {@link ProjectPickerModal} constructor.
 * @returns {ProjectPickerModal} Modal instance
 */
export function showProjectPickerModal(options = {}) {
    const modal = new ProjectPickerModal(options);
    modal.render();
    modal.show();
    return modal;
}

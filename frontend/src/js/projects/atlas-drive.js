// Path: js/projects/atlas-drive.js

/**
 * @fileoverview Atlas Drive — the project chooser ("Google Drive of maps"). Lists the user's server
 * atlases as a card grid with tabs (Recentes / Meus / Compartilhados / Públicos / Lixeira) and a name
 * search, plus per-card actions (renomear / duplicar / lixeira / restaurar).
 *
 * It is the BODY of `projetos.html`, not a modal: it used to be a full-screen overlay stacked on the
 * booted map (`modals/project-picker.modal.js`), which meant choosing a project happened on top of a
 * map you had not chosen yet, and closing it dropped you on a blank local workspace nobody asked for.
 * As a page it has its own URL, its own back/forward, and no map behind it. The `project-picker-*`
 * testids are kept verbatim so the existing e2e specs stay valid.
 *
 * Opening is a NAVIGATION (`./?atlas=<uuid>`), so this component never touches the store or the sync
 * engine — the map page owns those, and its `openRemoteAtlas` already handles wipe/connect plus the
 * unsaved-local-work question. Dynamic text goes through textContent; icons are static SVG.
 */

import { showCreateAtlasModal } from '@modals/create-atlas.modal.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showPrompt } from '@modals/prompt.modal.js';
import { apiClient } from '@store/sync/api-client.js';
import {
    setupCleanup, addDomListener, addScopedDomListener, clearScopedListeners, cleanup, removeElement,
} from '@utils/event-cleanup.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { showSuccess, showError } from '@utils/toast_service.js';

const ICONS = {
    plus: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>`,
};

const PERMISSION_LABELS = Object.freeze({ owner: 'Proprietário', write: 'Edição', read: 'Leitura' });

const FILTERS = [
    { key: 'recentes', label: 'Recentes' },
    { key: 'meus', label: 'Meus' },
    { key: 'compartilhados', label: 'Compartilhados comigo' },
    { key: 'publicos', label: 'Públicos' },
    { key: 'lixeira', label: 'Lixeira' },
];

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** Formats a timestamp as a pt-BR relative phrase, falling back to an absolute date past a week. */
function formatRelativeTime(value) {
    if (value == null || value === '') return '';
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return '';
    const diffSec = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return RELATIVE_TIME_FORMAT.format(diffSec, 'second');
    if (abs < 3600) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 86400 * 7) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 86400), 'day');
    return new Date(then).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * The project chooser, as a mountable page section.
 */
export class AtlasDrive {
    /**
     * @param {Object} options
     * @param {Array<Object>} [options.projects] - Atlas records from `apiClient.listAtlas()`.
     * @param {Function} options.onPick - Called with the picked atlas id.
     * @param {Function} [options.onCreate] - Called with (name, sharing) for "Novo projeto".
     * @param {Function} [options.onImport] - Called with the chosen `.ebgeo` File.
     */
    constructor(options = {}) {
        this._projects = Array.isArray(options.projects) ? options.projects : [];
        this._onPick = options.onPick || (() => Promise.resolve());
        this._onCreate = typeof options.onCreate === 'function' ? options.onCreate : null;
        this._onImport = typeof options.onImport === 'function' ? options.onImport : null;
        this._importBtn = null;
        this._busy = false;
        this._filter = 'recentes';
        this._query = '';
        this._trashed = [];
        this._trashedLoaded = false;
        this._root = null;
        this._gridEl = null;
        this._tabButtons = new Map();
        setupCleanup(this);
    }

    /**
     * Builds the Drive into `host` and focuses the search box.
     * @param {HTMLElement} [host]
     */
    mount(host = document.body) {
        if (this._root) return;
        this._build();
        host.appendChild(this._root);
        const search = this._root.querySelector('.atlas-drive__search-input');
        if (search) requestAnimationFrame(() => search.focus());
    }

    /** Removes the Drive + its listeners. */
    destroy() {
        if (!this._root) return;
        this._closeCardMenu();
        clearScopedListeners(this, 'grid');
        cleanup(this);
        removeElement(this._root);
        this._root = null;
        this._gridEl = null;
        this._tabButtons.clear();
    }

    /** @private */
    _build() {
        const root = document.createElement('div');
        root.className = 'atlas-drive';
        // Kept from the modal era so every existing e2e locator still resolves.
        root.dataset.testid = 'project-picker-modal';

        root.appendChild(this._buildTopbar());
        root.appendChild(this._buildTabs());

        const grid = document.createElement('div');
        grid.className = 'atlas-drive__grid';
        grid.dataset.testid = 'project-picker-list';
        grid.setAttribute('role', 'listbox');
        grid.setAttribute('aria-label', 'Projetos do servidor');
        root.appendChild(grid);

        this._root = root;
        this._gridEl = grid;
        this._renderGrid();
    }

    /** @private Content toolbar: title + search + "Novo projeto" (no close — this is a page). */
    _buildTopbar() {
        const bar = document.createElement('header');
        bar.className = 'atlas-drive__topbar';

        const title = document.createElement('div');
        const h = document.createElement('h2');
        h.className = 'atlas-drive__title';
        h.textContent = 'Seus projetos';
        const sub = document.createElement('p');
        sub.className = 'atlas-drive__subtitle';
        sub.textContent = 'Abra um mapa do servidor ou crie um novo';
        title.append(h, sub);
        bar.appendChild(title);

        const tools = document.createElement('div');
        tools.className = 'atlas-drive__tools';

        const searchWrap = document.createElement('div');
        searchWrap.className = 'atlas-drive__search';
        const sIcon = document.createElement('span');
        sIcon.className = 'atlas-drive__search-icon';
        sIcon.innerHTML = ICONS.search; // static icon
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'atlas-drive__search-input';
        search.placeholder = 'Buscar projeto…';
        search.dataset.testid = 'project-picker-search';
        addDomListener(this, search, 'input', () => { this._query = search.value; this._renderGrid(); });
        searchWrap.append(sIcon, search);
        tools.appendChild(searchWrap);

        if (this._onImport) {
            // A hidden file input, driven by a real button — the native control cannot be styled
            // and would be the only unstyled thing on the page.
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.ebgeo';
            fileInput.hidden = true;
            fileInput.dataset.testid = 'project-picker-import-input';
            addDomListener(this, fileInput, 'change', () => {
                const file = fileInput.files?.[0];
                // Reset first: picking the SAME file twice must fire `change` again (it would not
                // if the value stayed), which is exactly what a retry after a failure needs.
                fileInput.value = '';
                if (file) this._handleImport(file);
            });

            const importBtn = document.createElement('button');
            importBtn.type = 'button';
            importBtn.className = 'atlas-drive__btn atlas-drive__btn--ghost';
            importBtn.dataset.testid = 'project-picker-import';
            importBtn.title = 'Criar um projeto a partir de um arquivo .ebgeo';
            importBtn.innerHTML = ICONS.upload; // static icon
            const importLabel = document.createElement('span');
            importLabel.textContent = 'Importar .ebgeo';
            importBtn.appendChild(importLabel);
            addDomListener(this, importBtn, 'click', () => fileInput.click());

            this._importBtn = importBtn;
            tools.append(importBtn, fileInput);
        }

        if (this._onCreate) {
            const newBtn = document.createElement('button');
            newBtn.type = 'button';
            newBtn.className = 'atlas-drive__btn atlas-drive__btn--primary';
            newBtn.dataset.testid = 'project-picker-create';
            newBtn.innerHTML = ICONS.plus; // static icon
            const t = document.createElement('span');
            t.textContent = 'Novo projeto';
            newBtn.appendChild(t);
            addDomListener(this, newBtn, 'click', () => this._handleCreate());
            tools.appendChild(newBtn);
        }

        bar.appendChild(tools);
        return bar;
    }

    /**
     * @private Runs the caller's import with the chosen file, showing progress on the button —
     * unzipping + uploading a real project takes seconds, and a dead-looking button invites a
     * second click that would import twice.
     * @param {File} file
     */
    async _handleImport(file) {
        if (this._busy) return;
        this._busy = true;
        const label = this._importBtn?.querySelector('span');
        const original = label?.textContent;
        if (label) label.textContent = 'Importando…';
        if (this._importBtn) this._importBtn.disabled = true;
        try {
            await this._onImport(file);
        } finally {
            // On success the page navigates away and this never matters; on failure the button
            // must come back, or the only way to retry is a reload.
            this._busy = false;
            if (label && original) label.textContent = original;
            if (this._importBtn) this._importBtn.disabled = false;
        }
    }

    /** @private Filter tabs. */
    _buildTabs() {
        const tabs = document.createElement('nav');
        tabs.className = 'atlas-drive__tabs';
        tabs.setAttribute('role', 'tablist');
        for (const f of FILTERS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'atlas-drive__tab';
            btn.dataset.testid = `project-picker-tab-${f.key}`;
            btn.setAttribute('role', 'tab');
            btn.textContent = f.label;
            if (f.key === this._filter) btn.classList.add('atlas-drive__tab--active');
            addDomListener(this, btn, 'click', () => this._switchFilter(f.key));
            this._tabButtons.set(f.key, btn);
            tabs.appendChild(btn);
        }
        return tabs;
    }

    /** @private The atlases matching the active tab + search. */
    _visible() {
        const q = this._query.trim().toLowerCase();
        const list = q ? this._projects.filter((p) => (p?.name ?? '').toLowerCase().includes(q)) : this._projects;
        switch (this._filter) {
            case 'meus':
                return list.filter((p) => p?.user_permission === 'owner');
            case 'compartilhados':
                return list.filter((p) => p?.user_permission && p.user_permission !== 'owner');
            case 'publicos':
                return list.filter((p) => p?.is_public);
            case 'recentes':
            default:
                return [...list].sort((a, b) => new Date(b?.updated_at ?? 0) - new Date(a?.updated_at ?? 0));
        }
    }

    /**
     * @private Switches the active tab. The Trash tab lazy-loads the caller's soft-deleted atlases
     * (a separate endpoint from listAtlas) on first open.
     * @param {string} key
     */
    async _switchFilter(key) {
        this._filter = key;
        for (const [k, b] of this._tabButtons) b.classList.toggle('atlas-drive__tab--active', k === key);
        if (key === 'lixeira' && !this._trashedLoaded) {
            try {
                const list = await apiClient.listTrashedAtlas();
                this._trashed = Array.isArray(list) ? list : [];
                this._trashedLoaded = true;
            } catch (error) {
                showError(error?.message || 'Não foi possível carregar a lixeira.');
            }
        }
        this._renderGrid();
    }

    /** @private Rebuilds the card grid from the current filter/search. */
    _renderGrid() {
        if (!this._gridEl) return;
        // Release the previous cards' listeners before detaching them — _renderGrid runs on every
        // keystroke/tab-switch/refresh, so without this the tracked-listener bucket grows unbounded.
        clearScopedListeners(this, 'grid');
        this._gridEl.replaceChildren();
        const isTrash = this._filter === 'lixeira';
        const q = this._query.trim().toLowerCase();
        const matches = (p) => !q || (p?.name ?? '').toLowerCase().includes(q);
        // The search box applies on every tab, including Lixeira.
        const list = (isTrash ? this._trashed.filter(matches) : this._visible());
        if (list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'atlas-drive__empty';
            empty.dataset.testid = 'project-picker-empty';
            empty.textContent = isTrash
                ? (this._query ? 'Nenhum projeto na lixeira corresponde à busca.' : 'A lixeira está vazia.')
                : (this._query ? 'Nenhum projeto corresponde à busca.' : 'Nenhum projeto nesta categoria.');
            this._gridEl.appendChild(empty);
            return;
        }
        for (const project of list) {
            this._gridEl.appendChild(isTrash ? this._trashCard(project) : this._card(project));
        }
    }

    /** @private A single atlas card (the `project-picker-item`) wrapped with its actions menu button. */
    _card(project) {
        const id = String(project?.id ?? '');
        const wrap = document.createElement('div');
        wrap.className = 'atlas-drive__card-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'atlas-drive__card';
        btn.dataset.testid = 'project-picker-item';
        btn.dataset.atlasId = id;
        btn.setAttribute('role', 'option');
        const sub = this._subtitle(project);
        btn.setAttribute('aria-label', sub ? `${project?.name ?? ''} — ${sub}` : (project?.name ?? ''));

        const thumb = document.createElement('div');
        thumb.className = 'atlas-drive__thumb';
        thumb.style.backgroundColor = getPresenceColor(id);
        thumb.textContent = getInitials(project?.name ?? '');
        btn.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 'atlas-drive__card-body';

        const name = document.createElement('div');
        name.className = 'atlas-drive__card-name';
        name.textContent = project?.name ?? '';
        body.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'atlas-drive__card-meta';
        meta.textContent = this._subtitle(project);
        body.appendChild(meta);

        const tags = document.createElement('div');
        tags.className = 'atlas-drive__card-tags';
        if (PERMISSION_LABELS[project?.user_permission]) {
            const chip = document.createElement('span');
            chip.className = `atlas-drive__chip atlas-drive__chip--${project.user_permission}`;
            chip.textContent = PERMISSION_LABELS[project.user_permission];
            tags.appendChild(chip);
        }
        if (project?.is_public) {
            const pub = document.createElement('span');
            pub.className = 'atlas-drive__public';
            pub.innerHTML = ICONS.globe; // static icon
            const t = document.createElement('span');
            t.textContent = 'Público';
            pub.appendChild(t);
            tags.appendChild(pub);
        }
        body.appendChild(tags);

        btn.appendChild(body);
        addScopedDomListener(this, 'grid', btn, 'click', () => this._handlePick(id));
        wrap.appendChild(btn);

        // Actions menu (⋯) — a sibling button (a card is a <button>, so it cannot be nested).
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'atlas-drive__menu-btn';
        menuBtn.dataset.testid = 'project-picker-menu';
        menuBtn.setAttribute('aria-label', 'Mais ações');
        menuBtn.innerHTML = ICONS.dots; // static icon
        addScopedDomListener(this, 'grid', menuBtn, 'click', (e) => {
            e.stopPropagation();
            this._openCardMenu(project, menuBtn);
        });
        wrap.appendChild(menuBtn);

        return wrap;
    }

    /**
     * @private Opens the card actions menu near the ⋯ button. Actions are gated by the user's role
     * on that atlas: rename needs write, trash needs ownership, "make a copy" needs only read.
     */
    _openCardMenu(project, anchorBtn) {
        // Re-clicking the same ⋯ button toggles its menu shut.
        if (this._cardMenu && this._cardMenuAnchor === anchorBtn) {
            this._closeCardMenu();
            return;
        }
        this._closeCardMenu();
        const perm = project?.user_permission;
        // Hierarquia de CINCO níveis: read < comment < write < manage < owner.
        // Uma lista fechada `=== 'owner' || === 'write'` exclui o co-Gestor
        // (`manage`), que está ACIMA de write: o backend aceita o PUT dele
        // (`atlas.routes.js`), mas o card escondia "Renomear". Mesma armadilha
        // que já havia silenciado a presença de seleção do co-Gestor no servidor.
        const canWrite = perm === 'owner' || perm === 'manage' || perm === 'write';
        const canOwn = perm === 'owner';

        const menu = document.createElement('div');
        menu.className = 'atlas-drive__menu';
        menu.dataset.testid = 'project-picker-menu-popup';
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.left = `${Math.round(rect.right - 200)}px`;

        const addItem = (label, testid, danger, fn) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `atlas-drive__menu-item${danger ? ' atlas-drive__menu-item--danger' : ''}`;
            item.dataset.testid = testid;
            item.textContent = label;
            item.addEventListener('click', () => { this._closeCardMenu(); fn(); });
            menu.appendChild(item);
        };

        if (canWrite) addItem('Renomear', 'project-picker-rename', false, () => this._rename(project));
        addItem('Fazer uma cópia', 'project-picker-duplicate', false, () => this._duplicate(project));
        if (canOwn) addItem('Mover para lixeira', 'project-picker-trash', true, () => this._trash(project));

        this._root.appendChild(menu);
        this._cardMenu = menu;
        this._cardMenuAnchor = anchorBtn;
        this._menuOutside = (e) => {
            // anchorBtn.contains(target) — the click may land on the button's inner <svg>, which is
            // NOT === anchorBtn; without contains() the button's own click reads as "outside".
            if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) this._closeCardMenu();
        };
        // Defer so the opening click doesn't immediately close the menu. Handle stored for teardown.
        this._menuTimer = setTimeout(() => {
            this._menuTimer = null;
            document.addEventListener('mousedown', this._menuOutside);
        }, 0);
    }

    /** @private */
    _closeCardMenu() {
        if (this._menuTimer != null) { clearTimeout(this._menuTimer); this._menuTimer = null; }
        if (this._cardMenu) { this._cardMenu.remove(); this._cardMenu = null; }
        this._cardMenuAnchor = null;
        if (this._menuOutside) { document.removeEventListener('mousedown', this._menuOutside); this._menuOutside = null; }
    }

    /** @private Re-fetches the atlas list and re-renders the grid (after an action). */
    async _refresh() {
        try {
            const list = await apiClient.listAtlas();
            this._projects = Array.isArray(list) ? list : [];
        } catch (error) {
            showError(error?.message || 'Não foi possível atualizar a lista.');
        }
        this._renderGrid();
    }

    /** @private Rename via a prompt → PUT /atlas/:id. */
    async _rename(project) {
        const name = await showPrompt('Renomear projeto', project?.name ?? '');
        if (name == null) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === project?.name) return;
        try {
            await apiClient.updateAtlas(project.id, { name: trimmed });
            showSuccess('Projeto renomeado.');
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao renomear o projeto.');
        }
    }

    /** @private Make a copy → POST /atlas/:id/clone. */
    async _duplicate(project) {
        try {
            await apiClient.cloneAtlas(project.id, { name: `${project?.name ?? 'Projeto'} (cópia)` });
            showSuccess('Cópia criada.');
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao duplicar o projeto.');
        }
    }

    /**
     * @private Move to trash (soft-delete) → DELETE /atlas/:id.
     * No "is this the connected atlas?" special case: this page holds no connection. A peer with the
     * atlas open receives the server's `atlas_deleted` broadcast and tears itself down.
     */
    async _trash(project) {
        const ok = await showConfirm(
            `Mover "${project?.name ?? ''}" para a lixeira? Você poderá restaurá-lo depois.`,
            { destructive: true, confirmText: 'Mover para lixeira' },
        );
        if (!ok) return;
        try {
            await apiClient.deleteAtlas(project.id);
            showSuccess('Projeto movido para a lixeira.');
            this._trashedLoaded = false; // re-fetch the trash next time it is opened
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao mover o projeto para a lixeira.');
        }
    }

    /** @private A trashed-atlas card: not openable; offers a Restaurar action. */
    _trashCard(project) {
        const id = String(project?.id ?? '');
        const card = document.createElement('div');
        card.className = 'atlas-drive__card atlas-drive__card--trash';
        card.dataset.testid = 'project-picker-trash-item';
        card.dataset.atlasId = id;

        const thumb = document.createElement('div');
        thumb.className = 'atlas-drive__thumb';
        thumb.style.backgroundColor = getPresenceColor(id);
        thumb.textContent = getInitials(project?.name ?? '');
        card.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 'atlas-drive__card-body';
        const name = document.createElement('div');
        name.className = 'atlas-drive__card-name';
        name.textContent = project?.name ?? '';
        const meta = document.createElement('div');
        meta.className = 'atlas-drive__card-meta';
        const when = formatRelativeTime(project?.deleted_at);
        meta.textContent = when ? `excluído ${when}` : 'na lixeira';
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'atlas-drive__btn atlas-drive__btn--ghost atlas-drive__restore';
        restoreBtn.dataset.testid = 'project-picker-restore';
        restoreBtn.textContent = 'Restaurar';
        addScopedDomListener(this, 'grid', restoreBtn, 'click', () => this._restore(project));
        body.append(name, meta, restoreBtn);

        card.appendChild(body);
        return card;
    }

    /** @private Restore a trashed atlas → POST /atlas/:id/restore. */
    async _restore(project) {
        try {
            await apiClient.restoreAtlas(project.id);
            showSuccess('Projeto restaurado.');
            this._trashed = (this._trashed || []).filter((p) => p.id !== project.id);
            try {
                const list = await apiClient.listAtlas();
                if (Array.isArray(list)) this._projects = list;
            } catch { /* keep the cached list */ }
            this._renderGrid();
        } catch (error) {
            showError(error?.message || 'Falha ao restaurar o projeto.');
        }
    }

    /** @private "por Você · modificado há 2 dias". */
    _subtitle(project) {
        const author = project?.user_permission === 'owner' ? 'Você' : (project?.owner_nome ?? '').trim();
        const parts = [];
        if (author) parts.push(`por ${author}`);
        const relative = formatRelativeTime(project?.updated_at);
        if (relative) parts.push(`modificado ${relative}`);
        return parts.join(' · ');
    }

    /** @private */
    async _handlePick(atlasId) {
        if (this._busy || !atlasId) return;
        this._busy = true;
        try {
            await this._onPick(atlasId);
        } catch {
            this._busy = false;
        }
    }

    /** @private Opens the create-atlas dialog; forwards name + sharing to onCreate. */
    _handleCreate() {
        if (!this._onCreate) return;
        const onCreate = this._onCreate;
        showCreateAtlasModal({ onCreate: (name, sharing) => onCreate(name, sharing) });
    }
}

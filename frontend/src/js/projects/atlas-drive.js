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
 *
 * The file also exports {@link LocalAtlasSection}, the "Neste computador" half of the page. It is a
 * SEPARATE component, not a sixth tab of this one: the five tabs (Recentes / Meus / Compartilhados /
 * Públicos / Lixeira) are all server concepts, and a local atlas has no owner, no permission and no
 * trash. It is equally store-free — every local operation arrives as a callback from
 * `projects-page.js`, which is the single file on this page allowed to call the local-atlas API.
 */

import { showCreateAtlasModal } from '@modals/create-atlas.modal.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showPrompt } from '@modals/prompt.modal.js';
import { apiClient } from '@store/sync/api-client.js';
import { fileToCoverPayload } from './cover-image.js';
import {
    setupCleanup, addDomListener, addScopedDomListener, clearScopedListeners, cleanup, removeElement,
} from '@utils/event-cleanup.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { getPermissionLabel, isKnownPermission, hasAtLeast } from '@js/projects/permission-levels.js';
import { showSuccess, showError } from '@utils/toast_service.js';

const ICONS = {
    plus: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
};

/** Avatars drawn on a card before the rest collapses into "+N". */
const MAX_CARD_AVATARS = 4;

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
     * @param {{atlases: Object[], covers: Object, presence: Object}} [options.overview] - The card
     *   extras from `apiClient.getAtlasOverview()`. Omitted, cards draw name and permission alone,
     *   which is what they did before this existed — the page must stay usable when the extra
     *   request fails.
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
        /** atlasId → `{member_count, members, has_cover}`; atlasId → data URI; atlasId → users. */
        this._members = new Map();
        this._covers = new Map();
        this._presence = new Map();
        /** atlasId → the node that shows who is connected, so a refresh can redraw ONLY it. */
        this._presenceNodes = new Map();
        this._coverInput = null;
        this._coverTarget = null;
        this.setOverview(options.overview);
        setupCleanup(this);
    }

    /**
     * Replaces the card extras (members, covers, presence) and redraws if already mounted.
     * @param {{atlases: Object[], covers: Object, presence: Object}} [overview]
     */
    setOverview(overview) {
        this._members = new Map(
            (Array.isArray(overview?.atlases) ? overview.atlases : []).map((row) => [String(row.id), row])
        );
        this._covers = new Map(Object.entries(overview?.covers || {}));
        this._presence = new Map(Object.entries(overview?.presence || {}));
        if (this._gridEl) this._renderGrid();
    }

    /**
     * Refreshes ONLY who is connected — the one fact that changes without the user doing anything.
     *
     * It patches the existing nodes instead of redrawing the grid, and that is not an optimisation:
     * this runs on a timer, and a rebuild would close an open ⋯ menu, drop hover, and reset the
     * scroll position of somebody who was reading the list.
     *
     * @param {Object<string, Array<Object>>} presence - Atlas id → connected users.
     */
    setPresence(presence) {
        this._presence = new Map(Object.entries(presence || {}));
        for (const [atlasId, node] of this._presenceNodes) {
            this._fillPresence(node, this._presence.get(atlasId) || []);
        }
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
        this._coverInput = null;
        this._coverTarget = null;
        this._presenceNodes.clear();
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
        // Section heading, not the page heading: the page is "Seus atlas" and this is its server
        // half, sitting under the local one.
        h.textContent = 'No servidor';
        const sub = document.createElement('p');
        sub.className = 'atlas-drive__subtitle';
        sub.textContent = 'Projetos sincronizados, abertos por você e por quem você convidar';
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
        // The presence nodes belong to cards that are about to be dropped; keeping them would make
        // the next poll write into detached DOM and leak a node per atlas per redraw.
        this._presenceNodes.clear();
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

    /**
     * @private The cover of an atlas: the picture somebody chose, or the coloured initials.
     *
     * The initials are NOT a placeholder waiting to be replaced — they are the deterministic
     * identity this app gives every atlas and every person (`presence-colors.js`), so the same
     * project is the same colour on every machine. The cover only takes their place.
     */
    _thumb(project, id) {
        const cover = this._covers.get(id);
        const thumb = document.createElement('div');
        thumb.className = 'atlas-drive__thumb';
        if (cover) {
            thumb.classList.add('atlas-drive__thumb--cover');
            const img = document.createElement('img');
            img.className = 'atlas-drive__thumb-img';
            img.src = cover;
            img.alt = '';
            img.setAttribute('aria-hidden', 'true');
            thumb.appendChild(img);
        } else {
            // Runtime-computed colour, so it belongs in JS; everything else is a class.
            thumb.style.backgroundColor = getPresenceColor(id);
            thumb.textContent = getInitials(project?.name ?? '');
        }
        return thumb;
    }

    /**
     * @private Writes "who is on this map right now" into `node`, avatars and all.
     *
     * Called on every draw AND on every presence poll, which is why it is a fill rather than a
     * build: {@link setPresence} reuses the same node.
     * @param {HTMLElement} node
     * @param {Array<{id: string, nome: string}>} users
     */
    _fillPresence(node, users) {
        node.replaceChildren();
        const list = Array.isArray(users) ? users : [];
        node.hidden = list.length === 0;
        if (list.length === 0) return;

        const dot = document.createElement('span');
        dot.className = 'atlas-drive__live-dot';
        dot.setAttribute('aria-hidden', 'true');
        node.appendChild(dot);

        node.appendChild(this._avatars(list, 'atlas-drive__live-avatar'));

        const label = document.createElement('span');
        label.className = 'atlas-drive__live-label';
        // "no mapa" and not "online": these are people INSIDE this project right now, which is a
        // different fact from being signed in, and the card sits next to projects nobody is in.
        label.textContent = list.length === 1 ? '1 no mapa' : `${list.length} no mapa`;
        node.appendChild(label);
        node.title = `Agora no projeto: ${list.map((u) => u?.nome || 'Alguém').join(', ')}`;
    }

    /**
     * @private A stack of initial-avatars, capped, with a "+N" for the rest.
     * @param {Array<{id: string, nome: string}>} people
     * @param {string} className - BEM element class of each avatar.
     * @returns {HTMLElement}
     */
    _avatars(people, className) {
        const stack = document.createElement('span');
        stack.className = 'atlas-drive__avatars';
        stack.setAttribute('aria-hidden', 'true'); // the sentence next to it carries the meaning
        for (const person of people.slice(0, MAX_CARD_AVATARS)) {
            const avatar = document.createElement('span');
            avatar.className = className;
            avatar.textContent = getInitials(person?.nome || '?');
            avatar.style.backgroundColor = getPresenceColor(String(person?.id || person?.nome || ''));
            stack.appendChild(avatar);
        }
        if (people.length > MAX_CARD_AVATARS) {
            const more = document.createElement('span');
            more.className = `${className} ${className}--more`;
            more.textContent = `+${people.length - MAX_CARD_AVATARS}`;
            stack.appendChild(more);
        }
        return stack;
    }

    /**
     * @private The sharing footer: who takes part, in words and in avatars.
     *
     * IT SAYS SOMETHING EVEN WITH NO DATA. When the overview request failed there is no row for
     * this atlas, and a footer that simply vanished would read as "this project is private" —
     * a wrong fact, silently. So the absent case draws nothing at all and the caller keeps the
     * old card, while the KNOWN solitary case says so out loud.
     */
    _sharingFooter(project, id) {
        const row = this._members.get(id);
        if (!row) return null;

        const foot = document.createElement('div');
        foot.className = 'atlas-drive__share';
        foot.dataset.testid = 'project-card-sharing';

        const members = Array.isArray(row.members) ? row.members : [];
        const count = Number.isFinite(row.member_count) ? row.member_count : members.length;

        if (count <= 1) {
            const solo = document.createElement('span');
            solo.className = 'atlas-drive__share-label';
            solo.innerHTML = ICONS.lock; // static icon
            const text = document.createElement('span');
            text.textContent = project?.is_public ? 'Só você e o link público' : 'Só você';
            solo.appendChild(text);
            foot.appendChild(solo);
            return foot;
        }

        foot.appendChild(this._avatars(members, 'atlas-drive__member-avatar'));
        const label = document.createElement('span');
        label.className = 'atlas-drive__share-label';
        label.textContent = `${count} pessoas`;
        foot.appendChild(label);
        // The names live in the tooltip: four avatars and a number fit a card, six names do not.
        foot.title = `Com acesso: ${members.map((m) => m?.nome || 'Alguém').join(', ')}`
            + (count > members.length ? ` e mais ${count - members.length}` : '');
        return foot;
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

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'atlas-drive__thumb-wrap';
        thumbWrap.appendChild(this._thumb(project, id));

        // Presence rides ON the thumbnail: it is the most perishable fact on the card, and the
        // corner of the picture is where the eye lands before it reads anything.
        const live = document.createElement('span');
        live.className = 'atlas-drive__live';
        live.dataset.testid = 'project-card-live';
        this._fillPresence(live, this._presence.get(id) || []);
        thumbWrap.appendChild(live);
        this._presenceNodes.set(id, live);
        btn.appendChild(thumbWrap);

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
        // The chip is drawn for ANY level the server reports, not only the ones this file
        // knows a label for: the local table used to list owner/write/read alone, so an atlas
        // shared as Gestor (`manage`) or Comentarista (`comment`) rendered NO badge at all —
        // indistinguishable from an atlas with no permission. An unknown level now degrades to
        // its raw value on the base chip (no `--<level>` modifier, since no rule would match).
        const permission = project?.user_permission;
        const permissionLabel = getPermissionLabel(permission);
        if (permissionLabel) {
            const chip = document.createElement('span');
            chip.className = isKnownPermission(permission)
                ? `atlas-drive__chip atlas-drive__chip--${permission}`
                : 'atlas-drive__chip';
            chip.textContent = permissionLabel;
            chip.dataset.permission = String(permission);
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

        const sharing = this._sharingFooter(project, id);
        if (sharing) body.appendChild(sharing);

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
        // Por isso o gate é por posto na escada, não por enumeração.
        const canWrite = hasAtLeast(perm, 'write');
        const canOwn = hasAtLeast(perm, 'owner');

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
        if (canWrite) {
            // Same gate as renaming, and for the same reason: cover and name are the identity of
            // the project, and 'manage' is the ruler of sharing, which is a different question.
            const hasCover = this._covers.has(String(project?.id ?? ''));
            addItem(
                hasCover ? 'Trocar imagem' : 'Escolher imagem',
                'project-picker-cover',
                false,
                () => this._pickCover(project),
            );
            if (hasCover) {
                addItem('Remover imagem', 'project-picker-cover-remove', false, () => this._removeCover(project));
            }
        }
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

    /**
     * @private Re-fetches the atlas list AND the card extras, then redraws.
     *
     * Both, because the actions that call this create and destroy atlases: a copy made from a card
     * arrives with no cover and one member, and a list refreshed without the overview would draw it
     * with the previous atlas's footer for as long as the page stayed open.
     */
    async _refresh() {
        const [list, overview] = await Promise.all([
            apiClient.listAtlas().catch((error) => {
                showError(error?.message || 'Não foi possível atualizar a lista.');
                return null;
            }),
            // Silent on failure, deliberately: the extras are an enrichment, and a second red
            // toast about a detail nobody asked for would bury the first one, which is the real news.
            apiClient.getAtlasOverview().catch(() => null),
        ]);
        if (Array.isArray(list)) this._projects = list;
        if (overview) this.setOverview(overview);
        else this._renderGrid();
    }

    /**
     * @private The hidden file input the cover actions drive.
     *
     * ONE input for the whole grid, living in the Drive's root rather than in a card: the ⋯ menu is
     * destroyed the moment an item is clicked, so an input owned by the menu would be gone before
     * the file picker returned, and its `change` would fire into nothing.
     */
    _ensureCoverInput() {
        if (this._coverInput) return this._coverInput;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.hidden = true;
        input.dataset.testid = 'project-picker-cover-input';
        addDomListener(this, input, 'change', () => {
            const file = input.files?.[0];
            const target = this._coverTarget;
            // Reset BEFORE the await: picking the same file twice must fire `change` again, which
            // is exactly what a retry after a failed upload needs.
            input.value = '';
            this._coverTarget = null;
            if (file && target) this._applyCover(target, file);
        });
        this._root.appendChild(input);
        this._coverInput = input;
        return input;
    }

    /** @private Opens the file picker for this project's cover. */
    _pickCover(project) {
        const input = this._ensureCoverInput();
        this._coverTarget = project;
        input.value = '';
        input.click();
    }

    /**
     * @private Shrinks the picture in the browser and stores it.
     *
     * The resize is NOT an optimisation to skip when in doubt: a phone photo is megabytes, the card
     * draws it 320 px wide, and every visit to this page would download all of them.
     */
    async _applyCover(project, file) {
        const id = String(project?.id ?? '');
        try {
            const payload = await fileToCoverPayload(file);
            await apiClient.setAtlasCover(id, payload);
            this._covers.set(id, payload.image);
            const row = this._members.get(id);
            if (row) row.has_cover = true;
            this._renderGrid();
            showSuccess('Imagem do projeto atualizada.');
        } catch (error) {
            console.error('[projects] cover upload failed:', error);
            showError(error?.message || 'Não foi possível usar esta imagem.');
        }
    }

    /** @private Drops the cover, putting the coloured initials back. */
    async _removeCover(project) {
        const id = String(project?.id ?? '');
        try {
            await apiClient.deleteAtlasCover(id);
            this._covers.delete(id);
            const row = this._members.get(id);
            if (row) row.has_cover = false;
            this._renderGrid();
            showSuccess('Imagem removida.');
        } catch (error) {
            showError(error?.message || 'Não foi possível remover a imagem.');
        }
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
        // The same face it had before being trashed — recognising it is the whole job of this card.
        card.appendChild(this._thumb(project, id));

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

/**
 * "Neste computador" — the named LOCAL atlases, as a card grid with a create tile.
 *
 * It renders what it is GIVEN and calls back for everything else: the local-atlas API lives one
 * import away, but keeping it out of here means the page has exactly one file that talks to the
 * store's local registry (`projects-page.js`), which is the file the mount gate names.
 *
 * The local/remote distinction is NEVER carried by colour alone: each card states in words that
 * the atlas stays in this browser, the way a server card states owner and permission.
 */
export class LocalAtlasSection {
    /**
     * @param {Object} options
     * @param {Array<{id: string, name: string, updatedAt: number, createdAt: number}>} [options.atlases]
     * @param {string|null} [options.currentId] - The slot the map will open by default.
     * @param {number} [options.max] - Ceiling of local atlases (`MAX_LOCAL_ATLASES`).
     * @param {Function} options.onOpen - Called with the id to open.
     * @param {Function} options.onCreate - Called with no arguments; owns the name dialog.
     * @param {Function} options.onRename - Called with the entry to rename.
     * @param {Function} options.onDelete - Called with the entry to delete.
     * @param {Function} [options.onOpenFile] - Called with the chosen `.ebgeo` `File`. Omitted
     *   leaves the button out entirely, rather than showing one that does nothing.
     */
    constructor(options = {}) {
        this._atlases = Array.isArray(options.atlases) ? options.atlases : [];
        this._currentId = options.currentId ?? null;
        this._max = Number.isFinite(options.max) ? options.max : null;
        this._onOpen = options.onOpen || (() => {});
        this._onCreate = options.onCreate || (() => {});
        this._onRename = options.onRename || (() => {});
        this._onDelete = options.onDelete || (() => {});
        this._onOpenFile = options.onOpenFile || null;
        this._root = null;
        this._gridEl = null;
        this._countEl = null;
        this._fileInput = null;
        this._busy = false;
        this._menu = null;
        this._menuAnchor = null;
        this._menuOutside = null;
        this._menuTimer = null;
        setupCleanup(this);
    }

    /**
     * Builds the section into `host`.
     * @param {HTMLElement} [host]
     */
    mount(host = document.body) {
        if (this._root) return;
        this._build();
        host.appendChild(this._root);
    }

    /** Removes the section + its listeners. */
    destroy() {
        if (!this._root) return;
        this._closeMenu();
        clearScopedListeners(this, 'local-cards');
        cleanup(this);
        removeElement(this._root);
        this._root = null;
        this._gridEl = null;
        this._countEl = null;
        this._fileInput = null;
    }

    /**
     * Replaces the list after a create/rename/delete and redraws.
     * @param {Array<Object>} atlases
     * @param {string|null} currentId
     */
    setAtlases(atlases, currentId) {
        this._atlases = Array.isArray(atlases) ? atlases : [];
        this._currentId = currentId ?? null;
        this._busy = false;
        this._render();
    }

    /** @private */
    _build() {
        const root = document.createElement('section');
        root.className = 'local-atlas';
        root.dataset.testid = 'local-atlas-section';

        const header = document.createElement('header');
        header.className = 'local-atlas__header';

        const heading = document.createElement('div');
        const h = document.createElement('h2');
        h.className = 'local-atlas__title';
        h.textContent = 'Neste computador';
        const sub = document.createElement('p');
        sub.className = 'local-atlas__subtitle';
        sub.textContent = 'Atlas guardados neste navegador. Nada aqui vai para o servidor nem é visto por outras pessoas.';
        heading.append(h, sub);
        header.appendChild(heading);

        const actions = document.createElement('div');
        actions.className = 'local-atlas__actions';

        if (this._onOpenFile) actions.appendChild(this._fileButton());

        const count = document.createElement('span');
        count.className = 'local-atlas__count';
        count.dataset.testid = 'local-atlas-count';
        actions.appendChild(count);
        this._countEl = count;

        header.appendChild(actions);
        root.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'local-atlas__grid';
        grid.dataset.testid = 'local-atlas-list';
        grid.setAttribute('role', 'list');
        grid.setAttribute('aria-label', 'Atlas neste computador');
        root.appendChild(grid);

        this._root = root;
        this._gridEl = grid;
        this._render();
    }

    /**
     * @private "Abrir arquivo .ebgeo", plus the hidden input it drives.
     *
     * Both live in the HEADER and not in the grid, so `_render` (which runs on every create,
     * rename and delete) never rebuilds them: an `<input type="file">` replaced while its picker
     * is open loses the `change` that was about to arrive. The input is reset before every open,
     * or picking the same file twice in a row fires no event at all.
     */
    _fileButton() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ebgeo';
        input.hidden = true;
        input.dataset.testid = 'local-atlas-file-input';
        addDomListener(this, input, 'change', () => {
            const file = input.files?.[0];
            input.value = '';
            if (file) this._onOpenFile(file);
        });
        this._fileInput = input;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'local-atlas__btn';
        btn.dataset.testid = 'local-atlas-open-file';
        btn.title = 'Abrir um arquivo .ebgeo como um atlas novo neste computador';
        btn.textContent = 'Abrir arquivo .ebgeo';
        addDomListener(this, btn, 'click', () => {
            this._fileInput.value = '';
            this._fileInput.click();
        });

        const wrap = document.createElement('span');
        wrap.className = 'local-atlas__action';
        wrap.append(btn, input);
        return wrap;
    }

    /** @private Rebuilds the cards + the create tile. */
    _render() {
        if (!this._gridEl) return;
        // Same reason as the server grid: this runs again on every create/rename/delete, so the
        // previous cards' listeners are released before their nodes are dropped.
        clearScopedListeners(this, 'local-cards');
        this._closeMenu();
        this._gridEl.replaceChildren();

        for (const atlas of this._atlases) {
            this._gridEl.appendChild(this._card(atlas));
        }
        this._gridEl.appendChild(this._createTile());

        if (this._countEl) {
            this._countEl.textContent = this._max
                ? `${this._atlases.length} de ${this._max}`
                : String(this._atlases.length);
        }
    }

    /** @private One local atlas. */
    _card(atlas) {
        const id = String(atlas?.id ?? '');
        const isCurrent = id !== '' && id === this._currentId;

        const wrap = document.createElement('div');
        wrap.className = 'local-atlas__card-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `local-atlas__card${isCurrent ? ' local-atlas__card--current' : ''}`;
        btn.dataset.testid = 'local-atlas-item';
        btn.dataset.localAtlasId = id;
        btn.setAttribute('role', 'listitem');
        if (isCurrent) btn.setAttribute('aria-current', 'true');

        const name = document.createElement('div');
        name.className = 'local-atlas__name';
        name.textContent = atlas?.name ?? '';
        btn.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'local-atlas__meta';
        const when = formatRelativeTime(atlas?.updatedAt);
        meta.textContent = when ? `aberto ${when}` : '';
        btn.appendChild(meta);

        const tags = document.createElement('div');
        tags.className = 'local-atlas__tags';
        const chip = document.createElement('span');
        chip.className = 'local-atlas__chip';
        chip.textContent = 'Local';
        tags.appendChild(chip);
        if (isCurrent) {
            const currentChip = document.createElement('span');
            currentChip.className = 'local-atlas__chip local-atlas__chip--current';
            currentChip.dataset.testid = 'local-atlas-current';
            currentChip.textContent = 'Atual';
            tags.appendChild(currentChip);
        }
        btn.appendChild(tags);

        // The written half of the distinction: the chip's colour says nothing to a colour-blind
        // reader, and nothing at all to a screen reader used to server cards.
        const note = document.createElement('p');
        note.className = 'local-atlas__note';
        note.textContent = 'Fica só neste navegador';
        btn.appendChild(note);

        addScopedDomListener(this, 'local-cards', btn, 'click', () => this._open(atlas));
        wrap.appendChild(btn);

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'local-atlas__menu-btn';
        menuBtn.dataset.testid = 'local-atlas-menu';
        menuBtn.setAttribute('aria-label', `Mais ações de ${atlas?.name ?? 'atlas local'}`);
        menuBtn.innerHTML = ICONS.dots; // static icon
        addScopedDomListener(this, 'local-cards', menuBtn, 'click', (e) => {
            e.stopPropagation();
            this._openMenu(atlas, menuBtn);
        });
        wrap.appendChild(menuBtn);

        return wrap;
    }

    /** @private The dashed "+ Novo atlas local" tile, always last. */
    _createTile() {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'local-atlas__add';
        tile.dataset.testid = 'local-atlas-create';
        tile.innerHTML = ICONS.plus; // static icon
        const label = document.createElement('span');
        label.textContent = 'Novo atlas local';
        tile.appendChild(label);
        // NOT disabled at the ceiling: the refusal carries a pt-BR message that explains what to
        // do, and a dead button explains nothing.
        addScopedDomListener(this, 'local-cards', tile, 'click', () => this._onCreate());
        return tile;
    }

    /** @private */
    _open(atlas) {
        if (this._busy) return;
        this._busy = true;
        // Opening navigates away, so nothing resets `_busy` on success; a caller that stays on
        // the page (a refusal) calls `setAtlases`, which clears it.
        this._onOpen(atlas);
    }

    /** @private Card actions, anchored to the ⋯ button. */
    _openMenu(atlas, anchorBtn) {
        if (this._menu && this._menuAnchor === anchorBtn) {
            this._closeMenu();
            return;
        }
        this._closeMenu();

        const menu = document.createElement('div');
        menu.className = 'local-atlas__menu';
        menu.dataset.testid = 'local-atlas-menu-popup';
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.left = `${Math.round(rect.right - 200)}px`;

        const addItem = (label, testid, danger, fn) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `local-atlas__menu-item${danger ? ' local-atlas__menu-item--danger' : ''}`;
            item.dataset.testid = testid;
            item.textContent = label;
            item.addEventListener('click', () => { this._closeMenu(); fn(); });
            menu.appendChild(item);
        };

        addItem('Abrir', 'local-atlas-open', false, () => this._open(atlas));
        addItem('Renomear', 'local-atlas-rename', false, () => this._onRename(atlas));
        addItem('Excluir', 'local-atlas-delete', true, () => this._onDelete(atlas));

        this._root.appendChild(menu);
        this._menu = menu;
        this._menuAnchor = anchorBtn;
        this._menuOutside = (e) => {
            // contains(): the click may land on the button's inner <svg>, which is not the button.
            if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) this._closeMenu();
        };
        this._menuTimer = setTimeout(() => {
            this._menuTimer = null;
            document.addEventListener('mousedown', this._menuOutside);
        }, 0);
    }

    /** @private */
    _closeMenu() {
        if (this._menuTimer != null) { clearTimeout(this._menuTimer); this._menuTimer = null; }
        if (this._menu) { this._menu.remove(); this._menu = null; }
        this._menuAnchor = null;
        if (this._menuOutside) {
            document.removeEventListener('mousedown', this._menuOutside);
            this._menuOutside = null;
        }
    }
}

/**
 * The signed-out invitation that stands where the server section goes.
 *
 * Its own component so the page never has to render a half-alive Drive: with no session there is
 * no list to filter, no trash to open and no create to offer, and a disabled copy of all of that
 * would be a promise the page cannot keep.
 *
 * @param {Object} options
 * @param {Function} options.onLogin - Called when the visitor asks to sign in.
 * @returns {HTMLElement}
 */
export function createServerInvite({ onLogin }) {
    const section = document.createElement('section');
    section.className = 'server-invite';
    section.dataset.testid = 'server-invite';

    const h = document.createElement('h2');
    h.className = 'server-invite__title';
    h.textContent = 'No servidor';
    section.appendChild(h);

    const text = document.createElement('p');
    text.className = 'server-invite__text';
    text.textContent = 'Entre para abrir os projetos do servidor, colaborar em tempo real e compartilhar '
        + 'com sua equipe. Os atlas deste computador continuam funcionando sem conta.';
    section.appendChild(text);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-drive__btn atlas-drive__btn--primary';
    btn.dataset.testid = 'projects-login';
    btn.textContent = 'Entrar';
    btn.addEventListener('click', () => onLogin());
    section.appendChild(btn);

    return section;
}

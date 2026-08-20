// Path: js/admin/admin-panel.js

/**
 * @fileoverview Admin page shell. An app-shell layout: a top bar +
 * a LEFT navigation rail + a scrolling content area. Each tab is a pluggable definition
 * `{ id, label, testid, icon?, mount(container) }` whose `mount` may return a cleanup function.
 *
 * This is a PAGE (`admin.html`), not an overlay over the map — it owns the viewport, so there is no
 * close button and no Esc-to-close; the top bar offers "Voltar" (to the chooser) and "Sair" instead. The
 * role gate lives in the page entry (`admin-page.js`), which also owns session teardown; which tabs
 * each audience actually gets is decided in `index.js`.
 */

import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';
import { createAppBar } from '@ui/app-bar.js';

const SHIELD_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>`;

/**
 * @typedef {Object} AdminTab
 * @property {string} id - Stable tab id.
 * @property {string} label - pt-BR tab label.
 * @property {string} testid - data-testid for the tab button.
 * @property {string} [icon] - Optional static SVG markup for the rail icon (no user data).
 * @property {function(HTMLElement): (Function|void)} mount - Renders into the container; may
 *   return a cleanup function called when the tab is left or the page is torn down.
 */

/**
 * Admin page shell.
 */
export class AdminPanel {
    /**
     * @param {AdminTab[]} [tabs]
     * @param {Object} [options]
     * @param {{ id?: string, name?: string }} [options.user] - Identity shown in the top bar.
     * @param {function(): void} [options.onBack] - "Voltar" (the page above this one).
     * @param {function(): void} [options.onLogout] - "Sair".
     * @param {string} [options.title] - Top-bar title. A producer reaches this shell with the
     *   Catálogo tab only and a credenciado with the Grupos tab only; calling either
     *   "Administração" would promise a panel they do not get.
     */
    constructor(tabs = [], { user = null, onBack = null, onLogout = null, title = 'Administração' } = {}) {
        this._tabs = tabs;
        this._user = user;
        this._title = title;
        this._onBack = onBack;
        this._onLogout = onLogout;
        this._root = null;
        this._bodyEl = null;
        this._tabButtons = new Map();
        this._activeTabId = null;
        /** @type {{element: HTMLElement, destroy: Function}|null} */
        this._appBar = null;
        /** @type {Function|null} Cleanup returned by the active tab's mount. */
        this._tabCleanup = null;
        setupCleanup(this);
    }

    /**
     * Builds the shell into `host` and mounts the first tab.
     * @param {HTMLElement} [host]
     */
    mount(host = document.body) {
        if (this._root) return;
        this._build();
        host.appendChild(this._root);
        if (this._tabs.length) this._selectTab(this._tabs[0].id);
    }

    /** Tears the shell down, running tab + listener cleanup. */
    destroy() {
        if (!this._root) return;
        this._runTabCleanup();
        this._appBar?.destroy();
        this._appBar = null;
        cleanup(this);
        removeElement(this._root);
        this._root = null;
        this._bodyEl = null;
        this._tabButtons.clear();
        this._activeTabId = null;
    }

    /** @private Builds the shell DOM (top bar + rail + content area). */
    _build() {
        const root = document.createElement('div');
        root.className = 'admin-panel';
        root.dataset.testid = 'admin-panel';

        root.appendChild(this._buildHeader());

        const main = document.createElement('div');
        main.className = 'admin-panel__main';
        main.appendChild(this._buildRail());

        const body = document.createElement('div');
        body.className = 'admin-panel__content';
        body.dataset.testid = 'admin-body';
        main.appendChild(body);

        root.appendChild(main);

        this._root = root;
        this._bodyEl = body;
    }

    /** @private The shared page top bar (brand, "Voltar", identity, "Sair"). */
    _buildHeader() {
        this._appBar = createAppBar({
            icon: SHIELD_ICON,
            title: this._title,
            subtitle: 'Sistema EBGeo',
            user: this._user,
            actions: [{
                label: 'Voltar',
                icon: BACK_ICON,
                testid: 'admin-back',
                onClick: () => this._onBack?.(),
            }],
            onLogout: this._onLogout ? () => this._onLogout() : null,
        });
        return this._appBar.element;
    }

    /** @private The left navigation rail (vertical tabs). */
    _buildRail() {
        const rail = document.createElement('nav');
        rail.className = 'admin-panel__rail';
        rail.setAttribute('role', 'tablist');
        rail.setAttribute('aria-orientation', 'vertical');
        for (const tab of this._tabs) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'admin-panel__tab';
            btn.dataset.testid = tab.testid;
            btn.setAttribute('role', 'tab');
            if (tab.icon) {
                const ic = document.createElement('span');
                ic.className = 'admin-panel__tab-icon';
                ic.innerHTML = tab.icon; // static icon, no user data
                btn.appendChild(ic);
            }
            const label = document.createElement('span');
            label.className = 'admin-panel__tab-label';
            label.textContent = tab.label;
            btn.appendChild(label);
            addDomListener(this, btn, 'click', () => this._selectTab(tab.id));
            this._tabButtons.set(tab.id, btn);
            rail.appendChild(btn);
        }
        return rail;
    }

    /**
     * @private Switches to a tab: runs the previous tab's cleanup, clears the body, mounts the new.
     * @param {string} id
     */
    _selectTab(id) {
        if (!this._bodyEl || id === this._activeTabId) return;
        const tab = this._tabs.find((t) => t.id === id);
        if (!tab) return;

        this._runTabCleanup();
        this._bodyEl.replaceChildren();

        for (const [tabId, btn] of this._tabButtons) {
            btn.classList.toggle('admin-panel__tab--active', tabId === id);
            btn.setAttribute('aria-selected', tabId === id ? 'true' : 'false');
        }

        this._activeTabId = id;
        const maybeCleanup = tab.mount(this._bodyEl);
        this._tabCleanup = typeof maybeCleanup === 'function' ? maybeCleanup : null;
    }

    /** @private Runs and clears the active tab's cleanup, swallowing errors. */
    _runTabCleanup() {
        if (typeof this._tabCleanup === 'function') {
            try {
                this._tabCleanup();
            } catch (error) {
                console.warn('[AdminPanel] tab cleanup error:', error);
            }
        }
        this._tabCleanup = null;
    }
}

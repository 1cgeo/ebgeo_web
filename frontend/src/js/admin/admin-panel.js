// Path: js/admin/admin-panel.js

/**
 * @fileoverview Full-screen admin panel shell (global system admin only). An app-shell layout:
 * a top bar + a LEFT navigation rail + a scrolling content area. Each tab is a pluggable definition
 * `{ id, label, testid, icon?, mount(container) }` whose `mount` may return a cleanup function. The
 * shell owns open/close, tab switching, Esc-to-close, and the ADMIN_PANEL_OPENED/CLOSED events.
 * The admin-only gate lives in `index.js#openAdminPanel` (sessionContext.isAdmin()).
 */

import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';

const CLOSE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const SHIELD_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

/**
 * @typedef {Object} AdminTab
 * @property {string} id - Stable tab id.
 * @property {string} label - pt-BR tab label.
 * @property {string} testid - data-testid for the tab button.
 * @property {string} [icon] - Optional static SVG markup for the rail icon (no user data).
 * @property {function(HTMLElement): (Function|void)} mount - Renders into the container; may
 *   return a cleanup function called when the tab is left or the panel closes.
 */

/**
 * Full-screen admin panel.
 */
export class AdminPanel {
    /**
     * @param {AdminTab[]} [tabs]
     */
    constructor(tabs = []) {
        this._tabs = tabs;
        this._overlay = null;
        this._bodyEl = null;
        this._tabButtons = new Map();
        this._activeTabId = null;
        /** @type {Function|null} Cleanup returned by the active tab's mount. */
        this._tabCleanup = null;
        setupCleanup(this);
    }

    /** @returns {boolean} Whether the panel is currently open. */
    isOpen() {
        return this._overlay !== null;
    }

    /** Opens the panel and mounts the first tab. */
    open() {
        if (this._overlay) return;
        this._build();
        document.body.appendChild(this._overlay);
        getEventBus().emit(EventTypes.ADMIN_PANEL_OPENED, {});
        if (this._tabs.length) this._selectTab(this._tabs[0].id);
    }

    /** Closes the panel, running tab + listener cleanup. */
    close() {
        if (!this._overlay) return;
        this._runTabCleanup();
        cleanup(this);
        removeElement(this._overlay);
        this._overlay = null;
        this._bodyEl = null;
        this._tabButtons.clear();
        this._activeTabId = null;
        getEventBus().emit(EventTypes.ADMIN_PANEL_CLOSED, {});
    }

    /** @private Builds the overlay DOM (top bar + rail + content area). */
    _build() {
        const overlay = document.createElement('div');
        overlay.className = 'admin-panel';
        overlay.dataset.testid = 'admin-panel';

        overlay.appendChild(this._buildHeader());

        const main = document.createElement('div');
        main.className = 'admin-panel__main';
        main.appendChild(this._buildRail());

        const body = document.createElement('div');
        body.className = 'admin-panel__content';
        body.dataset.testid = 'admin-body';
        main.appendChild(body);

        overlay.appendChild(main);

        addDomListener(this, document, 'keydown', (e) => this._onKeydown(e));

        this._overlay = overlay;
        this._bodyEl = body;
    }

    /** @private The top bar: brand + title + close. */
    _buildHeader() {
        const header = document.createElement('header');
        header.className = 'admin-panel__header';

        const brand = document.createElement('div');
        brand.className = 'admin-panel__brand';
        const mark = document.createElement('span');
        mark.className = 'admin-panel__brand-mark';
        mark.innerHTML = SHIELD_ICON; // static icon, no user data
        const titles = document.createElement('div');
        const title = document.createElement('h2');
        title.className = 'admin-panel__title';
        title.textContent = 'Administração';
        const subtitle = document.createElement('p');
        subtitle.className = 'admin-panel__subtitle';
        subtitle.textContent = 'Sistema EBGeo';
        titles.append(title, subtitle);
        brand.append(mark, titles);
        header.appendChild(brand);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'admin-panel__close';
        closeBtn.dataset.testid = 'admin-close';
        closeBtn.setAttribute('aria-label', 'Fechar');
        closeBtn.innerHTML = CLOSE_ICON; // static icon, no user data
        addDomListener(this, closeBtn, 'click', () => this.close());
        header.appendChild(closeBtn);

        return header;
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

    /** @private Esc closes the panel — unless a dialog is on top or a field is being edited. */
    _onKeydown(e) {
        if (!this._overlay || e.key !== 'Escape') return;
        if (document.querySelector('.modal-overlay, .confirm-modal-overlay, .prompt-modal-overlay, .idle-warning__overlay')) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        this.close();
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

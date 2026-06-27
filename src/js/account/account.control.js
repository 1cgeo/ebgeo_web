// Path: js/account/account.control.js
import { showLoginModal } from '@modals/login.modal.js';
import { showSignupModal } from '@modals/signup.modal.js';
import { openAdminPanel } from '@js/admin/index.js';
import config from '@js/config.js';
import { showProjectPickerModal } from '@modals/project-picker.modal.js';
import { showConfirm } from '@modals/index.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { apiClient } from '@store/sync/api-client.js';
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { startAutoFlush, stopAutoFlush } from '@store/sync/sync-flush.js';
import { clearAllDataStore, activateAtlasInitialMap, markStoreRemote, markStoreLocal, isRemoteStoreSync, hasAnyMapFeatures } from '@store/store.js';
import { getControl } from '@store';
import { saveLocalAtlasToServer } from '@js/import_export/save-local-atlas.service.js';
import { showCreateAtlasModal } from '@modals/create-atlas.modal.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { presenceStore } from '@js/presence/presence-store.js';
import { showSharingModal } from '@modals/sharing.modal.js';
import { showAtlasSettingsModal } from '@modals/atlas-settings.modal.js';
import { showSuccess, showError, showWarning } from '@utils';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';

/* Static inline icons for the dropdown menu actions (no user data — safe to inject). */
const ICON_SAVE_SERVER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 13v8"/><path d="m8 17 4-4 4 4"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>';
const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>';
const ICON_SETTINGS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>';
const ICON_LOGOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
const ICON_ADMIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 16a3.5 3.5 0 0 1 7 0"/></svg>';

/**
 * Fills a dropdown menu button with a leading icon + a text label. The icon is a trusted static
 * SVG string (injected via innerHTML); the label is set via textContent (never user data).
 * @param {HTMLButtonElement} btn
 * @param {string} iconSvg
 * @param {string} label
 */
function setMenuButtonContent(btn, iconSvg, label) {
    const icon = document.createElement('span');
    icon.className = 'account-control__btn-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconSvg;
    const text = document.createElement('span');
    text.className = 'account-control__btn-label';
    text.textContent = label;
    btn.replaceChildren(icon, text);
}

/**
 * AccountControl — MapLibre IControl orchestrator for backend integration.
 *
 * Logged out: renders a single "Entrar" button.
 * Logged in: collapses to a compact circular avatar (initials only) pinned to
 * the top-right corner. Clicking the avatar opens a Google-Docs-style dropdown
 * carrying the full username and the "Sair" action (closes on outside-click /
 * Esc). The username and logout never show inline — they live in the menu.
 *
 * It owns the full login → project-picker → connect → auto-flush flow and the
 * logout teardown. All collaborative writes still travel through the sync
 * engine; this control only drives the UI side of the session lifecycle.
 */
export class AccountControl {
    constructor() {
        /** @type {import('maplibre-gl').Map|null} */
        this._map = null;
        /** @type {HTMLElement|null} */
        this._container = null;
        /** @type {HTMLButtonElement|null} */
        this._loginBtn = null;
        /** @type {HTMLButtonElement|null} The avatar button that toggles the menu. */
        this._avatarBtn = null;
        /** @type {HTMLSpanElement|null} */
        this._avatar = null;
        /** @type {HTMLElement|null} Dropdown menu (name + Sair). */
        this._menu = null;
        /** @type {HTMLSpanElement|null} */
        this._userLabel = null;
        /** @type {HTMLButtonElement|null} */
        this._logoutBtn = null;
        /** @type {HTMLButtonElement|null} The "Compartilhar" menu item (owner/admin only). */
        this._shareBtn = null;
        /** @type {HTMLButtonElement|null} The "Salvar no servidor" menu item (logged-in + local store). */
        this._saveToServerBtn = null;
        /** @type {HTMLButtonElement|null} The "Excluir projeto" menu item (owner/admin + connected). */
        this._deleteAtlasBtn = null;
        /** @type {HTMLButtonElement|null} The "Configurar projeto" menu item (Gestor + connected). */
        this._settingsBtn = null;
        /** @type {boolean} Whether the account menu is open. */
        this._open = false;
        /** @type {((event: Event) => void)|null} Document-level dismiss handler. */
        this._onDocPointerDown = null;
        /** @type {((event: KeyboardEvent) => void)|null} Esc-to-close handler. */
        this._onKeyDown = null;
        /**
         * Last known username, captured from the login modal credentials.
         * SESSION_CHANGED does not carry a display name, so we remember it here.
         * @type {string|null}
         */
        this._username = null;

        setupCleanup(this);
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group account-control';
        this._container.setAttribute('data-testid', 'account-control');

        // Logged-out affordance: the only thing visible when anonymous.
        this._loginBtn = document.createElement('button');
        this._loginBtn.type = 'button';
        this._loginBtn.className = 'account-control__btn account-control__btn--login';
        this._loginBtn.setAttribute('data-testid', 'account-login-btn');
        this._loginBtn.textContent = 'Entrar';

        // Logged-in affordance: a single circular avatar button (initials only).
        // It opens the dropdown menu; the name/logout live inside the menu.
        this._avatarBtn = document.createElement('button');
        this._avatarBtn.type = 'button';
        this._avatarBtn.className = 'account-control__identity';
        this._avatarBtn.setAttribute('aria-haspopup', 'menu');
        this._avatarBtn.setAttribute('aria-expanded', 'false');
        this._avatarBtn.setAttribute('aria-label', 'Conta');

        this._avatar = document.createElement('span');
        this._avatar.className = 'account-control__avatar';
        this._avatar.setAttribute('aria-hidden', 'true');
        this._avatarBtn.appendChild(this._avatar);

        // Dropdown menu: username header + "Sair" action.
        this._menu = document.createElement('div');
        this._menu.className = 'account-control__menu';
        this._menu.setAttribute('role', 'menu');
        this._menu.hidden = true;

        this._userLabel = document.createElement('span');
        this._userLabel.className = 'account-control__user';
        this._userLabel.setAttribute('data-testid', 'account-user');
        this._menu.appendChild(this._userLabel);

        // Current-atlas context: a muted caption + the atlas name (truncated). Resolved
        // lazily on open from the project list (no synchronous source for the name).
        this._atlasLabel = document.createElement('span');
        this._atlasLabel.className = 'account-control__atlas';
        this._atlasLabel.setAttribute('data-testid', 'account-atlas');
        this._atlasLabel.hidden = true;
        const atlasCaption = document.createElement('span');
        atlasCaption.className = 'account-control__atlas-caption';
        atlasCaption.textContent = 'Atlas atual';
        this._atlasNameEl = document.createElement('span');
        this._atlasNameEl.className = 'account-control__atlas-name';
        this._atlasLabel.appendChild(atlasCaption);
        this._atlasLabel.appendChild(this._atlasNameEl);
        this._menu.appendChild(this._atlasLabel);

        // "Salvar no servidor" — package the LOCAL store as a new server atlas (§item2). Shown only
        // when logged in and NOT connected to a server atlas (i.e. still working on the local store).
        this._saveToServerBtn = document.createElement('button');
        this._saveToServerBtn.type = 'button';
        this._saveToServerBtn.className = 'account-control__btn account-control__btn--save-server';
        this._saveToServerBtn.setAttribute('role', 'menuitem');
        this._saveToServerBtn.setAttribute('data-testid', 'account-save-server-btn');
        setMenuButtonContent(this._saveToServerBtn, ICON_SAVE_SERVER, 'Salvar no servidor');
        this._saveToServerBtn.hidden = true;
        this._menu.appendChild(this._saveToServerBtn);

        // Atlas sharing (owner/admin only) — relocated here from the Maps tab (§item6).
        // Sits in the same area that shows the user + current atlas name.
        this._shareBtn = document.createElement('button');
        this._shareBtn.type = 'button';
        this._shareBtn.className = 'account-control__btn account-control__btn--share';
        this._shareBtn.setAttribute('role', 'menuitem');
        this._shareBtn.setAttribute('data-testid', 'account-share-btn');
        setMenuButtonContent(this._shareBtn, ICON_SHARE, 'Compartilhar');
        this._shareBtn.hidden = true;
        this._menu.appendChild(this._shareBtn);

        // "Configurar projeto" — atlas settings (3D/360/basemap availability). Gestor-only; the
        // backend enforces 'manage' on PATCH /settings and broadcasts the change to all clients.
        this._settingsBtn = document.createElement('button');
        this._settingsBtn.type = 'button';
        this._settingsBtn.className = 'account-control__btn account-control__btn--settings';
        this._settingsBtn.setAttribute('role', 'menuitem');
        this._settingsBtn.setAttribute('data-testid', 'account-settings-btn');
        setMenuButtonContent(this._settingsBtn, ICON_SETTINGS, 'Configurar projeto');
        this._settingsBtn.hidden = true;
        this._menu.appendChild(this._settingsBtn);

        // "Excluir projeto" — delete the connected atlas (owner/admin only). The server broadcasts
        // `atlas_deleted` so every connected client tears down and returns to the picker (§item-1.4).
        this._deleteAtlasBtn = document.createElement('button');
        this._deleteAtlasBtn.type = 'button';
        this._deleteAtlasBtn.className = 'account-control__btn account-control__btn--delete-atlas';
        this._deleteAtlasBtn.setAttribute('role', 'menuitem');
        this._deleteAtlasBtn.setAttribute('data-testid', 'account-delete-atlas-btn');
        setMenuButtonContent(this._deleteAtlasBtn, ICON_TRASH, 'Excluir projeto');
        this._deleteAtlasBtn.hidden = true;
        this._menu.appendChild(this._deleteAtlasBtn);

        // "Administração" — global system-admin panel (users, config, catalog). Visible ONLY to a
        // GLOBAL admin (sessionContext.isAdmin()), independent of any connected atlas. The backend
        // gates every admin route with requireAdmin; this is purely a UI affordance.
        this._adminBtn = document.createElement('button');
        this._adminBtn.type = 'button';
        this._adminBtn.className = 'account-control__btn account-control__btn--admin';
        this._adminBtn.setAttribute('role', 'menuitem');
        this._adminBtn.setAttribute('data-testid', 'account-admin-btn');
        setMenuButtonContent(this._adminBtn, ICON_ADMIN, 'Administração');
        this._adminBtn.hidden = true;
        this._menu.appendChild(this._adminBtn);

        this._logoutBtn = document.createElement('button');
        this._logoutBtn.type = 'button';
        this._logoutBtn.className = 'account-control__btn account-control__btn--logout';
        this._logoutBtn.setAttribute('data-testid', 'account-logout-btn');
        this._logoutBtn.setAttribute('role', 'menuitem');
        setMenuButtonContent(this._logoutBtn, ICON_LOGOUT, 'Sair');
        this._menu.appendChild(this._logoutBtn);

        this._container.appendChild(this._loginBtn);
        this._container.appendChild(this._avatarBtn);
        this._container.appendChild(this._menu);

        addDomListener(this, this._loginBtn, 'click', () => this._handleLogin());
        addDomListener(this, this._avatarBtn, 'click', () => this._toggleMenu());
        addDomListener(this, this._shareBtn, 'click', () => this._handleShareAtlas());
        addDomListener(this, this._settingsBtn, 'click', () => this._handleAtlasSettings());
        addDomListener(this, this._saveToServerBtn, 'click', () => this._handleSaveLocalToServer());
        addDomListener(this, this._deleteAtlasBtn, 'click', () => this._handleDeleteAtlas());
        addDomListener(this, this._adminBtn, 'click', () => this._handleOpenAdmin());
        addDomListener(this, this._logoutBtn, 'click', () => this._handleLogout());

        // Dismiss the menu on outside-click / Esc (tracked for cleanup).
        this._onDocPointerDown = (event) => {
            if (this._open && this._container && !this._container.contains(event.target)) {
                this._closeMenu();
            }
        };
        this._onKeyDown = (event) => {
            if (this._open && event.key === 'Escape') {
                this._closeMenu();
                this._avatarBtn?.focus();
            }
        };
        addDomListener(this, document, 'pointerdown', this._onDocPointerDown);
        addDomListener(this, document, 'keydown', this._onKeyDown);

        // Re-render whenever the session mode/identity changes, and re-evaluate the
        // Compartilhar visibility when an atlas is connected/disconnected (§item6).
        subscribe(this, getEventBus(), EventTypes.SESSION_CHANGED, () => this._render());
        subscribe(this, getEventBus(), EventTypes.CONNECTION_STATE_CHANGED, () => {
            this._updateShareVisibility();
            this._updateSaveToServerVisibility();
            this._updateDeleteAtlasVisibility();
            this._updateSettingsVisibility();
        });
        // The connected atlas was deleted (by this user or another owner) — tear down + redirect.
        subscribe(this, getEventBus(), EventTypes.ATLAS_DELETED_REMOTE, () => this._handleRemoteAtlasDeleted());
        // Ownership changed (this user gained/lost ownership, or a peer did) — re-gate the menu:
        // Excluir/Compartilhar visibility depend on the role, which the sync engine already updated.
        subscribe(this, getEventBus(), EventTypes.ATLAS_OWNER_CHANGED, () => this._render());

        this._render();

        return this._container;
    }

    /**
     * Reflect the current session state in the DOM. Logged out shows "Entrar";
     * logged in shows only the avatar button (name + "Sair" live in the menu).
     * @private
     */
    _render() {
        if (!this._container) return;

        // Identity comes from the session context, so a session restored on reload (F5)
        // renders the avatar without going through the login modal. The locally-remembered
        // username is only a display fallback for the brief window before SESSION_CHANGED
        // propagates after an interactive login.
        const loggedIn = sessionContext.isAuthenticated();
        const name = sessionContext.username || this._username || '';
        this._username = loggedIn ? name : null;

        this._container.setAttribute('data-logged-in', loggedIn ? 'true' : 'false');

        if (this._loginBtn) {
            this._loginBtn.hidden = loggedIn;
        }
        if (this._avatarBtn) {
            this._avatarBtn.hidden = !loggedIn;
        }
        if (this._userLabel) {
            this._userLabel.textContent = loggedIn ? name : '';
        }
        if (this._avatar) {
            if (loggedIn) {
                // Same deterministic hue used by this user's cursor/roster entry,
                // keyed on the session userId (falls back to the username).
                const key = sessionContext.userId || name;
                this._avatar.textContent = getInitials(name);
                this._avatar.style.backgroundColor = getPresenceColor(String(key));
            } else {
                this._avatar.textContent = '';
                this._avatar.style.backgroundColor = '';
            }
        }
        if (this._avatarBtn) {
            this._avatarBtn.setAttribute('title', loggedIn ? name : '');
        }
        this._updateShareVisibility();
        this._updateSaveToServerVisibility();
        this._updateDeleteAtlasVisibility();
        this._updateSettingsVisibility();
        this._updateAdminVisibility();
        // Logging out (or switching identity) must never leave the menu open.
        if (!loggedIn) {
            this._closeMenu();
        }
    }

    /**
     * Toggle the account dropdown (avatar → name + Sair).
     * @private
     */
    _toggleMenu() {
        if (this._open) {
            this._closeMenu();
        } else {
            this._openMenu();
        }
    }

    /** @private */
    _openMenu() {
        if (!this._menu || !this._username) return;
        this._open = true;
        this._menu.hidden = false;
        this._container?.setAttribute('data-menu-open', 'true');
        this._avatarBtn?.setAttribute('aria-expanded', 'true');
        this._updateShareVisibility();
        this._updateSaveToServerVisibility();
        this._updateDeleteAtlasVisibility();
        this._updateSettingsVisibility();
        this._updateAdminVisibility();
        // Resolve the current atlas name lazily (fire-and-forget).
        this._renderAtlasName();
    }

    /**
     * Resolve and show the current atlas name in the menu (from the project list,
     * cached by atlasId). Hidden when no atlas is open or the name is unknown.
     * @private
     */
    async _renderAtlasName() {
        if (!this._atlasLabel || !this._atlasNameEl) return;
        const atlasId = syncEngine.atlasId;
        if (!atlasId) {
            this._atlasLabel.hidden = true;
            return;
        }
        if (this._atlasCache && this._atlasCache.id === atlasId) {
            this._applyAtlasName(this._atlasCache.name);
            return;
        }
        try {
            const projects = await apiClient.listAtlas();
            const name = Array.isArray(projects)
                ? (projects.find((p) => p && p.id === atlasId)?.name ?? null)
                : null;
            this._atlasCache = { id: atlasId, name };
            // Guard against a close/identity-change while the fetch was in flight.
            if (syncEngine.atlasId === atlasId) this._applyAtlasName(name);
        } catch {
            this._atlasLabel.hidden = true;
        }
    }

    /**
     * @param {string|null} name
     * @private
     */
    _applyAtlasName(name) {
        if (!this._atlasLabel || !this._atlasNameEl) return;
        if (name) {
            this._atlasNameEl.textContent = name;
            this._atlasNameEl.setAttribute('title', name);
            this._atlasLabel.hidden = false;
        } else {
            this._atlasLabel.hidden = true;
        }
    }

    /**
     * Shows the "Compartilhar" menu item only when a server atlas is connected and the user can
     * manage its sharing (a Gestor: atlas owner or promoted co-Gestor, or a global admin). The
     * backend enforces the same 'manage' rule on every mutation, so this is purely a UI affordance.
     * @private
     */
    _updateShareVisibility() {
        if (!this._shareBtn) return;
        const role = sessionContext.role;
        const canShare = !!syncEngine.atlasId
            && (role === 'owner' || role === 'manager' || role === 'admin');
        this._shareBtn.hidden = !canShare;
    }

    /**
     * Shows "Salvar no servidor" only when the user is logged in AND not connected to a server
     * atlas — i.e. still working on the LOCAL store, which is what this action packages and uploads.
     * @private
     */
    _updateSaveToServerVisibility() {
        if (!this._saveToServerBtn) return;
        const canSave = sessionContext.isAuthenticated() && !syncEngine.atlasId;
        this._saveToServerBtn.hidden = !canSave;
    }

    /**
     * Shows "Excluir projeto" only when connected to a server atlas the user can delete — the atlas
     * owner, or a global admin. The backend enforces owner-level on `DELETE /atlas/:id`.
     * @private
     */
    _updateDeleteAtlasVisibility() {
        if (!this._deleteAtlasBtn) return;
        const canDelete = !!syncEngine.atlasId
            && (sessionContext.role === 'owner' || sessionContext.role === 'admin');
        this._deleteAtlasBtn.hidden = !canDelete;
    }

    /**
     * Shows "Configurar projeto" only when connected to a server atlas the user can configure
     * (a Gestor: owner or promoted co-Gestor, or a global admin). The backend enforces 'manage'.
     * @private
     */
    _updateSettingsVisibility() {
        if (!this._settingsBtn) return;
        const role = sessionContext.role;
        const canConfigure = !!syncEngine.atlasId
            && (role === 'owner' || role === 'manager' || role === 'admin');
        this._settingsBtn.hidden = !canConfigure;
    }

    /**
     * Shows "Administração" only to a GLOBAL system admin (sessionContext.isAdmin()). Unlike the
     * atlas-scoped items above, this is NOT predicated on a connected atlas — the admin panel is
     * global. The backend gates every admin route with requireAdmin.
     * @private
     */
    _updateAdminVisibility() {
        if (!this._adminBtn) return;
        this._adminBtn.hidden = !sessionContext.isAdmin();
    }

    /**
     * Closes the account menu and opens the global admin panel (gate re-checked in openAdminPanel).
     * @private
     */
    _handleOpenAdmin() {
        this._closeMenu();
        openAdminPanel();
    }

    /**
     * Opens the atlas settings modal for the connected atlas (Gestor-only). The display name is
     * cosmetic (lazily cached from the project list).
     * @private
     */
    async _handleAtlasSettings() {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) return;
        this._closeMenu();
        let atlasName = this._atlasCache?.id === atlasId ? this._atlasCache?.name : undefined;
        if (atlasName === undefined) {
            try {
                const projects = await apiClient.listAtlas();
                atlasName = projects?.find((p) => p && p.id === atlasId)?.name;
            } catch {
                // Name is cosmetic; the modal works without it.
            }
        }
        showAtlasSettingsModal(atlasId, { atlasName });
    }

    /**
     * Opens the sharing modal for the connected atlas. The display name comes from the
     * lazily-cached project list (cosmetic — the modal re-reads the canonical config).
     * @private
     */
    async _handleShareAtlas() {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) return;
        let atlasName = this._atlasCache?.id === atlasId ? this._atlasCache?.name : undefined;
        if (atlasName === undefined) {
            try {
                const projects = await apiClient.listAtlas();
                atlasName = projects?.find((p) => p && p.id === atlasId)?.name;
            } catch {
                // Name is cosmetic; the modal works without it.
            }
        }
        showSharingModal(atlasId, { atlasName });
    }

    /**
     * Applies the sharing chosen in the create-atlas dialog to a freshly-created atlas: the
     * public link and each staged member (owner-only routes — the creator is the owner).
     * Best-effort per item so one failure does not abort the others.
     * @param {string} atlasId
     * @param {{ isPublic?: boolean, members?: Array<{userId:string, permission:string}> }} [sharing]
     * @private
     */
    async _applyAtlasSharing(atlasId, sharing) {
        if (!sharing) return;
        if (sharing.isPublic) {
            try {
                await apiClient.enablePublicSharing(atlasId);
            } catch (error) {
                console.warn('[AccountControl] enablePublicSharing failed:', error);
            }
        }
        const validPerms = ['read', 'comment', 'write', 'manage'];
        for (const member of (sharing.members || [])) {
            if (!member?.userId) continue;
            // Least-privilege fallback for an unrecognized staged value (never silently escalate to edit).
            const permission = validPerms.includes(member.permission) ? member.permission : 'read';
            try {
                await apiClient.addShare(atlasId, member.userId, permission);
            } catch (error) {
                console.warn('[AccountControl] addShare failed:', error);
            }
        }
    }

    /**
     * "Salvar atlas local no servidor" (§item2): packages the current LOCAL store as a NEW server
     * atlas, then switches the app to that atlas live. The upload READS the local store, so it runs
     * BEFORE `clearAllDataStore`. Sharing chosen in the create dialog is applied to the new atlas.
     * @private
     */
    async _handleSaveLocalToServer() {
        if (!(await hasAnyMapFeatures())) {
            showError('Não há dados locais para salvar no servidor.');
            return;
        }
        const exportService = getControl('exportImport');
        if (!exportService) {
            showError('Serviço de exportação indisponível.');
            return;
        }
        this._closeMenu();
        showCreateAtlasModal({
            onCreate: async (name, sharing) => {
                try {
                    // Defensive: this action only shows when NOT connected, but close any socket first.
                    if (syncEngine.atlasId) {
                        stopAutoFlush();
                        syncEngine.disconnect();
                    }
                    // 1) Upload the LOCAL store as a new atlas (reads the store — must precede the wipe).
                    const result = await saveLocalAtlasToServer(apiClient, exportService, { name });
                    // 2) Apply the staged sharing (the creator is the owner).
                    await this._applyAtlasSharing(result.atlasId, sharing);
                    // 3) Swap the local store for the new remote atlas, live.
                    await clearAllDataStore();
                    await markStoreRemote(result.atlasId);
                    await syncEngine.connect(result.atlasId, { initialPull: true });
                    await activateAtlasInitialMap();
                    startAutoFlush();
                    this._render();

                    const { stats, imageStats } = result;
                    let msg = `Atlas salvo no servidor (${stats.maps} mapa(s), ${stats.features} feição(ões))`;
                    const lostImages = (imageStats.skipped || 0) + (imageStats.failed || 0);
                    if (lostImages > 0) msg += ` — ${lostImages} imagem(ns) não enviada(s)`;
                    showSuccess(msg);
                } catch (error) {
                    showError('Falha ao salvar o atlas no servidor');
                    console.error('[AccountControl] saveLocalAtlasToServer failed:', error);
                    throw error;
                }
            }
        });
    }

    /**
     * Deletes the connected atlas after a DOUBLE confirmation. The server soft-deletes it and
     * broadcasts `atlas_deleted` to the room; every connected client (including this one) tears down
     * and returns to the picker via `_handleRemoteAtlasDeleted`.
     * @private
     */
    async _handleDeleteAtlas() {
        const atlasId = syncEngine.atlasId;
        if (!atlasId) return;
        this._closeMenu();

        const first = await showConfirm(
            'Excluir este projeto do servidor? Todos os colaboradores conectados serão desconectados.',
            { destructive: true, confirmText: 'Excluir' }
        );
        if (!first) return;
        const second = await showConfirm(
            'Confirmação final: o projeto será excluído para todos. Deseja prosseguir?',
            { destructive: true, confirmText: 'Excluir definitivamente' }
        );
        if (!second) return;

        try {
            await apiClient.deleteAtlas(atlasId);
            // The broadcast tears down every peer; tear ourselves down directly so we don't depend on
            // receiving our own `atlas_deleted` before the socket closes.
            await this._handleRemoteAtlasDeleted('Projeto excluído.');
        } catch (error) {
            showError('Falha ao excluir o projeto');
            console.error('[AccountControl] deleteAtlas failed:', error);
        }
    }

    /**
     * Tears down after the connected atlas was deleted (by this user or another owner): stop
     * flushing, disconnect, wipe the remote store, return to a blank LOCAL atlas, and reopen the
     * picker. Idempotent — both the direct delete and the WS `atlas_deleted` broadcast can call it.
     * @param {string} [message]
     * @private
     */
    async _handleRemoteAtlasDeleted(message = 'Este projeto foi excluído pelo proprietário.') {
        // The deleter triggers this DIRECTLY and ALSO receives the WS `atlas_deleted` broadcast — the
        // two race. A synchronous re-entry flag (set before the first await) blocks the concurrent
        // double teardown / double picker; the store-state check catches a LATER broadcast.
        if (this._tearingDownDeletedAtlas) return;
        if (!isRemoteStoreSync() && !syncEngine.atlasId) return; // already torn down
        this._tearingDownDeletedAtlas = true;
        try {
            stopAutoFlush();
            syncEngine.disconnect();
            await clearAllDataStore();
            await markStoreLocal();
            this._render();
            showWarning(message);
            await this.openProjectPicker();
        } finally {
            this._tearingDownDeletedAtlas = false;
        }
    }

    /** @private */
    _closeMenu() {
        if (!this._open && this._menu && this._menu.hidden) return;
        this._open = false;
        if (this._menu) this._menu.hidden = true;
        this._container?.removeAttribute('data-menu-open');
        this._avatarBtn?.setAttribute('aria-expanded', 'false');
    }

    /**
     * Open the login modal, authenticate, then advance to the project picker.
     * @private
     */
    async _handleLogin() {
        try {
            syncEngine.configure({ baseUrl: resolveBackendBaseUrl() });
        } catch (error) {
            showError('Falha ao configurar a conexão com o servidor');
            console.error('[AccountControl] configure failed:', error);
            return;
        }

        // Only offer "Criar conta" where self-registration is enabled server-side (the /auth/register
        // route is unmounted otherwise — showing the button would be a 404 dead-end).
        const signupEnabled = config?.features?.self_registration === true;
        showLoginModal({
            onSubmit: async (credentials) => {
                await syncEngine.login(credentials);
                // Login resolved: remember the display name and refresh the UI.
                this._username = credentials.username;
                this._render();
                // The modal closes on resolve; advance to project selection.
                await this.openProjectPicker();
            },
            onRegister: signupEnabled ? () => this._handleRegister() : undefined
        });
    }

    /**
     * Opens the self-registration modal. On success (the account is active immediately while the
     * e-mail-confirmation flow is not yet enabled), returns the user to the login modal to sign in.
     * @private
     */
    _handleRegister() {
        showSignupModal({
            onSubmit: async (data) => {
                await syncEngine.register(data);
                // The account is created PENDING: it must confirm the e-mail before logging in.
                const resend = await showConfirm(
                    `Conta criada! Enviamos um link de confirmação para ${data.email}. Confirme o e-mail para poder entrar.`,
                    { confirmText: 'Reenviar e-mail', cancelText: 'Entendi' }
                );
                if (resend) {
                    try {
                        await apiClient.resendVerification(data.email);
                        showSuccess('E-mail de confirmação reenviado.');
                    } catch {
                        showError('Não foi possível reenviar o e-mail agora.');
                    }
                }
            },
            onBackToLogin: () => this._handleLogin()
        });
    }

    /**
     * List the user's atlases and let them open an existing one or create a new
     * project. Opening clears the local store, connects, and starts auto-flush.
     * @returns {Promise<void>}
     */
    async openProjectPicker() {
        // inv 6: opening OR creating a server atlas replaces the local store. If the current
        // store is a LOCAL atlas with work, warn and point at .ebgeo before continuing — this
        // covers every entry path (login, "Abrir do servidor"); onCreate runs after the picker.
        if (!isRemoteStoreSync() && await hasAnyMapFeatures()) {
            const proceed = await showConfirm(
                'Abrir ou criar um projeto do servidor vai substituir os dados locais atuais. Se quiser guardá-los, baixe um arquivo .ebgeo antes. Deseja continuar?',
                { destructive: true, confirmText: 'Continuar' }
            );
            if (!proceed) return;
        }

        let projects = [];
        try {
            projects = await apiClient.listAtlas();
        } catch (error) {
            showError('Não foi possível carregar a lista de projetos');
            console.error('[AccountControl] listAtlas failed:', error);
            return;
        }

        showProjectPickerModal({
            projects,
            onPick: async (atlasId) => {
                try {
                    // Switching atlases: close any previous server connection first (one socket
                    // per atlas — the server has no "switch"). Then wipe local + connect new.
                    if (syncEngine.atlasId) {
                        stopAutoFlush();
                        syncEngine.disconnect();
                    }
                    await clearAllDataStore();
                    // Mark REMOTE *before* connecting (durable intent): if the tab dies during
                    // the snapshot pull, the boot guard still sees 'remote' and discards the
                    // partial data instead of mislabeling it as a permanent local atlas. The
                    // store is then editable-offline only via a downloaded .ebgeo.
                    await markStoreRemote(atlasId);
                    await syncEngine.connect(atlasId, { initialPull: true });
                    // Land on the atlas's map, not the local default — opening pulls
                    // the maps but leaves the app on "Principal" otherwise.
                    await activateAtlasInitialMap();
                    startAutoFlush();
                    showSuccess('Projeto carregado do servidor');
                } catch (error) {
                    showError('Falha ao abrir o projeto do servidor');
                    console.error('[AccountControl] connect failed:', error);
                    throw error;
                }
            },
            onCreate: async (name, sharing) => {
                try {
                    if (syncEngine.atlasId) {
                        stopAutoFlush();
                        syncEngine.disconnect();
                    }
                    const atlas = await apiClient.createAtlas({ name });
                    // Apply the sharing chosen in the create dialog before opening (§item5).
                    await this._applyAtlasSharing(atlas.id, sharing);
                    await clearAllDataStore();
                    // Mark REMOTE before connecting (durable intent) — see onPick above.
                    await markStoreRemote(atlas.id);
                    await syncEngine.connect(atlas.id, { initialPull: true });
                    await activateAtlasInitialMap();
                    startAutoFlush();
                    showSuccess('Projeto criado no servidor');
                } catch (error) {
                    showError('Falha ao criar o projeto no servidor');
                    console.error('[AccountControl] createAtlas failed:', error);
                    throw error;
                }
            }
        });
    }

    /**
     * Stop auto-flush, disconnect, and clear the local session identity.
     * @private
     */
    async _handleLogout() {
        try {
            this._closeMenu();
            stopAutoFlush();
            await syncEngine.logoutAndDisconnect();
            // Drop the collaboration UI and return to a BLANK LOCAL atlas: clear the
            // online-users roster (remote cursors + the connection light already hide via
            // the connection/session events), forget the cached atlas name, and wipe the
            // remote data so nothing server-side lingers in IndexedDB.
            presenceStore.clear();
            this._atlasCache = null;
            await clearAllDataStore();
            this._username = null;
            this._render();
        } catch (error) {
            showError('Falha ao sair da conta');
            console.error('[AccountControl] logout failed:', error);
        }
    }

    onRemove() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._loginBtn = null;
        this._avatarBtn = null;
        this._avatar = null;
        this._menu = null;
        this._userLabel = null;
        this._logoutBtn = null;
        this._shareBtn = null;
        this._settingsBtn = null;
        this._deleteAtlasBtn = null;
        this._adminBtn = null;
        this._saveToServerBtn = null;
        this._onDocPointerDown = null;
        this._onKeyDown = null;
        this._map = undefined;
    }
}

export default AccountControl;

// Path: js/account/account.control.js
import { showLoginModal } from '@modals/login.modal.js';
import { showSignupModal } from '@modals/signup.modal.js';
import config from '@js/config.js';
import { showConfirm } from '@modals/index.js';
import { clearLocalMapIntent } from '@js/deep-link/local-intent.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { apiClient } from '@store/sync/api-client.js';
import { resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { startAutoFlush, stopAutoFlush } from '@store/sync/sync-flush.js';
import {
    clearAllDataStore,
    discardRemoteAtlasNamespaces,
    announceRemoteNamespaceTeardown,
    activateRemoteAtlas,
    activateAtlasInitialMap,
    markStoreRemote,
    markStoreLocal,
    isRemoteStoreSync,
    hasAnyMapFeatures,
    getStoreOriginSync
} from '@store/store.js';
// DO ARQUIVO, e a pasta `session/` não tem barrel: é o mesmo mecanismo de saída que as páginas
// sem mapa (`atlas.html`, `admin.html`) precisam poder importar sem arrastar a store nem o
// MapLibre que este controle traz.
import {
    shouldPreserveLocalWork,
    rescuedAtlasName,
    preserveUnsyncedWorkAsLocal,
    countPendingOperations,
    rescueVetoRecorded,
} from '@js/session/unsynced-work-exit.js';
import {
    exitPreservedSummary,
    exitPreserveFailedNotice,
} from '@js/session/unsynced-work-phrases.js';
import { getControl } from '@store';
import { getCurrentLocalAtlasId, getLocalAtlas } from '@store/local-atlas.api.js';
import { saveLocalAtlasToServer } from '@js/import_export/save-local-atlas.service.js';
import {
    openRemoteAtlas,
    retractAtlasClaim,
} from '@js/account/open-atlas.service.js';
import { acquireTabLock, remoteAtlasKey } from '@utils/tab-lock.js';
import { consumePendingAtlasLink } from '@js/deep-link/atlas-link.js';
import { showCreateAtlasModal } from '@modals/create-atlas.modal.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
// Do ARQUIVO, folha e sem imports: é a definição única das audiências de `admin.html`,
// compartilhada com a própria página e com o seletor de atlas.
import { adminAudience } from '@js/admin/admin-audience.js';
// Os rótulos do eixo GLOBAL, de um módulo folha e sem imports: é a única fonte deles fora da aba
// de administração, que nomeia o papel dos OUTROS.
import { globalRoleBadge } from '@ui/role-labels.js';
// A ÚNICA implementação da escada por atlas neste repositório (cinco valores do servidor). Nunca
// uma lista fechada: `perm === 'write' || perm === 'owner'` já excluiu `manage` em silêncio duas vezes.
import {
    atlasRoleHasAtLeast,
    getPermissionLabel,
    isGrantablePermission,
    serverTreatsAsAtlasOwner,
} from '@js/projects/permission-levels.js';
// A resolução id → nome de OM da casa, sobre o payload de `GET /api/config`.
import { orgLabel } from '@js/admin/org-options.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { presenceStore } from '@js/presence/presence-store.js';
import { showSharingModal } from '@modals/sharing.modal.js';
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
const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>';
const ICON_LOGOUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>';
const ICON_ADMIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 16a3.5 3.5 0 0 1 7 0"/></svg>';
const ICON_ACCOUNT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>';
const ICON_CALIBRATION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>';
const ICON_PROJECTS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><path d="M8 2v16M16 6v16"/></svg>';

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
 * O RESGATE E A DECISÃO DE PRESERVAR MORAM EM `session/unsynced-work-exit.js`, e a mudança não é
 * arrumação: a sessão também termina em `atlas.html` e em `admin.html`, que não podem importar um
 * `IControl` do MapLibre. Reexportados aqui porque os sítios de chamada (e os testes que os
 * endereçam) continuam pedindo estes símbolos a este arquivo.
 */
export {
    shouldPreserveLocalWork,
    rescuedAtlasName,
    preserveUnsyncedWorkAsLocal,
} from '@js/session/unsynced-work-exit.js';

/**
 * The server atlas THIS TAB has mounted, read before the teardown drops both sources.
 *
 * `syncEngine.atlasId` is the live connection and wins; the persisted origin marker is the
 * fallback for a session that died with the socket already gone, which is the ordinary shape of
 * the involuntary path this exists for.
 * @returns {string|null}
 */
function mountedRemoteAtlasId() {
    return syncEngine.atlasId ?? getStoreOriginSync().atlasId ?? null;
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
        /** @type {HTMLButtonElement|null} The "Seus atlas" menu item (any signed-in user). */
        this._projectsBtn = null;
        /** @type {HTMLButtonElement|null} The "Enviar ao servidor" menu item (logged-in + local store). */
        this._saveToServerBtn = null;
        /** @type {HTMLButtonElement|null} The "Excluir atlas" menu item (owner/admin + connected). */
        this._deleteAtlasBtn = null;
        /** @type {HTMLButtonElement|null} The "Minha conta" menu item (any signed-in user). */
        this._accountBtn = null;
        /** @type {HTMLButtonElement|null} The "Calibração 360" menu item (global admin or producer). */
        this._calibrationBtn = null;
        /** @type {HTMLElement|null} Global-role badge (word + explaining title + producing OM). */
        this._roleLabel = null;
        /** @type {HTMLElement|null} The badge's word. */
        this._roleName = null;
        /** @type {HTMLElement|null} The producing OM, shown only for a producer. */
        this._roleOrg = null;
        /** @type {HTMLElement|null} This user's level on the CONNECTED atlas (server vocabulary). */
        this._atlasLevelEl = null;
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

        // O PAPEL GLOBAL DE QUEM ESTÁ AQUI, que nenhuma das quatro páginas mostrava. Uma palavra
        // com `title` explicando o que ela permite, mais a OM de produção quando houver: era o
        // único jeito de um produtor descobrir que pode calibrar, ou um credenciado entender por
        // que enxerga recurso que o colega não enxerga. O anônimo não ganha selo nenhum.
        this._roleLabel = document.createElement('span');
        this._roleLabel.className = 'account-control__role';
        this._roleLabel.setAttribute('data-testid', 'account-role');
        this._roleLabel.hidden = true;
        this._roleName = document.createElement('span');
        this._roleName.className = 'account-control__role-name';
        this._roleOrg = document.createElement('span');
        this._roleOrg.className = 'account-control__role-org';
        this._roleOrg.hidden = true;
        this._roleLabel.appendChild(this._roleName);
        this._roleLabel.appendChild(this._roleOrg);
        this._menu.appendChild(this._roleLabel);

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
        // O MEU NÍVEL NESTE ATLAS, ao lado do nome. Em `atlas.html` o selo já existia; com o atlas
        // aberto no mapa, o único sinal de estar em leitura era a ausência das barras de ferramenta.
        // Só para atlas de SERVIDOR: o atlas local não tem nível.
        this._atlasLevelEl = document.createElement('span');
        this._atlasLevelEl.className = 'account-control__atlas-level';
        this._atlasLevelEl.setAttribute('data-testid', 'account-atlas-level');
        this._atlasLevelEl.hidden = true;
        this._atlasLabel.appendChild(atlasCaption);
        this._atlasLabel.appendChild(this._atlasNameEl);
        this._atlasLabel.appendChild(this._atlasLevelEl);
        this._menu.appendChild(this._atlasLabel);

        // "Minha conta" — os dados da própria conta, num modal carregado sob demanda. Qualquer
        // sessão autenticada.
        this._accountBtn = document.createElement('button');
        this._accountBtn.type = 'button';
        this._accountBtn.className = 'account-control__btn account-control__btn--account';
        this._accountBtn.setAttribute('role', 'menuitem');
        this._accountBtn.setAttribute('data-testid', 'account-settings-btn');
        setMenuButtonContent(this._accountBtn, ICON_ACCOUNT, 'Minha conta');
        this._accountBtn.hidden = true;
        this._menu.appendChild(this._accountBtn);

        // "Seus atlas" — back to the chooser page. Shown to anyone signed in: it is the way
        // OUT of the current atlas (and out of the local map) without logging out, which the menu
        // previously offered no route to at all.
        this._projectsBtn = document.createElement('button');
        this._projectsBtn.type = 'button';
        this._projectsBtn.className = 'account-control__btn account-control__btn--projects';
        this._projectsBtn.setAttribute('role', 'menuitem');
        this._projectsBtn.setAttribute('data-testid', 'account-projects-btn');
        setMenuButtonContent(this._projectsBtn, ICON_PROJECTS, 'Seus atlas');
        this._projectsBtn.hidden = true;
        this._menu.appendChild(this._projectsBtn);

        // "Enviar ao servidor" — package the LOCAL store as a new server atlas (§item2). Shown only
        // when logged in and NOT connected to a server atlas (i.e. still working on the local store).
        this._saveToServerBtn = document.createElement('button');
        this._saveToServerBtn.type = 'button';
        this._saveToServerBtn.className = 'account-control__btn account-control__btn--save-server';
        this._saveToServerBtn.setAttribute('role', 'menuitem');
        this._saveToServerBtn.setAttribute('data-testid', 'account-save-server-btn');
        setMenuButtonContent(this._saveToServerBtn, ICON_SAVE_SERVER, 'Enviar ao servidor');
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

        // "Excluir atlas" — delete the connected atlas (owner/admin only). The server broadcasts
        // `atlas_deleted` so every connected client tears down and returns to the picker (§item-1.4).
        this._deleteAtlasBtn = document.createElement('button');
        this._deleteAtlasBtn.type = 'button';
        this._deleteAtlasBtn.className = 'account-control__btn account-control__btn--delete-atlas';
        this._deleteAtlasBtn.setAttribute('role', 'menuitem');
        this._deleteAtlasBtn.setAttribute('data-testid', 'account-delete-atlas-btn');
        setMenuButtonContent(this._deleteAtlasBtn, ICON_TRASH, 'Excluir atlas');
        this._deleteAtlasBtn.hidden = true;
        this._menu.appendChild(this._deleteAtlasBtn);

        // A PORTA DO ESTÚDIO DE CALIBRAÇÃO 360, que não era linkada de lugar nenhum: a página era
        // gateada por `isAdmin() || isProducer()` e só se chegava a ela digitando a URL. O gate
        // desenhado aqui é o MESMO par de chamadas de `calibracao-page.js`, nunca uma cópia do
        // predicado; quem recusa a escrita continua sendo o servidor, por OM dona do projeto.
        this._calibrationBtn = document.createElement('button');
        this._calibrationBtn.type = 'button';
        this._calibrationBtn.className = 'account-control__btn account-control__btn--calibration';
        this._calibrationBtn.setAttribute('role', 'menuitem');
        this._calibrationBtn.setAttribute('data-testid', 'account-calibration-btn');
        setMenuButtonContent(this._calibrationBtn, ICON_CALIBRATION, 'Calibração 360');
        this._calibrationBtn.title =
            'Abrir o estúdio de calibração 360: alinhar as fotos esféricas dos projetos que você mantém';
        this._calibrationBtn.hidden = true;
        this._menu.appendChild(this._calibrationBtn);

        // A PORTA DA PÁGINA DE ADMINISTRAÇÃO. O rótulo muda com a audiência
        // (`_updateAdminVisibility`, que consulta `adminAudience`): "Administração" para o
        // administrador global, "Catálogo" para o produtor e "Grupos" para qualquer outra sessão
        // autenticada. Independe de atlas conectado — a página é global. O backend gateia toda
        // rota de administração; isto é afordância de interface e nada mais.
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
        addDomListener(this, this._projectsBtn, 'click', () => this._handleOpenProjects());
        addDomListener(this, this._saveToServerBtn, 'click', () => this.saveLocalToServer());
        addDomListener(this, this._deleteAtlasBtn, 'click', () => this._handleDeleteAtlas());
        addDomListener(this, this._accountBtn, 'click', () => this._handleOpenAccountSettings());
        addDomListener(this, this._calibrationBtn, 'click', () => this._handleOpenCalibration());
        addDomListener(this, this._adminBtn, 'click', () => this._handleOpenAdmin());
        addDomListener(this, this._logoutBtn, 'click', () => this._handleLogoutGesture());

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
            this._updateProjectsVisibility();
            this._updateProjectsVisibility();
        this._updateSaveToServerVisibility();
            this._updateDeleteAtlasVisibility();
        });
        // The connected atlas was deleted (by this user or another owner) — tear down + redirect.
        subscribe(this, getEventBus(), EventTypes.ATLAS_DELETED_REMOTE, () => this._handleRemoteAtlasDeleted());
        // Ownership changed (this user gained/lost ownership, or a peer did) — re-gate the menu:
        // Excluir/Compartilhar visibility depend on the role, which the sync engine already updated.
        subscribe(this, getEventBus(), EventTypes.ATLAS_OWNER_CHANGED, () => {
            // O cache guarda TAMBÉM o meu nível neste atlas, e é justamente ele que acabou de
            // mudar: mantê-lo faria o selo continuar anunciando o posto anterior até a próxima
            // troca de atlas. Descartar força a releitura na abertura seguinte do menu.
            this._atlasCache = null;
            this._render();
        });

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
        this._updateRoleBadge();
        this._updateShareVisibility();
        this._updateProjectsVisibility();
        this._updateSaveToServerVisibility();
        this._updateDeleteAtlasVisibility();
        this._updateAccountSettingsVisibility();
        this._updateCalibrationVisibility();
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
        this._updateRoleBadge();
        this._updateShareVisibility();
        this._updateProjectsVisibility();
        this._updateSaveToServerVisibility();
        this._updateDeleteAtlasVisibility();
        this._updateAccountSettingsVisibility();
        this._updateCalibrationVisibility();
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
            this._applyAtlasName(this._atlasCache.name, this._atlasCache.permission);
            return;
        }
        try {
            const projects = await apiClient.listAtlas();
            const entry = Array.isArray(projects)
                ? (projects.find((p) => p && p.id === atlasId) ?? null)
                : null;
            const name = entry?.name ?? null;
            // `user_permission` é o contrato do SERVIDOR (cinco valores em escada), a mesma coluna
            // que o cartão do Drive desenha. Não é `sessionContext.role`, que é o vocabulário do
            // cliente (seis valores, com o `admin` global dobrado para dentro).
            const permission = entry?.user_permission ?? null;
            this._atlasCache = { id: atlasId, name, permission };
            // Guard against a close/identity-change while the fetch was in flight.
            if (syncEngine.atlasId === atlasId) this._applyAtlasName(name, permission);
        } catch {
            this._atlasLabel.hidden = true;
        }
    }

    /**
     * @param {string|null} name
     * @param {string|null} [permission] - The atlas-axis level, as the server names it. An
     *   unrecognized value degrades to its RAW text (`getPermissionLabel`), like the Drive's chip:
     *   a badge reading `superuser` is a legible surprise, no badge is a silent one.
     * @private
     */
    _applyAtlasName(name, permission = null) {
        if (!this._atlasLabel || !this._atlasNameEl) return;
        if (name) {
            this._atlasNameEl.textContent = name;
            this._atlasNameEl.setAttribute('title', name);
            this._atlasLabel.hidden = false;
        } else {
            this._atlasLabel.hidden = true;
        }
        if (this._atlasLevelEl) {
            const nivel = getPermissionLabel(permission);
            this._atlasLevelEl.textContent = nivel;
            this._atlasLevelEl.setAttribute('title', nivel
                ? `Seu nível neste atlas: ${nivel}`
                : '');
            this._atlasLevelEl.hidden = nivel === '';
        }
    }

    /**
     * Desenha o selo do papel GLOBAL: uma palavra, o `title` que diz o que ela permite, e a OM de
     * produção quando houver.
     *
     * O ANÔNIMO NÃO GANHA SELO. `globalRoleBadge` devolve null quando não há papel, e é assim que
     * tem de ser: o visitante não tem papel, e escrever "Visitante" seria afirmar o que o servidor
     * nunca disse. Papel desconhecido (um valor que o servidor passe a emitir depois deste build)
     * aparece cru, com uma frase dizendo que o app não o conhece, em vez de sumir ou virar
     * "Usuário".
     *
     * Os quatro rótulos vêm de `ui/role-labels.js`, folha e sem imports, para que as páginas sem
     * mapa possam usá-los sem arrastar a store.
     * @private
     */
    _updateRoleBadge() {
        if (!this._roleLabel || !this._roleName || !this._roleOrg) return;
        const orgId = sessionContext.producerOrgId;
        // '' e não '—' quando a OM não resolve: o traço é o vazio da tabela do admin, e num selo
        // ele leria como se a OM se chamasse assim.
        const orgName = orgId ? orgLabel(orgId, '') : '';
        const badge = sessionContext.isAuthenticated()
            ? globalRoleBadge(sessionContext.globalRole, { orgName })
            : null;
        if (!badge) {
            this._roleLabel.hidden = true;
            return;
        }
        this._roleName.textContent = badge.label;
        this._roleLabel.setAttribute('title', badge.title);
        this._roleLabel.hidden = false;
        const mostraOm = !!orgName && sessionContext.isProducer();
        this._roleOrg.textContent = mostraOm ? orgName : '';
        this._roleOrg.hidden = !mostraOm;
    }

    /**
     * Shows the "Compartilhar" menu item only when a server atlas is connected and the user can
     * manage its sharing (a Gestor: atlas owner or promoted co-Gestor, or a global admin). The
     * backend enforces the same 'manage' rule on every mutation, so this is purely a UI affordance.
     * @private
     */
    _updateShareVisibility() {
        if (!this._shareBtn) return;
        const canShare = !!syncEngine.atlasId
            && atlasRoleHasAtLeast(sessionContext.role, 'manage');
        this._shareBtn.hidden = !canShare;
    }

    /**
     * Shows "Seus atlas" to anyone signed in — connected or on the local map. It is the only
     * route from the map back to the chooser that is not "log out".
     * @private
     */
    _updateProjectsVisibility() {
        if (!this._projectsBtn) return;
        this._projectsBtn.hidden = !sessionContext.isAuthenticated();
    }

    /** @private Closes the menu and leaves for the chooser page. */
    _handleOpenProjects() {
        this._closeMenu();
        this.openProjectPicker();
    }

    /**
     * Shows "Enviar ao servidor" only when the user is logged in AND not connected to a server
     * atlas — i.e. still working on the LOCAL store, which is what this action packages and uploads.
     * @private
     */
    _updateSaveToServerVisibility() {
        if (!this._saveToServerBtn) return;
        const canSave = sessionContext.isAuthenticated() && !syncEngine.atlasId;
        this._saveToServerBtn.hidden = !canSave;
    }

    /**
     * Shows "Excluir atlas" only when connected to a server atlas the user can delete — the atlas
     * owner, or a global admin. The backend enforces owner-level on `DELETE /atlas/:id`.
     * @private
     */
    _updateDeleteAtlasVisibility() {
        if (!this._deleteAtlasBtn) return;
        const canDelete = !!syncEngine.atlasId && serverTreatsAsAtlasOwner(sessionContext.role);
        this._deleteAtlasBtn.hidden = !canDelete;
    }

    /**
     * "Minha conta" aparece para qualquer sessão autenticada, e para mais ninguém: sem conta não
     * há o que ajustar.
     * @private
     */
    _updateAccountSettingsVisibility() {
        if (!this._accountBtn) return;
        this._accountBtn.hidden = !sessionContext.isAuthenticated();
    }

    /**
     * Mostra a porta da calibração 360 a quem o gate da PRÓPRIA PÁGINA aceita.
     *
     * O PREDICADO NÃO É REIMPLEMENTADO: é o mesmo par de chamadas de `calibracao-page.js`, no eixo
     * GLOBAL (`isProducer()` já exige o escopo de produção, porque no banco crachá e escopo são um
     * bicondicional). Uma cópia que divergisse ofereceria uma porta que redireciona de volta para o
     * mapa, ou esconderia do produtor a página que existe para o trabalho dele.
     * @private
     */
    _updateCalibrationVisibility() {
        if (!this._calibrationBtn) return;
        this._calibrationBtn.hidden = !(sessionContext.isAdmin() || sessionContext.isProducer());
    }

    /** @private Fecha o menu e abre o estúdio de calibração 360 (navegação real, outra página). */
    _handleOpenCalibration() {
        this._closeMenu();
        window.location.assign('./calibracao.html');
    }

    /**
     * Abre "Minha conta" — os dados da própria conta, num modal carregado SOB DEMANDA.
     *
     * O `import()` é dinâmico porque o modal é uma tela rara, e é PROTEGIDO porque um módulo que
     * não carregue (build parcial, rede caída no chunk) não pode derrubar o menu inteiro: o pior
     * caso é uma frase dizendo que não deu.
     * @private
     */
    async _handleOpenAccountSettings() {
        this._closeMenu();
        try {
            const { showAccountSettingsModal } = await import('@modals/account-settings.modal.js');
            await showAccountSettingsModal();
        } catch (error) {
            console.error('[AccountControl] account settings modal failed:', error);
            showError('Não foi possível abrir "Minha conta" agora.');
        }
    }

    /**
     * Mostra a entrada da página de administração a quem pode abri-la, com o rótulo do que ela
     * realmente entrega. QUEM DECIDE É `adminAudience` (`@js/admin/admin-audience.js`), a mesma
     * função que a página e o seletor de atlas consultam: enquanto a regra vivia copiada em
     * quatro sítios, a entrada podia aparecer numa tela e faltar na outra, ou aparecer com dois
     * rótulos diferentes. Chamar de "Administração" o painel de uma aba só prometeria um poder
     * que o primeiro clique nega.
     *
     * Desde 2026-08-20 QUALQUER sessão autenticada tem porta aqui, rotulada "Grupos": o grupo de
     * acesso virou entidade de usuário, e é do mapa que se descobre precisar de um (o modal de
     * compartilhar recurso é aberto do catálogo, aqui dentro).
     *
     * Diferente dos itens de atlas acima, isto NÃO depende de atlas conectado — a página é global.
     * O servidor gateia toda rota de administração com requireAdmin, as escritas do catálogo com o
     * gate de produção e as de grupo por posse; nada aqui é a fronteira.
     * @private
     */
    _updateAdminVisibility() {
        if (!this._adminBtn) return;
        const { label: texto } = adminAudience({
            isAuthenticated: sessionContext.isAuthenticated(),
            isAdmin: sessionContext.isAdmin(),
            isProducer: sessionContext.isProducer(),
        });
        this._adminBtn.hidden = texto === null;
        const label = this._adminBtn.querySelector('.account-control__btn-label');
        if (label && texto) label.textContent = texto;
    }

    /**
     * Leaves the map for the Administração PAGE (`admin.html`). It is a real navigation, not an
     * overlay: the admin page boots without MapLibre or the store, and re-checks the global-admin
     * gate on arrival (a non-admin who lands there is sent back to the map).
     * @private
     */
    _handleOpenAdmin() {
        this._closeMenu();
        window.location.assign('./admin.html');
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
        for (const member of (sharing.members || [])) {
            if (!member?.userId) continue;
            // Least-privilege fallback for an unrecognized staged value (never silently escalate to
            // edit). The acceptable set is DERIVED from the ladder (`isGrantablePermission`: every
            // rung below `owner`), not a local array: the same list lived hand-written here and in
            // `projects/projects-page.js`, so a rung added to `PERMISSION_ORDER` would have been
            // demoted to 'read' by both, silently and in two places.
            const permission = isGrantablePermission(member.permission) ? member.permission : 'read';
            try {
                await apiClient.addShare(atlasId, member.userId, permission);
            } catch (error) {
                console.warn('[AccountControl] addShare failed:', error);
            }
        }
    }

    /**
     * "Salvar atlas local no servidor": packages the current LOCAL store as a NEW server atlas,
     * then switches the app to that atlas live. The upload READS the local store, so it runs BEFORE
     * `clearAllDataStore`. Sharing chosen in the create dialog is applied to the new atlas.
     *
     * PUBLIC because the Maps tab offers the same action (the menu item alone was too well hidden
     * to be found). One flow, two entry points — never two implementations.
     * @returns {Promise<void>}
     */
    async saveLocalToServer() {
        // O nome do atlas local, lido do REGISTRO e nao do cabecalho da aba: a aba pode nem estar
        // montada, e o registro e a mesma fonte que ela desenha.
        const nomeSugerido = getLocalAtlas(getCurrentLocalAtlasId())?.name || '';
        if (!(await hasAnyMapFeatures())) {
            showError('Não há dados locais para salvar no servidor.');
            return;
        }
        const exportService = getControl('exportImport');
        if (!exportService) {
            showError('Serviço de exportação indisponível.');
            return;
        }
        // There used to be an up-front refusal here, reading the roster for ANY tab holding ANY
        // server atlas. It went with the rule it enforced ("one remote atlas at a time"): the atlas
        // this action creates is brand new, so no other tab can be holding it, and refusing because
        // a sibling tab has a DIFFERENT project open would deny a legitimate save. The claim taken
        // below, right before the wipe, is the whole check now.
        this._closeMenu();
        showCreateAtlasModal({
            // O atlas local ja tem nome, e ele e o que a pessoa acabou de ver na aba Mapas: sugerir
            // outra coisa (ou nada) faz digitar de novo o que a tela ja sabia.
            defaultName: nomeSugerido,
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
                    // 2.5) Announce the new atlas BEFORE the wipe. The wipe below empties the
                    // databases this tab has mounted, so the claim has to be in force first — and
                    // the announcement is what tells a sibling tab that this one is no longer in
                    // the local atlas they shared. A refusal is nearly impossible now (the atlas
                    // was created one line ago, so nobody else can hold it), but if it happens the
                    // upload still stands and NOTHING local is touched: say so and stop.
                    const claim = await acquireTabLock(remoteAtlasKey(result.atlasId));
                    if (!claim.granted) {
                        retractAtlasClaim();
                        showWarning(
                            'O atlas foi criado no servidor, mas outra aba assumiu este atlas '
                            + 'enquanto isso. Seus dados locais continuam aqui, intactos: feche a '
                            + 'outra aba e abra o atlas em "Seus atlas".',
                            { duration: 10000 }
                        );
                        return;
                    }
                    // 2.7) THE NAMESPACE OF THE NEW ATLAS, before anything writes into it, and
                    // for the same reason `openRemoteAtlas` does it here: `activateRemoteAtlas`
                    // REGISTERS the atlas and only then points the stores at
                    // `ebgeo_*__remote-<atlasId>`.
                    //
                    // THIS LINE WAS MISSING, and it was the third entry into a server atlas that
                    // never activated a namespace. Everything below ran against the LOCAL slot:
                    // the wipe emptied the user's own local atlas (not the new one), and the
                    // `connect` pull wrote the SERVER snapshot into `ebgeo_maps`. That snapshot
                    // then belonged to no registry, so the logged-out purge could not find it and
                    // the next anonymous load mounted it as the user's local atlas. Server data,
                    // permanently readable offline, which is the hardest invariant the store has.
                    try {
                        await activateRemoteAtlas(result.atlasId);
                    } catch (error) {
                        // Nothing was activated and nothing written (the registry write comes
                        // first inside it). The upload STANDS and the local data is untouched, so
                        // say exactly that instead of leaving the user guessing.
                        retractAtlasClaim();
                        showWarning(
                            'O atlas foi criado no servidor, mas não foi possível abri-lo agora. '
                            + 'Seus dados locais continuam aqui, intactos: abra o atlas em '
                            + '"Seus atlas".',
                            { duration: 10000 }
                        );
                        console.error('[AccountControl] activateRemoteAtlas failed:', error);
                        return;
                    }
                    // 3) Swap the local store for the new remote atlas, live.
                    // `markLocal: false`: REMOTE is declared on the next line (see the same
                    // reason in `openRemoteAtlas`).
                    await clearAllDataStore({ markLocal: false });
                    await markStoreRemote(result.atlasId);
                    await syncEngine.connect(result.atlasId, { initialPull: true });
                    await activateAtlasInitialMap();
                    // Render the now-current atlas map (see onPick) — the open path skips setupMapFeatures.
                    await getControl('BaseLayerControl')?.switchMap?.(false);
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
            'Excluir este atlas do servidor? Todos os colaboradores conectados serão desconectados.',
            { destructive: true, confirmText: 'Excluir' }
        );
        if (!first) return;
        const second = await showConfirm(
            'Confirmação final: o atlas será excluído para todos. Deseja prosseguir?',
            { destructive: true, confirmText: 'Excluir definitivamente' }
        );
        if (!second) return;

        try {
            await apiClient.deleteAtlas(atlasId);
            // The broadcast tears down every peer; tear ourselves down directly so we don't depend on
            // receiving our own `atlas_deleted` before the socket closes.
            await this._handleRemoteAtlasDeleted('excluido');
        } catch (error) {
            showError('Falha ao excluir o atlas');
            console.error('[AccountControl] deleteAtlas failed:', error);
        }
    }

    /**
     * Tears down after the connected atlas was deleted (by this user or another owner): stop
     * flushing, disconnect, wipe the remote store, return to a blank LOCAL atlas, and reopen the
     * picker. Idempotent — both the direct delete and the WS `atlas_deleted` broadcast can call it.
     * @param {'excluido'|'excluido-por-outro'} [notice] - Which explanation the chooser should show.
     * @private
     */
    async _handleRemoteAtlasDeleted(notice = 'excluido-por-outro') {
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
            // The explanation travels in the URL instead of a toast: the chooser is another PAGE
            // now, and a toast raised here would be destroyed by the navigation a line later.
            await this.openProjectPicker({ notice });
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
     * Public entry to open the login modal — used by the boot router when a `?atlas=` deep link is
     * hit while logged out, so the pending atlas resumes after authentication.
     */
    requestLogin() {
        return this._handleLogin();
    }

    /**
     * Open the login modal, authenticate, then advance to the project picker (or, when a `?atlas=`
     * deep link is pending, straight to that atlas).
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
                // A `?atlas=` deep link hit while logged out resumes straight to that atlas; otherwise
                // advance to project selection.
                const pending = consumePendingAtlasLink();
                if (pending) {
                    try {
                        const opened = await openRemoteAtlas(pending.atlasId, { mapId: pending.mapId });
                        if (opened) {
                            showSuccess('Atlas carregado do servidor');
                            return;
                        }
                        // User declined the "replace local work" confirm → fall through to the picker.
                    } catch (error) {
                        console.warn('[AccountControl] pending atlas resume failed:', error);
                        showError('Não foi possível abrir o atlas pedido. Escolha um atlas.');
                    }
                }
                // The modal closes on resolve; advance to project selection.
                await this.openProjectPicker();
            },
            onRegister: signupEnabled ? () => this._handleRegister() : undefined
        });
    }

    /**
     * Opens the self-registration modal.
     *
     * The backend answers the SAME 201 with the same body whether it created the account or found
     * the username/e-mail already taken — POST /auth/register used to answer 409 for an existing
     * account, which let anyone enumerate who has an account here. So this client CANNOT say "conta
     * criada": it does not know, and must not imply it. Both outcomes end in an e-mail, and the
     * message says exactly that. (The "Reenviar e-mail" affordance keeps working either way:
     * /auth/resend-verification is non-leaking by the same rule.)
     * @private
     */
    _handleRegister() {
        showSignupModal({
            onSubmit: async (data) => {
                await syncEngine.register(data);
                // An account created here is PENDING: the e-mail must be confirmed before login.
                const resend = await showConfirm(
                    `Enviamos um e-mail para ${data.email}. Se ainda não houver conta com esse endereço, ` +
                    'ele traz o link de confirmação do cadastro; se já houver, traz as instruções para ' +
                    'recuperar o acesso. Confira sua caixa de entrada.',
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
     * Leaves the map for the "Seus atlas" PAGE (`atlas.html`).
     *
     * This used to build the chooser as an overlay AND own the whole open pipeline (disconnect →
     * wipe → markRemote → connect → activate → switchMap → auto-flush) in two duplicated branches.
     * All of that now lives in exactly one place: the page navigates to `./?atlas=<uuid>` and the
     * map's boot router calls `openRemoteAtlas`. The unsaved-local-work question moved there too —
     * it fires when a project is actually opened, not when the list is merely shown.
     *
     * Clears the "Mapa local" intent: asking for the project list is the opposite of that choice,
     * and leaving it set would make the chooser page bounce straight back to the map.
     *
     * @param {Object} [options]
     * @param {string} [options.notice] - Key of a message for the chooser to show on arrival (a
     *   toast raised here would not survive the navigation).
     * @returns {Promise<void>}
     */
    async openProjectPicker({ notice } = {}) {
        clearLocalMapIntent();
        window.location.assign(notice
            ? `./atlas.html?aviso=${encodeURIComponent(notice)}`
            : './atlas.html');
    }

    /**
     * O CLIQUE EM "SAIR". Ele RESGATA e INFORMA, e não pergunta nada.
     *
     * O DEFEITO QUE ELE FECHA, medido: o clique chamava `_handleLogout()` sem argumento, a contagem
     * da fila era literalmente `involuntary ? await countPendingOperations() : 0`, e o ramo do wipe
     * levava junto o namespace do atlas com a fila de saída dentro. O trabalho que o servidor nunca
     * recebeu ia embora em silêncio.
     *
     * A PRIMEIRA VERSÃO DESTA CORREÇÃO PERGUNTAVA, com três saídas, e o dono do produto recusou a
     * pergunta com um argumento que decide o desenho: **o sincronismo ocorre sempre**. A fila só
     * tem conteúdo quando algo NÃO CONSEGUIU subir, nunca porque a pessoa escolheu não subir. Logo
     * não existe vontade a respeitar aqui, e a pergunta ofereceria como escolha um estado que
     * ninguém escolheu. O que sobra é o que o caminho involuntário já fazia: guardar e avisar.
     *
     * O QUE ISSO CUSTA, e é o custo aceito: quem sai com fila pendente ganha um atlas local a mais,
     * sem ter pedido. É recuperável (a pessoa apaga o slot), e a alternativa não é: trabalho
     * destruído não volta.
     *
     * SEM ATLAS DE SERVIDOR MONTADO NÃO HÁ NADA A RESGATAR. Não existe namespace remoto para a
     * saída destruir, e o atlas LOCAL não é tocado desde 2026-08-16.
     * @private
     */
    async _handleLogoutGesture() {
        this._closeMenu();
        const atlasId = mountedRemoteAtlasId();
        if (!atlasId) {
            await this._handleLogout();
            return;
        }
        const pendingOps = await countPendingOperations();
        // `shouldPreserveLocalWork` decide com a MESMA regra dos dois caminhos, e a contagem que
        // não se pôde medir preserva: destruir por causa de uma leitura que acabou de falhar é o
        // avesso do que este método existe para impedir.
        if (!shouldPreserveLocalWork({ involuntary: true, pendingOps })) {
            await this._handleLogout();
            return;
        }
        const atlasName = this._atlasCache?.id === atlasId ? this._atlasCache?.name : null;
        const guardado = await preserveUnsyncedWorkAsLocal(atlasId, atlasName);
        await this._handleLogout({ chosePreserve: guardado, pendingOps });
        if (guardado) showWarning(exitPreservedSummary(rescuedAtlasName(atlasName)));
        else showError(exitPreserveFailedNotice({ retained: rescueVetoRecorded(atlasId) }));
    }

    /**
     * Stop auto-flush, disconnect, and clear the local session identity.
     *
     * The wipe is NOT unconditional. On the involuntary path (see {@link handleSessionLost}) with
     * operations still queued, the data stays and is re-marked LOCAL — otherwise a transient
     * network failure upstream would delete work the server never received, and the next boot
     * guard would finish the job by discarding orphan remote data.
     *
     * ON THE VOLUNTARY PATH IT EXECUTES A DECISION ALREADY TAKEN. `chosePreserve` comes from
     * {@link _handleLogoutGesture}; called without it (the 401 handler, a test addressing the
     * teardown directly) the behaviour is exactly what it always was.
     * @param {Object} [options]
     * @param {boolean} [options.involuntary=false] - True when nobody clicked "Sair".
     * @param {boolean} [options.chosePreserve=false] - The user was asked and chose to keep the work.
     * @param {number} [options.pendingOps] - The count already measured by the gesture, so the
     *   toast can name it. Re-read here only on the involuntary path.
     * @private
     */
    async _handleLogout({ involuntary = false, chosePreserve = false, pendingOps: askedOps } = {}) {
        try {
            this._closeMenu();
            stopAutoFlush();
            // Read the queue BEFORE the teardown: this is the count at the moment the session died.
            const pendingOps = involuntary
                ? await countPendingOperations()
                : (askedOps ?? 0);
            const preserve = shouldPreserveLocalWork({ involuntary, pendingOps, chosePreserve });
            // WHICH atlas this tab holds, and under WHICH name, both read before the teardown
            // erases them: `logoutAndDisconnect` clears `syncEngine.atlasId` and the cache below
            // is dropped a few lines down. Without the id there is no namespace to rescue.
            const mountedAtlasId = mountedRemoteAtlasId();
            const mountedAtlasName = this._atlasCache?.id === mountedAtlasId
                ? this._atlasCache?.name
                : null;
            await syncEngine.logoutAndDisconnect();
            // Drop the collaboration UI and return to a BLANK LOCAL atlas: clear the
            // online-users roster (remote cursors + the connection light already hide via
            // the connection/session events), forget the cached atlas name, and wipe the
            // remote data so nothing server-side lingers in IndexedDB.
            presenceStore.clear();
            this._atlasCache = null;
            if (preserve) {
                // Keep the data AND the queue (clearAllDataStore drops both). Marking the store
                // LOCAL is no longer enough to make the rescue real, and the difference is the
                // whole of `preserveUnsyncedWorkAsLocal`: the work sits in a namespace the
                // logged-out purge deletes, so keeping it means moving the CLAIM to the local
                // registry first and only then flipping the marker.
                const resgatado = await preserveUnsyncedWorkAsLocal(mountedAtlasId, mountedAtlasName);
                if (resgatado) {
                    // DUAS FRASES, porque são dois fatos diferentes sobre o mesmo resgate. Dizer
                    // "sua sessão terminou" a quem acabou de clicar em "Sair" descreve um acidente
                    // onde houve uma decisão, e a pessoa fica procurando o erro que não houve.
                    showWarning(
                        chosePreserve
                            ? exitPreservedSummary(rescuedAtlasName(mountedAtlasName))
                            : 'Sua sessão terminou com alterações que ainda não foram enviadas ao '
                                + 'servidor. Elas foram mantidas neste computador como atlas local: '
                                + 'entre novamente e use "Enviar ao servidor".',
                        { duration: 10000 }
                    );
                } else if (chosePreserve) {
                    // O TOAST RELATA O EFEITO MEDIDO. `preserveUnsyncedWorkAsLocal` devolve falso
                    // quando a adoção lança OU quando a releitura do disco não acha o slot, e nos
                    // dois casos NADA reivindica o namespace. Prometer resgate aqui é a mentira que
                    // o caminho involuntário já pagou uma vez.
                    showError(
                        exitPreserveFailedNotice({ retained: rescueVetoRecorded(mountedAtlasId) }),
                        { duration: 0 }
                    );
                } else {
                    // A MENSAGEM DIZ O QUE ACONTECEU, e antes ela dizia o contrário: este toast
                    // era incondicional, então um resgate que falhou anunciava que o trabalho
                    // estava salvo. O usuário fechava a aba tranquilo e o dado ia embora no
                    // boot seguinte.
                    //
                    // E AGORA HÁ DUAS FALHAS DIFERENTES, então há duas mensagens. Com o veto
                    // gravado o trabalho sobrevive a fechar a aba, por prazo, e mandar não fechar
                    // seria assustar sem motivo; sem ele (armazenamento indisponível) a aba viva é
                    // de fato a última garantia. Ler o veto é o que separa as duas: uma frase fixa
                    // teria que estar errada num dos dois casos, que é a forma de mentira que este
                    // caminho inteiro existe para remover.
                    showError(
                        rescueVetoRecorded(mountedAtlasId)
                            ? 'Sua sessão terminou e NÃO foi possível guardar as alterações '
                                + 'pendentes como atlas local. Elas continuam neste computador '
                                + 'por tempo limitado: entre novamente o quanto antes para que '
                                + 'sejam enviadas ao servidor.'
                            : 'Sua sessão terminou e NÃO foi possível guardar as alterações '
                                + 'pendentes como atlas local. Não feche esta aba: entre '
                                + 'novamente para que elas sejam enviadas ao servidor.',
                        { duration: 0 }
                    );
                }
            } else {
                // TWO CALLS, AND THE ORDER MATTERS. `clearAllDataStore` empties the atlas THIS
                // tab has mounted; the sweep destroys every OTHER server namespace registered on
                // this machine, including one left behind by a tab that crashed. The sweep used
                // to ride inside the wipe under a `!isAuthenticated` test, which made every
                // anonymous wipe in the app behave like a logout (the public-link visitor
                // destroyed the namespace it had just registered). It is named here because this
                // is one of exactly two places that mean "the session is over".
                //
                // THE WARNING COMES FIRST, and "first" is the whole point: a sibling tab has to
                // stop writing BEFORE the emptying. The lock waits for the acks (or for its
                // timeout) before this returns, so the two calls below run after the other tabs
                // have stopped.
                //
                // `discardRemoteAtlasNamespaces` announces on its own now (the boot guard runs the
                // same sweep and used to warn nobody), so this line is not what keeps the sibling
                // safe from the SWEEP. It is here for the call in between: `clearAllDataStore`
                // empties the namespace THIS tab has mounted, and a notice sent from inside the
                // sweep would arrive after that.
                //
                // O WIPE SÓ ALCANÇA UM ATLAS DE SERVIDOR, e isso é decisão de produto tomada em
                // 2026-08-16, depois de a contradição aparecer duas vezes:
                //
                //   "O uso dos dados locais não depende de estar logado. Deslogado se acessa
                //    todos os locais; estar logado só dá acesso aos remotos. Ao deslogar, tira-se
                //    o acesso aos remotos, e não se sai de repositório local nem se apaga nada
                //    local."
                //
                // `clearAllDataStore` esvazia o atlas que ESTA aba montou, e com um namespace por
                // atlas esse atlas pode perfeitamente ser LOCAL: um `.ebgeo` importado nasce num
                // slot próprio, e "Mapa local" é um slot. Apagá-lo ao sair da conta destrói
                // trabalho que nunca teve relação com a sessão que terminou.
                //
                // O QUE A SAÍDA DA CONTA PRECISA DESTRUIR é dado de SERVIDOR, e disso cuida
                // `discardRemoteAtlasNamespaces`, derivado do registro remoto e capaz de alcançar
                // até o namespace que outra aba abriu. Com um atlas local montado não há o que
                // este wipe termine.
                //
                // O REPRO DE USUÁRIO QUE PARECIA EXIGIR O CONTRÁRIO
                // (`tests/e2e-ui/browser-logout-clears-map.repro.spec.js`, "após Sair, as feições
                // do mapa antigo continuam desenhadas no canvas") foi escrito quando local e
                // remoto dividiam os mesmos dez bancos: o "mapa antigo" dele era o do SERVIDOR, e
                // esvaziar tudo era a única forma de alcançá-lo. Aquele spec foi reescrito para
                // afirmar o que o usuário de fato relatou.
                await announceRemoteNamespaceTeardown();
                if (isRemoteStoreSync()) {
                    await clearAllDataStore();
                }
                await discardRemoteAtlasNamespaces();
                // AQUI NÃO SE ANUNCIA NADA, e a razão mudou junto com a decisão do dono sobre a
                // saída voluntária. Enquanto o clique perguntava, este ramo era o "descartei N
                // operações a seu pedido". Sem a pergunta, chegar aqui com fila significa que o
                // RESGATE FALHOU, e quem sabe disso é `_handleLogoutGesture`, que já mostra o aviso
                // de falha nomeando se o namespace ficou retido. Um segundo toast daqui diria a
                // mesma coisa com outras palavras, e o pior par de avisos é o que se contradiz.
            }
            // Tab lock, the logout flow: this tab is no longer in a server atlas, so it must stop
            // claiming one — otherwise logging out here would lock every other tab out of the
            // server until this one is closed. The reactive listener cannot do it: nothing moves
            // the active store SCOPE back to a local slot before the next boot, so the derived key
            // would still read `remote` and be taken for an unchanged claim.
            //
            // NOT when the work was preserved. That branch keeps un-synced data sitting in the very
            // scratch another tab's `clearAllDataStore` would wipe, so the claim is still true and
            // dropping it would expose exactly the work this path exists to rescue. The adoption
            // does not change that: it moves the CLAIM to the local registry and keeps the
            // `remote-<atlasId>` suffix (zero copy), so those databases are still the ones another
            // tab reaches by opening that same server atlas, and `remote:<atlasId>` still names them.
            if (!preserve) retractAtlasClaim();
            // The "Mapa local" choice belonged to the session that just ended; leaving it set would
            // silently opt the NEXT identity out of the project chooser on this tab.
            clearLocalMapIntent();
            this._username = null;
            this._render();
        } catch (error) {
            showError('Falha ao sair da conta');
            console.error('[AccountControl] logout failed:', error);
        }
    }

    /**
     * Session lost mid-use (idle timeout, or a refresh that finally failed): tear down and re-open
     * login. Guarded against concurrent triggers (idle + a 401 racing).
     *
     * INVOLUNTARY by definition — nobody asked for this — so the teardown keeps un-synced work
     * instead of wiping it (see {@link shouldPreserveLocalWork}).
     * @param {string} [message] - A toast explaining why the user is back at the login screen.
     */
    async handleSessionLost(message) {
        if (this._sessionLostHandling) return;
        this._sessionLostHandling = true;
        try {
            if (sessionContext.isAuthenticated()) {
                await this._handleLogout({ involuntary: true });
            }
            if (message) showWarning(message);
            // The idle-timeout and the lost-auth (401) paths can both reach this near-simultaneously;
            // don't stack a second login modal if one is already up.
            if (!document.querySelector('[data-testid="login-modal"]')) {
                this.requestLogin();
            }
        } finally {
            this._sessionLostHandling = false;
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
        this._projectsBtn = null;
        this._deleteAtlasBtn = null;
        this._adminBtn = null;
        this._accountBtn = null;
        this._calibrationBtn = null;
        this._roleLabel = null;
        this._roleName = null;
        this._roleOrg = null;
        this._atlasLevelEl = null;
        this._saveToServerBtn = null;
        this._onDocPointerDown = null;
        this._onKeyDown = null;
        this._map = undefined;
    }
}


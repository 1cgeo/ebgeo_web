// Path: js/account/account.control.js
import { showLoginModal } from '@modals/login.modal.js';
import { showSignupModal } from '@modals/signup.modal.js';
import config from '@js/config.js';
import { showConfirm } from '@modals/index.js';
import { clearLocalMapIntent } from '@js/deep-link/local-intent.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { apiClient } from '@store/sync/api-client.js';
import { operationQueue } from '@store/sync/operation-queue.js';
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
    getStoreOriginSync,
    adoptRemoteAtlasAsLocal
} from '@store/store.js';
import { remoteScope, readLocalAtlasRegistry } from '@store/atlas-namespace.js';
import {
    retainRemoteAtlasForRescue,
    releaseRemoteAtlasRescueVeto,
    remoteAtlasRescueVetoSince
} from '@store/remote-atlas.api.js';
import { getControl } from '@store';
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
 * Whether a teardown must PRESERVE the local data instead of wiping it.
 *
 * A logout the user CLICKED is a decision: the remote data goes, as it always did. A teardown the
 * user did not ask for (`handleSessionLost`, reached from a failed token refresh) is a network
 * accident, and wiping IndexedDB there turned a transient 429/5xx into the irreversible loss of
 * whatever had not yet been drained from the operation queue. Keeping data nobody asked to keep is
 * recoverable; deleting work is not.
 *
 * An UNKNOWN pending count (the queue read failed — NaN/undefined) preserves too: the whole point
 * is to not destroy on the strength of something that just went wrong.
 *
 * Pure — no I/O, no module state.
 * @param {Object} params
 * @param {boolean} [params.involuntary=false] - True when the session ended without a user gesture.
 * @param {number} [params.pendingOps=0] - Operations still queued for the server.
 * @returns {boolean}
 */
export function shouldPreserveLocalWork({ involuntary = false, pendingOps = 0 } = {}) {
    if (!involuntary) return false;
    if (!Number.isFinite(pendingOps)) return true;
    return pendingOps > 0;
}

/**
 * Name the rescued atlas takes in the LOCAL registry.
 *
 * The atlas name is what the user recognises, so it is preferred; the dated fallback exists
 * because the cached name can be missing (a session lost before the atlas metadata was read),
 * and an atlas called "undefined" in the local list is a rescue the user cannot identify.
 *
 * Pure — no I/O, no module state.
 * @param {string|null|undefined} atlasName - Name of the server atlas, when known.
 * @returns {string} A non-empty pt-BR name.
 */
export function rescuedAtlasName(atlasName) {
    const trimmed = typeof atlasName === 'string' ? atlasName.trim() : '';
    if (trimmed.length > 0) return trimmed;
    return `Trabalho recuperado — ${new Date().toLocaleDateString('pt-BR')}`;
}

/**
 * THE RESCUE. Keeps the unsynced work of a dead session by moving its namespace from the REMOTE
 * registry to the LOCAL one, and only then marking the store LOCAL.
 *
 * WHY IT IS NOT JUST `markStoreLocal()` ANY MORE. It used to be, and that was correct while
 * local and remote data shared one set of databases: flipping the marker was enough to make the
 * boot guard keep the data. Every server atlas now owns a namespace (`atlas-namespace.js`
 * Decision 1) that `purgeAllRemoteAtlases` DELETES whenever nobody is authenticated, which is
 * precisely the state this path leaves the app in. Without the adoption the preserved work would
 * be erased by the very next boot, with the warning toast still promising it was kept.
 *
 * THE ORDER IS THE CONTRACT, and it is the adoption's own (see `adoptRemoteAtlasAsLocal`): the
 * local claim is written first, so a crash mid-flight leaves the namespace claimed by BOTH
 * registries, which the purge resolves in favour of the local one. Marking the store LOCAL last
 * is the same rule one level up: a marker that says LOCAL over a namespace no local atlas claims
 * is data the purge deletes while the boot guard believes it is safe.
 *
 * A failure to adopt is logged and swallowed on purpose: the caller is a logout, and throwing
 * here would abort the teardown (the lock retraction, the intent reset, the re-render) over a
 * rescue that has already failed.
 *
 * AND A FAILURE NO LONGER MEANS THE WORK DIES. Returning false stopped the toast from lying, and
 * that was only half of it: nobody claimed the namespace, so the next logged-out sweep destroyed
 * the only copy of work the server never received, and the user was accurately informed of a loss
 * instead of being deceived about it. Every exit that fails now VETOES that destruction
 * (`retainRemoteAtlasForRescue`), which keeps the namespace for a bounded time so the login the
 * error toast asks for still finds the work. The veto is recorded outside IndexedDB on purpose,
 * and its deadline is not optional; the reasoning for both is in `remote-atlas.api.js`.
 *
 * @param {string|null} atlasId - Server atlas whose namespace holds the work, or null when this
 *   tab had none mounted (then there is nothing to adopt and only the marker changes).
 * @param {string|null} [atlasName] - Display name of that atlas, for the local registry.
 * @returns {Promise<boolean>} True when the work is on record as a LOCAL atlas.
 */
export async function preserveUnsyncedWorkAsLocal(atlasId, atlasName = null) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) {
        // Nada de remoto montado, logo nada a resgatar: o estado final já é o correto e
        // nenhum trabalho está em risco. Marcar LOCAL aqui é o comportamento de sempre.
        await markStoreLocal();
        return true;
    }

    try {
        await adoptRemoteAtlasAsLocal(atlasId, rescuedAtlasName(atlasName));
    } catch (error) {
        // NÃO MARCA LOCAL, e é aqui que estava a perda. O catch existia e engolia; o
        // `markStoreLocal()` rodava logo abaixo, incondicional. O resultado era o pior
        // estado possível: o marcador dizia LOCAL sobre um namespace que NENHUM atlas local
        // reivindica, então a próxima varredura de deslogado o destruía — e o usuário já
        // tinha lido "suas alterações foram mantidas neste computador".
        //
        // Deixando o marcador em REMOTE, o namespace continua reivindicado pelo registro
        // remoto e o próximo boot ainda pode tentar de novo. Perder o trabalho é
        // irreversível; deixar dado remoto um boot a mais no disco não é.
        console.error('[AccountControl] rescuing unsynced work as a local atlas failed:', error);
        return failedRescueKeepsNamespace(atlasId);
    }

    // READ-BACK, do DISCO, antes de declarar sucesso. `adoptRemoteAtlasAsLocal` não lançar
    // não é a mesma coisa que a entrada ter sido persistida: a escrita do registro pode ter
    // falhado por cota sem rejeitar de forma que este caminho perceba, e o espelho em memória
    // concordaria com o otimismo em vez de com o disco.
    const { dbSuffix } = remoteScope(atlasId);
    const adotado = (await readLocalAtlasRegistry()).some(e => e.dbSuffix === dbSuffix);
    if (!adotado) {
        console.error('[AccountControl] rescue reported success but the slot is not on disk');
        return failedRescueKeepsNamespace(atlasId);
    }

    // The work IS a local atlas now, so the namespace is claimed by the local registry and the
    // sweep skips it on that account. A veto left over from an earlier failed attempt would only
    // add a second, weaker reason to keep databases that are no longer server data at all.
    releaseRemoteAtlasRescueVeto(atlasId);
    await markStoreLocal();
    return true;
}

/**
 * The one exit of a FAILED rescue: keep the namespace instead of letting the next sweep destroy
 * the only copy of unsent work, and always answer false.
 *
 * It exists as a function because the rescue fails in two different places (the adoption throwing,
 * and the read-back finding no slot on disk) and both have to take this exit. When they returned a
 * bare false, the second one was the easy one to forget, and forgetting it loses exactly the data
 * the read-back was added to protect.
 *
 * @param {string} atlasId - Server atlas whose namespace holds the unsynced work.
 * @returns {Promise<false>} Always false: the caller must not mark the store LOCAL nor tell the
 *   user the work was kept as a project. Retention buys time for a retry, it is not a rescue.
 */
async function failedRescueKeepsNamespace(atlasId) {
    if (!await retainRemoteAtlasForRescue(atlasId)) {
        // No storage to record the veto in, so the next logged-out sweep WILL destroy the work.
        // Said out loud because the alternative is the class this whole path exists to remove: a
        // guard that fails silently in the one moment it is needed.
        console.error(
            `[AccountControl] the unsynced work of atlas ${atlasId} could not be protected `
            + 'from the next logged-out sweep'
        );
    }
    return false;
}

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
 * Reads the pending-operation count without ever throwing. NaN means "unknown", which
 * {@link shouldPreserveLocalWork} treats as a reason to preserve.
 * @returns {Promise<number>}
 */
async function countPendingOperations() {
    try {
        const count = await operationQueue.count();
        return Number.isFinite(count) ? count : NaN;
    } catch (error) {
        console.warn('[AccountControl] pending operation count failed:', error);
        return NaN;
    }
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
        /** @type {HTMLButtonElement|null} The "Seus projetos" menu item (any signed-in user). */
        this._projectsBtn = null;
        /** @type {HTMLButtonElement|null} The "Enviar ao servidor" menu item (logged-in + local store). */
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

        // "Seus projetos" — back to the chooser page. Shown to anyone signed in: it is the way
        // OUT of the current atlas (and out of the local map) without logging out, which the menu
        // previously offered no route to at all.
        this._projectsBtn = document.createElement('button');
        this._projectsBtn.type = 'button';
        this._projectsBtn.className = 'account-control__btn account-control__btn--projects';
        this._projectsBtn.setAttribute('role', 'menuitem');
        this._projectsBtn.setAttribute('data-testid', 'account-projects-btn');
        setMenuButtonContent(this._projectsBtn, ICON_PROJECTS, 'Seus projetos');
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
        addDomListener(this, this._projectsBtn, 'click', () => this._handleOpenProjects());
        addDomListener(this, this._saveToServerBtn, 'click', () => this.saveLocalToServer());
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
            this._updateProjectsVisibility();
            this._updateProjectsVisibility();
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
        this._updateProjectsVisibility();
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
        this._updateProjectsVisibility();
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
     * Shows "Seus projetos" to anyone signed in — connected or on the local map. It is the only
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
     * "Salvar atlas local no servidor": packages the current LOCAL store as a NEW server atlas,
     * then switches the app to that atlas live. The upload READS the local store, so it runs BEFORE
     * `clearAllDataStore`. Sharing chosen in the create dialog is applied to the new atlas.
     *
     * PUBLIC because the Maps tab offers the same action (the menu item alone was too well hidden
     * to be found). One flow, two entry points — never two implementations.
     * @returns {Promise<void>}
     */
    async saveLocalToServer() {
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
                            'O projeto foi criado no servidor, mas outra aba assumiu este projeto '
                            + 'enquanto isso. Seus dados locais continuam aqui, intactos: feche a '
                            + 'outra aba e abra o projeto em "Seus projetos".',
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
                            'O projeto foi criado no servidor, mas não foi possível abri-lo agora. '
                            + 'Seus dados locais continuam aqui, intactos: abra o projeto em '
                            + '"Seus projetos".',
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
            await this._handleRemoteAtlasDeleted('excluido');
        } catch (error) {
            showError('Falha ao excluir o projeto');
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
                            showSuccess('Projeto carregado do servidor');
                            return;
                        }
                        // User declined the "replace local work" confirm → fall through to the picker.
                    } catch (error) {
                        console.warn('[AccountControl] pending atlas resume failed:', error);
                        showError('Não foi possível abrir o projeto pedido. Escolha um projeto.');
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
     * Leaves the map for the "Seus projetos" PAGE (`projetos.html`).
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
            ? `./projetos.html?aviso=${encodeURIComponent(notice)}`
            : './projetos.html');
    }

    /**
     * Stop auto-flush, disconnect, and clear the local session identity.
     *
     * The wipe is NOT unconditional. On the involuntary path (see {@link handleSessionLost}) with
     * operations still queued, the data stays and is re-marked LOCAL — otherwise a transient
     * network failure upstream would delete work the server never received, and the next boot
     * guard would finish the job by discarding orphan remote data.
     * @param {Object} [options]
     * @param {boolean} [options.involuntary=false] - True when nobody clicked "Sair".
     * @private
     */
    async _handleLogout({ involuntary = false } = {}) {
        try {
            this._closeMenu();
            stopAutoFlush();
            // Read the queue BEFORE the teardown: this is the count at the moment the session died.
            const pendingOps = involuntary ? await countPendingOperations() : 0;
            const preserve = shouldPreserveLocalWork({ involuntary, pendingOps });
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
                    showWarning(
                        'Sua sessão terminou com alterações que ainda não foram enviadas ao servidor. '
                        + 'Elas foram mantidas neste computador como projeto local — entre novamente e '
                        + 'use "Enviar ao servidor".',
                        { duration: 10000 }
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
                        remoteAtlasRescueVetoSince(mountedAtlasId) > 0
                            ? 'Sua sessão terminou e NÃO foi possível guardar as alterações '
                                + 'pendentes como projeto local. Elas continuam neste computador '
                                + 'por tempo limitado: entre novamente o quanto antes para que '
                                + 'sejam enviadas ao servidor.'
                            : 'Sua sessão terminou e NÃO foi possível guardar as alterações '
                                + 'pendentes como projeto local. Não feche esta aba: entre '
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
        this._settingsBtn = null;
        this._deleteAtlasBtn = null;
        this._adminBtn = null;
        this._saveToServerBtn = null;
        this._onDocPointerDown = null;
        this._onKeyDown = null;
        this._map = undefined;
    }
}


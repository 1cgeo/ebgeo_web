// Path: js/projects/projects-page.js

/**
 * @module projects/projects-page
 * @description Entry point of `projetos.html` — the project chooser as a page of its own.
 *
 * Signing in used to drop you on the map with a full-screen chooser floating over it; the map you
 * had not chosen yet was already booted behind the dialog, and dismissing it left you in a blank
 * local workspace nobody asked for. As a page, choosing a project happens BEFORE any map exists.
 *
 * Like `admin.html`, this boots without MapLibre, without the store and without `initServices()`:
 * the whole surface is the API client, the session context, the runtime config and the dialog/toast
 * primitives. Importing `@store`, or the `@utils`/`@modals` barrels (which reach the store
 * transitively), would silently drag the entire map foundation back in.
 *
 * Opening a project is a NAVIGATION to `./?atlas=<uuid>`: the map page's boot router already knows
 * how to open an atlas from the URL, including wiping the local store, connecting, and asking what
 * to do with unsaved local work. Duplicating that pipeline here is what the page removes.
 */

import config from '@js/config.js';
import { applyRuntimeConfig, resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { apiClient, configureApiClient } from '@store/sync/api-client.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showUnavailableScreen } from '@ui/unavailable-screen.js';
import { createAppBar } from '@ui/app-bar.js';
import { startIdleWatch } from '../session/idle-watch.js';
import { showError, showSuccess, showWarning } from '@utils/toast_service.js';
// From the FILE, never from the `@utils` barrel: the barrel reaches `@store` transitively.
import { initTabLock, noneKey } from '@utils/tab-lock.js';
import { AtlasDrive } from './atlas-drive.js';
import { LOCAL_INTENT_KEY } from '../deep-link/local-intent.js';

/** The map page. Relative — the app may be served from a subpath. */
const MAP_URL = './';
const ADMIN_URL = './admin.html';

const CONFIG_BOOT_ATTEMPTS = 3;
const CONFIG_BOOT_RETRY_MS = 1000;

const ICON_DRIVE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`;
const ICON_MAP = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" opacity="0"/><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>`;
const ICON_ADMIN = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

/**
 * Fetches the runtime config with a few retries; a real outage gets the branded screen.
 * @returns {Promise<boolean>}
 */
async function bootConfig() {
    for (let attempt = 1; attempt <= CONFIG_BOOT_ATTEMPTS; attempt++) {
        const result = await applyRuntimeConfig({ apiClient });
        if (result.applied) return true;
        if (attempt < CONFIG_BOOT_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, CONFIG_BOOT_RETRY_MS));
        }
    }
    return false;
}

/**
 * Restores the persisted login into the session context. Any failure clears the tokens, which is
 * what stops a stale token from ping-ponging between this page and the map's boot redirect.
 * @returns {Promise<boolean>}
 */
async function restoreSession() {
    try {
        if (!apiClient.loadStoredTokens()) return false;
        const user = await apiClient.getMe();
        sessionContext.setSession({
            userId: user.id,
            role: user.org_role || 'viewer',
            globalRole: user.role || 'user',
            username: user.username || user.nome,
        });
        return true;
    } catch {
        apiClient.clearTokens();
        return false;
    }
}

/** Removes the boot splash once the page is ready to be seen. */
function clearSplash() {
    document.getElementById('initial-loader')?.remove();
}

/** Why the map sent the user here, and how to say it. */
const ARRIVAL_NOTICES = Object.freeze({
    excluido: 'Projeto excluído.',
    'excluido-por-outro': 'Este projeto foi excluído pelo proprietário.',
});

/**
 * Explains an arrival the user did not ask for — the atlas they had open was deleted, so the map
 * tore itself down and sent them here with `?aviso=<motivo>`. The message travels in the URL
 * because a toast raised on the map would be destroyed by the navigation that follows it.
 * One-shot: the param is stripped so a reload does not repeat it. Unknown values are ignored
 * rather than echoed.
 */
function explainArrivalFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const notice = params.get('aviso');
    if (!notice) return;
    const message = ARRIVAL_NOTICES[notice];
    if (message) showWarning(message);
    params.delete('aviso');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
}

/**
 * Goes to the map WITHOUT a server project, and records that this was deliberate so the map's boot
 * router does not bounce a signed-in user straight back here. Session-scoped on purpose: the intent
 * belongs to this tab and this sitting, and must not leak into a shared link.
 */
function goToLocalMap() {
    try {
        sessionStorage.setItem(LOCAL_INTENT_KEY, '1');
    } catch {
        // Storage disabled: the map will redirect back here. Annoying, never destructive.
    }
    window.location.assign(MAP_URL);
}

/** Opens an atlas by navigating; the map page's boot router does the rest. */
function openAtlas(atlasId) {
    window.location.assign(`${MAP_URL}?atlas=${encodeURIComponent(atlasId)}`);
}

/**
 * Creates a project straight from a `.ebgeo` file and opens it. The importer (and JSZip with it)
 * is loaded ON DEMAND: it is worth ~100 kB and most visits never import anything.
 * @param {File} file
 */
async function importProjectFromFile(file) {
    try {
        const { importEbgeoAsAtlas } = await import('./import-ebgeo.service.js');
        const { atlasId, name, stats, imageStats } = await importEbgeoAsAtlas(file, { apiClient });
        const lost = (imageStats.skipped || 0) + (imageStats.failed || 0);
        showSuccess(
            `"${name}" importado (${stats.maps} mapa(s), ${stats.features} feição(ões))`
            + (lost > 0 ? ` — ${lost} imagem(ns) não enviada(s)` : '')
        );
        openAtlas(atlasId);
    } catch (error) {
        console.error('[projects] .ebgeo import failed:', error);
        showError(error?.message || 'Falha ao importar o arquivo .ebgeo.');
    }
}

/**
 * Ends the session and returns to the map.
 * @param {string} [reason] - Carried as `?sessao=<reason>` so the map can explain itself.
 */
async function endSession(reason) {
    try {
        await apiClient.logout();
    } catch {
        // logout() already swallows network errors and clears locally.
    }
    sessionContext.clearSession();
    window.location.replace(reason ? `${MAP_URL}?sessao=${encodeURIComponent(reason)}` : MAP_URL);
}

/**
 * Applies the sharing staged in the create dialog to a freshly-created atlas (the creator is the
 * owner). Best-effort per item so one failure does not abort the others.
 * @param {string} atlasId
 * @param {{ isPublic?: boolean, members?: Array<{userId: string, permission: string}> }} [sharing]
 */
async function applyAtlasSharing(atlasId, sharing) {
    if (!sharing) return;
    if (sharing.isPublic) {
        try {
            await apiClient.enablePublicSharing(atlasId);
        } catch (error) {
            console.warn('[projects] enablePublicSharing failed:', error);
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
            console.warn('[projects] addShare failed:', error);
        }
    }
}

/** @returns {AppBarAction[]} The page actions: back to the local map, and Administração for admins. */
function buildActions() {
    const actions = [{
        label: 'Mapa local',
        icon: ICON_MAP,
        testid: 'projects-local-map',
        title: 'Trabalhar no mapa local, sem projeto do servidor',
        onClick: goToLocalMap,
    }];
    if (sessionContext.isAdmin()) {
        actions.push({
            label: 'Administração',
            icon: ICON_ADMIN,
            testid: 'projects-admin',
            onClick: () => window.location.assign(ADMIN_URL),
        });
    }
    return actions;
}

/**
 * Boots the "Seus projetos" page.
 * @returns {Promise<void>}
 */
async function initProjectsPage() {
    configureApiClient({ baseUrl: resolveBackendBaseUrl() });

    if (!(await bootConfig())) {
        showUnavailableScreen();
        return;
    }
    document.title = `Seus projetos — ${config?.app?.title || 'EBGeo'}`;

    // Signed out (or a token the server no longer honours): there is no login UI here — the map
    // owns that — so send them to the map, where "Entrar" lives.
    if (!(await restoreSession())) {
        window.location.replace(MAP_URL);
        return;
    }

    // Joins the multi-tab channel holding NOTHING (`tab-lock.js`, section 1: the arbitration is
    // over which tab may hold which ATLAS, and this page holds none). So it never blocks and is
    // never blocked, which is what keeps "map in one tab, chooser in another" working; it stays
    // visible in every peer's roster, which is the whole point of announcing. No overlay: a page
    // that cannot be blocked has nothing to render, and it does not load `tab-lock.css` either.
    // Announced only past the gate, so a tab that is about to redirect does not join and leave.
    initTabLock({ key: noneKey(), overlayHost: null });

    let projects = [];
    try {
        projects = await apiClient.listAtlas();
    } catch (error) {
        console.error('[projects] listAtlas failed:', error);
        showError('Não foi possível carregar a lista de projetos.');
    }

    clearSplash();
    explainArrivalFromUrl();

    const appBar = createAppBar({
        icon: ICON_DRIVE,
        title: 'Seus projetos',
        subtitle: config?.app?.title || 'EBGeo',
        user: { id: sessionContext.userId, name: sessionContext.username },
        actions: buildActions(),
        onLogout: () => { endSession(); },
    });
    document.body.appendChild(appBar.element);

    new AtlasDrive({
        projects,
        onPick: (atlasId) => openAtlas(atlasId),
        onCreate: async (name, sharing) => {
            const atlas = await apiClient.createAtlas({ name });
            await applyAtlasSharing(atlas.id, sharing);
            openAtlas(atlas.id);
        },
        onImport: (file) => importProjectFromFile(file),
    }).mount(document.body);

    apiClient.setAuthLostHandler(() => { endSession('encerrada'); });
    startIdleWatch({ onExpire: () => { endSession('inatividade'); } });
}

initProjectsPage().catch((error) => {
    console.error('Projects page initialization failed:', error);
    clearSplash();
    showUnavailableScreen();
});

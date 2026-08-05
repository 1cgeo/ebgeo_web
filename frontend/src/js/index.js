// Path: js/index.js

/**
 * @module index
 * @description Application entry point.
 *
 * Orchestrates initialization in explicit sequential phases:
 * 1. Config — Apply app title, attach config helpers
 * 2. Services — EventBus, StateManager, LayerManager, GroupManager
 * 3. Map — MapLibre GL instance with tile error handling
 * 4. Controls — All tools, UI components, control registrations
 * 5+6. State + UI — IndexedDB load, map load handler, deep linking
 */

import { initializeAppConfig } from './config-loader.js';
import { initConfigHelpers } from './config.helpers.js';
import { applyRuntimeConfig, resolveBackendBaseUrl } from '@store/sync/runtime-config.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { apiClient } from '@store/sync/api-client.js';
import { cleanup3DFeatures } from './3d_models_viewer_tool/index.js';
import { initServices, loadStoreOrigin, markStoreRemote, clearAllDataStore, activateAtlasInitialMap, getControl } from './store';
import { sessionContext } from '@store/sync/session-context.js';
import { openRemoteAtlas } from './account/open-atlas.service.js';
import { parseAtlasLink, setPendingAtlasLink, clearAtlasUrl } from './deep-link/atlas-link.js';
import { hasLocalMapIntent } from './deep-link/local-intent.js';
import { initAtlasUrlSync } from './deep-link/atlas-url-sync.js';
import { IdleTimeoutController } from './session/idle-timeout.controller.js';
import { getViewModeController } from '@ui/view-mode.controller.js';
import { showToast } from '@utils';
import { createMap, createControls, initializeApp, setupCleanupHandlers } from './map_sig.js';
import { initTabLock } from '@utils/tab-lock.js';
import { installWindowBridge, setTracing, resolveTraceFlag } from '@store/sync/diag/trace-core.js';
import { showUnavailableScreen } from '@ui/unavailable-screen.js';

// ============================================================================
// BOOTSTRAP
// ============================================================================

/**
 * Main application initialization.
 * Runs phases sequentially — no side-effects at import time.
 */
async function initApp() {
    // Capture the URL deep-link params at the VERY TOP, before any async boot work. The store boot
    // (initializeWithLastActiveMap, kicked off inside initializeApp) and initAtlasUrlSync emit
    // MAP_LOCK_CHANGED early, and atlas-url-sync strips `?atlas` for an anonymous visitor — so reading
    // the URL later (in the boot router below) loses the link and the login prompt never opens.
    // Reading here, before the first await, is the only point guaranteed to still see the original URL.
    const bootPublicLink = new URLSearchParams(window.location.search).get('atlasPublico');
    const bootAtlasLink = parseAtlasLink();

    // Phase -1: page routing. A signed-in visitor arriving at a bare `/` is here to CHOOSE a
    // project, so send them to the chooser page BEFORE building a map they did not ask for — that
    // is the whole point of `projetos.html` being a page. Everything else stays on the map: a deep
    // link (`?atlas`/`?atlasPublico`), a one-shot `?verify`, an explicit "Mapa local", or nobody
    // signed in at all.
    //
    // Reads the token WITHOUT validating it: validation costs a round trip, and `projetos.html`
    // validates on arrival anyway — a token the server rejects is cleared there and the page sends
    // the user back here, now anonymous. That is what keeps the two redirects from ping-ponging.
    if (shouldRouteToProjects(bootAtlasLink, bootPublicLink)) {
        window.location.replace('./projetos.html');
        return;
    }

    // Phase 0: SyncLedger observability — install the window.__ebgeoSyncTrace bridge and
    // enable capture only if a trace flag is present (?trace=sync / localStorage['ebgeo_trace']
    // / a globalThis.__EBGEO_TRACE__ set by Playwright addInitScript). Flag-gated and zero-cost
    // when off; fully fail-safe so it never blocks boot.
    try {
        installWindowBridge();
        setTracing(resolveTraceFlag());
    } catch (error) {
        console.warn('SyncLedger trace bridge init failed:', error);
    }

    // Phase 1: Config. The deploy ALWAYS ships a backend and it is the SINGLE source of
    // config/catalog (the bundled config.js is just a shell hydrated by /api/config). Boot is
    // FAIL-FAST: if /api/config is unreachable there is nothing to run on, so we show the branded
    // "EBGeo indisponível" screen and stop instead of booting on an empty/stale config.
    try {
        syncEngine.configure({ baseUrl: resolveBackendBaseUrl() });
    } catch (error) {
        console.warn('Sync engine configuration failed:', error);
    }
    // Fetch the backend config with a few retries — a transient blip at boot must not take the app
    // down. Only a real outage (all attempts fail) reaches the branded unavailable screen.
    const CONFIG_BOOT_ATTEMPTS = 3;
    const CONFIG_BOOT_RETRY_MS = 1000;
    let runtimeConfig = { applied: false };
    for (let attempt = 1; attempt <= CONFIG_BOOT_ATTEMPTS; attempt++) {
        runtimeConfig = await applyRuntimeConfig({ apiClient });
        if (runtimeConfig.applied) break;
        if (attempt < CONFIG_BOOT_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, CONFIG_BOOT_RETRY_MS));
        }
    }
    if (!runtimeConfig.applied) {
        showUnavailableScreen();
        return;
    }

    initializeAppConfig();
    initConfigHelpers();

    // Phase 2: Services (EventBus, StateManager, LayerManager, GroupManager, MapResolver)
    initServices();

    // Keep the address-bar `?atlas=&map=` reconciled with the live connection from here on. Wired
    // early (before session restore / connect) so it reflects every open path; it never clears a
    // pending `?atlas=` deep link while logged-in-but-not-yet-connected (the boot window).
    initAtlasUrlSync();

    // Phase 2.5: Restore a persisted login so the session survives F5 until the JWT/refresh
    // token expires. MUST run before the store boot (initializeApp → initializeWithLastActiveMap)
    // so the boot guard sees the authenticated session and keeps a cached remote atlas rather
    // than discarding it. Fully fail-safe: no stored token, or any error, leaves the anonymous
    // offline path completely unchanged.
    await restoreSessionFromStorage();

    // Phase 3: Map (MapLibre GL instance + tile error handling)
    const { map, analysisLayersManager, dataLayersManager } = createMap();

    // Phase 4: Controls (async — includes streetview preflight check)
    // Start creation but register map.on('load') BEFORE awaiting, to avoid
    // race condition where map fires 'load' during the preflight fetch timeout.
    const controlsPromise = createControls(map, analysisLayersManager, dataLayersManager);

    // Phase 5+6: Register map.on('load') handler synchronously — BEFORE 'load' can fire.
    // Capture the local-store boot + initial-render promises so the remote reconnect/open below
    // can await them (so its clearAllDataStore can't race the load handler — see bootRendered).
    const { statePromise, bootRendered } = initializeApp(map, controlsPromise);

    // Wait for controls to finish (preflight + UI setup)
    const controls = await controlsPromise;

    // Cleanup handlers (global error handlers + beforeunload)
    setupCleanupHandlers(controls.destroyables);

    // Tab lock — runs after app is fully loaded so the map is visible behind the overlay
    initTabLock();

    // Session lifecycle guards (logged-in only): idle timeout ends an inactive session with a
    // warning; a terminally-failed refresh drops to anonymous. Both re-open login cleanly. Wired
    // AFTER controls so the account control exists; a boot-time expiry already fell to anonymous.
    //
    // The message no longer says "expirou": since the backend gained a session cut-off
    // (users.sessions_valid_from, backend migration 008), this handler also fires when the
    // server ENDED the session on purpose — a password change, an admin reset, or refresh-token
    // reuse detected, i.e. suspected theft. Telling someone their session "expired" when it was
    // in fact revoked is the wrong thing to read right after someone else touched their account.
    new IdleTimeoutController().init();
    apiClient.setAuthLostHandler(
        () => getControl('account')?.handleSessionLost?.('Sua sessão foi encerrada. Entre novamente.'),
    );

    // Safe view ↔ edit driver: locks a no-edit role to the view profile and powers the "Editar mapa"
    // toggle. Wired after controls so the UI elements are registered with the visibility controller.
    getViewModeController().init();

    // An e-mail-confirmation link (?verify=<token>) is handled first (anonymous, one-shot).
    await handleEmailVerificationFromUrl();

    // A session that ended on the admin PAGE lands back here with `?sessao=` — say why.
    explainEndedSessionFromUrl();

    // Boot routing precedence (see docs/ui-ux-ebgeo.md §1): a public viewer link wins for an
    // anonymous visitor; then an `?atlas=` deep link (open, or prompt login + resume); otherwise
    // open the atlas CHOOSER — the boot does NOT reconnect the last remote atlas on its own.
    // (`#view=3d/360` is handled
    // earlier in the map-load path and has absolute precedence; `?verify=` ran above.) The links were
    // captured at the very top of initApp — atlas-url-sync has since stripped `?atlas` from the URL
    // for an anonymous visitor, so re-reading it here would be too late.

    // Serialize the boot BEFORE any remote open/reconnect. bootRendered resolves after the load
    // handler rendered the initial map + cleared the splash; awaiting it prevents the remote open's
    // clearAllDataStore from interleaving with the load handler's switchMap (which hangs the splash
    // on a logged-in `?atlas=&map=` deep link) AND with the boot store-init (which could leave a
    // stray local "Principal" alongside the synced maps — phantom 3rd map on F5). The race() caps the
    // wait so a 'load' event that never fires can't deadlock boot. Local IDB only — no network wait.
    await Promise.race([bootRendered, new Promise((resolve) => setTimeout(resolve, 15000))]);
    await statePromise.catch(() => {});
    if (await openPublicAtlasFromUrl(bootPublicLink)) return;
    if (await openAtlasFromUrl(bootAtlasLink)) return;
    if (await enterLocalMapOnBoot()) return;
    openAtlasChooserOnBoot();
}

/**
 * Honours the "Mapa local" choice by landing on a REAL local workspace.
 *
 * The intent flag alone only stopped the redirect — the IndexedDB store still held the atlas that
 * was open when the user left, so "Mapa local" reopened that atlas's maps and merely looked local.
 * Discarding remote-origin data here is what makes the choice mean what it says; `clearAllDataStore`
 * lands on a blank default map and emits `ALL_DATA_CLEARED`, which repopulates the live sources from
 * it (no features left drawn on the canvas).
 *
 * A store that is ALREADY local is left untouched: that is the offline user's own work.
 * @returns {Promise<boolean>} true when this boot is a local-map boot (the chooser must not run).
 */
async function enterLocalMapOnBoot() {
    if (!hasLocalMapIntent()) return false;
    try {
        const origin = await loadStoreOrigin();
        if (origin.kind === 'remote') await clearAllDataStore();
    } catch (error) {
        console.warn('[boot] local map entry failed:', error);
    }
    return true;
}

/**
 * If the URL carries an atlas deep link (`?atlas=<uuid>[&map=<uuid>]`): when logged in with access,
 * opens that atlas (landing on `&map` when given); when logged out, remembers the target and prompts
 * login (the account control resumes it on success). Returns true when it took over the boot.
 * Best-effort: a connect/permission failure shows a clear message and falls through to the normal path.
 * @returns {Promise<boolean>}
 */
async function openAtlasFromUrl(link = parseAtlasLink()) {
    if (!link) return false;

    if (!sessionContext.isAuthenticated()) {
        // Remember the target and open the login modal; account.control resumes it after auth.
        setPendingAtlasLink(link);
        getControl('account')?.requestLogin?.();
        return true;
    }

    try {
        const opened = await openRemoteAtlas(link.atlasId, { mapId: link.mapId });
        // User declined the "replace local work" confirm → stay local; drop the deep link so a
        // reconnect doesn't re-open it, and don't fall through to the last-atlas reconnect.
        if (!opened) clearAtlasUrl();
        return true;
    } catch (error) {
        const status = error?.status ?? error?.statusCode;
        // O 404 aqui cobre DOIS casos que o servidor não distingue de propósito: o atlas
        // não existe, e o atlas existe mas quem pede não tem nenhum vínculo com ele
        // (`resolvePermission` sem linha em `atlas_shares` responde NotFound, para não
        // confirmar a existência a quem não deveria saber). "Projeto não encontrado" seco
        // manda o usuário procurar um erro de digitação num link que está correto; o 403
        // sobrou para o caso estreito de ter compartilhamento com nível insuficiente.
        if (status === 403) showToast('Você não tem acesso a este projeto.', 'error');
        else if (status === 404) showToast('Projeto não encontrado ou sem acesso.', 'error');
        else showToast('Não foi possível abrir o projeto do servidor.', 'error');
        console.warn('[boot] atlas open from URL failed:', error);
        clearAtlasUrl();
        return false; // origin reverted to local in openRemoteAtlas → reconnect is a no-op; land local
    }
}

/**
 * Whether this boot should hand over to the project chooser page instead of building a map.
 *
 * True only for a signed-in visitor at a bare `/`. Every other case belongs on the map:
 *   - `?atlas=` / `?atlasPublico=` — the URL already names what to open;
 *   - `?verify=` — a one-shot e-mail confirmation that must be consumed here;
 *   - "Mapa local" — an explicit, tab-scoped choice to work without a server project;
 *   - anonymous — the map IS the product for someone not signed in.
 *
 * @param {{atlasId: string}|null} atlasLink - The parsed `?atlas=` deep link, if any.
 * @param {string|null} publicLink - The `?atlasPublico=` link, if any.
 * @returns {boolean}
 */
function shouldRouteToProjects(atlasLink, publicLink) {
    if (atlasLink || publicLink) return false;
    if (new URLSearchParams(window.location.search).has('verify')) return false;
    if (hasLocalMapIntent()) return false;
    return apiClient.hasStoredTokens();
}

/** Why a session ended on another page, and how to say it here. */
const ENDED_SESSION_MESSAGES = Object.freeze({
    inatividade: 'Sua sessão expirou por inatividade. Entre novamente.',
    encerrada: 'Sua sessão foi encerrada. Entre novamente.',
});

/**
 * Explains a session that ended on the Administração page. That page has no login UI of its own, so
 * it revokes the token and sends the user here with `?sessao=<motivo>`; without this the user would
 * simply find themselves on an anonymous map with no idea why. One-shot: the param is stripped so a
 * reload does not repeat the message. Unknown values are ignored rather than echoed.
 */
function explainEndedSessionFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('sessao');
    if (!reason) return;
    const message = ENDED_SESSION_MESSAGES[reason];
    if (message) showToast(message, 'warning');
    params.delete('sessao');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
}

/**
 * Confirms an account when the URL carries a verification token (`?verify=<token>`). Anonymous and
 * one-shot: shows the outcome as a toast and strips the param so a reload never retries a consumed
 * token. Best-effort — never blocks boot.
 * @returns {Promise<void>}
 */
async function handleEmailVerificationFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify');
    if (!token) return;
    try {
        await apiClient.verifyEmail(token);
        showToast('E-mail confirmado! Faça login para entrar.', 'success');
    } catch {
        showToast('Não foi possível confirmar o e-mail. O link pode ter expirado.', 'error');
    } finally {
        params.delete('verify');
        const qs = params.toString();
        const url = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
        window.history.replaceState({}, '', url);
    }
}

/**
 * If the URL carries a public viewer link (`?atlasPublico=<link>`) and nobody is logged in, opens
 * that atlas as an anonymous read-only visitor. Returns true if it took over the boot (so the
 * normal last-atlas reconnect is skipped). Best-effort: any failure falls back to the normal path.
 * @returns {Promise<boolean>}
 */
async function openPublicAtlasFromUrl(link = new URLSearchParams(window.location.search).get('atlasPublico')) {
    try {
        if (!link || sessionContext.isAuthenticated()) return false;
        const atlas = await apiClient.getPublicAtlas(link);
        apiClient.setEphemeralToken(atlas.publicToken);
        await clearAllDataStore();
        await markStoreRemote(atlas.id);
        await syncEngine.connectPublic(atlas.id);
        await activateAtlasInitialMap();
        showToast('Visualização pública — somente leitura', 'info');
        return true;
    } catch (error) {
        console.warn('[boot] public atlas open failed:', error);
        return false;
    }
}

/**
 * Restores a persisted login: loads the stored tokens, validates them against the backend
 * (transparently refreshing an expired access token), and mirrors the identity into the
 * session context. Any failure (no token, expired refresh, backend down) clears the tokens
 * and leaves the anonymous/offline path untouched.
 * @returns {Promise<void>}
 */
async function restoreSessionFromStorage() {
    try {
        if (!apiClient.loadStoredTokens()) return;
        const user = await apiClient.getMe();
        sessionContext.setSession({
            userId: user.id,
            role: user.org_role || 'viewer',
            globalRole: user.role || 'user',
            username: user.username || user.nome,
        });
    } catch {
        apiClient.clearTokens();
    }
}

/**
 * Signed in but nothing to open: hand over to the chooser PAGE.
 *
 * Normally Phase -1 already routed this boot away, so the only way here is a fallthrough — an
 * `?atlas=` deep link that failed to open, or a "Mapa local" tab whose session outlived the intent.
 * Discards any remote-atlas data left over from a previous session first, so the user does not
 * leave a disconnected atlas sitting in IndexedDB (clearAllDataStore re-marks LOCAL).
 *
 * The boot deliberately does NOT reconnect the last atlas: the address bar is the source of truth.
 * @returns {Promise<void>}
 */
async function openAtlasChooserOnBoot() {
    try {
        if (!sessionContext.isAuthenticated()) return;
        const origin = await loadStoreOrigin();
        if (origin.kind === 'remote') await clearAllDataStore();
        getControl('account')?.openProjectPicker?.();
    } catch (error) {
        console.warn('[boot] atlas chooser failed:', error);
    }
}

// Start initialization immediately (map container exists in static HTML)
initApp().catch(error => {
    console.error('Application initialization failed:', error);
});

// ============================================================================
// DOM CONTENT LOADED
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    if (window.performance?.mark) {
        window.performance.mark('app-init');
    }
});

// ============================================================================
// GLOBAL CLEANUP
// ============================================================================

window.addEventListener('beforeunload', () => {
    try {
        cleanup3DFeatures();
    } catch (error) {
        console.warn('Cesium cleanup error:', error);
    }
});


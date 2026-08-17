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
import { cleanupFirstPersonFeatures } from '@js/first_person_3d_tool/index.js';
import { initServices, loadStoreOrigin, markStoreRemote, clearAllDataStore, activateAtlasInitialMap, activateRemoteAtlas, getControl, getEventBus } from './store';
import { installTabLockSyncBrake } from '@store/sync/tab-lock-sync-brake.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';
import { refreshVisibleResources } from '@store/sync/resource-access.service.js';
import {
    openRemoteAtlas,
    currentAtlasLockKey,
    syncAtlasLockKey,
    deferAtlasOpen,
    resumeDeferredAtlasOpen,
    retractAtlasClaim,
    clearMountedAtlasIfGranted,
    remoteMountWitness,
    switchToNewLocalAtlas,
} from './account/open-atlas.service.js';
import { parseAtlasLink, setPendingAtlasLink, clearAtlasUrl } from './deep-link/atlas-link.js';
import { hasLocalMapIntent } from './deep-link/local-intent.js';
import { shouldRouteToProjects } from './deep-link/route-decision.js';
import { consumePendingEbgeoImport } from './deep-link/pending-import.js';
import { initAtlasUrlSync } from './deep-link/atlas-url-sync.js';
import { IdleTimeoutController } from './session/idle-timeout.controller.js';
import { getViewModeController } from '@ui/view-mode.controller.js';
import { showToast } from '@utils';
import { createMap, createControls, initializeApp, setupCleanupHandlers } from './map_sig.js';
import { initTabLock, isTabLockBlocked, acquireTabLock, remoteAtlasKey } from '@utils/tab-lock.js';
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
    // is the whole point of `atlas.html` being a page. Everything else stays on the map: a deep
    // link (`?atlas`/`?atlasPublico`, or a `#view=` viewer link), a one-shot `?verify`, an explicit
    // "Mapa local", or nobody signed in at all. The rule itself lives in `route-decision.js`, where
    // a test can reach it.
    //
    // Reads the token WITHOUT validating it: validation costs a round trip, and `atlas.html`
    // validates on arrival anyway — a token the server rejects is cleared there and the page sends
    // the user back here, now anonymous. That is what keeps the two redirects from ping-ponging.
    if (shouldRouteToProjects(bootAtlasLink, bootPublicLink, apiClient.hasStoredTokens())) {
        window.location.replace('./atlas.html');
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

    // Tab lock — announce WHAT THIS TAB HOLDS, and keep announcing it for the rest of the session.
    //
    // It runs HERE, and not right after the controls, for two reasons. The map is already rendered,
    // so an overlay lands on a visible app rather than on a splash; and the store boot (schema
    // migration included) has finished, so the active atlas scope is the real one — announced any
    // earlier the key would name the bridge scope and then silently disagree with the databases
    // this tab actually writes to.
    //
    // Everything below this line either opens an atlas or wipes one, and each of those asks the
    // lock FIRST: with a namespace per atlas, a wipe lands on exactly the databases another tab in
    // the same atlas is writing to.
    initTabLock({ key: currentAtlasLockKey() });
    // The EFFECTS come from the brake, not from a handler written here. Blocking has to STOP the
    // tab (stop the flush, close the socket) and erase nothing, and unblocking has to put back what
    // was stopped — an inline `onBlocked` that stopped without a matching restore is what left a
    // tab unblocked, editable and silently offline after a "Usar aqui" round trip. Awaited because
    // `setEffects` is late-safe: a tab that lost the arbitration in the microtask before this line
    // is stopped right here, and this is where that stop finishes.
    await installTabLockSyncBrake({ replay: resumeDeferredAtlasOpen });
    // The atlas changes LIVE in four flows (login with a pending link, "Enviar ao servidor",
    // logout, a session lost to a 401). These are the same two signals `deep-link/atlas-url-sync.js`
    // listens to, reading the same `syncEngine.atlasId`, so the URL and the lock cannot disagree.
    getEventBus().on(EventTypes.CONNECTION_STATE_CHANGED, syncAtlasLockKey);
    getEventBus().on(EventTypes.SESSION_CHANGED, syncAtlasLockKey);

    // A `.ebgeo` handed over by "Seus atlas" comes FIRST, and it is not a fifth entry in the chain
    // below: it is the completion of a gesture the user already made on the other page, so there is
    // nothing left for the chain to route. It runs after the lock is up, because it both creates an
    // atlas and wipes the mounted scope; and it declines to the chain when a deep link is present,
    // because a `?atlas=` boot is going to open a SERVER atlas and a file must never be imported
    // into one.
    //
    // `createAtlas` IS THE ENTRY INTO A NEW ATLAS, injected rather than imported over there because
    // `pending-import.js` is unit-tested in bare node and this pipeline drags the whole store. It
    // is the same one the in-map import uses when it has to leave a server atlas
    // (`_prepareNonAdditiveTarget`), which is what keeps "who may mount an atlas" a list of one.
    if (await consumePendingEbgeoImport({
        hasDeepLink: Boolean(bootPublicLink || bootAtlasLink),
        getImporter: () => getControl('exportImport'),
        createAtlas: (name) => switchToNewLocalAtlas(name),
        notify: showToast,
    })) return;

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
 *
 * THE WIPE IS GATED, and this path is the reason the gate exists. `ebgeo_local_intent` lives in
 * sessionStorage, and sessionStorage is INHERITED when a tab is duplicated: the duplicate boots
 * carrying the intent, reads the same remote origin, and would erase the namespace the original tab
 * is working in. `clearMountedAtlasIfGranted` asks the lock and AWAITS the answer, which a boot-time
 * read of `isTabLockBlocked()` cannot do (the lock has not heard from anybody yet). Refused, the tab
 * stays blocked with the overlay, and "Usar aqui" replays this same entry.
 * @returns {Promise<boolean>} true when this boot is a local-map boot (the chooser must not run).
 */
async function enterLocalMapOnBoot() {
    if (!hasLocalMapIntent()) return false;
    try {
        const origin = await loadStoreOrigin();
        if (origin.kind === 'remote') await clearMountedAtlasIfGranted(() => enterLocalMapOnBoot());
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
        //
        // A tab BLOCKED by another one is the other `false`, and it must keep the link: the open is
        // only deferred, and "Usar aqui" is about to replay it. Stripping the URL there would leave
        // the address bar denying an atlas this tab is still on its way into.
        if (!opened && !isTabLockBlocked()) clearAtlasUrl();
        return true;
    } catch (error) {
        const status = error?.status ?? error?.statusCode;
        // O 404 aqui cobre DOIS casos que o servidor não distingue de propósito: o atlas
        // não existe, e o atlas existe mas quem pede não tem nenhum vínculo com ele
        // (`resolvePermission` sem linha em `atlas_shares` responde NotFound, para não
        // confirmar a existência a quem não deveria saber). "Atlas não encontrado" seco
        // manda o usuário procurar um erro de digitação num link que está correto; o 403
        // sobrou para o caso estreito de ter compartilhamento com nível insuficiente.
        if (status === 403) showToast('Você não tem acesso a este atlas.', 'error');
        else if (status === 404) showToast('Atlas não encontrado ou sem acesso.', 'error');
        else showToast('Não foi possível abrir o atlas do servidor.', 'error');
        console.warn('[boot] atlas open from URL failed:', error);
        clearAtlasUrl();
        return false; // origin reverted to local in openRemoteAtlas → reconnect is a no-op; land local
    }
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
        // RESOLVE FIRST, CLAIM SECOND. `?atlasPublico=` carries a link TOKEN, and the atlas UUID
        // only exists once the server answers — but under the uniform rule the key IS the UUID, so
        // there is nothing honest to claim before this call. Resolving is a read: it opens nothing
        // and destroys nothing, so deferring the claim costs one round trip and no data. (The
        // alternative, claiming under a placeholder id and re-stamping later, collides with the
        // wrong tabs and hands away a claim this tab already holds — see tab-lock.js, section 1.)
        const atlas = await apiClient.getPublicAtlas(link);
        apiClient.setEphemeralToken(atlas.publicToken);
        // Now the claim, and it still precedes every destructive step below.
        // A TESTEMUNHA, pelo mesmo motivo dos outros dois sítios destrutivos: `granted` sozinho é
        // concedido por AUSÊNCIA DE PROVA (o settle ouve silêncio e conclui que está só), e três
        // linhas abaixo este caminho chama `clearAllDataStore`. O lock de montagem é fato do
        // navegador e é solto pela MORTE do cliente, nunca pelo silêncio dele, então ele responde
        // onde o canal se cala. `selfHolds` é 0: o namespace público ainda não foi ativado aqui.
        //
        // Este era o QUARTO sítio destrutivo e ficou de fora quando os outros três foram ligados,
        // porque `index.js` não estava na lista de arquivos daquela frente. Um sítio destrutivo
        // sem testemunha é o furo inteiro de volta, num caminho só.
        const claim = await acquireTabLock(remoteAtlasKey(atlas.id), {
            witness: remoteMountWitness(atlas.id),
        });
        if (!claim.granted) {
            // Blocked: the overlay explains it and its "Usar aqui" replays this open.
            deferAtlasOpen(() => openPublicAtlasFromUrl(link));
            return true;
        }
        // The namespace, before the first write into it. A public visit is READ-only for the user
        // and ephemeral by contract, but on disk it is server data like any other: it has to own
        // `ebgeo_*__remote-<atlasId>` and be in the remote registry, or the logged-out purge (which
        // is the only thing that ever collects it, since nobody here logs out) cannot find it.
        // Same reason as `openRemoteAtlas` for coming before the wipe: the claim above already
        // names this atlas, so this is the only namespace this tab may empty.
        await activateRemoteAtlas(atlas.id);
        // `markLocal: false`: this visit mounts a REMOTE atlas two lines down, and the marker is
        // global to the installation. Announcing LOCAL in between is a window in which another
        // tab reads a marker that contradicts what this one has mounted.
        await clearAllDataStore({ markLocal: false });
        await markStoreRemote(atlas.id);
        await syncEngine.connectPublic(atlas.id);
        await activateAtlasInitialMap();
        showToast('Visualização pública — somente leitura', 'info');
        return true;
    } catch (error) {
        console.warn('[boot] public atlas open failed:', error);
        // A dead link must not leave this tab holding the server claim: retract, or nobody else
        // gets to open a server atlas until this tab is closed.
        retractAtlasClaim();
        return false;
    }
}

/**
 * Whether a failed session restore means the CREDENTIAL is dead (so the stored tokens must go)
 * or merely that the server could not answer right now (so they must stay).
 *
 * Only 401/403 are the credential answering for itself. A timeout (`getMe` runs with an 8 s boot
 * deadline), a network error or a 5xx say nothing about the token — and clearing it on those
 * logged the user out PERMANENTLY over a slow backend: the session did not come back when the
 * server recovered, the password had to be typed again.
 *
 * The same "status decides, never the mere fact of failing" rule is applied to the flush loop by
 * `classifyFlushFailure` (`store/sync/sync-flush.js`); the predicate is three lines, so it is
 * stated here rather than shared, and its contract is this comment.
 * @param {*} error
 * @returns {boolean}
 */
function isCredentialFailure(error) {
    const status = error?.status ?? error?.statusCode;
    return status === 401 || status === 403;
}

/**
 * Restores a persisted login: loads the stored tokens, validates them against the backend
 * (transparently refreshing an expired access token), and mirrors the identity into the
 * session context.
 *
 * A CREDENTIAL failure (401/403) clears the tokens. Anything else (timeout, offline, 5xx)
 * KEEPS them and simply boots anonymous for this load — the next F5 recovers the session.
 * Either way the anonymous/offline path is untouched.
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
        // A SOMA DOS RECURSOS PRIVADOS TAMBÉM PRECISA SOBREVIVER AO F5.
        //
        // `syncEngine.login()` a faz no gesto de entrar, e só ali: um recarregamento
        // restaura a sessão por este caminho, que não passa por `login()`. Sem esta
        // linha, o catálogo de quem tem papel global ou concessão perdia todo o
        // privado a cada F5 e só voltava com um logout seguido de login — um sumiço
        // que não deixa erro nenhum e que o usuário lê como "o recurso foi tirado
        // de mim". Sem atlas em foco de propósito: o empréstimo entra depois, em
        // `_applyAtlasSettingsOverlay`, quando houver atlas.
        //
        // Best-effort como todo o resto deste caminho: `refreshVisibleResources`
        // engole a própria falha e devolve `false`, então o boot anônimo/offline
        // continua intocado.
        await refreshVisibleResources(null);
    } catch (error) {
        if (isCredentialFailure(error)) {
            apiClient.clearTokens();
        } else {
            console.warn('[boot] session restore deferred (server unreachable):', error);
        }
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
 * Same gate as `enterLocalMapOnBoot`, for the same reason: that "left over" data is left over only
 * from THIS tab's point of view, and another tab may have it open right now. Refused, the chooser
 * does not open either — the tab is blocked, and the overlay is the answer the user needs first.
 *
 * The boot deliberately does NOT reconnect the last atlas: the address bar is the source of truth.
 * @returns {Promise<void>}
 */
async function openAtlasChooserOnBoot() {
    try {
        if (!sessionContext.isAuthenticated()) return;
        const origin = await loadStoreOrigin();
        if (origin.kind === 'remote'
            && !await clearMountedAtlasIfGranted(() => openAtlasChooserOnBoot())) {
            return;
        }
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

    // First-person scene. The barrel wrapper is async (it dynamically imports the
    // viewer), so a failure surfaces as a rejected promise, not as a throw: the
    // try/catch alone would let it escape as an unhandled rejection.
    try {
        Promise.resolve(cleanupFirstPersonFeatures()).catch(error => {
            console.warn('First-person cleanup error:', error);
        });
    } catch (error) {
        console.warn('First-person cleanup error:', error);
    }
});


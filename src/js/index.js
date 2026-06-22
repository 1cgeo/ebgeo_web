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
import { initServices, loadStoreOrigin, markStoreRemote, clearAllDataStore, activateAtlasInitialMap } from './store';
import { sessionContext } from '@store/sync/session-context.js';
import { startAutoFlush } from '@store/sync/sync-flush.js';
import { showToast } from '@utils';
import { createMap, createControls, initializeApp, setupCleanupHandlers } from './map_sig.js';
import { initTabLock } from '@utils/tab-lock.js';

// ============================================================================
// BOOTSTRAP
// ============================================================================

/**
 * Main application initialization.
 * Runs phases sequentially — no side-effects at import time.
 */
async function initApp() {
    // Phase 1: Config (synchronous, no dependencies)
    // Point the sync engine at the backend and deep-merge the remote /api/config
    // into the static config BEFORE the helpers read it. Both steps are
    // fail-safe: if the backend is down, the anonymous/offline path boots
    // unchanged on the static config.
    try {
        syncEngine.configure({ baseUrl: resolveBackendBaseUrl() });
    } catch (error) {
        console.warn('Sync engine configuration failed (offline path):', error);
    }
    await applyRuntimeConfig({ apiClient });

    initializeAppConfig();
    initConfigHelpers();

    // Phase 2: Services (EventBus, StateManager, LayerManager, GroupManager, MapResolver)
    initServices();

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

    // Phase 5+6: Register map.on('load') handler synchronously — BEFORE 'load' can fire
    initializeApp(map, controlsPromise);

    // Wait for controls to finish (preflight + UI setup)
    const controls = await controlsPromise;

    // Cleanup handlers (global error handlers + beforeunload)
    setupCleanupHandlers(controls.destroyables);

    // Tab lock — runs after app is fully loaded so the map is visible behind the overlay
    initTabLock();

    // A public viewer link in the URL takes precedence for an anonymous visitor; otherwise
    // reconnect the last remote atlas for a restored authenticated session.
    if (!(await openPublicAtlasFromUrl())) {
        reconnectLastAtlas();
    }
}

/**
 * If the URL carries a public viewer link (`?atlasPublico=<link>`) and nobody is logged in, opens
 * that atlas as an anonymous read-only visitor. Returns true if it took over the boot (so the
 * normal last-atlas reconnect is skipped). Best-effort: any failure falls back to the normal path.
 * @returns {Promise<boolean>}
 */
async function openPublicAtlasFromUrl() {
    try {
        const link = new URLSearchParams(window.location.search).get('atlasPublico');
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
            username: user.username || user.nome,
        });
    } catch {
        apiClient.clearTokens();
    }
}

/**
 * Re-opens the last remote atlas after a reload, when a session was restored and the local
 * store still holds that (remote) atlas. Best-effort: re-pulls a fresh snapshot, re-marks the
 * store remote, and resumes auto-flush. Does nothing for the offline/local user.
 * @returns {Promise<void>}
 */
async function reconnectLastAtlas() {
    try {
        if (!sessionContext.isAuthenticated()) return;
        const origin = await loadStoreOrigin();
        if (origin.kind !== 'remote' || !origin.atlasId) return;
        await syncEngine.connect(origin.atlasId, { initialPull: true });
        await markStoreRemote(origin.atlasId);
        startAutoFlush();
    } catch (error) {
        console.warn('[boot] atlas reconnect failed:', error);
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


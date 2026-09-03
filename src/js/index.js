// Path: js/index.js

/**
 * @module index
 * @description Application entry point.
 *
 * Orchestrates initialization in explicit sequential phases:
 * 1. Config — Apply app title, attach config helpers, show the secondary-server notice
 * 2. Services — EventBus, StateManager, LayerManager, GroupManager
 * 3. Map — MapLibre GL instance with tile error handling
 * 4. Controls — All tools, UI components, control registrations
 * 5+6. State + UI — IndexedDB load, map load handler, deep linking
 */

import { initializeAppConfig } from './config-loader.js';
import { initConfigHelpers } from './config.helpers.js';
import { initSecondaryServerNotice } from './ui/secondary-server-notice.js';
import { cleanup3DFeatures } from './3d_models_viewer_tool/index.js';
import { cleanupFirstPersonFeatures } from './first_person_3d_tool/index.js';
import { initServices } from './store';
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
    initializeAppConfig();
    initConfigHelpers();

    // Secondary-server notice: needs only the config, so it goes up before the
    // map and stays visible even if a later phase never completes.
    initSecondaryServerNotice();

    // Phase 2: Services (EventBus, StateManager, LayerManager, GroupManager, MapResolver)
    initServices();

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
    // viewer), so a failure surfaces as a rejected promise, not as a throw — the
    // try/catch alone would let it escape as an unhandled rejection.
    try {
        Promise.resolve(cleanupFirstPersonFeatures()).catch(error => {
            console.warn('First-person cleanup error:', error);
        });
    } catch (error) {
        console.warn('First-person cleanup error:', error);
    }
});


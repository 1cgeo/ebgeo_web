// Path: js/store/sync/atlas-settings.service.js

/**
 * @fileoverview Per-atlas config overlay (Fase 1 — "Configuração por atlas").
 *
 * A connected remote atlas can RESTRICT which capabilities are available (3D, 360,
 * basemaps) via its `atlas.settings` (set by a Gestor, broadcast as `atlas_settings_updated`).
 * This service applies those restrictions onto the global `config` singleton — and only ever
 * RESTRICTS: the overlay is the **intersection** of the deployment's capabilities and the
 * atlas's allowances. It can never ENABLE what the deployment disabled (e.g. 3D is stripped on
 * the GitHub Pages build — no atlas setting can turn it back on). Coherent with P1/P12.
 *
 * A baseline of the deploy-level values is captured on first apply so `revertAtlasSettings()`
 * restores them when the user disconnects / returns to the local store.
 *
 * Backend → frontend key mapping: `features.panoramic_images` → `config.features.imagens_panoramicas`.
 */

import config from '../../config.js';

/**
 * The captured deploy-level baseline (set on first apply, cleared on revert).
 * @type {{ map_3d: boolean, imagens_panoramicas: boolean, basemaps: Object<string, boolean> }|null}
 */
let _baseline = null;

/** @private Captures the current (deploy-level) availability from the config singleton. */
function captureBaseline() {
    const basemaps = {};
    if (config.basemaps) {
        for (const [id, cfg] of Object.entries(config.basemaps)) {
            basemaps[id] = cfg?.enabled !== false;
        }
    }
    return {
        map_3d: config.features?.map_3d !== false,
        imagens_panoramicas: config.features?.imagens_panoramicas !== false,
        terrain_3d: config.features?.terrain_3d !== false,
        basemaps,
    };
}

/**
 * Pure: computes the restricted availability = deploy baseline ∩ atlas settings.
 * Never enables what the baseline disabled. An empty/absent `basemaps` allowlist means the
 * atlas does not restrict basemaps (the deploy set is kept).
 *
 * @param {{ map_3d: boolean, imagens_panoramicas: boolean, basemaps: Object<string, boolean> }} baseline
 * @param {{ features?: Object, basemaps?: string[] }} [settings] - Backend atlas.settings shape.
 * @returns {{ map_3d: boolean, imagens_panoramicas: boolean, basemaps: Object<string, boolean> }}
 */
export function intersectAvailability(baseline, settings) {
    const features = settings?.features || {};
    const allow = Array.isArray(settings?.basemaps) ? settings.basemaps : [];
    const basemaps = {};
    for (const [id, enabled] of Object.entries(baseline.basemaps || {})) {
        // Keep a basemap iff it was enabled in the deploy AND (no allowlist OR it is listed).
        basemaps[id] = enabled !== false && (allow.length === 0 || allow.includes(id));
    }
    return {
        map_3d: baseline.map_3d !== false && features.map_3d !== false,
        imagens_panoramicas: baseline.imagens_panoramicas !== false && features.panoramic_images !== false,
        terrain_3d: baseline.terrain_3d !== false && features.terrain_3d !== false,
        basemaps,
    };
}

/**
 * Applies a connected atlas's settings as a restrictive overlay onto the global config.
 * Idempotent: re-applying recomputes from the captured baseline (never compounds).
 * @param {{ features?: Object, basemaps?: string[] }} [settings] - Backend atlas.settings.
 */
export function applyAtlasSettings(settings) {
    if (!_baseline) _baseline = captureBaseline();
    const next = intersectAvailability(_baseline, settings);
    if (config.features) {
        config.features.map_3d = next.map_3d;
        config.features.imagens_panoramicas = next.imagens_panoramicas;
        config.features.terrain_3d = next.terrain_3d;
    }
    if (config.basemaps) {
        for (const [id, enabled] of Object.entries(next.basemaps)) {
            if (config.basemaps[id]) config.basemaps[id].enabled = enabled;
        }
    }
}

/**
 * Restores the deploy-level baseline (call on disconnect / return to the local store).
 * No-op if nothing was applied.
 */
export function revertAtlasSettings() {
    if (!_baseline) return;
    if (config.features) {
        config.features.map_3d = _baseline.map_3d;
        config.features.imagens_panoramicas = _baseline.imagens_panoramicas;
        config.features.terrain_3d = _baseline.terrain_3d;
    }
    if (config.basemaps) {
        for (const [id, enabled] of Object.entries(_baseline.basemaps)) {
            if (config.basemaps[id]) config.basemaps[id].enabled = enabled;
        }
    }
    _baseline = null;
}

/** Test hook: resets the captured baseline. @private */
export function _resetAtlasSettingsBaseline() {
    _baseline = null;
}

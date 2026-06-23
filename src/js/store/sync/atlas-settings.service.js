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

/** Per-atlas 360-view allowlist (raw ids); null = no restriction. Set on apply, cleared on revert.
 *  360 lives outside `config` (sv360 preflight cache), so the catalog reads this directly. */
let _atlas360Allowlist = null;

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
        // Data/analysis layers are FLAT arrays (no per-layer `enabled` flag, unlike basemaps), so
        // the baseline keeps the full deploy arrays and the intersection FILTERS them to the allowlist.
        dataLayers: Array.isArray(config.dataLayers?.layers) ? [...config.dataLayers.layers] : [],
        analysisLayers: Array.isArray(config.analysisLayers?.layers) ? [...config.analysisLayers.layers] : [],
        // Global category on/off (the whole "Dados"/"Análise" group): the catalog reads `.enabled`.
        dataLayersEnabled: config.dataLayers?.enabled !== false,
        analysisLayersEnabled: config.analysisLayers?.enabled !== false,
        // 3D models: config.tilesets is a flat array of {id,...}; filter it by available_3d_models.
        tilesets: Array.isArray(config.tilesets) ? [...config.tilesets] : [],
    };
}

/** @private Filters a layer array by an id allowlist ([]/absent = keep all). */
function filterLayers(layers, allowlist) {
    const all = Array.isArray(layers) ? layers : [];
    const allow = Array.isArray(allowlist) ? allowlist : [];
    if (allow.length === 0) return [...all];
    return all.filter((l) => allow.includes(l?.id));
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
        // Empty/absent allowlist = no restriction (keep the full deploy array); else keep only listed ids.
        dataLayers: filterLayers(baseline.dataLayers, settings?.available_data_layers),
        analysisLayers: filterLayers(baseline.analysisLayers, settings?.available_analysis_layers),
        dataLayersEnabled: baseline.dataLayersEnabled !== false && features.data_layers !== false,
        analysisLayersEnabled: baseline.analysisLayersEnabled !== false && features.analysis_layers !== false,
        tilesets: filterLayers(baseline.tilesets, settings?.available_3d_models),
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
    _atlas360Allowlist = Array.isArray(settings?.available_360_views) && settings.available_360_views.length
        ? settings.available_360_views
        : null;
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
    if (config.dataLayers) {
        replaceArrayInPlace(config.dataLayers.layers, next.dataLayers);
        config.dataLayers.enabled = next.dataLayersEnabled;
    }
    if (config.analysisLayers) {
        replaceArrayInPlace(config.analysisLayers.layers, next.analysisLayers);
        config.analysisLayers.enabled = next.analysisLayersEnabled;
    }
    replaceArrayInPlace(config.tilesets, next.tilesets);
}

/**
 * @private Replaces an array's contents IN PLACE (preserves the reference) so modules that
 * captured the original array (e.g. the catalog) keep seeing the overlay-filtered list.
 * No-op when `arr` is not an array.
 * @param {*} arr - The live array to mutate.
 * @param {Array} next - The new contents.
 */
function replaceArrayInPlace(arr, next) {
    if (!Array.isArray(arr)) return;
    arr.length = 0;
    arr.push(...(Array.isArray(next) ? next : []));
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
    if (config.dataLayers) {
        replaceArrayInPlace(config.dataLayers.layers, _baseline.dataLayers);
        config.dataLayers.enabled = _baseline.dataLayersEnabled;
    }
    if (config.analysisLayers) {
        replaceArrayInPlace(config.analysisLayers.layers, _baseline.analysisLayers);
        config.analysisLayers.enabled = _baseline.analysisLayersEnabled;
    }
    replaceArrayInPlace(config.tilesets, _baseline.tilesets);
    _atlas360Allowlist = null;
    _baseline = null;
}

/**
 * Returns the deploy-level (UNrestricted) data layers. The atlas-config modal must use this — not
 * `config.dataLayers.layers`, which the active overlay has already FILTERED — so a manager always
 * sees the full list and can re-enable a previously restricted layer. Falls back to the live config
 * when no overlay is active (then it IS the full deploy list).
 * @returns {Array}
 */
export function getDeployDataLayers() {
    if (_baseline) return _baseline.dataLayers;
    return Array.isArray(config.dataLayers?.layers) ? config.dataLayers.layers : [];
}

/** As {@link getDeployDataLayers}, for analysis layers. @returns {Array} */
export function getDeployAnalysisLayers() {
    if (_baseline) return _baseline.analysisLayers;
    return Array.isArray(config.analysisLayers?.layers) ? config.analysisLayers.layers : [];
}

/** As {@link getDeployDataLayers}, for 3D models (config.tilesets). @returns {Array} */
export function getDeployTilesets() {
    if (_baseline) return _baseline.tilesets;
    return Array.isArray(config.tilesets) ? config.tilesets : [];
}

/** The per-atlas 360-view allowlist (raw ids), or null = no restriction. @returns {string[]|null} */
export function getAtlas360Allowlist() {
    return _atlas360Allowlist;
}

/** Test hook: resets the captured baseline. @private */
export function _resetAtlasSettingsBaseline() {
    _baseline = null;
}

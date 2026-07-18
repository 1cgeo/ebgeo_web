// Path: js/config.helpers.js

/**
 * @fileoverview Helper functions for config.js
 * Provides utility functions for basemaps, tilesets, and provider configurations.
 */

import config from './config.js';

// ===== TILESETS & STREETVIEW =====

/**
 * Check if any tilesets are configured
 * @returns {boolean} True if tilesets exist
 */
export function hasTilesets() {
    return config.tilesets && config.tilesets.length > 0;
}

// ===== BASEMAPS =====

/**
 * Validate basemaps configuration - ensures at least one basemap is enabled.
 * Falls back to 'carta-topografica' if all basemaps are disabled.
 */
export function validateBasemapsConfig() {
    const entries = Object.entries(config.basemaps || {});
    const enabled = entries.filter(([, b]) => b.enabled);
    if (enabled.length === 0 && entries.length > 0) {
        // The server is the source of basemaps; don't assume a specific id exists — re-enable
        // carta-topografica if present, otherwise the first available basemap.
        const target = config.basemaps['carta-topografica'] ? 'carta-topografica' : entries[0][0];
        console.warn(`All basemaps disabled! Enabling "${target}" as fallback`);
        config.basemaps[target].enabled = true;
    }
}

/**
 * Get enabled basemaps sorted by priority
 * @returns {Array} Array of [id, config] tuples sorted by priority
 */
export function getEnabledBasemaps() {
    return Object.entries(config.basemaps)
        .filter(([, basemapConfig]) => basemapConfig.enabled)
        .sort(([, a], [, b]) => a.priority - b.priority);
}

/**
 * Determine CSS layout class based on basemap count
 * @param {number} count - Number of enabled basemaps
 * @returns {string} CSS class name for grid layout
 */
export function getBasemapLayoutClass(count) {
    switch (count) {
        case 1: return 'base-layer-grid-1x1';
        case 2: return 'base-layer-grid-1x2';
        case 3: return 'base-layer-grid-2x1-center';
        case 4: return 'base-layer-grid-2x2';
        case 5: return 'base-layer-grid-2x2-center';
        default: return 'base-layer-grid-2x2';
    }
}

/**
 * Get valid basemap fallback when current selection is unavailable.
 *
 * Always resolves to a USABLE basemap id whenever any basemap exists, so callers
 * (base-layer.control.js, map.operations.js, import/export) never set the active
 * base layer to '' (which would leave the map with no basemap). Resolution order:
 *   1. currentBasemap if it is enabled;
 *   2. the first ENABLED basemap (by priority);
 *   3. if none is enabled but basemaps exist, the first basemap key (any — an
 *      atlas overlay may have disabled every basemap, yet we still need one to render);
 *   4. '' only when config.basemaps is truly empty.
 *
 * @param {string|null} currentBasemap - Currently selected basemap ID
 * @returns {string} Usable basemap ID, or '' only when no basemaps are configured
 */
export function getValidBasemapFallback(currentBasemap = null) {
    if (currentBasemap && config.basemaps[currentBasemap]?.enabled) {
        return currentBasemap;
    }

    const enabled = getEnabledBasemaps();
    if (enabled.length > 0) {
        return enabled[0][0];
    }

    // No basemap is enabled (e.g. an atlas overlay disabled every basemap). Still
    // return an existing basemap key so the map renders something, rather than ''.
    const allKeys = Object.keys(config.basemaps || {});
    if (allKeys.length > 0) {
        return allKeys[0];
    }

    // config.basemaps is truly empty — nothing usable exists.
    return '';
}

// ===== 3D PROVIDERS =====

/**
 * Create imagery provider configuration object
 * @returns {Object|boolean} Provider config or false if disabled
 */
export function createImageryProvider() {
    const imageryConfig = config.map3d.providers.imagery;
    if (!imageryConfig.enabled) return false;

    switch (imageryConfig.type) {
        case 'UrlTemplate':
            return {
                provider: 'UrlTemplateImageryProvider',
                url: imageryConfig.url,
                maximumLevel: imageryConfig.options.maximumLevel || 18,
                minimumLevel: imageryConfig.options.minimumLevel || 0,
                tileWidth: imageryConfig.options.tileWidth || 256,
                tileHeight: imageryConfig.options.tileHeight || 256
            };
        case 'WMS':
            return {
                provider: 'WebMapServiceImageryProvider',
                url: imageryConfig.url,
                layers: imageryConfig.options.layers
            };
        case 'SingleTile':
            return {
                provider: 'SingleTileImageryProvider',
                url: imageryConfig.url
            };
        default:
            return false;
    }
}

/**
 * Create terrain provider configuration object
 * @returns {Object} Provider config (defaults to ellipsoid if disabled)
 */
export function createTerrainProvider() {
    const terrainConfig = config.map3d.providers.terrain;
    if (!terrainConfig.enabled) {
        return { provider: 'EllipsoidTerrainProvider' };
    }

    switch (terrainConfig.type) {
        case 'Cesium':
            return {
                provider: 'CesiumTerrainProvider',
                url: terrainConfig.url,
                requestVertexNormals: terrainConfig.options.requestVertexNormals || false
            };
        case 'Ellipsoid':
            return { provider: 'EllipsoidTerrainProvider' };
        default:
            return { provider: 'EllipsoidTerrainProvider' };
    }
}

// ===== ATTACH TO CONFIG (for backward compatibility) =====

/**
 * Attach helper functions to config object for backward compatibility.
 * Must be called explicitly during initialization.
 */
export function initConfigHelpers() {
    config.hasTilesets = hasTilesets;
    config.validateBasemapsConfig = validateBasemapsConfig;
    config.getEnabledBasemaps = getEnabledBasemaps;
    config.getBasemapLayoutClass = getBasemapLayoutClass;
    config.getValidBasemapFallback = getValidBasemapFallback;
    config.createImageryProvider = createImageryProvider;
    config.createTerrainProvider = createTerrainProvider;
}

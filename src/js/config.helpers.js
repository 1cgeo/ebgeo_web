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

/**
 * Check if any streetview markers are configured
 * @returns {boolean} True if streetview markers exist
 */
export function hasStreetViewMarkers() {
    return config.streetViewMarkers && config.streetViewMarkers.length > 0;
}

// ===== BASEMAPS =====

/**
 * Validate basemaps configuration - ensures at least one basemap is enabled.
 * Falls back to 'carta-topografica' if all basemaps are disabled.
 */
export function validateBasemapsConfig() {
    const enabled = Object.values(config.basemaps).filter(b => b.enabled);
    if (enabled.length === 0) {
        console.warn('All basemaps disabled! Enabling carta-topografica as fallback');
        config.basemaps['carta-topografica'].enabled = true;
    }
}

/**
 * Get enabled basemaps sorted by priority
 * @returns {Array} Array of [id, config] tuples sorted by priority
 */
export function getEnabledBasemaps() {
    return Object.entries(config.basemaps)
        .filter(([_id, basemapConfig]) => basemapConfig.enabled)
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
 * Get valid basemap fallback when current selection is unavailable
 * @param {string|null} currentBasemap - Currently selected basemap ID
 * @returns {string} Valid basemap ID
 */
export function getValidBasemapFallback(currentBasemap = null) {
    const enabled = getEnabledBasemaps();
    if (enabled.length === 0) return 'carta-topografica';

    if (currentBasemap && config.basemaps[currentBasemap]?.enabled) {
        return currentBasemap;
    }

    return enabled[0][0];
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
    config.hasStreetViewMarkers = hasStreetViewMarkers;
    config.validateBasemapsConfig = validateBasemapsConfig;
    config.getEnabledBasemaps = getEnabledBasemaps;
    config.getBasemapLayoutClass = getBasemapLayoutClass;
    config.getValidBasemapFallback = getValidBasemapFallback;
    config.createImageryProvider = createImageryProvider;
    config.createTerrainProvider = createTerrainProvider;
}

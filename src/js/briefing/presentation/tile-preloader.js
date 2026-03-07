// Path: js/briefing/presentation/tile-preloader.js
/**
 * @module briefing/presentation/tile-preloader
 * @description Tile preloader for briefing presentations.
 * Wraps MaplibrePreload to intercept flyTo/easeTo during presentations
 * and preload tiles along the animation path before animating.
 *
 * @dependencies utilities/maplibre-preload
 */

import { MaplibrePreload } from '@utils/maplibre-preload.js';

// ============================================================================
// TILE PRELOADER
// ============================================================================

/**
 * Preloads map tiles during briefing presentations.
 * Patches the map's movement methods so that each flyTo/easeTo
 * automatically preloads tiles before the animation starts.
 */
class TilePreloader {
    /**
     * @param {Object} map - MapLibre map instance
     */
    constructor(map) {
        this._preload = new MaplibrePreload(map, {
            async: true,
            useTile: true,
            burstLimit: 200
        });
    }

    /**
     * Destroys the preloader and restores original map methods.
     */
    destroy() {
        if (this._preload) {
            this._preload.unpatch();
            this._preload = null;
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Creates a new tile preloader instance.
 * @param {Object} map - MapLibre map instance
 * @returns {TilePreloader}
 */
export function createTilePreloader(map) {
    return new TilePreloader(map);
}

export default TilePreloader;

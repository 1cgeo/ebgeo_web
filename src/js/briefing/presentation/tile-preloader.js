// Path: js/briefing/presentation/tile-preloader.js

/**
 * @fileoverview Tile preloader for briefing presentations.
 * Preloads map tiles at specific positions so flyTo transitions
 * render smoothly without visible tile loading.
 *
 * Adapted from maplibre-preload (MIT License, AbelVM/maplibre-preload).
 * Uses MapLibre's internal Tile and OverscaledTileID classes to load
 * tiles through the source cache, which ensures proper caching.
 *
 * @module briefing/presentation/tile-preloader
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum concurrent tile load requests */
const BURST_LIMIT = 200;

/** Timeout for waiting on tile class capture (ms) */
const TILE_CLASS_TIMEOUT = 5000;

// ============================================================================
// TILE PRELOADER
// ============================================================================

/**
 * Preloads map tiles at specific viewport positions.
 * Uses MapLibre's internal tile loading mechanism for cache-compatible preloading.
 */
class TilePreloader {
    /**
     * @param {Object} map - MapLibre map instance
     */
    constructor(map) {
        this._map = map;
        this._TileClass = null;
        this._OverscaledTileIDClass = null;
        this._originalFlyTo = null;
        this._destroyed = false;

        this._captureTileClasses();
    }

    /**
     * Captures MapLibre's internal Tile and OverscaledTileID constructors
     * from a sourcedata event. These are needed to create tile objects
     * that the source cache can load.
     * @private
     */
    _captureTileClasses() {
        // Check if already captured from a previous instance
        if (this._map._preloadTileClass && this._map._preloadOverscaledTileIDClass) {
            this._TileClass = this._map._preloadTileClass;
            this._OverscaledTileIDClass = this._map._preloadOverscaledTileIDClass;
            return;
        }

        const handler = (e) => {
            if (e.tile && e.tile.tileID) {
                this._TileClass = e.tile.constructor;
                this._OverscaledTileIDClass = e.tile.tileID.constructor;
                // Cache on map instance for reuse
                this._map._preloadTileClass = this._TileClass;
                this._map._preloadOverscaledTileIDClass = this._OverscaledTileIDClass;
                this._map.off('sourcedata', handler);
            }
        };

        this._map.on('sourcedata', handler);

        // Cleanup handler after timeout if classes were never captured
        setTimeout(() => {
            this._map.off('sourcedata', handler);
        }, TILE_CLASS_TIMEOUT);
    }

    /**
     * Waits until tile classes are available (max timeout).
     * @private
     * @returns {Promise<boolean>} True if classes are available
     */
    async _ensureTileClasses() {
        if (this._TileClass && this._OverscaledTileIDClass) return true;

        // Wait with polling
        const start = Date.now();
        while (Date.now() - start < TILE_CLASS_TIMEOUT) {
            if (this._TileClass && this._OverscaledTileIDClass) return true;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.warn('TilePreloader: Could not capture tile classes');
        return false;
    }

    /**
     * Preloads tiles for a list of map viewport positions.
     * Visits each position, calculates visible tiles, and loads them
     * through MapLibre's source cache.
     *
     * @param {Array<Object>} positions - Array of positions
     * @param {Array<number>} positions[].center - [lng, lat]
     * @param {number} positions[].zoom - Zoom level
     * @param {number} [positions[].bearing=0] - Bearing in degrees
     * @param {number} [positions[].pitch=0] - Pitch in degrees
     * @param {Object} [options] - Options
     * @param {Function} [options.onProgress] - Progress callback (loaded, total)
     * @returns {Promise<void>}
     */
    async preloadPositions(positions, options = {}) {
        if (this._destroyed || !positions?.length) return;

        const hasClasses = await this._ensureTileClasses();
        if (!hasClasses) {
            // Fallback: use jumpTo + idle wait approach
            await this._preloadViaJumpTo(positions, options);
            return;
        }

        // Collect all unique tiles across all positions
        const allTiles = {};
        for (const pos of positions) {
            const perSource = this._getVisibleTilesPerSource(pos);
            for (const [sourceId, tiles] of Object.entries(perSource)) {
                if (!allTiles[sourceId]) allTiles[sourceId] = new Set();
                tiles.forEach(t => allTiles[sourceId].add(t));
            }
        }

        // Count total tiles
        let total = 0;
        for (const tileSet of Object.values(allTiles)) {
            total += tileSet.size;
        }

        if (total === 0) return;

        // Load all tiles
        let loaded = 0;
        const loadPromises = [];

        for (const [sourceId, tileSet] of Object.entries(allTiles)) {
            const source = this._map.getSource(sourceId);
            if (!source) continue;

            const tileSize = source.tileSize || 512;

            for (const tileKey of tileSet) {
                const [z, x, y] = tileKey.split('|').map(Number);

                try {
                    const tileID = new this._OverscaledTileIDClass(z, 0, z, x, y);
                    const tile = new this._TileClass(tileID, tileSize);
                    const loadPromise = source.loadTile(tile)
                        .then(() => {
                            loaded++;
                            if (options.onProgress) {
                                options.onProgress(loaded, total);
                            }
                        })
                        .catch(() => {
                            loaded++;
                            if (options.onProgress) {
                                options.onProgress(loaded, total);
                            }
                        });
                    loadPromises.push(loadPromise);
                } catch {
                    // Skip tiles that fail to construct
                    loaded++;
                }

                // Respect burst limit
                if (loadPromises.length >= BURST_LIMIT) {
                    await Promise.allSettled(loadPromises.splice(0, BURST_LIMIT));
                }
            }
        }

        // Wait for remaining tiles
        if (loadPromises.length > 0) {
            await Promise.allSettled(loadPromises);
        }
    }

    /**
     * Fallback preload approach: jumpTo each position and wait for idle.
     * Used when tile classes cannot be captured.
     * @private
     * @param {Array<Object>} positions - Positions to preload
     * @param {Object} options - Options with onProgress callback
     */
    async _preloadViaJumpTo(positions, options = {}) {
        if (!this._map || positions.length === 0) return;

        const total = positions.length;
        let loaded = 0;

        // Save current position
        const savedCenter = this._map.getCenter();
        const savedZoom = this._map.getZoom();
        const savedBearing = this._map.getBearing();
        const savedPitch = this._map.getPitch();

        for (const pos of positions) {
            if (this._destroyed) break;

            this._map.jumpTo({
                center: pos.center,
                zoom: pos.zoom,
                bearing: pos.bearing || 0,
                pitch: pos.pitch || 0
            });

            // Wait for tiles to load at this position
            if (!this._map.areTilesLoaded()) {
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 5000);
                    this._map.once('idle', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                });
            }

            loaded++;
            if (options.onProgress) {
                options.onProgress(loaded, total);
            }
        }

        // Restore original position
        this._map.jumpTo({
            center: savedCenter,
            zoom: savedZoom,
            bearing: savedBearing,
            pitch: savedPitch
        });
    }

    /**
     * Calculates visible tiles per source for a given viewport position.
     * @private
     * @param {Object} position - Viewport position
     * @param {number} [factor=0] - Viewport shrink factor (0 = full viewport)
     * @returns {Object} Map of sourceId to Set of tile keys ("z|x|y")
     */
    _getVisibleTilesPerSource(position, factor = 0) {
        const perSource = {};

        for (const sourceId in this._map.style.sourceCaches) {
            const sourceCache = this._map.style.sourceCaches[sourceId];
            if (!sourceCache.used) continue;

            const source = this._map.getSource(sourceId);
            if (!source) continue;

            const tiles = this._getVisibleTileRange(source, position, factor);
            perSource[sourceId] = tiles.map(t => `${t[0]}|${t[1]}|${t[2]}`);
        }

        return perSource;
    }

    /**
     * Calculates tile coordinates visible in a viewport.
     * Uses the map's transform to convert screen corners to tile coordinates.
     * @private
     * @param {Object} source - MapLibre source
     * @param {Object} position - Viewport position {center, zoom, bearing, pitch}
     * @param {number} factor - Viewport shrink factor
     * @returns {Array<Array<number>>} Array of [z, x, y] tile coordinates
     */
    _getVisibleTileRange(source, position, factor) {
        const tr = this._map.transform;
        const width = tr.width;
        const height = tr.height;
        const pitch = position.pitch || 0;
        const zoom = position.zoom;
        const pitchLimit = pitch / 150;

        // Screen corner points (with optional shrink factor)
        const cornerPoints = [
            [width * factor, height * (factor + pitchLimit)],
            [width * (1 - factor), height * (factor + pitchLimit)],
            [width * (1 - factor), height * (1 - factor)],
            [width * factor, height * (1 - factor)]
        ];

        // Temporarily move the map to the target position to use transform
        const savedCenter = this._map.getCenter();
        const savedZoom = this._map.getZoom();
        const savedBearing = this._map.getBearing();
        const savedPitch = this._map.getPitch();

        this._map.jumpTo({
            center: position.center,
            zoom: position.zoom,
            bearing: position.bearing || 0,
            pitch: position.pitch || 0
        });

        // Convert screen points to lng/lat
        const cornerLngLat = cornerPoints.map(p =>
            this._map.transform.screenPointToLocation({ x: p[0], y: p[1] })
        );

        // Restore position
        this._map.jumpTo({
            center: savedCenter,
            zoom: savedZoom,
            bearing: savedBearing,
            pitch: savedPitch
        });

        // Convert lng/lat to tile coordinates
        const z = Math.floor(zoom);
        const tileCoords = cornerLngLat.map(c => this._lngLatToTile(c.lng, c.lat, z));
        const xs = tileCoords.map(([x]) => x);
        const ys = tileCoords.map(([, y]) => y);
        const minX = Math.floor(Math.min(...xs));
        const maxX = Math.ceil(Math.max(...xs));
        const minY = Math.floor(Math.min(...ys));
        const maxY = Math.ceil(Math.max(...ys));

        const tiles = [];
        for (let x = minX; x < maxX; x++) {
            for (let y = minY; y < maxY; y++) {
                const ty = source.scheme !== 'xyz' ? Math.pow(2, z) - y - 1 : y;
                tiles.push([z, x, ty]);
            }
        }

        return tiles;
    }

    /**
     * Converts lng/lat to tile coordinates at a given zoom.
     * @private
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     * @param {number} zoom - Zoom level
     * @returns {Array<number>} [x, y] tile coordinates (fractional)
     */
    _lngLatToTile(lng, lat, zoom) {
        const z2 = Math.pow(2, zoom);
        const x = z2 * ((lng + 180) / 360);
        const y = z2 * (1 - (Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI)) / 2;
        return [x, y];
    }

    /**
     * Patches the map's flyTo method to preload tiles before animation.
     * The original flyTo is preserved and restored on destroy().
     */
    patchFlyTo() {
        if (this._originalFlyTo || this._destroyed) return;

        this._originalFlyTo = this._map.flyTo.bind(this._map);

        this._map.flyTo = async (options) => {
            // Preload end-position tiles before animation starts
            const endPos = {
                center: options.center || this._map.getCenter(),
                zoom: options.zoom !== undefined ? options.zoom : this._map.getZoom(),
                bearing: options.bearing !== undefined ? options.bearing : this._map.getBearing(),
                pitch: options.pitch !== undefined ? options.pitch : this._map.getPitch()
            };

            // Normalize center format (LngLat object to array)
            if (!Array.isArray(endPos.center) && endPos.center?.lng !== undefined) {
                endPos.center = [endPos.center.lng, endPos.center.lat];
            }

            // Only preload if animation is not disabled
            if (!(Object.hasOwn(options, 'animate') && !options.animate) && options.duration !== 0) {
                const hasClasses = this._TileClass && this._OverscaledTileIDClass;
                if (hasClasses) {
                    const tiles = this._getVisibleTilesPerSource(endPos);
                    await this._loadTiles(tiles);
                }
            }

            return this._originalFlyTo(options);
        };
    }

    /**
     * Loads tiles from a per-source tile map.
     * @private
     * @param {Object} tileRequests - Map of sourceId to array of "z|x|y" strings
     */
    async _loadTiles(tileRequests) {
        const loadPromises = [];

        for (const [sourceId, tileKeys] of Object.entries(tileRequests)) {
            const source = this._map.getSource(sourceId);
            if (!source) continue;

            const tileSize = source.tileSize || 512;

            for (const tileKey of tileKeys) {
                const [z, x, y] = tileKey.split('|').map(Number);
                try {
                    const tileID = new this._OverscaledTileIDClass(z, 0, z, x, y);
                    const tile = new this._TileClass(tileID, tileSize);
                    loadPromises.push(source.loadTile(tile).catch(() => {}));
                } catch {
                    // Skip tiles that fail
                }
            }
        }

        if (loadPromises.length > 0) {
            await Promise.allSettled(loadPromises);
        }
    }

    /**
     * Destroys the preloader and restores original map methods.
     */
    destroy() {
        this._destroyed = true;

        // Restore original flyTo
        if (this._originalFlyTo) {
            this._map.flyTo = this._originalFlyTo;
            this._originalFlyTo = null;
        }

        this._map = null;
        this._TileClass = null;
        this._OverscaledTileIDClass = null;
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

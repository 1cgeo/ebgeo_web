// Path: js/briefing/presentation/tile-preloader.js

/**
 * @fileoverview Tile preloader for briefing presentations.
 * Preloads map tiles at specific positions so flyTo transitions
 * render smoothly without visible tile loading.
 *
 * Strategy: fetches tile image URLs directly to warm the browser's
 * HTTP cache. When MapLibre later requests these tiles during flyTo,
 * the browser serves them from cache instantly.
 *
 * This approach is reliable across MapLibre versions because it uses
 * only public APIs (getSource, transform) and standard fetch().
 *
 * @module briefing/presentation/tile-preloader
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum concurrent fetch requests to avoid saturating the network */
const MAX_CONCURRENT = 30;

// ============================================================================
// TILE PRELOADER
// ============================================================================

/**
 * Preloads map tiles at specific viewport positions by warming the
 * browser HTTP cache with direct fetch() requests.
 */
class TilePreloader {
    /**
     * @param {Object} map - MapLibre map instance
     */
    constructor(map) {
        this._map = map;
        this._originalFlyTo = null;
        this._destroyed = false;
    }

    /**
     * Preloads tiles for a list of map viewport positions.
     * Calculates which tiles are visible at each position and fetches
     * them via HTTP to populate the browser cache.
     *
     * @param {Array<Object>} positions - Array of viewport positions
     * @param {Array<number>} positions[].center - [lng, lat]
     * @param {number} positions[].zoom - Zoom level
     * @param {number} [positions[].bearing=0] - Bearing in degrees
     * @param {number} [positions[].pitch=0] - Pitch in degrees
     * @returns {Promise<void>}
     */
    async preloadPositions(positions) {
        if (this._destroyed || !positions?.length) return;

        // Collect unique tile URLs across all positions and sources
        const urlSet = new Set();

        for (const pos of positions) {
            this._collectTileURLs(pos, urlSet);
        }

        if (urlSet.size === 0) return;

        // Fetch all URLs with concurrency limit
        const urls = Array.from(urlSet);
        await this._fetchWithConcurrency(urls, MAX_CONCURRENT);
    }

    /**
     * Collects tile URLs that would be visible at a given viewport position.
     * @private
     * @param {Object} position - Viewport position {center, zoom, bearing, pitch}
     * @param {Set<string>} urlSet - Set to add URLs to (deduplication)
     */
    _collectTileURLs(position, urlSet) {
        const z = Math.floor(position.zoom);
        const tileCoords = this._getVisibleTileCoords(position, z);

        // Iterate over active sources with tile URL templates
        for (const sourceId in this._map.style.sourceCaches) {
            const sourceCache = this._map.style.sourceCaches[sourceId];
            if (!sourceCache.used) continue;

            const source = this._map.getSource(sourceId);
            if (!source) continue;

            // Get tile URL template (raster/vector tile sources expose .tiles)
            const templates = source.tiles;
            if (!templates || templates.length === 0) continue;

            const template = templates[0];

            for (const [tx, ty] of tileCoords) {
                const tileY = source.scheme === 'tms'
                    ? Math.pow(2, z) - ty - 1
                    : ty;

                const url = template
                    .replace('{z}', z)
                    .replace('{x}', tx)
                    .replace('{y}', tileY);

                urlSet.add(url);
            }
        }
    }

    /**
     * Calculates which tile coordinates are visible at a given viewport position.
     * Uses pure math (no map.jumpTo) to avoid firing moveend events that would
     * prematurely resolve the flyTo Promise in animation.service.js.
     * @private
     * @param {Object} position - {center, zoom, bearing, pitch}
     * @param {number} z - Integer zoom level
     * @returns {Array<[number, number]>} Array of [x, y] tile coordinates
     */
    _getVisibleTileCoords(position, z) {
        const tr = this._map.transform;
        const width = tr.width;
        const height = tr.height;

        const [lng, lat] = position.center;
        const zoom = position.zoom;
        const bearing = (position.bearing || 0) * Math.PI / 180;

        // Meters per pixel at this zoom level (at the equator, adjusted for lat)
        // MapLibre uses 512px tiles; world width in pixels = 512 * 2^zoom
        const worldPx = 512 * Math.pow(2, zoom);
        const metersPerPxEquator = (2 * Math.PI * 6378137) / worldPx;
        const metersPerPx = metersPerPxEquator * Math.cos(lat * Math.PI / 180);

        // For pitched views, the far edge of the viewport sees further away.
        // Multiply effective height to cover tiles near the horizon.
        const pitchDeg = position.pitch || 0;
        const pitchFactor = 1 + Math.tan(Math.min(pitchDeg, 70) * Math.PI / 180);

        // Half-extents of the viewport in meters
        const halfW = (width / 2) * metersPerPx;
        const halfH = (height / 2) * metersPerPx * pitchFactor;

        // Screen corners in local meters (x=east, y=north) relative to center,
        // rotated by bearing so we cover the rotated viewport
        const cos = Math.cos(bearing);
        const sin = Math.sin(bearing);

        const corners = [
            { dx: -halfW, dy:  halfH },   // top-left
            { dx:  halfW, dy:  halfH },   // top-right
            { dx:  halfW, dy: -halfH },   // bottom-right
            { dx: -halfW, dy: -halfH }    // bottom-left
        ].map(({ dx, dy }) => ({
            // Rotate by bearing: when bearing > 0 the viewport is rotated clockwise
            east: dx * cos - dy * sin,
            north: dx * sin + dy * cos
        }));

        // Convert meter offsets to lng/lat offsets
        const metersPerDegLat = 111320;
        const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);

        const cornerCoords = corners.map(({ east, north }) => ({
            lng: lng + east / Math.max(metersPerDegLng, 1),
            lat: lat + north / Math.max(metersPerDegLat, 1)
        }));

        // Convert to tile coordinates and find bounding box
        const tileCoords = cornerCoords.map(c => this._lngLatToTile(c.lng, c.lat, z));
        const xs = tileCoords.map(t => t[0]);
        const ys = tileCoords.map(t => t[1]);

        const minX = Math.floor(Math.min(...xs));
        const maxX = Math.ceil(Math.max(...xs));
        const minY = Math.floor(Math.min(...ys));
        const maxY = Math.ceil(Math.max(...ys));

        // Clamp to valid tile range and collect
        const maxTile = Math.pow(2, z);
        const tiles = [];
        for (let x = minX; x < maxX; x++) {
            for (let y = minY; y < maxY; y++) {
                if (y >= 0 && y < maxTile) {
                    // Wrap x for antimeridian crossing
                    tiles.push([((x % maxTile) + maxTile) % maxTile, y]);
                }
            }
        }

        return tiles;
    }

    /**
     * Converts lng/lat to fractional tile coordinates at a given zoom.
     * @private
     * @param {number} lng - Longitude in degrees
     * @param {number} lat - Latitude in degrees
     * @param {number} z - Zoom level
     * @returns {[number, number]} [x, y] fractional tile coordinates
     */
    _lngLatToTile(lng, lat, z) {
        const z2 = Math.pow(2, z);
        const x = z2 * ((lng + 180) / 360);
        const latRad = lat * Math.PI / 180;
        const y = z2 * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
        return [x, y];
    }

    /**
     * Fetches an array of URLs with a concurrency limit.
     * Errors are silently ignored (tile preloading is best-effort).
     * @private
     * @param {string[]} urls - URLs to fetch
     * @param {number} concurrency - Max concurrent requests
     */
    async _fetchWithConcurrency(urls, concurrency) {
        let index = 0;

        const next = async () => {
            while (index < urls.length) {
                if (this._destroyed) return;
                const url = urls[index++];
                try {
                    await fetch(url, { mode: 'cors', credentials: 'same-origin' });
                } catch {
                    // Tile fetch failures are non-critical
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(concurrency, urls.length); i++) {
            workers.push(next());
        }
        await Promise.all(workers);
    }

    /**
     * Patches the map's flyTo method to preload destination tiles
     * before starting the animation. This ensures tiles at the end
     * position are already in the browser cache when the map arrives.
     */
    patchFlyTo() {
        if (this._originalFlyTo || this._destroyed) return;

        this._originalFlyTo = this._map.flyTo.bind(this._map);

        this._map.flyTo = async (options) => {
            // Only preload if animation is enabled
            if (!(Object.hasOwn(options, 'animate') && !options.animate) && options.duration !== 0) {
                const endPos = {
                    center: options.center || this._map.getCenter(),
                    zoom: options.zoom !== undefined ? options.zoom : this._map.getZoom(),
                    bearing: options.bearing !== undefined ? options.bearing : this._map.getBearing(),
                    pitch: options.pitch !== undefined ? options.pitch : this._map.getPitch()
                };

                // Normalize center format
                if (!Array.isArray(endPos.center) && endPos.center?.lng !== undefined) {
                    endPos.center = [endPos.center.lng, endPos.center.lat];
                }

                const urlSet = new Set();
                this._collectTileURLs(endPos, urlSet);
                if (urlSet.size > 0) {
                    await this._fetchWithConcurrency(Array.from(urlSet), MAX_CONCURRENT);
                }
            }

            return this._originalFlyTo(options);
        };
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

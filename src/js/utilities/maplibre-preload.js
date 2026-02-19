/**
 * @module utilities/maplibre-preload
 * @description MapLibre tile preloading plugin.
 * Intercepts flyTo/easeTo/panTo/zoomTo, calculates all tiles along
 * the animation path, and preloads them before the original animation runs.
 *
 * Based on maplibre-preload by AbelVM (https://github.com/AbelVM/maplibre-preload).
 * Vendored and adapted to ESM with unpatch() support.
 *
 * @dependencies maplibre-gl
 */

// ============================================================================
// MAPLIBRE PRELOAD
// ============================================================================

const PATCHED_METHODS = ['flyTo', 'panTo', 'easeTo', 'zoomTo'];

/**
 * Preloads map tiles for MapLibre GL JS during camera animations.
 * Patches movement methods to preload tiles before animating.
 */
export class MaplibrePreload {
    /**
     * @param {Object} map - MapLibre map instance
     * @param {Object} [options] - Configuration
     * @param {Function} [options.progressCallback] - Progress monitoring callback
     * @param {number} [options.burstLimit=200] - Max tiles per preload batch
     * @param {boolean} [options.async=true] - Wait for preload before animating
     * @param {boolean} [options.useTile=true] - Use MapLibre internal tile loading vs fetch
     */
    constructor(map, options = {}) {
        this.map = map;
        this.progressCallback = options.progressCallback || null;
        this.burstLimit = options.burstLimit || 200;
        this.async = !Object.hasOwn(options, 'async') || options.async;
        this.useTile = !Object.hasOwn(options, 'useTile') || options.useTile;
        this.controller = {};

        /** @type {Object<string, Function>} Saved originals for unpatch */
        this._originals = {};

        this._patchMoveMethods();

        if (this.useTile) {
            this._captureTileClass();
        }
    }

    // =========================================================================
    // PATCHING
    // =========================================================================

    /**
     * Patches map movement methods to inject tile preloading.
     * Saves original references for unpatch().
     * @private
     */
    _patchMoveMethods() {
        PATCHED_METHODS.forEach(method => {
            this._originals[method] = this.map[method].bind(this.map);

            this.map[method] = async (options) => {
                // Cancel any pending preload requests from a previous movement
                Object.keys(this.controller).forEach(a => {
                    this.controller[a].abort('cancelling due to new movement');
                    delete this.controller[a];
                });

                if (this.async) {
                    await this._preloadTilesForMove(method, options);
                } else {
                    this._preloadTilesForMove(method, options);
                }

                return this._originals[method](options);
            };
        });
    }

    /**
     * Restores original map methods and cleans up listeners.
     * Call this when tile preloading is no longer needed.
     */
    unpatch() {
        // Restore original movement methods
        PATCHED_METHODS.forEach(method => {
            if (this._originals[method]) {
                this.map[method] = this._originals[method];
            }
        });
        this._originals = {};

        // Cancel any pending preload requests
        Object.keys(this.controller).forEach(a => {
            this.controller[a].abort('unpatching');
            delete this.controller[a];
        });

        // Remove sourcedata listener if still active
        if (this.map._captureTileClass) {
            this.map.off('sourcedata', this.map._captureTileClass);
            delete this.map._captureTileClass;
        }

        this.map = null;
    }

    // =========================================================================
    // TILE CLASS CAPTURE
    // =========================================================================

    /**
     * Captures the internal Tile and OverscaledTileID constructors.
     * First tries to extract from already-loaded tiles in source caches
     * (the map is typically loaded when presentations start). Falls back
     * to a sourcedata listener for lazy capture.
     * @private
     */
    _captureTileClass() {
        // Try immediate capture from existing tiles
        for (const sourceId in this.map.style.sourceCaches) {
            const sourceCache = this.map.style.sourceCaches[sourceId];
            const tileKeys = Object.keys(sourceCache._tiles || {});
            if (tileKeys.length > 0) {
                const tile = sourceCache._tiles[tileKeys[0]];
                if (tile?.tileID) {
                    this.map.Tile = tile.constructor;
                    this.map.OverscaledTileID = tile.tileID.constructor;
                    return;
                }
            }
        }

        // Fallback: capture from the next sourcedata event
        this.map._captureTileClass = e => {
            if (e.tile && e.tile.tileID) {
                e.target.Tile = e.tile.constructor;
                e.target.OverscaledTileID = e.tile.tileID.constructor;
                e.target.off('sourcedata', e.target._captureTileClass);
            }
        };
        this.map.on('sourcedata', this.map._captureTileClass);
    }

    // =========================================================================
    // PRELOADING
    // =========================================================================

    /**
     * Main preload entry point for a movement method call.
     * Samples animation path frames, calculates visible tiles, and preloads them.
     * @private
     */
    async _preloadTilesForMove(method, options) {
        if (Object.hasOwn(options, 'animate') && !options.animate) return true;

        this.duration = options.duration || 1000;
        this.padding = options.padding || 0;
        this.fps = options.fps || 60;
        this.rho = options.curve || 1.42;

        const start = {
            center: this.map.getCenter(),
            zoom: this.map.getZoom(),
            bearing: this.map.getBearing(),
            pitch: this.map.getPitch()
        };
        const tc = options.center || start.center;
        const endCenter = tc.lng ? tc : { lng: tc[0], lat: tc[1] };
        const end = {
            center: endCenter,
            zoom: options.zoom !== undefined ? options.zoom : start.zoom,
            bearing: options.bearing !== undefined ? options.bearing : start.bearing,
            pitch: options.pitch !== undefined ? options.pitch : start.pitch
        };

        // Sample animation path frames
        let samples;
        if (method === 'flyTo') {
            samples = this._sampleFlyToPath(start, end, options);
        } else if (method === 'panTo') {
            samples = this._samplePanToPath(start, end, options);
        } else if (method === 'easeTo') {
            samples = this._sampleEaseToPath(start, end, options);
        } else if (method === 'zoomTo') {
            samples = this._sampleZoomToPath(start, end, options);
        } else {
            samples = [end];
        }

        // Preload final destination tiles first (highest priority)
        const endRequests = {};
        const endPerSource = this._getVisibleTilesPerSource(end, 0);
        for (const [sourceId, tiles] of Object.entries(endPerSource)) {
            if (!endRequests[sourceId]) endRequests[sourceId] = new Set();
            tiles.forEach(t => endRequests[sourceId].add(t));
        }
        await this._preloadTilesInternal(endRequests);

        // Preload tiles along the animation path
        const tileRequests = {};
        for (const s of samples) {
            let f = 0;
            let size = 0;
            let perSource = this._getVisibleTilesPerSource(s);

            for (const [, tiles] of Object.entries(perSource)) {
                size = Math.max(size, tiles.length);
            }

            // Reduce viewport if exceeding burst limit (pitch-aware)
            while (size > 1.1 * this.burstLimit) {
                f++;
                size = 0;
                perSource = this._getVisibleTilesPerSource(s, f / 20);
                for (const [, tiles] of Object.entries(perSource)) {
                    size = Math.max(size, tiles.length);
                }
            }

            for (const [sourceId, tiles] of Object.entries(perSource)) {
                if (!tileRequests[sourceId]) tileRequests[sourceId] = new Set();
                tiles.forEach(t => tileRequests[sourceId].add(t));
            }
        }
        await this._preloadTilesInternal(tileRequests);
    }

    // =========================================================================
    // PATH SAMPLING
    // =========================================================================

    /** @private */
    _sampleFlyToPath(_start, _end, options) {
        return this._flyToFrames(options);
    }

    /** @private */
    _samplePanToPath(start, end, _options) {
        const totalFrames = Math.ceil((this.duration / 1000) * this.fps);
        const samples = [end];
        for (let i = 1; i < totalFrames; i++) {
            const t = i / totalFrames;
            samples.push({
                center: this._interpolateLngLatLinear(start.center, end.center, t),
                zoom: start.zoom,
                bearing: start.bearing,
                pitch: start.pitch
            });
        }
        return samples;
    }

    /** @private */
    _sampleEaseToPath(start, end, _options) {
        const totalFrames = Math.ceil((this.duration / 1000) * this.fps);
        const samples = [end];
        for (let i = 1; i < totalFrames; i++) {
            const t = i / totalFrames;
            samples.push({
                center: this._interpolateLngLatLinear(start.center, end.center, t),
                zoom: this._interpolateLinear(start.zoom, end.zoom, t),
                bearing: this._interpolateLinear(start.bearing, end.bearing, t),
                pitch: this._interpolateLinear(start.pitch, end.pitch, t)
            });
        }
        return samples;
    }

    /** @private */
    _sampleZoomToPath(start, end, _options) {
        const totalFrames = Math.ceil((this.duration / 1000) * this.fps);
        const samples = [end];
        for (let i = 1; i < totalFrames; i++) {
            const t = i / totalFrames;
            samples.push({
                center: start.center,
                zoom: this._interpolateLinear(start.zoom, end.zoom, t),
                bearing: start.bearing,
                pitch: start.pitch
            });
        }
        return samples;
    }

    // =========================================================================
    // TILE CALCULATION
    // =========================================================================

    /**
     * Gets visible tiles per source for a given camera state.
     * @private
     * @param {Object} state - Camera state { center, zoom, bearing, pitch }
     * @param {number} [factor=0] - Viewport shrink factor (0 = full, >0 = smaller)
     * @returns {Object<string, string[]>} Map of sourceId → tile keys ("z|x|y")
     */
    _getVisibleTilesPerSource({ center, zoom, bearing, pitch }, factor = 0) {
        const perSource = {};
        for (const sourceId in this.map.style.sourceCaches) {
            const sourceCache = this.map.style.sourceCaches[sourceId];
            if (!sourceCache.used) continue;
            perSource[sourceId] = this._getVisibleTileRange(
                this.map.getSource(sourceId),
                { center, zoom, bearing, pitch },
                factor
            ).map(t => `${t[0]}|${t[1]}|${t[2]}`);
        }
        return perSource;
    }

    /**
     * Calculates the tile range visible for a given camera state.
     * @private
     */
    _getVisibleTileRange(source, { zoom, pitch }, factor) {
        function lngLatToTile(lng, lat, z) {
            const z2 = Math.pow(2, z);
            const x = z2 * ((lng + 180) / 360);
            const y = z2 * (1 - (Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI)) / 2;
            return [x, y];
        }

        const tr = this.map.transform;
        const width = tr.width;
        const height = tr.height;
        const pitchLimit = pitch / 150;

        const cornerPoints = [
            [width * factor, height * (factor + pitchLimit)],
            [width * (1 - factor), height * (factor + pitchLimit)],
            [width * (1 - factor), height * (1 - factor)],
            [width * factor, height * (1 - factor)]
        ];

        const cornerLngLat = cornerPoints.map(
            p => this.map.transform.screenPointToLocation({ x: p[0], y: p[1] })
        );
        const floorZoom = Math.floor(zoom);
        const tileCoords = cornerLngLat.map(c => lngLatToTile(c.lng, c.lat, floorZoom));
        const xs = tileCoords.map(([x]) => x);
        const ys = tileCoords.map(([, y]) => y);
        const minX = Math.floor(Math.min(...xs));
        const maxX = Math.ceil(Math.max(...xs));
        const minY = Math.floor(Math.min(...ys));
        const maxY = Math.ceil(Math.max(...ys));
        const tiles = [];

        for (let x = minX; x < maxX; x++) {
            for (let y = minY; y < maxY; y++) {
                const tileY = source.scheme !== 'xyz' ? Math.pow(2, floorZoom) - y - 1 : y;
                tiles.push([floorZoom, x, tileY]);
            }
        }

        return tiles;
    }

    // =========================================================================
    // TILE LOADING
    // =========================================================================

    /**
     * Preloads tiles using either MapLibre internal loading or HTTP fetch.
     * @private
     * @param {Object<string, Set<string>>} tileRequests - sourceId → Set of "z|x|y" keys
     */
    async _preloadTilesInternal(tileRequests) {
        if (this.useTile) {
            return this._preloadViaTileClass(tileRequests);
        }
        return this._preloadViaFetch(tileRequests);
    }

    /**
     * Preloads tiles using MapLibre's internal Tile class and source.loadTile().
     * @private
     */
    async _preloadViaTileClass(tileRequests) {
        // Tile class not captured yet — skip silently
        if (!this.map.Tile || !this.map.OverscaledTileID) return;

        const tileArray = [];
        for (const [sourceId, tileSet] of Object.entries(tileRequests)) {
            const source = this.map.getSource(sourceId);
            const tileSize = source.tileSize;
            for (const t of [...tileSet]) {
                const [z, x, y] = t.split('|');
                const tileID = new this.map.OverscaledTileID(z, 0, z, x, y);
                const tile = new this.map.Tile(tileID, tileSize);
                tileArray.push(source.loadTile(tile));
            }
        }
        return Promise.allSettled(tileArray);
    }

    /**
     * Preloads tiles via HTTP fetch (warms browser cache).
     * @private
     */
    async _preloadViaFetch(tileRequests) {
        const uuid = this._uuid();
        this.controller[uuid] = new AbortController();

        const timeoutId = setTimeout(() => {
            this.controller[uuid]?.abort('timeout');
        }, this.duration * 5);

        const cleanup = () => {
            delete this.controller[uuid];
            clearTimeout(timeoutId);
        };

        const fetchArray = [];
        for (const [sourceId, tileSet] of Object.entries(tileRequests)) {
            const source = this.map.getSource(sourceId);
            for (const tile of [...tileSet]) {
                const [z, x, y] = tile.split('|');
                const url = source.tiles[0]
                    .replace('{z}', z)
                    .replace('{x}', x)
                    .replace('{y}', y);
                try {
                    fetchArray.push(
                        fetch(url, { signal: this.controller[uuid].signal })
                    );
                } catch (e) {
                    console.warn('Tile fetch setup error:', e);
                }
            }
        }

        try {
            const responses = await Promise.allSettled(fetchArray);
            let loaded = 0;
            let failed = 0;
            responses.forEach(r => {
                if (r.status !== 'fulfilled' || !r.value?.ok) {
                    failed++;
                } else {
                    loaded++;
                }
                if (this.progressCallback) {
                    this.progressCallback({
                        loaded,
                        total: fetchArray.length,
                        failed
                    });
                }
            });
        } catch (e) {
            console.warn('Tile fetch error:', e);
        }

        cleanup();
    }

    // =========================================================================
    // FLYTO FRAME CALCULATION
    // =========================================================================

    /**
     * Calculates intermediate frames for a flyTo animation.
     * Ported from MapLibre's camera.ts flyTo implementation.
     * @private
     */
    _flyToFrames(options) {
        const totalFrames = Math.ceil((this.duration / 1000) * this.fps);
        const tr = this.map._getTransformForUpdate();
        const startCenter = tr.center;
        const startZoom = tr.zoom;
        const startBearing = tr.bearing;
        const startPitch = tr.pitch;
        const startRoll = tr.roll;
        const startPadding = tr.padding;

        const center = options.center?.lng
            ? options.center
            : { lng: options.center[0], lat: options.center[1] };
        const bearing = 'bearing' in options
            ? this.map._normalizeBearing(options.bearing, startBearing)
            : startBearing;
        const pitch = 'pitch' in options ? +options.pitch : startPitch;
        const roll = 'roll' in options
            ? this.map._normalizeBearing(options.roll, startRoll)
            : startRoll;
        const padding = 'padding' in options ? options.padding : startPadding;

        const flyToHandler = this.map.cameraHelper.handleFlyTo(tr, {
            bearing,
            pitch,
            roll,
            padding,
            locationAtOffset: tr.center,
            offsetAsPoint: { x: 0, y: 0 },
            center: options.center,
            minZoom: options.minZoom || 0,
            zoom: options.zoom,
        });

        const w0 = Math.max(tr.width, tr.height);
        const w1 = w0 / flyToHandler.scaleOfZoom;
        const u1 = flyToHandler.pixelPathLength;

        let rho = options.curve || 1.42;
        if (typeof flyToHandler.scaleOfMinZoom === 'number') {
            const wMax = w0 / flyToHandler.scaleOfMinZoom;
            rho = Math.sqrt(wMax / u1 * 2);
        }
        const rho2 = rho * rho;

        function zoomOutFactor(descent) {
            const b = (w1 * w1 - w0 * w0 + (descent ? -1 : 1) * rho2 * rho2 * u1 * u1)
                / (2 * (descent ? w1 : w0) * rho2 * u1);
            return Math.log(Math.sqrt(b * b + 1) - b);
        }

        function cosh(n) { return (Math.exp(n) + Math.exp(-n)) / 2; }

        const r0 = zoomOutFactor(false);
        let wFn = (s) => cosh(r0) / cosh(r0 + rho * s);
        let S = (zoomOutFactor(true) - r0) / rho;

        if (Math.abs(u1) < 0.000002 || !isFinite(S)) {
            const k = w1 < w0 ? -1 : 1;
            S = Math.abs(Math.log(w1 / w0)) / rho;
            wFn = (s) => Math.exp(k * rho * s);
        }

        const frames = [];
        for (let i = 0; i <= totalFrames; i++) {
            const k = i / totalFrames;
            const s = k * S;
            const scale = 1 / wFn(s);
            frames.push({
                center: this._interpolateLngLatLinear(startCenter, center, k),
                zoom: startZoom + Math.log2(scale),
                bearing: bearing + (bearing - startBearing) * k,
                pitch: pitch + (pitch - startPitch) * k
            });
        }

        // Final destination frame
        frames.push({
            center,
            zoom: options.zoom,
            bearing,
            pitch
        });

        return frames;
    }

    // =========================================================================
    // UTILITIES
    // =========================================================================

    /** @private */
    _interpolateLinear(a, b, t) {
        return a + (b - a) * t;
    }

    /** @private */
    _interpolateLngLatLinear(a, b, t) {
        return {
            lng: this._interpolateLinear(a.lng, b.lng, t),
            lat: this._interpolateLinear(a.lat, b.lat, t)
        };
    }

    /** @private */
    _uuid() {
        const lut = [];
        const d0 = Math.random() * 0xffffffff | 0;
        const d1 = Math.random() * 0xffffffff | 0;
        const d2 = Math.random() * 0xffffffff | 0;
        const d3 = Math.random() * 0xffffffff | 0;
        for (let i = 0; i < 256; i++) {
            lut[i] = (i < 16 ? '0' : '') + i.toString(16);
        }
        return lut[d0 & 0xff] + lut[d0 >> 8 & 0xff] + lut[d0 >> 16 & 0xff] + lut[d0 >> 24 & 0xff] + '-' +
            lut[d1 & 0xff] + lut[d1 >> 8 & 0xff] + '-' + lut[d1 >> 16 & 0x0f | 0x40] + lut[d1 >> 24 & 0xff] + '-' +
            lut[d2 & 0x3f | 0x80] + lut[d2 >> 8 & 0xff] + '-' + lut[d2 >> 16 & 0xff] + lut[d2 >> 24 & 0xff] +
            lut[d3 & 0xff] + lut[d3 >> 8 & 0xff] + lut[d3 >> 16 & 0xff] + lut[d3 >> 24 & 0xff];
    }
}

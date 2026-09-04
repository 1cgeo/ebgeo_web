// Path: js/terrain/terrain-elevation.js

/**
 * @fileoverview Terrain elevation reads, in two shapes: a single lookup and a
 * batch sampler. Pure of store and DOM on purpose, so the analysis geometry can
 * be unit-tested against a fake map.
 *
 * WHAT `map.queryTerrainElevation` COSTS IN MAPLIBRE 5.18, and why this module
 * exists. Read from the vendored bundle (`Terrain.getElevationForLngLat`): every
 * call runs a full `coveringTiles` traversal of the camera frustum, over seven
 * world copies, only to find the zoom level of the nearest tile; then it reads one
 * DEM pixel at that zoom. The traversal is the expensive half, and it yields the
 * same zoom for every sample of the same camera state. A viewshed asks for about
 * 10.000 samples in one go, a LOS for up to 500, a line profile for 26.
 *
 * The returned value is `DEM * exaggeration`, with no camera term: there is no
 * offset to subtract. A fixed reference point used to be queried on every call to
 * cancel an offset that does not exist in this version; that doubled the cost of
 * every terrain read in the application and is gone.
 *
 * Tile not loaded reads as 0, never null (`if(!dem)return 0` in the bundle).
 */

const DEFAULT_MIN_ZOOM = 0;
const DEFAULT_MAX_ZOOM = 24;

/**
 * Zoom the terrain lookup runs at for a given camera zoom, the same one MapLibre
 * picks on the public path: the integer zoom of the nearest covering tile, capped
 * by the DEM source's zoom range.
 *
 * @param {number} mapZoom - Current camera zoom
 * @param {number} [maxzoom=24] - DEM source maxzoom
 * @param {number} [minzoom=0] - DEM source minzoom
 * @returns {number} Integer zoom in [minzoom, maxzoom]; minzoom when mapZoom is not usable
 */
export function resolveTerrainLookupZoom(mapZoom, maxzoom = DEFAULT_MAX_ZOOM, minzoom = DEFAULT_MIN_ZOOM) {
    const lo = Number.isFinite(minzoom) ? Math.max(0, Math.floor(minzoom)) : DEFAULT_MIN_ZOOM;
    const hi = Number.isFinite(maxzoom) ? Math.max(lo, Math.floor(maxzoom)) : DEFAULT_MAX_ZOOM;
    if (!Number.isFinite(mapZoom)) return lo;
    return Math.min(hi, Math.max(lo, Math.floor(mapZoom)));
}

/**
 * Un-exaggerated elevation from a raw terrain read.
 * @param {*} raw - Value returned by the terrain
 * @param {number} exaggeration - Active terrain exaggeration
 * @returns {number} Elevation in meters; 0 when the read is not a finite number
 */
function normalizeElevation(raw, exaggeration) {
    if (!Number.isFinite(raw)) return 0;
    const factor = Number.isFinite(exaggeration) && exaggeration > 0 ? exaggeration : 1;
    return raw / factor;
}

/**
 * Terrain elevation at one coordinate, in meters, without exaggeration.
 * Synchronous: `queryTerrainElevation` is synchronous in MapLibre 5.18, and the
 * `await` callers put around this function only costs microtask hops.
 *
 * @param {Object} map - MapLibre GL map instance
 * @param {Array|Object} coordinates - [lng, lat] or {lng, lat}
 * @returns {number} Elevation in meters; 0 without terrain or without a loaded tile
 */
export function getTerrainElevation(map, coordinates) {
    const terrain = map?.getTerrain?.();
    if (!terrain) return 0;
    return normalizeElevation(map.queryTerrainElevation(coordinates), terrain.exaggeration);
}

/**
 * Coordinate as MapLibre's `Terrain.getElevationForLngLatZoom` expects it: an
 * object with `lng`, `lat` and `wrap()`. `LngLat.convert` exists on the global
 * build; without it, an array is wrapped by hand.
 * @param {Array|Object} coordinates - [lng, lat] or {lng, lat}
 * @returns {Object} LngLat-like object
 */
function toLngLat(coordinates) {
    const LngLat = globalThis.maplibregl?.LngLat;
    if (LngLat?.convert) return LngLat.convert(coordinates);
    if (Array.isArray(coordinates)) {
        const [lng, lat] = coordinates;
        return { lng, lat, wrap() { return this; } };
    }
    return coordinates;
}

/**
 * Builds a sampler that reads MANY elevations for ONE camera state. The lookup
 * zoom is resolved once, and each sample is then a single DEM pixel read through
 * `Terrain.getElevationForLngLatZoom`, skipping the per-call `coveringTiles`
 * traversal of the public API. Falls back to the public API when the internals
 * are not there (another MapLibre build), so the result is the same either way,
 * only slower.
 *
 * Use it for any loop of terrain reads: viewshed rays, LOS steps, line profiles.
 * Build it once per calculation, never once per sample, because the resolved zoom
 * is what makes it cheap.
 *
 * @param {Object} map - MapLibre GL map instance
 * @returns {{ elevation: function(Array|Object): number, fast: boolean, zoom: number|null }}
 */
export function createTerrainSampler(map) {
    const terrain = map?.getTerrain?.();
    if (!terrain) {
        return { elevation: () => 0, fast: false, zoom: null };
    }

    const exaggeration = terrain.exaggeration;
    const engine = map.terrain;
    const canReadByZoom = typeof engine?.getElevationForLngLatZoom === 'function';

    if (!canReadByZoom) {
        return {
            elevation: (coordinates) => normalizeElevation(map.queryTerrainElevation(coordinates), exaggeration),
            fast: false,
            zoom: null,
        };
    }

    const zoom = resolveTerrainLookupZoom(map.getZoom(), engine.tileManager?.maxzoom, engine.tileManager?.minzoom);

    return {
        elevation: (coordinates) => normalizeElevation(engine.getElevationForLngLatZoom(toLngLat(coordinates), zoom), exaggeration),
        fast: true,
        zoom,
    };
}

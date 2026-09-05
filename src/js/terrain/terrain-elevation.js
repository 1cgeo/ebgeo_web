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
 *
 * NOTE (2026-09-05): the package is 6.7.0 now, and `getElevationForLngLat` there
 * samples a coverage index first and only falls back to the `coveringTiles`
 * traversal when the DEM is not loaded
 * (`node_modules/maplibre-gl/src/render/terrain.ts:234`). The paragraph above
 * describes 5.18 and was not re-measured against 6.7.0 by this change.
 */

import { maplibregl } from '@js/map/maplibre.js';

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
 * Coordinate as a REAL `LngLat`, which is what `Terrain.getElevationForLngLatZoom`
 * expects: it opens on `lnglat.wrap()`
 * (`node_modules/maplibre-gl/src/render/terrain.ts:221`), so a bare array throws
 * there and a hand-built `{lng, lat}` reads 0 for every sample without a word.
 *
 * Until 2026-09-05 this read `globalThis.maplibregl?.LngLat` and, when it was not
 * there, built `{lng, lat, wrap() { return this; }}` by hand. That `wrap()` did not
 * normalize longitude: a coordinate past the antimeridian (lng -183) stayed out of
 * `[0, 1)` in Mercator and the read came back as 0 m in silence, instead of the
 * elevation at 177. Worse, the global was never set under `environment: 'node'`, so
 * the suite exercised the hand-built path while production used the other one.
 * `LngLat` now comes from the single entry point and there is ONE path.
 *
 * `null` for a coordinate `LngLat` refuses (NaN, or a latitude past +-90): the
 * constructor throws for those, and this module's contract is to read 0 for a
 * sample it cannot take, never to abort the loop that asked for 10.000 of them.
 * The rejection is DERIVED from the library instead of restated here, so a change
 * in its rules does not need an edit in this file.
 *
 * The finite check is the ONE case the constructor lets through: `isNaN(Infinity)`
 * is false, so `convert([Infinity, 40])` builds a LngLat, and the throw only lands
 * later, inside the `wrap()` that the terrain read calls on its first line
 * (`wrap(Infinity, -180, 180)` is NaN, and `new LngLat(NaN, 40)` throws). Measured
 * here on 2026-09-05, by the case in `tests/unit/terrain-elevation.test.js`.
 *
 * @param {Array|Object} coordinates - [lng, lat] or {lng, lat}
 * @returns {Object|null} LngLat, or null when the coordinate is not a valid one
 */
function toLngLat(coordinates) {
    try {
        const lngLat = maplibregl.LngLat.convert(coordinates);
        return Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat) ? lngLat : null;
    } catch {
        return null;
    }
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
        elevation: (coordinates) => {
            const lngLat = toLngLat(coordinates);
            if (!lngLat) return 0;
            return normalizeElevation(engine.getElevationForLngLatZoom(lngLat, zoom), exaggeration);
        },
        fast: true,
        zoom,
    };
}

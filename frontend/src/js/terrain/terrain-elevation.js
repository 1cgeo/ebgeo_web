// Path: js/terrain/terrain-elevation.js

/**
 * @fileoverview Terrain elevation reads, in two shapes: a single lookup and a
 * batch sampler. Pure of store and DOM on purpose, so the analysis geometry can
 * be unit-tested against a fake map.
 *
 * WHAT `map.queryTerrainElevation` COSTS IN MAPLIBRE 5.18, and why this module
 * exists. Read from the vendored bundle:
 *
 *   getElevationForLngLat(e, t) {
 *       const i = Ie(t, {maxzoom: this.tileManager.maxzoom, minzoom: ..., tileSize: 512, terrain: this});
 *       let a = 0;
 *       for (const e of i) e.canonical.z > a && (a = Math.min(e.canonical.z, this.tileManager.maxzoom));
 *       return this.getElevationForLngLatZoom(e, a)
 *   }
 *
 * `Ie` is `coveringTiles`: a full traversal of the camera frustum, with the
 * clipping plane and seven world copies, run only to find the zoom of the nearest
 * covering tile. Then ONE DEM pixel is read at that zoom. The traversal is the
 * expensive half, and it yields the same zoom for every sample of the same camera
 * state. A viewshed asks for thousands of samples in one go, a LOS for up to 500,
 * a line profile for 26.
 *
 * THE RETURNED VALUE IS `DEM * exaggeration`, with no camera term
 * (`getElevation(...) { return this.getDEMElevation(...) * this.exaggeration }`).
 * There is no offset to subtract. This branch used to query a fixed reference
 * point at `[0, 0]` on every call to cancel an offset that does not exist in this
 * version, which doubled the cost of every terrain read in the application.
 *
 * THE `options` ARGUMENT WAS ALREADY DEAD: `Map.queryTerrainElevation(e)` in the
 * bundle forwards only the coordinate (`getElevationForLngLat(LngLat.convert(e),
 * this.transform)`), so the `{ exaggerated: false }` this module used to pass had
 * no reader.
 *
 * Tile not loaded reads as 0, never null (`if (!dem) return 0` in the bundle).
 */

import { maplibregl } from '@js/map/maplibre.js';

const DEFAULT_MIN_ZOOM = 0;
const DEFAULT_MAX_ZOOM = 24;

/**
 * Zoom the terrain lookup runs at for a given camera zoom, mirroring what MapLibre
 * picks on the public path: the integer zoom of the nearest covering tile, capped
 * by the DEM source's zoom range.
 *
 * ONE DELIBERATE DIFFERENCE, and it only shows up below the DEM's `minzoom`: the
 * public path starts its search at 0 and would read at zoom 0, where no DEM tile
 * exists, returning 0 m. This clamps up to `minzoom`, where a coarse tile may
 * exist. The application never gets there (the terrain toggle zooms in), and where
 * it could, reading a coarse tile is the better answer of the two.
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
 *
 * The divisor mirrors what the map ACTUALLY applied, which is why an absent
 * exaggeration divides by 1 and not by the application's own default: the Terrain
 * constructor in the bundle reads
 * `this.exaggeration = typeof options.exaggeration === 'number' ? options.exaggeration : 1`.
 * A flattened scene (exaggeration 0) reads 0 for every point, so 0 is the honest
 * answer there and the division never happens.
 *
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
 *
 * Synchronous: `queryTerrainElevation` is synchronous in MapLibre 5.18, and the
 * `await` the callers keep around this function only costs microtask hops. The
 * signature stayed awaitable on purpose, because a dozen call sites and their test
 * doubles already treat it as a promise.
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
 * object with `lng`, `lat` and `wrap()`. The method calls `wrap()` on its first
 * line (`if (!cE(i, e.wrap())) return 0`), so an array handed straight in would
 * throw, and a plain `{lng, lat}` would read 0 for every sample without a word.
 *
 * `LngLat` now comes from the import, so the first branch is the normal one. The
 * hand-built fallbacks stay for the module DOUBLE: a `vi.mock` of the single entry
 * point stubs the handful of names the test under it needs, and this module is
 * imported by `terrain.control.js` and `import.control.js`, whose tests have no
 * reason to know about `LngLat`. The hand-built object has the same shape, so the
 * two paths agree.
 *
 * Until 2026-09-05 this read `globalThis.maplibregl?.LngLat`, and that spelling is
 * why the audit of the global missed this file: a `grep` for `maplibregl.` does not
 * match `maplibregl?.`.
 *
 * @param {Array|Object} coordinates - [lng, lat] or {lng, lat}
 * @returns {Object} LngLat-like object
 */
function toLngLat(coordinates) {
    const LngLat = maplibregl?.LngLat;
    if (LngLat?.convert) return LngLat.convert(coordinates);
    if (Array.isArray(coordinates)) {
        const [lng, lat] = coordinates;
        return { lng, lat, wrap() { return this; } };
    }
    if (coordinates && typeof coordinates.wrap !== 'function') {
        return { lng: coordinates.lng, lat: coordinates.lat, wrap() { return this; } };
    }
    return coordinates;
}

/**
 * Builds a sampler that reads MANY elevations for ONE camera state. The lookup
 * zoom is resolved once, and each sample is then a single DEM pixel read through
 * `Terrain.getElevationForLngLatZoom`, skipping the per-call `coveringTiles`
 * traversal of the public API. Falls back to the public API when the internals are
 * not there (another MapLibre build, or a test double that only stubs
 * `queryTerrainElevation`), so the result is the same either way, only slower.
 *
 * Use it for any loop of terrain reads: viewshed rays, LOS steps, line profiles,
 * imported lines. Build it once per calculation, never once per sample, because
 * the resolved zoom is what makes it cheap.
 *
 * @param {Object} map - MapLibre GL map instance
 * @returns {{ elevation: function(Array|Object): number, fast: boolean, zoom: number|null }}
 */
export function createTerrainSampler(map) {
    const terrain = map?.getTerrain?.();
    if (!terrain) {
        return { elevation: () => 0, fast: false, zoom: null };
    }

    const { exaggeration } = terrain;
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

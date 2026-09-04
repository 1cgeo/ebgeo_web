import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import {
    getTerrainElevation,
    createTerrainSampler,
    resolveTerrainLookupZoom,
} from '../../src/js/terrain/terrain-elevation.js';

// A map fake with the two read paths MapLibre 5.18 exposes: the public
// `queryTerrainElevation` (one coveringTiles traversal per call) and the
// `Terrain.getElevationForLngLatZoom` read at a resolved zoom. Both count calls.
function makeMap({ terrain = { source: 'terrainSource', exaggeration: 1.5 }, zoom = 12.7, maxzoom = 11, minzoom = 0, dem = () => 100, withEngine = true } = {}) {
    const map = {
        getTerrain: () => terrain,
        getZoom: () => zoom,
        queryTerrainElevation: vi.fn((c) => (terrain ? dem(c) * terrain.exaggeration : null)),
    };
    if (withEngine) {
        map.terrain = {
            tileManager: { maxzoom, minzoom },
            getElevationForLngLatZoom: vi.fn((lngLat, z) => dem([lngLat.lng, lngLat.lat], z) * terrain.exaggeration),
        };
    }
    return map;
}

describe('getTerrainElevation', () => {
    it('queries the terrain ONCE, with a single argument, and removes the exaggeration', () => {
        const map = makeMap({ dem: () => 200 });
        expect(getTerrainElevation(map, [-53.5, -29.7])).toBe(200);
        expect(map.queryTerrainElevation).toHaveBeenCalledTimes(1);
        expect(map.queryTerrainElevation.mock.calls[0]).toEqual([[-53.5, -29.7]]);
    });

    it('returns 0 without terrain, and never touches the query', () => {
        const map = makeMap({ terrain: null });
        expect(getTerrainElevation(map, [0, 0])).toBe(0);
        expect(map.queryTerrainElevation).not.toHaveBeenCalled();
    });

    it('treats a non-finite read as 0 and a missing exaggeration as 1', () => {
        const nan = makeMap({ dem: () => NaN });
        expect(getTerrainElevation(nan, [1, 1])).toBe(0);
        const raw = makeMap({ terrain: { source: 'terrainSource' }, dem: () => 42 });
        raw.queryTerrainElevation = vi.fn(() => 42);
        expect(getTerrainElevation(raw, [1, 1])).toBe(42);
    });

    it('is synchronous: the value is a number, not a promise', () => {
        const map = makeMap({ dem: () => 300 });
        expect(typeof getTerrainElevation(map, [1, 1])).toBe('number');
    });
});

describe('resolveTerrainLookupZoom', () => {
    it('floors the camera zoom and caps it at the DEM maxzoom', () => {
        expect(resolveTerrainLookupZoom(12.7, 11)).toBe(11);
        expect(resolveTerrainLookupZoom(9.99, 11)).toBe(9);
        expect(resolveTerrainLookupZoom(3, 11, 5)).toBe(5);
    });

    it('falls back to minzoom for a non-finite camera zoom', () => {
        expect(resolveTerrainLookupZoom(NaN, 11)).toBe(0);
        expect(resolveTerrainLookupZoom(Infinity, 11, 2)).toBe(2);
        expect(resolveTerrainLookupZoom(undefined, 11, 2)).toBe(2);
    });

    it('always yields an integer inside [minzoom, maxzoom]', () => {
        fc.assert(fc.property(
            fc.double({ min: -5, max: 30, noNaN: true }),
            fc.integer({ min: 0, max: 24 }),
            fc.integer({ min: 0, max: 24 }),
            (zoom, a, b) => {
                const lo = Math.min(a, b);
                const hi = Math.max(a, b);
                const z = resolveTerrainLookupZoom(zoom, hi, lo);
                return Number.isInteger(z) && z >= lo && z <= hi;
            },
        ));
    });
});

describe('createTerrainSampler', () => {
    it('resolves the zoom once and reads every sample by zoom, never through the public query', () => {
        const map = makeMap({ zoom: 12.7, maxzoom: 11, dem: (c) => c[0] * 10 });
        const sampler = createTerrainSampler(map);
        expect(sampler.fast).toBe(true);
        expect(sampler.zoom).toBe(11);

        const values = [[1, 0], [2, 0], [3, 0]].map((c) => sampler.elevation(c));
        expect(values).toEqual([10, 20, 30]);
        expect(map.terrain.getElevationForLngLatZoom).toHaveBeenCalledTimes(3);
        expect(map.terrain.getElevationForLngLatZoom.mock.calls.every((call) => call[1] === 11)).toBe(true);
        expect(map.queryTerrainElevation).not.toHaveBeenCalled();
    });

    it('matches getTerrainElevation value for value, so callers can switch without a visual change', () => {
        const map = makeMap({ dem: (c) => 50 + c[1] });
        const sampler = createTerrainSampler(map);
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -85, max: 85, noNaN: true }),
            (lng, lat) => sampler.elevation([lng, lat]) === getTerrainElevation(map, [lng, lat]),
        ));
    });

    it('falls back to the public query when the terrain internals are absent', () => {
        const map = makeMap({ withEngine: false, dem: () => 80 });
        const sampler = createTerrainSampler(map);
        expect(sampler.fast).toBe(false);
        expect(sampler.elevation([1, 1])).toBe(80);
        expect(map.queryTerrainElevation).toHaveBeenCalledTimes(1);
    });

    it('is inert without terrain: 0 for every coordinate and no reads at all', () => {
        const map = makeMap({ terrain: null });
        const sampler = createTerrainSampler(map);
        expect(sampler.elevation([1, 1])).toBe(0);
        expect(map.queryTerrainElevation).not.toHaveBeenCalled();
        expect(map.terrain.getElevationForLngLatZoom).not.toHaveBeenCalled();
    });

    it('reads 0 where the DEM tile is not loaded (MapLibre returns 0 there)', () => {
        const map = makeMap({ dem: () => 0 });
        expect(createTerrainSampler(map).elevation([1, 1])).toBe(0);
    });
});

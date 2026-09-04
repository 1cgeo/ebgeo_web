import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import { normalizeTileLodParams, applyTileLodParams } from '../../src/js/map/tile-lod.js';

describe('normalizeTileLodParams', () => {
    it('accepts a pair that keeps the LOD alive', () => {
        expect(normalizeTileLodParams([5, 6])).toEqual([5, 6]);
        expect(normalizeTileLodParams([9.314, 3])).toEqual([9.314, 3]);
        expect(normalizeTileLodParams([2, 1])).toEqual([2, 1]);
    });

    it('refuses the pair that disables the LOD (the production value until 2026-09-03)', () => {
        expect(normalizeTileLodParams([1, 10.0])).toBeNull();
        expect(normalizeTileLodParams([1.99, 3])).toBeNull();
    });

    it('refuses absent, short, non-numeric and non-finite parameters', () => {
        expect(normalizeTileLodParams(null)).toBeNull();
        expect(normalizeTileLodParams(undefined)).toBeNull();
        expect(normalizeTileLodParams([])).toBeNull();
        expect(normalizeTileLodParams([5])).toBeNull();
        expect(normalizeTileLodParams(['5', '6'])).toBeNull();
        expect(normalizeTileLodParams([NaN, 6])).toBeNull();
        expect(normalizeTileLodParams([5, Infinity])).toBeNull();
        expect(normalizeTileLodParams([5, 0.5])).toBeNull();
    });

    it('never returns a pair with a first value below 2 or a ratio below 1', () => {
        fc.assert(fc.property(
            fc.double({ min: -10, max: 30, noNaN: true }),
            fc.double({ min: -10, max: 30, noNaN: true }),
            (a, b) => {
                const out = normalizeTileLodParams([a, b]);
                return out === null || (out[0] >= 2 && out[1] >= 1);
            },
        ));
    });
});

describe('applyTileLodParams', () => {
    it('applies a valid pair to the map', () => {
        const map = { setSourceTileLodParams: vi.fn() };
        expect(applyTileLodParams(map, [7, 4])).toBe(true);
        expect(map.setSourceTileLodParams).toHaveBeenCalledWith(7, 4);
    });

    it('leaves the map untouched, and warns, for a pair that disables the LOD', () => {
        const map = { setSourceTileLodParams: vi.fn() };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(applyTileLodParams(map, [1, 10])).toBe(false);
        expect(map.setSourceTileLodParams).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('stays silent when there is no configuration at all', () => {
        const map = { setSourceTileLodParams: vi.fn() };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(applyTileLodParams(map, null)).toBe(false);
        expect(applyTileLodParams(map, undefined)).toBe(false);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('tolerates a map without the method', () => {
        expect(applyTileLodParams({}, [7, 4])).toBe(false);
        expect(applyTileLodParams(null, [7, 4])).toBe(false);
    });
});

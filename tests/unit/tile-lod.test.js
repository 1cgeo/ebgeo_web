import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import { normalizeTileLodParams, installTileLodParams, syncTileLodParams } from '../../src/js/map/tile-lod.js';

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

/**
 * A map with the shape the module touches: `style.tileManagers`, `on`,
 * `addSource` and `setSourceTileLodParams(a, b, id)`, which, like MapLibre, only
 * writes on the source that exists under `id` at that instant.
 * `createInternal` stands for a source that a `setStyle` adds by itself,
 * bypassing `map.addSource`.
 */
function fakeMap(ids = []) {
    const handlers = {};
    const manager = () => {
        const source = { lod: null };
        return { getSource: () => source };
    };
    const map = {
        style: { tileManagers: {} },
        on: vi.fn((type, fn) => {
            (handlers[type] ||= []).push(fn);
            return map;
        }),
        fire(type, event = {}) {
            for (const fn of handlers[type] || []) fn(event);
        },
        listenerCount: (type) => (handlers[type] || []).length,
        setSourceTileLodParams: vi.fn((a, b, id) => {
            const tm = map.style.tileManagers[id];
            if (!tm) throw new Error(`There is no source with ID "${id}"`);
            tm.getSource().lod = [a, b];
            return map;
        }),
        addSource: vi.fn((id) => {
            map.style.tileManagers[id] = manager();
            return map;
        }),
        createInternal(id) {
            map.style.tileManagers[id] = manager();
            return map.style.tileManagers[id].getSource();
        },
        lodOf: (id) => map.style.tileManagers[id].getSource().lod,
    };
    for (const id of ids) map.createInternal(id);
    return map;
}

const withoutLod = (map) => Object.keys(map.style.tileManagers).filter((id) => map.lodOf(id) === null);

describe('installTileLodParams', () => {
    it('applies the pair to the sources that already exist', () => {
        const map = fakeMap(['base', 'buildings']);
        expect(installTileLodParams(map, [4, 8])).toBe(true);
        expect(map.lodOf('base')).toEqual([4, 8]);
        expect(map.lodOf('buildings')).toEqual([4, 8]);
    });

    // The defect measured on 2026-09-14: the call ran before the style's
    // sources existed, and nothing applied the pair to them afterwards.
    it('covers the sources of a style that arrives AFTER the installation', () => {
        const map = fakeMap([]);
        installTileLodParams(map, [4, 8]);
        map.createInternal('asc');
        map.createInternal('world_ebgeo');
        map.fire('styledata');
        expect(withoutLod(map)).toEqual([]);
    });

    it('covers a source added at runtime through map.addSource, with no event', () => {
        const map = fakeMap(['base']);
        installTileLodParams(map, [4, 8]);
        map.addSource('terrainSource', { type: 'raster-dem' });
        map.addSource('hillshadeSource', { type: 'raster-dem' });
        expect(map.lodOf('terrainSource')).toEqual([4, 8]);
        expect(map.lodOf('hillshadeSource')).toEqual([4, 8]);
    });

    it('covers the NEW source objects a setStyle puts under the same ids', () => {
        const map = fakeMap(['base', 'points']);
        installTileLodParams(map, [4, 8]);
        const old = map.style.tileManagers.base.getSource();
        map.createInternal('base');
        expect(map.style.tileManagers.base.getSource()).not.toBe(old);
        expect(map.lodOf('base')).toBeNull();
        map.fire('styledata');
        expect(map.lodOf('base')).toEqual([4, 8]);
    });

    it('covers a source that only announces itself through sourcedata metadata', () => {
        const map = fakeMap([]);
        installTileLodParams(map, [4, 8]);
        map.createInternal('moldura_25k');
        map.fire('sourcedata', { sourceDataType: 'content' });
        expect(map.lodOf('moldura_25k')).toBeNull();
        map.fire('sourcedata', { sourceDataType: 'metadata' });
        expect(map.lodOf('moldura_25k')).toEqual([4, 8]);
    });

    it('does not touch a covered source again', () => {
        const map = fakeMap(['base', 'buildings']);
        installTileLodParams(map, [4, 8]);
        expect(map.setSourceTileLodParams).toHaveBeenCalledTimes(2);
        map.fire('styledata');
        map.fire('sourcedata', { sourceDataType: 'metadata' });
        expect(syncTileLodParams(map)).toBe(0);
        expect(map.setSourceTileLodParams).toHaveBeenCalledTimes(2);
    });

    it('re-applies a new pair to every source without duplicating listeners', () => {
        const map = fakeMap(['base']);
        installTileLodParams(map, [4, 8]);
        installTileLodParams(map, [6, 5]);
        expect(map.lodOf('base')).toEqual([6, 5]);
        expect(map.listenerCount('styledata')).toBe(1);
        expect(map.listenerCount('sourcedata')).toBe(1);
        map.addSource('late');
        expect(map.lodOf('late')).toEqual([6, 5]);
        expect(map.setSourceTileLodParams).toHaveBeenCalledTimes(3);
    });

    it('keeps covering the other sources when one of them refuses', () => {
        const map = fakeMap(['base', 'broken', 'buildings']);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        map.setSourceTileLodParams.mockImplementation((a, b, id) => {
            if (id === 'broken') throw new Error('refused');
            map.style.tileManagers[id].getSource().lod = [a, b];
        });
        installTileLodParams(map, [4, 8]);
        expect(withoutLod(map)).toEqual(['broken']);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('installs nothing, and warns, for a pair that disables the LOD', () => {
        const map = fakeMap(['base']);
        const addSource = map.addSource;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(installTileLodParams(map, [1, 10])).toBe(false);
        expect(map.setSourceTileLodParams).not.toHaveBeenCalled();
        expect(map.on).not.toHaveBeenCalled();
        expect(map.addSource).toBe(addSource);
        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('stays silent and installs nothing when there is no configuration at all', () => {
        const map = fakeMap(['base']);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(installTileLodParams(map, null)).toBe(false);
        expect(installTileLodParams(map, undefined)).toBe(false);
        expect(map.on).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('tolerates a map without the method, and sync on a map never installed', () => {
        expect(installTileLodParams({}, [7, 4])).toBe(false);
        expect(installTileLodParams(null, [7, 4])).toBe(false);
        expect(syncTileLodParams(fakeMap(['base']))).toBe(0);
        expect(syncTileLodParams(null)).toBe(0);
    });
});

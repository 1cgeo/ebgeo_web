// Path: tests/unit/symbol-bitmap-refresh.test.js

/**
 * The pass that rebuilds every stale symbol bitmap of one map, shared by the
 * v2.3 -> v2.4 storage migration and by the `.ebgeo` import.
 *
 * Two failures are worth pinning here, and neither is visible at runtime:
 *
 * 1. A feature that fails to regenerate must come out UNSTAMPED. Stamping it would
 *    claim a bitmap that was never written, and the next startup would skip it —
 *    the feature would keep the old oversized box forever, with nothing left to say
 *    why.
 * 2. The pass must be idempotent. It runs on every startup after the bump and on
 *    every import; a second pass that regenerates again would rewrite every PNG of
 *    the atlas for nothing.
 *
 * The generators need the DOM, so they are injected. `applyGeneratedBitmap` is the
 * REAL one: the point of these tests is which keys end up on the feature.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    findStaleBitmapFeatures,
    refreshStaleBitmaps,
} from '@store/migration/symbol-bitmap.refresh.js';
import { SYMBOL_BITMAP_VERSION } from '@js/military_tools/bitmap-version.js';

/**
 * Builds a feature with the given properties.
 * @param {Object} properties - Feature properties
 * @returns {Object} GeoJSON-ish feature
 */
function feature(properties) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties };
}

/**
 * A feature collection with one stale symbol and one stale measure.
 * @returns {Object} Feature collection keyed by storage type
 */
function collectionWithTwoStale() {
    return {
        points: [feature({ id: 'p1' })],
        military_symbols: [feature({ id: 's1', sidc: 'SFGPUCI' })],
        coordination_measures: [feature({ id: 'm1', pointCode: 'ECHELON' })],
    };
}

describe('findStaleBitmapFeatures', () => {
    it('finds the two bitmap buckets and ignores every other one', () => {
        const stale = findStaleBitmapFeatures(collectionWithTwoStale());

        expect(stale.map((s) => s.feature.properties.id)).toEqual(['s1', 'm1']);
        expect(stale.map((s) => s.featureType))
            .toEqual(['military_symbol', 'coordination_measure']);
        expect(stale.map((s) => s.storageType))
            .toEqual(['military_symbols', 'coordination_measures']);
    });

    it('skips a feature already on the current bitmap version', () => {
        const features = {
            military_symbols: [
                feature({ id: 'novo', bitmapVersion: SYMBOL_BITMAP_VERSION }),
                feature({ id: 'velho', bitmapVersion: 1 }),
            ],
        };

        expect(findStaleBitmapFeatures(features).map((s) => s.feature.properties.id))
            .toEqual(['velho']);
    });

    it('WORST CASE: degenerate collections return an empty list instead of throwing', () => {
        const degenerate = [
            ['undefined', undefined],
            ['null', null],
            ['not an object', 'lixo'],
            ['empty', {}],
            ['missing buckets', { points: [] }],
            ['bucket is not an array', { military_symbols: 42 }],
            ['bucket is null', { coordination_measures: null }],
        ];

        for (const [name, features] of degenerate) {
            expect(() => findStaleBitmapFeatures(features), name).not.toThrow();
            expect(findStaleBitmapFeatures(features), name).toEqual([]);
        }
    });

    it('skips entries that carry no properties', () => {
        const features = {
            military_symbols: [null, {}, { properties: null }, { properties: 'lixo' }],
        };

        expect(findStaleBitmapFeatures(features)).toEqual([]);
    });
});

describe('refreshStaleBitmaps', () => {
    it('stamps every generated key onto the feature and collects the blobs', async () => {
        const features = collectionWithTwoStale();
        const regenerate = vi.fn(async (featureType) => (
            featureType === 'military_symbol'
                ? { blob: 'png-simbolo', width: 78, height: 53 }
                : {
                    blob: 'png-medida',
                    width: 40,
                    height: 100,
                    pixelRatio: 4,
                    anchor: 'bottom',
                    iconOffset: [0, 12],
                }
        ));

        const { updated, failed, blobs } = await refreshStaleBitmaps(features, { regenerate });

        expect({ updated, failed }).toEqual({ updated: 2, failed: 0 });

        const symbol = features.military_symbols[0].properties;
        expect(symbol.width).toBe(78);
        expect(symbol.height).toBe(53);
        expect(symbol.bitmapVersion).toBe(SYMBOL_BITMAP_VERSION);
        // A military symbol has no ratio, anchor or offset: the keys stay absent.
        expect(symbol.pixelRatio).toBeUndefined();
        expect(symbol.anchor).toBeUndefined();
        expect(symbol.iconOffset).toBeUndefined();

        const measure = features.coordination_measures[0].properties;
        expect(measure.pixelRatio).toBe(4);
        expect(measure.anchor).toBe('bottom');
        expect(measure.iconOffset).toEqual([0, 12]);
        expect(measure.bitmapVersion).toBe(SYMBOL_BITMAP_VERSION);

        expect([...blobs.entries()]).toEqual([['s1', 'png-simbolo'], ['m1', 'png-medida']]);
    });

    it('leaves a feature that failed UNSTAMPED, and counts it', async () => {
        const features = collectionWithTwoStale();
        const regenerate = vi.fn(async (featureType) => (
            featureType === 'military_symbol' ? { blob: 'ok', width: 10, height: 10 } : null
        ));

        const { updated, failed, blobs } = await refreshStaleBitmaps(features, { regenerate });

        expect({ updated, failed }).toEqual({ updated: 1, failed: 1 });
        expect(features.coordination_measures[0].properties.bitmapVersion).toBeUndefined();
        expect(features.coordination_measures[0].properties.width).toBeUndefined();
        expect(blobs.has('m1')).toBe(false);
    });

    it('a generator that THROWS does not abort the pass', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const features = collectionWithTwoStale();
        const regenerate = vi.fn(async (featureType) => {
            if (featureType === 'military_symbol') throw new Error('canvas indisponivel');
            return { blob: 'ok', width: 10, height: 10 };
        });

        const { updated, failed } = await refreshStaleBitmaps(features, { regenerate });

        // The measure AFTER the throwing symbol still got its turn.
        expect({ updated, failed }).toEqual({ updated: 1, failed: 1 });
        expect(features.coordination_measures[0].properties.bitmapVersion)
            .toBe(SYMBOL_BITMAP_VERSION);
        vi.restoreAllMocks();
    });

    it('counts a feature without an id as failed instead of stamping it', async () => {
        // The image store is keyed by feature id: without one the blob has nowhere
        // to go, so claiming a fresh bitmap would be a lie.
        const features = { military_symbols: [feature({ sidc: 'SFGPUCI' })] };
        const regenerate = async () => ({ blob: 'png', width: 10, height: 10 });

        const { updated, failed, blobs } = await refreshStaleBitmaps(features, { regenerate });

        expect({ updated, failed }).toEqual({ updated: 0, failed: 1 });
        expect(blobs.size).toBe(0);
        expect(features.military_symbols[0].properties.bitmapVersion).toBeUndefined();
    });

    it('is idempotent: a second pass regenerates nothing', async () => {
        const features = collectionWithTwoStale();
        const regenerate = vi.fn(async () => ({ blob: 'png', width: 10, height: 10 }));

        await refreshStaleBitmaps(features, { regenerate });
        expect(regenerate).toHaveBeenCalledTimes(2);

        const segunda = await refreshStaleBitmaps(features, { regenerate });

        expect(regenerate).toHaveBeenCalledTimes(2);
        expect(segunda).toEqual({ updated: 0, failed: 0, blobs: new Map() });
    });

    it('calls onBlob once per success, so a caller can stream the blobs out', async () => {
        const features = collectionWithTwoStale();
        const seen = [];
        const regenerate = async (featureType) => (
            featureType === 'military_symbol' ? { blob: 'png', width: 10, height: 10 } : null
        );

        await refreshStaleBitmaps(features, {
            regenerate,
            onBlob: (id, blob) => { seen.push([id, blob]); },
        });

        expect(seen).toEqual([['s1', 'png']]);
    });

    it('awaits onBlob BEFORE stamping: a throwing onBlob leaves the feature unstamped and counts it as failed', async () => {
        // The stamp is a CLAIM that the cropped bitmap is on disk. If the write
        // fails (quota, a closed IndexedDB) the feature must come out exactly as it
        // went in, so the next pass finds it stale and tries again.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const features = {
            military_symbols: [
                feature({ id: 's1', sidc: 'SFGPUCI' }),
                feature({ id: 's2', sidc: 'SFGPUCI' }),
            ],
            coordination_measures: [feature({ id: 'm1', pointCode: 'ECHELON' })],
        };
        const antes = structuredClone(features.coordination_measures[0].properties);
        const regenerate = vi.fn(async () => ({ blob: 'png', width: 10, height: 10 }));
        const onBlob = vi.fn(async (id) => {
            if (id === 'm1') throw new Error('quota exceeded');
        });

        const { updated, failed, blobs } = await refreshStaleBitmaps(features, { regenerate, onBlob });

        expect({ updated, failed }).toEqual({ updated: 2, failed: 1 });
        // Untouched: not just unstamped — no width, no height, nothing.
        expect(features.coordination_measures[0].properties).toEqual(antes);
        // And the blob is not handed to the caller either: it never reached the disk.
        expect(blobs.has('m1')).toBe(false);
        expect([...blobs.keys()]).toEqual(['s1', 's2']);
        vi.restoreAllMocks();
    });

    it('onBlob is called before the stamp', async () => {
        // The order is the whole point of the guarantee above: a stamp written first
        // would survive a failed write.
        const features = collectionWithTwoStale();
        const noMomentoDoOnBlob = [];
        const porId = (id) => [...features.military_symbols, ...features.coordination_measures]
            .find((f) => f.properties.id === id);
        const regenerate = async () => ({ blob: 'png', width: 10, height: 10 });

        await refreshStaleBitmaps(features, {
            regenerate,
            onBlob: (id) => {
                const alvo = porId(id).properties;
                noMomentoDoOnBlob.push([id, alvo.bitmapVersion, alvo.width]);
            },
        });

        expect(noMomentoDoOnBlob).toEqual([['s1', undefined, undefined], ['m1', undefined, undefined]]);
        // And they ARE stamped once the pass is over.
        expect(porId('s1').properties.bitmapVersion).toBe(SYMBOL_BITMAP_VERSION);
        expect(porId('m1').properties.bitmapVersion).toBe(SYMBOL_BITMAP_VERSION);
    });

    it('deletes a stale imageUrl on success and leaves it on failure', async () => {
        // `imageUrl` is a base64 copy of the OLD, uncropped bitmap. Kept, it would
        // ride along inside every `.ebgeo` exported afterwards. On a FAILURE it must
        // stay: the old bitmap is still what is on disk.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const features = {
            military_symbols: [feature({ id: 's1', sidc: 'SFGPUCI', imageUrl: 'data:image/png;base64,VELHO' })],
            coordination_measures: [
                feature({ id: 'm1', pointCode: 'ECHELON', imageUrl: 'data:image/png;base64,VELHO' }),
            ],
        };
        const regenerate = async (featureType) => (
            featureType === 'military_symbol' ? { blob: 'png', width: 10, height: 10 } : null
        );

        const { updated, failed } = await refreshStaleBitmaps(features, { regenerate });

        expect({ updated, failed }).toEqual({ updated: 1, failed: 1 });
        expect('imageUrl' in features.military_symbols[0].properties).toBe(false);
        expect(features.coordination_measures[0].properties.imageUrl)
            .toBe('data:image/png;base64,VELHO');
        vi.restoreAllMocks();
    });

    it('an empty map is a no-op', async () => {
        const regenerate = vi.fn();

        await expect(refreshStaleBitmaps({}, { regenerate }))
            .resolves.toEqual({ updated: 0, failed: 0, blobs: new Map() });
        expect(regenerate).not.toHaveBeenCalled();
    });
});

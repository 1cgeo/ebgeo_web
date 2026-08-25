// Path: tests/unit/config-helpers-basemaps-e-provedores.test.js

/**
 * @fileoverview Pins `config.helpers.js`, the read/repair layer over the runtime
 * config singleton that `GET /api/config` hydrates.
 *
 * What this suite HOLDS:
 * - `getValidBasemapFallback`, the four-step resolution that must never hand the
 *   map an empty id while any basemap exists, INCLUDING the third step, where
 *   the answer comes from insertion order and not from priority;
 * - `validateBasemapsConfig`, which MUTATES the singleton, and the difference
 *   between "no basemap enabled" (repairs) and "no basemap at all" (no-op);
 * - `getEnabledBasemaps` sort order and what a missing `priority` does to it;
 * - `getBasemapLayoutClass` over the whole integer line;
 * - `hasTilesets`, which returns `undefined` rather than `false` when the key is
 *   absent;
 * - the `|| default` forms inside `createImageryProvider`, one of which eats a
 *   legitimate zero (`maximumLevel: 0`);
 * - `initConfigHelpers`, which attaches eight members onto the same singleton.
 *
 * Every case saves and restores the mutated slices of the singleton, because the
 * module under test writes into it by design.
 *
 * What it does NOT reach: `hasFirstPersonScenes`, which is only re-exported here
 * and is held by `tests/unit/fp-scene-config.test.js` where it is defined.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import config from '../../src/js/config.js';
import {
    hasTilesets,
    validateBasemapsConfig,
    getEnabledBasemaps,
    getBasemapLayoutClass,
    getValidBasemapFallback,
    createImageryProvider,
    createTerrainProvider,
    initConfigHelpers,
} from '../../src/js/config.helpers.js';

/** Snapshot of the singleton slices this suite is allowed to write into. */
let saved;

beforeEach(() => {
    saved = {
        basemaps: config.basemaps,
        tilesets: config.tilesets,
        map3d: config.map3d,
    };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    config.basemaps = saved.basemaps;
    config.tilesets = saved.tilesets;
    config.map3d = saved.map3d;
    vi.restoreAllMocks();
});

const bm = (enabled, priority) => ({ enabled, priority });

// ============================================================================
// getBasemapLayoutClass
// ============================================================================

describe('getBasemapLayoutClass', () => {
    it('maps one through five to their own grid classes', () => {
        expect([1, 2, 3, 4, 5].map(getBasemapLayoutClass)).toEqual([
            'base-layer-grid-1x1',
            'base-layer-grid-1x2',
            'base-layer-grid-2x1-center',
            'base-layer-grid-2x2',
            'base-layer-grid-2x2-center',
        ]);
    });

    it('the five classes are all distinct', () => {
        const classes = [1, 2, 3, 4, 5].map(getBasemapLayoutClass);
        expect(new Set(classes).size).toBe(5);
    });

    it('falls back to the 2x2 grid outside [1, 5]', () => {
        expect(getBasemapLayoutClass(0)).toBe('base-layer-grid-2x2');
        expect(getBasemapLayoutClass(6)).toBe('base-layer-grid-2x2');
        expect(getBasemapLayoutClass(-1)).toBe('base-layer-grid-2x2');
        expect(getBasemapLayoutClass(1000)).toBe('base-layer-grid-2x2');
    });

    it('falls back for NaN, Infinity, null, undefined and a NUMERIC STRING', () => {
        // The switch compares with ===, so '3' is not case 3.
        expect(getBasemapLayoutClass(NaN)).toBe('base-layer-grid-2x2');
        expect(getBasemapLayoutClass(Infinity)).toBe('base-layer-grid-2x2');
        expect(getBasemapLayoutClass(null)).toBe('base-layer-grid-2x2');
        expect(getBasemapLayoutClass(undefined)).toBe('base-layer-grid-2x2');
        expect(getBasemapLayoutClass('3')).toBe('base-layer-grid-2x2');
    });

    it('every integer outside [1, 5] resolves to the same default (fast-check)', () => {
        fc.assert(
            fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
                fc.pre(n < 1 || n > 5);
                expect(getBasemapLayoutClass(n)).toBe('base-layer-grid-2x2');
            }),
            { numRuns: 300 }
        );
    });
});

// ============================================================================
// getEnabledBasemaps
// ============================================================================

describe('getEnabledBasemaps', () => {
    it('returns only the enabled entries, as [id, config] tuples', () => {
        config.basemaps = { a: bm(true, 2), b: bm(false, 1), c: bm(true, 3) };
        const out = getEnabledBasemaps();
        expect(out).toHaveLength(2);
        expect(out.map(([id]) => id)).toEqual(['a', 'c']);
        expect(out[0][1]).toBe(config.basemaps.a);
    });

    it('sorts ASCENDING by priority, independent of key order', () => {
        config.basemaps = { z: bm(true, 9), a: bm(true, 1), m: bm(true, 5) };
        expect(getEnabledBasemaps().map(([id]) => id)).toEqual(['a', 'm', 'z']);
    });

    it('treats priority 0 as the highest priority, not as missing', () => {
        config.basemaps = { a: bm(true, 1), zero: bm(true, 0) };
        expect(getEnabledBasemaps().map(([id]) => id)).toEqual(['zero', 'a']);
    });

    it('sorts negative priorities ahead of zero', () => {
        config.basemaps = { a: bm(true, 0), neg: bm(true, -5) };
        expect(getEnabledBasemaps().map(([id]) => id)).toEqual(['neg', 'a']);
    });

    it('returns an empty array when every basemap is disabled', () => {
        config.basemaps = { a: bm(false, 1), b: bm(false, 2) };
        expect(getEnabledBasemaps()).toEqual([]);
    });

    it('returns an empty array for an empty basemap map', () => {
        config.basemaps = {};
        expect(getEnabledBasemaps()).toEqual([]);
    });

    it('OBSERVADO: a missing priority makes the comparator NaN and leaves the pair unsorted', () => {
        // `a.priority - b.priority` is NaN when either side is undefined, which
        // Array.prototype.sort treats as "keep going", so the result reflects
        // insertion order rather than any ordering decision.
        config.basemaps = { late: bm(true, 1), noPriority: bm(true, undefined) };
        expect(getEnabledBasemaps().map(([id]) => id)).toEqual(['late', 'noPriority']);
        config.basemaps = { noPriority: bm(true, undefined), late: bm(true, 1) };
        expect(getEnabledBasemaps().map(([id]) => id)).toEqual(['noPriority', 'late']);
    });

    it('OBSERVADO: a truthy non-boolean `enabled` counts as enabled', () => {
        config.basemaps = { a: { enabled: 'sim', priority: 1 } };
        expect(getEnabledBasemaps().map(([id]) => id)).toEqual(['a']);
    });
});

// ============================================================================
// validateBasemapsConfig (mutates the singleton)
// ============================================================================

describe('validateBasemapsConfig', () => {
    it('leaves a healthy configuration untouched', () => {
        config.basemaps = { a: bm(true, 1), b: bm(false, 2) };
        validateBasemapsConfig();
        expect(config.basemaps.a.enabled).toBe(true);
        expect(config.basemaps.b.enabled).toBe(false);
    });

    it('re-enables carta-topografica when everything is off', () => {
        config.basemaps = {
            outra: bm(false, 1),
            'carta-topografica': bm(false, 2),
        };
        validateBasemapsConfig();
        expect(config.basemaps['carta-topografica'].enabled).toBe(true);
        expect(config.basemaps.outra.enabled).toBe(false);
    });

    it('re-enables the FIRST key when carta-topografica is absent', () => {
        config.basemaps = { primeira: bm(false, 9), segunda: bm(false, 1) };
        validateBasemapsConfig();
        // Insertion order, not priority: `segunda` has the better priority and
        // is NOT the one repaired.
        expect(config.basemaps.primeira.enabled).toBe(true);
        expect(config.basemaps.segunda.enabled).toBe(false);
    });

    it('does nothing at all when there are no basemaps (no invented key)', () => {
        config.basemaps = {};
        validateBasemapsConfig();
        expect(config.basemaps).toEqual({});
    });

    it('does not throw when config.basemaps is missing entirely', () => {
        config.basemaps = undefined;
        expect(() => validateBasemapsConfig()).not.toThrow();
        expect(config.basemaps).toBeUndefined();
    });

    it('is idempotent: a second call changes nothing more', () => {
        config.basemaps = { a: bm(false, 1), b: bm(false, 2) };
        validateBasemapsConfig();
        const afterFirst = JSON.parse(JSON.stringify(config.basemaps));
        validateBasemapsConfig();
        expect(config.basemaps).toEqual(afterFirst);
    });
});

// ============================================================================
// getValidBasemapFallback
// ============================================================================

describe('getValidBasemapFallback', () => {
    it('keeps the current basemap when it is enabled', () => {
        config.basemaps = { a: bm(true, 5), b: bm(true, 1) };
        expect(getValidBasemapFallback('a')).toBe('a');
    });

    it('falls to the best-priority ENABLED basemap when the current one is disabled', () => {
        config.basemaps = { a: bm(false, 1), b: bm(true, 9), c: bm(true, 2) };
        expect(getValidBasemapFallback('a')).toBe('c');
    });

    it('falls to the best-priority enabled basemap for an unknown id', () => {
        config.basemaps = { a: bm(true, 9), b: bm(true, 2) };
        expect(getValidBasemapFallback('nao-existe')).toBe('b');
    });

    it('treats null, undefined and empty string as "no current basemap"', () => {
        config.basemaps = { a: bm(true, 9), b: bm(true, 2) };
        expect(getValidBasemapFallback(null)).toBe('b');
        expect(getValidBasemapFallback(undefined)).toBe('b');
        expect(getValidBasemapFallback('')).toBe('b');
        expect(getValidBasemapFallback()).toBe('b');
    });

    it('OBSERVADO: with nothing enabled it returns the first KEY, ignoring priority', () => {
        // Step 3 of the documented order. This is the branch an atlas overlay
        // that disabled every basemap lands on.
        config.basemaps = { primeira: bm(false, 9), melhor: bm(false, 1) };
        expect(getValidBasemapFallback('melhor')).toBe('primeira');
    });

    it('returns the empty string when the basemap map is empty', () => {
        config.basemaps = {};
        expect(getValidBasemapFallback('a')).toBe('');
        expect(getValidBasemapFallback(null)).toBe('');
    });

    it('CONTROLE: with an empty object present the same two calls answer instead of throwing', () => {
        config.basemaps = {};
        expect(() => getValidBasemapFallback('a')).not.toThrow();
        expect(() => getValidBasemapFallback(null)).not.toThrow();
    });

    it('CONSERTADO: a MISSING config.basemaps degrades to "" instead of throwing', () => {
        // Step 3 already guarded with `config.basemaps || {}` and the doc comment
        // promised '' for this case, but steps 1 and 2 dereferenced the container
        // first: `config.basemaps[current]?.enabled` protects the VALUE, not the
        // map, and `getEnabledBasemaps` called Object.entries on it. A partial
        // /api/config that omits `basemaps` crashed basemap resolution.
        config.basemaps = undefined;
        expect(getValidBasemapFallback('a')).toBe('');
        expect(getValidBasemapFallback(null)).toBe('');
        expect(getEnabledBasemaps()).toEqual([]);
    });

    it('CONSERTADO: a NULL config.basemaps has the same outcome', () => {
        config.basemaps = null;
        expect(getValidBasemapFallback('a')).toBe('');
        expect(getEnabledBasemaps()).toEqual([]);
    });

    it('CONTROLE: a basemap entry that is itself null does not resurrect the throw', () => {
        // `basemapConfig.enabled` on a null row was the second dereference in the
        // same expression, and only the container was reported.
        config.basemaps = { quebrada: null, boa: bm(true, 1) };
        expect(getEnabledBasemaps().map(([id]) => id)).toEqual(['boa']);
        expect(getValidBasemapFallback('quebrada')).toBe('boa');
    });

    it('never returns an empty id while any basemap exists (fast-check)', () => {
        fc.assert(
            fc.property(
                fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
                fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
                (flags, currentIndex) => {
                    config.basemaps = Object.fromEntries(
                        flags.map((enabled, i) => [`b${i}`, bm(enabled, flags.length - i)])
                    );
                    const current = currentIndex === null ? null : `b${currentIndex}`;
                    const out = getValidBasemapFallback(current);
                    expect(out).not.toBe('');
                    expect(Object.keys(config.basemaps)).toContain(out);
                }
            ),
            { numRuns: 200 }
        );
    });

    it('the answer is always enabled whenever at least one basemap is enabled', () => {
        fc.assert(
            fc.property(
                fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
                (flags) => {
                    fc.pre(flags.some(Boolean));
                    config.basemaps = Object.fromEntries(
                        flags.map((enabled, i) => [`b${i}`, bm(enabled, i)])
                    );
                    const out = getValidBasemapFallback(null);
                    expect(config.basemaps[out].enabled).toBe(true);
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// hasTilesets
// ============================================================================

describe('hasTilesets', () => {
    it('is true for a non-empty list', () => {
        config.tilesets = [{ id: 'a' }];
        expect(hasTilesets()).toBe(true);
    });

    it('is false for an empty list', () => {
        config.tilesets = [];
        expect(hasTilesets()).toBe(false);
    });

    it('OBSERVADO: returns undefined (not false) when the key is absent', () => {
        // `config.tilesets && ...` short-circuits to the falsy operand itself,
        // so the return type is not boolean. Callers must not use ===.
        config.tilesets = undefined;
        expect(hasTilesets()).toBeUndefined();
        expect(hasTilesets()).toBeFalsy();
        expect(hasTilesets()).not.toBe(false);
    });

    it('OBSERVADO: returns null when the key is null', () => {
        config.tilesets = null;
        expect(hasTilesets()).toBeNull();
    });
});

// ============================================================================
// createImageryProvider / createTerrainProvider
// ============================================================================

describe('createImageryProvider', () => {
    const withImagery = (imagery) => {
        config.map3d = { ...config.map3d, providers: { ...config.map3d.providers, imagery } };
    };

    it('returns false when imagery is disabled', () => {
        withImagery({ enabled: false, type: 'UrlTemplate', url: 'x', options: {} });
        expect(createImageryProvider()).toBe(false);
    });

    it('returns false for an unknown provider type', () => {
        withImagery({ enabled: true, type: 'Nope', url: 'x', options: {} });
        expect(createImageryProvider()).toBe(false);
    });

    it('fills UrlTemplate defaults when options are empty', () => {
        withImagery({ enabled: true, type: 'UrlTemplate', url: 'u', options: {} });
        expect(createImageryProvider()).toEqual({
            provider: 'UrlTemplateImageryProvider',
            url: 'u',
            maximumLevel: 18,
            minimumLevel: 0,
            tileWidth: 256,
            tileHeight: 256,
        });
    });

    it('honours supplied UrlTemplate options', () => {
        withImagery({
            enabled: true,
            type: 'UrlTemplate',
            url: 'u',
            options: { maximumLevel: 21, minimumLevel: 3, tileWidth: 512, tileHeight: 512 },
        });
        expect(createImageryProvider()).toMatchObject({
            maximumLevel: 21, minimumLevel: 3, tileWidth: 512, tileHeight: 512,
        });
    });

    it('CONTROLE: maximumLevel 1 survives, so the option IS read', () => {
        withImagery({ enabled: true, type: 'UrlTemplate', url: 'u', options: { maximumLevel: 1 } });
        expect(createImageryProvider().maximumLevel).toBe(1);
    });

    it('CONSERTADO: maximumLevel 0 and tileWidth 0 survive the default form', () => {
        // Zero is a legal maximum level (base tile only). The falsy-zero form
        // silently promoted it to 18, which asked the server for 19 zoom levels.
        withImagery({
            enabled: true,
            type: 'UrlTemplate',
            url: 'u',
            options: { maximumLevel: 0, tileWidth: 0, tileHeight: 0 },
        });
        const out = createImageryProvider();
        expect(out.maximumLevel).toBe(0);
        expect(out.tileWidth).toBe(0);
        expect(out.tileHeight).toBe(0);
    });

    it('CONTROLE: the defaults still apply when the option is ABSENT', () => {
        // Preserving zero must not mean preserving nothing: an absent option has
        // to keep landing on 18/256/256, or the fix would be indistinguishable
        // from deleting the defaults.
        withImagery({ enabled: true, type: 'UrlTemplate', url: 'u', options: {} });
        const out = createImageryProvider();
        expect(out.maximumLevel).toBe(18);
        expect(out.minimumLevel).toBe(0);
        expect(out.tileWidth).toBe(256);
        expect(out.tileHeight).toBe(256);
    });

    it('CONTROLE: NaN and a non-number fall back too, because `??` alone would not', () => {
        withImagery({
            enabled: true,
            type: 'UrlTemplate',
            url: 'u',
            options: { maximumLevel: NaN, tileWidth: '512', tileHeight: Infinity },
        });
        const out = createImageryProvider();
        expect(out.maximumLevel).toBe(18);
        expect(out.tileWidth).toBe(256);
        expect(out.tileHeight).toBe(256);
    });

    it('an ABSENT options object no longer throws', () => {
        withImagery({ enabled: true, type: 'UrlTemplate', url: 'u' });
        expect(createImageryProvider()).toEqual({
            provider: 'UrlTemplateImageryProvider',
            url: 'u',
            maximumLevel: 18,
            minimumLevel: 0,
            tileWidth: 256,
            tileHeight: 256,
        });
    });

    it('builds the WMS shape without touching options defaults', () => {
        withImagery({ enabled: true, type: 'WMS', url: 'u', options: { layers: 'l1,l2' } });
        expect(createImageryProvider()).toEqual({
            provider: 'WebMapServiceImageryProvider', url: 'u', layers: 'l1,l2',
        });
    });

    it('builds the SingleTile shape', () => {
        withImagery({ enabled: true, type: 'SingleTile', url: 'u', options: {} });
        expect(createImageryProvider()).toEqual({
            provider: 'SingleTileImageryProvider', url: 'u',
        });
    });
});

describe('createTerrainProvider', () => {
    const withTerrain = (terrain) => {
        config.map3d = { ...config.map3d, providers: { ...config.map3d.providers, terrain } };
    };

    it('returns the ellipsoid provider when terrain is disabled', () => {
        withTerrain({ enabled: false, type: 'Cesium', url: 'u', options: {} });
        expect(createTerrainProvider()).toEqual({ provider: 'EllipsoidTerrainProvider' });
    });

    it('returns the ellipsoid provider for an unknown type', () => {
        withTerrain({ enabled: true, type: 'Nope', options: {} });
        expect(createTerrainProvider()).toEqual({ provider: 'EllipsoidTerrainProvider' });
    });

    it('builds the Cesium provider with vertex normals defaulted to false', () => {
        withTerrain({ enabled: true, type: 'Cesium', url: 'u', options: {} });
        expect(createTerrainProvider()).toEqual({
            provider: 'CesiumTerrainProvider', url: 'u', requestVertexNormals: false,
        });
    });

    it('keeps requestVertexNormals true when asked', () => {
        withTerrain({
            enabled: true, type: 'Cesium', url: 'u',
            options: { requestVertexNormals: true },
        });
        expect(createTerrainProvider().requestVertexNormals).toBe(true);
    });

    it('the explicit Ellipsoid type is the same object shape as the fallbacks', () => {
        withTerrain({ enabled: true, type: 'Ellipsoid', options: {} });
        expect(createTerrainProvider()).toEqual({ provider: 'EllipsoidTerrainProvider' });
    });
});

// ============================================================================
// initConfigHelpers
// ============================================================================

describe('initConfigHelpers', () => {
    it('attaches the eight helpers onto the singleton', () => {
        const names = [
            'hasTilesets', 'hasFirstPersonScenes', 'validateBasemapsConfig',
            'getEnabledBasemaps', 'getBasemapLayoutClass', 'getValidBasemapFallback',
            'createImageryProvider', 'createTerrainProvider',
        ];
        for (const name of names) delete config[name];

        initConfigHelpers();

        expect(names.filter(n => typeof config[n] === 'function')).toHaveLength(8);
        expect(config.getBasemapLayoutClass(1)).toBe('base-layer-grid-1x1');
    });

    it('the attached member is the very same function, not a wrapper', () => {
        initConfigHelpers();
        expect(config.getValidBasemapFallback).toBe(getValidBasemapFallback);
        expect(config.hasTilesets).toBe(hasTilesets);
    });
});

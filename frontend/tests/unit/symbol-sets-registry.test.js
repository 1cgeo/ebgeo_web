// Path: tests/unit/symbol-sets-registry.test.js

/**
 * Behaviour of the on-demand symbol-set registry.
 *
 * ORDER MATTERS in this file: the registry caches the tables in module scope, and
 * Vitest isolates modules per FILE, not per test. The "before load" block must run
 * first, so it is declared first and no other block calls `loadSymbolSets()` ahead
 * of it.
 */

import { describe, it, expect } from 'vitest';

import {
    loadSymbolSets,
    areSymbolSetsLoaded,
    getSymbolSetData,
    getMainIcons,
    getModifier1,
    getModifier2,
    isValidSymbolSet,
    getAllSymbolSetCodes
} from '@js/military_tools/military_symbol_tool/symbol_sets.registry.js';

describe('before loadSymbolSets()', () => {
    it('reports the tables as absent', () => {
        expect(areSymbolSetsLoaded()).toBe(false);
    });

    it('throws instead of answering with empty lists', () => {
        // An empty list here would render a modal with silently empty comboboxes.
        expect(() => getMainIcons('10')).toThrow(/not loaded/);
        expect(() => getModifier1('10')).toThrow(/not loaded/);
        expect(() => getModifier2('10')).toThrow(/not loaded/);
        expect(() => getSymbolSetData('10')).toThrow(/not loaded/);
        expect(() => isValidSymbolSet('10')).toThrow(/not loaded/);
        expect(() => getAllSymbolSetCodes()).toThrow(/not loaded/);
    });
});

describe('loadSymbolSets()', () => {
    it('resolves with the eleven symbol sets and flips the loaded flag', async () => {
        const tables = await loadSymbolSets();

        expect(Object.keys(tables).sort()).toEqual(
            ['01', '02', '05', '10', '15', '20', '27', '30', '35', '36', '40']
        );
        expect(areSymbolSetsLoaded()).toBe(true);
    });

    it('is idempotent: a second call returns the very same object', async () => {
        const first = await loadSymbolSets();
        const second = await loadSymbolSets();

        expect(second).toBe(first);
    });

    it('shares a single in-flight load between concurrent callers', async () => {
        const [a, b, c] = await Promise.all([loadSymbolSets(), loadSymbolSets(), loadSymbolSets()]);

        expect(a).toBe(b);
        expect(b).toBe(c);
    });
});

describe('accessors after load', () => {
    it('returns non-empty main icons for every symbol set', async () => {
        await loadSymbolSets();

        for (const code of getAllSymbolSetCodes()) {
            const icons = getMainIcons(code);
            expect(Array.isArray(icons), `main icon of set ${code}`).toBe(true);
            expect(icons.length, `main icon of set ${code}`).toBeGreaterThan(0);
        }
    });

    it('returns arrays (possibly empty) for both modifier lists', async () => {
        await loadSymbolSets();

        for (const code of getAllSymbolSetCodes()) {
            expect(Array.isArray(getModifier1(code)), `modifier 1 of set ${code}`).toBe(true);
            expect(Array.isArray(getModifier2(code)), `modifier 2 of set ${code}`).toBe(true);
        }
    });

    it('preserves the composite (code, extension) key: 111299 stays twelve distinct entries', async () => {
        await loadSymbolSets();

        // Set 20 (Instalações) repeats code 111299 for the twelve supply classes;
        // only `extension` tells them apart. De-duplicating by code loses eleven.
        const repeated = getMainIcons('20').filter((entry) => entry.code === '111299');

        expect(repeated).toHaveLength(12);
        expect(new Set(repeated.map((entry) => entry.extension)).size).toBe(12);
        expect(repeated.map((entry) => entry.extension).sort((a, b) => a - b))
            .toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('keeps every entry of every list addressable by code plus extension', async () => {
        await loadSymbolSets();

        for (const code of getAllSymbolSetCodes()) {
            const icons = getMainIcons(code);
            const keys = new Set(icons.map((entry) => `${entry.code}|${entry.extension ?? ''}`));
            expect(keys.size, `unique (code, extension) pairs of set ${code}`).toBe(icons.length);
        }
    });

    it('validates known and unknown symbol set codes', async () => {
        await loadSymbolSets();

        expect(isValidSymbolSet('10')).toBe(true);
        expect(isValidSymbolSet('99')).toBe(false);
        // hasOwnProperty, not `in`: an inherited key must not pass for a symbol set.
        expect(isValidSymbolSet('__proto__')).toBe(false);
        expect(isValidSymbolSet('toString')).toBe(false);
    });

    it('answers null/empty for codes that do not exist, without throwing', async () => {
        await loadSymbolSets();

        expect(getSymbolSetData('99')).toBeNull();
        expect(getSymbolSetData(undefined)).toBeNull();
        expect(getSymbolSetData(null)).toBeNull();
        expect(getMainIcons('99')).toEqual([]);
        expect(getMainIcons(undefined)).toEqual([]);
        expect(getModifier1(null)).toEqual([]);
        expect(getModifier2('')).toEqual([]);
    });
});

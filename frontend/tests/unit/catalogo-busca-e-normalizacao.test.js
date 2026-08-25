// Path: tests/unit/catalogo-busca-e-normalizacao.test.js

/**
 * @fileoverview Pins the SEARCH half of `catalog/catalog.service.js`:
 * `CatalogService.searchItems` and the `_normalizeText` fold it is built on.
 *
 * What this suite HOLDS:
 * - the empty-query short-circuit, which returns the SAME array (not a copy);
 * - which fields are searched (`name`, `description`, `local`, and `keywords`
 *   only as a fallback) and which are NOT (`type`, `id`, `originalData`);
 * - the accent fold, including what it does and does NOT reach: `ç` DOES fold
 *   to `c` (its NFD form is `c` + combining cedilla), while `ß` and the ordinal
 *   `ª` survive untouched;
 * - the fold applies to BOTH sides, so an accented query finds an unaccented
 *   name and vice versa;
 * - the nullish guards that exist (`item.name || ''`) and the ones that do NOT
 *   (a numeric name, a numeric keyword), which throw.
 *
 * What it does NOT reach: `getAllItems` and the five private collectors behind
 * it, which read the hydrated runtime config and the atlas 360 allowlist; and
 * the date sort, held by `tests/unit/catalog-sort.test.js`.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { CatalogService } from '../../src/js/catalog/catalog.service.js';

const item = (over = {}) => ({
    id: 'i1',
    type: 'model3d',
    name: 'Base Aérea',
    description: '',
    local: '',
    ...over,
});

const namesOf = (items, query) =>
    CatalogService.searchItems(query, items).map(i => i.name);

// ============================================================================
// _normalizeText
// ============================================================================

describe('_normalizeText', () => {
    it('lowercases and strips the Portuguese diacritics', () => {
        expect(CatalogService._normalizeText('ÁÉÍÓÚÂÊÔÃÕÜ')).toBe('aeiouaeoaou');
    });

    it('folds the cedilla too, because NFD splits it into c + combining mark', () => {
        // This contradicts a common assumption: `ç` is NOT preserved.
        expect(CatalogService._normalizeText('Aparição')).toBe('aparicao');
        expect(CatalogService._normalizeText('AÇÃO')).toBe('acao');
    });

    it('does NOT fold characters whose NFD is a single code point', () => {
        expect(CatalogService._normalizeText('Straße')).toBe('straße');
        expect(CatalogService._normalizeText('1ª Divisão')).toBe('1ª divisao');
    });

    it('leaves digits, spaces and punctuation alone', () => {
        expect(CatalogService._normalizeText('Área 51 - Setor B/2'))
            .toBe('area 51 - setor b/2');
    });

    it('is idempotent', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const once = CatalogService._normalizeText(s);
                expect(CatalogService._normalizeText(once)).toBe(once);
            }),
            { numRuns: 300 }
        );
    });

    it('never lengthens the string and always yields lowercase', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const out = CatalogService._normalizeText(s);
                expect(out).toBe(out.toLowerCase());
                expect(out.normalize('NFD')).toBe(out);
            }),
            { numRuns: 300 }
        );
    });

    it('handles the empty string', () => {
        expect(CatalogService._normalizeText('')).toBe('');
    });

    it('CONSERTADO: a non-string normalizes to the empty string instead of throwing', () => {
        // It used to throw, and the four call sites guarded with `|| ''`, which
        // only stops FALSY values. Guarding at the choke point covers all of them.
        expect(CatalogService._normalizeText(null)).toBe('');
        expect(CatalogService._normalizeText(undefined)).toBe('');
        expect(CatalogService._normalizeText(5)).toBe('');
        expect(CatalogService._normalizeText({})).toBe('');
    });

    it('CONTROLE: the empty string it returns does NOT match a non-empty query', () => {
        // Degrading to '' must not turn a malformed field into a wildcard.
        expect(CatalogService._normalizeText(5).includes('5')).toBe(false);
    });
});

// ============================================================================
// searchItems — the empty query
// ============================================================================

describe('searchItems — the empty query short-circuit', () => {
    const items = [item({ name: 'A' }), item({ name: 'B' })];

    it('returns the SAME array reference for an empty query', () => {
        expect(CatalogService.searchItems('', items)).toBe(items);
    });

    it('returns everything for a whitespace-only query', () => {
        expect(CatalogService.searchItems('   ', items)).toBe(items);
        expect(CatalogService.searchItems('\t\n', items)).toBe(items);
    });

    it('returns everything for a nullish query', () => {
        expect(CatalogService.searchItems(null, items)).toBe(items);
        expect(CatalogService.searchItems(undefined, items)).toBe(items);
    });

    it('a real query returns a NEW array, never the input', () => {
        const out = CatalogService.searchItems('A', items);
        expect(out).not.toBe(items);
    });

    it('an empty item list stays empty for any query', () => {
        expect(CatalogService.searchItems('qualquer', [])).toEqual([]);
    });
});

// ============================================================================
// searchItems — which fields are read
// ============================================================================

describe('searchItems — fields searched', () => {
    it('matches on the name, as a SUBSTRING and not as a prefix', () => {
        expect(namesOf([item({ name: 'Base Aérea' })], 'aerea')).toEqual(['Base Aérea']);
        expect(namesOf([item({ name: 'Base Aérea' })], 'ase')).toEqual(['Base Aérea']);
    });

    it('matches on the description', () => {
        const items = [item({ name: 'X', description: 'Voo de reconhecimento' })];
        expect(namesOf(items, 'reconhecimento')).toEqual(['X']);
    });

    it('matches on the location field', () => {
        const items = [item({ name: 'X', local: 'Resende - RJ' })];
        expect(namesOf(items, 'resende')).toEqual(['X']);
    });

    it('matches on a keyword when nothing else does', () => {
        const items = [item({ name: 'X', keywords: ['aquartelamento', 'AMAN'] })];
        expect(namesOf(items, 'aman')).toEqual(['X']);
    });

    it('does NOT search the type, the id or the raw payload', () => {
        const items = [item({
            id: 'segredo', type: 'streetview360',
            name: 'X', originalData: { name: 'segredo' },
        })];
        expect(namesOf(items, 'segredo')).toEqual([]);
        expect(namesOf(items, 'streetview')).toEqual([]);
    });

    it('the accent fold applies to BOTH sides of the comparison', () => {
        const items = [item({ name: 'Análise de Terreno' })];
        expect(namesOf(items, 'analise')).toEqual(['Análise de Terreno']);
        expect(namesOf(items, 'ANÁLISE')).toEqual(['Análise de Terreno']);
        expect(namesOf([item({ name: 'Analise' })], 'análise')).toEqual(['Analise']);
    });

    it('the cedilla folds on both sides too', () => {
        expect(namesOf([item({ name: 'Operação Aparição' })], 'operacao'))
            .toEqual(['Operação Aparição']);
        expect(namesOf([item({ name: 'Operacao' })], 'operação')).toEqual(['Operacao']);
    });

    it('OBSERVADO: the query is normalized but NOT trimmed, so " a" misses "abc"', () => {
        // Only the empty-check trims; the comparison uses the raw query.
        expect(namesOf([item({ name: 'Abc' })], ' a')).toEqual([]);
        expect(namesOf([item({ name: 'Abc' })], 'a')).toEqual(['Abc']);
    });

    it('filters out the items that match nothing', () => {
        const items = [
            item({ name: 'Alfa' }), item({ name: 'Bravo' }), item({ name: 'Alfa Dois' }),
        ];
        expect(namesOf(items, 'alfa')).toEqual(['Alfa', 'Alfa Dois']);
    });

    it('preserves the input order among the matches', () => {
        const items = [item({ name: 'Zulu x' }), item({ name: 'Alfa x' })];
        expect(namesOf(items, 'x')).toEqual(['Zulu x', 'Alfa x']);
    });
});

// ============================================================================
// searchItems — keywords are a FALLBACK, not an extra field
// ============================================================================

describe('searchItems — the keywords fallback', () => {
    it('an item that already matched by name is returned regardless of keywords', () => {
        const items = [item({ name: 'Alfa', keywords: ['bravo'] })];
        expect(namesOf(items, 'alfa')).toEqual(['Alfa']);
    });

    it('an EMPTY keywords array is skipped, and the item simply does not match', () => {
        const items = [item({ name: 'Alfa', keywords: [] })];
        expect(namesOf(items, 'bravo')).toEqual([]);
    });

    it('a missing keywords field is skipped without throwing', () => {
        expect(namesOf([item({ name: 'Alfa' })], 'bravo')).toEqual([]);
        expect(namesOf([item({ name: 'Alfa', keywords: null })], 'bravo')).toEqual([]);
    });

    it('keywords are folded and matched as substrings', () => {
        const items = [item({ name: 'X', keywords: ['Aeródromo'] })];
        expect(namesOf(items, 'aerodromo')).toEqual(['X']);
        expect(namesOf(items, 'dromo')).toEqual(['X']);
    });

    it('one matching keyword out of many is enough', () => {
        const items = [item({ name: 'X', keywords: ['a', 'b', 'c', 'alvo'] })];
        expect(namesOf(items, 'alvo')).toEqual(['X']);
    });
});

// ============================================================================
// searchItems — the guards that exist and the ones that do not
// ============================================================================

describe('searchItems — nullish and wrong-typed fields', () => {
    it('a null or missing name, description or local is coerced to empty', () => {
        const items = [item({ name: null, description: undefined, local: null })];
        expect(() => CatalogService.searchItems('x', items)).not.toThrow();
        expect(CatalogService.searchItems('x', items)).toEqual([]);
    });

    it('an item with no fields at all does not throw', () => {
        expect(CatalogService.searchItems('x', [{}])).toEqual([]);
    });

    it('CONTROLE: a string name of the same content is searched normally', () => {
        expect(namesOf([item({ name: '2024' })], '2024')).toEqual(['2024']);
    });

    it('CONSERTADO: a NUMERIC name simply does not match, it no longer throws', () => {
        // `2024 || ''` is 2024, and `_normalizeText` then called `.toLowerCase()`
        // on a number, from inside `Array.prototype.filter`: one malformed row took
        // the WHOLE catalogue search down.
        expect(() => CatalogService.searchItems('x', [item({ name: 2024 })])).not.toThrow();
        expect(CatalogService.searchItems('x', [item({ name: 2024 })])).toEqual([]);
    });

    it('CONSERTADO: a malformed row does not hide the well-formed rows around it', () => {
        // This is the loss the throw actually caused: the good neighbours vanished.
        const out = CatalogService.searchItems('alvo', [
            item({ name: 2024 }), item({ name: 'Alvo' }), item({ name: {} }),
        ]);
        expect(out.map((i) => i.name)).toEqual(['Alvo']);
    });

    it('a numeric name of 0 still does not throw (0 was always falsy)', () => {
        expect(() => CatalogService.searchItems('x', [item({ name: 0 })])).not.toThrow();
    });

    it('CONSERTADO: a non-string keyword has the same outcome', () => {
        expect(() => CatalogService.searchItems('x', [item({ name: 'A', keywords: [42] })]))
            .not.toThrow();
        expect(CatalogService.searchItems('42', [item({ name: 'A', keywords: [42] })]))
            .toEqual([]);
    });

    it('CONTROLE: a non-string QUERY also degrades instead of throwing', () => {
        // `searchItems` short-circuits on falsy queries but not on a truthy
        // non-string, which reached `_normalizeText` by the same door.
        expect(() => CatalogService.searchItems(42, [item({ name: 'A' })])).not.toThrow();
    });
});

// ============================================================================
// Invariants
// ============================================================================

describe('searchItems — invariants (fast-check)', () => {
    it('the result is always a subsequence of the input', () => {
        fc.assert(
            fc.property(
                fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 8 }),
                fc.string({ minLength: 1, maxLength: 3 }),
                (names, query) => {
                    const items = names.map(name => item({ name }));
                    const out = CatalogService.searchItems(query, items);
                    expect(out.length).toBeLessThanOrEqual(items.length);
                    let cursor = 0;
                    for (const found of out) {
                        cursor = items.indexOf(found, cursor);
                        expect(cursor).toBeGreaterThanOrEqual(0);
                        cursor += 1;
                    }
                }
            ),
            { numRuns: 200 }
        );
    });

    it('an item always matches its own normalized name', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1, maxLength: 12 }), (name) => {
                const normalized = CatalogService._normalizeText(name);
                fc.pre(normalized.trim() !== '');
                const out = CatalogService.searchItems(normalized, [item({ name })]);
                expect(out).toHaveLength(1);
            }),
            { numRuns: 200 }
        );
    });
});

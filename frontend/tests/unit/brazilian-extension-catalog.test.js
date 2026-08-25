// Path: tests/unit/brazilian-extension-catalog.test.js
/**
 * @fileoverview Pins the lookup layer of
 * `frontend/src/js/military_tools/military_symbol_tool/brazilian_extension_catalog.js`:
 * the nine accessor functions over the two symbol-set catalogs (10 = Unidades,
 * 15 = Equipamentos) and the command-element registry.
 *
 * WHAT THIS SUITE PINS
 * - `getCatalogEntry`: the three-level lookup, and the bi-dimensional `extensions`
 *   branch where the extension number is coerced with `String(...)` (so the number
 *   0 and the string '0' agree, but '00' does not) and where a null/undefined
 *   number short-circuits to null even when the entry exists.
 * - `getCatalogEntryWithStandardIdentity`: the SPREAD merge, which keeps every base
 *   field the variant does not override (including the `byStandardIdentity` map
 *   itself) and falls back to the base entry when the identity has no variant.
 * - `supportsCommand`: `hasOwnProperty` versus default-true, and the fact that set
 *   15 is the only one that opts out. Note that the `hasOwnProperty` inside it
 *   guards the FLAG, never the LOOKUP; the lookup guard is `ownEntry`.
 * - `hasSection`: the "has content" rule, which is why set 15's empty `modifier2`
 *   reports false while its populated `mainIcon` reports true.
 * - Structural invariants of the catalog DATA itself (entry shapes, extension
 *   numbers, standard-identity keys), each asserted with the collection size first
 *   so an emptied catalog cannot pass by iterating zero times.
 * - That every table lookup goes through `ownEntry` (an `Object.hasOwn` read), so a
 *   symbol set, code base or standard identity named after an `Object.prototype`
 *   member is a MISS. It used to be a hit: the tables are object literals, so
 *   `getSymbolSetCatalog('constructor')` returned a Function and
 *   `getCommandElement('toString')` returned `{ svg: undefined }`, a truthy object
 *   that the post-processing spliced into the SVG as the literal text "undefined".
 *   Every one of those keys arrives from feature data, so it crosses import and sync.
 *
 * WHAT THIS SUITE DOES NOT REACH
 * - Nothing here applies a catalog entry to an SVG. `applyBrazilianLabelsToSVG` /
 *   `checkCatalogWarnings` / `hexToRgb` live in `brazilian_svg_postprocessing.js`
 *   and are covered by `tests/unit/brazilian-svg-postprocessing.test.js`.
 * - The SIDC parsing that produces the `codeBase` and `extensionNumber` arguments
 *   is covered by `tests/unit/brazilian-sidc.test.js`.
 * - The catalog is a static data file: this suite asserts its SHAPE, never that a
 *   particular Brazilian doctrine label is the correct one.
 */
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

import {
    getCatalogEntry,
    getCatalogEntryWithStandardIdentity,
    getSymbolSetCatalog,
    getAvailableSymbolSets,
    hasExtensions,
    getExtensionNumbers,
    hasSection,
    supportsCommand,
    getSpecialModifiers,
    getCommandElement,
} from '@js/military_tools/military_symbol_tool/brazilian_extension_catalog.js';

const ELEMENT_TYPES = ['mainIcon', 'modifier1', 'modifier2'];
const MODIFICATION_TYPES = ['labelMappings', 'graphicAdaptations', 'extensions'];

/** Silence the module's console.warn for one call and return the result. */
function quiet(fn) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        return fn();
    } finally {
        warn.mockRestore();
    }
}

// ============================================================================
// getAvailableSymbolSets / getSymbolSetCatalog
// ============================================================================

describe('getAvailableSymbolSets', () => {
    it('lists exactly the two sets that carry a Brazilian extension', () => {
        expect(getAvailableSymbolSets()).toEqual(['10', '15']);
    });

    it('returns a fresh array each call (Object.keys), so callers cannot poison it', () => {
        const a = getAvailableSymbolSets();
        a.push('99');
        expect(getAvailableSymbolSets()).toEqual(['10', '15']);
    });
});

describe('getSymbolSetCatalog', () => {
    it('returns the catalog object for a known set', () => {
        const cat = getSymbolSetCatalog('10');
        expect(Object.keys(cat).sort())
            .toEqual(['mainIcon', 'modifier1', 'modifier2', 'specialModifiers']);
        // Set 15 is the one that carries the extra opt-out flag.
        expect(Object.keys(getSymbolSetCatalog('15')).sort())
            .toEqual(['mainIcon', 'modifier1', 'modifier2', 'specialModifiers', 'supportsCommand']);
    });

    it('returns the LIVE object, not a copy', () => {
        expect(getSymbolSetCatalog('10')).toBe(getSymbolSetCatalog('10'));
    });

    it('returns null for an unknown set', () => {
        expect(getSymbolSetCatalog('99')).toBeNull();
        expect(getSymbolSetCatalog('')).toBeNull();
        expect(getSymbolSetCatalog(null)).toBeNull();
        expect(getSymbolSetCatalog(undefined)).toBeNull();
        // The NUMBER 10 is not the string key '10'... except that JS object index
        // access coerces it, so this one DOES resolve. Fixed here so a future
        // Map-based rewrite has to be deliberate about it.
        expect(getSymbolSetCatalog(10)).toBe(getSymbolSetCatalog('10'));
    });

    it('CORRIGIDO: a prototype key is a MISS, not a Function (Object.hasOwn lookup)', () => {
        // Before the fix `SYMBOL_SET_CATALOGS[symbolSet]` reached Object.prototype and
        // returned a FUNCTION where the caller expects a catalog or null. The keys below all
        // exist on Object.prototype, so they are exactly the ones that used to leak.
        const herdadas = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];
        expect(herdadas).toHaveLength(4);
        for (const chave of herdadas) {
            expect(chave in {}, chave).toBe(true);        // the key really IS inherited
            expect(getSymbolSetCatalog(chave), chave).toBeNull();
        }
        // CONTROLE: a declared set still resolves, so the guard did not close everything.
        expect(getSymbolSetCatalog('10')).not.toBeNull();
    });
});

// ============================================================================
// getCatalogEntry — the three-level lookup
// ============================================================================

describe('getCatalogEntry', () => {
    it('resolves a label mapping', () => {
        expect(getCatalogEntry('10', 'mainIcon', 'labelMappings', '110200'))
            .toEqual({ from: 'CA', to: 'Civ', fontSize: '45' });
    });

    it('resolves a bi-dimensional extension by number and by numeric string alike', () => {
        const byNumber = getCatalogEntry('10', 'mainIcon', 'extensions', '121899', 0);
        const byString = getCatalogEntry('10', 'mainIcon', 'extensions', '121899', '0');
        expect(byNumber).toEqual({
            type: 'text',
            text: 'FE',
            position: { x: 100, y: 115 },
            style: { fontSize: '42', fontWeight: 'bold', fill: 'black' },
        });
        // `String(extensionNumber)` is what makes the two agree.
        expect(byString).toBe(byNumber);
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '121899', 1).text).toBe('Prec');
    });

    it('ARMADILHA: extension 0 is a REAL index, not "absent"', () => {
        // The falsy-zero trap the backlog keeps finding elsewhere does not fire
        // here, because the guard is `=== null || === undefined` and not `!value`.
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '121899', 0)).not.toBeNull();
    });

    it('OBSERVADO: a zero-padded extension string does NOT match', () => {
        // String('00') is '00', and the catalog keys are '0'..'16'.
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '121899', '00')).toBeNull();
    });

    it('returns null when the extension number is missing, even if the code has extensions', () => {
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '121899')).toBeNull();
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '121899', null)).toBeNull();
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '121899', undefined)).toBeNull();
    });

    it('OBSERVADO: false coerces to the key "false" and therefore misses', () => {
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '121899', false)).toBeNull();
    });

    it('returns null (and warns) at every level of an unknown lookup', () => {
        expect(quiet(() => getCatalogEntry('99', 'mainIcon', 'labelMappings', '110200'))).toBeNull();
        expect(quiet(() => getCatalogEntry('10', 'bogusElement', 'labelMappings', '110200'))).toBeNull();
        expect(quiet(() => getCatalogEntry('10', 'mainIcon', 'bogusMod', '110200'))).toBeNull();
        // Unknown code base is NOT a warning path: it just misses.
        expect(getCatalogEntry('10', 'mainIcon', 'labelMappings', '000000')).toBeNull();
        expect(getCatalogEntry('10', 'mainIcon', 'extensions', '000000', 0)).toBeNull();
    });

    it('warns exactly once for an unknown symbol set', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        getCatalogEntry('99', 'mainIcon', 'labelMappings', 'x');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('99');
        warn.mockRestore();
    });

    it('CONTROLE: the lookup really does discriminate between element types', () => {
        // Without this, the "returns null" tests above would pass for a function
        // that always returned null.
        const main = getCatalogEntry('10', 'mainIcon', 'labelMappings', '110200');
        const mod1 = getCatalogEntry('10', 'modifier1', 'labelMappings', '110200');
        expect(main).not.toBeNull();
        expect(mod1).not.toBe(main);
    });
});

// ============================================================================
// hasExtensions / getExtensionNumbers
// ============================================================================

describe('hasExtensions', () => {
    it('is true for a code base that carries extensions and false otherwise', () => {
        expect(hasExtensions('10', 'mainIcon', '121899')).toBe(true);
        expect(hasExtensions('10', 'mainIcon', '000000')).toBe(false);
    });

    it('is false for an unknown symbol set or element type', () => {
        expect(hasExtensions('99', 'mainIcon', '121899')).toBe(false);
        expect(hasExtensions('10', 'bogus', '121899')).toBe(false);
    });

    it('CORRIGIDO: returns the BOOLEAN false when the section has no extensions map', () => {
        // The body used to be `return extensions && extensions[codeBase] !== undefined`, so a
        // missing `extensions` key yielded the falsy `undefined` rather than a boolean.
        // Harmless under `if (...)`, wrong under `=== false` or JSON. Asserted with toBe, not
        // toBeFalsy, because toBeFalsy would accept the old `undefined` too.
        expect(hasExtensions('10', 'specialModifiers', '1')).toBe(false);
        // CONTROLE: the true branch is still reachable and still a boolean.
        expect(hasExtensions('10', 'mainIcon', '121899')).toBe(true);
    });

    it('CORRIGIDO: a prototype key as codeBase is a miss, not a hit', () => {
        expect(hasExtensions('10', 'mainIcon', 'toString')).toBe(false);
        expect(hasExtensions('10', 'mainIcon', 'constructor')).toBe(false);
    });

    it('agrees with getExtensionNumbers over every declared code base', () => {
        let checked = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            for (const elementType of ELEMENT_TYPES) {
                const extensions = catalog[elementType].extensions || {};
                for (const codeBase of Object.keys(extensions)) {
                    checked++;
                    expect(hasExtensions(set, elementType, codeBase), `${set}/${elementType}/${codeBase}`)
                        .toBe(true);
                    expect(getExtensionNumbers(set, elementType, codeBase).length)
                        .toBeGreaterThan(0);
                }
            }
        }
        // The loop above is worthless if the catalog is empty.
        expect(checked).toBe(20);
    });
});

describe('getExtensionNumbers', () => {
    it('returns the extension indices as NUMBERS', () => {
        expect(getExtensionNumbers('10', 'mainIcon', '121899')).toEqual([0, 1]);
    });

    it('returns [] for every miss', () => {
        expect(getExtensionNumbers('99', 'mainIcon', '121899')).toEqual([]);
        expect(getExtensionNumbers('10', 'bogus', '121899')).toEqual([]);
        expect(getExtensionNumbers('10', 'mainIcon', '000000')).toEqual([]);
    });

    it('every declared extension index is an integer inside the SIDC 0..31 range', () => {
        let seen = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            for (const elementType of ELEMENT_TYPES) {
                for (const codeBase of Object.keys(catalog[elementType].extensions || {})) {
                    const numbers = getExtensionNumbers(set, elementType, codeBase);
                    expect(numbers.length, `${set}/${elementType}/${codeBase}`).toBeGreaterThan(0);
                    for (const n of numbers) {
                        seen++;
                        expect(Number.isInteger(n)).toBe(true);
                        expect(n).toBeGreaterThanOrEqual(0);
                        expect(n).toBeLessThanOrEqual(31);
                    }
                }
            }
        }
        expect(seen).toBe(64);
    });

    it('round-trips: every listed index resolves back to an entry', () => {
        let resolved = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            for (const elementType of ELEMENT_TYPES) {
                for (const codeBase of Object.keys(catalog[elementType].extensions || {})) {
                    for (const n of getExtensionNumbers(set, elementType, codeBase)) {
                        const entry = getCatalogEntry(set, elementType, 'extensions', codeBase, n);
                        expect(entry, `${set}/${elementType}/${codeBase}/${n}`).not.toBeNull();
                        resolved++;
                    }
                }
            }
        }
        expect(resolved).toBe(64);
    });
});

// ============================================================================
// hasSection
// ============================================================================

describe('hasSection', () => {
    it('is true for a populated element section and for a populated specialModifiers', () => {
        expect(hasSection('10', 'mainIcon')).toBe(true);
        expect(hasSection('10', 'modifier1')).toBe(true);
        expect(hasSection('10', 'modifier2')).toBe(true);
        expect(hasSection('10', 'specialModifiers')).toBe(true);
        expect(hasSection('15', 'specialModifiers')).toBe(true);
    });

    it('is false for set 15 modifier2, whose three sub-maps are all empty', () => {
        // Present but empty: the "has content" rule is what makes this false.
        expect(getSymbolSetCatalog('15').modifier2).toBeDefined();
        expect(hasSection('15', 'modifier2')).toBe(false);
    });

    it('is true for a section where only ONE sub-map has content', () => {
        // Set 15 mainIcon has an empty labelMappings but populated adaptations.
        expect(Object.keys(getSymbolSetCatalog('15').mainIcon.labelMappings)).toHaveLength(0);
        expect(hasSection('15', 'mainIcon')).toBe(true);
        // Set 15 modifier1 has no graphicAdaptations but does have labels.
        expect(hasSection('15', 'modifier1')).toBe(true);
    });

    it('is false for an unknown set or an unknown section', () => {
        expect(hasSection('99', 'mainIcon')).toBe(false);
        expect(hasSection('10', 'bogus')).toBe(false);
        expect(hasSection('10', 'supportsCommand')).toBe(false);
        // Set 15 DOES have a `supportsCommand` key, but it is `false`, so the
        // truthiness guard rejects it before the object check.
        expect(hasSection('15', 'supportsCommand')).toBe(false);
    });

    it('property: an unknown section name is never reported as present', () => {
        fc.assert(fc.property(
            fc.constantFrom('10', '15'),
            fc.string({ minLength: 1, maxLength: 8 })
                .filter((s) => !['mainIcon', 'modifier1', 'modifier2', 'specialModifiers'].includes(s)),
            (set, section) => {
                expect(hasSection(set, section)).toBe(false);
            }
        ));
    });
});

// ============================================================================
// supportsCommand
// ============================================================================

describe('supportsCommand', () => {
    it('defaults to true and is false only where the catalog opts out', () => {
        expect(supportsCommand('10')).toBe(true);
        expect(supportsCommand('15')).toBe(false);
    });

    it('is false for an unknown symbol set', () => {
        expect(supportsCommand('99')).toBe(false);
        expect(supportsCommand('')).toBe(false);
        expect(supportsCommand(null)).toBe(false);
    });

    it('reads the flag with hasOwnProperty, so an inherited key cannot spoof it', () => {
        // Set 15 stores the literal `false`; a plain truthiness read would have
        // fallen through to the default-true branch.
        expect(getSymbolSetCatalog('15').supportsCommand).toBe(false);
        expect(supportsCommand('15')).toBe(false);
    });

    it('CORRIGIDO: a prototype key no longer reaches the default-true branch', () => {
        // The catalog lookup used to be unguarded, so `SYMBOL_SET_CATALOGS['toString']` was a
        // truthy Function and the function answered "yes, this symbol set supports command
        // elements". The hasOwnProperty inside guarded the FLAG, never the LOOKUP.
        expect(supportsCommand('toString')).toBe(false);
        expect(supportsCommand('constructor')).toBe(false);
        expect(supportsCommand('valueOf')).toBe(false);
        expect(supportsCommand('hasOwnProperty')).toBe(false);
    });

    it('CONTROLE: the defect is in the lookup, not in the default (a real miss is false)', () => {
        expect(supportsCommand('zzzz')).toBe(false);
    });
});

// ============================================================================
// getSpecialModifiers
// ============================================================================

describe('getSpecialModifiers', () => {
    it('returns the unit modifiers for 10 and the single equipment one for 15', () => {
        expect(Object.keys(getSpecialModifiers('10'))).toEqual(['1', '2', '3', '4']);
        expect(Object.keys(getSpecialModifiers('15'))).toEqual(['1']);
    });

    it('the equipment set exposes only the ARMOURED modifier, matching the option list', () => {
        expect(getSpecialModifiers('15')['1'].svg).toBe(getSpecialModifiers('10')['1'].svg);
    });

    it('returns null for an unknown set and for a prototype key (no specialModifiers there)', () => {
        expect(getSpecialModifiers('99')).toBeNull();
        expect(getSpecialModifiers('toString')).toBeNull();
    });

    it('every special modifier is an svg entry with a byStandardIdentity map', () => {
        let checked = 0;
        for (const set of getAvailableSymbolSets()) {
            const mods = getSpecialModifiers(set);
            const keys = Object.keys(mods);
            expect(keys.length, `${set} has modifiers`).toBeGreaterThan(0);
            for (const key of keys) {
                checked++;
                const entry = mods[key];
                expect(Object.keys(entry).sort()).toEqual(['byStandardIdentity', 'svg', 'type']);
                expect(entry.type).toBe('svg');
                expect(typeof entry.svg).toBe('string');
                expect(entry.svg.length).toBeGreaterThan(0);
                expect(typeof entry.byStandardIdentity).toBe('object');
            }
        }
        expect(checked).toBe(5);
    });
});

// ============================================================================
// getCatalogEntryWithStandardIdentity
// ============================================================================

describe('getCatalogEntryWithStandardIdentity', () => {
    const args = ['10', 'mainIcon', 'graphicAdaptations', '111001'];

    it('returns the base entry untouched when no standard identity is given', () => {
        const base = getCatalogEntry(...args);
        expect(getCatalogEntryWithStandardIdentity(...args, null, null)).toBe(base);
        expect(getCatalogEntryWithStandardIdentity(...args)).toBe(base);
    });

    it('merges the variant OVER the base, keeping the fields it does not override', () => {
        const base = getCatalogEntry(...args);
        const merged = getCatalogEntryWithStandardIdentity(...args, null, '0');
        expect(merged).not.toBe(base);
        // The variant only carries find/replace, so `type` survives from the base.
        expect(merged.type).toBe(base.type);
        expect(merged.find).toBe(base.byStandardIdentity['0'].find);
        expect(merged.replace).toBe(base.byStandardIdentity['0'].replace);
        expect(merged.find).not.toBe(base.find);
    });

    it('OBSERVADO: the merged entry still carries the whole byStandardIdentity map', () => {
        // The spread copies it, so a consumer that walks the result can re-enter
        // the variant table it has already resolved.
        const merged = getCatalogEntryWithStandardIdentity(...args, null, '0');
        expect(merged.byStandardIdentity).toBeDefined();
        expect(Object.keys(merged.byStandardIdentity).sort()).toEqual(['0', '1', '4', '5', '6']);
    });

    it('falls back to the base entry when the identity has no variant', () => {
        const base = getCatalogEntry(...args);
        // '2' (assumed friend) and '3' (friend) share the default frame, so they
        // are deliberately absent from every variant table.
        expect(getCatalogEntryWithStandardIdentity(...args, null, '3')).toBe(base);
        expect(getCatalogEntryWithStandardIdentity(...args, null, '9')).toBe(base);
    });

    it('OBSERVADO: a falsy identity ("" or 0) short-circuits to the base entry', () => {
        const base = getCatalogEntry(...args);
        expect(getCatalogEntryWithStandardIdentity(...args, null, '')).toBe(base);
        expect(getCatalogEntryWithStandardIdentity(...args, null, 0)).toBe(base);
    });

    it('returns null whenever the base lookup misses, identity or not', () => {
        expect(getCatalogEntryWithStandardIdentity('10', 'mainIcon', 'graphicAdaptations', '000000', null, '0'))
            .toBeNull();
        expect(quiet(() => getCatalogEntryWithStandardIdentity('99', 'mainIcon', 'graphicAdaptations', '111001', null, '0')))
            .toBeNull();
    });

    it('carries the extension number through to the base lookup', () => {
        const withNumber = getCatalogEntryWithStandardIdentity('10', 'mainIcon', 'extensions', '121899', 1, null);
        expect(withNumber.text).toBe('Prec');
        expect(getCatalogEntryWithStandardIdentity('10', 'mainIcon', 'extensions', '121899', null, null))
            .toBeNull();
    });
});

// ============================================================================
// getCommandElement
// ============================================================================

describe('getCommandElement', () => {
    it('returns the default command line for set 10', () => {
        const out = getCommandElement('10');
        expect(Object.keys(out)).toEqual(['svg']);
        expect(out.svg).toContain('M25,80 l150,0');
    });

    it('returns the narrower variant for the identities that have one', () => {
        expect(getCommandElement('10', '0').svg).toContain('M35,80 l130,0');
        expect(getCommandElement('10', '4').svg).toContain('M45,80 l110,0');
        expect(getCommandElement('10', '6').svg).toContain('M50,80 l100,0');
    });

    it('falls back to the default for an identity without a variant', () => {
        expect(getCommandElement('10', '3')).toEqual(getCommandElement('10'));
        expect(getCommandElement('10', '2')).toEqual(getCommandElement('10'));
        expect(getCommandElement('10', '9')).toEqual(getCommandElement('10'));
    });

    it('returns null for a set with no command element (15) and for an unknown set', () => {
        expect(getCommandElement('15')).toBeNull();
        expect(getCommandElement('99')).toBeNull();
        expect(getCommandElement(null)).toBeNull();
    });

    it('agrees with supportsCommand on the two DECLARED sets', () => {
        for (const set of getAvailableSymbolSets()) {
            expect(Boolean(getCommandElement(set)), set).toBe(supportsCommand(set));
        }
    });

    it('CORRIGIDO: it agrees with supportsCommand on a prototype key too', () => {
        // `COMMAND_ELEMENTS['toString']` was a Function, so `commandData.default` was
        // undefined and the caller got `{ svg: undefined }`: a TRUTHY object that renders
        // nothing, which the post-processing then spliced in as the literal text "undefined".
        for (const chave of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
            expect(getCommandElement(chave), chave).toBeNull();
            expect(supportsCommand(chave), chave).toBe(false);
        }
        // CONTROLE: the declared set still returns its SVG.
        expect(getCommandElement('10').svg).toContain('<path');
    });

    it('CORRIGIDO: a prototype key as standardIdentity falls back to the default SVG', () => {
        expect(getCommandElement('10', 'toString')).toEqual(getCommandElement('10'));
        expect(getCommandElement('10', 'constructor')).toEqual(getCommandElement('10'));
    });
});

// ============================================================================
// Catalog DATA invariants (shape only, never doctrine)
// ============================================================================

describe('catalog data invariants', () => {
    it('every element section declares the three modification maps', () => {
        let sections = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            for (const elementType of ELEMENT_TYPES) {
                sections++;
                const section = catalog[elementType];
                expect(section, `${set}/${elementType}`).toBeDefined();
                for (const mod of MODIFICATION_TYPES) {
                    expect(section[mod], `${set}/${elementType}/${mod}`).toBeDefined();
                    expect(typeof section[mod]).toBe('object');
                }
            }
        }
        expect(sections).toBe(6);
    });

    it('every label mapping has non-empty from/to strings', () => {
        let seen = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            for (const elementType of ELEMENT_TYPES) {
                const map = catalog[elementType].labelMappings;
                for (const code of Object.keys(map)) {
                    seen++;
                    const entry = map[code];
                    expect(typeof entry.from, `${set}/${elementType}/${code}.from`).toBe('string');
                    expect(typeof entry.to, `${set}/${elementType}/${code}.to`).toBe('string');
                    expect(entry.from.length).toBeGreaterThan(0);
                    expect(entry.to.length).toBeGreaterThan(0);
                    if ('fontSize' in entry) expect(typeof entry.fontSize).toBe('string');
                }
            }
        }
        expect(seen).toBe(43);
    });

    it('every graphic adaptation is a replace with non-empty find/replace', () => {
        let seen = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            for (const elementType of ELEMENT_TYPES) {
                const map = catalog[elementType].graphicAdaptations;
                for (const code of Object.keys(map)) {
                    seen++;
                    const entry = map[code];
                    expect(entry.type, `${set}/${elementType}/${code}`).toBe('replace');
                    expect(entry.find.length).toBeGreaterThan(0);
                    expect(entry.replace.length).toBeGreaterThan(0);
                    // `find` is used as a literal needle downstream, so it has to be
                    // a full markup fragment and not a pattern.
                    expect(entry.find).toContain('<');
                }
            }
        }
        expect(seen).toBe(30);
    });

    it('every extension is either a text entry or an svg entry, fully populated', () => {
        let text = 0;
        let svg = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            for (const elementType of ELEMENT_TYPES) {
                const map = catalog[elementType].extensions;
                for (const code of Object.keys(map)) {
                    for (const n of Object.keys(map[code])) {
                        const entry = map[code][n];
                        const where = `${set}/${elementType}/${code}/${n}`;
                        expect(['text', 'svg'], where).toContain(entry.type);
                        if (entry.type === 'text') {
                            text++;
                            expect(typeof entry.text, where).toBe('string');
                            expect(entry.text.length).toBeGreaterThan(0);
                            expect(typeof entry.position.x, where).toBe('number');
                            expect(typeof entry.position.y, where).toBe('number');
                            expect(typeof entry.style, where).toBe('object');
                        } else {
                            svg++;
                            expect(typeof entry.svg, where).toBe('string');
                            expect(entry.svg.length).toBeGreaterThan(0);
                        }
                    }
                }
            }
        }
        expect(text + svg).toBe(64);
        expect(text).toBeGreaterThan(0);
        expect(svg).toBeGreaterThan(0);
    });

    it('every byStandardIdentity key is a declared standard identity, and 2/3 are never overridden', () => {
        const seen = new Set();
        let blocks = 0;
        for (const set of getAvailableSymbolSets()) {
            const catalog = getSymbolSetCatalog(set);
            const visit = (entry) => {
                if (!entry || typeof entry !== 'object' || !entry.byStandardIdentity) return;
                blocks++;
                for (const key of Object.keys(entry.byStandardIdentity)) {
                    seen.add(key);
                    expect(key, 'standard identity key').toMatch(/^[0-6]$/);
                }
            };
            for (const elementType of ELEMENT_TYPES) {
                const section = catalog[elementType];
                for (const code of Object.keys(section.graphicAdaptations)) visit(section.graphicAdaptations[code]);
                for (const code of Object.keys(section.extensions)) {
                    for (const n of Object.keys(section.extensions[code])) visit(section.extensions[code][n]);
                }
            }
            for (const key of Object.keys(catalog.specialModifiers)) visit(catalog.specialModifiers[key]);
        }
        expect(blocks).toBeGreaterThan(0);
        // '2' (presumed friend) and '3' (friend) use the default frame, so no
        // variant ever needs to override them.
        expect([...seen].sort()).toEqual(['0', '1', '4', '5', '6']);
    });
});

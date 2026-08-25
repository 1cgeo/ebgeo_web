// Path: tests/unit/military-constants.test.js
/**
 * @fileoverview Pins `frontend/src/js/military_tools/military_symbol_tool/military_constants.js`:
 * the fixed option lists (MILITARY_DATA, ENGAGEMENT_BAR_DATA) and the per-symbol-set
 * applicability predicates.
 *
 * WHAT THIS SUITE PINS
 * - The two applicability POLARITIES, which are opposite and easy to read wrong:
 *   `isModifier1Applicable` / `isModifier2Applicable` are DENY-lists (an unknown
 *   code is allowed), while `isEngagementBarApplicable` / `isEchelonApplicable` /
 *   `isHqTfApplicable` refuse an unknown code. Two of those three still carry a
 *   hand-kept ALLOW list; `isEchelonApplicable` no longer does (see below).
 * - That every predicate compares by strict `===` / `Array.includes` on STRINGS, so
 *   the numeric code `10` behaves like an unknown set.
 * - That `isEchelonApplicable` is DERIVED from `getEchelonData` and agrees with it on
 *   every declared code (see the CONVERGENCIA block). The two used to be independent
 *   hand-kept lists and contradicted each other in BOTH directions: 15 and 27 had a
 *   populated option list while the predicate refused them, and 30/35 passed the
 *   predicate while the data was EMPTY, which is an echelon selector with no options.
 * - That `getEchelonData` / `getSpecialModifierData` / `getEngagementBarData` hand
 *   out LIVE references into the module singletons, not copies.
 * - Structural invariants of the option lists: unique values, non-empty labels,
 *   and the exact size of each list (a silent drop would otherwise pass).
 *
 * WHAT THIS SUITE DOES NOT REACH
 * - `isValidSymbolSet`, `getMainIcons`, `getModifier1/2` and `getAllSymbolSetCodes`
 *   are NOT in this module (the backlog says they are). They live in
 *   `symbol_sets.registry.js` and are covered by `tests/unit/symbol-sets-registry.test.js`.
 * - `getTextModifiersConfig` / `hasTextModifiers` are only RE-EXPORTED here; their
 *   behaviour is covered by `tests/unit/text-modifiers-catalog.test.js`. This suite
 *   only asserts that the re-export exists and is the same function.
 * - Nothing here renders a symbol; the SVG pipeline is elsewhere.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
    MILITARY_DATA,
    ENGAGEMENT_BAR_DATA,
    getEchelonData,
    getSpecialModifierData,
    getEngagementBarData,
    isCommandApplicable,
    isModifier1Applicable,
    isModifier2Applicable,
    isEngagementBarApplicable,
    isEchelonApplicable,
    isHqTfApplicable,
    getTextModifiersConfig,
    hasTextModifiers,
} from '@js/military_tools/military_symbol_tool/military_constants.js';

import {
    getTextModifiersConfig as catalogGetTextModifiersConfig,
    hasTextModifiers as catalogHasTextModifiers,
} from '@js/military_tools/military_symbol_tool/text_modifiers_catalog.js';

/** Every option list on MILITARY_DATA, by key. `format` is a scalar, not a list. */
const OPTION_LISTS = [
    'standardIdentity',
    'symbolSets',
    'status',
    'hqTfDummy',
    'echelon',
    'mobility',
    'leadership',
    'specialModifier',
    'specialModifierEquipment',
];

/** A generator of codes that are definitely not in any list. */
const unknownCode = fc.string({ minLength: 1, maxLength: 6 })
    .filter((s) => !MILITARY_DATA.symbolSets.some((e) => e.value === s));

// ============================================================================
// MILITARY_DATA — structural invariants
// ============================================================================

describe('MILITARY_DATA', () => {
    it('declares the format string that the SIDC builder depends on', () => {
        expect(MILITARY_DATA.format).toBe('10');
    });

    it('exposes exactly the nine option lists (a new or dropped list must be deliberate)', () => {
        expect(Object.keys(MILITARY_DATA).sort())
            .toEqual(['format', ...OPTION_LISTS].sort());
    });

    it('every list has the expected length', () => {
        // Absolute counts, so a silently dropped entry fails here and not in the UI.
        expect(MILITARY_DATA.standardIdentity).toHaveLength(7);
        expect(MILITARY_DATA.symbolSets).toHaveLength(11);
        expect(MILITARY_DATA.status).toHaveLength(6);
        expect(MILITARY_DATA.hqTfDummy).toHaveLength(4);
        expect(MILITARY_DATA.echelon).toHaveLength(14);
        expect(MILITARY_DATA.mobility).toHaveLength(14);
        expect(MILITARY_DATA.leadership).toHaveLength(3);
        expect(MILITARY_DATA.specialModifier).toHaveLength(5);
        expect(MILITARY_DATA.specialModifierEquipment).toHaveLength(2);
    });

    it('every entry of every list is a {value, label} pair of non-empty strings', () => {
        // The loop asserts the collection size first, so an empty list cannot make
        // this test pass by iterating zero times.
        expect(OPTION_LISTS).toHaveLength(9);
        for (const key of OPTION_LISTS) {
            const list = MILITARY_DATA[key];
            expect(Array.isArray(list), `${key} is an array`).toBe(true);
            expect(list.length, `${key} is not empty`).toBeGreaterThan(0);
            for (const entry of list) {
                expect(Object.keys(entry).sort(), `${key} entry keys`).toEqual(['label', 'value']);
                expect(typeof entry.value, `${key} value type`).toBe('string');
                expect(typeof entry.label, `${key} label type`).toBe('string');
                expect(entry.value.length, `${key} value non-empty`).toBeGreaterThan(0);
                expect(entry.label.length, `${key} label non-empty`).toBeGreaterThan(0);
            }
        }
    });

    it('no list repeats a value', () => {
        expect(OPTION_LISTS).toHaveLength(9);
        for (const key of OPTION_LISTS) {
            const values = MILITARY_DATA[key].map((e) => e.value);
            expect(new Set(values).size, `${key} has unique values`).toBe(values.length);
        }
    });

    it('the two-digit lists really are two digits, and the one-digit ones one', () => {
        for (const key of ['symbolSets', 'echelon', 'mobility', 'leadership']) {
            for (const entry of MILITARY_DATA[key]) {
                expect(entry.value, `${key}/${entry.value}`).toMatch(/^\d{2}$/);
            }
        }
        for (const key of ['standardIdentity', 'status', 'hqTfDummy', 'specialModifier', 'specialModifierEquipment']) {
            for (const entry of MILITARY_DATA[key]) {
                expect(entry.value, `${key}/${entry.value}`).toMatch(/^\d$/);
            }
        }
    });

    it('the "not specified / not applicable" sentinel is first in every list that has one', () => {
        expect(MILITARY_DATA.echelon[0].value).toBe('00');
        expect(MILITARY_DATA.mobility[0].value).toBe('00');
        expect(MILITARY_DATA.leadership[0].value).toBe('00');
        expect(MILITARY_DATA.hqTfDummy[0].value).toBe('0');
        expect(MILITARY_DATA.specialModifier[0].value).toBe('0');
        expect(MILITARY_DATA.specialModifierEquipment[0].value).toBe('0');
    });

    it('specialModifierEquipment is a strict PREFIX of specialModifier', () => {
        // Equipment only offers "not applicable" and "armoured"; the labels must
        // stay in step with the unit list or the same SIDC digit would mean two
        // different things in two panels.
        expect(MILITARY_DATA.specialModifierEquipment)
            .toEqual(MILITARY_DATA.specialModifier.slice(0, 2));
    });
});

// ============================================================================
// ENGAGEMENT_BAR_DATA
// ============================================================================

describe('ENGAGEMENT_BAR_DATA', () => {
    it('carries exactly the stages and weapons lists', () => {
        expect(Object.keys(ENGAGEMENT_BAR_DATA).sort()).toEqual(['stages', 'weapons']);
        expect(ENGAGEMENT_BAR_DATA.stages).toHaveLength(11);
        expect(ENGAGEMENT_BAR_DATA.weapons).toHaveLength(17);
    });

    it('values are unique within each list', () => {
        for (const key of ['stages', 'weapons']) {
            const values = ENGAGEMENT_BAR_DATA[key].map((e) => e.value);
            expect(values.length, `${key} not empty`).toBeGreaterThan(0);
            expect(new Set(values).size, `${key} unique`).toBe(values.length);
        }
    });

    it('ARMADILHA: one stage value contains a "<" (M<T)', () => {
        // Anything that interpolates a stage value into markup (the engagement bar
        // SVG, a tooltip) must escape it. This is also why the backlog wants a
        // round-trip test on the engagement-bar encode/decode with "<" in it.
        const withAngle = ENGAGEMENT_BAR_DATA.stages.filter((e) => e.value.includes('<'));
        expect(withAngle).toHaveLength(1);
        expect(withAngle[0].value).toBe('M<T');
    });

    it('ARMADILHA: stage and weapon values overlap in prefix, so a naive split is ambiguous', () => {
        // The composite form is 'STAGE-WEAPON'. Neither list is prefix-free with
        // respect to the other ('M' is a weapon and 'MIF'/'MLT'/'MBE' are stages),
        // which is exactly why the separator has to be honoured.
        const stages = ENGAGEMENT_BAR_DATA.stages.map((e) => e.value);
        const weapons = ENGAGEMENT_BAR_DATA.weapons.map((e) => e.value);
        expect(weapons).toContain('M');
        expect(stages.some((s) => s.startsWith('M') && s !== 'M')).toBe(true);
        // And no value carries the separator itself, which is what keeps a split
        // on '-' unambiguous.
        for (const v of [...stages, ...weapons]) {
            expect(v.includes('-'), `${v} has no separator`).toBe(false);
        }
    });

    it('getEngagementBarData returns the module singleton itself, not a copy', () => {
        // Mutating the result mutates the shared constant for every caller.
        expect(getEngagementBarData()).toBe(ENGAGEMENT_BAR_DATA);
        expect(getEngagementBarData().stages).toBe(ENGAGEMENT_BAR_DATA.stages);
    });
});

// ============================================================================
// getEchelonData
// ============================================================================

describe('getEchelonData', () => {
    it('maps 10 -> Escalao, 15 -> Mobilidade, 27 -> Lideranca', () => {
        expect(getEchelonData('10')).toEqual({
            data: MILITARY_DATA.echelon, label: 'Escalão', applicable: true,
        });
        expect(getEchelonData('15')).toEqual({
            data: MILITARY_DATA.mobility, label: 'Mobilidade', applicable: true,
        });
        expect(getEchelonData('27')).toEqual({
            data: MILITARY_DATA.leadership, label: 'Liderança', applicable: true,
        });
    });

    it('hands out the LIVE array, not a copy', () => {
        expect(getEchelonData('10').data).toBe(MILITARY_DATA.echelon);
    });

    it('any other code (including junk and non-strings) falls to the inert default', () => {
        const inert = { data: [], label: '', applicable: false };
        expect(getEchelonData('01')).toEqual(inert);
        expect(getEchelonData('99')).toEqual(inert);
        expect(getEchelonData('')).toEqual(inert);
        expect(getEchelonData(null)).toEqual(inert);
        expect(getEchelonData(undefined)).toEqual(inert);
        expect(getEchelonData('__proto__')).toEqual(inert);
    });

    it('OBSERVADO: the switch is strict, so the NUMBER 10 is not the string "10"', () => {
        expect(getEchelonData(10).applicable).toBe(false);
        expect(getEchelonData(15).applicable).toBe(false);
    });

    it('the default branch returns a FRESH empty array each call (no shared sentinel)', () => {
        expect(getEchelonData('99').data).not.toBe(getEchelonData('98').data);
    });
});

// ============================================================================
// getSpecialModifierData
// ============================================================================

describe('getSpecialModifierData', () => {
    it('maps 10 to the unit list and 15 to the equipment list', () => {
        expect(getSpecialModifierData('10'))
            .toEqual({ data: MILITARY_DATA.specialModifier, applicable: true });
        expect(getSpecialModifierData('15'))
            .toEqual({ data: MILITARY_DATA.specialModifierEquipment, applicable: true });
    });

    it('has no `label` field, unlike getEchelonData (the two shapes differ)', () => {
        expect(Object.keys(getSpecialModifierData('10')).sort()).toEqual(['applicable', 'data']);
        expect(Object.keys(getEchelonData('10')).sort()).toEqual(['applicable', 'data', 'label']);
    });

    it('every other code is not applicable', () => {
        const inert = { data: [], applicable: false };
        expect(getSpecialModifierData('27')).toEqual(inert);
        expect(getSpecialModifierData('40')).toEqual(inert);
        expect(getSpecialModifierData(undefined)).toEqual(inert);
        expect(getSpecialModifierData(10)).toEqual(inert);
    });
});

// ============================================================================
// The predicates — and their two OPPOSITE polarities
// ============================================================================

describe('isCommandApplicable', () => {
    it('is true for land units only', () => {
        expect(isCommandApplicable('10')).toBe(true);
        for (const entry of MILITARY_DATA.symbolSets) {
            if (entry.value === '10') continue;
            expect(isCommandApplicable(entry.value), entry.value).toBe(false);
        }
    });

    it('is false for junk (strict equality, no coercion)', () => {
        expect(isCommandApplicable(10)).toBe(false);
        expect(isCommandApplicable(null)).toBe(false);
        expect(isCommandApplicable(undefined)).toBe(false);
        expect(isCommandApplicable('')).toBe(false);
    });
});

describe('isModifier1Applicable / isModifier2Applicable — DENY lists', () => {
    it('modifier 1 is refused only for mine warfare (36)', () => {
        expect(isModifier1Applicable('36')).toBe(false);
        const refused = MILITARY_DATA.symbolSets
            .map((e) => e.value)
            .filter((v) => !isModifier1Applicable(v));
        expect(refused).toEqual(['36']);
    });

    it('modifier 2 is refused for 36, 15 and 40', () => {
        const refused = MILITARY_DATA.symbolSets
            .map((e) => e.value)
            .filter((v) => !isModifier2Applicable(v));
        expect(refused.sort()).toEqual(['15', '36', '40']);
    });

    it('OBSERVADO: allow-by-default — any UNKNOWN code is treated as applicable', () => {
        // `!list.includes(code)` means a code the module has never heard of gets
        // the modifier panels drawn for it. That is the deliberate polarity, and it
        // is the opposite of the engagement/echelon predicates below.
        for (const junk of ['zz', '99', '', '__proto__', 'constructor']) {
            expect(isModifier1Applicable(junk), `mod1 ${junk}`).toBe(true);
            expect(isModifier2Applicable(junk), `mod2 ${junk}`).toBe(true);
        }
        expect(isModifier1Applicable(null)).toBe(true);
        expect(isModifier1Applicable(undefined)).toBe(true);
        // The NUMBER 36 is not the string '36', so the deny-list misses it.
        expect(isModifier1Applicable(36)).toBe(true);
    });

    it('property: every string outside the two deny lists is allowed', () => {
        fc.assert(fc.property(unknownCode, (code) => {
            if (code !== '36') expect(isModifier1Applicable(code)).toBe(true);
            if (!['36', '15', '40'].includes(code)) expect(isModifier2Applicable(code)).toBe(true);
        }));
    });
});

describe('isEngagementBarApplicable / isEchelonApplicable / isHqTfApplicable — ALLOW lists', () => {
    it('the engagement bar is offered to eight symbol sets', () => {
        const allowed = MILITARY_DATA.symbolSets
            .map((e) => e.value)
            .filter(isEngagementBarApplicable);
        expect(allowed).toEqual(['01', '02', '05', '10', '15', '30', '35', '36']);
    });

    it('CORRIGIDO: echelon now follows getEchelonData (10, 15, 27); HQ/TF still 10, 30, 35', () => {
        // isEchelonApplicable used to carry its own hand-kept list ['10','30','35'] and
        // contradicted getEchelonData in both directions. It is now DERIVED from it, so the
        // codes that have a populated slot are exactly the codes the predicate allows.
        const echelon = MILITARY_DATA.symbolSets.map((e) => e.value).filter(isEchelonApplicable);
        const hqTf = MILITARY_DATA.symbolSets.map((e) => e.value).filter(isHqTfApplicable);
        expect(echelon).toEqual(['10', '15', '27']);
        expect(hqTf).toEqual(['10', '30', '35']);
    });

    it('CORRIGIDO: the two predicates are no longer duplicates, and 15/27/30/35 is where they split', () => {
        expect(MILITARY_DATA.symbolSets.length).toBe(11);
        const divergentes = MILITARY_DATA.symbolSets
            .map((e) => e.value)
            .filter((v) => isEchelonApplicable(v) !== isHqTfApplicable(v));
        expect(divergentes).toEqual(['15', '27', '30', '35']);
    });

    it('deny-by-default: an UNKNOWN code is refused (echelon inherits it from the default branch of getEchelonData)', () => {
        for (const junk of ['zz', '99', '', '__proto__', 'constructor']) {
            expect(isEngagementBarApplicable(junk), `bar ${junk}`).toBe(false);
            expect(isEchelonApplicable(junk), `echelon ${junk}`).toBe(false);
            expect(isHqTfApplicable(junk), `hqtf ${junk}`).toBe(false);
        }
        expect(isEngagementBarApplicable(null)).toBe(false);
        expect(isEngagementBarApplicable(10)).toBe(false);
    });

    it('property: the two polarities are exact opposites for unknown codes', () => {
        fc.assert(fc.property(unknownCode, (code) => {
            const allowList = isEchelonApplicable(code) || isHqTfApplicable(code)
                || isEngagementBarApplicable(code);
            const denyList = isModifier1Applicable(code) && isModifier2Applicable(code);
            expect(allowList).toBe(false);
            expect(denyList).toBe(true);
        }));
    });
});

// ============================================================================
// DIVERGENCIA: getEchelonData vs isEchelonApplicable
// ============================================================================

describe('CONVERGENCIA entre getEchelonData e isEchelonApplicable', () => {
    it('CORRIGIDO: they agree on every declared code, in both directions', () => {
        // They used to contradict each other BOTH ways: 15 and 27 had a populated list from
        // getEchelonData while the predicate refused them, and 30/35 passed the predicate
        // while getEchelonData handed back an EMPTY list, so a panel gated on the predicate
        // alone drew an echelon selector with no options. getEchelonData was elected the
        // source of truth (it is the one with callers, and the one carrying the data the
        // screen needs) and isEchelonApplicable now derives from it.
        expect(MILITARY_DATA.symbolSets.length).toBe(11);
        let checked = 0;
        for (const entry of MILITARY_DATA.symbolSets) {
            expect(isEchelonApplicable(entry.value), entry.value)
                .toBe(getEchelonData(entry.value).applicable);
            checked += 1;
        }
        expect(checked).toBe(11);

        // The four codes that used to disagree, named one by one so a silent regression in
        // either direction is legible instead of hiding inside the loop above.
        expect(isEchelonApplicable('15')).toBe(true);      // was false, list was populated
        expect(isEchelonApplicable('27')).toBe(true);      // was false, list was populated
        expect(isEchelonApplicable('30')).toBe(false);     // was true, list was EMPTY
        expect(isEchelonApplicable('35')).toBe(false);     // was true, list was EMPTY
    });

    it('CORRIGIDO: every code the predicate allows hands back a NON-EMPTY option list', () => {
        // This is the property the empty selector violated, and it is the reason the
        // derivation goes this way round instead of widening getEchelonData.
        const allowed = MILITARY_DATA.symbolSets
            .map((e) => e.value)
            .filter(isEchelonApplicable);
        expect(allowed).toEqual(['10', '15', '27']);
        for (const code of allowed) {
            const { data, label } = getEchelonData(code);
            expect(data.length, code).toBeGreaterThan(0);
            expect(label, code).not.toBe('');
        }
    });

    it('CONTROLE: the predicate still discriminates (it is not simply true everywhere)', () => {
        expect(isEchelonApplicable('20')).toBe(false);
        expect(isEchelonApplicable('40')).toBe(false);
        expect(isEchelonApplicable('constructor')).toBe(false);
    });
});

// ============================================================================
// Re-exports
// ============================================================================

describe('text modifier re-exports', () => {
    it('are the very same functions as in text_modifiers_catalog.js', () => {
        expect(getTextModifiersConfig).toBe(catalogGetTextModifiersConfig);
        expect(hasTextModifiers).toBe(catalogHasTextModifiers);
    });

    it('CONTROLE: the re-exported functions are callable and discriminate', () => {
        // Without this, the identity assertion above would pass even if both were
        // the same broken stub.
        expect(typeof hasTextModifiers('10')).toBe('boolean');
        expect(hasTextModifiers('zzz')).toBe(false);
    });
});

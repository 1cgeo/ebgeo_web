// Path: tests/unit/text-modifiers-catalog.test.js

import { describe, it, expect } from 'vitest';
import {
    TEXT_MODIFIERS_CATALOG,
    getTextModifiersConfig,
    hasTextModifiers
} from '@js/military_tools/military_symbol_tool/text_modifiers_catalog.js';
import { MILITARY_DATA } from '@js/military_tools/military_symbol_tool/military_constants.js';

/**
 * The catalog is looked up with `properties.symbolSet` with no translation table
 * (text-modifiers.section.js -> getTextModifiersConfig), and `symbolSet` is written
 * straight from the "Dimensão" combobox, whose options are MILITARY_DATA.symbolSets.
 * So the catalog keys and the combobox values are the same namespace, by contract.
 */
describe('TEXT_MODIFIERS_CATALOG keys', () => {
    const symbolSetByCode = new Map(
        MILITARY_DATA.symbolSets.map((set) => [set.value, set.label])
    );

    it('only uses codes that exist in MILITARY_DATA.symbolSets', () => {
        const codes = Object.keys(TEXT_MODIFIERS_CATALOG);
        expect(codes.length).toBeGreaterThan(0);

        const unknown = codes.filter((code) => !symbolSetByCode.has(code));
        expect(unknown).toEqual([]);
    });

    it('labels the same dimension the symbol set code names', () => {
        const mismatches = Object.entries(TEXT_MODIFIERS_CATALOG)
            .filter(([code, config]) => config.label !== symbolSetByCode.get(code))
            .map(([code, config]) => `${code}: "${config.label}" != "${symbolSetByCode.get(code)}"`);

        expect(mismatches).toEqual([]);
    });

    it('keeps the aircraft amplifiers under 01 and the installation ones under 20', () => {
        // The two entries whose keys were swapped: aircraft carry IFF/altitude/speed,
        // installations do not carry IFF or speed.
        const aircraftFields = TEXT_MODIFIERS_CATALOG['01'].fields.map((f) => f.id);
        expect(aircraftFields).toContain('iffSif');
        expect(aircraftFields).toContain('speed');

        const installationFields = TEXT_MODIFIERS_CATALOG['20'].fields.map((f) => f.id);
        expect(installationFields).toContain('higherFormation');
        expect(installationFields).not.toContain('iffSif');
        expect(installationFields).not.toContain('speed');
    });

    it('every field carries the ids the generator reads', () => {
        for (const [code, config] of Object.entries(TEXT_MODIFIERS_CATALOG)) {
            expect(Array.isArray(config.fields), `${code} has no fields array`).toBe(true);
            expect(config.fields.length, `${code} has an empty field list`).toBeGreaterThan(0);
            for (const field of config.fields) {
                expect(typeof field.id, `${code} field without id`).toBe('string');
                expect(field.id.length).toBeGreaterThan(0);
            }
        }
    });
});

describe('getTextModifiersConfig / hasTextModifiers', () => {
    it('resolves a known dimension', () => {
        expect(getTextModifiersConfig('10').label).toBe('Unidades');
        expect(hasTextModifiers('10')).toBe(true);
    });

    it('returns null for an unknown code instead of throwing', () => {
        expect(getTextModifiersConfig('99')).toBeNull();
        expect(hasTextModifiers('99')).toBe(false);
    });

    it('returns null for the codes that were dropped by the rekey', () => {
        // '25' and '60' never existed as symbol set codes; they were typos.
        expect(getTextModifiersConfig('25')).toBeNull();
        expect(getTextModifiersConfig('60')).toBeNull();
    });

    it('tolerates missing / empty / non-string codes', () => {
        expect(getTextModifiersConfig(undefined)).toBeNull();
        expect(getTextModifiersConfig(null)).toBeNull();
        expect(getTextModifiersConfig('')).toBeNull();
        expect(hasTextModifiers(undefined)).toBe(false);
    });
});

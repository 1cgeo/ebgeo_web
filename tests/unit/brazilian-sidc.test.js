import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    BrazilianSIDCExtension,
    normalizeSIDC,
    getBaseSIDC,
} from '../../src/js/military_tools/military_symbol_tool/brazilian_sidc_extension.js';

// ============================================================================
// encode / decode — examples
// ============================================================================

describe('BrazilianSIDCExtension.encode', () => {
    it('returns the default code when all fields are empty', () => {
        expect(BrazilianSIDCExtension.encode({})).toBe('0760000000');
        expect(BrazilianSIDCExtension.encode({
            entityExtension: 0, isCommand: false, specialModifier: 0, mod1Extension: 0, mod2Extension: 0,
        })).toBe('0760000000');
    });

    it('produces a 10-digit "076"-prefixed string', () => {
        const code = BrazilianSIDCExtension.encode({ entityExtension: 5, isCommand: true });
        expect(code).toMatch(/^076\d{7}$/);
        expect(code.length).toBe(10);
    });
});

describe('BrazilianSIDCExtension.decode', () => {
    it('decodes the default code to all-zero fields', () => {
        expect(BrazilianSIDCExtension.decode('0760000000')).toMatchObject({
            entityExtension: 0, isCommand: false, specialModifier: 0, mod1Extension: 0, mod2Extension: 0,
        });
    });
    it('returns null for the wrong length', () => {
        expect(BrazilianSIDCExtension.decode('076123')).toBeNull();
    });
    it('returns null for a non-Brazil country code', () => {
        expect(BrazilianSIDCExtension.decode('1230000001')).toBeNull();
    });
    it('returns null for a non-numeric extension', () => {
        expect(BrazilianSIDCExtension.decode('076ABCDEFG')).toBeNull();
    });
});

// ============================================================================
// Round-trip property — the core guard against bit-packing regressions
// ============================================================================

describe('encode/decode round-trip', () => {
    it('decode(encode(fields)) recovers every field across the full ranges', () => {
        fc.assert(fc.property(
            fc.record({
                entityExtension: fc.integer({ min: 0, max: 31 }),
                isCommand: fc.boolean(),
                specialModifier: fc.integer({ min: 0, max: 7 }),
                mod1Extension: fc.integer({ min: 0, max: 31 }),
                mod2Extension: fc.integer({ min: 0, max: 31 }),
            }),
            (fields) => {
                const decoded = BrazilianSIDCExtension.decode(BrazilianSIDCExtension.encode(fields));
                expect(decoded).toMatchObject({
                    version: 0,
                    reserved: 0,
                    entityExtension: fields.entityExtension,
                    isCommand: fields.isCommand,
                    specialModifier: fields.specialModifier,
                    mod1Extension: fields.mod1Extension,
                    mod2Extension: fields.mod2Extension,
                });
            }
        ));
    });
});

// ============================================================================
// normalizeSIDC / getBaseSIDC
// ============================================================================

describe('normalizeSIDC', () => {
    const base20 = '12345678901234567890';
    it('pads a 20-digit SIDC with the default extension', () => {
        expect(normalizeSIDC(base20)).toBe(base20 + '0760000000');
    });
    it('passes a 30-digit SIDC through unchanged', () => {
        const full = base20 + '0760000000';
        expect(normalizeSIDC(full)).toBe(full);
    });
    it('strips whitespace before measuring length', () => {
        expect(normalizeSIDC('1234 5678 9012 3456 7890')).toBe(base20 + '0760000000');
    });
    it('returns null for an invalid length', () => {
        expect(normalizeSIDC('123')).toBeNull();
    });
    it('returns null for null input', () => {
        expect(normalizeSIDC(null)).toBeNull();
    });
});

describe('getBaseSIDC', () => {
    it('extracts the first 20 digits from a 30-digit SIDC', () => {
        const base20 = '12345678901234567890';
        expect(getBaseSIDC(base20 + '0760000000')).toBe(base20);
    });
    it('returns null when shorter than 20 digits', () => {
        expect(getBaseSIDC('12345')).toBeNull();
    });
    it('returns null for null input', () => {
        expect(getBaseSIDC(null)).toBeNull();
    });
});

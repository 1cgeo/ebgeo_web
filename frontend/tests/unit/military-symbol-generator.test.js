import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MilitarySymbolGenerator } from '../../src/js/military_tools/military_symbol_tool/military_symbol_generator.js';
import { BrazilianSIDCExtension } from '../../src/js/military_tools/military_symbol_tool/brazilian_sidc_extension.js';

// military_symbol_generator imports only pure helpers at load time (catalog,
// post-processing, svg-to-png, brazilian_sidc_extension). The milsymbol global
// `ms` and the DOM/canvas paths live inside generateSymbol/convertToPngBlob,
// which we do not exercise here — so no mocking is needed for the pure SIDC
// string logic under test (buildSIDC / parseSIDC / validateSIDC + helpers).

const gen = new MilitarySymbolGenerator();

// ============================================================================
// validateSIDC
// ============================================================================

describe('MilitarySymbolGenerator.validateSIDC', () => {
    it('accepts a 20-digit SIDC', () => {
        expect(gen.validateSIDC('10031000161211000000')).toEqual({ valid: true });
    });

    it('accepts a 30-digit SIDC', () => {
        expect(gen.validateSIDC('100310001612110000000760000000')).toEqual({ valid: true });
    });

    it('strips internal/edge whitespace before measuring length', () => {
        expect(gen.validateSIDC('1003 1000 1612 1100 0000').valid).toBe(true);
        expect(gen.validateSIDC('  10031000161211000000  ').valid).toBe(true);
    });

    it('rejects null and undefined with the null/undefined message', () => {
        expect(gen.validateSIDC(null)).toEqual({ valid: false, error: 'SIDC is null or undefined' });
        expect(gen.validateSIDC(undefined)).toEqual({ valid: false, error: 'SIDC is null or undefined' });
    });

    it('rejects the empty string (falsy) with the null/undefined message', () => {
        expect(gen.validateSIDC('')).toEqual({ valid: false, error: 'SIDC is null or undefined' });
    });

    it('rejects lengths other than 20 or 30', () => {
        expect(gen.validateSIDC('1003100016121100000').valid).toBe(false);   // 19
        expect(gen.validateSIDC('100310001612110000001').valid).toBe(false); // 21
        expect(gen.validateSIDC('1003100016121100000007600000001').valid).toBe(false); // 31
    });

    it('reports the cleaned length in the length error', () => {
        const r = gen.validateSIDC('123');
        expect(r.valid).toBe(false);
        expect(r.error).toContain('3');
        expect(r.error).toContain('20 or 30');
    });

    it('rejects a correct-length value containing non-ASCII digits', () => {
        // Arabic-Indic digits: length 20 but not matched by /^\d+$/ (ASCII only).
        const arabic = '١٠٠٣١٠٠٠١٦١٢١١٠٠٠٠٠٠';
        expect(arabic.length).toBe(20);
        expect(gen.validateSIDC(arabic)).toEqual({ valid: false, error: 'SIDC must contain only digits' });
    });

    it('rejects a correct-length value containing letters', () => {
        expect(gen.validateSIDC('1003100016121100000X').valid).toBe(false);
    });

    // Bug fix (was: TypeError "sidc.replace is not a function"): a non-string,
    // non-falsy input must produce a clean validation result, not throw.
    it('rejects non-string inputs without throwing', () => {
        expect(() => gen.validateSIDC(42)).not.toThrow();
        expect(gen.validateSIDC(42)).toEqual({ valid: false, error: 'SIDC must be a string' });
        expect(gen.validateSIDC({})).toEqual({ valid: false, error: 'SIDC must be a string' });
        expect(gen.validateSIDC([1, 2, 3])).toEqual({ valid: false, error: 'SIDC must be a string' });
        expect(gen.validateSIDC(true)).toEqual({ valid: false, error: 'SIDC must be a string' });
    });
});

// ============================================================================
// buildSIDC — field layout
// ============================================================================

describe('MilitarySymbolGenerator.buildSIDC', () => {
    it('builds a 30-digit SIDC from defaults', () => {
        const sidc = gen.buildSIDC({});
        expect(sidc).toHaveLength(30);
        expect(gen.validateSIDC(sidc).valid).toBe(true);
    });

    it('uses the documented default field values (no extension → 0760000000)', () => {
        // formatId 10, context 0, SI 3, set 10, status 0, hqTfDummy 0,
        // echelon 16, mainIcon 121100, mod1 00, mod2 00 + default extension.
        expect(gen.buildSIDC({})).toBe('100310001612110000000760000000');
    });

    it('places each base field at the correct fixed-width offset', () => {
        const sidc = gen.buildSIDC({
            standardIdentity: '4',
            symbolSet: '15',
            status: '1',
            hqTfDummy: '2',
            echelon: '08',
            mainIcon: '121700',
            modifier1: '03',
            modifier2: '05'
        });
        const base = sidc.substring(0, 20);
        expect(base.substring(0, 2)).toBe('10');     // formatId
        expect(base.substring(2, 3)).toBe('0');      // context
        expect(base.substring(3, 4)).toBe('4');      // standardIdentity
        expect(base.substring(4, 6)).toBe('15');     // symbolSet
        expect(base.substring(6, 7)).toBe('1');      // status
        expect(base.substring(7, 8)).toBe('2');      // hqTfDummy
        expect(base.substring(8, 10)).toBe('08');    // echelon
        expect(base.substring(10, 16)).toBe('121700'); // mainIcon
        expect(base.substring(16, 18)).toBe('03');   // modifier1
        expect(base.substring(18, 20)).toBe('05');   // modifier2
    });

    it('emits the no-extension tail when no extension fields are present', () => {
        const sidc = gen.buildSIDC({ standardIdentity: '6' });
        expect(sidc.substring(20)).toBe('0760000000');
    });

    it('encodes a Brazilian extension when an extension field is set', () => {
        const sidc = gen.buildSIDC({ mainIconExtension: 7 });
        const tail = sidc.substring(20);
        expect(tail).not.toBe('0760000000');
        expect(tail.startsWith('076')).toBe(true);
        expect(BrazilianSIDCExtension.decode(tail).entityExtension).toBe(7);
    });

    it('treats specialModifier "0" / 0 as "no special modifier" (no extension)', () => {
        expect(gen.buildSIDC({ specialModifier: '0' }).substring(20)).toBe('0760000000');
        expect(gen.buildSIDC({ specialModifier: 0 }).substring(20)).toBe('0760000000');
    });

    it('triggers an extension when specialModifier is a positive value', () => {
        const sidc = gen.buildSIDC({ specialModifier: '3' });
        expect(sidc.substring(20)).not.toBe('0760000000');
        expect(BrazilianSIDCExtension.decode(sidc.substring(20)).specialModifier).toBe(3);
    });

    it('triggers an extension when isCommand is true', () => {
        const sidc = gen.buildSIDC({ isCommand: true });
        expect(sidc.substring(20)).not.toBe('0760000000');
        expect(BrazilianSIDCExtension.decode(sidc.substring(20)).isCommand).toBe(true);
    });

    it('treats explicit 0 extension values as "no extension"', () => {
        const sidc = gen.buildSIDC({
            mainIconExtension: 0,
            modifier1Extension: 0,
            modifier2Extension: 0
        });
        expect(sidc.substring(20)).toBe('0760000000');
    });

    it('does NOT treat extension value 0 the same as absent for the extension flag', () => {
        // mainIconExtension explicitly 0 is "present" per the hasMainIconExt
        // check, but encode() collapses an all-zero extension to the default.
        const withZero = gen.buildSIDC({ mainIconExtension: 0 });
        const without = gen.buildSIDC({});
        expect(withZero).toBe(without);
    });
});

// ============================================================================
// parseSIDC
// ============================================================================

describe('MilitarySymbolGenerator.parseSIDC', () => {
    it('parses a 20-digit SIDC into its base components only', () => {
        const p = gen.parseSIDC('10041512120817000305');
        expect(p).toEqual({
            formatId: '10',
            context: '0',
            standardIdentity: '4',
            symbolSet: '15',
            status: '1',
            hqTfDummy: '2',
            echelon: '12',
            mainIcon: '081700',
            modifier1: '03',
            modifier2: '05'
        });
        // 20-digit input carries no extension fields.
        expect('specialModifier' in p).toBe(false);
        expect('mainIconExtension' in p).toBe(false);
    });

    it('parses a 30-digit SIDC including decoded extension fields', () => {
        const tail = BrazilianSIDCExtension.encode({
            entityExtension: 7,
            isCommand: true,
            specialModifier: 3,
            mod1Extension: 0,
            mod2Extension: 12
        });
        const p = gen.parseSIDC('10041512120817000305' + tail);
        expect(p.mainIconExtension).toBe(7);
        expect(p.isCommand).toBe(true);
        expect(p.specialModifier).toBe('3'); // stored as string
        expect(p.modifier1Extension).toBe(0);
        expect(p.modifier2Extension).toBe(12);
    });

    it('exposes specialModifier as a string for a default (zero) extension', () => {
        const p = gen.parseSIDC('100415121208170003050760000000');
        // Default extension decodes specialModifier 0 → stringified "0".
        expect(p.specialModifier).toBe('0');
        expect(p.isCommand).toBe(false);
        expect(p.mainIconExtension).toBe(0);
    });

    it('strips whitespace before parsing', () => {
        const p = gen.parseSIDC('1004 1512 1208 1700 0305');
        expect(p.standardIdentity).toBe('4');
        expect(p.mainIcon).toBe('081700');
    });

    it('throws for an invalid SIDC, surfacing the validation error', () => {
        expect(() => gen.parseSIDC('123')).toThrow(/Invalid SIDC/);
        expect(() => gen.parseSIDC(null)).toThrow(/Invalid SIDC/);
    });
});

// ============================================================================
// canParseSIDC
// ============================================================================

describe('MilitarySymbolGenerator.canParseSIDC', () => {
    it('reports canParse:true with parsed properties for a valid SIDC', () => {
        const r = gen.canParseSIDC('10031000161211000000');
        expect(r.canParse).toBe(true);
        expect(r.properties.mainIcon).toBe('121100');
    });

    it('reports canParse:false and an error for an invalid SIDC (never throws)', () => {
        const r = gen.canParseSIDC('xx');
        expect(r.canParse).toBe(false);
        expect(typeof r.error).toBe('string');
    });

    it('does not throw on non-string input (caught internally)', () => {
        expect(() => gen.canParseSIDC(123)).not.toThrow();
        expect(gen.canParseSIDC(123).canParse).toBe(false);
    });

    it('flags missing required components (mainIcon all zero is still present)', () => {
        // mainIcon "000000" is truthy as a non-empty string, so it passes the
        // required-component check — documents the current behavior.
        const r = gen.canParseSIDC('10031000160000000000');
        expect(r.canParse).toBe(true);
    });
});

// ============================================================================
// extractViewBoxDimensions (pure)
// ============================================================================

describe('MilitarySymbolGenerator.extractViewBoxDimensions', () => {
    it('returns null when there is no viewBox', () => {
        expect(gen.extractViewBoxDimensions('<svg></svg>')).toBeNull();
    });

    it('parses a 4-number viewBox', () => {
        expect(gen.extractViewBoxDimensions('<svg viewBox="0 0 100 200"></svg>'))
            .toEqual({ x: 0, y: 0, width: 100, height: 200 });
    });

    it('parses negative offsets', () => {
        expect(gen.extractViewBoxDimensions('<svg viewBox="-50 -10 300 400">'))
            .toEqual({ x: -50, y: -10, width: 300, height: 400 });
    });

    it('yields NaN fields for a malformed (non-numeric) viewBox', () => {
        // Documents current behavior: split('').map(Number) produces NaN, not null.
        const r = gen.extractViewBoxDimensions('<svg viewBox="a b c d">');
        expect(Number.isNaN(r.x)).toBe(true);
        expect(Number.isNaN(r.height)).toBe(true);
    });
});

// ============================================================================
// Round-trip properties (the high-value coverage)
// ============================================================================

// Generators that produce well-formed, fixed-width base field values so that
// buildSIDC's concatenation lines up with parseSIDC's fixed-offset slicing.
const twoDigit = () => fc.integer({ min: 0, max: 99 }).map(n => String(n).padStart(2, '0'));
const oneDigit = () => fc.integer({ min: 0, max: 9 }).map(String);
const sixDigit = () => fc.integer({ min: 0, max: 999999 }).map(n => String(n).padStart(6, '0'));

const baseProps = () => fc.record({
    standardIdentity: oneDigit(),
    symbolSet: twoDigit(),
    status: oneDigit(),
    hqTfDummy: oneDigit(),
    echelon: twoDigit(),
    mainIcon: sixDigit(),
    modifier1: twoDigit(),
    modifier2: twoDigit()
});

const extProps = () => fc.record({
    mainIconExtension: fc.integer({ min: 0, max: 31 }),
    modifier1Extension: fc.integer({ min: 0, max: 31 }),
    modifier2Extension: fc.integer({ min: 0, max: 31 }),
    specialModifier: fc.integer({ min: 0, max: 7 }).map(String),
    isCommand: fc.boolean()
});

describe('round-trip: buildSIDC ↔ parseSIDC', () => {
    it('property: parse(build(base)) recovers every base field', () => {
        fc.assert(fc.property(baseProps(), (props) => {
            const sidc = gen.buildSIDC(props);
            expect(sidc).toHaveLength(30);
            const parsed = gen.parseSIDC(sidc);
            expect(parsed.standardIdentity).toBe(props.standardIdentity);
            expect(parsed.symbolSet).toBe(props.symbolSet);
            expect(parsed.status).toBe(props.status);
            expect(parsed.hqTfDummy).toBe(props.hqTfDummy);
            expect(parsed.echelon).toBe(props.echelon);
            expect(parsed.mainIcon).toBe(props.mainIcon);
            expect(parsed.modifier1).toBe(props.modifier1);
            expect(parsed.modifier2).toBe(props.modifier2);
            expect(parsed.formatId).toBe('10');
            expect(parsed.context).toBe('0');
        }));
    });

    it('property: build(parse(build(p))) is a fixed point (idempotent)', () => {
        fc.assert(fc.property(baseProps(), extProps(), (base, ext) => {
            const props = { ...base, ...ext };
            const sidc1 = gen.buildSIDC(props);
            const parsed = gen.parseSIDC(sidc1);
            const sidc2 = gen.buildSIDC(parsed);
            expect(sidc2).toBe(sidc1);
        }));
    });

    it('property: extension fields survive the round-trip', () => {
        fc.assert(fc.property(baseProps(), extProps(), (base, ext) => {
            const sidc = gen.buildSIDC({ ...base, ...ext });
            const parsed = gen.parseSIDC(sidc);
            // When the whole extension is zero/absent, encode collapses to the
            // default tail and the decoded fields are all zero/false.
            const anyExt = ext.mainIconExtension > 0 || ext.modifier1Extension > 0 ||
                ext.modifier2Extension > 0 || ext.specialModifier !== '0' || ext.isCommand;
            if (anyExt) {
                expect(parsed.mainIconExtension).toBe(ext.mainIconExtension);
                expect(parsed.modifier1Extension).toBe(ext.modifier1Extension);
                expect(parsed.modifier2Extension).toBe(ext.modifier2Extension);
                expect(parsed.specialModifier).toBe(ext.specialModifier);
                expect(parsed.isCommand).toBe(ext.isCommand);
            } else {
                expect(sidc.substring(20)).toBe('0760000000');
            }
        }));
    });

    it('property: every built SIDC validates', () => {
        fc.assert(fc.property(baseProps(), extProps(), (base, ext) => {
            const sidc = gen.buildSIDC({ ...base, ...ext });
            expect(gen.validateSIDC(sidc)).toEqual({ valid: true });
        }));
    });
});

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    classifyStyleValue,
    parseCategorized,
    serializeCategorized,
    parseGraduated,
    serializeGraduated,
    graduatedStopsAscending,
    describeInput,
    parseColor,
    formatRgba,
    toHex6
} from '../../src/js/layers/layer-style/style-expression.model.js';

// Real expressions taken verbatim from a production config.js (moldura_*,
// municipios_2022) so the parser is pinned to the shapes it must handle.
const CASE_FILL = [
    'case',
    ['==', ['get', 'situacao_topo'], 'Concluído'], 'rgba(145,207,96,0.5)',
    ['==', ['get', 'situacao_topo'], 'Múltiplas edições'], 'rgba(102,178,255,0.5)',
    'rgba(255, 0, 0, 0)'
];
const STEP_BORDER_COLOR = [
    'step', ['length', ['get', 'edicoes_orto']], '#aaaaaaff',
    8, 'rgba(145,207,96,1)',
    14, 'rgba(102,178,255,1)'
];
const STEP_BORDER_WIDTH = [
    'step', ['length', ['get', 'edicoes_orto']], 0.5,
    8, 5,
    14, 5
];
const INTERP_FILL = [
    'interpolate', ['linear'], ['get', 'populacao_2022'],
    0, 'rgba(237,248,233,1.0)',
    10000, 'rgba(186,228,179,1.0)',
    50000, 'rgba(116,196,118,1.0)',
    200000, 'rgba(49,163,84,1.0)',
    1000000, 'rgba(0,109,44,1.0)'
];
const MATCH_FILL = ['match', ['get', 'tipo'], 'a', '#ff0000', ['b', 'c'], '#00ff00', '#cccccc'];

describe('classifyStyleValue', () => {
    it('classifies constants', () => {
        expect(classifyStyleValue('#ff0000')).toBe('constant');
        expect(classifyStyleValue('rgba(1,2,3,0.5)')).toBe('constant');
        expect(classifyStyleValue(0.5)).toBe('constant');
        expect(classifyStyleValue(12)).toBe('constant');
    });

    it('classifies categorized (case / match)', () => {
        expect(classifyStyleValue(CASE_FILL)).toBe('categorized');
        expect(classifyStyleValue(MATCH_FILL)).toBe('categorized');
    });

    it('classifies graduated (interpolate / step)', () => {
        expect(classifyStyleValue(INTERP_FILL)).toBe('graduated');
        expect(classifyStyleValue(STEP_BORDER_COLOR)).toBe('graduated');
        expect(classifyStyleValue(STEP_BORDER_WIDTH)).toBe('graduated');
    });

    it('treats unknown expressions and nullish values as unsupported', () => {
        expect(classifyStyleValue(['concat', 'MI ', ['get', 'id']])).toBe('unsupported');
        expect(classifyStyleValue(['get', 'foo'])).toBe('unsupported');
        expect(classifyStyleValue(null)).toBe('unsupported');
        expect(classifyStyleValue(undefined)).toBe('unsupported');
    });
});

describe('parseCategorized / serializeCategorized', () => {
    it('parses a real case expression', () => {
        const model = parseCategorized(CASE_FILL);
        expect(model.op).toBe('case');
        expect(model.fieldLabel).toBe('situacao_topo');
        expect(model.categories).toHaveLength(2);
        expect(model.categories[0].label).toBe('Concluído');
        expect(model.categories[0].output).toBe('rgba(145,207,96,0.5)');
        expect(model.fallback).toBe('rgba(255, 0, 0, 0)');
    });

    it('parses a match expression incl. multi-value labels', () => {
        const model = parseCategorized(MATCH_FILL);
        expect(model.op).toBe('match');
        expect(model.fieldLabel).toBe('tipo');
        expect(model.categories).toHaveLength(2);
        expect(model.categories[1].label).toBe('b, c');
        expect(model.categories[1].value).toEqual(['b', 'c']);
        expect(model.fallback).toBe('#cccccc');
    });

    it('round-trips case and match verbatim', () => {
        expect(serializeCategorized(parseCategorized(CASE_FILL))).toEqual(CASE_FILL);
        expect(serializeCategorized(parseCategorized(MATCH_FILL))).toEqual(MATCH_FILL);
    });

    it('reflects edited outputs on serialize', () => {
        const model = parseCategorized(CASE_FILL);
        model.categories[0].output = '#000000';
        model.fallback = '#ffffff';
        const out = serializeCategorized(model);
        expect(out[2]).toBe('#000000');
        expect(out[out.length - 1]).toBe('#ffffff');
    });

    it('rejects malformed shapes', () => {
        expect(parseCategorized(['case', ['==', ['get', 'f'], 1]])).toBeNull(); // missing fallback
        expect(parseCategorized(['match', ['get', 'f']])).toBeNull();
        expect(parseCategorized('not-an-array')).toBeNull();
    });
});

describe('parseGraduated / serializeGraduated', () => {
    it('parses a real interpolate expression', () => {
        const model = parseGraduated(INTERP_FILL);
        expect(model.op).toBe('interpolate');
        expect(model.fieldLabel).toBe('populacao_2022');
        expect(model.interpolation).toEqual(['linear']);
        expect(model.stops).toHaveLength(5);
        expect(model.stops[0]).toEqual({ stop: 0, output: 'rgba(237,248,233,1.0)' });
    });

    it('parses a real step expression with a base output', () => {
        const model = parseGraduated(STEP_BORDER_COLOR);
        expect(model.op).toBe('step');
        expect(model.fieldLabel).toBe('length(edicoes_orto)');
        expect(model.base).toBe('#aaaaaaff');
        expect(model.stops).toEqual([
            { stop: 8, output: 'rgba(145,207,96,1)' },
            { stop: 14, output: 'rgba(102,178,255,1)' }
        ]);
    });

    it('round-trips interpolate and step verbatim', () => {
        expect(serializeGraduated(parseGraduated(INTERP_FILL))).toEqual(INTERP_FILL);
        expect(serializeGraduated(parseGraduated(STEP_BORDER_COLOR))).toEqual(STEP_BORDER_COLOR);
        expect(serializeGraduated(parseGraduated(STEP_BORDER_WIDTH))).toEqual(STEP_BORDER_WIDTH);
    });

    it('reflects edited breaks and outputs on serialize', () => {
        const model = parseGraduated(STEP_BORDER_WIDTH);
        model.stops[0].stop = 10;
        model.stops[0].output = 3;
        const out = serializeGraduated(model);
        expect(out).toEqual(['step', ['length', ['get', 'edicoes_orto']], 0.5, 10, 3, 14, 5]);
    });

    it('rejects malformed shapes', () => {
        expect(parseGraduated(['interpolate', ['linear'], ['get', 'f'], 0])).toBeNull(); // odd pairs
        expect(parseGraduated(['step', ['get', 'f']])).toBeNull();
        expect(parseGraduated(['interpolate', ['linear'], ['get', 'f'], 'x', 'red'])).toBeNull(); // non-numeric stop
    });
});

describe('graduatedStopsAscending', () => {
    it('accepts strictly ascending stops', () => {
        expect(graduatedStopsAscending(parseGraduated(INTERP_FILL))).toBe(true);
        expect(graduatedStopsAscending(parseGraduated(STEP_BORDER_COLOR))).toBe(true);
    });

    it('rejects descending or duplicated breaks', () => {
        expect(graduatedStopsAscending({ stops: [{ stop: 14 }, { stop: 8 }] })).toBe(false);
        expect(graduatedStopsAscending({ stops: [{ stop: 8 }, { stop: 8 }] })).toBe(false);
    });

    it('treats single/empty/missing stops as valid', () => {
        expect(graduatedStopsAscending({ stops: [{ stop: 0 }] })).toBe(true);
        expect(graduatedStopsAscending({ stops: [] })).toBe(true);
        expect(graduatedStopsAscending({})).toBe(true);
        expect(graduatedStopsAscending(null)).toBe(true);
    });
});

describe('describeInput', () => {
    it('renders readable field labels', () => {
        expect(describeInput(['get', 'nome'])).toBe('nome');
        expect(describeInput(['coalesce', ['get', 'pop'], 0])).toBe('pop');
        expect(describeInput(['length', ['get', 'edicoes']])).toBe('length(edicoes)');
        expect(describeInput('plain')).toBe('plain');
    });
});

describe('color helpers', () => {
    it('parses hex variants', () => {
        expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
        expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 });
        expect(parseColor('#aaaaaaff')).toEqual({ r: 170, g: 170, b: 170, a: 1 });
        expect(parseColor('#00000000')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it('parses rgb / rgba / transparent', () => {
        expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
        expect(parseColor('rgba(145,207,96,0.5)')).toEqual({ r: 145, g: 207, b: 96, a: 0.5 });
        expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });

    it('returns null for unparseable colors', () => {
        expect(parseColor('cornflowerblue')).toBeNull();
        expect(parseColor(42)).toBeNull();
        expect(parseColor(['case'])).toBeNull();
    });

    it('formats opaque as rgb and translucent as rgba', () => {
        expect(formatRgba({ r: 1, g: 2, b: 3, a: 1 })).toBe('rgb(1, 2, 3)');
        expect(formatRgba({ r: 145, g: 207, b: 96, a: 0.5 })).toBe('rgba(145, 207, 96, 0.5)');
    });

    it('toHex6 drops alpha and falls back to black', () => {
        expect(toHex6('rgba(255,0,0,0.5)')).toBe('#ff0000');
        expect(toHex6('transparent')).toBe('#000000');
        expect(toHex6('not-a-color')).toBe('#000000');
    });
});

describe('property-based round-trips', () => {
    it('case expressions survive parse → serialize', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }),
            fc.array(fc.tuple(fc.string(), fc.string()), { minLength: 1, maxLength: 6 }),
            fc.string(),
            (field, pairs, fallback) => {
                const expr = ['case'];
                for (const [v, out] of pairs) expr.push(['==', ['get', field], v], out);
                expr.push(fallback);
                expect(serializeCategorized(parseCategorized(expr))).toEqual(expr);
            }
        ));
    });

    it('interpolate expressions survive parse → serialize', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }),
            fc.array(fc.tuple(fc.integer(), fc.string()), { minLength: 1, maxLength: 6 }),
            (field, pairs) => {
                const expr = ['interpolate', ['linear'], ['get', field]];
                for (const [stop, out] of pairs) expr.push(stop, out);
                expect(serializeGraduated(parseGraduated(expr))).toEqual(expr);
            }
        ));
    });

    it('step expressions survive parse → serialize', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 1 }),
            fc.string(),
            fc.array(fc.tuple(fc.integer(), fc.string()), { minLength: 1, maxLength: 6 }),
            (field, base, pairs) => {
                const expr = ['step', ['get', field], base];
                for (const [stop, out] of pairs) expr.push(stop, out);
                expect(serializeGraduated(parseGraduated(expr))).toEqual(expr);
            }
        ));
    });

    it('color round-trips through formatRgba → parseColor', () => {
        fc.assert(fc.property(
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 100 }),
            (r, g, b, aPct) => {
                const a = aPct / 100;
                const parsed = parseColor(formatRgba({ r, g, b, a }));
                expect(parsed.r).toBe(r);
                expect(parsed.g).toBe(g);
                expect(parsed.b).toBe(b);
                expect(parsed.a).toBeCloseTo(a, 5);
            }
        ));
    });
});

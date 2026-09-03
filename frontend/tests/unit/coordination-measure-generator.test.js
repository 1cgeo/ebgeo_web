// Path: tests/unit/coordination-measure-generator.test.js

/**
 * @fileoverview Pins the pure string/geometry helpers of
 * `military_tools/coordination_measure_tool/coordination_measure_generator.js`.
 *
 * WHAT THIS SUITE HOLDS
 *  - `hexToRgb`: the strict 6-digit-only policy (3-digit and 8-digit are REJECTED).
 *    The namesake in `brazilian_svg_postprocessing.js` was NOT strict and now is;
 *    it is pinned in `tests/unit/brazilian-svg-postprocessing.test.js`;
 *  - `applyCustomColor`: 'none' opens the white mask (fill only, stroke untouched);
 *    a real hex paints the INK (stroke and black fill, in the three spellings the
 *    catalog uses) and leaves the white as mask; a bad hex is a byte-identical no-op;
 *  - `extractDimensions`: the viewBox parse and the fallback, including the
 *    leading-space case where the split yields five tokens;
 *  - `calculateDynamicViewBox`: which values count as "present" (0 does, '' does not),
 *    the 5-unit margin, the floor/ceil integerisation and the anchor arithmetic. The
 *    three "is it filled in" guards share ONE predicate, `hasTextValue`, and that
 *    agreement is asserted value by value;
 *  - `validate` for the three rule families (supply / echelon / concentration);
 *  - `escapeXml`, `estimateTextWidth`, `hasExternalText`, `applyDashedStroke` and the
 *    catalog query helpers.
 *
 * WHAT IT DOES NOT REACH
 *  - `generateSymbolBlob` / `generate` / `convertToPngBlob`: canvas + FileReader,
 *    Phase 2 in the backlog. The growth-factor arithmetic they wrap is exercised
 *    only through `calculateDynamicViewBox` here, not end to end.
 *  - The DOM sections that write these properties.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { CoordinationMeasureGenerator } from
    '@js/military_tools/coordination_measure_tool/coordination_measure_generator.js';

const gen = new CoordinationMeasureGenerator();

/** Minimal SVG carrying a viewBox and a white fill, as the catalog entries do. */
const SVG = '<svg viewBox="0 0 40 40" width="40" height="40">'
    + '<rect fill="rgb(255,255,255)" stroke="rgb(255,255,255)"/></svg>';

/**
 * Build a one-field catalog stub.
 * @param {Object} [config] - Overrides for the single text field
 * @returns {Object} pointData shaped like a catalog entry
 */
function pointDataWithField(config = {}) {
    return {
        textFields: {
            rotulo: {
                position: { x: 20, y: 20 },
                anchor: 'middle',
                fontSize: 10,
                ...config,
            },
        },
    };
}

// ============================================================================
// hexToRgb
// ============================================================================

describe('CoordinationMeasureGenerator.hexToRgb', () => {
    it('parses a 6-digit hex with and without the leading #', () => {
        expect(gen.hexToRgb('#11FF00')).toEqual({ r: 17, g: 255, b: 0 });
        expect(gen.hexToRgb('11FF00')).toEqual({ r: 17, g: 255, b: 0 });
    });

    it('is case-insensitive', () => {
        expect(gen.hexToRgb('#11ff00')).toEqual(gen.hexToRgb('#11FF00'));
    });

    it('handles both extremes of the range', () => {
        expect(gen.hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
        expect(gen.hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('REJECTS the 3-digit shorthand instead of expanding it', () => {
        expect(gen.hexToRgb('#FFF')).toBeNull();
        expect(gen.hexToRgb('fff')).toBeNull();
    });

    it('rejects 8-digit (alpha), empty, whitespace and non-hex characters', () => {
        expect(gen.hexToRgb('#ff000000')).toBeNull();
        expect(gen.hexToRgb('')).toBeNull();
        expect(gen.hexToRgb('#')).toBeNull();
        expect(gen.hexToRgb('  #11FF00  ')).toBeNull();
        expect(gen.hexToRgb('#GGGGGG')).toBeNull();
        expect(gen.hexToRgb('rgb(1,2,3)')).toBeNull();
    });

    it('strips only ONE leading #, so ## fails', () => {
        expect(gen.hexToRgb('##11FF00')).toBeNull();
    });

    it('round-trips any byte triple through its own hex encoding', () => {
        fc.assert(fc.property(
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            fc.integer({ min: 0, max: 255 }),
            (r, g, b) => {
                /** @param {number} n - Byte @returns {string} Two-digit hex */
                const hex = (n) => n.toString(16).padStart(2, '0');

                expect(gen.hexToRgb(`#${hex(r)}${hex(g)}${hex(b)}`)).toEqual({ r, g, b });
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// applyCustomColor
// ============================================================================

describe('CoordinationMeasureGenerator.applyCustomColor', () => {
    it("'none' rewrites only the FILL attribute and leaves the stroke white", () => {
        const out = gen.applyCustomColor(SVG, 'none');

        expect(out).toContain('fill="none"');
        expect(out).toContain('stroke="rgb(255,255,255)"');
    });

    it("'none' tolerates the spaced rgb form the catalog also uses", () => {
        const out = gen.applyCustomColor('<a fill="rgb(255, 255, 255)"/>', 'none');

        expect(out).toBe('<a fill="none"/>');
    });

    it('a real hex paints the INK, and the white stays a mask instead of taking the colour', () => {
        // Esta assercao foi INVERTIDA em 2026-09-03. A anterior fixava a regra antiga, em
        // que a cor substituia todo rgb(255,255,255). Duas coisas a derrubaram: o branco do
        // catalogo e MASCARA e nao preenchimento (no 290800 Travessia para carros de combate
        // ele e a lagarta que INTERROMPE a linha, e pinta-lo deixava a linha preta, o
        // contrario do que se pede), e 53 dos 104 simbolos sao traco puro, sem branco nenhum,
        // de modo que o controle "Usar cor personalizada" era inerte neles.
        const svg = '<svg viewBox="0 0 40 40" width="40" height="40">'
            + '<rect fill="rgb(255,255,255)" stroke="black"/>'
            + '<path d="M0,0 1,1" stroke="#000" fill="black"/></svg>';

        const out = gen.applyCustomColor(svg, '#11FF00');

        expect(out).toContain('stroke="rgb(17, 255, 0)"');
        expect(out).toContain('fill="rgb(17, 255, 0)"');
        expect(out).toContain('fill="none"');
        expect(out).not.toContain('rgb(255,255,255)');
        expect(out).not.toContain('"black"');
        expect(out).not.toContain('"#000"');
    });

    it('a symbol made only of ink responds too, which the old rule could not do', () => {
        const soTraco = '<svg viewBox="0 0 40 40" width="40" height="40">'
            + '<path d="M0,0 1,1" stroke="black" fill="none"/></svg>';

        expect(gen.applyCustomColor(soTraco, '#11FF00')).toContain('stroke="rgb(17, 255, 0)"');
    });

    it('an invalid hex is a SILENT no-op: the SVG comes back byte-identical', () => {
        expect(gen.applyCustomColor(SVG, '#FFF')).toBe(SVG);
        expect(gen.applyCustomColor(SVG, 'nonsense')).toBe(SVG);
        expect(gen.applyCustomColor(SVG, '')).toBe(SVG);
    });

    it('leaves non-white colours alone', () => {
        const svg = '<a fill="rgb(0,0,0)"/>';

        expect(gen.applyCustomColor(svg, '#11FF00')).toBe(svg);
    });
});

// ============================================================================
// applyDashedStroke
// ============================================================================

describe('CoordinationMeasureGenerator.applyDashedStroke', () => {
    it('appends stroke-dasharray to every stroke attribute, keeping the colour', () => {
        const out = gen.applyDashedStroke('<a stroke="black"/><b stroke="red"/>');

        expect(out).toBe(
            '<a stroke="black" stroke-dasharray="5,5"/><b stroke="red" stroke-dasharray="5,5"/>'
        );
    });

    it('is a no-op on an SVG with no stroke attribute', () => {
        expect(gen.applyDashedStroke('<a fill="black"/>')).toBe('<a fill="black"/>');
    });

    it('is NOT idempotent: applying it twice doubles the dash attribute', () => {
        const once = gen.applyDashedStroke('<a stroke="black"/>');

        expect(gen.applyDashedStroke(once)).not.toBe(once);
    });
});

// ============================================================================
// escapeXml
// ============================================================================

describe('CoordinationMeasureGenerator.escapeXml', () => {
    it('escapes the five XML entities', () => {
        expect(gen.escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
    });

    it('escapes & first, so no double-escaping of the entities it just wrote', () => {
        expect(gen.escapeXml('a&b<c')).toBe('a&amp;b&lt;c');
        expect(gen.escapeXml('&amp;')).toBe('&amp;amp;');
    });

    it('leaves plain and accented text untouched', () => {
        expect(gen.escapeXml('Posição 1')).toBe('Posição 1');
        expect(gen.escapeXml('')).toBe('');
    });

    it('throws on a non-string, because it calls String.prototype.replace directly', () => {
        expect(() => gen.escapeXml(42)).toThrow();
        expect(() => gen.escapeXml(null)).toThrow();
    });

    it('never leaves a bare < or & behind', () => {
        fc.assert(fc.property(fc.string(), (text) => {
            const escaped = gen.escapeXml(text);

            expect(escaped).not.toMatch(/<|>|"|'/);
            expect(escaped.replace(/&(amp|lt|gt|quot|apos);/g, '')).not.toContain('&');
        }), { numRuns: 300 });
    });
});

// ============================================================================
// estimateTextWidth
// ============================================================================

describe('CoordinationMeasureGenerator.estimateTextWidth', () => {
    it('uses 0.6 em per char for normal weight and 0.7 for bold', () => {
        expect(gen.estimateTextWidth('abc', 10)).toBeCloseTo(18, 10);
        expect(gen.estimateTextWidth('abc', 10, 'bold')).toBeCloseTo(21, 10);
    });

    it('treats any weight that is not the literal "bold" as normal', () => {
        expect(gen.estimateTextWidth('abc', 10, '700')).toBeCloseTo(18, 10);
        expect(gen.estimateTextWidth('abc', 10, 'BOLD')).toBeCloseTo(18, 10);
    });

    it('measures the STRING form, so a number or 0 has a real width', () => {
        expect(gen.estimateTextWidth(0, 10)).toBeCloseTo(6, 10);
        expect(gen.estimateTextWidth(1234, 10)).toBeCloseTo(24, 10);
    });

    it('returns 0 for the empty string and NaN for a NaN font size', () => {
        expect(gen.estimateTextWidth('', 10)).toBe(0);
        expect(Number.isNaN(gen.estimateTextWidth('abc', NaN))).toBe(true);
    });

    it('grows linearly with length, bold always at least as wide as normal', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 0, maxLength: 40 }),
            fc.double({ min: 1, max: 60, noNaN: true }),
            (text, fontSize) => {
                const normal = gen.estimateTextWidth(text, fontSize);

                expect(normal).toBeCloseTo(text.length * fontSize * 0.6, 8);
                expect(gen.estimateTextWidth(text, fontSize, 'bold'))
                    .toBeGreaterThanOrEqual(normal);
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// hasExternalText
// ============================================================================

describe('CoordinationMeasureGenerator.hasExternalText', () => {
    const pointData = pointDataWithField();

    it('is false when the point declares no text fields at all', () => {
        expect(gen.hasExternalText({ rotulo: 'x' }, {})).toBe(false);
        expect(gen.hasExternalText({ rotulo: 'x' }, { textFields: {} })).toBe(false);
    });

    it('is true for a filled field and false for the three "empty" sentinels', () => {
        expect(gen.hasExternalText({ rotulo: 'ABC' }, pointData)).toBe(true);
        expect(gen.hasExternalText({ rotulo: '' }, pointData)).toBe(false);
        expect(gen.hasExternalText({ rotulo: null }, pointData)).toBe(false);
        expect(gen.hasExternalText({}, pointData)).toBe(false);
    });

    it('counts the number 0 as present (it is a legitimate label)', () => {
        expect(gen.hasExternalText({ rotulo: 0 }, pointData)).toBe(true);
    });

    it('FIXED: boolean false is counted as present AND drawn, by one predicate', () => {
        // hasExternalText and calculateDynamicViewBox used the ===undefined/null/''
        // test; addExternalTexts used `!value && value !== 0`. `false` split them, so
        // the symbol grew to fit a label that was never drawn. The three now share
        // `hasTextValue`, so growth and drawing cannot disagree for ANY value.
        expect(gen.hasExternalText({ rotulo: false }, pointData)).toBe(true);

        // Field placed OUTSIDE the base box so the growth is observable at all.
        const outside = pointDataWithField({ position: { x: 60, y: 20 } });
        const expanded = gen.calculateDynamicViewBox(SVG, { rotulo: false }, outside);

        expect(expanded.width).toBeGreaterThan(gen.extractDimensions(SVG).width);
        expect(gen.addExternalTexts(SVG, { rotulo: false }, outside)).toContain('>false</text>');
    });

    it('the three guards answer the same for every value, drawn or not', () => {
        const outside = pointDataWithField({ position: { x: 60, y: 20 } });
        const base = gen.extractDimensions(SVG).width;
        const cases = [
            [{ rotulo: 'ABC' }, true],
            [{ rotulo: 0 }, true],
            [{ rotulo: false }, true],
            [{ rotulo: '' }, false],
            [{ rotulo: null }, false],
            [{}, false],
        ];

        expect(cases.length).toBe(6);
        for (const [properties, present] of cases) {
            expect(gen.hasExternalText(properties, outside)).toBe(present);
            expect(gen.calculateDynamicViewBox(SVG, properties, outside).width > base).toBe(present);
            expect(gen.addExternalTexts(SVG, properties, outside) !== SVG).toBe(present);
        }
    });

    it('ignores properties that are not declared as text fields', () => {
        expect(gen.hasExternalText({ outroCampo: 'ABC' }, pointData)).toBe(false);
    });
});

// ============================================================================
// extractDimensions
// ============================================================================

const DEFAULT_DIMENSIONS = { minX: 0, minY: 0, width: 40, height: 40, maxX: 40, maxY: 40 };

describe('CoordinationMeasureGenerator.extractDimensions', () => {
    it('reads the four viewBox numbers and derives maxX / maxY', () => {
        expect(gen.extractDimensions('<svg viewBox="1 2 30 40"/>')).toEqual({
            minX: 1, minY: 2, width: 30, height: 40, maxX: 31, maxY: 42,
        });
    });

    it('accepts negative origins, as the real catalog SVGs use', () => {
        expect(gen.extractDimensions('<svg viewBox="56 -64 88 168"/>')).toEqual({
            minX: 56, minY: -64, width: 88, height: 168, maxX: 144, maxY: 104,
        });
    });

    it('falls back to the 40x40 default when there is no viewBox', () => {
        expect(gen.extractDimensions('<svg/>')).toEqual(DEFAULT_DIMENSIONS);
        expect(gen.extractDimensions('')).toEqual(DEFAULT_DIMENSIONS);
    });

    it('falls back when the viewBox has a LEADING SPACE: the split yields 5 tokens', () => {
        expect(gen.extractDimensions('<svg viewBox=" 0 0 40 40"/>')).toEqual(DEFAULT_DIMENSIONS);
    });

    it('falls back on any token count other than four', () => {
        expect(gen.extractDimensions('<svg viewBox="0 0 40"/>')).toEqual(DEFAULT_DIMENSIONS);
        expect(gen.extractDimensions('<svg viewBox="0 0 40 40 9"/>')).toEqual(DEFAULT_DIMENSIONS);
    });

    it('does NOT fall back on unparseable numbers: NaN flows through', () => {
        const dims = gen.extractDimensions('<svg viewBox="a b c d"/>');

        expect(Number.isNaN(dims.width)).toBe(true);
        expect(Number.isNaN(dims.maxX)).toBe(true);
    });

    it('reads the FIRST viewBox when a nested SVG carries a second one', () => {
        expect(gen.extractDimensions('<svg viewBox="1 1 10 10"><svg viewBox="9 9 90 90"/></svg>').width)
            .toBe(10);
    });

    it('round-trips any four-number viewBox', () => {
        fc.assert(fc.property(
            fc.integer({ min: -500, max: 500 }),
            fc.integer({ min: -500, max: 500 }),
            fc.integer({ min: 1, max: 500 }),
            fc.integer({ min: 1, max: 500 }),
            (minX, minY, width, height) => {
                const dims = gen.extractDimensions(`<svg viewBox="${minX} ${minY} ${width} ${height}"/>`);

                expect(dims).toEqual({
                    minX, minY, width, height,
                    maxX: minX + width, maxY: minY + height,
                });
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// calculateDynamicViewBox
// ============================================================================

describe('CoordinationMeasureGenerator.calculateDynamicViewBox', () => {
    it('returns the base box, integerised, when no text field is filled', () => {
        const box = gen.calculateDynamicViewBox(SVG, {}, pointDataWithField());

        expect(box).toMatchObject({ minX: 0, minY: 0, width: 40, height: 40 });
        expect(box.viewBoxString).toBe('0 0 40 40');
    });

    it('EXPANDS for the value 0 and does NOT expand for the empty string', () => {
        // The label sits outside the 40x40 base box, so "counted" is observable.
        const outside = pointDataWithField({ position: { x: 60, y: 20 } });
        const withZero = gen.calculateDynamicViewBox(SVG, { rotulo: 0 }, outside);
        const withEmpty = gen.calculateDynamicViewBox(SVG, { rotulo: '' }, outside);

        expect(withZero.width).toBeGreaterThan(40);
        expect(withEmpty.width).toBe(40);
        expect(withEmpty.height).toBe(40);
    });

    it('never expands for null or a missing property', () => {
        const outside = pointDataWithField({ position: { x: 60, y: 20 } });

        expect(gen.calculateDynamicViewBox(SVG, { rotulo: null }, outside).width).toBe(40);
        expect(gen.calculateDynamicViewBox(SVG, {}, outside).width).toBe(40);
    });

    it('a label that fits INSIDE the base box does not enlarge it', () => {
        expect(gen.calculateDynamicViewBox(SVG, { rotulo: 'AB' }, pointDataWithField()).width)
            .toBe(40);
    });

    it('applies the 5-unit margin on the side the anchor pushes the text to', () => {
        // anchor 'start': text runs x .. x+width, so only the right edge grows.
        const start = gen.calculateDynamicViewBox(
            SVG, { rotulo: 'ABCDEFGH' }, pointDataWithField({ anchor: 'start', position: { x: 20, y: 20 } })
        );
        // 8 chars * 10 * 0.6 = 48 -> maxX candidate 20 + 48 + 5 = 73
        expect(start.minX).toBe(0);
        expect(start.maxX).toBe(73);

        // anchor 'end': text runs x-width .. x, so only the left edge grows.
        const end = gen.calculateDynamicViewBox(
            SVG, { rotulo: 'ABCDEFGH' }, pointDataWithField({ anchor: 'end', position: { x: 20, y: 20 } })
        );
        expect(end.minX).toBe(20 - 48 - 5);
        expect(end.maxX).toBe(40);
    });

    it('centres the text for the default (middle) anchor', () => {
        const box = gen.calculateDynamicViewBox(
            SVG, { rotulo: 'ABCDEFGH' }, pointDataWithField({ position: { x: 20, y: 20 } })
        );

        expect(box.minX).toBe(Math.floor(20 - 24 - 5));
        expect(box.maxX).toBe(Math.ceil(20 + 24 + 5));
    });

    it('grows the vertical box by fontSize above and 0.3 * fontSize below, plus margin', () => {
        const box = gen.calculateDynamicViewBox(
            SVG, { rotulo: 'A' }, pointDataWithField({ position: { x: 20, y: 2 }, fontSize: 20 })
        );

        // textMinY = 2 - 20 = -18, minus MARGIN -> -23
        expect(box.minY).toBe(-23);
        expect(box.maxY).toBe(40);
    });

    it('integerises with floor on the origin and ceil on the far edge', () => {
        const box = gen.calculateDynamicViewBox(
            SVG, { rotulo: 'A' }, pointDataWithField({ anchor: 'end', position: { x: 0.5, y: 0.5 }, fontSize: 7 })
        );

        expect(Number.isInteger(box.minX)).toBe(true);
        expect(Number.isInteger(box.minY)).toBe(true);
        expect(Number.isInteger(box.width)).toBe(true);
        expect(Number.isInteger(box.height)).toBe(true);
    });

    it('keeps viewBoxString consistent with the numeric fields', () => {
        const box = gen.calculateDynamicViewBox(SVG, { rotulo: 'ABC' }, pointDataWithField());

        expect(box.viewBoxString).toBe(`${box.minX} ${box.minY} ${box.width} ${box.height}`);
        expect(box.width).toBe(box.maxX - box.minX);
        expect(box.height).toBe(box.maxY - box.minY);
    });

    it('never shrinks below the original box, for any single label', () => {
        fc.assert(fc.property(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.integer({ min: -30, max: 70 }),
            fc.integer({ min: -30, max: 70 }),
            fc.constantFrom('start', 'end', 'middle'),
            fc.integer({ min: 4, max: 30 }),
            (rotulo, x, y, anchor, fontSize) => {
                const base = gen.extractDimensions(SVG);
                const box = gen.calculateDynamicViewBox(
                    SVG, { rotulo }, pointDataWithField({ anchor, fontSize, position: { x, y } })
                );

                expect(box.minX).toBeLessThanOrEqual(base.minX);
                expect(box.minY).toBeLessThanOrEqual(base.minY);
                expect(box.maxX).toBeGreaterThanOrEqual(base.maxX);
                expect(box.maxY).toBeGreaterThanOrEqual(base.maxY);
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// addExternalTexts
// ============================================================================

describe('CoordinationMeasureGenerator.addExternalTexts', () => {
    it('inserts one <text> before </svg> and rewrites viewBox, width and height', () => {
        const out = gen.addExternalTexts(SVG, { rotulo: 'ABC' }, pointDataWithField());
        const box = gen.calculateDynamicViewBox(SVG, { rotulo: 'ABC' }, pointDataWithField());

        expect(out).toContain('>ABC</text>');
        expect(out).toContain(`viewBox="${box.viewBoxString}"`);
        expect(out).toContain(`width="${box.width}"`);
        expect(out).toContain(`height="${box.height}"`);
    });

    it('escapes the label it injects', () => {
        const out = gen.addExternalTexts(SVG, { rotulo: '<script>&' }, pointDataWithField());

        expect(out).toContain('&lt;script&gt;&amp;');
        expect(out).not.toContain('<script>');
    });

    it('skips the empty string, null and undefined', () => {
        expect(gen.addExternalTexts(SVG, { rotulo: '' }, pointDataWithField())).toBe(SVG);
        expect(gen.addExternalTexts(SVG, { rotulo: null }, pointDataWithField())).toBe(SVG);
        expect(gen.addExternalTexts(SVG, {}, pointDataWithField())).toBe(SVG);
    });

    it('draws the STRING "0"', () => {
        expect(gen.addExternalTexts(SVG, { rotulo: '0' }, pointDataWithField()))
            .toContain('>0</text>');
    });

    // CONTROL for the fix below: the same call path works for a string, so a red
    // assertion is about the numeric input and not about the module being broken.
    it('control: addExternalTexts is reachable and discriminates on the value type', () => {
        expect(gen.addExternalTexts(SVG, { rotulo: '0' }, pointDataWithField()))
            .not.toBe(SVG);
        expect(gen.addExternalTexts(SVG, { rotulo: '' }, pointDataWithField()))
            .toBe(SVG);
    });

    it('FIXED: a NUMERIC label is drawn instead of throwing in escapeXml', () => {
        // The value guard deliberately admits a number (0 included), and
        // `createTextElement` used to hand it straight to `escapeXml`, which calls
        // String.prototype.replace: the whole symbol render died on a TypeError.
        expect(gen.addExternalTexts(SVG, { rotulo: 0 }, pointDataWithField()))
            .toContain('>0</text>');
        expect(gen.addExternalTexts(SVG, { rotulo: 42 }, pointDataWithField()))
            .toContain('>42</text>');
        expect(() => gen.addExternalTexts(SVG, { rotulo: 0 }, pointDataWithField()))
            .not.toThrow();
    });

    it('the number and the string of the same label produce the SAME element', () => {
        expect(gen.addExternalTexts(SVG, { rotulo: 0 }, pointDataWithField()))
            .toBe(gen.addExternalTexts(SVG, { rotulo: '0' }, pointDataWithField()));
    });

    it('is a no-op when the point declares no text fields', () => {
        expect(gen.addExternalTexts(SVG, { rotulo: 'ABC' }, {})).toBe(SVG);
    });
});

// ============================================================================
// createTextElement
// ============================================================================

describe('CoordinationMeasureGenerator.createTextElement', () => {
    it('defaults anchor/size/weight/fill when no options are given', () => {
        const el = gen.createTextElement(1, 2, 'X');

        expect(el).toContain('x="1"');
        expect(el).toContain('y="2"');
        expect(el).toContain('text-anchor="middle"');
        expect(el).toContain('font-size="10"');
        expect(el).toContain('font-weight="normal"');
        expect(el).toContain('fill="black"');
    });

    it('escapes the content', () => {
        expect(gen.createTextElement(0, 0, 'a & b')).toContain('>a &amp; b</text>');
    });
});

// ============================================================================
// validate
// ============================================================================

describe('CoordinationMeasureGenerator.validate', () => {
    it('short-circuits on an unknown point code with a single error', () => {
        expect(gen.validate('nao-existe', {})).toEqual(['Point nao-existe not found']);
        expect(gen.validate(undefined, {})).toEqual(['Point undefined not found']);
    });

    it('returns an EMPTY array (not null) for a plain point with nothing required', () => {
        expect(gen.validate('130100', {})).toEqual([]);
    });

    it('demands a supply class for a supply point', () => {
        expect(gen.validate('SUPPLY_I', {})).toEqual(['Select supply class']);
        expect(gen.validate('SUPPLY_I', { classeSuprimento: 'I' })).toEqual([]);
    });

    it('demands BOTH name and status for an echelon point', () => {
        const errors = gen.validate('ECHELON_16', {});

        expect(errors).toHaveLength(2);
        expect(errors).toEqual(['Enter unit name', 'Select status (occupied/prepared)']);
        expect(gen.validate('ECHELON_16', { nome: 'A', status: 'ocupado' })).toEqual([]);
    });

    it('reports only the missing half when one echelon field is filled', () => {
        expect(gen.validate('ECHELON_16', { nome: 'A' }))
            .toEqual(['Select status (occupied/prepared)']);
    });

    it('treats the empty string as missing, because the guard is falsy-based', () => {
        expect(gen.validate('ECHELON_16', { nome: '', status: '' })).toHaveLength(2);
    });

    it('demands a concentration number for point 240601 only', () => {
        expect(gen.validate('240601', {}))
            .toEqual(['Enter concentration number (e.g. HA 107)']);
        expect(gen.validate('240601', { numeroConcentracao: 'HA 107' })).toEqual([]);
        expect(gen.validate('130100', {})).toEqual([]);
    });

    it('FIXED: a concentration number of 0 is accepted, not reported as missing', () => {
        expect(gen.validate('240601', { numeroConcentracao: 0 })).toEqual([]);
        // Control: the three genuinely empty sentinels are still reported, so the
        // gate did not simply stop firing.
        expect(gen.validate('240601', { numeroConcentracao: '' })).toHaveLength(1);
        expect(gen.validate('240601', { numeroConcentracao: null })).toHaveLength(1);
        expect(gen.validate('240601', {})).toHaveLength(1);
    });

    it('LIMITE CONHECIDO: the OTHER three gates still use the falsy test', () => {
        // `classeSuprimento`, `nome` and `status` keep `!value`, so a 0 there still
        // reads as missing. Left alone deliberately: none of the three has a
        // measured case where 0 is a legitimate value.
        expect(gen.validate('SUPPLY_I', { classeSuprimento: 0 })).toEqual(['Select supply class']);
        expect(gen.validate('ECHELON_16', { nome: 0, status: 0 })).toHaveLength(2);
    });
});

// ============================================================================
// Catalog query helpers
// ============================================================================

describe('CoordinationMeasureGenerator catalog queries', () => {
    it('getPointInfo returns the entry or null, never undefined', () => {
        expect(gen.getPointInfo('130100').code).toBe('130100');
        expect(gen.getPointInfo('nope')).toBeNull();
    });

    it('getAvailableTextFields returns [] for unknown points and for text-less ones', () => {
        expect(gen.getAvailableTextFields('nope')).toEqual([]);
        expect(gen.getAvailableTextFields('ECHELON_16')).toEqual([]);
        expect(gen.getAvailableTextFields('SUPPLY_I'))
            .toEqual(['identificacao', 'gdhIni', 'gdhFim']);
    });

    it('listAvailableCodes matches the catalog keys', () => {
        const codes = gen.listAvailableCodes();

        expect(codes.length).toBeGreaterThan(0);
        expect(codes.length).toBe(Object.keys(gen.catalog).length);
        expect(new Set(codes).size).toBe(codes.length);
    });

    it('listByCategory projects code/name/category and filters exactly', () => {
        const logistica = gen.listByCategory('Logística');

        expect(logistica.length).toBeGreaterThan(0);
        logistica.forEach((entry) => {
            expect(entry.category).toBe('Logística');
            expect(Object.keys(entry).sort()).toEqual(['category', 'code', 'name']);
        });
        expect(gen.listByCategory('nao-existe')).toEqual([]);
    });

    it('getCategories is sorted, deduplicated and covers every listed point', () => {
        const categories = gen.getCategories();

        expect(categories.length).toBeGreaterThan(0);
        expect(new Set(categories).size).toBe(categories.length);
        expect([...categories].sort()).toEqual(categories);

        const total = categories.reduce((sum, c) => sum + gen.listByCategory(c).length, 0);
        expect(total).toBe(Object.keys(gen.catalog).length);
    });
});

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { zoomScaledExpression, ZOOM_STOPS } from '../../src/js/layers/styles/zoom-expression.js';
import { calculateZoomCorrectedValue } from '../../src/js/tool_manager/helpers/zoom-correction.helpers.js';

// A small evaluator for the expression subset the builder emits, following the
// MapLibre style specification: `interpolate` with `exponential` base b between
// stops uses the factor `(b^(z - z0) - 1) / (b^(z1 - z0) - 1)`; `case`, `==`,
// `!=`, `typeof`, `get`, `coalesce`, `min`, `*`, `^`, `-`, `/`, `zoom`. It is
// the documented semantics written down, so the exactness claim of the module
// is checked against the same math MapLibre runs, not against itself.
function evaluate(expr, props, zoom) {
    if (!Array.isArray(expr)) return expr;
    const [op, ...args] = expr;
    const ev = (e) => evaluate(e, props, zoom);
    switch (op) {
        case 'zoom': return zoom;
        case 'get': return Object.prototype.hasOwnProperty.call(props, args[0]) ? props[args[0]] : null;
        case 'coalesce': for (const a of args) { const v = ev(a); if (v !== null && v !== undefined) return v; } return null;
        case 'typeof': { const v = ev(args[0]); return v === null || v === undefined ? 'null' : typeof v; }
        case '==': return ev(args[0]) === ev(args[1]);
        case '!=': return ev(args[0]) !== ev(args[1]);
        case 'case': { for (let i = 0; i + 1 < args.length; i += 2) if (ev(args[i])) return ev(args[i + 1]); return ev(args[args.length - 1]); }
        case 'min': return Math.min(...args.map(ev));
        case '*': return args.map(ev).reduce((a, b) => a * b, 1);
        case '-': return ev(args[0]) - ev(args[1]);
        case '/': return ev(args[0]) / ev(args[1]);
        case '^': return Math.pow(ev(args[0]), ev(args[1]));
        case 'interpolate': {
            const [kind, input, ...stops] = args;
            const base = kind[1];
            const z = ev(input);
            const pairs = [];
            for (let i = 0; i < stops.length; i += 2) pairs.push([stops[i], stops[i + 1]]);
            if (z <= pairs[0][0]) return ev(pairs[0][1]);
            if (z >= pairs[pairs.length - 1][0]) return ev(pairs[pairs.length - 1][1]);
            let i = 0;
            while (pairs[i + 1][0] <= z) i++;
            const [z0, v0] = pairs[i];
            const [z1, v1] = pairs[i + 1];
            const t = (Math.pow(base, z - z0) - 1) / (Math.pow(base, z1 - z0) - 1);
            const a = ev(v0);
            const b = ev(v1);
            return a + (b - a) * t;
        }
        default: throw new Error('operador fora do subconjunto: ' + op);
    }
}

const POINT = { base: ['coalesce', ['get', 'size'], 10], anchor: 'sizeCreatedAtZoom', anchorDefault: 0, disabledFlag: 'sizeZoomCorrectionEnabled', maxValue: 500 };
const TEXT = { base: ['coalesce', ['get', 'size'], 16], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled', maxValue: 255 };
const BRUSH = { base: ['coalesce', ['get', 'lineWidth'], 10], anchor: 'createdAtZoom', disabledFlag: 'zoomCorrectionEnabled' };

describe('zoomScaledExpression: shape', () => {
    it('is a top-level exponential base-2 interpolate on zoom with integer stops 0 to 24', () => {
        const e = zoomScaledExpression(POINT);
        expect(e[0]).toBe('interpolate');
        expect(e[1]).toEqual(['exponential', 2]);
        expect(e[2]).toEqual(['zoom']);
        const stops = e.slice(3).filter((_, i) => i % 2 === 0);
        expect(stops).toEqual([...ZOOM_STOPS]);
        expect(ZOOM_STOPS[0]).toBe(0);
        expect(ZOOM_STOPS[ZOOM_STOPS.length - 1]).toBe(24);
    });

    it('refuses a spec without base or anchor', () => {
        expect(() => zoomScaledExpression({ anchor: 'x' })).toThrow();
        expect(() => zoomScaledExpression({ base: ['get', 'size'] })).toThrow();
    });
});

describe('zoomScaledExpression: value against the JavaScript helper', () => {
    it('reproduces base * 2^(zoom - anchor) exactly below the clamp (point, anchored)', () => {
        const e = zoomScaledExpression(POINT);
        fc.assert(fc.property(
            fc.double({ min: 0, max: 24, noNaN: true }),
            fc.double({ min: 0, max: 24, noNaN: true }),
            fc.double({ min: 1, max: 30, noNaN: true }),
            (zoom, anchor, size) => {
                const props = { size, sizeCreatedAtZoom: anchor };
                const expected = Math.min(size * Math.pow(2, zoom - anchor), 500);
                const got = evaluate(e, props, zoom);
                if (expected < 500 * 0.5) return Math.abs(got - expected) <= 1e-9 * Math.max(1, expected);
                // Around the clamp, the interpolation inside one zoom level is
                // allowed to differ from a hard min, never by more than that level's step.
                return got <= 500 + 1e-9 && got >= Math.min(expected, 500 / 2) - 1e-9;
            },
        ), { numRuns: 400 });
    });

    it('leaves the base value when the flag is false, at any zoom', () => {
        const e = zoomScaledExpression(POINT);
        for (const zoom of [0, 3.3, 11.7, 24]) {
            expect(evaluate(e, { size: 12, sizeCreatedAtZoom: 5, sizeZoomCorrectionEnabled: false }, zoom)).toBe(12);
        }
    });

    it('uses the anchor default when the point has no anchor (the legacy `|| 0` rule)', () => {
        const e = zoomScaledExpression(POINT);
        expect(evaluate(e, { size: 10 }, 2)).toBeCloseTo(40, 9);
        expect(evaluate(e, { size: 10 }, 12)).toBe(500);
    });

    it('does not scale when the anchor is missing and there is no default (text, brush), like zoomScaleFactor', () => {
        const text = zoomScaledExpression(TEXT);
        const brush = zoomScaledExpression(BRUSH);
        for (const zoom of [0, 7.5, 24]) {
            expect(evaluate(text, { size: 20 }, zoom)).toBe(20);
            expect(evaluate(brush, { lineWidth: 4 }, zoom)).toBe(4);
            expect(evaluate(text, { size: 20, createdAtZoom: 'x' }, zoom)).toBe(20);
        }
    });

    it('matches calculateZoomCorrectedValue for text and brush on a zoom grid', () => {
        const text = zoomScaledExpression(TEXT);
        const brush = zoomScaledExpression(BRUSH);
        for (let zoom = 0; zoom <= 24; zoom += 0.25) {
            for (const anchor of [0, 4.2, 10, 15.9]) {
                const tp = { size: 16, createdAtZoom: anchor };
                const expectedText = calculateZoomCorrectedValue(tp, zoom, { sourceProperty: 'size', maxValue: 255 });
                const gotText = evaluate(text, tp, zoom);
                if (expectedText < 127) expect(gotText).toBeCloseTo(expectedText, 9);
                else expect(gotText).toBeLessThanOrEqual(255 + 1e-9);

                const bp = { lineWidth: 6, createdAtZoom: anchor };
                const expectedBrush = calculateZoomCorrectedValue(bp, zoom, { sourceProperty: 'lineWidth' });
                expect(evaluate(brush, bp, zoom)).toBeCloseTo(expectedBrush, 6);
            }
        }
    });

    it('applies the divisor to the whole result (icon sizes are pixels over the image half size)', () => {
        const e = zoomScaledExpression({ ...POINT, divideBy: 32 });
        expect(evaluate(e, { size: 10, sizeCreatedAtZoom: 3 }, 4)).toBeCloseTo(20 / 32, 9);
    });

    it('fills in the base default when the size is absent', () => {
        const e = zoomScaledExpression(TEXT);
        expect(evaluate(e, { createdAtZoom: 5 }, 6)).toBe(32);
    });
});

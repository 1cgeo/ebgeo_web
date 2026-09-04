// Path: tests/unit/coordination-line-width-expression.test.js

/**
 * The coordination line's stroke width, drawn by a style expression, against the
 * JavaScript model it replaced.
 *
 * WHERE THE EVALUATOR COMES FROM, because it decides what this file is worth.
 * The main branch compiles the expression with `@maplibre/maplibre-gl-style-spec`,
 * the package `maplibre-gl` itself depends on. THIS branch has no such package:
 * MapLibre is the vendored browser bundle at `public/vendors/maplibre-gl.js`,
 * loaded by a `<script>` tag, and it exports the `Map` class and nothing of the
 * expression compiler. So the evaluator is `tests/helpers/maplibre-expression.js`,
 * whose arithmetic was TRANSCRIBED out of that same vendored bundle, function by
 * function (`interpolationFactor`, the number interpolation, the below-first-stop
 * and above-last-stop rules, the assertion semantics). The first `describe` below
 * exercises the evaluator itself against numbers computed by hand, so a bug in it
 * shows up as a failure here and not as a false pass downstream.
 *
 * THE MAP IS STILL THE LAST WORD, and it is consulted: the browser check of this
 * change reads `line-width` off the real `coordination-line-layer` in Chromium
 * after a zoom, which is the only place MapLibre's own parser runs.
 *
 * ONE documented exception to exactness, the same one the header of
 * `src/js/layers/styles/zoom-expression.js` states. The `MAX_LINE_WIDTH_PX`
 * ceiling lives inside each stop value, so where BOTH integer stops bracketing a
 * zoom are already clamped the interpolation is the ceiling, and where NEITHER
 * is it reproduces the exponential exactly; only inside the single zoom level
 * where the ceiling starts to bite does the straight interpolation ride above
 * the hard `min`, bounded by the two stop values. That band is checked for the
 * bound instead of for equality, and integer zooms are always checked exactly,
 * because an interpolate returns its stop value verbatim there.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    buildCoordinationLineWidthExpression,
    computeCoordinationLineZoomSizes,
    COORDINATION_LINE_ZOOM_DEFAULTS,
    COORDINATION_LINE_ZOOM_LIMITS,
} from '@tools/helpers/coordination-line-zoom.model.js';
import { zoomScaledExpression, ZOOM_STOPS } from '@layers/styles/zoom-expression.js';
import { compileExpression } from '../helpers/maplibre-expression.js';

const MAX = COORDINATION_LINE_ZOOM_LIMITS.MAX_LINE_WIDTH_PX;
const LAST_STOP = ZOOM_STOPS[ZOOM_STOPS.length - 1];
const TOLERANCE = 1e-9;

/** Zooms 0 to 24 in steps of 0.25, built from integers so nothing drifts. */
const GRID = Array.from({ length: 4 * LAST_STOP + 1 }, (_, i) => i / 4);

/**
 * @param {Array} expression - MapLibre expression
 * @returns {Function} `(properties, zoom) => number`
 */
const compile = (expression) => compileExpression(expression);

/**
 * @param {Object} properties - Feature properties
 * @param {number} zoom - Map zoom
 * @returns {number} What the JavaScript model says the stroke width is
 */
function expectedAt(properties, zoom) {
    return computeCoordinationLineZoomSizes(properties, zoom).calculatedLineWidth;
}

/**
 * The two integer stop values bracketing a zoom.
 * @param {Object} properties - Feature properties
 * @param {number} zoom - Map zoom
 * @returns {number[]} `[low, high]`
 */
function bracketingStops(properties, zoom) {
    const low = Math.floor(zoom);
    const high = Math.min(LAST_STOP, low + 1);
    return [expectedAt(properties, low), expectedAt(properties, high)];
}

/**
 * The one zoom level where the ceiling starts to bite: exactly one of the two
 * bracketing stops is clamped. See the exception in this file's header.
 * @param {Object} properties - Feature properties
 * @param {number} zoom - Map zoom
 * @returns {boolean} True inside that band
 */
function insideClampBand(properties, zoom) {
    if (Number.isInteger(zoom)) return false;
    const [low, high] = bracketingStops(properties, zoom);
    return (low === MAX) !== (high === MAX);
}

/**
 * Walk the grid and return the first zoom where the expression and the model
 * disagree, or `null` when they never do.
 * @param {Function} evaluate - Compiled expression evaluator
 * @param {Object} properties - Feature properties
 * @returns {?Object} `{zoom, expected, got, band}`
 */
function firstMismatch(evaluate, properties) {
    for (const zoom of GRID) {
        const expected = expectedAt(properties, zoom);
        const got = evaluate(properties, zoom);

        if (insideClampBand(properties, zoom)) {
            const [low, high] = bracketingStops(properties, zoom);
            const floor = Math.min(low, high) - TOLERANCE;
            const ceiling = Math.max(low, high) + TOLERANCE;
            if (got >= floor && got <= ceiling && got <= MAX + TOLERANCE) continue;
            return { zoom, expected, got, band: true };
        }

        if (Math.abs(got - expected) <= TOLERANCE * Math.max(1, Math.abs(expected))) continue;
        return { zoom, expected, got, band: false };
    }
    return null;
}

/**
 * Every rule of the model, one case each. `lineWidth` 0.05 exists so that most
 * of the grid sits BELOW the ceiling: with the authored default the clamp bites
 * from zoom 12 up and the exact half of the check would barely be exercised.
 */
const CASES = [
    { label: 'anchored at 8, below the ceiling almost everywhere', properties: { lineWidth: 0.05, createdAtZoom: 8 } },
    { label: 'anchored at 8, ceiling from zoom 12 up', properties: { lineWidth: 4, createdAtZoom: 8, zoomCorrectionEnabled: true } },
    { label: 'anchored at 12.3, the one-decimal anchor the tool stamps', properties: { lineWidth: 0.3, createdAtZoom: 12.3 } },
    { label: 'anchored at 16', properties: { lineWidth: 6, createdAtZoom: 16 } },
    { label: 'no anchor property at all', properties: { lineWidth: 4 } },
    { label: 'anchor 0, the never-anchored sentinel', properties: { lineWidth: 4, createdAtZoom: 0 } },
    { label: 'anchor NaN', properties: { lineWidth: 4, createdAtZoom: NaN } },
    { label: 'anchor as a string', properties: { lineWidth: 4, createdAtZoom: '12' } },
    { label: 'correction switched off', properties: { lineWidth: 4, createdAtZoom: 12, zoomCorrectionEnabled: false } },
    { label: 'correction off, authored width above the ceiling', properties: { lineWidth: 100, createdAtZoom: 12, zoomCorrectionEnabled: false } },
    { label: 'width absent', properties: { createdAtZoom: 10 } },
    { label: 'width 0', properties: { lineWidth: 0, createdAtZoom: 10 } },
    { label: 'width negative', properties: { lineWidth: -4, createdAtZoom: 10 } },
    { label: 'width 80 anchored at 4, clamped over most of the range', properties: { lineWidth: 80, createdAtZoom: 4 } },
];

const caseNamed = (label) => CASES.find(entry => entry.label === label).properties;

// ============================================================================
// THE EVALUATOR ITSELF, before anything is measured with it
// ============================================================================

describe('the evaluator this file measures with', () => {
    it('reproduces an exponential interpolate by hand, stops and between them', () => {
        // Two stops one zoom level apart, base 2. The factor of an
        // exponential-base-2 interpolation over a unit interval is
        // `2^(zoom - lower) - 1`, so `a + (b - a) * (2^t - 1)` with `b = 2a`
        // collapses to `a * 2^t`. Written out here with plain numbers.
        const curve = compile(['interpolate', ['exponential', 2], ['zoom'], 8, 4, 9, 8]);

        expect(curve({}, 8)).toBe(4);
        expect(curve({}, 9)).toBe(8);
        expect(curve({}, 8.5)).toBeCloseTo(4 * Math.SQRT2, 12);
        expect(curve({}, 8.25)).toBeCloseTo(4 * 2 ** 0.25, 12);
        // Outside the stops an interpolate holds the end value; it does NOT
        // extrapolate, which is the whole reason the builder emits 25 stops.
        expect(curve({}, 3)).toBe(4);
        expect(curve({}, 20)).toBe(8);
    });

    it('reproduces a LINEAR interpolate, which the exponential must not be confused with', () => {
        // Same stops, linear: the midpoint is the arithmetic mean, 6, and NOT
        // the 5.657 the base-2 curve gives. An evaluator that ignored the
        // interpolation type would answer the same number for both.
        const linear = compile(['interpolate', ['linear'], ['zoom'], 8, 4, 9, 8]);
        expect(linear({}, 8.5)).toBe(6);
        expect(compile(['interpolate', ['exponential', 2], ['zoom'], 8, 4, 9, 8])({}, 8.5))
            .not.toBeCloseTo(6, 6);
    });

    it('reads properties, asserts types and short-circuits the way MapLibre does', () => {
        expect(compile(['number', ['get', 'w'], 0])({ w: 7 })).toBe(7);
        expect(compile(['number', ['get', 'w'], 0])({ w: 'sete' })).toBe(0);
        expect(compile(['number', ['get', 'w'], 0])({})).toBe(0);
        expect(compile(['case', ['==', ['get', 'on'], false], 'off', 'on'])({ on: false })).toBe('off');
        expect(compile(['case', ['==', ['get', 'on'], false], 'off', 'on'])({})).toBe('on');
        expect(compile(['min', 3, ['*', 2, 4]])({})).toBe(3);
        expect(compile(['^', 2, -1.5])({})).toBeCloseTo(2 ** -1.5, 12);
        expect(compile(['coalesce', ['get', 'a'], ['get', 'b'], 9])({ b: 5 })).toBe(5);
    });

    it('refuses an operator it does not know, instead of inventing a number', () => {
        // The failure mode a silent evaluator would have: approving a style that
        // draws nothing because it never understood half of it.
        expect(() => compile(['rgb', 1, 2, 3])({})).toThrow(/unsupported operator/);
    });
});

describe('buildCoordinationLineWidthExpression: shape', () => {
    it('is a top-level exponential base-2 interpolate on zoom, over the integer stops', () => {
        const expression = buildCoordinationLineWidthExpression();
        expect(expression[0]).toBe('interpolate');
        expect(expression[1]).toEqual(['exponential', 2]);
        expect(expression[2]).toEqual(['zoom']);
        expect(expression.slice(3).filter((_, i) => i % 2 === 0)).toEqual([...ZOOM_STOPS]);
    });

    it('names only operators that appear in the vendored MapLibre bundle', () => {
        // The bundle is the contract, not the upstream docs: this branch ships
        // MapLibre 5.18 as a file, and an operator a later version added would
        // paint NOTHING here, silently. This is a name check and not a semantic
        // one, so it can pass an operator that exists with another signature; the
        // browser is where the expression is compiled for real.
        //
        // In the minified bundle the registry keys are quoted for the symbolic
        // operators (`"^":`) and bare identifiers for the word ones (`min:`), so
        // both forms are accepted.
        const bundle = readFileSync(
            new URL('../../public/vendors/maplibre-gl.js', import.meta.url), 'utf8',
        );
        const mentions = (name) => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`"${escaped}"|[{,;(]\\s*${escaped}\\s*:`).test(bundle);
        };

        const used = new Set();
        const walk = (node) => {
            if (!Array.isArray(node)) return;
            if (typeof node[0] === 'string') used.add(node[0]);
            node.forEach(walk);
        };
        walk(buildCoordinationLineWidthExpression());

        expect(used.size).toBeGreaterThan(5);
        for (const name of used) {
            expect(mentions(name), name).toBe(true);
        }

        // The check reproves what it exists to catch: an operator no MapLibre
        // has. Without this line a `mentions` that always answered true would
        // pass the loop above and prove nothing.
        expect(mentions('interpolate-hcl-zzz')).toBe(false);
    });
});

describe('buildCoordinationLineWidthExpression: value against the model', () => {
    const evaluate = compile(buildCoordinationLineWidthExpression());

    it.each(CASES)('$label', ({ properties }) => {
        expect(firstMismatch(evaluate, properties)).toBeNull();
    });

    it('the grid really visits the exact half and the clamped half', () => {
        // The exception in the header is an exception, not the rule: if nearly
        // the whole grid fell inside a clamp band, the loose bound would be
        // doing all the work and the exactness claim would go unchecked.
        const small = caseNamed('anchored at 8, below the ceiling almost everywhere');
        const clamped = caseNamed('width 80 anchored at 4, clamped over most of the range');
        const saturated = caseNamed('correction off, authored width above the ceiling');

        expect(GRID).toHaveLength(97);
        // A band is one zoom level wide, so it can hold at most the three
        // non-integer grid points inside that level.
        expect(GRID.filter(zoom => insideClampBand(small, zoom)).length).toBeLessThanOrEqual(3);
        expect(GRID.filter(zoom => expectedAt(clamped, zoom) === MAX).length).toBeGreaterThan(80);
        expect(GRID.every(zoom => expectedAt(saturated, zoom) === MAX)).toBe(true);
    });

    it('reads the named numbers the way the model does', () => {
        // Spot values, so a wholesale sign or base error cannot hide behind the
        // grid comparing the expression with a model that broke the same way.
        expect(evaluate({ lineWidth: 4, createdAtZoom: 8 }, 8)).toBeCloseTo(4, 12);
        expect(evaluate({ lineWidth: 4, createdAtZoom: 8 }, 10)).toBeCloseTo(16, 12);
        expect(evaluate({ lineWidth: 4, createdAtZoom: 8 }, 6.5)).toBeCloseTo(4 * 2 ** -1.5, 12);
        expect(evaluate({ lineWidth: 4, createdAtZoom: 8 }, 20)).toBe(MAX);
        expect(evaluate({}, 12)).toBe(COORDINATION_LINE_ZOOM_DEFAULTS.lineWidth);
    });
});

describe('the grid reproves the expressions it exists to reject', () => {
    it('rejects the plain coalesce this expression replaced', () => {
        // The shape the layer carried until 2026-09-04: a lookup of the property
        // a per-frame JavaScript pass had to keep rewriting.
        const legacy = compile([
            'coalesce',
            ['get', 'calculatedLineWidth'],
            ['get', 'lineWidth'],
            COORDINATION_LINE_ZOOM_DEFAULTS.lineWidth,
        ]);

        // The stale value the pass leaves behind between frames: correct at the
        // anchor, frozen everywhere else.
        const anchored = { lineWidth: 4, createdAtZoom: 8, zoomCorrectionEnabled: true, calculatedLineWidth: 4 };
        const mismatch = firstMismatch(legacy, anchored);
        expect(mismatch).not.toBeNull();
        expect(legacy(anchored, 12)).toBe(4);
        expect(expectedAt(anchored, 12)).toBe(MAX);

        // Every anchored case in the table is caught, not just the one above.
        const anchoredCases = CASES.filter(({ properties }) => properties.createdAtZoom === 8
            || properties.createdAtZoom === 12.3 || properties.createdAtZoom === 16);
        expect(anchoredCases.length).toBeGreaterThan(2);
        for (const { properties } of anchoredCases) {
            expect(firstMismatch(legacy, properties)).not.toBeNull();
        }
    });

    it('rejects the generic builder, on the two axes it cannot express', () => {
        // This is why the expression is written in the model instead of being
        // asked of `zoomScaledExpression`. `anchorDefault: 0` scales from zoom 0
        // when the anchor is missing, and its `coalesce` base takes an authored
        // 0 at face value; the model rejects BOTH as "not a positive number".
        const generic = compile(zoomScaledExpression({
            base: ['coalesce', ['get', 'lineWidth'], COORDINATION_LINE_ZOOM_DEFAULTS.lineWidth],
            anchor: 'createdAtZoom',
            anchorDefault: 0,
            disabledFlag: 'zoomCorrectionEnabled',
            maxValue: MAX,
        }));

        expect(firstMismatch(generic, { lineWidth: 4, createdAtZoom: 0 })).not.toBeNull();
        expect(firstMismatch(generic, { lineWidth: 0, createdAtZoom: 10 })).not.toBeNull();
        // ...and it agrees on the case both builders CAN express, so the two
        // failures above are the rules, not a broken comparison.
        expect(firstMismatch(generic, { lineWidth: 4, createdAtZoom: 8 })).toBeNull();
    });

    it('rejects an expression that drops the ceiling, and one that inverts the exponent', () => {
        const stops = (value) => {
            const expression = ['interpolate', ['exponential', 2], ['zoom']];
            for (const z of ZOOM_STOPS) expression.push(z, value(z));
            return expression;
        };
        const anchor = ['number', ['get', 'createdAtZoom'], 0];

        const unclamped = compile(stops(z => ['*', 4, ['^', 2, ['-', z, anchor]]]));
        expect(firstMismatch(unclamped, { lineWidth: 4, createdAtZoom: 8 })).not.toBeNull();

        const inverted = compile(stops(z => ['min', MAX, ['*', 4, ['^', 2, ['-', anchor, z]]]]));
        expect(firstMismatch(inverted, { lineWidth: 4, createdAtZoom: 8 })).not.toBeNull();
    });
});

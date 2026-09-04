// Path: tests/unit/boundary-zoom-expressions.test.js

/**
 * The boundary's three pixel sizes, drawn by style expressions, against the
 * JavaScript model they replaced.
 *
 * The expressions are compiled and evaluated by MapLibre's OWN parser
 * (`@maplibre/maplibre-gl-style-spec`, the package `maplibre-gl` itself depends
 * on), not by a hand-written evaluator: what is under test is that the map draws
 * the same number `computeBoundaryZoomSizes` computes, so the reference has to
 * be the code the map runs. `createPropertyExpression` is used rather than the
 * looser `createExpression` because it is the call that classifies the result
 * (`composite`, i.e. zoom AND feature) and the one that would REJECT a
 * zoom-and-property function on a property whose spec does not allow one. That
 * matters most for `text-size`, which is a LAYOUT property: its spec entry
 * declares `parameters: ['zoom', 'feature']`, and the assertion below is what
 * holds us to that reading.
 *
 * ONE documented exception to exactness, the same one the header of
 * `src/js/layers/styles/zoom-expression.js` states. Each ceiling lives inside
 * each stop value, so where BOTH integer stops bracketing a zoom are already
 * clamped the interpolation is the ceiling, and where NEITHER is it reproduces
 * the exponential exactly; only inside the single zoom level where the ceiling
 * starts to bite does the straight interpolation ride above the hard `min`,
 * bounded by the two stop values. That band is checked for the bound instead of
 * for equality, and integer zooms are always checked exactly, because an
 * interpolate returns its stop value verbatim there.
 */

import { describe, it, expect } from 'vitest';
import { createPropertyExpression, latest } from '@maplibre/maplibre-gl-style-spec';

import {
    buildBoundaryLineWidthExpression,
    buildBoundaryTextSizeExpression,
    buildBoundaryCircleStrokeExpression,
    computeBoundaryZoomSizes,
    BOUNDARY_ZOOM_DEFAULTS,
    BOUNDARY_ZOOM_LIMITS,
} from '../../src/js/military_tools/boundary_tool/boundary-zoom.model.js';
import { zoomScaledExpression, ZOOM_STOPS } from '../../src/js/layers/styles/zoom-expression.js';

const LAST_STOP = ZOOM_STOPS[ZOOM_STOPS.length - 1];
const TOLERANCE = 1e-9;

/** Zooms 0 to 24 in steps of 0.25, built from integers so nothing drifts. */
const GRID = Array.from({ length: 4 * LAST_STOP + 1 }, (_, i) => i / 4);

/**
 * Compile through MapLibre and return an evaluator.
 * @param {Array} expression - MapLibre expression
 * @param {string} rootKey - Style property name
 * @param {Object} propertySpec - Entry of the style spec to validate against
 * @returns {{evaluate: Function, kind: string}} Evaluator and expression kind
 */
function compile(expression, rootKey, propertySpec) {
    const compiled = createPropertyExpression(expression, rootKey, propertySpec);
    if (compiled.result === 'error') {
        throw new Error(`MapLibre rejected ${rootKey}: ${JSON.stringify(compiled.value.map(String))}`);
    }
    return {
        kind: compiled.value.kind,
        evaluate: (properties, zoom) => compiled.value.evaluate({ zoom }, { properties }),
    };
}

/**
 * Every rule of the model, one case each, sized against the quantity's own
 * ceiling. The small base exists so that most of the grid sits BELOW the
 * ceiling: with a base near the default the clamp bites early and the exact half
 * of the check would barely be exercised.
 *
 * @param {string} property - Authored size property
 * @param {number} def - Model default for that property
 * @param {number} max - Ceiling for that property
 * @returns {Array<{label: string, properties: Object}>} The case table
 */
function casesFor(property, def, max) {
    return [
        { label: 'anchored at 8, below the ceiling almost everywhere', properties: { [property]: 0.05, createdAtZoom: 8 } },
        { label: 'anchored at 8, ceiling biting inside the grid', properties: { [property]: max / 16, createdAtZoom: 8, zoomCorrectionEnabled: true } },
        { label: 'anchored at 12.3, the one-decimal anchor the tool stamps', properties: { [property]: 0.3, createdAtZoom: 12.3 } },
        { label: 'anchored at 16', properties: { [property]: max / 10, createdAtZoom: 16 } },
        { label: 'no anchor property at all', properties: { [property]: def } },
        { label: 'anchor 0, the never-anchored sentinel', properties: { [property]: def, createdAtZoom: 0 } },
        { label: 'anchor NaN', properties: { [property]: def, createdAtZoom: NaN } },
        { label: 'anchor as a string', properties: { [property]: def, createdAtZoom: '12' } },
        { label: 'correction switched off', properties: { [property]: def, createdAtZoom: 12, zoomCorrectionEnabled: false } },
        { label: 'correction off, authored size above the ceiling', properties: { [property]: max * 2, createdAtZoom: 12, zoomCorrectionEnabled: false } },
        { label: 'size absent', properties: { createdAtZoom: 10 } },
        { label: 'size 0', properties: { [property]: 0, createdAtZoom: 10 } },
        { label: 'size negative', properties: { [property]: -4, createdAtZoom: 10 } },
        { label: 'size above the ceiling anchored at 4, clamped over most of the range', properties: { [property]: max * 1.5, createdAtZoom: 4 } },
    ];
}

/**
 * The three quantities, each with the style property it feeds, the model key it
 * has to reproduce, and the `coalesce` lookup it replaced on 2026-09-04.
 */
const QUANTITIES = [
    {
        label: 'line width',
        build: buildBoundaryLineWidthExpression,
        property: 'lineWidth',
        derived: 'calculatedLineWidth',
        rootKey: 'line-width',
        spec: latest.paint_line['line-width'],
        def: BOUNDARY_ZOOM_DEFAULTS.lineWidth,
        max: BOUNDARY_ZOOM_LIMITS.MAX_LINE_WIDTH_PX,
        legacy: ['coalesce', ['get', 'calculatedLineWidth'], ['get', 'lineWidth'], BOUNDARY_ZOOM_DEFAULTS.lineWidth],
    },
    {
        label: 'text size',
        build: buildBoundaryTextSizeExpression,
        property: 'text_size',
        derived: 'calculatedTextSize',
        rootKey: 'text-size',
        spec: latest.layout_symbol['text-size'],
        def: BOUNDARY_ZOOM_DEFAULTS.textSize,
        max: BOUNDARY_ZOOM_LIMITS.MAX_TEXT_SIZE_PX,
        legacy: ['coalesce', ['get', 'calculatedTextSize'], ['get', 'text_size'], 14],
    },
    {
        label: 'circle stroke width',
        build: buildBoundaryCircleStrokeExpression,
        property: 'strokeWidth',
        derived: 'calculatedStrokeWidth',
        // `boundary-circles-stroke-layer` is a LINE layer tracing the circle
        // polygons, so the expression really lands on `line-width`; the
        // `circle-stroke-width` spec is checked too, in the shape block below,
        // because that is the name the quantity carries everywhere else.
        rootKey: 'line-width',
        spec: latest.paint_line['line-width'],
        def: BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth,
        max: BOUNDARY_ZOOM_LIMITS.MAX_CIRCLE_STROKE_PX,
        legacy: ['coalesce', ['get', 'calculatedStrokeWidth'], BOUNDARY_ZOOM_DEFAULTS.circleStrokeWidth],
    },
];

/**
 * @param {Object} quantity - Entry of QUANTITIES
 * @param {Object} properties - Feature properties
 * @param {number} zoom - Map zoom
 * @returns {number} What the JavaScript model says the size is
 */
function expectedAt(quantity, properties, zoom) {
    return computeBoundaryZoomSizes(properties, zoom)[quantity.derived];
}

/**
 * The two integer stop values bracketing a zoom.
 * @param {Object} quantity - Entry of QUANTITIES
 * @param {Object} properties - Feature properties
 * @param {number} zoom - Map zoom
 * @returns {number[]} `[low, high]`
 */
function bracketingStops(quantity, properties, zoom) {
    const low = Math.floor(zoom);
    const high = Math.min(LAST_STOP, low + 1);
    return [expectedAt(quantity, properties, low), expectedAt(quantity, properties, high)];
}

/**
 * The one zoom level where the ceiling starts to bite: exactly one of the two
 * bracketing stops is clamped. See the exception in this file's header.
 * @param {Object} quantity - Entry of QUANTITIES
 * @param {Object} properties - Feature properties
 * @param {number} zoom - Map zoom
 * @returns {boolean} True inside that band
 */
function insideClampBand(quantity, properties, zoom) {
    if (Number.isInteger(zoom)) return false;
    const [low, high] = bracketingStops(quantity, properties, zoom);
    return (low === quantity.max) !== (high === quantity.max);
}

/**
 * Walk the grid and return the first zoom where the expression and the model
 * disagree, or `null` when they never do.
 * @param {Object} quantity - Entry of QUANTITIES
 * @param {Function} evaluate - Compiled expression evaluator
 * @param {Object} properties - Feature properties
 * @returns {?Object} `{zoom, expected, got, band}`
 */
function firstMismatch(quantity, evaluate, properties) {
    for (const zoom of GRID) {
        const expected = expectedAt(quantity, properties, zoom);
        const got = evaluate(properties, zoom);

        if (insideClampBand(quantity, properties, zoom)) {
            const [low, high] = bracketingStops(quantity, properties, zoom);
            const floor = Math.min(low, high) - TOLERANCE;
            const ceiling = Math.max(low, high) + TOLERANCE;
            if (got >= floor && got <= ceiling && got <= quantity.max + TOLERANCE) continue;
            return { zoom, expected, got, band: true };
        }

        if (Math.abs(got - expected) <= TOLERANCE * Math.max(1, Math.abs(expected))) continue;
        return { zoom, expected, got, band: false };
    }
    return null;
}

describe.each(QUANTITIES)('the boundary $label expression', (quantity) => {
    const CASES = casesFor(quantity.property, quantity.def, quantity.max);
    const caseNamed = (label) => CASES.find(entry => entry.label === label).properties;

    describe('shape', () => {
        it(`is what MapLibre accepts for ${quantity.rootKey}, as a composite expression`, () => {
            const compiled = createPropertyExpression(quantity.build(), quantity.rootKey, quantity.spec);
            expect(compiled.result).toBe('success');
            // `composite` is the classification that says "reads the zoom AND the
            // feature". A property whose spec forbade one of the two would land
            // in the error branch above instead.
            expect(compiled.value.kind).toBe('composite');
        });

        it('is a top-level exponential base-2 interpolate on zoom, over the integer stops', () => {
            const expression = quantity.build();
            expect(expression[0]).toBe('interpolate');
            expect(expression[1]).toEqual(['exponential', 2]);
            expect(expression[2]).toEqual(['zoom']);
            expect(expression.slice(3).filter((_, i) => i % 2 === 0)).toEqual([...ZOOM_STOPS]);
        });

        it('never reads the derived property the JavaScript pass used to write', () => {
            expect(JSON.stringify(quantity.build())).not.toContain(quantity.derived);
        });

        it('returns a fresh array each call (layers must not share a mutable literal)', () => {
            const a = quantity.build();
            const b = quantity.build();
            expect(a).toEqual(b);
            expect(a).not.toBe(b);
        });
    });

    describe('value against the model', () => {
        const { evaluate } = compile(quantity.build(), quantity.rootKey, quantity.spec);

        it.each(CASES)('$label', ({ properties }) => {
            expect(firstMismatch(quantity, evaluate, properties)).toBeNull();
        });

        it('the grid really visits the exact half and the clamped half', () => {
            // The exception in the header is an exception, not the rule: if nearly
            // the whole grid fell inside a clamp band, the loose bound would be
            // doing all the work and the exactness claim would go unchecked.
            const small = caseNamed('anchored at 8, below the ceiling almost everywhere');
            const clamped = caseNamed('size above the ceiling anchored at 4, clamped over most of the range');
            const saturated = caseNamed('correction off, authored size above the ceiling');

            expect(GRID).toHaveLength(97);
            // A band is one zoom level wide, so it can hold at most the three
            // non-integer grid points inside that level.
            expect(GRID.filter(zoom => insideClampBand(quantity, small, zoom)).length).toBeLessThanOrEqual(3);
            expect(GRID.filter(zoom => expectedAt(quantity, small, zoom) < quantity.max).length).toBeGreaterThan(70);
            expect(GRID.filter(zoom => expectedAt(quantity, clamped, zoom) === quantity.max).length).toBeGreaterThan(80);
            expect(GRID.every(zoom => expectedAt(quantity, saturated, zoom) === quantity.max)).toBe(true);
        });

        it('reads the named numbers the way the model does', () => {
            // Spot values, so a wholesale sign or base error cannot hide behind the
            // grid comparing the expression with a model that broke the same way.
            const { property, def, max } = quantity;
            const anchored = (size) => ({ [property]: size, createdAtZoom: 8 });

            expect(evaluate(anchored(0.05), 8)).toBeCloseTo(0.05, 12);
            expect(evaluate(anchored(0.05), 10)).toBeCloseTo(0.2, 12);
            expect(evaluate(anchored(0.05), 6.5)).toBeCloseTo(0.05 * 2 ** -1.5, 12);
            expect(evaluate(anchored(max), 20)).toBe(max);
            expect(evaluate({}, 12)).toBe(Math.min(def, max));
        });
    });

    describe('the grid reproves the expressions it exists to reject', () => {
        it('rejects the plain coalesce this expression replaced', () => {
            // The shape the layer carried until 2026-09-04: a lookup of the
            // property a per-frame JavaScript pass had to keep rewriting.
            const { evaluate: legacy } = compile(quantity.legacy, quantity.rootKey, quantity.spec);

            // The stale value the pass leaves behind between frames: correct at
            // the anchor, frozen everywhere else.
            const anchored = {
                [quantity.property]: quantity.def,
                createdAtZoom: 8,
                zoomCorrectionEnabled: true,
                [quantity.derived]: quantity.def,
            };
            expect(firstMismatch(quantity, legacy, anchored)).not.toBeNull();
            expect(legacy(anchored, 12)).toBe(quantity.def);
            expect(expectedAt(quantity, anchored, 12)).toBe(Math.min(quantity.def * 16, quantity.max));

            // And nine of the fourteen cases in the table, not just that one. The
            // five it survives are the ones with no scaling to get wrong (no
            // anchor, the zero sentinel, a bad anchor, correction off), which is
            // exactly why the old shape looked right until the map zoomed.
            const caught = CASES.filter(({ properties }) => firstMismatch(quantity, legacy, properties) !== null);
            expect(caught).toHaveLength(9);
        });

        it('rejects the generic builder, on the two axes it cannot express', () => {
            // This is why the expression is written in the model instead of being
            // asked of `zoomScaledExpression`. `anchorDefault: 0` scales from zoom
            // 0 when the anchor is missing, and its `coalesce` base takes an
            // authored 0 at face value; the model rejects BOTH as "not a positive
            // number".
            const { evaluate: generic } = compile(zoomScaledExpression({
                base: ['coalesce', ['get', quantity.property], quantity.def],
                anchor: 'createdAtZoom',
                anchorDefault: 0,
                disabledFlag: 'zoomCorrectionEnabled',
                maxValue: quantity.max,
            }), quantity.rootKey, quantity.spec);

            expect(firstMismatch(quantity, generic, { [quantity.property]: quantity.def, createdAtZoom: 0 })).not.toBeNull();
            expect(firstMismatch(quantity, generic, { [quantity.property]: 0, createdAtZoom: 10 })).not.toBeNull();
            // ...and it agrees on the case both builders CAN express, so the two
            // failures above are the rules, not a broken comparison.
            expect(firstMismatch(quantity, generic, { [quantity.property]: 0.05, createdAtZoom: 8 })).toBeNull();
        });

        it('rejects an expression that drops the ceiling, and one that inverts the exponent', () => {
            const stops = (value) => {
                const expression = ['interpolate', ['exponential', 2], ['zoom']];
                for (const z of ZOOM_STOPS) expression.push(z, value(z));
                return expression;
            };
            const anchor = ['number', ['get', 'createdAtZoom'], 0];
            const anchored = { [quantity.property]: quantity.def, createdAtZoom: 8 };

            const unclamped = compile(
                stops(z => ['*', quantity.def, ['^', 2, ['-', z, anchor]]]), quantity.rootKey, quantity.spec,
            );
            expect(firstMismatch(quantity, unclamped.evaluate, anchored)).not.toBeNull();

            const inverted = compile(
                stops(z => ['min', quantity.max, ['*', quantity.def, ['^', 2, ['-', anchor, z]]]]),
                quantity.rootKey, quantity.spec,
            );
            expect(firstMismatch(quantity, inverted.evaluate, anchored)).not.toBeNull();
        });
    });
});

describe('the three expressions are the three quantities, not one repeated', () => {
    it('carries each quantity own base property, default and ceiling', () => {
        for (const quantity of QUANTITIES) {
            const text = JSON.stringify(quantity.build());
            expect(text).toContain(`"${quantity.property}"`);
            expect(text).toContain(String(quantity.max));
            for (const other of QUANTITIES) {
                if (other.property === quantity.property) continue;
                expect(text).not.toContain(`"${other.property}"`);
            }
        }
    });

    it('the circle stroke is also legal as a real circle-stroke-width', () => {
        // The quantity is named after `circle-stroke-width` everywhere in the
        // model and in the JavaScript pass, even though the layer that draws it
        // traces the circle outlines with a `line` layer. If it ever moves to a
        // circle layer, the expression has to survive the move.
        const compiled = createPropertyExpression(
            buildBoundaryCircleStrokeExpression(),
            'circle-stroke-width',
            latest.paint_circle['circle-stroke-width'],
        );
        expect(compiled.result).toBe('success');
        expect(compiled.value.kind).toBe('composite');
    });
});

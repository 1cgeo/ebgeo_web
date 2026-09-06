// Path: tests/unit/hit-test.model.test.js

/**
 * The pure hit-test model: the numbers that decide what a click selected.
 *
 * The `icon-size` half of this file is checked against MapLibre's OWN expression
 * parser (`@maplibre/maplibre-gl-style-spec`, the package `maplibre-gl` itself
 * depends on), compiled with `createPropertyExpression` against the real
 * `icon-size` spec, exactly as `boundary-zoom-expressions.test.js` does. What is
 * under test is that the model reconstructs the size the MAP DREW, so the
 * reference has to be the code the map runs — a hand-written twin would only
 * prove the twin agrees with itself.
 *
 * Unlike `computeBoundaryZoomSizes`, this model puts the ceiling INSIDE each
 * stop value and interpolates afterwards, which is what the expression does too.
 * There is therefore no "clamp band" exception here: the agreement is exact at
 * every zoom, and the clamp band is asserted as an equality like everything else.
 *
 * Two deliberate divergences from the expression are pinned below rather than
 * hidden:
 *   - `createdAtZoom: NaN` makes the expression collapse to the STYLE DEFAULT
 *     (`icon-size` 1) while the model returns the base. `createdAtZoom` is
 *     always written from `map.getZoom()`, so NaN cannot occur; falling back to
 *     the authored base beats falling back to a size the feature never had.
 *   - `size: 0` is kept by the expression's `coalesce` but replaced by the
 *     layer default in `iconSizeForFeature`. A zero-size icon draws nothing and
 *     has no rectangle to hit-test.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createPropertyExpression, latest } from '@maplibre/maplibre-gl-style-spec';

import { zoomScaledExpression } from '../../src/js/layers/styles/zoom-expression.js';
import {
    CLICK_TOLERANCE_PX,
    TOUCH_CLICK_TOLERANCE_PX,
    EXACT_ICON_LAYER_IDS,
    ICON_SIZE_RULES,
    HIT_CLASS,
    hitClassOf,
    toleranceBox,
    evaluateZoomScaledSize,
    iconSizeForFeature,
    iconScreenQuad,
    parseIconOffset,
    pointInConvexQuad,
    perspectiveRatio,
    projectedW,
    lngLatToMercator,
    needsExactHit,
    resolveExactHits,
    pickPreferredHits,
} from '../../src/js/tool_manager/helpers/hit-test.model.js';

const TOLERANCE = 1e-9;

/**
 * Compile one `zoomScaledExpression` through MapLibre's own parser.
 * @param {Object} spec - Spec accepted by `zoomScaledExpression`
 * @returns {{kind: string, evaluate: Function}} Kind and evaluator
 */
function compileIconSize(spec) {
    const compiled = createPropertyExpression(
        zoomScaledExpression(spec),
        'icon-size',
        latest.layout_symbol['icon-size'],
    );
    if (compiled.result === 'error') {
        throw new Error(`MapLibre rejected icon-size: ${JSON.stringify(compiled.value.map(String))}`);
    }
    return {
        kind: compiled.value.kind,
        evaluate: (properties, zoom) => compiled.value.evaluate({ zoom }, { properties }),
    };
}

const IMAGE_SPEC = {
    base: ['coalesce', ['get', 'size'], 1],
    anchor: 'createdAtZoom',
    disabledFlag: 'zoomCorrectionEnabled',
    maxValue: 10,
};

const DECLINATION_SPEC = {
    base: ['coalesce', ['get', 'size'], 0.6],
    anchor: 'createdAtZoom',
    disabledFlag: 'zoomCorrectionEnabled',
    maxValue: 10,
};

/**
 * The point marker's spec, copied field for field from `POINT_SIZE` in
 * `layers/styles/point.layers.js` plus the `divideBy: POINT_IMAGE_HALF_SIZE`
 * the marker layer adds (`icon-size` is a factor over the bitmap's own CSS
 * size, and the bitmaps are 96 px at `pixelRatio` 2, i.e. 48 CSS px, while
 * `size` is a radius in pixels — so 24).
 *
 * It differs from the pictures' spec in EVERY field, which is the whole reason
 * `ICON_SIZE_RULES` names its properties instead of assuming them.
 */
const MARKER_SPEC = {
    base: ['coalesce', ['get', 'size'], 10],
    anchor: 'sizeCreatedAtZoom',
    anchorDefault: 0,
    disabledFlag: 'sizeZoomCorrectionEnabled',
    maxValue: 500,
    divideBy: 24,
};

/**
 * @param {number} got - Model value
 * @param {number} expected - Expression value
 * @returns {boolean} True when the two agree to the relative tolerance
 */
function agrees(got, expected) {
    return Math.abs(got - expected) <= TOLERANCE * Math.max(1, Math.abs(expected));
}

describe('constants', () => {
    it('gives a coarse pointer twice the slack of a fine one', () => {
        expect(CLICK_TOLERANCE_PX).toBe(6);
        expect(TOUCH_CLICK_TOLERANCE_PX).toBe(12);
        expect(TOUCH_CLICK_TOLERANCE_PX).toBeGreaterThan(CLICK_TOLERANCE_PX);
    });

    it('has a size rule for every layer hit-tested against its exact rectangle', () => {
        for (const layerId of EXACT_ICON_LAYER_IDS) {
            expect(ICON_SIZE_RULES[layerId]).toBeDefined();
        }
        expect(Object.keys(ICON_SIZE_RULES).sort()).toEqual([...EXACT_ICON_LAYER_IDS].sort());
        expect(ICON_SIZE_RULES['magnetic-declinations-layer'].baseDefault).toBe(0.6);
    });

    // The point marker joined the four picture layers: its rectangle is rebuilt
    // here too, which is what makes its rows DECISIVE in `isDecisiveHit`.
    it('rebuilds the rectangle of the four pictures AND of the point marker', () => {
        expect([...EXACT_ICON_LAYER_IDS]).toEqual([
            'image-layer',
            'military-symbols-layer',
            'coordination-measures-layer',
            'magnetic-declinations-layer',
            'point-marker-layer',
        ]);
    });

    // Every field of the marker spec differs from the pictures' — that is why
    // the rule table names the properties instead of assuming them.
    it('mirrors POINT_SIZE for the point marker, divisor included', () => {
        expect(ICON_SIZE_RULES['point-marker-layer']).toEqual({
            sizeProp: 'size',
            baseDefault: 10,
            anchorProp: 'sizeCreatedAtZoom',
            anchorDefault: 0,
            enabledProp: 'sizeZoomCorrectionEnabled',
            maxValue: 500,
            divideBy: 24,
            rotates: false,
            anchored: false,
            offset: false,
            tolerant: true,
        });
    });

    it.each([
        ['image-layer', 'size', 'createdAtZoom', 'zoomCorrectionEnabled'],
        ['military-symbols-layer', 'size', 'createdAtZoom', 'zoomCorrectionEnabled'],
        ['coordination-measures-layer', 'size', 'createdAtZoom', 'zoomCorrectionEnabled'],
        ['magnetic-declinations-layer', 'size', 'createdAtZoom', 'zoomCorrectionEnabled'],
    ])('%s reads %s / %s / %s, undivided and with no anchor reference', (layerId, sizeProp, anchorProp, enabledProp) => {
        const rule = ICON_SIZE_RULES[layerId];
        expect(rule.sizeProp).toBe(sizeProp);
        expect(rule.anchorProp).toBe(anchorProp);
        expect(rule.enabledProp).toBe(enabledProp);
        // `null`, not 0: a non-numeric anchor keeps the base instead of
        // anchoring the scaling at zoom 0.
        expect(rule.anchorDefault).toBeNull();
        expect(rule.divideBy).toBe(1);
        expect(rule.maxValue).toBe(10);
    });

    // Slack is for THIN things. A marker stands in for a point; a picture is
    // drawn at whatever size the user chose and is hit exactly.
    it.each([
        ['image-layer', false],
        ['military-symbols-layer', false],
        ['coordination-measures-layer', false],
        ['magnetic-declinations-layer', false],
        ['point-marker-layer', true],
    ])('%s: tolerant=%s', (layerId, tolerant) => {
        expect(ICON_SIZE_RULES[layerId].tolerant).toBe(tolerant);
    });

    // A property the LAYER does not read must not shape the rectangle either:
    // the declination layer has no `icon-rotate`, so a `rotation` on the feature
    // is dead data, and only the coordination measures read `icon-anchor`.
    it.each([
        ['image-layer', true, false],
        ['military-symbols-layer', true, false],
        ['coordination-measures-layer', true, true],
        ['magnetic-declinations-layer', false, false],
        // `point-marker-layer` declares neither `icon-rotate` nor `icon-anchor`.
        ['point-marker-layer', false, false],
    ])('%s: rotates=%s, anchored=%s', (layerId, rotates, anchored) => {
        expect(ICON_SIZE_RULES[layerId].rotates).toBe(rotates);
        expect(ICON_SIZE_RULES[layerId].anchored).toBe(anchored);
    });

    // Only `coordination-measures-layer` declares an `icon-offset`
    // (`layers/styles/icon-offset.expression.js`), so an `iconOffset` sitting on
    // a feature of any OTHER layer is dead data and must not move its rectangle.
    it.each([
        ['image-layer', false],
        ['military-symbols-layer', false],
        ['coordination-measures-layer', true],
        ['magnetic-declinations-layer', false],
        ['point-marker-layer', false],
    ])('%s: offset=%s', (layerId, offset) => {
        expect(ICON_SIZE_RULES[layerId].offset).toBe(offset);
    });
});

describe('evaluateZoomScaledSize against the compiled icon-size expression', () => {
    const image = compileIconSize(IMAGE_SPEC);

    it('compiles as a composite (zoom AND feature) expression', () => {
        expect(image.kind).toBe('composite');
    });

    it('matches the expression for every base, anchor, zoom and flag (property test)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 24, noNaN: true }),
                fc.double({ min: 0.05, max: 20, noNaN: true }),
                fc.double({ min: 0, max: 24, noNaN: true }),
                fc.constantFrom(true, false, undefined),
                (zoom, size, createdAtZoom, enabled) => {
                    const properties = { size, createdAtZoom };
                    // Absent, not present-and-undefined: that is how a GeoJSON
                    // feature without the flag actually reaches the expression.
                    if (enabled !== undefined) properties.zoomCorrectionEnabled = enabled;

                    const got = evaluateZoomScaledSize({
                        base: size,
                        anchorZoom: createdAtZoom,
                        enabled,
                        maxValue: IMAGE_SPEC.maxValue,
                    }, zoom);

                    return agrees(got, image.evaluate(properties, zoom));
                },
            ),
            { numRuns: 600 },
        );
    });

    it('matches on non-integer anchors, the value the tools actually stamp', () => {
        for (const createdAtZoom of [8.25, 12.3, 15.75, 23.9]) {
            for (const zoom of [0, 4.5, 12.3, 12.31, 18.125, 24]) {
                const properties = { size: 0.4, createdAtZoom };
                const got = evaluateZoomScaledSize(
                    { base: 0.4, anchorZoom: createdAtZoom, maxValue: 10 },
                    zoom,
                );
                expect(agrees(got, image.evaluate(properties, zoom))).toBe(true);
            }
        }
    });

    it('returns the stop value verbatim when the zoom sits exactly on a stop', () => {
        for (const zoom of [0, 7, 10, 13, 24]) {
            const properties = { size: 1, createdAtZoom: 10 };
            const got = evaluateZoomScaledSize({ base: 1, anchorZoom: 10, maxValue: 10 }, zoom);
            expect(got).toBeCloseTo(Math.min(10, Math.pow(2, zoom - 10)), 12);
            expect(agrees(got, image.evaluate(properties, zoom))).toBe(true);
        }
    });

    it('clamps below stop 0 and at/above stop 24, like the expression does', () => {
        const properties = { size: 1, createdAtZoom: 10 };

        for (const zoom of [-3, -0.5, 0]) {
            const got = evaluateZoomScaledSize({ base: 1, anchorZoom: 10, maxValue: 10 }, zoom);
            expect(got).toBe(Math.pow(2, -10));
            expect(agrees(got, image.evaluate(properties, zoom))).toBe(true);
        }

        for (const zoom of [24, 25.5, 100]) {
            const got = evaluateZoomScaledSize({ base: 1, anchorZoom: 10, maxValue: 10 }, zoom);
            expect(got).toBe(10);
            expect(agrees(got, image.evaluate(properties, zoom))).toBe(true);
        }
    });

    it('reproduces the expression inside the zoom level where the ceiling starts to bite', () => {
        // base 1 anchored at 10: stop 13 is 8, stop 14 is min(10, 16) = 10, so
        // the ceiling bites between them and the interpolation rides above a
        // hard `min` — the expression does exactly the same, so this is an
        // equality, not a bound.
        const properties = { size: 1, createdAtZoom: 10 };
        for (const zoom of [13.1, 13.5, 13.9]) {
            const got = evaluateZoomScaledSize({ base: 1, anchorZoom: 10, maxValue: 10 }, zoom);
            expect(got).toBeGreaterThan(8);
            expect(got).toBeLessThan(10);
            expect(agrees(got, image.evaluate(properties, zoom))).toBe(true);
        }
        expect(evaluateZoomScaledSize({ base: 1, anchorZoom: 10, maxValue: 10 }, 13.5))
            .toBeCloseTo(8 + (Math.SQRT2 - 1) * 2, 12);
    });

    it('leaves the base alone when the correction is switched off', () => {
        const properties = { size: 3, createdAtZoom: 10, zoomCorrectionEnabled: false };
        for (const zoom of [0, 10, 17.4, 24]) {
            const got = evaluateZoomScaledSize(
                { base: 3, anchorZoom: 10, enabled: false, maxValue: 10 },
                zoom,
            );
            expect(got).toBe(3);
            expect(agrees(got, image.evaluate(properties, zoom))).toBe(true);
        }
    });

    it('falls back to the base when the anchor property is missing, as the expression does', () => {
        const properties = { size: 2 };
        for (const zoom of [0, 11.7, 24]) {
            const got = evaluateZoomScaledSize({ base: 2, anchorZoom: NaN, maxValue: 10 }, zoom);
            expect(got).toBe(2);
            expect(agrees(got, image.evaluate(properties, zoom))).toBe(true);
        }
    });

    it('DIVERGES on a NaN anchor: base here, style default in the expression', () => {
        expect(evaluateZoomScaledSize({ base: 2, anchorZoom: NaN, maxValue: 10 }, 10)).toBe(2);
        expect(image.evaluate({ size: 2, createdAtZoom: NaN }, 10)).toBe(1);
    });

    it('returns NaN when the base or the zoom is not a finite number', () => {
        expect(evaluateZoomScaledSize({ base: NaN, anchorZoom: 10, maxValue: 10 }, 12)).toBeNaN();
        expect(evaluateZoomScaledSize({ base: undefined, anchorZoom: 10, maxValue: 10 }, 12)).toBeNaN();
        expect(evaluateZoomScaledSize({ base: Infinity, anchorZoom: 10, maxValue: 10 }, 12)).toBeNaN();
        expect(evaluateZoomScaledSize({ base: 1, anchorZoom: 10, maxValue: 10 }, NaN)).toBeNaN();
        expect(evaluateZoomScaledSize({ base: 1, anchorZoom: 10, maxValue: 10 }, undefined)).toBeNaN();
    });

    it('never clamps when maxValue is absent', () => {
        expect(evaluateZoomScaledSize({ base: 1, anchorZoom: 0 }, 20)).toBe(Math.pow(2, 20));
    });
});

describe('evaluateZoomScaledSize against the compiled point-marker icon-size', () => {
    const marker = compileIconSize(MARKER_SPEC);

    /**
     * The size the marker expression is asked for, straight from the model.
     * @param {number} size - `properties.size` (a radius in pixels)
     * @param {number} anchorZoom - `properties.sizeCreatedAtZoom`, `NaN` when absent
     * @param {number} zoom - Map zoom
     * @param {boolean} [enabled] - `properties.sizeZoomCorrectionEnabled`
     * @returns {number} Model value
     */
    function markerSize(size, anchorZoom, zoom, enabled) {
        return evaluateZoomScaledSize({
            base: size,
            anchorZoom,
            enabled,
            maxValue: MARKER_SPEC.maxValue,
            anchorDefault: MARKER_SPEC.anchorDefault,
            divideBy: MARKER_SPEC.divideBy,
        }, zoom);
    }

    it('compiles as a composite (zoom AND feature) expression', () => {
        expect(marker.kind).toBe('composite');
    });

    it('matches the expression for every size, anchor, zoom and flag (property test)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 24, noNaN: true }),
                fc.double({ min: 0.5, max: 500, noNaN: true }),
                // `undefined` is the feature that never carried the anchor
                // property at all — the expression's `coalesce` then reads 0.
                fc.option(fc.double({ min: 0, max: 24, noNaN: true }), { nil: undefined }),
                fc.constantFrom(true, false, undefined),
                (zoom, size, sizeCreatedAtZoom, enabled) => {
                    const properties = { size };
                    if (sizeCreatedAtZoom !== undefined) properties.sizeCreatedAtZoom = sizeCreatedAtZoom;
                    if (enabled !== undefined) properties.sizeZoomCorrectionEnabled = enabled;

                    const got = markerSize(
                        size,
                        sizeCreatedAtZoom === undefined ? NaN : sizeCreatedAtZoom,
                        zoom,
                        enabled,
                    );

                    return agrees(got, marker.evaluate(properties, zoom));
                },
            ),
            { numRuns: 600 },
        );
    });

    it('divides by 24: a 10 px radius anchored at the current zoom is icon-size 10/24', () => {
        // 48 CSS px of bitmap * 10/24 = 20 px on screen, the diameter of a
        // 10 px-radius marker.
        const properties = { size: 10, sizeCreatedAtZoom: 10, sizeZoomCorrectionEnabled: true };
        expect(markerSize(10, 10, 10, true)).toBeCloseTo(10 / 24, 12);
        expect(agrees(markerSize(10, 10, 10, true), marker.evaluate(properties, 10))).toBe(true);
    });

    it('ANCHORS AT ZERO when the anchor property is absent, instead of keeping the base', () => {
        // This is the `anchorDefault: 0` half of the spec: with no
        // `['!=', ['typeof', ...], 'number']` branch, the coalesce hands the
        // scaling a 0 anchor and a marker created at zoom 0 grows all the way.
        for (const zoom of [0, 3, 7.5, 24]) {
            const got = markerSize(10, NaN, zoom);
            expect(agrees(got, marker.evaluate({ size: 10 }, zoom))).toBe(true);
            expect(got).toBeCloseTo(Math.min(500, 10 * Math.pow(2, zoom)) / 24, 9);
        }
        // The four picture layers do the opposite with the same input.
        expect(evaluateZoomScaledSize({ base: 10, anchorZoom: NaN, maxValue: 10 }, 7.5)).toBe(10);
    });

    it('clamps at 500 BEFORE dividing, so the ceiling is 500/24 and not 500', () => {
        // base 10 anchored at 0 passes 500 at zoom 5.64...; stop 6 is already
        // clamped, so the value there is exactly 500 / 24.
        const properties = { size: 10, sizeCreatedAtZoom: 0 };
        expect(markerSize(10, 0, 6, undefined)).toBeCloseTo(500 / 24, 12);
        expect(agrees(markerSize(10, 0, 6, undefined), marker.evaluate(properties, 6))).toBe(true);
        for (const zoom of [12, 20, 24]) {
            expect(markerSize(10, 0, zoom, undefined)).toBeCloseTo(500 / 24, 12);
            expect(agrees(markerSize(10, 0, zoom, undefined), marker.evaluate(properties, zoom))).toBe(true);
        }
    });

    it('divides the DISABLED branch too: the base is still an icon-size', () => {
        const properties = { size: 30, sizeCreatedAtZoom: 4, sizeZoomCorrectionEnabled: false };
        for (const zoom of [0, 4, 13.7, 24]) {
            const got = markerSize(30, 4, zoom, false);
            expect(got).toBeCloseTo(30 / 24, 12);
            expect(agrees(got, marker.evaluate(properties, zoom))).toBe(true);
        }
    });

    it('keeps the two clamped ends of the stop range divided as well', () => {
        const properties = { size: 10, sizeCreatedAtZoom: 12 };
        for (const zoom of [-5, 0]) {
            const got = markerSize(10, 12, zoom, undefined);
            expect(got).toBeCloseTo(10 * Math.pow(2, -12) / 24, 12);
            expect(agrees(got, marker.evaluate(properties, zoom))).toBe(true);
        }
        for (const zoom of [24, 30]) {
            const got = markerSize(10, 12, zoom, undefined);
            expect(got).toBeCloseTo(500 / 24, 12);
            expect(agrees(got, marker.evaluate(properties, zoom))).toBe(true);
        }
    });

    it('ignores a divisor that could not divide anything', () => {
        for (const divideBy of [undefined, null, 0, -24, NaN, Infinity, '24']) {
            expect(evaluateZoomScaledSize({ base: 10, anchorZoom: 10, divideBy }, 10)).toBe(10);
        }
    });

    it('still returns NaN for an unusable base or zoom, divisor or not', () => {
        expect(evaluateZoomScaledSize({ base: NaN, anchorZoom: 10, anchorDefault: 0, divideBy: 24 }, 10)).toBeNaN();
        expect(evaluateZoomScaledSize({ base: 10, anchorZoom: 10, anchorDefault: 0, divideBy: 24 }, NaN)).toBeNaN();
        // ... but a disabled correction answers before the zoom is ever needed.
        expect(evaluateZoomScaledSize({ base: 10, enabled: false, divideBy: 24 }, NaN)).toBeCloseTo(10 / 24, 12);
    });
});

describe('iconSizeForFeature', () => {
    const image = compileIconSize(IMAGE_SPEC);
    const declination = compileIconSize(DECLINATION_SPEC);

    it('returns null for a layer with no size rule', () => {
        expect(iconSizeForFeature('line-layer', { size: 1, createdAtZoom: 10 }, 12)).toBeNull();
        expect(iconSizeForFeature(undefined, {}, 12)).toBeNull();
    });

    it('uses the layer default of 1 for images and symbols when size is absent', () => {
        for (const layerId of ['image-layer', 'military-symbols-layer', 'coordination-measures-layer']) {
            const got = iconSizeForFeature(layerId, { createdAtZoom: 10 }, 11.5);
            expect(agrees(got, image.evaluate({ createdAtZoom: 10 }, 11.5))).toBe(true);
        }
    });

    it('uses the declination default of 0.6 when size is absent', () => {
        for (const zoom of [0, 9, 12.75, 24]) {
            const got = iconSizeForFeature('magnetic-declinations-layer', { createdAtZoom: 10 }, zoom);
            expect(agrees(got, declination.evaluate({ createdAtZoom: 10 }, zoom))).toBe(true);
        }
        expect(iconSizeForFeature('magnetic-declinations-layer', { createdAtZoom: 10 }, 10)).toBe(0.6);
    });

    it('honours an authored size on the declination layer too', () => {
        const properties = { size: 2.5, createdAtZoom: 12 };
        const got = iconSizeForFeature('magnetic-declinations-layer', properties, 13.25);
        expect(agrees(got, declination.evaluate(properties, 13.25))).toBe(true);
    });

    it('DIVERGES on size 0 and on a negative size: the layer default wins', () => {
        expect(iconSizeForFeature('image-layer', { size: 0, createdAtZoom: 10 }, 10)).toBe(1);
        expect(iconSizeForFeature('image-layer', { size: -4, createdAtZoom: 10 }, 10)).toBe(1);
        expect(image.evaluate({ size: 0, createdAtZoom: 10 }, 10)).toBe(0);
    });

    it('ignores a non-numeric anchor, as the expression does', () => {
        expect(iconSizeForFeature('image-layer', { size: 2, createdAtZoom: '12' }, 20)).toBe(2);
        expect(iconSizeForFeature('image-layer', { size: 2, createdAtZoom: null }, 20)).toBe(2);
    });

    it('survives missing properties', () => {
        expect(iconSizeForFeature('image-layer', undefined, 10)).toBe(1);
        expect(iconSizeForFeature('image-layer', null, 10)).toBe(1);
    });

    describe('point-marker-layer, whose spec names other properties', () => {
        const marker = compileIconSize(MARKER_SPEC);

        it('reads size / sizeCreatedAtZoom / sizeZoomCorrectionEnabled', () => {
            const properties = { size: 10, sizeCreatedAtZoom: 10, sizeZoomCorrectionEnabled: true };
            for (const zoom of [0, 9, 10, 11.4, 24]) {
                const got = iconSizeForFeature('point-marker-layer', properties, zoom);
                expect(agrees(got, marker.evaluate(properties, zoom))).toBe(true);
            }
            expect(iconSizeForFeature('point-marker-layer', properties, 10)).toBeCloseTo(10 / 24, 12);
        });

        it('ignores the PICTURE properties, which the marker layer never reads', () => {
            // `createdAtZoom` and `zoomCorrectionEnabled` are the four picture
            // layers' names; a marker carrying them must still be sized by its
            // own, i.e. anchored at 0 and scaling.
            const strays = { size: 10, createdAtZoom: 10, zoomCorrectionEnabled: false };
            expect(iconSizeForFeature('point-marker-layer', strays, 10))
                .toBeCloseTo(iconSizeForFeature('point-marker-layer', { size: 10 }, 10), 12);
            expect(agrees(
                iconSizeForFeature('point-marker-layer', strays, 10),
                marker.evaluate(strays, 10),
            )).toBe(true);
        });

        it('uses the layer default of 10 when the size is absent', () => {
            const properties = { sizeCreatedAtZoom: 10 };
            for (const zoom of [0, 10, 12.5, 24]) {
                const got = iconSizeForFeature('point-marker-layer', properties, zoom);
                expect(agrees(got, marker.evaluate(properties, zoom))).toBe(true);
            }
            expect(iconSizeForFeature('point-marker-layer', properties, 10)).toBeCloseTo(10 / 24, 12);
        });

        it('honours the disabled flag under its own name only', () => {
            const off = { size: 30, sizeCreatedAtZoom: 4, sizeZoomCorrectionEnabled: false };
            expect(iconSizeForFeature('point-marker-layer', off, 20)).toBeCloseTo(30 / 24, 12);
            expect(agrees(iconSizeForFeature('point-marker-layer', off, 20), marker.evaluate(off, 20)))
                .toBe(true);
        });
    });
});

describe('parseIconOffset', () => {
    // The array form is what `queryRenderedFeatures` hands back once MapLibre
    // has decoded its own JSON marker (`util/vectortile_to_geojson.ts:48-56`);
    // the TEXT form is the same pair as it travels through the tile
    // (`util.ts:20` `JSON_PREFIX`), and is accepted so a row that reached the
    // hit-test undecoded still puts the rectangle on the drawing.
    it.each([
        ['a pair of numbers', [0, 12.5], [0, 12.5]],
        ['a negative pair', [-3.5, 4], [-3.5, 4]],
        ['zeroes', [0, 0], [0, 0]],
        ['the same pair as JSON text', '[0,12.5]', [0, 12.5]],
        ['JSON text with whitespace', ' [ -2 , 7.25 ] ', [-2, 7.25]],
    ])('reads %s', (_label, value, expected) => {
        expect(parseIconOffset(value)).toEqual(expected);
    });

    it.each([
        ['nothing at all', undefined],
        ['null', null],
        ['a one-element array', [1]],
        ['a three-element array', [1, 2, 3]],
        ['an empty array', []],
        ['NaN in a slot', [NaN, 1]],
        ['Infinity in a slot', [1, Infinity]],
        ['null in a slot', [null, 3]],
        ['numeric STRINGS in the slots', ['0', '12.5']],
        ['an object', { x: 0, y: 12.5 }],
        ['a boolean', true],
        ['text that is not JSON', 'nao e json'],
        ['JSON text that is not a pair', '5'],
        ['JSON text of a string', '"12"'],
        ['JSON text of an object', '{"x":0,"y":12.5}'],
    ])('falls back to no offset for %s', (_label, value) => {
        expect(parseIconOffset(value)).toEqual([0, 0]);
    });

    // The style spec types `icon-offset` as an array of NUMBERS, so MapLibre
    // would reject `['0', '12.5']` outright and draw no offset at all; a
    // half-honoured shift here would put the rectangle where nothing was drawn.
    it('never coerces a slot the way Number() would', () => {
        expect(parseIconOffset(['0', '12.5'])).toEqual([0, 0]);
        expect(parseIconOffset([null, 3])).toEqual([0, 0]);
    });

    it('returns a fresh array, so a caller cannot poison the next answer', () => {
        const first = parseIconOffset(null);
        expect(first).not.toBe(parseIconOffset(null));
        first[0] = 99;
        expect(parseIconOffset(null)).toEqual([0, 0]);
    });
});

describe('iconScreenQuad', () => {
    const base = {
        anchor: { x: 100, y: 200 },
        displayWidth: 40,
        displayHeight: 20,
        iconSize: 1,
    };

    it('centres the unrotated rectangle on the anchor', () => {
        expect(iconScreenQuad(base)).toEqual([
            { x: 80, y: 190 },
            { x: 120, y: 190 },
            { x: 120, y: 210 },
            { x: 80, y: 210 },
        ]);
    });

    it('rotating 90 degrees sends (w/2, 0) to (0, w/2), i.e. CLOCKWISE on a y-down screen', () => {
        // Zero height collapses the rectangle onto the horizontal axis, so the
        // two right-hand corners ARE the offset (w/2, 0). MapLibre builds
        // [cos, -sin, sin, cos] and applies it through Point._matMult, so
        // x' = cos*x - sin*y and y' = sin*x + cos*y: with y growing downwards
        // that turns the +x axis towards +y, which reads clockwise on screen.
        const quad = iconScreenQuad({
            anchor: { x: 0, y: 0 },
            displayWidth: 40,
            displayHeight: 0,
            iconSize: 1,
            rotationDeg: 90,
        });

        expect(quad[1].x).toBeCloseTo(0, 12);
        expect(quad[1].y).toBeCloseTo(20, 12);
        expect(quad[0].x).toBeCloseTo(0, 12);
        expect(quad[0].y).toBeCloseTo(-20, 12);
    });

    it('puts the rectangle to the RIGHT of the anchor for icon-anchor left', () => {
        const quad = iconScreenQuad({ ...base, iconAnchor: 'left' });
        expect(quad.map((p) => p.x)).toEqual([100, 140, 140, 100]);
        expect(quad.map((p) => p.y)).toEqual([190, 190, 210, 210]);
    });

    it('puts the rectangle ABOVE the anchor for icon-anchor bottom (y1 = -h)', () => {
        const quad = iconScreenQuad({ ...base, iconAnchor: 'bottom' });
        expect(quad.map((p) => p.y)).toEqual([180, 180, 200, 200]);
        expect(quad.map((p) => p.x)).toEqual([80, 120, 120, 80]);
    });

    it('anchors top-left at the anchor and bottom-right at the opposite corner', () => {
        expect(iconScreenQuad({ ...base, iconAnchor: 'top-left' })).toEqual([
            { x: 100, y: 200 },
            { x: 140, y: 200 },
            { x: 140, y: 220 },
            { x: 100, y: 220 },
        ]);
        expect(iconScreenQuad({ ...base, iconAnchor: 'bottom-right' })).toEqual([
            { x: 60, y: 180 },
            { x: 100, y: 180 },
            { x: 100, y: 200 },
            { x: 60, y: 200 },
        ]);
    });

    it('falls back to the centre for an unknown icon-anchor', () => {
        expect(iconScreenQuad({ ...base, iconAnchor: 'nowhere' })).toEqual(iconScreenQuad(base));
    });

    it('pivots the rotation at the ANCHOR, not at the image centre', () => {
        // icon-anchor left puts the rectangle to the right of the anchor; a half
        // turn about the anchor must therefore land it on the LEFT.
        const quad = iconScreenQuad({ ...base, iconAnchor: 'left', rotationDeg: 180 });
        for (const corner of quad) {
            expect(corner.x).toBeLessThanOrEqual(100 + 1e-9);
        }
        expect(quad[1].x).toBeCloseTo(60, 12);
    });

    it('scales by iconSize and by perspectiveRatio, multiplicatively', () => {
        const doubled = iconScreenQuad({ ...base, iconSize: 2 });
        expect(doubled[0]).toEqual({ x: 60, y: 180 });
        expect(doubled[2]).toEqual({ x: 140, y: 220 });

        const perspective = iconScreenQuad({ ...base, perspectiveRatio: 2 });
        expect(perspective[0]).toEqual({ x: 60, y: 180 });

        const both = iconScreenQuad({ ...base, iconSize: 2, perspectiveRatio: 1.5 });
        expect(both[0]).toEqual({ x: 40, y: 170 });
    });

    it('returns null on any non-finite input', () => {
        expect(iconScreenQuad({ ...base, displayWidth: NaN })).toBeNull();
        expect(iconScreenQuad({ ...base, displayHeight: Infinity })).toBeNull();
        expect(iconScreenQuad({ ...base, iconSize: NaN })).toBeNull();
        expect(iconScreenQuad({ ...base, rotationDeg: NaN })).toBeNull();
        expect(iconScreenQuad({ ...base, perspectiveRatio: NaN })).toBeNull();
        expect(iconScreenQuad({ ...base, anchor: { x: NaN, y: 0 } })).toBeNull();
        expect(iconScreenQuad({ ...base, anchor: undefined })).toBeNull();
    });

    it('accepts the anchor as an [x, y] pair', () => {
        expect(iconScreenQuad({ ...base, anchor: [100, 200] })).toEqual(iconScreenQuad(base));
    });

    it('shifts the unrotated rectangle by the icon-offset, in ICON pixels', () => {
        // 40x20 centred on (100, 200), offset [3, -4]: the whole rectangle
        // moves 3 px right and 4 px UP (positive y is down on screen).
        expect(iconScreenQuad({ ...base, iconOffset: [3, -4] })).toEqual([
            { x: 83, y: 186 },
            { x: 123, y: 186 },
            { x: 123, y: 206 },
            { x: 83, y: 206 },
        ]);
    });

    it('scales the offset by iconSize and perspectiveRatio, like every other corner', () => {
        // The offset is in ICON pixels, so it rides the same `size * ratio`
        // multiplication the corners do: 3 * 2 * 1.5 = 9 px on screen.
        const plain = iconScreenQuad({ ...base, iconSize: 2, perspectiveRatio: 1.5 });
        const shifted = iconScreenQuad({
            ...base, iconSize: 2, perspectiveRatio: 1.5, iconOffset: [3, -4],
        });

        shifted.forEach((corner, i) => {
            expect(corner.x).toBeCloseTo(plain[i].x + 9, 12);
            expect(corner.y).toBeCloseTo(plain[i].y - 12, 12);
        });
    });

    it('applies the offset BEFORE the rotation: [0, 10] at 90 degrees moves the rectangle LEFT', () => {
        // MapLibre adds the offset inside `shapeIcon` (`symbol/shaping.ts:740`,
        // `x1 = dx - displaySize[0] * horizontalAlign`) and only then rotates
        // the corners (`symbol/quads.ts:137-148`), so the offset turns with the
        // icon. With x' = cos*x - sin*y and y' = sin*x + cos*y at 90 degrees,
        // [0, 10] becomes [-10, 0]: LEFT on a y-down screen, not down. An
        // offset added after the rotation would have moved it 10 px DOWN.
        const plain = iconScreenQuad({ ...base, rotationDeg: 90 });
        const shifted = iconScreenQuad({ ...base, rotationDeg: 90, iconOffset: [0, 10] });

        shifted.forEach((corner, i) => {
            expect(corner.x).toBeCloseTo(plain[i].x - 10, 12);
            expect(corner.y).toBeCloseTo(plain[i].y, 12);
        });
    });

    it('composes the offset with icon-anchor left and with the padding', () => {
        // anchor 'left' puts x1 at 0 and the offset moves it to 10; the 5 px
        // frame then grows the rectangle outwards on all four sides, so
        // x runs 10-5=5 to 5+40+10=55 and y runs -10-5=-15 to -15+20+10=15,
        // all relative to the anchor at (100, 200).
        expect(iconScreenQuad({
            ...base, iconAnchor: 'left', paddingPx: 5, iconOffset: [10, 0],
        })).toEqual([
            { x: 105, y: 185 },
            { x: 155, y: 185 },
            { x: 155, y: 215 },
            { x: 105, y: 215 },
        ]);
    });

    it('reads the offset through parseIconOffset, text form included', () => {
        expect(iconScreenQuad({ ...base, iconOffset: '[3,-4]' }))
            .toEqual(iconScreenQuad({ ...base, iconOffset: [3, -4] }));

        // An unusable offset degrades to no offset rather than to a null
        // rectangle: the bitmap rectangle is still a better answer than
        // MapLibre's inflated collision box.
        const plain = iconScreenQuad(base);
        for (const iconOffset of [undefined, null, [NaN, 0], [1], 'lixo', { x: 1, y: 2 }]) {
            expect(iconScreenQuad({ ...base, iconOffset })).toEqual(plain);
        }
    });

    it('adds paddingPx to every side in SCREEN pixels', () => {
        // 40x20 centred on (100, 200) plus 5 px all round is 50x30 centred there.
        expect(iconScreenQuad({ ...base, paddingPx: 5 })).toEqual([
            { x: 75, y: 185 },
            { x: 125, y: 185 },
            { x: 125, y: 215 },
            { x: 75, y: 215 },
        ]);
    });

    it('keeps the padding at paddingPx SCREEN pixels whatever the icon scale is', () => {
        // The corners are in icon pixels and get multiplied by iconSize *
        // perspectiveRatio, so the padding has to be divided by that scale
        // first. Here the scale is 2 * 0.5 = 1, so the drawn rectangle is the
        // 40x20 one and the frame is still 5 px away from it — a padding added
        // in icon pixels would have come out at 5 * scale instead.
        const scaled = iconScreenQuad({ ...base, iconSize: 2, perspectiveRatio: 0.5, paddingPx: 5 });
        expect(scaled).toEqual(iconScreenQuad({ ...base, paddingPx: 5 }));

        // ... and at scale 2 the same 5 screen px is still 5 screen px: the
        // 80x40 rectangle becomes 90x50.
        expect(iconScreenQuad({ ...base, iconSize: 2, paddingPx: 5 })).toEqual([
            { x: 55, y: 175 },
            { x: 145, y: 175 },
            { x: 145, y: 225 },
            { x: 55, y: 225 },
        ]);
    });

    it('rotates the padding WITH the icon instead of expanding an axis-aligned box', () => {
        const rotationDeg = 90;
        const paddingPx = 5;
        const plain = iconScreenQuad({ ...base, rotationDeg });
        const padded = iconScreenQuad({ ...base, rotationDeg, paddingPx });

        // The icon's own axes after the turn (y grows downwards, so a positive
        // rotation is clockwise): local +x points down, local +y points left.
        const angle = rotationDeg * Math.PI / 180;
        const axisX = { x: Math.cos(angle), y: Math.sin(angle) };
        const axisY = { x: -Math.sin(angle), y: Math.cos(angle) };
        // Corner order is TL, TR, BR, BL of the UNROTATED rectangle, so every
        // corner moves outwards by the padding along BOTH rotated axes.
        const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

        padded.forEach((corner, i) => {
            const [sx, sy] = signs[i];
            expect(corner.x).toBeCloseTo(plain[i].x + paddingPx * (sx * axisX.x + sy * axisY.x), 12);
            expect(corner.y).toBeCloseTo(plain[i].y + paddingPx * (sx * axisX.y + sy * axisY.y), 12);
        });

        // The proof it is not an axis-aligned expansion: the padded rectangle
        // still measures the HEIGHT plus twice the padding across the screen.
        const xs = padded.map((corner) => corner.x);
        expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(base.displayHeight + 2 * paddingPx, 12);
    });

    it('ignores a padding that is zero, negative, NaN or absent', () => {
        const plain = iconScreenQuad(base);
        for (const paddingPx of [0, -0, -5, NaN, Infinity, undefined, null, '5']) {
            expect(iconScreenQuad({ ...base, paddingPx })).toEqual(plain);
        }
    });

    it('ignores the padding when the icon has no size on screen', () => {
        // scale 0 collapses the rectangle onto the anchor, and dividing the
        // padding by it would be an infinite frame around nothing.
        const collapsed = iconScreenQuad({ ...base, iconSize: 0, paddingPx: 5 });
        expect(collapsed).toEqual([
            { x: 100, y: 200 },
            { x: 100, y: 200 },
            { x: 100, y: 200 },
            { x: 100, y: 200 },
        ]);
        expect(iconScreenQuad({ ...base, perspectiveRatio: 0, paddingPx: 5 })).toEqual(collapsed);
    });

    it('keeps the padded centroid at the anchor for any rotation and padding', () => {
        // A centred anchor makes the padded rectangle symmetric about the
        // anchor, and rotation is applied about that same anchor, so the frame
        // can never drift off the picture whatever the turn.
        fc.assert(fc.property(
            fc.double({ min: -720, max: 720, noNaN: true }),
            fc.double({ min: 0, max: 200, noNaN: true }),
            (rotationDeg, paddingPx) => {
                const quad = iconScreenQuad({ ...base, rotationDeg, paddingPx });
                const cx = quad.reduce((sum, corner) => sum + corner.x, 0) / 4;
                const cy = quad.reduce((sum, corner) => sum + corner.y, 0) / 4;
                return agrees(cx, base.anchor.x) && agrees(cy, base.anchor.y);
            },
        ));
    });
});

describe('pointInConvexQuad', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

    it('accepts an interior point and rejects an exterior one', () => {
        expect(pointInConvexQuad({ x: 5, y: 5 }, square)).toBe(true);
        expect(pointInConvexQuad([5, 5], square)).toBe(true);
        expect(pointInConvexQuad({ x: 11, y: 5 }, square)).toBe(false);
        expect(pointInConvexQuad({ x: 5, y: -0.001 }, square)).toBe(false);
    });

    it('counts edges and vertices as inside', () => {
        expect(pointInConvexQuad({ x: 0, y: 0 }, square)).toBe(true);
        expect(pointInConvexQuad({ x: 10, y: 10 }, square)).toBe(true);
        expect(pointInConvexQuad({ x: 5, y: 0 }, square)).toBe(true);
        expect(pointInConvexQuad({ x: 0, y: 7 }, square)).toBe(true);
    });

    it('works on a rotated quad, where the AABB is much bigger than the shape', () => {
        const diamond = iconScreenQuad({
            anchor: { x: 0, y: 0 },
            displayWidth: 20,
            displayHeight: 20,
            iconSize: 1,
            rotationDeg: 45,
        });

        expect(pointInConvexQuad({ x: 0, y: 0 }, diamond)).toBe(true);
        expect(pointInConvexQuad({ x: 0, y: 13 }, diamond)).toBe(true);
        // Inside the axis-aligned bounding box, outside the rotated square.
        expect(pointInConvexQuad({ x: 13, y: 13 }, diamond)).toBe(false);
    });

    it('does not treat every collinear point as inside when the quad is degenerate', () => {
        const collapsed = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
        expect(pointInConvexQuad({ x: 5, y: 5 }, collapsed)).toBe(true);
        expect(pointInConvexQuad({ x: 50, y: 5 }, collapsed)).toBe(false);
    });

    it('rejects unusable input instead of throwing', () => {
        expect(pointInConvexQuad({ x: 5, y: 5 }, null)).toBe(false);
        expect(pointInConvexQuad({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
        expect(pointInConvexQuad({ x: NaN, y: 5 }, square)).toBe(false);
        expect(pointInConvexQuad({ x: 5, y: 5 }, [...square.slice(1), { x: NaN, y: 0 }])).toBe(false);
    });

    it('always contains its own centroid and never a point beyond its radius (property test)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -500, max: 500, noNaN: true }),
                fc.double({ min: -500, max: 500, noNaN: true }),
                fc.double({ min: 1, max: 300, noNaN: true }),
                fc.double({ min: 1, max: 300, noNaN: true }),
                fc.double({ min: -720, max: 720, noNaN: true }),
                fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
                (x, y, width, height, rotationDeg, direction) => {
                    const quad = iconScreenQuad({
                        anchor: { x, y },
                        displayWidth: width,
                        displayHeight: height,
                        iconSize: 1,
                        rotationDeg,
                    });

                    const centroid = {
                        x: quad.reduce((sum, p) => sum + p.x, 0) / 4,
                        y: quad.reduce((sum, p) => sum + p.y, 0) / 4,
                    };
                    if (!pointInConvexQuad(centroid, quad)) return false;

                    const radius = Math.max(
                        ...quad.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y)),
                    );
                    const far = {
                        x: centroid.x + Math.cos(direction) * (radius + 1),
                        y: centroid.y + Math.sin(direction) * (radius + 1),
                    };
                    return pointInConvexQuad(far, quad) === false;
                },
            ),
            { numRuns: 500 },
        );
    });
});

describe('perspectiveRatio', () => {
    it('is exactly 1 when the anchor sits at the camera-to-centre distance', () => {
        expect(perspectiveRatio(1000, 1000)).toBe(1);
    });

    it('is 0.75 when the anchor is twice as far as the centre', () => {
        expect(perspectiveRatio(1000, 2000)).toBe(0.75);
    });

    it('clamps at 4 for an anchor arbitrarily close to the camera', () => {
        expect(perspectiveRatio(1000, 1e-6)).toBe(4);
        expect(perspectiveRatio(1000, 100)).toBe(4);
    });

    it('clamps at 0 when the ratio goes negative', () => {
        expect(perspectiveRatio(-1000, 100)).toBe(0);
    });

    it('returns 1 rather than a bad number for unusable input', () => {
        expect(perspectiveRatio(1000, 0)).toBe(1);
        expect(perspectiveRatio(1000, -50)).toBe(1);
        expect(perspectiveRatio(1000, NaN)).toBe(1);
        expect(perspectiveRatio(NaN, 1000)).toBe(1);
        expect(perspectiveRatio(Infinity, 1000)).toBe(1);
        expect(perspectiveRatio(undefined, undefined)).toBe(1);
    });
});

describe('projectedW', () => {
    const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
    ];

    it('gives w = 1 for the column-major identity', () => {
        expect(projectedW(identity, 12, 34, 56)).toBe(1);
    });

    it('reads w from row 4 of a column-major matrix: m[3]x + m[7]y + m[11]z + m[15]', () => {
        // Column-major: element m[i] is column floor(i/4), row i%4, so the four
        // contributors to w are the row-3 entries 3, 7, 11 and 15.
        const matrix = new Float64Array(16);
        matrix[3] = 2;
        matrix[7] = -3;
        matrix[11] = 0.5;
        matrix[15] = 7;

        expect(projectedW(matrix, 10, 4, 100)).toBe(2 * 10 + -3 * 4 + 0.5 * 100 + 7);
    });

    it('models a plain perspective row, where w is the distance along z', () => {
        const perspective = [...identity];
        perspective[11] = -1;
        perspective[15] = 0;

        expect(projectedW(perspective, 5, 5, -800)).toBe(800);
    });

    it('returns NaN for a matrix that is not a mat4', () => {
        expect(projectedW(null, 1, 1, 1)).toBeNaN();
        expect(projectedW([1, 2, 3], 1, 1, 1)).toBeNaN();
        expect(projectedW(undefined, 1, 1, 1)).toBeNaN();
    });
});

describe('lngLatToMercator', () => {
    /** Verbatim from maplibre-gl/src/geo/mercator_coordinate.ts:17-23. */
    const referenceX = (lng) => (180 + lng) / 360;
    const referenceY = (lat) => (
        (180 - (180 / Math.PI * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)))) / 360
    );

    it('puts null island at the centre of the unit square', () => {
        expect(lngLatToMercator(0, 0)).toEqual({ x: 0.5, y: 0.5 });
    });

    it('maps the antimeridian to the two edges of x', () => {
        expect(lngLatToMercator(-180, 0).x).toBe(0);
        expect(lngLatToMercator(180, 0).x).toBe(1);
    });

    it('puts the equator at y 0.5 and mirrors the hemispheres about it', () => {
        expect(lngLatToMercator(30, 0).y).toBe(0.5);
        const north = lngLatToMercator(0, 45).y;
        const south = lngLatToMercator(0, -45).y;
        expect(north).toBeLessThan(0.5);
        expect(north + south).toBeCloseTo(1, 12);
    });

    it('agrees with MapLibre mercatorXfromLng / mercatorYfromLat (property test)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -180, max: 180, noNaN: true }),
                fc.double({ min: -85.05112878, max: 85.05112878, noNaN: true }),
                (lng, lat) => {
                    const got = lngLatToMercator(lng, lat);
                    return got.x === referenceX(lng) && got.y === referenceY(lat);
                },
            ),
            { numRuns: 400 },
        );
    });

    it('round-trips back to the original lng/lat (property test)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: -180, max: 180, noNaN: true }),
                fc.double({ min: -85, max: 85, noNaN: true }),
                (lng, lat) => {
                    const { x, y } = lngLatToMercator(lng, lat);
                    const backLng = x * 360 - 180;
                    const backLat = 360 / Math.PI * (Math.atan(Math.exp(Math.PI - 2 * Math.PI * y)) - Math.PI / 4);
                    return Math.abs(backLng - lng) < 1e-9 && Math.abs(backLat - lat) < 1e-9;
                },
            ),
            { numRuns: 400 },
        );
    });
});

describe('toleranceBox', () => {
    it('builds a square box around an { x, y } point', () => {
        expect(toleranceBox({ x: 100, y: 50 }, 6)).toEqual([[94, 44], [106, 56]]);
    });

    it('builds the same box from an [x, y] pair', () => {
        expect(toleranceBox([100, 50], 6)).toEqual([[94, 44], [106, 56]]);
    });

    it('collapses to a ZERO-AREA box for a zero, negative or NaN tolerance', () => {
        // Still a two-corner box, not a point query: MapLibre expands a box into
        // a ring and takes the polygon path. A caller that wants the bare point
        // has to pass the point itself.
        const point = { x: 8, y: 9 };
        for (const tolerance of [0, -4, NaN, undefined, null, Infinity, '6']) {
            expect(toleranceBox(point, tolerance)).toEqual([[8, 9], [8, 9]]);
        }
    });
});

describe('hitClassOf', () => {
    it('classifies the area types', () => {
        for (const type of ['polygon', 'circle', 'ellipse', 'rectangle', 'sector', 'arrow', 'visibility']) {
            expect(hitClassOf(type)).toBe(HIT_CLASS.AREA);
        }
    });

    it('classifies the point-like types, images and symbols included', () => {
        for (const type of ['point', 'text', 'image', 'military_symbol', 'coordination_measure', 'magnetic_declination']) {
            expect(hitClassOf(type)).toBe(HIT_CLASS.POINT);
        }
    });

    it('treats every other known type as a line', () => {
        for (const type of ['line', 'brush', 'boundary', 'occupied_front', 'coordination_line', 'los']) {
            expect(hitClassOf(type)).toBe(HIT_CLASS.LINE);
        }
    });

    it('returns null for anything that is not a non-empty string', () => {
        for (const value of [undefined, null, '', 0, 12, {}, [], true]) {
            expect(hitClassOf(value)).toBeNull();
        }
    });
});

/**
 * @param {string} source - MapLibre source name
 * @param {string} id - Feature id
 * @param {string} type - Feature type written on `properties.source`
 * @returns {Object} A minimal rendered row
 */
function row(source, id, type) {
    return { source, properties: { id, source: type } };
}

/**
 * An edit handle as the tools stamp it: `user_isEditingHandle`, and NO
 * `properties.source`, so it has no hit class of its own.
 * @param {string} id - Handle feature id
 * @param {*} flag - Value written on `user_isEditingHandle`; pass `undefined`
 *   on purpose to get the property present-but-undefined
 * @returns {Object} A minimal rendered handle row
 */
function handleRow(id, flag) {
    return { source: 'line-edit-handles', properties: { id, user_isEditingHandle: flag } };
}

describe('needsExactHit', () => {
    it('is true for every area type', () => {
        for (const type of ['polygon', 'circle', 'ellipse', 'rectangle', 'sector', 'arrow', 'visibility']) {
            expect(needsExactHit(row('s', 'a1', type))).toBe(true);
        }
    });

    it('is true for an edit handle, whatever layer it came from', () => {
        expect(needsExactHit(handleRow('h1', true))).toBe(true);
        expect(needsExactHit({ properties: { id: 'h2', user_isEditingHandle: true } })).toBe(true);
    });

    it('is false for point and line rows', () => {
        for (const type of ['point', 'text', 'image', 'military_symbol', 'line', 'brush', 'boundary']) {
            expect(needsExactHit(row('s', 'x1', type))).toBe(false);
        }
    });

    it('is false for a handle flag that is not exactly true', () => {
        expect(needsExactHit(handleRow('h1', false))).toBe(false);
        expect(needsExactHit(handleRow('h1', undefined))).toBe(false);
        expect(needsExactHit(handleRow('h1', 'true'))).toBe(false);
        expect(needsExactHit(handleRow('h1', 1))).toBe(false);
    });

    it('is false for an unclassified row and for no row at all', () => {
        expect(needsExactHit({ source: 'osm', properties: { id: 'r1' } })).toBe(false);
        expect(needsExactHit({ source: 'x' })).toBe(false);
        expect(needsExactHit(null)).toBe(false);
        expect(needsExactHit(undefined)).toBe(false);
    });
});

describe('resolveExactHits', () => {
    const line = row('lines', 'l1', 'line');
    const polygon = row('polygons', 'p1', 'polygon');
    const otherPolygon = row('polygons', 'p2', 'polygon');
    const foreign = { source: 'osm', properties: { id: 'r1' } };

    it('keeps an area row only when the exact query saw it too', () => {
        expect(resolveExactHits([line, polygon, otherPolygon], [polygon]))
            .toEqual([line, polygon]);
    });

    it('drops every area row when the exact query is empty', () => {
        expect(resolveExactHits([line, polygon], [])).toEqual([line]);
        expect(resolveExactHits([line, polygon], undefined)).toEqual([line]);
        expect(resolveExactHits([line, polygon])).toEqual([line]);
    });

    it('keys on source AND id, so two features with the same id do not swap places', () => {
        const sameIdOtherSource = row('circles', 'p1', 'circle');
        expect(resolveExactHits([sameIdOtherSource], [polygon])).toEqual([]);
        expect(resolveExactHits([sameIdOtherSource], [sameIdOtherSource])).toEqual([sameIdOtherSource]);
    });

    /**
     * A handle as it comes back from the map: the flag, the PARENT feature's id
     * in the properties (never its own `properties.id`), and a Point geometry.
     * @param {string} source - Handle source
     * @param {Array<number>} coordinates - Rendered position
     * @param {Object} [extra] - Extra properties, e.g. a tool-specific handleId
     * @returns {Object} The row
     */
    const renderedHandle = (source, coordinates, extra = {}) => ({
        source,
        properties: { user_isEditingHandle: true, featureId: 'l1', ...extra },
        geometry: { type: 'Point', coordinates },
    });

    it('drops an edit handle the exact query did not see, and keeps one it did', () => {
        // A handle has no properties.source, so nothing but the handle flag can
        // hold it to the exact query.
        const handle = renderedHandle('line-edit-handles', [-43.1, -22.9]);
        expect(resolveExactHits([line, handle], [])).toEqual([line]);
        expect(resolveExactHits([line, handle], [handle])).toEqual([line, handle]);
    });

    it('tells two handles of the same feature apart by POSITION, since neither has an id of its own', () => {
        // The worst case: every handle of one line carries the same featureId,
        // so an id-based key would let a vertex 6 px away ride along on the
        // exact hit of its neighbour.
        const vertex0 = renderedHandle('line-edit-handles', [-43.1, -22.9], { index: 0 });
        const vertex7 = renderedHandle('line-edit-handles', [-43.1001, -22.9], { index: 7 });
        expect(resolveExactHits([vertex0, vertex7], [vertex0])).toEqual([vertex0]);
        expect(resolveExactHits([vertex0, vertex7], [vertex7])).toEqual([vertex7]);
    });

    it('ignores a properties.id on a handle: position still decides', () => {
        const a = renderedHandle('line-edit-handles', [-43.1, -22.9], { id: 'shared' });
        const b = renderedHandle('line-edit-handles', [-43.2, -22.9], { id: 'shared' });
        expect(resolveExactHits([a, b], [a])).toEqual([a]);
    });

    it('matches a handle across float noise, but not across sources or non-Point geometry', () => {
        const handle = renderedHandle('line-edit-handles', [-43.1, -22.9]);
        const noisy = renderedHandle('line-edit-handles', [-43.1 + 1e-12, -22.9 - 1e-12]);
        const otherSource = renderedHandle('polygon-edit-handles', [-43.1, -22.9]);
        const notAPoint = {
            ...renderedHandle('line-edit-handles', [-43.1, -22.9]),
            geometry: { type: 'LineString', coordinates: [[-43.1, -22.9], [-43.2, -22.9]] },
        };
        expect(resolveExactHits([handle], [noisy])).toEqual([handle]);
        expect(resolveExactHits([handle], [otherSource])).toEqual([]);
        expect(resolveExactHits([notAPoint], [notAPoint])).toEqual([]);
        expect(resolveExactHits([handle], [{ source: 'line-edit-handles', properties: { user_isEditingHandle: true } }])).toEqual([]);
    });

    it('passes a row whose handle flag is not true straight through', () => {
        expect(resolveExactHits([handleRow('h1', false)], [])).toEqual([handleRow('h1', false)]);
        expect(resolveExactHits([handleRow('h1', undefined)], [])).toEqual([handleRow('h1', undefined)]);
    });

    it('passes unclassified rows through untouched', () => {
        expect(resolveExactHits([foreign, polygon], [])).toEqual([foreign]);
        expect(resolveExactHits([foreign], [])).toEqual([foreign]);
    });

    it('preserves the order of the tolerant rows', () => {
        const rows = [polygon, line, otherPolygon];
        expect(resolveExactHits(rows, [otherPolygon, polygon])).toEqual([polygon, line, otherPolygon]);
    });

    it('returns [] for empty or unusable input', () => {
        expect(resolveExactHits([], [polygon])).toEqual([]);
        expect(resolveExactHits(undefined, [polygon])).toEqual([]);
        expect(resolveExactHits(null)).toEqual([]);
    });

    it('survives rows with no properties at all', () => {
        const broken = { source: 'x' };
        expect(resolveExactHits([broken, polygon], [])).toEqual([broken]);
    });
});

describe('pickPreferredHits', () => {
    const point = row('points', 'pt1', 'point');
    const line = row('lines', 'l1', 'line');
    const polygon = row('polygons', 'p1', 'polygon');
    const foreign = { source: 'osm', properties: { id: 'r1' } };

    it('keeps only the point when a point, a line and a polygon all survive', () => {
        expect(pickPreferredHits([polygon, line, point])).toEqual([point]);
    });

    it('prefers a line over an area', () => {
        expect(pickPreferredHits([polygon, line])).toEqual([line]);
    });

    it('keeps every row of the winning class, in order', () => {
        const secondLine = row('boundaries', 'b1', 'boundary');
        expect(pickPreferredHits([line, polygon, secondLine])).toEqual([line, secondLine]);
    });

    it('keeps areas when they are all there is', () => {
        const circle = row('circles', 'c1', 'circle');
        expect(pickPreferredHits([polygon, circle])).toEqual([polygon, circle]);
    });

    it('always keeps unclassified rows, whatever else wins', () => {
        expect(pickPreferredHits([foreign, polygon, point])).toEqual([foreign, point]);
        expect(pickPreferredHits([foreign])).toEqual([foreign]);
        expect(pickPreferredHits([foreign, polygon])).toEqual([foreign, polygon]);
    });

    it('returns [] for empty or unusable input', () => {
        expect(pickPreferredHits([])).toEqual([]);
        expect(pickPreferredHits(undefined)).toEqual([]);
        expect(pickPreferredHits(null)).toEqual([]);
    });

    it('does not mutate the array it is given', () => {
        const rows = [polygon, point];
        const copy = [...rows];
        pickPreferredHits(rows);
        expect(rows).toEqual(copy);
    });

    describe('with an isDecisive predicate', () => {
        const text = row('texts', 't1', 'text');
        /** A text row is the stand-in for a symbol still answering from its collision box. */
        const isDecisive = (candidate) => candidate.properties.source !== 'text';

        it('keeps BOTH a non-decisive point and the polygon that won the class', () => {
            // The text cannot demote the polygon, and is kept itself, so the
            // user is offered the two instead of losing the polygon under it.
            expect(pickPreferredHits([text, polygon], isDecisive)).toEqual([text, polygon]);
            expect(pickPreferredHits([polygon, text], isDecisive)).toEqual([polygon, text]);
        });

        it('lets a decisive line demote the area while the non-decisive text still rides along', () => {
            expect(pickPreferredHits([text, line, polygon], isDecisive)).toEqual([text, line]);
        });

        it('returns every row unchanged when NO row is decisive', () => {
            const rows = [point, line, polygon, foreign];
            expect(pickPreferredHits(rows, () => false)).toEqual(rows);
            expect(pickPreferredHits(rows, () => false)).not.toBe(rows);
        });

        it('still drops a losing class when every row is decisive', () => {
            expect(pickPreferredHits([text, line, polygon], () => true)).toEqual([text]);
        });

        it('calls the predicate with the row object itself', () => {
            const seen = [];
            pickPreferredHits([point, polygon], (candidate) => {
                seen.push(candidate);
                return true;
            });
            expect(seen).toContain(point);
            expect(seen).toContain(polygon);
            expect(seen.every((candidate) => candidate === point || candidate === polygon)).toBe(true);
        });
    });
});

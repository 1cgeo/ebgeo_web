// Path: tests/unit/coordination-measure-icon-offset-expression.test.js

/**
 * The `icon-offset` of the coordination measures layer, compiled by MapLibre's
 * OWN parser (`@maplibre/maplibre-gl-style-spec`, the package `maplibre-gl`
 * itself depends on), exactly as `boundary-zoom-expressions.test.js` does.
 *
 * WHY THIS MATTERS. Symbol bitmaps are cropped to the drawn content, so the
 * bitmap centre is no longer the point a measure must sit on: the nucleus
 * anchors its ELLIPSE centre, with the echelon glyph and the identification
 * text hanging below it, and the generator writes the difference into
 * `properties.iconOffset` in ICON pixels (`icon-size` 1, positive right/down).
 * That property only reaches the screen if `icon-offset` is DATA-DRIVEN, which
 * the style spec allows (`"property-type": "data-driven"`,
 * `@maplibre/maplibre-gl-style-spec/src/reference/v8.json:1980`) — and
 * `createPropertyExpression` is the call that would reject it if it were not.
 * Features generated before the crop carry no `iconOffset` and must coalesce to
 * the spec default `[0, 0]`, i.e. keep drawing where they always did.
 *
 * The expression lives in its own module (`layers/styles/icon-offset.expression.js`)
 * because `symbol.layers.js` imports `getControl` from the store barrel; the
 * second half of this file mocks that barrel and drives the real layer setup, so
 * what is pinned is not only that the expression compiles but that it is the
 * one the coordination measures layer applies — and that no other symbol layer
 * gets it.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPropertyExpression, latest } from '@maplibre/maplibre-gl-style-spec';

vi.mock('@store', () => ({ getControl: () => null }));

import { ICON_OFFSET_EXPRESSION } from '../../src/js/layers/styles/icon-offset.expression.js';
import {
    setupCoordinationMeasureLayers,
    setupMilitarySymbolsLayers,
    setupDeclinationLayers,
} from '../../src/js/layers/styles/symbol.layers.js';

/**
 * Compile an expression against the real `icon-offset` spec entry.
 * @param {Array} expression - MapLibre expression
 * @returns {{kind: string, evaluate: Function}} Kind and evaluator
 */
function compile(expression) {
    const compiled = createPropertyExpression(
        expression,
        'icon-offset',
        latest.layout_symbol['icon-offset'],
    );
    if (compiled.result === 'error') {
        throw new Error(`MapLibre rejected icon-offset: ${JSON.stringify(compiled.value.map(String))}`);
    }
    return {
        kind: compiled.value.kind,
        evaluate: (properties, zoom = 12) => compiled.value.evaluate({ zoom }, { properties }),
    };
}

/**
 * Map double that records the layers the setup adds.
 * @returns {Object} The double, with the added layer definitions on `layers`
 */
function montarMapa() {
    const layers = new Map();
    return {
        layers,
        getSource: () => undefined,
        addSource: vi.fn(),
        getLayer: (id) => layers.get(id),
        addLayer: vi.fn((layerDef) => layers.set(layerDef.id, layerDef)),
    };
}

describe('the icon-offset expression', () => {
    it('is accepted by MapLibre as a DATA-DRIVEN (source) expression', () => {
        const compiled = createPropertyExpression(
            ICON_OFFSET_EXPRESSION,
            'icon-offset',
            latest.layout_symbol['icon-offset'],
        );

        expect(compiled.result).toBe('success');
        // `source`, not `constant` (it reads a property) and not `composite`
        // (it does not read the zoom): the offset is per feature and nothing else.
        expect(compiled.value.kind).toBe('source');
    });

    it('evaluates to the feature offset, and to [0, 0] without one', () => {
        const { evaluate } = compile(ICON_OFFSET_EXPRESSION);

        expect(evaluate({ iconOffset: [0, 12.5] })).toEqual([0, 12.5]);
        expect(evaluate({ iconOffset: [-3.5, 4] })).toEqual([-3.5, 4]);
        // A feature drawn before the bitmaps were cropped: no property at all.
        expect(evaluate({})).toEqual([0, 0]);
        expect(evaluate({ iconOffset: null })).toEqual([0, 0]);
    });

    it('does not depend on the zoom: the offset is icon pixels, scaled by icon-size', () => {
        const { evaluate } = compile(ICON_OFFSET_EXPRESSION);

        for (const zoom of [0, 8, 12.75, 24]) {
            expect(evaluate({ iconOffset: [0, 12.5] }, zoom)).toEqual([0, 12.5]);
        }
    });
});

describe('the layer that applies it', () => {
    it('is the coordination measures layer, with that very expression', () => {
        const map = montarMapa();
        setupCoordinationMeasureLayers({ coordination_measures: [] }, map);

        const layer = map.layers.get('coordination-measures-layer');
        expect(layer.layout['icon-offset']).toBe(ICON_OFFSET_EXPRESSION);
        expect(compile(layer.layout['icon-offset']).evaluate({ iconOffset: [0, 12.5] }))
            .toEqual([0, 12.5]);
    });

    it('is the ONLY symbol layer with an icon-offset', () => {
        const map = montarMapa();
        setupMilitarySymbolsLayers({ military_symbols: [] }, map);
        setupDeclinationLayers({ magnetic_declinations: [] }, map);

        expect(map.layers.get('military-symbols-layer').layout['icon-offset']).toBeUndefined();
        expect(map.layers.get('magnetic-declinations-layer').layout['icon-offset']).toBeUndefined();
    });
});

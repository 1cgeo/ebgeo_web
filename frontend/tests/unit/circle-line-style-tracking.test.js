// Path: tests/unit/circle-line-style-tracking.test.js
//
// ROOT CAUSE it guards: `AddCircleControl.hasFeatureChanged` compared every tracked
// property EXCEPT `lineStyle`, even though `circle_attributes_panel.js` offers the
// selector (`updateFeaturesProperty(..., 'lineStyle', ...)`, which only writes the
// MapLibre source) and `lineStyle` lives in DEFAULT_PROPERTIES. `saveFeatures` calls
// `updateFeature` ONLY under this gate, so changing just the line style never reached
// the store: the circle looked dashed until the next reload.
// The sibling ellipse, rectangle and sector controls already compared `lineStyle`.

import { describe, it, expect, beforeAll } from 'vitest';

let AddCircleControl;
let control;

beforeAll(async () => {
    ({ default: AddCircleControl } = await import('../../src/js/draw_tools/circle_tool/add_circle_control.js'));
    control = new AddCircleControl({ selectionManager: {} });
});

/**
 * Minimal property bag with everything the gate compares left equal, so a single
 * difference is the only thing a `true` can come from.
 * @param {Object} [overrides] - Properties to override
 * @returns {Object} Properties
 */
function props(overrides = {}) {
    return {
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        opacity: 0.5,
        lineWidth: 2,
        lineStyle: 'solid',
        radius: 500,
        nome: 'Círculo #1',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'none',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2,
        center: [-53.1, -29.7],
        ...overrides,
    };
}

describe('AddCircleControl.hasFeatureChanged', () => {
    it('detecta mudança APENAS de lineStyle', () => {
        expect(control.hasFeatureChanged({ properties: props({ lineStyle: 'dashed' }) }, props())).toBe(true);
    });

    it('não reporta mudança quando nada mudou', () => {
        expect(control.hasFeatureChanged({ properties: props() }, props())).toBe(false);
    });

    it('borda: lineStyle ausente dos dois lados não conta; presente só de um lado conta', () => {
        const initialSemEstilo = props();
        delete initialSemEstilo.lineStyle;
        const featureSemEstilo = { properties: props() };
        delete featureSemEstilo.properties.lineStyle;

        expect(control.hasFeatureChanged(featureSemEstilo, initialSemEstilo)).toBe(false);

        // Legacy feature (saved before the property existed) that gains a style now.
        expect(control.hasFeatureChanged({ properties: props({ lineStyle: 'dotted' }) }, initialSemEstilo)).toBe(true);
    });

    it('borda: sem propriedades iniciais, tudo conta como mudança', () => {
        expect(control.hasFeatureChanged({ properties: props() }, undefined)).toBe(true);
    });
});

// Path: tests/unit/ellipse-line-style-tracking.test.js
//
// ROOT CAUSE it guards: `AddEllipseControl.hasFeatureChanged` compared every tracked
// property EXCEPT `lineStyle`, even though `ellipse_attributes_panel.js` offers the
// selector (`updateFeaturesProperty(..., 'lineStyle', ...)`, which only writes the
// MapLibre source) and the renderer honours it (`shape.layers.js` line-dasharray).
// `saveFeatures` calls `updateFeature` ONLY under this gate, so changing just the line
// style never reached the store: the ellipse looked dashed until the next reload.
// The sibling polygon and line controls already compared `lineStyle`.

import { describe, it, expect, beforeAll } from 'vitest';

let AddEllipseControl;
let control;

beforeAll(async () => {
    ({ default: AddEllipseControl } = await import('../../src/js/draw_tools/ellipse_tool/add_ellipse_control.js'));
    control = new AddEllipseControl({ selectionManager: {} });
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
        majorRadius: 500,
        minorRadius: 250,
        bearing: 0,
        nome: 'Elipse #1',
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

describe('AddEllipseControl.hasFeatureChanged', () => {
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

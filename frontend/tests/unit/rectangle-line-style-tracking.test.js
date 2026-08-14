// Path: tests/unit/rectangle-line-style-tracking.test.js
//
// ROOT CAUSE it guards: `AddRectangleControl.hasFeatureChanged` listed every tracked
// property EXCEPT `lineStyle`, although the attributes panel offers the selector
// ('Contínua/Tracejada/…' → `updateFeaturesProperty(..., 'lineStyle', ...)`) and the
// renderer honours it (`shape.layers.js` line-dasharray). Every save path runs through
// this gate — `doSave` (buttons.helpers.js), `_saveOnly` on panel close (ui_manager.js)
// and deselection (selection_manager.js) — so changing ONLY the line style was
// silently dropped: the map showed the dashes until the next reload from the store.
// The sibling polygon and line controls already compared `lineStyle`.

import { describe, it, expect, beforeAll } from 'vitest';

let AddRectangleControl;
let control;

beforeAll(async () => {
    ({ default: AddRectangleControl } = await import('../../src/js/draw_tools/rectangle_tool/add_rectangle_control.js'));
    control = new AddRectangleControl({ selectionManager: {} });
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
        borderRadius: 0,
        bearing: 0,
        width: 100,
        height: 50,
        nome: 'Retângulo #1',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'none',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2,
        corner1: [-53.1, -29.7],
        corner2: [-53.0, -29.6],
        ...overrides,
    };
}

describe('AddRectangleControl.hasFeatureChanged', () => {
    it('detecta mudança APENAS de lineStyle', () => {
        const initial = props();
        const feature = { properties: props({ lineStyle: 'dashed' }) };

        expect(control.hasFeatureChanged(feature, initial)).toBe(true);
    });

    it('não reporta mudança quando nada mudou', () => {
        const initial = props();
        const feature = { properties: props() };

        expect(control.hasFeatureChanged(feature, initial)).toBe(false);
    });

    it('borda: lineStyle ausente dos dois lados não conta como mudança, presente só de um lado conta', () => {
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

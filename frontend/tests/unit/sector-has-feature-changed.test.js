// Path: tests/unit/sector-has-feature-changed.test.js

/**
 * @fileoverview Unit tests for AddSectorControl.hasFeatureChanged.
 *
 * hasFeatureChanged is the ONLY gate on saveFeatures: a property missing from it
 * is a property whose edit is silently dropped on save. `lineStyle` (solid /
 * dashed / dotted) is edited by the sector attributes panel and rendered through
 * line-dasharray, but was absent from the comparison.
 *
 * The control is DOM/MapLibre-coupled only in its handlers, not in its
 * constructor, so the barrels it imports are mocked with trivial stand-ins and
 * the instance is built directly in the `node` environment.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@store', () => ({
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    removeFeature: vi.fn(),
    getActiveLayerIdSync: vi.fn(() => 'layer-1'),
}));

vi.mock('@utils', () => ({
    IDUtils: { generateFeatureId: vi.fn(() => 'sector-1') },
    showWarning: vi.fn(),
}));

vi.mock('@utils/pointer-utils', () => ({ getPointerPosition: vi.fn() }));

vi.mock('@tools', () => ({
    BaseControl: class {
        constructor(toolManager) {
            this.toolManager = toolManager;
            this.selectionManager = toolManager?.selectionManager;
            this.isActive = false;
        }
    },
    HatchPatternGenerator: class {},
}));

vi.mock('@js/draw_tools/sector_tool/sector_attributes_panel.js', () => ({
    addSectorAttributesToPanel: vi.fn(),
}));

vi.mock('@js/draw_tools/sector_tool/add_sector_geometry.js', () => ({
    default: class {
        normalizeCenter(center) { return center; }
        generate() { return { type: 'Polygon', coordinates: [] }; }
    },
}));

vi.mock('@js/snapping/snapping.service.js', () => ({ getSnappingService: vi.fn(() => null) }));

vi.mock('@tools/helpers/label-tab.helpers.js', () => ({
    LABEL_DEFAULT_PROPERTIES: { showLabel: false, labelText: '' },
    LABEL_ZOOM_PROPERTIES: {},
    // The label gate is exercised elsewhere; here it must never mask a lineStyle
    // change, so it always reports "unchanged".
    hasLabelChanged: vi.fn(() => false),
    recalcLabelSize: vi.fn(),
    createLabelZoomHandler: vi.fn(() => vi.fn()),
    syncLabelSource: vi.fn(),
}));

const { default: AddSectorControl } = await import('../../src/js/draw_tools/sector_tool/add_sector_control.js');

/** Baseline properties of a saved sector, matching the tool's defaults. */
function baseProperties() {
    return {
        id: 'sector-1',
        lineColor: '#3f4fb5',
        fillColor: '#3f4fb5',
        lineWidth: 2,
        lineStyle: 'solid',
        opacity: 0.5,
        radius: 1000,
        bearing: 0,
        aperture: 60,
        nome: 'Setor Alfa',
        descricao: '',
        visivel: true,
        bloqueado: false,
        hatchEnabled: false,
        hatchType: 'none',
        hatchColor: '#000000',
        hatchSpacing: 8,
        hatchLineWidth: 2,
        center: [-43.2, -22.9],
    };
}

/** Builds a feature plus its untouched initial snapshot, applying `changes`. */
function makePair(changes = {}) {
    const initialProperties = baseProperties();
    const feature = { type: 'Feature', properties: { ...baseProperties(), ...changes } };
    return { feature, initialProperties };
}

describe('AddSectorControl.hasFeatureChanged', () => {
    /** @type {any} */
    const control = new AddSectorControl({ selectionManager: null });

    it('reports NO change when nothing was edited', () => {
        const { feature, initialProperties } = makePair();
        expect(control.hasFeatureChanged(feature, initialProperties)).toBe(false);
    });

    it('detects a lineStyle change on its own (regression: dashed outline was lost)', () => {
        const { feature, initialProperties } = makePair({ lineStyle: 'dashed' });
        expect(control.hasFeatureChanged(feature, initialProperties)).toBe(true);
    });

    it('detects a lineStyle change back to solid', () => {
        const initialProperties = { ...baseProperties(), lineStyle: 'dotted' };
        const feature = { type: 'Feature', properties: baseProperties() };
        expect(control.hasFeatureChanged(feature, initialProperties)).toBe(true);
    });

    it('detects lineStyle appearing on a legacy feature that had none', () => {
        const initialProperties = baseProperties();
        delete initialProperties.lineStyle;
        const { feature } = makePair({ lineStyle: 'dashed' });
        expect(control.hasFeatureChanged(feature, initialProperties)).toBe(true);
    });

    it('treats a missing lineStyle on BOTH sides as unchanged (no false save)', () => {
        const initialProperties = baseProperties();
        delete initialProperties.lineStyle;
        const feature = { type: 'Feature', properties: baseProperties() };
        delete feature.properties.lineStyle;
        expect(control.hasFeatureChanged(feature, initialProperties)).toBe(false);
    });

    it('returns true when there is no initial snapshot at all', () => {
        const { feature } = makePair();
        expect(control.hasFeatureChanged(feature, undefined)).toBe(true);
    });

    // Neighbours of the new line, so a careless edit to the chain is caught.
    for (const [prop, value] of [
        ['lineWidth', 6],
        ['radius', 2000],
        ['lineColor', '#ff0000'],
    ]) {
        it(`still detects a ${prop} change`, () => {
            const { feature, initialProperties } = makePair({ [prop]: value });
            expect(control.hasFeatureChanged(feature, initialProperties)).toBe(true);
        });
    }
});

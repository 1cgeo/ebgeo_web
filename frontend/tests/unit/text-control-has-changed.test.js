// Path: tests/unit/text-control-has-changed.test.js

/**
 * @fileoverview Regression test for AddTextControl.hasFeatureChanged: the
 * "Correcao de zoom" toggle used to be absent from the dirty check, so turning
 * it off and pressing Salvar persisted nothing.
 */

import { describe, it, expect, vi } from 'vitest';

// The control pulls in the store, the utilities barrel and the `@tools` barrel,
// all of which reach DOM/MapLibre/IndexedDB. Mock them: hasFeatureChanged is a
// pure comparison and needs none of it.
vi.mock('@tools', () => ({
    BaseControl: class {
        constructor(toolManager) {
            this.toolManager = toolManager;
            this.selectionManager = toolManager?.selectionManager;
        }
    },
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));
vi.mock('@store', () => ({
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    removeFeature: vi.fn(),
    getActiveLayerIdSync: vi.fn(() => 'layer-1'),
}));
vi.mock('@utils', () => ({
    IDUtils: { generateId: () => 'id-1' },
}));
vi.mock('@utils/pointer-utils', () => ({
    getPointerPosition: vi.fn(() => ({ x: 0, y: 0 })),
}));
vi.mock('@js/draw_tools/text_tool/text_attributes_panel.js', () => ({
    addTextAttributesToPanel: vi.fn(),
}));

const { default: AddTextControl } = await import('@js/draw_tools/text_tool/add_text_control.js');

const control = new AddTextControl({ selectionManager: {} });

/**
 * Builds a feature/initial pair sharing every compared property, so only the
 * property under test can drive the result.
 * @param {Object} current - properties of the edited feature
 * @param {Object} initial - properties captured on selection
 * @returns {boolean} hasFeatureChanged verdict
 */
function changed(current, initial) {
    const base = { ...AddTextControl.DEFAULT_PROPERTIES, id: 't1' };
    return control.hasFeatureChanged(
        { properties: { ...base, ...current } },
        { ...base, ...initial },
    );
}

describe('AddTextControl.hasFeatureChanged — zoomCorrectionEnabled', () => {
    it('detects the toggle being turned off (the bug: it used to return false)', () => {
        expect(changed({ zoomCorrectionEnabled: false }, { zoomCorrectionEnabled: true })).toBe(true);
    });

    it('detects the toggle being turned back on', () => {
        expect(changed({ zoomCorrectionEnabled: true }, { zoomCorrectionEnabled: false })).toBe(true);
    });

    it('treats absent as enabled: undefined vs true is NOT a change', () => {
        // Legacy features carry no such key. A raw `a !== b` would mark every one
        // of them dirty on each deselect, emitting a pointless sync op.
        expect(changed({ zoomCorrectionEnabled: undefined }, { zoomCorrectionEnabled: true })).toBe(false);
        expect(changed({ zoomCorrectionEnabled: true }, { zoomCorrectionEnabled: undefined })).toBe(false);
    });

    it('treats absent on BOTH sides as unchanged', () => {
        expect(changed({ zoomCorrectionEnabled: undefined }, { zoomCorrectionEnabled: undefined })).toBe(false);
    });

    it('still reports a change when a legacy feature (no key) is turned off', () => {
        expect(changed({ zoomCorrectionEnabled: false }, { zoomCorrectionEnabled: undefined })).toBe(true);
    });

    it('reports no change when nothing at all was edited', () => {
        expect(changed({}, {})).toBe(false);
    });

    it('still reports a change on a property that was already compared', () => {
        expect(changed({ text: 'B' }, { text: 'A' })).toBe(true);
    });

    it('reports a change when there is no initial snapshot', () => {
        expect(control.hasFeatureChanged({ properties: { id: 't1' } }, undefined)).toBe(true);
    });
});

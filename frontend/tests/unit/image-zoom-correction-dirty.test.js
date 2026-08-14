// Path: tests/unit/image-zoom-correction-dirty.test.js

/**
 * AddImageControl.hasFeatureChanged gates saveFeatures. It ignored
 * `zoomCorrectionEnabled`, so toggling the zoom correction of an image and
 * pressing "Salvar" persisted nothing (the toggle only writes the map source).
 *
 * The flag defaults to ON by ABSENCE (the panel reads `!== false`), so the
 * comparison must be normalized: `undefined` and `true` are the same state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@store', () => ({
    addFeature: vi.fn(),
    updateFeature: vi.fn(),
    removeFeature: vi.fn(),
    storeImage: vi.fn(),
    getActiveLayerIdSync: vi.fn(() => 'layer-1')
}));
vi.mock('@utils', () => ({
    IDUtils: { generateUniqueId: vi.fn(), generateFeatureName: vi.fn() },
    showError: vi.fn(),
    loadImageToMap: vi.fn()
}));
vi.mock('@js/store/sync/image-sync.js', () => ({ uploadImageBlob: vi.fn() }));
vi.mock('@js/draw_tools/image_tool/image_attributes_panel.js', () => ({
    addImageAttributesToPanel: vi.fn()
}));
vi.mock('@tools', () => ({
    BaseControl: class {
        constructor(toolManager) {
            this.toolManager = toolManager;
            this.selectionManager = toolManager?.selectionManager;
        }
    },
    BaseGeometry: class {
        constructor(properties = {}) {
            this.properties = properties;
        }
    }
}));

const { default: AddImageControl } = await import('@js/draw_tools/image_tool/add_image_control.js');

/** @returns {Object} A GeoJSON-ish image feature with the given properties. */
function imageFeature(properties) {
    return { type: 'Feature', properties: { id: 'img-1', ...properties } };
}

const BASE = {
    size: 1,
    rotation: 0,
    opacity: 1,
    createdAtZoom: 12,
    nome: 'Foto',
    descricao: '',
    visivel: true,
    bloqueado: false
};

describe('AddImageControl.hasFeatureChanged — zoomCorrectionEnabled', () => {
    let control;

    beforeEach(() => {
        control = new AddImageControl({ selectionManager: null });
    });

    it('detects turning the zoom correction off', () => {
        const initial = { ...BASE, zoomCorrectionEnabled: true };
        const feature = imageFeature({ ...BASE, zoomCorrectionEnabled: false });

        expect(control.hasFeatureChanged(feature, initial)).toBe(true);
    });

    it('detects turning the zoom correction back on', () => {
        const initial = { ...BASE, zoomCorrectionEnabled: false };
        const feature = imageFeature({ ...BASE, zoomCorrectionEnabled: true });

        expect(control.hasFeatureChanged(feature, initial)).toBe(true);
    });

    // Edge case: legacy features carry no flag at all. Absence means ON, so a raw
    // `!==` would report a phantom change and save on every panel close.
    it('treats absent and true as the same state', () => {
        const initial = { ...BASE };
        const feature = imageFeature({ ...BASE, zoomCorrectionEnabled: true });

        expect(control.hasFeatureChanged(feature, initial)).toBe(false);
        expect(control.hasFeatureChanged(imageFeature({ ...BASE }), { ...BASE, zoomCorrectionEnabled: true })).toBe(false);
    });

    // Edge case: absence vs an explicit false IS a change (legacy feature turned off).
    it('detects absent -> false', () => {
        const initial = { ...BASE };
        const feature = imageFeature({ ...BASE, zoomCorrectionEnabled: false });

        expect(control.hasFeatureChanged(feature, initial)).toBe(true);
    });

    it('still reports no change when nothing moved, and a change on the old fields', () => {
        expect(control.hasFeatureChanged(imageFeature({ ...BASE }), { ...BASE })).toBe(false);
        expect(control.hasFeatureChanged(imageFeature({ ...BASE, rotation: 45 }), { ...BASE })).toBe(true);
    });

    it('reports a change when there is no initial snapshot at all', () => {
        expect(control.hasFeatureChanged(imageFeature({ ...BASE }), undefined)).toBe(true);
    });
});

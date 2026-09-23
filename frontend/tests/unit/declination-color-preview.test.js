// Path: tests/unit/declination-color-preview.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    generate: vi.fn(), update: vi.fn(),
    dispatcher: { flush: vi.fn(async () => {}), patch: vi.fn() },
}));
vi.mock('@tools', () => ({
    BaseControl: class { constructor(manager) { this.selectionManager = manager.selectionManager; } },
    BaseGeometry: class {},
    createModernSlider: vi.fn(), createModernToggle: vi.fn(), createModernButtons: vi.fn(),
    createModernInfoBox: vi.fn(), createModernColorPicker: vi.fn(),
}));
vi.mock('@store', () => ({ addFeature: vi.fn(), updateFeature: mocks.update, removeFeature: vi.fn(), storeImage: vi.fn(), getActiveLayerIdSync: vi.fn() }));
vi.mock('@utils', () => ({ IDUtils: {}, showError: vi.fn(), loadImageToMap: vi.fn() }));
vi.mock('@store/image-context.js', () => ({ beginImageTask: () => ({ assertCurrent() {}, isCurrent: () => true }) }));
vi.mock('@layers/geojson-dispatcher.js', () => ({ getGeoJsonDispatcher: () => mocks.dispatcher, destroyGeoJsonDispatcher: vi.fn() }));
vi.mock('@js/military_tools/bitmap-stamp.js', () => ({ stampRegeneratedBitmap: vi.fn() }));
vi.mock('@js/military_tools/declination_tool/declination_svg_generator.js', () => ({
    DEFAULT_DECLINATION_COLOR: '#0077CC', generateDeclinationBitmap: mocks.generate,
}));
import AddDeclinationControl from '@js/military_tools/declination_tool/add_declination_control.js';

function fixture() {
    const feature = { type: 'Feature', geometry: { type: 'Point', coordinates: [-47, -15] }, properties: {
        id: 'diagram', source: 'magnetic_declination', fillColor: '#0077CC', declination: -15,
        convergence: 1, size: 0.6, createdAtZoom: 10,
    } };
    const selected = structuredClone(feature);
    const control = new AddDeclinationControl({ selectionManager: { uiManager: {}, updateSelectedFeature: vi.fn() } });
    control.map = { getZoom: () => 10, getSource: () => ({ getData: async () => ({ features: [feature] }) }) };
    return { control, selected, feature };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.generate.mockResolvedValue({ blob: new Blob(), width: 260, height: 378, pixelRatio: 2 });
});

describe('declination color: pending edits and automatic regeneration', () => {
    it('a persisted blue echo cannot overwrite an unsaved red preview', async () => {
        const { control, selected } = fixture();
        const echo = structuredClone(selected);
        const updating = control.updateFeaturesProperty([selected], 'fillColor', '#C01830');
        await control.regenerateIcon(echo);
        await updating;
        expect(mocks.generate.mock.calls.every(([props]) => props.fillColor === '#C01830')).toBe(true);
        expect(echo.properties.fillColor).toBe('#0077CC');
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('discard restores legacy blue and removes the pending preview', async () => {
        const { control, selected } = fixture();
        const initial = { ...selected.properties };
        delete initial.fillColor;
        await control.updateFeaturesProperty([selected], 'fillColor', '#C01830');
        await control.discardChangeFeatures([selected], new Map([['diagram', initial]]));
        expect(mocks.generate.mock.lastCall[0].fillColor).toBe('#0077CC');
        expect(selected.properties).not.toHaveProperty('fillColor');
        expect(control._colorPreviews.size).toBe(0);
    });
});

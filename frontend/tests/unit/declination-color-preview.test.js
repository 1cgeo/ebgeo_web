// Path: tests/unit/declination-color-preview.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    generate: vi.fn(), update: vi.fn(),
    /** Every store and source write, in the order they happened. */
    ordem: [],
    updateMany: vi.fn(),
    dispatcher: { flush: vi.fn(async () => {}), patch: vi.fn(), add: vi.fn() },
}));
vi.mock('@tools', () => ({
    // The two defaults of the real `tool_manager/base_control.js` that this control overrides, so a
    // control without its override behaves here as it does in the app (a no-op write, "changed").
    BaseControl: class {
        constructor(manager) { this.selectionManager = manager.selectionManager; }
        async updateFeatures() {}
        hasFeatureChanged() { return true; }
    },
    BaseGeometry: class {},
    createModernSlider: vi.fn(), createModernToggle: vi.fn(), createModernButtons: vi.fn(),
    createModernInfoBox: vi.fn(), createModernColorPicker: vi.fn(),
}));
vi.mock('@store', () => ({
    addFeature: vi.fn(), updateFeature: mocks.update, removeFeature: vi.fn(), storeImage: vi.fn(), getActiveLayerIdSync: vi.fn(),
    updateFeatures: mocks.updateMany,
}));
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
    mocks.ordem.length = 0;
    mocks.updateMany.mockImplementation(async (writes) => { mocks.ordem.push(['store', writes]); });
    mocks.dispatcher.add.mockImplementation((features) => { mocks.ordem.push(['fonte', features]); });
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

describe('the drag persists itself, and a panel save writes only what the panel edited (2026-09-25)', () => {
    /** The fixture with a stand-in geometry: the selection box is not the subject here. */
    function fixtureDeArrasto() {
        const f = fixture();
        f.control.geometry = { calculateSelectionBoxGeometry: () => null, generate: (c) => ({ type: 'Point', coordinates: c }) };
        return f;
    }

    it('REPRO: the drag writes the STORE, and before the source', async () => {
        // The move handler persists through `updateSelectedFeatures` -> `updateFeatures(features,
        // true)`. The control had none, the empty one of BaseControl ran, and the drag only
        // patched the source (`tests/e2e-ui/declinacao-arrasto-grava.repro.spec.js`).
        const { control, feature } = fixtureDeArrasto();
        const moved = structuredClone(feature);
        moved.geometry.coordinates = [-46, -14];
        await control.updateFeatures([moved], true);
        expect(mocks.ordem.map(([onde]) => onde)).toEqual(['store', 'fonte']);
        const [[, writes]] = mocks.ordem;
        expect(writes).toHaveLength(1);
        expect(writes[0].type).toBe('magnetic_declinations');
        expect(writes[0].feature.geometry.coordinates).toEqual([-46, -14]);
    });

    it('an id the source does not have is skipped, never created', async () => {
        const { control, feature } = fixtureDeArrasto();
        const stranger = structuredClone(feature);
        stranger.properties.id = 'nobody';
        await control.updateFeatures([stranger], true);
        expect(mocks.ordem).toEqual([]);
    });

    it('without `save` the source is written and the store is not', async () => {
        const { control, feature } = fixtureDeArrasto();
        await control.updateFeatures([structuredClone(feature)], false);
        expect(mocks.ordem.map(([onde]) => onde)).toEqual(['fonte']);
    });

    it('the moved feature carries the WMM of the NEW position, so the drag is one write', () => {
        const { control, feature } = fixtureDeArrasto();
        const moved = control.updateFeatureForMove(feature, 0, 0, { lng: -46, lat: -14 });
        expect(moved.geometry.coordinates).toEqual([-46, -14]);
        expect(moved.properties.latitude).toBe(-14);
        expect(moved.properties.longitude).toBe(-46);
        expect(Number.isFinite(moved.properties.declination)).toBe(true);
        expect(moved.properties.declination).not.toBe(feature.properties.declination);
    });

    it('REPRO: a panel with no pending edit does not count as changed, and its save writes nothing', async () => {
        const { control, selected } = fixture();
        const initial = structuredClone(selected.properties);
        expect(control.hasFeatureChanged(selected, initial)).toBe(false);
        await control.saveFeatures([selected], new Map([['diagram', initial]]));
        expect(mocks.updateMany).toHaveBeenCalledWith([]);
    });

    it('CONTROL: an edit made through the panel counts, and its save writes', async () => {
        const { control, selected } = fixtureDeArrasto();
        const initial = structuredClone(selected.properties);
        await control.updateFeaturesProperty([selected], 'opacity', 0.5);
        expect(control.hasFeatureChanged(selected, initial)).toBe(true);
        await control.saveFeatures([selected], new Map([['diagram', initial]]));
        expect(mocks.updateMany.mock.lastCall[0]).toHaveLength(1);
    });

    it('with no snapshot to compare against, it counts as changed, as before', () => {
        const { control, selected } = fixture();
        expect(control.hasFeatureChanged(selected, undefined)).toBe(true);
    });
});

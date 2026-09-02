// Path: tests/integration/colar-simbolo-por-feicao.repro.test.js

/**
 * Regression test for pasted coordination measures and magnetic declinations
 * rendering as nothing at all.
 *
 * Root cause: the symbol layers name their icon after the feature itself
 * ('icon-image': ['get', 'id']), so a pasted feature is invisible until an
 * image is registered under its NEW id. paste() already duplicates the stored
 * blob under the new id (hasImageResource covers all four image-backed types),
 * but loadPastedImages() then walked a CLOSED list of two buckets,
 *
 *     [...(byType.images || []), ...(byType.military_symbols || [])]
 *
 * written before coordination measures and magnetic declinations existed. Those
 * two buckets were never visited, addImage was never called for them, and
 * MapLibre logged 'Image ... could not be loaded'. A reload fixed it because
 * layer_setup.setImages walked a different, complete list.
 *
 * The fix routes both paths through collectImageResourceIds, derived from
 * IMAGE_RESOURCE_FEATURE_TYPES, so there is no second list to forget.
 *
 * Negative control: revert loadPastedImages to the two-bucket literal and the
 * first two cases below go red with zero calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// clipboard_manager pulls the store and utilities barrels (IndexedDB, toasts)
// and the point-marker modules (canvas). None of them take part in the image
// bucket walk under test, so they are stubbed away to keep this node-testable.
vi.mock('@js/store/index.js', () => ({
    addFeatures: vi.fn(),
    getImage: vi.fn(),
    getCurrentMapNameSync: vi.fn(() => 'Principal'),
    getStorageTypeFromSource: vi.fn((type) => type + 's'),
    getSourceTypeFromStorage: vi.fn((type) => type),
    isUncopyableFeatureType: vi.fn(() => false),
    hasImageResource: vi.fn(() => true),
    getStateManager: vi.fn(() => ({})),
    isCurrentMapLockedSync: vi.fn(() => false),
    buildLayerMappingForMove: vi.fn(),
    getLayers: vi.fn(() => [])
}));

vi.mock('@js/utilities/index.js', () => ({
    IDUtils: {
        generateUniqueId: vi.fn(() => 'novo-id'),
        generateGeoJSONId: vi.fn(() => 1),
        generateFeatureName: vi.fn(async () => 'Feição'),
        duplicateImageResource: vi.fn()
    },
    ToastService: { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() }
}));

vi.mock('@js/draw_tools/point_tool/point-marker-symbols.js', () => ({
    generatePointImage: vi.fn(() => ({})),
    needsPerFeatureImage: vi.fn(() => false)
}));

vi.mock('@js/draw_tools/point_tool/point-custom-icons.js', () => ({
    parseCustomMarker: vi.fn(() => null),
    registerCustomFeatureImage: vi.fn(async () => {})
}));

import ClipboardManager from '@js/tool_manager/clipboard_manager.js';
import { IMAGE_RESOURCE_STORAGE_TYPES } from '@js/store/store.constants.js';

/** @returns {Object} a minimal feature carrying only what the walk reads */
function featureWithId(id) {
    return { type: 'Feature', properties: { id, nome: 'x' }, geometry: null };
}

let manager;
let map;

beforeEach(() => {
    map = {
        hasImage: vi.fn(() => false),
        addImage: vi.fn(),
        removeImage: vi.fn()
    };
    manager = new ClipboardManager(null, map);
    vi.spyOn(manager, 'loadSingleImageForPaste').mockResolvedValue();
});

/** @returns {string[]} the ids the manager asked MapLibre to load */
function requestedIds() {
    return manager.loadSingleImageForPaste.mock.calls.map(call => call[0]);
}

describe('ClipboardManager.loadPastedImages', () => {
    it('registers an image for a pasted coordination measure and magnetic declination', async () => {
        // This is the bug, verbatim: two buckets the closed list never visited.
        await manager.loadPastedImages({
            coordination_measures: [featureWithId('medida-nova')],
            magnetic_declinations: [featureWithId('declinacao-nova')]
        });

        expect(requestedIds()).toEqual(['medida-nova', 'declinacao-nova']);
    });

    it('registers an image for every image-backed bucket at once', async () => {
        await manager.loadPastedImages({
            images: [featureWithId('img-nova')],
            military_symbols: [featureWithId('simbolo-novo')],
            coordination_measures: [featureWithId('medida-nova')],
            magnetic_declinations: [featureWithId('declinacao-nova')]
        });

        expect(requestedIds()).toEqual([
            'img-nova', 'simbolo-novo', 'medida-nova', 'declinacao-nova'
        ]);
    });

    it('still registers the two buckets the closed list did cover', async () => {
        await manager.loadPastedImages({
            images: [featureWithId('img-nova')],
            military_symbols: [featureWithId('simbolo-novo')]
        });

        expect(requestedIds()).toEqual(['img-nova', 'simbolo-novo']);
    });

    it('asks for nothing when no bucket carries an image-backed feature', async () => {
        await manager.loadPastedImages({ lines: [featureWithId('linha-nova')] });

        expect(requestedIds()).toEqual([]);
    });

    it('skips an id MapLibre already has registered', async () => {
        map.hasImage = vi.fn((id) => id === 'medida-nova');

        await manager.loadPastedImages({
            coordination_measures: [featureWithId('medida-nova')],
            magnetic_declinations: [featureWithId('declinacao-nova')]
        });

        expect(requestedIds()).toEqual(['declinacao-nova']);
    });

    it('covers every image-backed bucket the store declares, one at a time', async () => {
        // Guards the next feature type that draws an image under its own id:
        // adding it to IMAGE_RESOURCE_FEATURE_TYPES must be enough.
        expect(IMAGE_RESOURCE_STORAGE_TYPES.length).toBeGreaterThan(0);

        for (const storageType of IMAGE_RESOURCE_STORAGE_TYPES) {
            manager.loadSingleImageForPaste.mockClear();

            await manager.loadPastedImages({ [storageType]: [featureWithId('id-de-' + storageType)] });

            expect(requestedIds()).toEqual(['id-de-' + storageType]);
        }
    });
});

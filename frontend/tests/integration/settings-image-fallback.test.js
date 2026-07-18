// Path: tests/integration/settings-image-fallback.test.js
// §17.14: getImage (the image-feature blob getter) falls back to the backend when a
// referenced photo is not cached locally (the imageId is the backend image id for
// online-created features), caching it for subsequent renders.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ images: new Map(), fetchImageBlob: vi.fn() }));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    deleteImageCompat: async (id) => { h.images.delete(id); },
    getGridStyleCompat: vi.fn(),
    getImageCompat: async (id) => h.images.get(id) || null,
    getMapDataCompat: vi.fn(),
    getMapNotesCompat: vi.fn(),
    hasImageCompat: async (id) => h.images.has(id),
    saveImageCompat: async (id, b) => { h.images.set(id, b); },
    setGridStyleCompat: vi.fn(),
    setMapNotesCompat: vi.fn(),
    updateMapDataCompat: vi.fn(),
}));
vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    fetchImageBlob: (...a) => h.fetchImageBlob(...a),
}));
// Stub the rest of the module's import graph so it loads in the node env.
vi.mock('../../src/js/catalog/catalog.constants.js', () => ({ CATALOG_ITEM_TYPES: {} }));
vi.mock('../../src/js/store/catalog.operations.js', () => ({ getCatalogLayers: vi.fn() }));
vi.mock('../../src/js/store/map.operations.js', () => ({ isCurrentMapLockedSync: () => false }));
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({ mapResolver: { resolveToId: (x) => x } }));
vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: {} }));
vi.mock('../../src/js/store/sync/index.js', () => ({
    logGridStyleOperation: vi.fn(),
    logMapNotesOperation: vi.fn(),
    OperationType: { UPDATE: 'update' },
}));

import { getImage, storeImage } from '../../src/js/store/settings.operations.js';

beforeEach(() => {
    h.images.clear();
    h.fetchImageBlob.mockReset();
});

const blob = () => new Blob([new Uint8Array([9])], { type: 'image/png' });

describe('settings.operations image multiuser fallback (§17.14)', () => {
    it('getImage returns the local blob without hitting the backend', async () => {
        const b = blob();
        await storeImage('img-1', b);
        expect(await getImage('img-1')).toBe(b);
        expect(h.fetchImageBlob).not.toHaveBeenCalled();
    });

    it('getImage fetches from the backend and caches when missing locally', async () => {
        const remote = blob();
        h.fetchImageBlob.mockResolvedValue(remote);
        expect(await getImage('backend-img')).toBe(remote);
        expect(h.fetchImageBlob).toHaveBeenCalledWith('backend-img');
        // Cached now → a second render does not re-fetch.
        expect(await getImage('backend-img')).toBe(remote);
        expect(h.fetchImageBlob).toHaveBeenCalledTimes(1);
    });

    it('getImage returns null when neither local nor backend has it', async () => {
        h.fetchImageBlob.mockResolvedValue(null);
        expect(await getImage('ghost')).toBeNull();
    });
});

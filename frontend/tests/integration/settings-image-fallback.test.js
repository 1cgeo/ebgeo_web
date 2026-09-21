// Path: tests/integration/settings-image-fallback.test.js
// §17.14: getImage (the image-feature blob getter) falls back to the backend when a
// referenced photo is not cached locally (the imageId is the backend image id for
// online-created features), caching it for subsequent renders.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ images: new Map(), fetchImageBlob: vi.fn(), beforeRead: null }));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    deleteImageCompat: async (id) => { h.images.delete(id); },
    getGridStyleCompat: vi.fn(),
    getImageCompat: async (id) => { await h.beforeRead?.(); return h.images.get(id) || null; },
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
// `isTargetMapLocked` entrou em 2026-09-21 (ponto N3): `setMapNotes` e `setGridStyle` passaram a
// perguntar pela trava do mapa ALVO, lida do DISCO, no lugar de `isCurrentMapLockedSync()`, que
// respondia sobre o mapa corrente. Aqui a trava fica aberta: este arquivo mede outro eixo.
vi.mock('../../src/js/store/map.operations.js', () => ({ isTargetMapLocked: async () => false }));
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({ mapResolver: { resolveToId: (x) => x } }));
vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: {} }));
vi.mock('../../src/js/store/sync/index.js', () => ({
    logGridStyleOperation: vi.fn(),
    logMapNotesOperation: vi.fn(),
    OperationType: { UPDATE: 'update' },
}));

import { activateScope, localScope } from '../../src/js/store/atlas-namespace.js';
import { getImage, storeImage } from '../../src/js/store/settings.operations.js';

beforeEach(() => {
    h.images.clear();
    h.beforeRead = null;
    activateScope(localScope('images-a', 'images-a'));
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


it('does not cache or return a response from an unmounted atlas', async () => {
    let finish;
    h.fetchImageBlob.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = getImage('same-id');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    activateScope(localScope('images-b', 'images-b'));
    const own = blob();
    h.images.set('same-id', own);
    finish(blob());
    expect(await pending).toBeNull();
    expect(h.images.get('same-id')).toBe(own);
});

it('does not start a backend fetch after the local read crossed an atlas switch', async () => {
    h.beforeRead = () => activateScope(localScope('images-b', 'images-b'));
    expect(await getImage('absent')).toBeNull();
    expect(h.fetchImageBlob).not.toHaveBeenCalled();
});

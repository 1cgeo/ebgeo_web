// Path: tests/integration/customIcons.operations.test.js
// §17.19: custom marker icons become multiuser resources — when online the blob is
// uploaded so its id IS the backend image id (referenced on the feature), and a
// collaborator missing the blob locally fetches it from the backend on render.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
    settings: new Map(),
    images: new Map(),
    uploadImageBlob: vi.fn(),
    fetchImageBlob: vi.fn(),
}));

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getSettingCompat: async (k) => h.settings.get(k),
    setSettingCompat: async (k, v) => { h.settings.set(k, v); },
    saveImageCompat: async (id, blob) => { h.images.set(id, blob); },
    getImageCompat: async (id) => h.images.get(id) || null,
    deleteImageCompat: async (id) => { h.images.delete(id); },
}));
vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => ({ on: vi.fn(), emit: vi.fn() }),
}));
vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    uploadImageBlob: (...a) => h.uploadImageBlob(...a),
    fetchImageBlob: (...a) => h.fetchImageBlob(...a),
}));
vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: () => 'local-uuid',
}));

import { addCustomIcon, getCustomIconBlob } from '../../src/js/store/customIcons.operations.js';

beforeEach(() => {
    h.settings.clear();
    h.images.clear();
    h.uploadImageBlob.mockReset();
    h.fetchImageBlob.mockReset();
});

const blob = () => new Blob([new Uint8Array([1, 2])], { type: 'image/png' });

describe('customIcons multiuser (§17.19)', () => {
    it('addCustomIcon uploads to the backend and uses the backend id when online', async () => {
        h.uploadImageBlob.mockResolvedValue({ id: 'backend-img' });
        const b = blob();
        const entry = await addCustomIcon({ name: 'Tank', blob: b, thumbnail: 'data:img' });
        expect(h.uploadImageBlob).toHaveBeenCalledWith(b, 'Tank.png');
        expect(entry.id).toBe('backend-img');         // feature.markerSymbol references this id
        expect(h.images.get('backend-img')).toBe(b);  // cached locally under the same id
        expect(h.settings.get('custom_icons').some((e) => e.id === 'backend-img')).toBe(true);
    });

    it('addCustomIcon falls back to a local UUID when offline (upload returns null)', async () => {
        h.uploadImageBlob.mockResolvedValue(null);
        const entry = await addCustomIcon({ name: 'X', blob: blob(), thumbnail: 't' });
        expect(entry.id).toBe('local-uuid');
        expect(h.images.has('local-uuid')).toBe(true);
    });

    it('getCustomIconBlob returns the local blob when present (no backend call)', async () => {
        const b = blob();
        h.images.set('id-1', b);
        expect(await getCustomIconBlob('id-1')).toBe(b);
        expect(h.fetchImageBlob).not.toHaveBeenCalled();
    });

    it('getCustomIconBlob fetches from the backend and caches when missing locally', async () => {
        const remote = blob();
        h.fetchImageBlob.mockResolvedValue(remote);
        const out = await getCustomIconBlob('backend-img');
        expect(h.fetchImageBlob).toHaveBeenCalledWith('backend-img');
        expect(out).toBe(remote);
        expect(h.images.get('backend-img')).toBe(remote); // cached for next render
    });

    it('getCustomIconBlob returns null when neither local nor backend has it', async () => {
        h.fetchImageBlob.mockResolvedValue(null);
        expect(await getCustomIconBlob('ghost')).toBeNull();
    });
});

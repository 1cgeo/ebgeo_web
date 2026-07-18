// Path: tests/integration/image-sync.test.js
// §17.14/§17.19: the image gateway uploads/fetches blobs to/from the backend, gated
// on a connected atlas, and degrades to null (never throws) so the UI can fall back.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ uploadImage: vi.fn(), fetchImageBlob: vi.fn() }));
vi.mock('../../src/js/store/sync/api-client.js', () => ({
    apiClient: {
        uploadImage: (...a) => h.uploadImage(...a),
        fetchImageBlob: (...a) => h.fetchImageBlob(...a),
    },
}));

import {
    setImageSyncAtlas,
    isImageSyncOnline,
    uploadImageBlob,
    fetchImageBlob,
} from '../../src/js/store/sync/image-sync.js';

beforeEach(() => {
    h.uploadImage.mockReset();
    h.fetchImageBlob.mockReset();
    setImageSyncAtlas(null);
});

describe('image-sync gateway (§17.14/§17.19)', () => {
    it('is offline until an atlas is set, online after', () => {
        expect(isImageSyncOnline()).toBe(false);
        setImageSyncAtlas('atlas-1');
        expect(isImageSyncOnline()).toBe(true);
        setImageSyncAtlas(null);
        expect(isImageSyncOnline()).toBe(false);
    });

    it('uploadImageBlob is a no-op (null) when offline', async () => {
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
        expect(await uploadImageBlob(blob)).toBeNull();
        expect(h.uploadImage).not.toHaveBeenCalled();
    });

    it('uploadImageBlob delegates to apiClient when online', async () => {
        setImageSyncAtlas('atlas-1');
        h.uploadImage.mockResolvedValue({ id: 'img-9' });
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
        expect(await uploadImageBlob(blob, 'icon.png')).toEqual({ id: 'img-9' });
        expect(h.uploadImage).toHaveBeenCalledWith('atlas-1', blob, 'icon.png');
    });

    it('uploadImageBlob swallows errors (returns null)', async () => {
        setImageSyncAtlas('atlas-1');
        h.uploadImage.mockRejectedValue(new Error('network'));
        const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
        expect(await uploadImageBlob(blob)).toBeNull();
    });

    it('fetchImageBlob is null offline, delegates online', async () => {
        expect(await fetchImageBlob('img-9')).toBeNull();
        expect(h.fetchImageBlob).not.toHaveBeenCalled();

        setImageSyncAtlas('atlas-1');
        const blob = new Blob([new Uint8Array([2])], { type: 'image/png' });
        h.fetchImageBlob.mockResolvedValue(blob);
        expect(await fetchImageBlob('img-9')).toBe(blob);
        expect(h.fetchImageBlob).toHaveBeenCalledWith('atlas-1', 'img-9');
    });

    it('fetchImageBlob swallows errors (returns null)', async () => {
        setImageSyncAtlas('atlas-1');
        h.fetchImageBlob.mockRejectedValue(new Error('404'));
        expect(await fetchImageBlob('x')).toBeNull();
    });
});

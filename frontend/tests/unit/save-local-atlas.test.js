import { describe, it, expect, vi } from 'vitest';

// The service imports @store (getImage/getAllMapNamesStore) at module load; stub it so this pure
// transport test doesn't pull the whole store graph.
vi.mock('@store', () => ({ getImage: vi.fn(), getAllMapNamesStore: vi.fn() }));

import { uploadImagesInChunks } from '../../src/js/import_export/atlas-image-upload.js';

describe('uploadImagesInChunks', () => {
    it('chunks uploads into batches of <=50 and merges the mappings', async () => {
        const uploads = Array.from({ length: 120 }, (_, i) => ({ localId: `id-${i}` }));
        const api = {
            bulkUploadImages: vi.fn(async (_atlasId, chunk) => ({
                mapping: Object.fromEntries(chunk.map((u) => [u.localId, u.localId])),
                failed: [],
            })),
        };
        const { mapping, failed } = await uploadImagesInChunks(api, 'atlas-1', uploads);
        expect(api.bulkUploadImages).toHaveBeenCalledTimes(3); // 50 + 50 + 20
        expect(api.bulkUploadImages.mock.calls[0][1]).toHaveLength(50);
        expect(api.bulkUploadImages.mock.calls[2][1]).toHaveLength(20);
        expect(Object.keys(mapping)).toHaveLength(120);
        expect(failed).toHaveLength(0);
    });

    it('accumulates failed entries across chunks', async () => {
        const uploads = Array.from({ length: 3 }, (_, i) => ({ localId: `id-${i}` }));
        const api = {
            bulkUploadImages: vi.fn(async (_atlasId, chunk) => ({
                mapping: {},
                failed: chunk.map((u) => ({ localId: u.localId, error: 'bad' })),
            })),
        };
        const { failed } = await uploadImagesInChunks(api, 'a', uploads);
        expect(failed).toHaveLength(3);
    });

    it('makes no API call for an empty upload list', async () => {
        const api = { bulkUploadImages: vi.fn() };
        const { mapping, failed } = await uploadImagesInChunks(api, 'a', []);
        expect(api.bulkUploadImages).not.toHaveBeenCalled();
        expect(mapping).toEqual({});
        expect(failed).toEqual([]);
    });
});

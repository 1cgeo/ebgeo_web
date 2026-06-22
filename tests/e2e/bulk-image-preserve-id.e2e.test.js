// Path: tests/e2e/bulk-image-preserve-id.e2e.test.js

/**
 * @fileoverview Real-backend E2E for the image phase of "Salvar atlas local no servidor":
 * `bulkUploadImages` must PRESERVE the client-provided `localId` as the server image id, so an
 * image feature's blob ref (which equals its feature id) stays valid with no post-import rewrite,
 * and a peer can fetch the blob by that same id (P11).
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { E2E_SKIP, makeApi, registerAndLogin, createAtlas } from './helpers/harness.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

// A valid 1x1 transparent PNG (passes the backend magic-byte check).
const PNG_1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe.skipIf(E2E_SKIP)('E2E bulk image upload preserves client id', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Img E2E' });
        const atlas = await createAtlas(api, { name: 'Img Atlas' });
        atlasId = atlas.id;
    });

    it('stores the image under the client localId (mapping is identity)', async () => {
        const localId = generateUUID();
        const res = await api.bulkUploadImages(atlasId, [
            { localId, filename: 'a.png', mimeType: 'image/png', data: PNG_1x1 },
        ]);
        expect(res.mapping[localId]).toBe(localId);
        expect(res.uploaded).toHaveLength(1);
        expect(res.uploaded[0].serverId).toBe(localId);
        expect(res.failed).toHaveLength(0);
    });

    it('serves the uploaded image back by that same id', async () => {
        const localId = generateUUID();
        await api.bulkUploadImages(atlasId, [
            { localId, filename: 'b.png', mimeType: 'image/png', data: PNG_1x1 },
        ]);
        const blob = await api.fetchImageBlob(atlasId, localId);
        expect(blob).toBeTruthy();
        expect(blob.size).toBeGreaterThan(0);
    });
});

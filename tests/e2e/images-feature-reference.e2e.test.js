// Path: tests/e2e/images-feature-reference.e2e.test.js
// §17.14/§17.19: feature photos and custom marker icons are user resources uploaded
// to the backend images endpoint; the feature references the returned id in its
// properties and that round-trips through sync. Proves the backend contract is
// complete end-to-end (the frontend just needs to wire the upload UI).

import { describe, it, expect, beforeAll } from 'vitest';
import { makeApi, registerAndLogin, createAtlas, createMap, getBaseUrl, E2E_SKIP } from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

// A 1×1 transparent PNG (valid magic bytes, passes the backend allowlist + sniff).
const PNG_1x1 = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
);

describe.skipIf(E2E_SKIP)('e2e: image upload + feature reference (§17.14/§17.19)', () => {
    let api, token, atlasId, mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Image Tester' });
        token = api.getAccessToken();
        const atlas = await createAtlas(api, { name: 'Image Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Imagens' });
    });

    /** Uploads a file to the images endpoint via real multipart. */
    async function uploadImage(bytes, type, name) {
        const fd = new FormData();
        fd.append('image', new Blob([bytes], { type }), name);
        const res = await fetch(`${getBaseUrl()}/api/v1/atlas/${atlasId}/images`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: fd,
        });
        return res;
    }

    it('uploads a PNG, references it on a feature, and the reference round-trips', async () => {
        const up = await uploadImage(PNG_1x1, 'image/png', 'icon.png');
        expect(up.status).toBe(201);
        const imageId = (await up.json()).data.id;
        expect(imageId).toBeTruthy();

        // The image is retrievable (served as an attachment).
        const get = await fetch(`${getBaseUrl()}/api/v1/atlas/${atlasId}/images/${imageId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(get.status).toBe(200);

        // A point feature references the uploaded icon via its properties; it round-trips.
        const fId = generateUUID();
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { id: fId, source: 'point', markerSymbol: imageId, photoId: imageId },
        };
        await api.pushOperations(atlasId, [createOperation('feature', 'create', fId, mapId, feature)]);

        const snap = await api.pullSync(atlasId, 0);
        const pt = snap.snapshot.maps.find((m) => m.id === mapId).features.points.find((p) => p.properties.id === fId);
        expect(pt).toBeTruthy();
        expect(pt.properties.markerSymbol).toBe(imageId);
        expect(pt.properties.photoId).toBe(imageId);
    });

    it('rejects a disallowed type (SVG) with 400 — anti-XSS allowlist (negative)', async () => {
        const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
        const res = await uploadImage(svg, 'image/svg+xml', 'evil.svg');
        expect(res.status).toBe(400);
    });

    it('deletes the image (hard-delete) so it is no longer retrievable', async () => {
        const up = await uploadImage(PNG_1x1, 'image/png', 'tmp.png');
        const imageId = (await up.json()).data.id;

        const del = await fetch(`${getBaseUrl()}/api/v1/atlas/${atlasId}/images/${imageId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(del.status).toBe(204);

        const get = await fetch(`${getBaseUrl()}/api/v1/atlas/${atlasId}/images/${imageId}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(get.status).toBe(404);
    });
});

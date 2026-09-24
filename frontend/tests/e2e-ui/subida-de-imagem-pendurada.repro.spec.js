// Path: e2e-ui/subida-de-imagem-pendurada.repro.spec.js

/**
 * REPRO: an image upload that never gets an answer (a half-open connection, a proxy holding the
 * request) held the image forever, and with it every edit made after it.
 *
 * The bytes travel by `POST /images/bulk` (`bulkUploadImages`, `store/sync/api-client.js`), which
 * had no deadline at all, and the image tool awaits the upload BEFORE it writes the feature
 * (`add_image_control.js`), so a request that never answered meant a picture that never appeared.
 * And even with a deadline the durable blob queue only resumed on a CONNECT or on the transition
 * back to ONLINE (`image-sync.js`): an HTTP request that hangs while the collab socket stays up
 * has neither, so the pendency would sit there, the feature operation prepared, and the
 * head-of-line hold of `_loadOperations` would keep every later edit on this machine.
 *
 * The hang is real: the first bulk request is intercepted and simply never answered, while the
 * WebSocket keeps working. Every later request passes.
 */

import { collabTest, expect, readFeatures, drawLineUI } from './helpers/collab.fixtures.js';
import { realFeature } from '../helpers/real-fixtures.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(240000);

collabTest('uma subida de imagem pendurada não segura a imagem nem as edições seguintes', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const bulk = [];
    let holdFirst = true;
    await A.route('**/atlas/*/images/bulk', async (route) => {
        const entry = { at: Date.now(), outcome: 'held' };
        bulk.push(entry);
        if (holdFirst) {
            holdFirst = false;
            return; // Never answered: the request hangs until the client gives up on it.
        }
        entry.outcome = 'passed';
        return route.continue();
    });
    const t0 = Date.now();

    // The image tool's own order: mint the id, store the bytes, upload (awaited), write the feature.
    const imageId = await A.evaluate(async (base) => {
        const store = await import('/src/js/store/index.js');
        const { uploadImageBlob } = await import('/src/js/store/sync/image-sync.js');
        const { generateUUID } = await import('/src/js/utilities/uuid.js');
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgb(255, 0, 170)';
        ctx.fillRect(0, 0, 8, 8);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const id = generateUUID();
        await store.storeImage(id, blob);
        window.__gesto = (async () => {
            await uploadImageBlob(blob, id, { origem: 'feicao-de-imagem' });
            await store.addFeature('images', { ...base, id, properties: { ...base.properties, id, nome: 'Foto' } });
            return 'escrita';
        })().catch((e) => `erro: ${e?.message}`);
        return id;
    }, realFeature('image', {
        width: 64, height: 64, size: 1, rotation: 0, opacity: 1,
        createdAtZoom: 0, calculatedSize: 1, zoomCorrectionEnabled: true, selectionBox: null,
    }));
    await expect.poll(() => bulk.length, { timeout: 15000 }).toBe(1);

    const onA = async () => (await readFeatures(A, 'images')).some((f) => f.id === imageId);
    const onServer = async () => Boolean(await collab.db.queryFeatureRow(imageId));
    try {
        // 1) The gesture completes: the picture appears for its author.
        await expect.poll(onA, { timeout: 90000, intervals: [2000] }).toBe(true);
        // 2) The bytes are resumed under the SAME id, and the operation leaves.
        await expect.poll(onServer, { timeout: 90000, intervals: [2000] }).toBe(true);
        const row = await collab.db.raw.oneOrNone('SELECT id FROM images WHERE id = $1', [imageId]);
        expect(row?.id, 'the bytes are on the server under the id the feature carries').toBe(imageId);
        // 3) An edit made afterwards is not held behind it.
        const line = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
        await collab.expectFullSync({ entityId: line, type: 'lines', operationType: 'create' });
        await expect.poll(async () => (await readFeatures(B, 'images')).some((f) => f.id === imageId), { timeout: 30000 }).toBe(true);
    } finally {
        const gesto = await A.evaluate(() => Promise.race([window.__gesto, new Promise((r) => setTimeout(() => r('pendente'), 50))]));
        console.log(`SUBIDA_PENDURADA gesto=${gesto} bulk=${JSON.stringify(bulk.map((b) => ({ at: b.at - t0, outcome: b.outcome })))}`);
    }
});

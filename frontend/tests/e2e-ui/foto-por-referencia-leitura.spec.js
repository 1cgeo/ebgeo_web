// Path: e2e-ui/foto-por-referencia-leitura.spec.js

/**
 * FASE 2a DAS FOTOS ANEXAS: toda superfície lê a foto nos dois formatos (2026-09-24).
 *
 * A photo held BY REFERENCE (`{ id, name, thumbnail }`, no `data`) is seeded the way phase 2b will
 * write it: the bytes go to the author's image store and to the server by the bulk route (which
 * keeps the id), and the feature gets only the reference. Before this phase every viewer did
 * `img.src = imageData.data`, which for such a photo is `undefined`: an empty viewer, and a download
 * that refused. The cases check what the person sees, on the author and on the colleague, through
 * the real panel: the thumbnail in the grid, the WHOLE photo in the viewer (its natural width is
 * the photo's, not the thumbnail's), the download, and the notice when the bytes did not arrive.
 */

import { collabTest, expect, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';
import { selectFeatureUI } from './helpers/collab-helpers.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(180000);

const LARGURA = 640;
const ALTURA = 480;

/** Makes a photo in the page, stores it and uploads it under `id`; returns its reference item. */
async function semearFotoPorReferencia(page, atlasId, { subir = true } = {}) {
    return page.evaluate(async ({ atlasId, largura, altura, subir }) => {
        const store = await import('/src/js/store/index.js');
        const { apiClient } = await import('/src/js/store/sync/api-client.js');
        const { generateUUID } = await import('/src/js/utilities/uuid.js');
        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgb(20, 120, 200)';
        ctx.fillRect(0, 0, largura, altura);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        const thumb = document.createElement('canvas');
        thumb.width = 150;
        thumb.height = 150;
        thumb.getContext('2d').drawImage(canvas, 0, 0, 150, 150);
        const id = generateUUID();
        if (subir) {
            await store.storeImage(id, blob);
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let bin = '';
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            const res = await apiClient.bulkUploadImages(atlasId, [{ localId: id, filename: 'ref.jpg', mimeType: 'image/jpeg', data: btoa(bin) }]);
            if (res?.mapping?.[id] !== id) throw new Error(`upload did not keep the id: ${JSON.stringify(res)}`);
        }
        return {
            id, name: 'ref.jpg', type: 'image/jpeg', size: blob.size,
            thumbnail: thumb.toDataURL('image/jpeg', 0.7), addedAt: Date.now(),
        };
    }, { atlasId, largura: LARGURA, altura: ALTURA, subir });
}

async function anexarReferencia(page, lineId, foto) {
    await page.evaluate(async ({ lineId, foto }) => {
        const store = await import('/src/js/store/index.js');
        await store.updateFeatureProperty('lines', lineId, 'images', [foto]);
    }, { lineId, foto });
}

/** Opens the photo in the panel's viewer and returns the natural size of what it shows. */
async function abrirNoVisualizador(page, lineId) {
    await selectFeatureUI(page, lineId);
    const miniatura = page.locator('.feature-photo-gallery-grid img').first();
    await expect(miniatura).toBeVisible({ timeout: 15000 });
    await miniatura.click();
    const inteira = page.locator('.feature-photo-viewer img');
    await expect(inteira).toBeVisible();
    return inteira;
}

async function fecharVisualizador(page) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.feature-photo-viewer-overlay')).toHaveCount(0);
}

collabTest('foto por referência: miniatura na grade, foto inteira no visualizador do autor e do colega', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
    const foto = await semearFotoPorReferencia(A, collab.atlasId);
    await anexarReferencia(A, linha, foto);
    await expect.poll(async () => (await readFeatures(B, 'lines')).find((f) => f.id === linha)?.props?.images?.[0]?.id,
        { timeout: 30000 }).toBe(foto.id);

    for (const [quem, page] of [['autor', A], ['colega', B]]) {
        const inteira = await abrirNoVisualizador(page, linha);
        await expect.poll(() => inteira.evaluate((el) => el.naturalWidth), {
            timeout: 15000, message: `${quem}: a foto inteira, não a miniatura`,
        }).toBe(LARGURA);
        await fecharVisualizador(page);
    }
});

collabTest('foto por referência sem os bytes: o visualizador fica na miniatura e diz o que fazer', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
    const foto = await semearFotoPorReferencia(A, collab.atlasId, { subir: false });
    await anexarReferencia(A, linha, foto);
    await expect.poll(async () => (await readFeatures(B, 'lines')).find((f) => f.id === linha)?.props?.images?.length ?? 0,
        { timeout: 30000 }).toBe(1);

    const inteira = await abrirNoVisualizador(B, linha);
    const toast = B.locator('.toast', { hasText: 'ainda não chegou ao servidor' });
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
    console.log(`FOTO_REF_SEM_BYTES toast=${JSON.stringify((await toast.innerText()).trim())}`);
    expect(await inteira.evaluate((el) => el.naturalWidth), 'a miniatura continua na tela').toBe(150);
});

collabTest('baixar uma foto por referência entrega os bytes dela', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
    const foto = await semearFotoPorReferencia(A, collab.atlasId);
    await anexarReferencia(A, linha, foto);
    await expect.poll(async () => (await readFeatures(B, 'lines')).find((f) => f.id === linha)?.props?.images?.length ?? 0,
        { timeout: 30000 }).toBe(1);

    await abrirNoVisualizador(B, linha);
    const download = B.waitForEvent('download', { timeout: 15000 });
    await B.locator('.feature-photo-viewer-action-btn[title="Baixar imagem"]').click();
    const arquivo = await download;
    const caminho = await arquivo.path();
    const { statSync } = await import('node:fs');
    expect(arquivo.suggestedFilename()).toBe('ref.jpg');
    expect(statSync(caminho).size).toBe(foto.size);
});

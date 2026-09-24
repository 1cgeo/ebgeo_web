// Path: e2e-ui/foto-anexa-comprimida.spec.js

/**
 * The size of a photo attached to a feature, stored and on the wire, measured end to end.
 *
 * A feature's photos live as data URLs inside `properties.images`, and every edit of the feature
 * sends the whole array (twice: the value and what it replaces). Until 2026-09-24
 * `processImageFile` (`utilities/image_utils.js`) compressed only above 2 MB and down to 2048 px,
 * so a camera photo just under 2 MB went in raw, and one just above came out at 2048 px. The phase
 * 1 fix compresses every photo to at most 1600 px of side at quality ~0.8, keeps a small photo as
 * it is, and keeps transparency.
 *
 * The photo is made in the page by a real encoder, at camera size (4000 x 3000) with the gradients
 * and the grain of a real scene, and goes through `userDataManager.addImage`, the door the gallery
 * uses. The spec measures the stored data URL, the push body of the edit, and what the peer holds.
 */

import { collabTest, expect, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(180000);

/** A camera-like JPEG made in the page: 4000 x 3000, gradients plus grain, quality 0.92. */
async function fotoDeCamera(page, { largura = 4000, altura = 3000, tipo = 'image/jpeg', alfa = false } = {}) {
    return page.evaluate(async ({ largura, altura, tipo, alfa }) => {
        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, largura, altura);
        g.addColorStop(0, '#6a8f3c');
        g.addColorStop(0.5, '#c9b27a');
        g.addColorStop(1, '#3b5f8a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, largura, altura);
        const img = ctx.getImageData(0, 0, largura, altura);
        let x = 12345;
        for (let i = 0; i < img.data.length; i += 4) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            const n = (x % 41) - 20;
            img.data[i] += n;
            img.data[i + 1] += n;
            img.data[i + 2] += n;
            if (alfa) img.data[i + 3] = (i / 4) % largura < largura / 2 ? 0 : 255;
        }
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, tipo, 0.92));
        window.__foto = new File([blob], tipo === 'image/png' ? 'foto.png' : 'foto.jpg', { type: tipo });
        return blob.size;
    }, { largura, altura, tipo, alfa });
}

async function anexar(page, featureId) {
    return page.evaluate(async (id) => {
        const { default: userDataManager } = await import('/src/js/user_data/user_data_manager.js');
        const img = await userDataManager.addImage(id, 'line', window.__foto);
        if (!img) return null;
        // Since phase 2b the item carries the reference only: the bytes are read like any reader.
        const { blobDaFoto } = await import('/src/js/user_data/photo-source.js');
        const blob = await blobDaFoto(img);
        const url = URL.createObjectURL(blob);
        const decodificada = await new Promise((resolve) => {
            const el = new Image();
            el.onload = () => resolve({ w: el.naturalWidth, h: el.naturalHeight });
            el.onerror = () => resolve(null);
            el.src = url;
        });
        const alfa = await new Promise((resolve) => {
            const el = new Image();
            el.onload = () => {
                const c = document.createElement('canvas');
                c.width = 4;
                c.height = 4;
                const cx = c.getContext('2d');
                cx.drawImage(el, 0, 0, el.naturalWidth / 4, el.naturalHeight / 4, 0, 0, 4, 4);
                resolve(cx.getImageData(0, 0, 1, 1).data[3]);
            };
            el.onerror = () => resolve(null);
            el.src = url;
        });
        URL.revokeObjectURL(url);
        return {
            bytes: blob.size,
            temData: 'data' in img,
            mime: blob.type,
            thumbBytes: img.thumbnail?.length ?? 0,
            dims: decodificada,
            alfaNoCantoEsquerdo: alfa,
        };
    }, featureId);
}

collabTest('uma foto de câmera anexada fica em poucas centenas de KB, no disco, no fio e no par', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });

    const pushes = [];
    const syncUrl = `${collab.baseUrl}/api/v1/atlas/${collab.atlasId}/sync`;
    A.on('request', (req) => {
        if (req.method() === 'POST' && req.url() === syncUrl) pushes.push(req.postDataBuffer()?.byteLength ?? 0);
    });

    const original = await fotoDeCamera(A);
    const antesDoPush = pushes.length;
    const anexada = await anexar(A, linha);
    await expect.poll(() => pushes.length, { timeout: 30000 }).toBeGreaterThan(antesDoPush);
    const corpoDoPush = Math.max(...pushes.slice(antesDoPush));
    await expect.poll(async () => (await readFeatures(B, 'lines')).find((f) => f.id === linha)?.props?.images?.length ?? 0,
        { timeout: 30000 }).toBe(1);
    console.log(`FOTO_ANEXA original=${original} guardada=${JSON.stringify(anexada)} push=${corpoDoPush}`);

    expect(original, 'a foto de teste tem tamanho de câmera').toBeGreaterThan(2 * 1024 * 1024);
    expect(anexada.mime).toBe('image/jpeg');
    expect(Math.max(anexada.dims.w, anexada.dims.h)).toBeLessThanOrEqual(1600);
    expect(anexada.bytes, 'poucas centenas de KB no disco').toBeLessThan(500 * 1024);
    expect(anexada.temData, 'a feição guarda a referência, não os bytes').toBe(false);
    expect(corpoDoPush, 'a edição que leva a foto cabe folgada no teto do servidor').toBeLessThan(1.5 * 1024 * 1024);
});

collabTest('PNG com transparência continua transparente depois de reduzida', async ({ collab }) => {
    const A = collab.author;
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await fotoDeCamera(A, { largura: 2400, altura: 1800, tipo: 'image/png', alfa: true });
    const anexada = await anexar(A, linha);
    console.log(`FOTO_ANEXA_PNG guardada=${JSON.stringify(anexada)}`);
    expect(Math.max(anexada.dims.w, anexada.dims.h)).toBeLessThanOrEqual(1600);
    expect(anexada.mime, 'um formato com canal alfa').not.toBe('image/jpeg');
    expect(anexada.alfaNoCantoEsquerdo, 'a metade transparente continua transparente').toBe(0);
});

collabTest('uma foto já pequena é guardada como veio', async ({ collab }) => {
    const A = collab.author;
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    const original = await fotoDeCamera(A, { largura: 800, altura: 600 });
    const anexada = await anexar(A, linha);

    console.log(`FOTO_ANEXA_PEQUENA original=${original} guardada=${JSON.stringify(anexada)}`);
    expect(anexada.bytes, 'os bytes originais, sem re-codificar').toBe(original);
    expect(anexada.dims).toEqual({ w: 800, h: 600 });
});

collabTest('uma foto que continua grande depois de reduzida avisa, nomeando a foto', async ({ collab }) => {
    const A = collab.author;
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    // Pure colour noise: the one picture JPEG cannot shrink, so 1600 px of it stays above the 600 KB notice threshold.
    await A.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 3200;
        canvas.height = 2400;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(3200, 2400);
        for (let i = 0; i < img.data.length; i++) img.data[i] = i % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
        window.__foto = new File([blob], 'ruido.jpg', { type: 'image/jpeg' });
    });
    const anexada = await anexar(A, linha);
    const guardados = anexada.bytes;
    console.log(`FOTO_ANEXA_RUIDO guardada=${JSON.stringify(anexada)} bytes=${guardados}`);
    expect(guardados, 'o caso de teste produz uma foto acima do limiar de aviso').toBeGreaterThan(600 * 1024);
    const toast = A.locator('.toast', { hasText: 'mesmo depois de reduzida' });
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
    const texto = (await toast.innerText()).trim();
    console.log(`FOTO_ANEXA_AVISO ${JSON.stringify(texto)}`);
    expect(texto).toContain('A foto "ruido.jpg"');
    expect(texto).toContain('anexe uma versão menor');
});

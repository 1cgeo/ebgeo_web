// Path: e2e-ui/foto-anexa-por-referencia.spec.js

/**
 * FASE 2b DAS FOTOS ANEXAS: anexar grava a foto como blob com referência (2026-09-24).
 *
 * The photo goes through the real gallery of the feature panel (the file input the "+" card opens).
 * Its bytes go to the atlas image store and up by the durable blob queue (`POST /images/bulk`, which
 * keeps the id); the feature carries `{ id, name, type, size, thumbnail, addedAt }` and nothing more,
 * so the edit that attaches it is a few KB, and it does NOT wait for the photo.
 *
 * The core cases the coordinator assigned to this front: attach, the colleague, offline, F5 in the
 * middle of the upload, slow link, refusal. Plus the two other doors (3D item, 360 marker) in a real
 * browser on a local atlas, where the shape is decided by the same helper.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { test } from '@playwright/test';
import { collabTest, expect, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';
import { selectFeatureUI } from './helpers/collab-helpers.js';
import { readState } from './state.js';

collabTest.describe.configure({ retries: 0 });
collabTest.setTimeout(300000);

const B64 = globalThis.Buffer;

/** A camera-like JPEG made in the page by a real encoder, as a file payload for the picker. */
async function fotoDeCamera(page, { largura = 4000, altura = 3000, nome = 'foto.jpg' } = {}) {
    const base64 = await page.evaluate(async ({ largura, altura }) => {
        const canvas = document.createElement('canvas');
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, largura, altura);
        g.addColorStop(0, '#6a8f3c');
        g.addColorStop(1, '#3b5f8a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, largura, altura);
        const img = ctx.getImageData(0, 0, largura, altura);
        let x = 7;
        for (let i = 0; i < img.data.length; i += 4) {
            x = (x * 1103515245 + 12345) & 0x7fffffff;
            const n = (x % 41) - 20;
            img.data[i] += n;
            img.data[i + 1] += n;
            img.data[i + 2] += n;
        }
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }, { largura, altura });
    return { name: nome, mimeType: 'image/jpeg', buffer: B64.from(base64, 'base64') };
}

/** Attaches through the panel's gallery of the selected feature. */
async function anexarPelaGaleria(page, arquivo) {
    await page.locator('.feature-photo-gallery__file-input').first().setInputFiles(arquivo);
}

async function fotoNaFeicao(page, lineId) {
    return (await readFeatures(page, 'lines')).find((f) => f.id === lineId)?.props?.images?.[0] ?? null;
}

async function noServidor(db, lineId) {
    const row = await db.queryFeatureRow(lineId);
    const foto = row?.properties?.images?.[0] ?? null;
    const imagem = foto?.id ? await db.raw.oneOrNone('SELECT id, size_bytes FROM images WHERE id = $1', [foto.id]) : null;
    return { foto, imagem };
}

async function larguraNoVisualizador(page, lineId) {
    await selectFeatureUI(page, lineId);
    const miniatura = page.locator('.feature-photo-gallery-grid img').first();
    await expect(miniatura).toBeVisible({ timeout: 15000 });
    await miniatura.click();
    const inteira = page.locator('.feature-photo-viewer img');
    await expect(inteira).toBeVisible();
    let largura = 0;
    await expect.poll(async () => {
        largura = await inteira.evaluate((el) => el.naturalWidth);
        return largura;
    }, { timeout: 30000 }).toBeGreaterThan(150);
    await page.keyboard.press('Escape');
    return largura;
}

async function linhaSincronizada(collab) {
    const linha = await drawLineUI(collab.author, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });
    return linha;
}

collabTest('anexar: a feição leva só a referência, a edição é pequena, e o colega vê a foto inteira', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await linhaSincronizada(collab);
    const pushes = [];
    const bulks = [];
    A.on('request', (req) => {
        if (req.method() !== 'POST') return;
        if (req.url().endsWith(`/atlas/${collab.atlasId}/sync`)) pushes.push(req.postDataBuffer()?.byteLength ?? 0);
        if (req.url().endsWith('/images/bulk')) bulks.push(req.postDataBuffer()?.byteLength ?? 0);
    });
    const arquivo = await fotoDeCamera(A);
    await anexarPelaGaleria(A, arquivo);

    await expect.poll(() => fotoNaFeicao(A, linha), { timeout: 20000 }).not.toBeNull();
    const foto = await fotoNaFeicao(A, linha);
    expect(foto).not.toHaveProperty('data');
    expect(foto.thumbnail?.startsWith('data:image/')).toBe(true);
    await expect.poll(async () => (await noServidor(collab.db, linha)).imagem?.id ?? null, { timeout: 30000 }).toBe(foto.id);
    const servidor = await noServidor(collab.db, linha);
    expect(servidor.foto).not.toHaveProperty('data');
    const maiorPush = Math.max(...pushes);
    console.log(`FOTO_REF_ANEXAR original=${arquivo.buffer.length} pushes=${JSON.stringify(pushes)} bulks=${JSON.stringify(bulks)} imagem=${servidor.imagem.size_bytes}`);
    expect(maiorPush, 'a edição que anexa leva a miniatura, não a foto').toBeLessThan(30 * 1024);
    expect(await larguraNoVisualizador(B, linha)).toBe(1600);
});

collabTest('offline: a foto anexada sem rede sobe na volta, sob o mesmo id, e o colega a vê', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await linhaSincronizada(collab);
    await A.context().setOffline(true);
    await A.evaluate(async () => {
        const { wsClient } = await import('/src/js/store/sync/ws-client.js');
        wsClient._socket?.close(4000, 'network fault injection');
    });
    try {
        await selectFeatureUI(A, linha);
        await anexarPelaGaleria(A, await fotoDeCamera(A, { largura: 1200, altura: 900 }));
        await expect.poll(() => fotoNaFeicao(A, linha), { timeout: 20000 }).not.toBeNull();
        const foto = await fotoNaFeicao(A, linha);
        await delay(3000);
        expect((await noServidor(collab.db, linha)).foto, 'nada chega ao servidor sem rede').toBeNull();
        await A.context().setOffline(false);
        await expect.poll(async () => (await noServidor(collab.db, linha)).imagem?.id ?? null, { timeout: 90000 }).toBe(foto.id);
        expect((await noServidor(collab.db, linha)).foto.id).toBe(foto.id);
        expect(await larguraNoVisualizador(B, linha)).toBe(1200);
    } finally {
        await A.context().setOffline(false);
    }
});

/**
 * A EDIÇÃO ESPERA A FOTO (revisão das fases 2b e 2c, 2026-09-24). Até então a edição saía na frente
 * e a foto depois; num link lento o "Sair" contava zero pendências, e o servidor ficava com a
 * referência de uma foto que nunca chegaria. Agora a op que cita a foto nasce preparada e só sai
 * quando o blob confirma: o servidor NUNCA tem a referência sem a linha de `images`, nem quando um F5
 * cai no meio da subida.
 */
collabTest('link lento: a edição espera a foto, e o servidor nunca tem a referência sem os bytes, nem com F5 no meio', async ({ collab, browserName }) => {
    collabTest.skip(browserName !== 'chromium', 'CDP throttling');
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await linhaSincronizada(collab);
    const cdp = await A.context().newCDPSession(A);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditionsByRule', {
        matchedNetworkConditions: [{ urlPattern: `${collab.baseUrl}/*`, latency: 300, downloadThroughput: 5000, uploadThroughput: 5000 }],
    });
    // A INVARIANTE, amostrada o tempo todo: sempre que a linha da feição cita a foto, a linha da imagem existe.
    const violacoes = [];
    const estado = { amostrando: true };
    const amostrar = (async () => {
        while (estado.amostrando) {
            const r = await collab.db.raw.oneOrNone(
                `SELECT f.properties->'images'->0->>'id' AS foto,
                        (SELECT count(*)::int FROM images i WHERE i.id::text = f.properties->'images'->0->>'id') AS imagens
                   FROM features f WHERE f.id = $1`, [linha]);
            if (r?.foto && r.imagens === 0) violacoes.push(r.foto);
            await delay(150);
        }
    })();
    try {
        await anexarPelaGaleria(A, await fotoDeCamera(A));
        await expect.poll(() => fotoNaFeicao(A, linha), { timeout: 20000 }).not.toBeNull();
        const foto = await fotoNaFeicao(A, linha);
        await delay(4000);
        expect((await noServidor(collab.db, linha)).foto, 'a edição espera a foto').toBeNull();

        // CLONE COM A FOTO AINDA SUBINDO (revisão, item 6): o clone copia só as linhas de `images` que
        // já existem. Como a edição espera a foto, o servidor não cita a foto neste instante, então o
        // clone também não cita uma foto sem linha. Medido pelo transporte real e pelo banco.
        const clone = await fetch(`${collab.baseUrl}/api/v1/atlas/${collab.atlasId}/clone`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${collab.ownerToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(clone.status).toBe(201);
        const cloneId = (await clone.json()).data.id;
        const orfas = await collab.db.raw.any(
            `SELECT f.id FROM features f JOIN maps m ON m.id = f.map_id,
                    jsonb_array_elements(CASE WHEN jsonb_typeof(f.properties->'images') = 'array' THEN f.properties->'images' ELSE '[]'::jsonb END) AS foto
              WHERE m.atlas_id = $1 AND NOT (foto ? 'data')
                AND NOT EXISTS (SELECT 1 FROM images i WHERE i.id::text = foto->>'id' AND i.atlas_id = $1)`, [cloneId]);
        expect(orfas, 'o clone não cita foto sem linha de images').toEqual([]);

        // F5 with the upload on the wire.
        await cdp.detach().catch(() => {});
        await A.reload();
        await expect.poll(async () => (await noServidor(collab.db, linha)).foto?.id ?? null, { timeout: 120000 }).toBe(foto.id);
        expect((await noServidor(collab.db, linha)).imagem?.id).toBe(foto.id);
        console.log(`FOTO_REF_LENTO violacoes=${violacoes.length}`);
        expect(violacoes, 'o servidor nunca teve a referência sem a imagem').toEqual([]);
        expect(await larguraNoVisualizador(B, linha)).toBe(1600);
    } finally {
        estado.amostrando = false;
        await amostrar;
    }
});

collabTest('recusa: o aviso nomeia a foto, a edição sai com a referência e o colega fica na miniatura', async ({ collab }) => {
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await linhaSincronizada(collab);
    await A.route('**/atlas/*/images/bulk', async (route) => {
        const { images } = route.request().postDataJSON();
        await route.fulfill({
            status: 201, contentType: 'application/json',
            body: JSON.stringify({ data: { uploaded: [], mapping: {},
                failed: images.map((i) => ({ localId: i.localId, error: 'Invalid file type: image/gif', permanent: true })) } }),
        });
    });
    await anexarPelaGaleria(A, await fotoDeCamera(A, { largura: 800, altura: 600, nome: 'vistoria.jpg' }));
    const toast = A.locator('.toast', { hasText: 'não foi enviada ao servidor' });
    await expect(toast).toBeVisible({ timeout: 15000 });
    await expect.poll(() => toast.evaluate((el) => Number(getComputedStyle(el).opacity)), { timeout: 5000 }).toBeGreaterThan(0.9);
    const texto = (await toast.innerText()).trim();
    console.log(`FOTO_REF_RECUSA ${JSON.stringify(texto)}`);
    // A FOTO é dita foto, com o desfecho dela (`avisoDeFotoRecusada`), e não "figura".
    expect(texto).toContain('A foto "vistoria.jpg" não foi enviada ao servidor, e os colegas veem só a miniatura.');
    expect(texto).not.toContain('figura');
    await expect.poll(async () => (await noServidor(collab.db, linha)).foto?.name ?? null, { timeout: 30000 }).toBe('vistoria.jpg');
    expect((await noServidor(collab.db, linha)).imagem).toBeNull();

    await selectFeatureUI(B, linha);
    await B.locator('.feature-photo-gallery-grid img').first().click();
    await expect(B.locator('.toast', { hasText: 'ainda não chegou ao servidor' })).toBeVisible({ timeout: 15000 });
});

/**
 * O TIPO É O DOS BYTES (revisão das fases 2b e 2c, 2026-09-24, item 3). Um PNG com nome e tipo de JPEG
 * (o acervo da linha anterior tem esse caso) é pequeno o bastante para ser guardado como veio, e
 * `processImageFile` o guardava declarado `image/jpeg`: o servidor fareja os bytes e recusa de vez o
 * tipo que eles contradizem. Agora o blob sai rotulado pelos bytes, e o item da feição diz PNG.
 */
collabTest('tipo mentiroso: um PNG com nome e tipo de JPEG chega ao servidor como PNG', async ({ collab }) => {
    const A = collab.author;
    const linha = await linhaSincronizada(collab);
    const base64 = await A.evaluate(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3c6a8a';
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = '#e0c040';
        ctx.fillRect(40, 40, 120, 80);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    });
    await anexarPelaGaleria(A, { name: 'croqui.jpg', mimeType: 'image/jpeg', buffer: B64.from(base64, 'base64') });
    await expect.poll(() => fotoNaFeicao(A, linha), { timeout: 20000 }).not.toBeNull();
    const foto = await fotoNaFeicao(A, linha);
    expect(foto.type, 'o item diz o tipo dos bytes').toBe('image/png');
    await expect.poll(async () => (await noServidor(collab.db, linha)).imagem?.id ?? null, { timeout: 30000 }).toBe(foto.id);
    const linhaDaImagem = await collab.db.raw.one('SELECT mime_type FROM images WHERE id = $1', [foto.id]);
    expect(linhaDaImagem.mime_type).toBe('image/png');
});

const state = readState();
(state.skip ? test.describe.skip : test.describe)('as outras duas portas (3D e 360), num atlas local', () => {
    test('a foto de item 3D e de marcador 360 é guardada por referência, com os bytes no armazém', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 60000 });
        const resultado = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const { blobDaFoto } = await import('/src/js/user_data/photo-source.js');
            const canvas = document.createElement('canvas');
            canvas.width = 2400;
            canvas.height = 1800;
            canvas.getContext('2d').fillRect(0, 0, 2400, 1800);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
            const arquivo = new File([blob], 'item.jpg', { type: 'image/jpeg' });
            const marcador3d = await store.addMarker('tileset-local', { position: { x: 0, y: 0, z: 0 } });
            const foto3d = await store.addMarkerImage(marcador3d.id, arquivo);
            const marcador360 = await store.addMarker360('foto-local.jpg', { position: { heading: 0, pitch: 0 }, properties: { nome: 'm' } });
            const foto360 = await store.addMarker360Image(marcador360.id, arquivo);
            const medir = async (foto) => {
                const bytes = await blobDaFoto(foto);
                const bitmap = bytes ? await createImageBitmap(bytes) : null;
                return { temData: 'data' in foto, temMiniatura: !!foto.thumbnail, bytes: bytes?.size ?? 0, largura: bitmap?.width ?? 0 };
            };
            return { foto3d: await medir(foto3d), foto360: await medir(foto360) };
        });
        console.log(`FOTO_REF_OUTRAS_PORTAS ${JSON.stringify(resultado)}`);
        for (const foto of [resultado.foto3d, resultado.foto360]) {
            expect(foto).toMatchObject({ temData: false, temMiniatura: true, largura: 1600 });
            expect(foto.bytes).toBeGreaterThan(0);
        }
    });
});

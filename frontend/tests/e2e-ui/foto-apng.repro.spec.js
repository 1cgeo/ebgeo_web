// Path: e2e-ui/foto-apng.repro.spec.js

/**
 * @fileoverview REPRO (2026-09-24, item 3 da segunda revisão das fotos anexas): um PNG ANIMADO é
 * `image/apng` para o servidor, e o cliente dizia `image/png`.
 *
 * O detector do servidor percorre os pedaços do PNG e chama de `image/apng` o arquivo com um `acTL`
 * antes do primeiro `IDAT`; o cliente lia só a cabeça e declarava `image/png`. Duas portas pagavam:
 *
 *   1. ANEXAR um APNG pequeno pela galeria: a foto cabia, era guardada como veio e subia declarada
 *      PNG; o servidor a recusava, e o colega nunca a via.
 *   2. ENVIAR ao servidor um atlas local com um APNG, seja foto inline antiga (que a fronteira
 *      converte em blob), seja figura posta no mapa: a importação atômica recusava o atlas INTEIRO.
 *
 * O arquivo é um APNG de verdade (CRC e zlib reais, `tests/helpers/png-sintetico.js`), construído no
 * Node e entregue à página, e os dois navegadores o decodificam.
 */

import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readState } from './state.js';
import { collabTest, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { createDb } from './helpers/db.js';
import { pngSintetico } from '../helpers/png-sintetico.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const LARGURA = 320;
const ALTURA = 240;
const APNG = Buffer.from(pngSintetico({ largura: LARGURA, altura: ALTURA, animado: true }));

collabTest.describe.configure({ retries: 0 });

collabTest('anexar um APNG pela galeria: a foto sobe num tipo que o servidor aceita, e o colega a vê', async ({ collab }) => {
    collabTest.setTimeout(180000);
    const A = collab.author;
    const B = collab.peers[0];
    const linha = await drawLineUI(A, [[-43.2, -22.9], [-43.15, -22.85]]);
    await collab.expectFullSync({ entityId: linha, type: 'lines', operationType: 'create' });

    // PREMISSA, lida sem o código sob teste: o arquivo é animado (acTL antes do IDAT, a regra do
    // detector do servidor) e o navegador o decodifica.
    expect(APNG.indexOf('acTL'), 'acTL antes do IDAT').toBeLessThan(APNG.indexOf('IDAT'));
    expect(APNG.indexOf('acTL')).toBeGreaterThan(0);
    expect(await A.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return (await createImageBitmap(new Blob([bytes], { type: 'image/png' }))).width;
    }, APNG.toString('base64'))).toBe(LARGURA);

    const { selectFeatureUI } = await import('./helpers/collab-helpers.js');
    await selectFeatureUI(A, linha);
    await A.locator('.feature-photo-gallery__file-input').first()
        .setInputFiles({ name: 'animacao.png', mimeType: 'image/png', buffer: APNG });
    await expect.poll(async () => (await readFeatures(A, 'lines')).find((f) => f.id === linha)?.props?.images?.[0]?.id ?? null,
        { timeout: 20000 }).not.toBeNull();
    const foto = (await readFeatures(A, 'lines')).find((f) => f.id === linha).props.images[0];
    console.log(`APNG_ANEXO item=${JSON.stringify({ id: foto.id, type: foto.type, size: foto.size })}`);
    expect(foto.type, 'o item não diz um tipo que o servidor recusa').not.toBe('image/apng');

    // O SERVIDOR TEM A FOTO, num tipo da lista dele.
    await expect.poll(async () => (await collab.db.raw.oneOrNone('SELECT mime_type FROM images WHERE id = $1', [foto.id]))?.mime_type ?? null,
        { timeout: 30000 }).toMatch(/^image\/(png|jpeg|webp)$/);

    // E o colega a vê inteira.
    await expect.poll(async () => (await readFeatures(B, 'lines')).find((f) => f.id === linha)?.props?.images?.[0]?.id ?? null,
        { timeout: 30000 }).toBe(foto.id);
    await selectFeatureUI(B, linha);
    await B.locator('.feature-photo-gallery-grid img').first().click();
    await expect.poll(() => B.locator('.feature-photo-viewer img').evaluate((el) => el.naturalWidth), { timeout: 30000 }).toBe(LARGURA);
});

/**
 * O disco da versão anterior (sem sufixo), com um ponto que tem uma foto APNG inline e uma figura
 * APNG posta no mapa, gravado pela API crua antes do primeiro boot.
 */
async function semearAcervoComApng(page) {
    await page.evaluate(async (b64) => {
        const STORE = 'keyvaluepairs';
        const abrir = (nome, versao) => new Promise((res, rej) => {
            const req = versao ? indexedDB.open(nome, versao) : indexedDB.open(nome);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
            };
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
        async function gravar(banco, pares) {
            let db = await abrir(banco);
            if (!db.objectStoreNames.contains(STORE)) { const v = db.version + 1; db.close(); db = await abrir(banco, v); }
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                for (const [k, v] of pares) tx.objectStore(STORE).put(v, k);
                tx.oncomplete = res; tx.onerror = () => rej(tx.error);
            });
            db.close();
        }
        const dataUrl = `data:image/png;base64,${b64}`;
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        await gravar('ebgeo_maps', [['Principal', {
            name: 'Principal', baseLayer: 'carta-topografica', zoom: 8, center_lat: -22.9, center_long: -43.2,
            bearing: 0, pitch: 0, analysisLayers: {},
            features: {
                points: [{
                    type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: {
                        id: 'ponto-com-apng', source: 'point', layerId: 'default', nome: 'Ponto com APNG',
                        images: [{ id: 'foto-apng', name: 'animacao.png', type: 'image/png', addedAt: 1788723899745, data: dataUrl, thumbnail: dataUrl }],
                    },
                }],
                images: [{
                    type: 'Feature', geometry: { type: 'Point', coordinates: [-43.1, -22.8] },
                    properties: { id: 'figura-apng', source: 'image', layerId: 'default', nome: 'Figura animada' },
                }],
            },
        }]]);
        await gravar('ebgeo_images', [['figura-apng', new Blob([bytes], { type: 'image/png' })]]);
        await gravar('ebgeo_app_settings', [['schemaVersion', '2.4'], ['mapOrder', ['Principal']], ['lastActiveMap', 'Principal']]);
        await gravar('ebgeo_atlas', [['current_atlas', { id: 'acervo-com-apng', name: 'Meu Atlas', schemaVersion: '2.4',
            mapOrder: ['Principal'], lastActiveMapId: 'Principal' }]]);
    }, APNG.toString('base64'));
}

describeOrSkip('um atlas local com APNG vai ao servidor', () => {
    test('a foto APNG inline fica inline, a figura APNG sobe como PNG parado, e o atlas inteiro chega', async ({ browser }) => {
        test.setTimeout(300000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        const ENTRY = '**/projects-page.js';
        await page.route(ENTRY, (route) => route.abort());
        await page.goto('/atlas.html');
        await semearAcervoComApng(page);
        await page.unroute(ENTRY);

        const creds = await createVerifiedUser({ prefix: 'apng' });
        await page.goto('/atlas.html');
        await page.locator('[data-testid="projects-login"]').click();
        await page.locator('[data-testid="login-username"]').fill(creds.username);
        await page.locator('[data-testid="login-password"]').fill(creds.password);
        await page.locator('[data-testid="login-submit"]').click();
        await expect(page.locator('[data-testid="local-atlas-item"]').first()).toBeVisible({ timeout: 60000 });
        const cartao = page.locator('[data-testid="local-atlas-item"]').first();
        await cartao.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
        await page.locator('[data-testid="local-atlas-send-to-server"]').click();
        await page.locator('[data-testid="local-atlas-name-input"]').fill('Acervo com APNG');
        const respostas = [];
        page.on('response', (r) => { if (r.url().includes('/atlas/import')) respostas.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
        await page.locator('[data-testid="local-atlas-name-confirm"]').click();

        await page.waitForFunction(() => /[?&]atlas=/.test(location.search)
            || [...document.querySelectorAll('.toast')].some((t) => /envio|servidor|imagem/i.test(t.textContent)), null, { timeout: 180000 });
        const avisos = await page.locator('.toast').allInnerTexts().catch(() => []);
        console.log(`APNG_ENVIO ${JSON.stringify({ respostas, avisos })}`);
        await page.waitForURL(/[?&]atlas=/, { timeout: 60000 });
        const atlasId = new URL(page.url()).searchParams.get('atlas');
        await ctx.close();

        const db = createDb(state.dbName);
        // A figura é a ÚNICA imagem do atlas no servidor: a foto ficou inline, dentro da feição. O
        // servidor confere os bytes contra o tipo declarado, então `image/png` aqui é o detector dele
        // dizendo que o que chegou é um PNG parado.
        const imagens = await db.raw.any('SELECT mime_type FROM images WHERE atlas_id = $1', [atlasId]);
        expect(imagens.map((i) => i.mime_type), 'a figura chegou como PNG parado').toEqual(['image/png']);
        const ponto = await db.raw.one(
            `SELECT f.properties FROM features f JOIN maps m ON m.id = f.map_id
             WHERE m.atlas_id = $1 AND f.properties->>'nome' = 'Ponto com APNG' AND f.deleted_at IS NULL`,
            [atlasId],
        );
        const foto = ponto.properties.images[0];
        expect(foto.id).toBe('foto-apng');
        expect(foto.data, 'a foto APNG ficou inline, com os bytes dela').toBe(`data:image/png;base64,${APNG.toString('base64')}`);
    });
});

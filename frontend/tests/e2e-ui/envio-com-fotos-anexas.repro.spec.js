// Path: e2e-ui/envio-com-fotos-anexas.repro.spec.js

/**
 * @fileoverview REPRO (caça noturna de 2026-09-23): o acervo herdado com FOTOS ANEXAS a feições não
 * sobe ao servidor.
 *
 * A versão anterior guarda a foto que a pessoa anexa a uma feição como data URL DENTRO de
 * `properties.images` (`utilities/image_utils.js` dela: aceita até 10 MB e só recomprime acima de
 * 2 MB), então quatro ou cinco fotos de celular já passam de 10 MB de texto no documento do mapa. O
 * "Enviar ao servidor" manda o documento inteiro num POST só (`POST /atlas/imports`, em
 * `import_export/atomic-server-import.js`), e esse corpo passa pelo parser JSON global de 10 MB do
 * backend (`app.js`); só as rotas de BLOB têm o limite grande.
 *
 * O ESTADO É FABRICADO como em `envio-do-acervo-herdado.spec.js`: o disco sem sufixo que a versão
 * anterior deixa, escrito pela API crua antes do primeiro boot. A foto é texto base64 de tamanho
 * realista, não uma imagem decodificável, porque o envio não a decodifica.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { sessaoDoApp } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Cinco fotos de ~2,4 MB em base64 (uma foto de celular abaixo do limiar de recompressão). */
const FOTOS = 5;
const TAMANHO_DA_FOTO = 2_400_000;

async function semear(page) {
    return page.evaluate(async ({ fotos, tamanho }) => {
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
        const images = Array.from({ length: fotos }, (_, i) => ({
            id: `foto-${i}`, name: `foto-${i}.jpg`, addedAt: 1788723899745 + i,
            data: `data:image/jpeg;base64,${'A'.repeat(tamanho)}`,
        }));
        await gravar('ebgeo_maps', [['Principal', {
            name: 'Principal', baseLayer: 'carta-topografica', zoom: 8, center_lat: -22.9, center_long: -43.2,
            bearing: 0, pitch: 0, analysisLayers: {},
            features: { points: [{
                type: 'Feature', geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: 'ponto-com-fotos', source: 'point', layerId: 'default', nome: 'Ponto com fotos', images },
            }] },
        }]]);
        await gravar('ebgeo_app_settings', [['schemaVersion', '2.4'], ['mapOrder', ['Principal']], ['lastActiveMap', 'Principal']]);
        await gravar('ebgeo_atlas', [['current_atlas', { id: 'acervo-com-fotos', name: 'Meu Atlas', schemaVersion: '2.4',
            mapOrder: ['Principal'], lastActiveMapId: 'Principal' }]]);
        return images.reduce((n, im) => n + im.data.length, 0);
    }, { fotos: FOTOS, tamanho: TAMANHO_DA_FOTO });
}

/** Semeia o disco herdado, entra e abre o diálogo de envio até o nome. */
async function prepararEnvio(browser) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    const toasts = [];
    page.on('console', (m) => { if (m.type() === 'error') toasts.push(`console: ${m.text().slice(0, 200)}`); });
    const ENTRY = '**/projects-page.js';
    await page.route(ENTRY, (route) => route.abort());
    await page.goto('/atlas.html');
    const bytes = await semear(page);
    expect(bytes, 'o documento semeado passa de 10 MB de fotos').toBeGreaterThan(10 * 1024 * 1024);
    await page.unroute(ENTRY);

    const creds = await createVerifiedUser({ prefix: 'fotos' });
    await page.goto('/atlas.html');
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.locator('[data-testid="local-atlas-item"]').first()).toBeVisible({ timeout: 60000 });

    const cartao = page.locator('[data-testid="local-atlas-item"]').first();
    await cartao.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
    await page.locator('[data-testid="local-atlas-send-to-server"]').click();
    await page.locator('[data-testid="local-atlas-name-input"]').fill('Acervo com fotos');
    return { ctx, page, creds, toasts };
}

describeOrSkip('acervo herdado com fotos anexas', () => {
    test('as feições com fotos anexas chegam ao servidor', async ({ browser }, testInfo) => {
        test.setTimeout(300000);
        const { ctx, page, creds, toasts } = await prepararEnvio(browser);
        const respostas = [];
        page.on('response', (r) => { if (r.url().includes('/atlas/import')) respostas.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
        await page.locator('[data-testid="local-atlas-name-confirm"]').click();

        // O desfecho: ou navega para o atlas novo, ou diz na tela por que não.
        await page.waitForFunction(() => /[?&]atlas=/.test(location.search)
            || [...document.querySelectorAll('.toast')].some((t) => /envio|servidor/i.test(t.textContent)), null, { timeout: 180000 });
        const aviso = await page.locator('.toast').allInnerTexts().catch(() => []);
        await testInfo.attach('respostas', { body: JSON.stringify({ respostas, aviso, toasts }, null, 2), contentType: 'application/json' });
        console.info('FOTOS', JSON.stringify({ respostas, aviso }));
        expect(respostas.filter((r) => / 413$/.test(r)), 'nenhum pedido do envio foi recusado por tamanho').toEqual([]);
        await page.waitForURL(/[?&]atlas=/, { timeout: 60000 });
        const atlasId = new URL(page.url()).searchParams.get('atlas');
        await ctx.close();

        // O PAR, num navegador limpo: abre o atlas do servidor e lê o que a galeria lê
        // (`properties.images` da feição, no disco do atlas aberto).
        const par = await browser.newContext();
        const outra = await par.newPage();
        await outra.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await sessaoDoApp(outra, creds, `/?atlas=${atlasId}`);
        await expect(outra.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect.poll(() => outra.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            let achadas = null;
            try {
                await ns.getStore(ns.StoreName.MAPS).iterate((doc) => {
                    for (const f of doc?.features?.points ?? []) {
                        if (f?.properties?.nome === 'Ponto com fotos') achadas = (f.properties.images ?? []).map((im) => im.data?.length ?? 0);
                    }
                });
            } catch { return null; }
            return achadas;
        }), { timeout: 60000 }).toEqual(Array.from({ length: FOTOS }, () => 'data:image/jpeg;base64,'.length + TAMANHO_DA_FOTO));
        await par.close();
    });

    test('quando o servidor (ou o proxy dele) recusa por tamanho, a frase não manda tentar de novo', async ({ browser }, testInfo) => {
        test.setTimeout(300000);
        const { ctx, page } = await prepararEnvio(browser);
        // O nginx de produção tem um client_max_body_size que não mora neste repositório: o 413
        // pode vir DELE, antes do backend. A forja é o 413 na porta do envio.
        await page.route('**/api/v1/atlas/imports', (route) => route.fulfill({
            status: 413, contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'request entity too large' } }),
        }));
        await page.locator('[data-testid="local-atlas-name-confirm"]').click();
        const toast = page.locator('.toast', { hasText: 'grande demais' });
        await expect(toast).toBeVisible({ timeout: 120000 });
        const texto = await toast.innerText();
        await testInfo.attach('a frase do 413', { body: texto, contentType: 'text/plain' });
        console.info('FOTOS_413', texto);
        expect(texto).toMatch(/cerca de 1[12] MB/);
        expect(texto).not.toMatch(/tente de novo|tente novamente/i);
        await ctx.close();
    });
});

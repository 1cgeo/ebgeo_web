// Path: e2e-ui/exportacao-com-fonte-que-falha.spec.js

/**
 * @fileoverview A PDF export must FINISH when a source of the map style fails to load its
 * TileJSON, and before 2026-09-23 it never did.
 *
 * THE MECHANISM, measured in the browser on 2026-09-23 (hunt/producao). Every export draws an
 * off-screen MapLibre map from the style of the live map, which carries every catalog source
 * (data and analysis layers included, visible or not), and then awaits `load` / `idle` on it.
 * A vector, raster or raster-dem source whose TileJSON request FAILS sets `_loaded = true` and
 * fires an `error`, but no `data` event, so MapLibre schedules no new frame. When such a failure
 * is the LAST thing the off-screen map was waiting for, the map has already stopped rendering,
 * never re-evaluates `loaded()`, and never fires `load` nor `idle`: the progress modal stayed on
 * "Enquadrando área..." for 300 s, in the Vite dev server and in the production bundle alike.
 * One `triggerRepaint()` on that map fired `load`, `idle` and the rest of the export at once.
 *
 * WHY IT IS NOT A TEST-ONLY CONDITION. The catalog seeded by the migrations points four sources
 * at `http://localhost/tiles/...` placeholders until an administrator replaces them, and in
 * production a tile server that is down, slow to refuse, or answers 401/404 to a revoked private
 * layer produces the same failed TileJSON.
 *
 * The failure is made DETERMINISTIC here by refusing those TileJSON requests only after a delay:
 * the off-screen map finishes everything else first and goes quiet, which is the losing
 * interleaving. Refused at once, they settle before the first frame and the export passes.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { sessaoDoApp } from './helpers/cliente-de-teste.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Late enough that the off-screen map has rendered everything else and stopped. */
const ATRASO_DA_RECUSA_MS = 4000;

describeOrSkip('exportação com uma fonte do estilo que falha', () => {
    test.describe.configure({ retries: 0 });

    // The single sheet awaits `idle` (`pdf-export.tab.js`), the mosaic awaits `load`
    // (`pdf-mosaic-export.js`): two awaits, the same hang.
    for (const { nome, colunas } of [
        { nome: 'o PDF de folha única', colunas: '1' },
        { nome: 'o mosaico de PDF', colunas: '2' },
    ]) {
        test(`${nome} termina mesmo com o TileJSON do catálogo recusado tarde`, async ({ page }) => {
            test.setTimeout(180000);
            let recusados = 0;
            await page.route('http://localhost/tiles/**', async (route) => {
                await new Promise((resolve) => { setTimeout(resolve, ATRASO_DA_RECUSA_MS); });
                recusados += 1;
                await route.abort('connectionrefused').catch(() => {});
            });

            await page.goto('/');
            await expect(page.locator('.sidebar-nav-btn[data-tab="exportar"]')).toBeAttached({ timeout: 30000 });
            await page.waitForFunction(
                () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
                null,
                { timeout: 30000 },
            );

            await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
            await page.locator('#export-option-pdf').click();
            await expect(page.locator('.export-pdf-content')).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
            await page.locator('#pdf-dpi-select').selectOption('150');
            await page.locator('#pdf-cols-select').selectOption(colunas);

            const recusadosAntes = recusados;
            const baixado = page.waitForEvent('download', { timeout: 120000 });
            await page.locator('#pdf-export-btn').click();
            const download = await baixado;

            expect(download.suggestedFilename()).toMatch(/.pdf$/);
            // The CONTROL of the instrument: the off-screen map really asked for the failing sources.
            expect(recusados).toBeGreaterThan(recusadosAntes);
            await expect(page.locator('.pdf-export-modal')).toHaveCount(0, { timeout: 10000 });
        });
    }

    /** Boots the map and opens the single-sheet PDF panel at 150 DPI. */
    async function abrirPdf(page, destino = '/') {
        if (destino) await page.goto(destino);
        await expect(page.locator('.sidebar-nav-btn[data-tab="exportar"]')).toBeAttached({ timeout: 30000 });
        await page.waitForFunction(() => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function', null, { timeout: 30000 });
        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        await page.locator('#export-option-pdf').click();
        await expect(page.locator('.export-pdf-content')).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
        await page.locator('#pdf-dpi-select').selectOption('150');
    }

    // A TileJSON that NEVER answers (a server that accepts the connection and goes quiet) is not
    // an `error`, so the repaint above never runs for it: the export has to stop waiting on its own.
    test('uma fonte que nunca responde não trava: o PDF sai no prazo e o botão volta', async ({ page }) => {
        test.setTimeout(180000);
        await page.route('http://localhost/tiles/**', () => { /* never answered */ });
        await abrirPdf(page);
        const baixado = page.waitForEvent('download', { timeout: 120000 });
        await page.locator('#pdf-export-btn').click();
        expect((await baixado).suggestedFilename()).toMatch(/.pdf$/);
        await expect(page.locator('#pdf-export-btn')).toBeEnabled({ timeout: 10000 });
    });

    test('"Cancelar" com uma fonte pendurada devolve o botão na hora', async ({ page }) => {
        test.setTimeout(120000);
        await page.route('http://localhost/tiles/**', () => { /* never answered */ });
        await abrirPdf(page);
        await page.locator('#pdf-export-btn').click();
        await expect(page.locator('.pdf-export-modal')).toContainText('Enquadrando', { timeout: 30000 });
        await page.locator('.pdf-export-modal__cancel-btn').click();
        // Before 2026-09-23 the export stayed parked on the `idle` await: `_exporting` true and
        // the button disabled until a reload.
        await expect(page.locator('#pdf-export-btn')).toBeEnabled({ timeout: 5000 });
    });

    // The off-screen map must ask for a private source with the SAME credential as the live map
    // (`credencialDeTile`, `map_sig.js`): the atlas stamp that lends a private layer and the
    // session's Bearer. Without `transformRequest` it asked bare, the server refused, and the file
    // came out without a layer the person sees on screen.
    test('o mapa da exportação pede a fonte credenciada com o carimbo do atlas e o Bearer', async ({ page }) => {
        test.setTimeout(180000);
        const admin = await createVerifiedUser({ prefix: 'expcred', nome: 'Exportador', role: 'admin' });
        const api = async (method, caminho, body) => {
            const res = await fetch(`${state.baseUrl}/api/v1${caminho}`, {
                method,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.accessToken}` },
                body: body ? JSON.stringify(body) : undefined,
            });
            return { status: res.status, json: await res.json().catch(() => null) };
        };
        const BASE = 'http://127.0.0.1:9/tiles';
        expect((await api('PUT', '/config/admin', { services: { tileServerUrl: BASE } })).status).toBeLessThan(300);
        const camada = await api('PUT', '/data-layers/limites-municipais', {
            config: { source: { type: 'vector', url: `${BASE}/municipios` }, sourceLayer: 'municipios' },
        });
        expect(camada.status).toBeLessThan(300);
        const atlas = (await api('POST', '/atlas', { name: 'Atlas da exportação' })).json?.data;
        expect(atlas?.id).toBeTruthy();

        const pedidos = [];
        await page.route(`${BASE}/**`, async (route) => {
            const req = route.request();
            pedidos.push({ url: req.url(), auth: (await req.allHeaders()).authorization ?? null });
            await route.fulfill({ status: 404, body: '' });
        });
        await sessaoDoApp(page, admin, `/?atlas=${atlas.id}`);
        await expect(page.getByTestId('sync-status-badge')).toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await abrirPdf(page, null);
        // The CONTROL: the live map already asks with both halves, or the instrument measures nothing.
        await expect.poll(() => pedidos.length, { timeout: 30000 }).toBeGreaterThan(0);
        expect(pedidos[0].url).toContain(`atlasId=${atlas.id}`);
        expect(pedidos[0].auth).toMatch(/^Bearer /);

        const antes = pedidos.length;
        const baixado = page.waitForEvent('download', { timeout: 120000 });
        await page.locator('#pdf-export-btn').click();
        await baixado;
        const doMapaOculto = pedidos.slice(antes);
        expect(doMapaOculto.length).toBeGreaterThan(0);
        for (const pedido of doMapaOculto) {
            expect(pedido.url).toContain(`atlasId=${atlas.id}`);
            expect(pedido.auth).toMatch(/^Bearer /);
        }
    });
});

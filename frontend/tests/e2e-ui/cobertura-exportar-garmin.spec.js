// Path: e2e-ui/cobertura-exportar-garmin.spec.js

/**
 * COVERAGE: "Exportar para Garmin" of the Exportar tab, read by CONTENT, in real Chromium. Part of
 * the 2026-09-24 coverage campaign (import/export).
 *
 * The file is a KMZ of raster tiles (`import_export/garmin-kmz-export.js`): a `doc.kml` with one
 * GroundOverlay per tile and the tiles as JPEGs under `files/`. Asserted on the FILE: every overlay
 * points at a tile that exists and is a JPEG; the overlays' boxes cover the area the person
 * selected with two clicks; and the user's feature is IN the tiles (a polygon painted a colour no
 * base map uses, found in the decoded image of the tile that covers its centre).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { readState } from './state.js';
import { selectFeatureUI, recolorViaPanelUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;
const MAGENTA = '#ff00ff';

async function esperarMapa(page) {
    await page.goto('/');
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 30000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

async function soltarNoMapa(page, nome, buffer) {
    await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        container.dispatchEvent(new DragEvent('drop', {
            dataTransfer: dt, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2),
            bubbles: true, cancelable: true,
        }));
    }, { nome, base64: buffer.toString('base64') });
}

describeOrSkip('Cobertura: exportar para Garmin', () => {
    test.describe.configure({ retries: 0 });

    test('o KMZ tem um JPEG por sobreposição, cobre a área escolhida e contém a feição', async ({ page }) => {
        collabSafeTimeout();
        await esperarMapa(page);
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-53.4, -30.0], zoom: 14 }));
        await page.waitForFunction(() => globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });

        // THE AREA IS CHOSEN IN SCREEN SPACE, on the right of the map, because the sidebar panel
        // covers the left of the canvas when the Exportar tab is open: two clicks under the panel
        // never reach the map.
        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        await page.locator('.export-option-btn', { hasText: 'Exportar para Garmin' }).click();
        const tela = await page.evaluate(() => {
            const map = globalThis.__ebgeoMap;
            const rect = map.getContainer().getBoundingClientRect();
            const px = (fx, fy) => ({ x: rect.width * fx, y: rect.height * fy });
            const ll = (p) => map.unproject([p.x, p.y]);
            const a = px(0.62, 0.3);
            const b = px(0.88, 0.7);
            return {
                noroeste: ll(a), sudeste: ll(b),
            };
        });
        const selecao = { oeste: tela.noroeste.lng, norte: tela.noroeste.lat, leste: tela.sudeste.lng, sul: tela.sudeste.lat };
        const centro = [(selecao.oeste + selecao.leste) / 2, (selecao.norte + selecao.sul) / 2];
        const meio = { lng: (selecao.leste - selecao.oeste) / 4, lat: (selecao.norte - selecao.sul) / 4 };
        const area = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: { nome: 'Área magenta' },
                geometry: { type: 'Polygon', coordinates: [[
                    [centro[0] - meio.lng, centro[1] - meio.lat], [centro[0] + meio.lng, centro[1] - meio.lat],
                    [centro[0] + meio.lng, centro[1] + meio.lat], [centro[0] - meio.lng, centro[1] + meio.lat],
                    [centro[0] - meio.lng, centro[1] - meio.lat]]] } }],
        };
        await soltarNoMapa(page, 'area.geojson', B.from(JSON.stringify(area), 'utf8'));
        await expect(page.locator('.toast', { hasText: 'importad' }).first()).toBeAttached({ timeout: 15000 });
        const poligonoId = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            return (await store.getCurrentMapFeatures()).polygons[0].properties.id;
        });
        await selectFeatureUI(page, poligonoId);
        await recolorViaPanelUI(page, MAGENTA);
        await page.keyboard.press('Escape');
        // The import zoomed to the feature: back to the view the area was chosen in.
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-53.4, -30.0], zoom: 14 }));
        await page.waitForFunction(() => globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });

        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        if (!(await page.locator('#garmin-select-area-btn').isVisible())) {
            await page.locator('.export-option-btn', { hasText: 'Exportar para Garmin' }).click();
        }
        await page.locator('#garmin-select-area-btn').click();
        // The drawing starts only after the exporter module arrives (`carregarSobDemanda`), and the
        // button says so: a click before this line lands on a map that is not drawing yet.
        await expect(page.locator('#garmin-select-area-btn')).toHaveText(/Cancelar Selecao/, { timeout: 10000 });
        // Projected NOW, at the moment of the gesture: the sidebar went through the Camadas tab and
        // back, and the canvas may have moved under it since the area was chosen.
        const agora = await page.evaluate((s) => {
            const map = globalThis.__ebgeoMap;
            const rect = map.getContainer().getBoundingClientRect();
            const a = map.project([s.oeste, s.norte]);
            const b = map.project([s.leste, s.sul]);
            return { c1: { x: rect.left + a.x, y: rect.top + a.y }, c2: { x: rect.left + b.x, y: rect.top + b.y } };
        }, selecao);
        await page.mouse.click(agora.c1.x, agora.c1.y);
        await page.mouse.move(agora.c2.x, agora.c2.y, { steps: 3 });
        await page.mouse.click(agora.c2.x, agora.c2.y);
        await expect(page.locator('#garmin-export-btn')).toBeVisible({ timeout: 10000 });

        const baixando = page.waitForEvent('download', { timeout: 120000 });
        await page.locator('#garmin-export-btn').click();
        const arquivo = await baixando;
        const bytes = readFileSync(await arquivo.path());
        const zip = await JSZip.loadAsync(bytes);
        const kml = await zip.file('doc.kml').async('string');
        const overlays = [...kml.matchAll(/<GroundOverlay>[\s\S]*?<href>([^<]+)<\/href>[\s\S]*?<north>([^<]+)<\/north>\s*<south>([^<]+)<\/south>\s*<east>([^<]+)<\/east>\s*<west>([^<]+)<\/west>[\s\S]*?<\/GroundOverlay>/g)]
            .map((m) => ({ href: m[1], norte: +m[2], sul: +m[3], leste: +m[4], oeste: +m[5] }));
        console.log('[garmin]', JSON.stringify({ arquivo: arquivo.suggestedFilename(), overlays }));

        expect(overlays.length, 'ao menos uma sobreposição').toBeGreaterThan(0);
        const jpegs = Object.keys(zip.files).filter((n) => /^files\/.+\.jpg$/.test(n));
        expect(jpegs.length, 'um JPEG por sobreposição').toBe(overlays.length);
        for (const o of overlays) {
            const tile = await zip.file(o.href)?.async('nodebuffer');
            expect(tile, `${o.href} existe no KMZ`).toBeTruthy();
            expect(tile.subarray(0, 3).equals(B.from([0xff, 0xd8, 0xff])), `${o.href} é JPEG`).toBe(true);
            expect(o.norte).toBeGreaterThan(o.sul);
            expect(o.leste).toBeGreaterThan(o.oeste);
        }
        const uniao = {
            norte: Math.max(...overlays.map((o) => o.norte)), sul: Math.min(...overlays.map((o) => o.sul)),
            leste: Math.max(...overlays.map((o) => o.leste)), oeste: Math.min(...overlays.map((o) => o.oeste)),
        };
        const folga = 0.02;
        expect(uniao.norte).toBeGreaterThanOrEqual(selecao.norte - folga);
        expect(uniao.sul).toBeLessThanOrEqual(selecao.sul + folga);
        expect(uniao.leste).toBeGreaterThanOrEqual(selecao.leste - folga);
        expect(uniao.oeste).toBeLessThanOrEqual(selecao.oeste + folga);

        // The feature is in the tiles: the tile covering the feature's centre, read at that point.
        const alvo = overlays.find((o) => o.oeste <= centro[0] && o.leste >= centro[0] && o.sul <= centro[1] && o.norte >= centro[1]);
        expect(alvo, 'uma sobreposição cobre o centro da feição').toBeTruthy();
        const tile = await zip.file(alvo.href).async('base64');
        const pixel = await page.evaluate(async ({ b64, o, centro }) => {
            const img = new Image();
            img.src = `data:image/jpeg;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            // Linear inside the tile is close enough at this size for a 0.2 degree polygon.
            const x = Math.floor(((centro[0] - o.oeste) / (o.leste - o.oeste)) * c.width);
            const y = Math.floor(((o.norte - centro[1]) / (o.norte - o.sul)) * c.height);
            return [...ctx.getImageData(x, y, 1, 1).data];
        }, { b64: tile, o: alvo, centro });
        console.log('[garmin pixel]', JSON.stringify(pixel));
        const [r, g, b] = pixel;
        expect(r - g, 'a feição magenta está no ladrilho').toBeGreaterThan(60);
        expect(b - g, 'a feição magenta está no ladrilho').toBeGreaterThan(60);
    });
});

function collabSafeTimeout() {
    test.setTimeout(180000);
}

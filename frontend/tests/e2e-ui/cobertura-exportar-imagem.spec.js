// Path: e2e-ui/cobertura-exportar-imagem.spec.js

/**
 * COVERAGE: "Exportar Imagem" of the Exportar tab, read by CONTENT (the PNG's pixels), in real
 * Chromium. Part of the 2026-09-24 coverage campaign (import/export).
 *
 * A "download happened" proves nothing about a WebGL capture: a canvas read back without
 * `preserveDrawingBuffer` comes out fully TRANSPARENT and still downloads a valid PNG. So the file is
 * decoded (in the page, by an `<img>` onto a 2D canvas) and two things are asserted: it has the
 * size of the map's canvas, and the user's feature is IN it (a polygon filled with a colour no base
 * map uses, found at the centre of the image).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';
import { selectFeatureUI, recolorViaPanelUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

/** A colour no base map draws. */
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

describeOrSkip('Cobertura: exportar imagem do mapa', () => {
    test.describe.configure({ retries: 0 });

    test('o PNG tem o tamanho do mapa e a feição do usuário dentro dele', async ({ page }) => {
        await esperarMapa(page);
        const area = {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', properties: { nome: 'Área magenta' },
                geometry: { type: 'Polygon', coordinates: [[[-53.6, -30.2], [-53.2, -30.2], [-53.2, -29.8], [-53.6, -29.8], [-53.6, -30.2]]] } }],
        };
        await soltarNoMapa(page, 'area.geojson', B.from(JSON.stringify(area), 'utf8'));
        await expect(page.locator('.toast', { hasText: 'importad' }).first()).toBeAttached({ timeout: 15000 });

        // Paint it magenta through the feature panel (the person's path), then close the panel.
        const poligonoId = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            return (await store.getCurrentMapFeatures()).polygons[0].properties.id;
        });
        await selectFeatureUI(page, poligonoId);
        await recolorViaPanelUI(page, MAGENTA);
        await page.keyboard.press('Escape');
        await page.evaluate(() => {
            const map = globalThis.__ebgeoMap;
            map.jumpTo({ center: [-53.4, -30.0], zoom: 9 });
        });
        await page.waitForFunction(() => globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
        await expect.poll(() => page.evaluate(() => {
            const map = globalThis.__ebgeoMap;
            const c = map.project([-53.4, -30.0]);
            return map.queryRenderedFeatures([c.x, c.y]).some((x) => String(x.properties?.fillColor).toLowerCase() === '#ff00ff');
        }), { timeout: 15000 }).toBe(true);
        const tamanho = await page.evaluate(() => {
            const c = globalThis.__ebgeoMap.getCanvas();
            return { w: c.width, h: c.height };
        });

        await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();
        const baixando = page.waitForEvent('download', { timeout: 30000 });
        await page.locator('.export-option-btn', { hasText: 'Exportar Imagem' }).click();
        const arquivo = await baixando;
        const bytes = readFileSync(await arquivo.path());
        expect(bytes.subarray(0, 8).equals(B.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'assinatura PNG').toBe(true);
        expect(arquivo.suggestedFilename()).toMatch(/\.png$/);

        const leitura = await page.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const centro = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
            const todos = ctx.getImageData(0, 0, c.width, c.height).data;
            let opacos = 0;
            for (let i = 3; i < todos.length; i += 4) if (todos[i] > 0) opacos++;
            return { w: c.width, h: c.height, centro: [...centro], fracaoOpaca: opacos / (c.width * c.height) };
        }, bytes.toString('base64'));
        console.log('[imagem]', JSON.stringify({ tamanho, leitura }));

        expect(leitura.w).toBe(tamanho.w);
        expect(leitura.h).toBe(tamanho.h);
        expect(leitura.fracaoOpaca, 'a imagem não é transparente').toBeGreaterThan(0.9);
        // The polygon is filled at the tool's default opacity, blended over the base map, so the
        // pixel is magenta-DOMINANT rather than pure: red and blue well above green.
        const [r, g, bl] = leitura.centro;
        expect(r - g, 'vermelho acima do verde (magenta)').toBeGreaterThan(60);
        expect(bl - g, 'azul acima do verde (magenta)').toBeGreaterThan(60);
    });
});

// Path: e2e-ui/cobertura-exportar-qan.spec.js

/**
 * COVERAGE: "Exportar QAN" (the leg-by-leg azimuth and distance table of a line or polygon), read by
 * CONTENT, in real Chromium. Part of the 2026-09-24 coverage campaign (import/export).
 *
 * `qan-export.test.js` checks the generator in node. Here the path is the person's: an IMPORTED line
 * and polygon (imported features are the ones whose `baseCoordinates` the import has to build, and
 * the generator reads nothing else), the feature panel's Azimutes tab, the button, the file. Per
 * file: one row per leg (a polygon closes its ring, a line does not), the azimuth of each leg
 * against a value computed here (on an axis-aligned figure: 90, 180, 270, 0), the observation typed
 * in the tab, and the name escaped in the title.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readState } from './state.js';
import { selectFeatureUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

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
            dataTransfer: dt, clientX: Math.round(rect.left + rect.width / 2), clientY: Math.round(rect.top + rect.height / 2), bubbles: true, cancelable: true,
        }));
    }, { nome, base64: buffer.toString('base64') });
}

const FIGURAS = {
    type: 'FeatureCollection',
    features: [
        // Counter-clockwise from the south-west corner: legs go east, north, west, south.
        { type: 'Feature', properties: { nome: 'Área <Alfa> & Bravo' },
            geometry: { type: 'Polygon', coordinates: [[[-53.5, -30.1], [-53.4, -30.1], [-53.4, -30.0], [-53.5, -30.0], [-53.5, -30.1]]] } },
        { type: 'Feature', properties: { nome: 'Eixo Charlie' },
            geometry: { type: 'LineString', coordinates: [[-53.3, -30.0], [-53.3, -30.1], [-53.2, -30.1]] } },
    ],
};

async function exportarQan(page, id, observacao) {
    await selectFeatureUI(page, id);
    await page.locator('.feature-tab-btn[data-tab-id="azimutes"]').click();
    const aba = page.locator('.feature-tab-content[data-tab-id="azimutes"]');
    await expect(aba.locator('.obs-editor__input').first()).toBeVisible({ timeout: 10000 });
    await aba.locator('.obs-editor__input').first().fill(observacao);
    await aba.locator('.obs-editor__input').first().press('Tab');
    const baixando = page.waitForEvent('download', { timeout: 15000 });
    await aba.getByRole('button', { name: 'Exportar QAN' }).click();
    const arquivo = await baixando;
    const html = readFileSync(await arquivo.path(), 'utf8');
    await page.keyboard.press('Escape');
    const linhas = [...html.matchAll(/<tr>\s*<td>(\d+)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([\d.]+)&deg;<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g)]
        .map((m) => ({ perna: Number(m[1]), azimute: Number(m[4]), distancia: m[5], observacao: m[6] }));
    return { nome: arquivo.suggestedFilename(), html, linhas };
}

describeOrSkip('Cobertura: exportar QAN', () => {
    test.describe.configure({ retries: 0 });

    test('uma linha por perna, azimute certo, observação e nome escapado', async ({ page }) => {
        await esperarMapa(page);
        await soltarNoMapa(page, 'figuras.geojson', B.from(JSON.stringify(FIGURAS), 'utf8'));
        await expect(page.locator('.toast', { hasText: 'importad' }).first()).toBeAttached({ timeout: 15000 });
        const ids = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const f = await store.getCurrentMapFeatures();
            return { poligono: f.polygons[0].properties.id, linha: f.lines[0].properties.id };
        });

        const area = await exportarQan(page, ids.poligono, 'Cerca & <portão>');
        console.log('[qan área]', area.nome, JSON.stringify(area.linhas));
        expect(area.linhas.map((l) => l.perna), 'o polígono fecha o anel: 4 pernas').toEqual([1, 2, 3, 4]);
        const esperadoArea = [90, 0, 270, 180];
        area.linhas.forEach((l, i) => expect(Math.abs(((l.azimute - esperadoArea[i] + 540) % 360) - 180), `perna ${i + 1}`).toBeLessThan(0.2));
        expect(area.linhas[0].observacao).toBe('Cerca &amp; &lt;portão&gt;');
        expect(area.html).toContain('Área &lt;Alfa&gt; &amp; Bravo');
        expect(area.html).not.toContain('<Alfa>');

        const eixo = await exportarQan(page, ids.linha, 'Ponte');
        console.log('[qan eixo]', eixo.nome, JSON.stringify(eixo.linhas));
        expect(eixo.linhas.map((l) => l.perna), 'a linha não fecha: 2 pernas').toEqual([1, 2]);
        [180, 90].forEach((az, i) => expect(Math.abs(((eixo.linhas[i].azimute - az + 540) % 360) - 180), `perna ${i + 1}`).toBeLessThan(0.2));
        expect(eixo.linhas[0].observacao).toBe('Ponte');
        // 0.1 degree of latitude is about 11.1 km.
        expect(eixo.linhas[0].distancia).toMatch(/^11[.,]\d+ ?km$/);
    });
});

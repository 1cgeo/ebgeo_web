// Path: e2e-ui/poligono-importado-com-buraco.spec.js

/**
 * AN IMPORTED POLYGON WITH A HOLE KEEPS THE HOLE when it is moved or copied, in real Chromium,
 * through the real gestures (the file dropped on the map; the feature selected in the Camadas tab;
 * Ctrl+C / Ctrl+V; a drag of the selected feature).
 *
 * The drawing tool never makes a hole, but an import does (a lake inside a municipality, a
 * clearing inside a forest). The import keeps the holes in the GEOMETRY and stores only the outer
 * ring in `baseCoordinates`; every gesture that REGENERATES the geometry from `baseCoordinates`
 * (paste, move) drops the holes, and the polygon silently becomes solid.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { selectFeatureUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const B = globalThis.Buffer;

const ALVO = [-53.4, -30.0];

async function esperarMapa(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
    await expect.poll(() => page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return !!store.getControl('commentOverlay');
    }), { timeout: 20000 }).toBe(true);
}

function poligonos(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f.polygons || []).map((p) => ({
            id: p.properties?.id,
            aneis: p.geometry?.type === 'Polygon' ? p.geometry.coordinates.length : -1,
            primeiro: p.geometry?.coordinates?.[0]?.[0],
        }));
    });
}

async function soltarNoMapa(page, nome, buffer) {
    await page.evaluate(async (e) => {
        const map = globalThis.__ebgeoMap;
        const container = map.getContainer();
        const rect = container.getBoundingClientRect();
        const pt = map.project(e.lngLat);
        const corpo = Uint8Array.from(atob(e.base64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([corpo], e.nome, { type: 'application/octet-stream' }));
        container.dispatchEvent(new DragEvent('drop', {
            dataTransfer: dt, clientX: Math.round(rect.left + pt.x), clientY: Math.round(rect.top + pt.y),
            bubbles: true, cancelable: true,
        }));
    }, { lngLat: ALVO, nome, base64: buffer.toString('base64') });
}

const COM_BURACO = {
    type: 'FeatureCollection',
    features: [{
        type: 'Feature',
        properties: { nome: 'Mata com clareira' },
        geometry: {
            type: 'Polygon',
            coordinates: [
                [[-53.6, -30.2], [-53.2, -30.2], [-53.2, -29.8], [-53.6, -29.8], [-53.6, -30.2]],
                [[-53.45, -30.05], [-53.35, -30.05], [-53.35, -29.95], [-53.45, -29.95], [-53.45, -30.05]],
            ],
        },
    }],
};

describeOrSkip('Polígono importado com buraco', () => {
    test.describe.configure({ retries: 0 });

    test('copiar e colar mantém o buraco', async ({ page }) => {
        await esperarMapa(page);
        await soltarNoMapa(page, 'mata.geojson', B.from(JSON.stringify(COM_BURACO), 'utf8'));
        await expect.poll(async () => (await poligonos(page)).length, { timeout: 15000 }).toBe(1);
        const [original] = await poligonos(page);
        expect(original.aneis).toBe(2);

        await selectFeatureUI(page, original.id);
        await page.keyboard.press('Escape').catch(() => {});
        await selectFeatureUI(page, original.id);
        await page.locator('body').click({ position: { x: 1, y: 1 }, trial: true }).catch(() => {});
        await page.keyboard.press('Control+c');
        await page.keyboard.press('Control+v');

        await expect.poll(async () => (await poligonos(page)).length, { timeout: 15000 }).toBe(2);
        const colado = (await poligonos(page)).find((p) => p.id !== original.id);
        console.log('[colado]', JSON.stringify(colado));
        expect(colado.aneis, 'o polígono colado perdeu o buraco').toBe(2);
    });

    test('arrastar o polígono selecionado mantém o buraco', async ({ page }) => {
        await esperarMapa(page);
        await soltarNoMapa(page, 'mata.geojson', B.from(JSON.stringify(COM_BURACO), 'utf8'));
        await expect.poll(async () => (await poligonos(page)).length, { timeout: 15000 }).toBe(1);
        const [original] = await poligonos(page);
        await selectFeatureUI(page, original.id);

        // A point of the forest, not of the clearing, projected at the moment of the gesture.
        const ponto = await page.evaluate(() => {
            const map = globalThis.__ebgeoMap;
            const rect = map.getContainer().getBoundingClientRect();
            const p = map.project([-53.55, -30.15]);
            return { x: rect.left + p.x, y: rect.top + p.y };
        });
        await page.mouse.move(ponto.x, ponto.y);
        await page.mouse.down();
        await page.mouse.move(ponto.x + 40, ponto.y + 10, { steps: 5 });
        await page.mouse.move(ponto.x + 80, ponto.y + 20, { steps: 5 });
        await page.mouse.up();

        await expect.poll(async () => (await poligonos(page))[0].primeiro[0], { timeout: 15000 })
            .not.toBe(original.primeiro[0]);
        const [movido] = await poligonos(page);
        console.log('[movido]', JSON.stringify(movido));
        expect(movido.aneis, 'o polígono arrastado perdeu o buraco').toBe(2);
    });
});

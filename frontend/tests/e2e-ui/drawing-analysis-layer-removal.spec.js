import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readState } from './state.js';
const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

for (const [tool, storage, group] of [['image', 'images', 'draw'], ['los', 'los', 'analysis'], ['visibility', 'visibility', 'analysis']]) {
    test(`${tool}: removing the original layer preserves main and processed features in a live layer`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect.poll(() => page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync())).toEqual(expect.any(String));
        const layerId = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const layer = await store.createLayer('Pending analysis');
            store.setActiveLayer(layer.id);
            return layer.id;
        });
        await page.evaluate(async tool => {
            const map = globalThis.__ebgeoMap;
            map.jumpTo({ center: [-43.2, -22.9], zoom: 14 });
            if (tool !== 'image') {
                map.getTerrain = () => ({ source: 'synthetic-test-terrain', exaggeration: 1 });
                map.queryTerrainElevation = () => 0;
                map.fire('terrain');
            }
            const { IDUtils } = await import('/src/js/utilities/index.js');
            const original = IDUtils.generateFeatureName;
            IDUtils.generateFeatureName = async function (...args) {
                IDUtils.generateFeatureName = original;
                await new Promise(resolve => { globalThis.releaseDrawingName = resolve; });
                return original.apply(this, args);
            };
        }, tool);
        await page.locator(`.toolbar-group[data-group-id="${group}"] .toolbar-group-btn`).click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        if (tool === 'image') {
            const png = await page.evaluate(() => {
                const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20;
                const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e02030'; ctx.fillRect(0, 0, 40, 20);
                return canvas.toDataURL('image/png').split(',')[1];
            });
            const chooser = page.waitForEvent('filechooser');
            await page.mouse.click(650, 340);
            await (await chooser).setFiles({ name: 'audit.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
        } else {
            await page.mouse.click(650, 340);
            await page.mouse.click(680, 365);
        }
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        // The modal blocks pointer input, but a peer/application operation can remove the layer.
        await page.evaluate(async id => (await import('/src/js/store/index.js')).deleteLayer(id), layerId);
        await page.evaluate(() => globalThis.releaseDrawingName());
        const read = () => page.evaluate(async storage => {
            const store = await import('/src/js/store/index.js');
            const data = await store.getCurrentMapFeatures();
            return { main: data[storage], processed: data[`processed_${storage}`] || [],
                layers: store.getLayers().map(layer => layer.id) };
        }, storage);
        await expect.poll(async () => (await read()).main.length, { timeout: 30000 }).toBe(1);
        if (tool !== 'image') await expect.poll(async () => (await read()).processed.length).toBeGreaterThan(0);
        const verifyLayers = async () => {
            const { main, processed, layers } = await read();
            for (const feature of [...main, ...processed]) expect(layers).toContain(feature.properties.layerId);
            return main[0].properties.id;
        };
        const id = await verifyLayers();
        await page.reload();
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect.poll(async () => (await read()).main.map(feature => feature.properties.id)).toEqual([id]);
        await verifyLayers();
    });
}

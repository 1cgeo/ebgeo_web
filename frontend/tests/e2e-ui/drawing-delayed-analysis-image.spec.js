import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readState } from './state.js';
const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

for (const [tool, storage, group] of [['image', 'images', 'draw'], ['los', 'los', 'analysis'], ['visibility', 'visibility', 'analysis']]) {
    test(`${tool}: an application map switch during finalization preserves the original destination`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect.poll(() => page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync())).toEqual(expect.any(String));
        const otherMap = await page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await page.getByTestId('maps-new-map').click();
        await page.locator('.prompt-modal-input').fill('Origem do trabalho');
        await page.locator('.prompt-modal-btn-confirm').click();
        await expect(page.locator('#current-map-name-input')).toHaveValue('Origem do trabalho');
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
        // The analysis progress modal blocks pointer input. Exercise the real store transition,
        // which also represents a map change initiated by another application component.
        await page.evaluate(async otherMap => (await import('/src/js/store/index.js')).setCurrentMap(otherMap), otherMap);
        await page.evaluate(() => globalThis.releaseDrawingName());
        const counts = () => page.evaluate(async ({ otherMap, storage }) => {
            const store = await import('/src/js/store/index.js');
            const original = await store.getMapDataStore('Origem do trabalho');
            const other = await store.getMapDataStore(otherMap);
            return { original: original.features[storage].length, other: other.features[storage].length };
        }, { otherMap, storage });
        await expect.poll(counts, { timeout: 30000 }).toEqual({ original: 1, other: 0 });
        if (tool !== 'image') {
            await expect.poll(() => page.evaluate(async storage => {
                const store = await import('/src/js/store/index.js');
                return (await store.getMapDataStore('Origem do trabalho')).features[`processed_${storage}`].length;
            }, storage), { timeout: 30000 }).toBeGreaterThan(0);
        }
        await page.reload();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect.poll(counts).toEqual({ original: 1, other: 0 });
    });
}

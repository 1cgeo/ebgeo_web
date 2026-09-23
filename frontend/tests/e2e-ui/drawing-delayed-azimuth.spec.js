import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });

test.describe.configure({ retries: 0 });
for (const [mode, storage, expected] of [['point', 'points', 3], ['route', 'lines', 1], ['area', 'polygons', 1]]) {
    const tool = 'azimuthDistance';
    test(`a completed azimuth ${mode} waiting for its name is saved to its original map`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
        await expect.poll(() => page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            return store.getCurrentMapNameSync();
        })).toEqual(expect.any(String));
        const originalMap = await page.evaluate(async () =>
            (await import('/src/js/store/index.js')).getCurrentMapName());
        await page.evaluate(async () => {
            const { IDUtils } = await import('/src/js/utilities/index.js');
            const original = IDUtils.generateFeatureName;
            IDUtils.generateFeatureName = async function (...args) {
                IDUtils.generateFeatureName = original;
                await new Promise(resolve => { globalThis.releaseDrawingName = resolve; });
                return original.apply(this, args);
            };
        });
        await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        await page.locator(`.azd-mode-btn[data-mode="${mode}"]`).click();
        await page.mouse.click(650, 340);
        await page.locator('.azd-leg-row[data-index="0"] input[placeholder="Az"]').fill('90');
        await page.locator('.azd-leg-row[data-index="0"] input[placeholder="Dist"]').fill('200');
        await page.locator('.azd-add-leg-btn').click();
        await page.locator('.azd-leg-row[data-index="1"] input[placeholder="Az"]').fill('0');
        await page.locator('.azd-leg-row[data-index="1"] input[placeholder="Dist"]').fill('200');
        await page.locator('.azd-btn-create').click();
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await page.getByTestId('maps-new-map').click();
        await page.locator('.prompt-modal-input').fill('Segundo mapa');
        await page.locator('.prompt-modal-btn-confirm').click();
        await expect(page.locator('#current-map-name-input')).toHaveValue('Segundo mapa');
        await page.evaluate(() => globalThis.releaseDrawingName());
        const counts = () => page.evaluate(async ({ originalMap, storage }) => {
            const store = await import('/src/js/store/index.js');
            const oldMap = await store.getMapDataStore(originalMap);
            const nextMap = await store.getMapDataStore('Segundo mapa');
            return { original: oldMap.features[storage].length, next: nextMap.features[storage].length };
        }, { originalMap, storage });
        await expect.poll(counts).toEqual({ original: expected, next: 0 });
        expect(await page.evaluate(async type =>
            (await globalThis.__ebgeoMap.getSource(type).getData()).features.length, storage)).toBe(0);
        await page.reload();
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
        await expect.poll(counts).toEqual({ original: expected, next: 0 });
    });
}

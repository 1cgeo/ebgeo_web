import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });

test.describe.configure({ retries: 0 });
for (const [tool, storage, group, gesture] of [['brush','brushes','draw','stroke'], ['arrow','arrows','military','vertices'], ['boundary','boundarys','military','vertices'], ['coordinationLine','coordination_lines','military','vertices'], ['occupiedFront','occupied_fronts','military','pair'], ['declination','magnetic_declinations','military','single'], ['militarySymbol','military_symbols','military','single'], ['coordination','coordination_measures','military','single'], ['engineeringSymbol','engineering_symbols','military','single']]) {
    test(`a completed ${tool} waiting for its name is saved to its original map`, async ({ page }) => {
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
        await page.locator(`.toolbar-group[data-group-id="${group}"] .toolbar-group-btn`).click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        if (gesture === 'stroke') {
            await page.mouse.move(520, 300);
            await page.mouse.down();
            await page.mouse.move(650, 430, { steps: 8 });
            await page.mouse.move(790, 300, { steps: 8 });
            await page.mouse.up();
        } else {
            await page.mouse.click(520, 300);
            if (gesture !== 'single') await page.mouse.click(650, 430);
            if (gesture === 'vertices') await page.mouse.click(790, 300, { button: 'right' });
        }
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
        await expect.poll(counts).toEqual({ original: 1, next: 0 });
        expect(await page.evaluate(async type =>
            (await globalThis.__ebgeoMap.getSource(type).getData()).features.length, storage)).toBe(0);
        await page.reload();
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
        await expect.poll(counts).toEqual({ original: 1, next: 0 });
    });
}

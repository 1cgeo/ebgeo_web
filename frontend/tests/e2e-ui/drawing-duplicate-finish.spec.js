import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

for (const [tool, storage] of [['line', 'lines'], ['polygon', 'polygons']]) {
    for (const newGesture of [false, true]) {
    test(`${tool}: ${newGesture ? 'a new drawing can finish while the previous one saves' : 'finishing twice creates only one feature'}`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect.poll(() => page.evaluate(async () =>
            (await import('/src/js/store/index.js')).getCurrentMapNameSync())).toEqual(expect.any(String));
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        await page.evaluate(async tool => {
            const store = await import('/src/js/store/index.js');
            const control = store.getControl(tool === 'line' ? 'AddLineControl' : 'AddPolygonControl');
            const create = control.createFeature;
            let count = 0;
            globalThis.finishedCreates = [];
            control.createFeature = async () => {
                const call = ++count;
                try { return await create(); } finally { globalThis.finishedCreates.push(call); }
            };
            const { IDUtils } = await import('/src/js/utilities/index.js');
            const name = IDUtils.generateFeatureName;
            IDUtils.generateFeatureName = async function (...args) {
                IDUtils.generateFeatureName = name;
                await new Promise(resolve => { globalThis.releaseDrawingName = resolve; });
                return name.apply(this, args);
            };
        }, tool);
        await page.mouse.click(520, 300);
        await page.mouse.click(650, 430);
        await page.mouse.click(790, 300, { button: 'right' });
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        if (newGesture) {
            await page.keyboard.press('Escape');
            await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
            await page.locator(`[data-tool-id="${tool}"]`).click();
            await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
            await page.mouse.click(520, 320);
            await page.mouse.click(650, 450);
            await page.mouse.click(790, 320, { button: 'right' });
        } else {
            await page.mouse.click(790, 300, { button: 'right' });
        }
        await page.evaluate(() => globalThis.releaseDrawingName());
        await page.waitForFunction(() => globalThis.finishedCreates.includes(1));
        if (newGesture) await page.waitForFunction(() => globalThis.finishedCreates.includes(2));
        const result = await page.evaluate(async storage => {
            const store = await import('/src/js/store/index.js');
            return {
                persisted: (await store.getCurrentMapFeatures())[storage].length,
                drawn: (await globalThis.__ebgeoMap.getSource(storage).getData()).features.length,
            };
        }, storage);
        expect(result).toEqual({ persisted: newGesture ? 2 : 1, drawn: newGesture ? 2 : 1 });
    });
    }
}

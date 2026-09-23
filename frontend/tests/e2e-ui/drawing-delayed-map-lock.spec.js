import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

for (const [tool, storage, controlKey, createMethod] of [
    ['line', 'lines', 'AddLineControl', 'createFeature'],
    ['polygon', 'polygons', 'AddPolygonControl', 'createFeature'],
    ['point', 'points', 'AddPointControl', 'createPointAtCoordinates'],
    ['circle', 'circles', 'AddCircleControl', 'createFeature'],
]) {
    test(`a ${tool} refused after a map lock never appears as a saved drawing`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect.poll(() => page.evaluate(async () =>
            (await import('/src/js/store/index.js')).getCurrentMapNameSync())).toEqual(expect.any(String));
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        await page.evaluate(async ({ controlKey, createMethod }) => {
            const store = await import('/src/js/store/index.js');
            const control = store.getControl(controlKey);
            const create = control[createMethod];
            control[createMethod] = async (...args) => {
                try { return await create(...args); } finally { globalThis.drawingFinished = true; }
            };
            const { IDUtils } = await import('/src/js/utilities/index.js');
            const name = IDUtils.generateFeatureName;
            IDUtils.generateFeatureName = async function (...args) {
                IDUtils.generateFeatureName = name;
                await new Promise(resolve => { globalThis.releaseDrawingName = resolve; });
                return name.apply(this, args);
            };
        }, { controlKey, createMethod });
        await page.mouse.click(520, 300);
        if (tool !== 'point') await page.mouse.click(650, 430);
        if (tool === 'line' || tool === 'polygon') await page.mouse.click(790, 300, { button: 'right' });
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        expect(await page.evaluate(async () => {
            const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
            return mapLockController.toggleMapLock();
        })).toBe(true);
        await page.evaluate(() => globalThis.releaseDrawingName());
        await page.waitForFunction(() => globalThis.drawingFinished === true);
        const result = await page.evaluate(async storage => {
            const store = await import('/src/js/store/index.js');
            return {
                persisted: (await store.getCurrentMapFeatures())[storage].length,
                drawn: (await globalThis.__ebgeoMap.getSource(storage).getData()).features.length,
            };
        }, storage);
        expect(result).toEqual({ persisted: 0, drawn: 0 });
    });
}

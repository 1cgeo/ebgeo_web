import { test, expect } from '@playwright/test';
import { readState } from './state.js';
const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });
for (const [tool, storage, name] of [['measureDistance','lines','MeasurementDistanceControl'], ['measureArea','polygons','MeasurementAreaControl']]) {
    test(`${tool}: saving a measurement twice preserves a single feature`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await page.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn').click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        await page.mouse.click(520, 300);
        await page.mouse.click(650, 430);
        await page.mouse.click(790, 300);
        await page.mouse.click(790, 300, { button: 'right' });
        await expect(page.locator('.measurement-results-panel__save-btn')).toBeVisible();
        await page.evaluate(async name => {
            const store = await import('/src/js/store/index.js');
            const control = store.getControl(name);
            const save = control._saveAsFeature.bind(control);
            control._saveAsFeature = async (...args) => {
                globalThis.measurementSaveStarted = (globalThis.measurementSaveStarted || 0) + 1;
                try { return await save(...args); } finally { globalThis.measurementSaveFinished = (globalThis.measurementSaveFinished || 0) + 1; }
            };
            const repo = (await import('/src/js/store/repositories/index.js')).getRepository();
            // Store operations bind a fresh repository to the captured atlas scope.
            const prototype = Object.getPrototypeOf(repo);
            const original = prototype.saveMap;
            prototype.saveMap = async function (...args) {
                prototype.saveMap = original;
                const result = await original.apply(this, args);
                await new Promise(resolve => { globalThis.releaseMeasurementSave = resolve; });
                return result;
            };
        }, name);
        await page.locator('.measurement-results-panel__save-btn').click();
        await page.waitForFunction(() => typeof globalThis.releaseMeasurementSave === 'function');
        await page.locator('.measurement-results-panel__save-btn').click();
        await page.evaluate(() => globalThis.releaseMeasurementSave());
        await page.waitForFunction(() => globalThis.measurementSaveFinished, null, { timeout: 10000 });
        const read = () => page.evaluate(async storage => (await (await import('/src/js/store/index.js')).getCurrentMapFeatures())[storage], storage);
        await expect.poll(async () => (await read()).length).toBe(1);
        await expect.poll(() => page.evaluate(() => globalThis.measurementSaveFinished)).toBe(2);
        const [saved] = await read();
        await page.reload();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect.poll(async () => (await read()).map(feature => feature.properties.id)).toEqual([saved.properties.id]);
        expect((await read())[0].geometry).toEqual(saved.geometry);
    });
}

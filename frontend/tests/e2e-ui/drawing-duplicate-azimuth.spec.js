import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });

test.describe.configure({ retries: 0 });
for (const [mode, storage, expected] of [['point', 'points', 3], ['route', 'lines', 1], ['area', 'polygons', 1]]) {
    const tool = 'azimuthDistance';
    test(`a completed azimuth ${mode} is not duplicated by a repeated create click`, async ({ page }) => {
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
        await page.evaluate(async () => {
            const control = (await import('/src/js/store/index.js')).getControl('AddAzimuthDistanceControl');
            const original = control._createFeature.bind(control);
            let count = 0;
            globalThis.finishedCreates = [];
            control._createFeature = async (...args) => {
                const id = ++count;
                try { return await original(...args); } finally { globalThis.finishedCreates.push(id); }
            };
        });
        await page.locator(`.azd-mode-btn[data-mode="${mode}"]`).click();
        await page.mouse.click(650, 340);
        await page.locator('.azd-leg-row[data-index="0"] input[placeholder="Az"]').fill('90');
        await page.locator('.azd-leg-row[data-index="0"] input[placeholder="Dist"]').fill('200');
        await page.locator('.azd-add-leg-btn').click();
        await page.locator('.azd-leg-row[data-index="1"] input[placeholder="Az"]').fill('0');
        await page.locator('.azd-leg-row[data-index="1"] input[placeholder="Dist"]').fill('200');
        await page.locator('.azd-btn-create').click();
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        await page.locator('.azd-btn-create').click();
        await page.evaluate(() => globalThis.releaseDrawingName());
        await page.waitForFunction(() => globalThis.finishedCreates.includes(1) && globalThis.finishedCreates.includes(2));
        const features = await page.evaluate(async ({ originalMap, storage }) => {
            const store = await import('/src/js/store/index.js');
            return (await store.getMapDataStore(originalMap)).features[storage];
        }, { originalMap, storage });
        expect(features).toHaveLength(expected);
        expect(features.every(feature => feature.geometry.coordinates.length > 0)).toBe(true);
        const ids = features.map(feature => feature.properties.id).sort();
        const visible = () => page.evaluate(async storage => (await globalThis.__ebgeoMap.getSource(storage).getData()).features.map(feature => feature.properties.id).sort(), storage);
        await expect.poll(visible).toEqual(ids);
        await page.reload();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect.poll(visible).toEqual(ids);
    });
}

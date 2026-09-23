// Path: e2e-ui/drawing-delayed-layer-removal.spec.js
import { test, expect } from '@playwright/test';
import { readState } from './state.js';
const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

for (const [tool, storage] of [['point', 'points'], ['line', 'lines'], ['polygon', 'polygons'], ['circle', 'circles'], ['rectangle', 'rectangles'], ['ellipse', 'ellipses'], ['sector', 'setores'], ['text', 'texts']]) {
    for (const change of ['removed', 'inactive']) {
    test(`${tool}: its layer becoming ${change} during finalization preserves a valid destination`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        const layerId = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const layer = await store.createLayer('Pending drawing');
            store.setActiveLayer(layer.id);
            const { IDUtils } = await import('/src/js/utilities/index.js');
            const original = IDUtils.generateFeatureName;
            IDUtils.generateFeatureName = async function (...args) {
                IDUtils.generateFeatureName = original;
                await new Promise(resolve => { globalThis.releaseDrawingName = resolve; });
                return original.apply(this, args);
            };
            return layer.id;
        });
        await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
        await page.locator(`[data-tool-id="${tool}"]`).click();
        await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'true');
        await page.mouse.click(520, 300);
        if (!['point', 'text'].includes(tool)) await page.mouse.click(650, 430);
        if (['line', 'polygon'].includes(tool)) await page.mouse.click(790, 300, { button: 'right' });
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        // A peer can remove the layer while the drawing is still preparing its name.
        await page.evaluate(async ({ id, change }) => {
            const store = await import('/src/js/store/index.js');
            if (change === 'removed') {
                await store.deleteLayer(id);
            } else {
                const next = await store.createLayer('Next layer');
                store.setActiveLayer(next.id);
            }
            globalThis.releaseDrawingName();
        }, { id: layerId, change });
        const read = () => page.evaluate(async type => {
            const store = await import('/src/js/store/index.js');
            return { features: (await store.getCurrentMapFeatures())[type], layers: store.getLayers() };
        }, storage);
        await expect.poll(async () => (await read()).features.length).toBe(1);
        const { features, layers } = await read();
        expect(layers.map(layer => layer.id)).toContain(features[0].properties.layerId);
        if (change === 'inactive') expect(features[0].properties.layerId).toBe(layerId);
        else expect(features[0].properties.layerId).not.toBe(layerId);
        const id = features[0].properties.id;
        await page.reload();
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect.poll(async () => (await read()).features.map(feature => feature.properties.id)).toEqual([id]);
        const reloaded = await read();
        expect(reloaded.layers.map(layer => layer.id)).toContain(reloaded.features[0].properties.layerId);
    });
    }
}

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });

test.describe.configure({ retries: 0 });
for (const [tool, storage, vertices] of [['line', 'lines', 3], ['polygon', 'polygons', 4], ['point', 'points', 2], ['text', 'texts', 2], ['circle', 'circles', null], ['rectangle', 'rectangles', null], ['ellipse', 'ellipses', null], ['sector', 'setores', null]]) {
    for (const next of ['point', 'palette']) {
    const nextTool = tool === 'point' ? 'line' : 'point';
    test(`a delayed ${tool} save retains its geometry and the next ${next} interaction`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
        await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
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
        await page.mouse.click(520, 300);
        if (!['point', 'text'].includes(tool)) await page.mouse.click(650, 430);
        if (['line', 'polygon'].includes(tool)) await page.mouse.click(790, 300, { button: 'right' });
        await page.waitForFunction(() => typeof globalThis.releaseDrawingName === 'function');
        if (next === 'point') {
            await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
            await page.locator(`[data-tool-id="${nextTool}"]`).click();
            await expect(page.locator(`[data-tool-id="${nextTool}"]`)).toHaveAttribute('data-active', 'true');
        } else {
            await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
            await expect(page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup'))
                .toHaveAttribute('data-visible', 'true');
        }
        await page.evaluate(() => globalThis.releaseDrawingName());
        await expect.poll(() => page.evaluate(async type => {
            const { getCurrentMapFeatures } = await import('/src/js/store/index.js');
            return (await getCurrentMapFeatures())[type].length;
        }, storage)).toBe(1);
        const geometry = await page.evaluate(async type => {
            const { getCurrentMapFeatures } = await import('/src/js/store/index.js');
            return (await getCurrentMapFeatures())[type][0].geometry;
        }, storage);
        if (vertices !== null) expect((tool === 'polygon' ? geometry.coordinates[0] : geometry.coordinates).length).toBe(vertices);
        else expect(geometry.coordinates[0].length).toBeGreaterThan(3);
        await expect.poll(() => page.evaluate(async type =>
            (await globalThis.__ebgeoMap.getSource(type).getData()).features.length, storage)).toBe(1);
        if (next === 'point') {
            await expect(page.locator(`[data-tool-id="${nextTool}"]`)).toHaveAttribute('data-active', 'true');
            await expect(page.locator('#map-sig canvas')).toHaveCSS('cursor', 'crosshair');
        } else {
            await expect(page.locator(`[data-tool-id="${tool}"]`)).toHaveAttribute('data-active', 'false');
            await expect(page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup'))
                .toHaveAttribute('data-visible', 'true');
        }
    });
    }
}

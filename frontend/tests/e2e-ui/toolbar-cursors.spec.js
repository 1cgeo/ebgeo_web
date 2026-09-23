// Path: tests/e2e-ui/toolbar-cursors.spec.js

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { TOOL_GROUPS } from '../../src/js/toolbar/toolbar.constants.js';
import { seedSharedAtlas, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('MapLibre tool cursors', () => {
    test('every available toolbar tool keeps its cursor after movement and releases it on Escape', async ({ page }, testInfo) => {
        test.setTimeout(180000);
        await page.goto('/');
        const canvas = page.locator('#map-sig canvas');
        await expect(page.locator('#toolbar-container')).toBeVisible();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.isStyleLoaded());

        // Use a real MapLibre DEM source even on deployments without a terrain service.
        // No terrain samples are needed: this test checks tool activation, not analysis results.
        await page.evaluate(async () => {
            const { default: config } = await import('/src/js/config.js');
            config.map2d.terrainSource ??= { type: 'raster-dem', tiles: [] };
            const map = globalThis.__ebgeoMap;
            map.addSource('cursor-test-dem', { type: 'raster-dem', tiles: [], tileSize: 256 });
            map.setTerrain({ source: 'cursor-test-dem' });
        });

        for (const group of Object.values(TOOL_GROUPS)) {
            for (const tool of group.tools) {
                await test.step(tool.label, async () => {
                    await page.locator(`[data-group-id="${group.id}"] .toolbar-group-btn`).click();
                    const button = page.locator(`.toolbar-tool-btn[data-tool-id="${tool.id}"]`);
                    await button.click();
                    await expect(button).toHaveAttribute('data-active', 'true');
                    const cursor = tool.id === 'featureInfo' ? 'help' : 'crosshair';
                    await expect(canvas).toHaveCSS('cursor', cursor);
                    await page.mouse.move(620, 380);
                    await page.mouse.move(660, 410);
                    await expect(canvas).toHaveCSS('cursor', cursor);
                    await expect(page.locator('#active-tool-chip')).toBeVisible();
                    await expect(page.locator('#active-tool-chip .active-tool-chip-name')).toHaveText(tool.label);
                    await expect(page.locator(`[data-group-id="${group.id}"] .toolbar-popup`)).toBeHidden();
                    await page.screenshot({ path: testInfo.outputPath(`cursor-${tool.id}.png`) });
                    await page.keyboard.press('Escape');
                    await expect(button).toHaveAttribute('data-active', 'false');
                    await expect(canvas).toHaveCSS('cursor', 'grab');
                });
            }
        }

        // Direct replacement also runs all deactivation/activation listeners.
        for (const group of Object.values(TOOL_GROUPS)) {
            for (const tool of group.tools) {
                await test.step(`switch to ${tool.label}`, async () => {
                    await page.locator(`[data-group-id="${group.id}"] .toolbar-group-btn`).click();
                    const button = page.locator(`.toolbar-tool-btn[data-tool-id="${tool.id}"]`);
                    await button.click();
                    await expect(button).toHaveAttribute('data-active', 'true');
                    await page.mouse.move(660, 410);
                    await expect(canvas, tool.label).toHaveCSS('cursor', tool.id === 'featureInfo' ? 'help' : 'crosshair');
                });
            }
        }
        await page.keyboard.press('Escape');
        await expect(canvas).toHaveCSS('cursor', 'grab');
    });

    test('comment placement and drawing release each other without losing the cursor', async ({ browser }, testInfo) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        try {
            const canvas = page.locator('#map-sig canvas');
            await page.keyboard.press('Shift+C');
            await expect(canvas).toHaveCSS('cursor', 'crosshair');
            await page.mouse.move(650, 400);
            await expect(canvas).toHaveCSS('cursor', 'crosshair');
            await page.screenshot({ path: testInfo.outputPath('cursor-comment.png') });
            await page.keyboard.press('p');
            await expect(page.locator('[data-tool-id="point"]')).toHaveAttribute('data-active', 'true');
            expect(await page.evaluate(async () => {
                const { getControl } = await import('/src/js/store/control.registry.js');
                return getControl('commentOverlay').isPlacing();
            })).toBe(false);
            await expect(canvas).toHaveCSS('cursor', 'crosshair');
            await page.keyboard.press('Shift+C');
            await expect(page.locator('[data-tool-id="point"]')).toHaveAttribute('data-active', 'false');
            await expect(canvas).toHaveCSS('cursor', 'crosshair');
            await page.keyboard.press('Escape');
            await expect(canvas).toHaveCSS('cursor', 'grab');
        } finally {
            await page.context().close();
        }
    });

    test('hovering and leaving a 3D catalog pin preserves an active drawing tool', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.isStyleLoaded());
        const position = await page.evaluate(async () => {
            const { getControl } = await import('/src/js/store/control.registry.js');
            const { default: config } = await import('/src/js/config.js');
            const viewer = getControl('modelsViewer');
            const map = globalThis.__ebgeoMap;
            const center = map.getCenter();
            // Seed the catalog consumed by the real builder. A direct source.setData was
            // overwritten by a late badge/base-layer refresh, removing this test's pin.
            config.tilesets = [{ id: 'cursor-test-pin', name: 'Cursor test',
                locate: { lon: center.lng, lat: center.lat }, url: '/cursor-test/tileset.json' }];
            await viewer.activate();
            const p = map.project(center);
            return { x: p.x, y: p.y - 35 };
        });
        await expect.poll(async () => page.evaluate((p) => globalThis.__ebgeoMap.queryRenderedFeatures(p, {
            layers: ['3d-models-markers'],
        }).length, position)).toBeGreaterThan(0);
        const canvas = page.locator('#map-sig canvas');
        await page.mouse.move(position.x, position.y);
        await expect(canvas).toHaveCSS('cursor', 'pointer');
        await page.mouse.move(position.x + 180, position.y + 120);
        await expect(canvas).toHaveCSS('cursor', 'grab');
        await page.keyboard.press('p');
        await expect(page.locator('[data-tool-id="point"]')).toHaveAttribute('data-active', 'true');
        await page.mouse.move(position.x, position.y);
        await expect(canvas).toHaveCSS('cursor', 'crosshair');
        await page.mouse.move(position.x + 180, position.y + 120);
        await expect(canvas).toHaveCSS('cursor', 'crosshair');
        await page.keyboard.press('Escape');
        await expect(canvas).toHaveCSS('cursor', 'grab');
    });

    for (const nextTool of ['point', 'brush', 'next-stroke']) {
        test(`a delayed brush save preserves the next ${nextTool} activation and its cursor`, async ({ page }) => {
            await page.goto('/');
            await page.waitForFunction(() => globalThis.__ebgeoMap?.isStyleLoaded());
            await page.evaluate(async () => {
                const { IDUtils } = await import('/src/js/utilities/index.js');
                const original = IDUtils.generateFeatureName;
                IDUtils.generateFeatureName = async function (...args) {
                    IDUtils.generateFeatureName = original;
                    await new Promise((resolve) => { globalThis.releaseBrushName = resolve; });
                    return original.apply(this, args);
                };
            });
            await page.keyboard.press('b');
            await expect(page.locator('[data-tool-id="brush"]')).toHaveAttribute('data-active', 'true');
            await page.mouse.move(550, 360);
            await page.mouse.down();
            await page.mouse.move(760, 420, { steps: 10 });
            await page.mouse.up();
            await page.waitForFunction(() => typeof globalThis.releaseBrushName === 'function');
            if (nextTool === 'next-stroke') {
                await page.mouse.move(550, 460);
                await page.mouse.down();
                await page.mouse.move(730, 490, { steps: 8 });
            } else {
                await page.keyboard.press('p');
                await expect(page.locator('[data-tool-id="point"]')).toHaveAttribute('data-active', 'true');
            }
            if (nextTool === 'brush') {
                await page.keyboard.press('b');
                await expect(page.locator('[data-tool-id="brush"]')).toHaveAttribute('data-active', 'true');
            }
            await page.evaluate(() => globalThis.releaseBrushName());
            await expect.poll(async () => page.evaluate(async () => {
                const { getCurrentMapFeatures } = await import('/src/js/store/index.js');
                return (await getCurrentMapFeatures()).brushes.length;
            })).toBe(1);
            // Wait for the real source write too: persistence precedes final UI cleanup.
            await expect.poll(async () => page.evaluate(async () =>
                (await globalThis.__ebgeoMap.getSource('brushes').getData()).features.length)).toBe(1);
            const activeTool = nextTool === 'next-stroke' ? 'brush' : nextTool;
            await expect(page.locator(`[data-tool-id="${activeTool}"]`)).toHaveAttribute('data-active', 'true');
            await expect(page.locator('#map-sig canvas')).toHaveCSS('cursor', 'crosshair');
            if (nextTool === 'next-stroke') {
                expect(await page.evaluate(async () => {
                    const { peekControl } = await import('/src/js/tool_manager/tool-registry.js');
                    return peekControl('brushControl').isDrawing;
                })).toBe(true);
                await page.mouse.up();
                await expect.poll(async () => page.evaluate(async () => {
                    const { getCurrentMapFeatures } = await import('/src/js/store/index.js');
                    return (await getCurrentMapFeatures()).brushes.length;
                })).toBe(2);
            }
            await page.keyboard.press('Escape');
            await expect(page.locator('#map-sig canvas')).toHaveCSS('cursor', 'grab');
        });
    }
});

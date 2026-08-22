// Path: e2e-ui/map-gestures.spec.js

/**
 * §15 Map gestures — local (🟢) pure-UI interactions driven by REAL pointer/wheel
 * gestures on the live MapLibre canvas (`.maplibregl-canvas`) in real Chromium, then
 * asserted against the REAL 2D map state exposed via `globalThis.__ebgeoMap`
 * (zoom/center/bearing/pitch). No backend, no login — the map boots from the Vite
 * dev server. Assertions compare before/after deltas, never absolute values.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D MapLibre map + its canvas to be ready. */
async function bootMap(page) {
    await page.goto('/');
    await expect(page.locator('#map-sig .maplibregl-canvas')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () =>
            globalThis.__ebgeoMap &&
            typeof globalThis.__ebgeoMap.getZoom === 'function' &&
            globalThis.__ebgeoMap.loaded(),
        null,
        { timeout: 20000 },
    );
    // `map.loaded()` flips true a few seconds BEFORE the boot splash (#initial-loader) detaches:
    // hideLoadingScreen() runs only after the 'load' handler's switchMap() resolves, then fades
    // over 500ms. Until it detaches the splash overlays the canvas and swallows real pointer/wheel
    // gestures (they would no-op). Wait it out before driving the canvas.
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 20000 });
}

const zoom = (page) => page.evaluate(() => globalThis.__ebgeoMap.getZoom());
const bearing = (page) => page.evaluate(() => globalThis.__ebgeoMap.getBearing());
const pitch = (page) => page.evaluate(() => globalThis.__ebgeoMap.getPitch());
const center = (page) =>
    page.evaluate(() => {
        const c = globalThis.__ebgeoMap.getCenter();
        return { lng: c.lng, lat: c.lat };
    });

/** Returns the viewport-centre point of the live map canvas. */
async function canvasCenter(page) {
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

describeOrSkip('§15 Map gestures (real browser, local pointer/wheel on canvas)', () => {
    test('§15.1 drag-pan on the canvas moves the map centre', async ({ page }) => {
        await bootMap(page);

        const c0 = await center(page);
        const { x, y } = await canvasCenter(page);

        // Real pointer drag across the canvas (press → move in steps → release).
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x - 160, y - 120, { steps: 12 });
        await page.mouse.up();

        // Drag-pan eases; poll until the centre has measurably shifted.
        await expect
            .poll(
                async () => {
                    const c = await center(page);
                    return Math.abs(c.lng - c0.lng) + Math.abs(c.lat - c0.lat);
                },
                { timeout: 6000 },
            )
            .toBeGreaterThan(0);
    });

    test('§15.2 wheel-up zooms in and wheel-down zooms back out', async ({ page }) => {
        await bootMap(page);

        const { x, y } = await canvasCenter(page);
        await page.mouse.move(x, y);

        const z0 = await zoom(page);
        // Negative deltaY = scroll up = zoom in (MapLibre scroll-zoom).
        await page.mouse.wheel(0, -600);
        await expect.poll(() => zoom(page), { timeout: 6000 }).toBeGreaterThan(z0 + 0.2);

        const z1 = await zoom(page);
        await page.mouse.wheel(0, 600);
        await expect.poll(() => zoom(page), { timeout: 6000 }).toBeLessThan(z1 - 0.2);
    });

    test('§15.3 setting a bearing rotates the map (and is reset to north)', async ({ page }) => {
        await bootMap(page);

        const b0 = await bearing(page);
        await page.evaluate(() => globalThis.__ebgeoMap.setBearing(60));
        await expect
            .poll(async () => Math.abs((await bearing(page)) - b0), { timeout: 6000 })
            .toBeGreaterThan(50);

        await page.evaluate(() => globalThis.__ebgeoMap.setBearing(0));
        await expect.poll(async () => Math.abs(await bearing(page)), { timeout: 6000 }).toBeLessThan(1);
    });

    test('§15.4 setting a pitch tilts the map and resets flat', async ({ page }) => {
        await bootMap(page);

        const p0 = await pitch(page);
        await page.evaluate(() => globalThis.__ebgeoMap.setPitch(40));
        await expect
            .poll(async () => (await pitch(page)) - p0, { timeout: 6000 })
            .toBeGreaterThan(30);

        await page.evaluate(() => globalThis.__ebgeoMap.setPitch(0));
        await expect.poll(() => pitch(page), { timeout: 6000 }).toBeLessThan(1);
    });
});

// Path: e2e-ui/bottom-controls.spec.js

/**
 * §11 Controles Inferiores — local (🟢) navigation controls driven by REAL clicks in
 * real Chromium. These are pure-UI actions (no backend), asserted against the REAL 2D
 * MapLibre map state exposed via `globalThis.__ebgeoMap`. The app boots from the Vite
 * dev server; no login needed (the bottom controls render on boot).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + bottom controls to be ready. */
async function bootMap(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

const zoom = (page) => page.evaluate(() => globalThis.__ebgeoMap.getZoom());
const bearing = (page) => page.evaluate(() => Math.abs(globalThis.__ebgeoMap.getBearing()));

describeOrSkip('§11 Bottom controls (real browser, local map navigation)', () => {
    test('zoom-in (+) raises and zoom-out (−) lowers the map zoom', async ({ page }) => {
        await bootMap(page);

        const z0 = await zoom(page);
        await page.locator('#nav-btn-zoom-in').click();
        await expect.poll(() => zoom(page), { timeout: 6000 }).toBeGreaterThan(z0 + 0.5);

        const z1 = await zoom(page);
        await page.locator('#nav-btn-zoom-out').click();
        await expect.poll(() => zoom(page), { timeout: 6000 }).toBeLessThan(z1 - 0.5);
    });

    test('reset-north (compass) returns the map bearing to 0', async ({ page }) => {
        await bootMap(page);

        await page.evaluate(() => globalThis.__ebgeoMap.setBearing(45));
        expect(await bearing(page)).toBeGreaterThan(40);

        await page.locator('#nav-btn-compass').click();
        await expect.poll(() => bearing(page), { timeout: 6000 }).toBeLessThan(1);
    });

    test('the navigation + feature-toggle buttons are all rendered and clickable', async ({ page }) => {
        await bootMap(page);
        // §11.1-5 nav buttons present (zoom in/out, fullscreen, reset north).
        for (const id of ['nav-btn-zoom-in', 'nav-btn-zoom-out', 'nav-btn-fullscreen', 'nav-btn-compass']) {
            await expect(page.locator(`#${id}`)).toBeVisible();
        }
        // §11.6-8 feature toggles (3D / 360 / terrain) render with a toggleable state attr.
        const toggles = page.locator('[id^="feature-toggle-"]');
        expect(await toggles.count()).toBeGreaterThan(0);
        await expect(toggles.first()).toHaveAttribute('data-active', /true|false/);
    });
});

// Path: e2e-ui/search-bar.spec.js

/**
 * §12.1,6 Search bar — local (🟢) coordinate search driven by REAL keystrokes in real
 * Chromium. Pure-UI: typing a lat/lng pair is parsed locally (no geocoding network
 * call) and selecting the offered result flies the REAL 2D MapLibre map toward that
 * coordinate. State is asserted against `globalThis.__ebgeoMap`. The app boots from the
 * Vite dev server; no login needed (the search bar renders on boot).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + search bar input to be ready. */
async function bootMap(page) {
    await page.goto('/');
    await expect(page.locator('.search-bar-input')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getCenter === 'function',
        null,
        { timeout: 20000 },
    );
}

const center = (page) =>
    page.evaluate(() => {
        const c = globalThis.__ebgeoMap.getCenter();
        return { lng: c.lng, lat: c.lat };
    });

describeOrSkip('§12 Search bar (real browser, local coordinate search)', () => {
    test('typing a lat/lng pair parses it and flies the map toward that coordinate', async ({ page }) => {
        await bootMap(page);

        // Move the map well away from the target so the fly-to is unambiguous.
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [0, 0], zoom: 3 }));
        const before = await center(page);
        expect(Math.hypot(before.lng - -43.2, before.lat - -22.9)).toBeGreaterThan(10);

        // §12.1 type a coordinate into the real input (debounced local parse, no network).
        const input = page.locator('.search-bar-input');
        await input.click();
        await input.fill('-22.9, -43.2');

        // §12.6 a parsed coordinate result is offered in the dropdown.
        const coordResult = page.locator('.search-result-item[data-type="coordinate"]').first();
        await expect(coordResult).toBeVisible({ timeout: 8000 });

        // Selecting it flies the map toward [lng=-43.2, lat=-22.9] (Rio de Janeiro).
        await coordResult.click();
        await expect
            .poll(async () => {
                const c = await center(page);
                return Math.hypot(c.lng - -43.2, c.lat - -22.9);
            }, { timeout: 8000 })
            .toBeLessThan(1);
    });

    test('clearing the search hides the results dropdown', async ({ page }) => {
        await bootMap(page);

        const input = page.locator('.search-bar-input');
        await input.click();
        await input.fill('-22.9, -43.2');

        const results = page.locator('.search-bar-results');
        await expect(results).toBeVisible({ timeout: 8000 });

        // Escape clears the input and hides the dropdown (local _clearSearch).
        await input.press('Escape');
        await expect(input).toHaveValue('');
        await expect(results).toBeHidden({ timeout: 4000 });
    });
});

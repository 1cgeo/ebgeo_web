// Path: e2e-ui/coordinate-display.spec.js

/**
 * §25 Coordinate Display — local (🟢) pure-UI interactions driven by REAL clicks in
 * real Chromium. The bottom-center coordinate readout (mouse-coordinates.control.js)
 * renders on boot with NO backend. We drive the gear → format-selector → format
 * options and assert the REAL observable effects: the selector becoming visible, the
 * active-format class flipping, and the displayed coordinate text format changing
 * (Lat/Long DD vs DMS vs UTM vs MGRS look). The zoom readout ("Z<n>") is asserted
 * against the real value too. The app boots from the Vite dev server; no login needed.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the coordinate readout + 2D map to be ready. */
async function bootCoords(page) {
    await page.goto('/');
    await expect(page.locator('.coordinates-control')).toBeAttached({ timeout: 20000 });
    await expect(page.locator('.coordinates-gear-button')).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
    // The control renders an initial readout for (0,0) on add; wait for it to populate.
    await expect.poll(
        () => page.locator('.coordinates-text').innerText(),
        { timeout: 6000 },
    ).not.toBe('');
}

describeOrSkip('§25 Coordinate display (real browser, local UI)', () => {
    test('§25.1-2 gear opens the format selector', async ({ page }) => {
        await bootCoords(page);

        const selector = page.locator('.coordinates-format-selector');
        // Selector starts hidden (display: '' / 'none').
        await expect(selector).toBeHidden();

        await page.locator('.coordinates-gear-button').click();
        await expect(selector).toBeVisible({ timeout: 3000 });

        // Real options are rendered (latlong, DMS, UTM, MGRS).
        const options = page.locator('.coordinates-format-option');
        expect(await options.count()).toBeGreaterThan(1);
    });

    test('§25.3 picking a different format flips the active option and changes the text format', async ({ page }) => {
        await bootCoords(page);

        const textBefore = await page.locator('.coordinates-text').innerText();

        // Default format is latlong; it should be the active option to start.
        await page.locator('.coordinates-gear-button').click();
        const selector = page.locator('.coordinates-format-selector');
        await expect(selector).toBeVisible({ timeout: 3000 });
        await expect(page.locator('.coordinates-format-option[data-format="latlong"]')).toHaveClass(/active/);

        // Switch to MGRS — a clearly distinct textual representation.
        const mgrs = page.locator('.coordinates-format-option[data-format="mgrs"]');
        await mgrs.click();

        // Selector closes after a pick.
        await expect(selector).toBeHidden({ timeout: 3000 });

        // Active class moved to MGRS (re-open to inspect).
        await page.locator('.coordinates-gear-button').click();
        await expect(mgrs).toHaveClass(/active/, { timeout: 3000 });
        await expect(page.locator('.coordinates-format-option[data-format="latlong"]')).not.toHaveClass(/active/);
        await page.locator('.coordinates-gear-button').click(); // close again

        // The rendered coordinate text changed shape (DD → MGRS look).
        await expect.poll(
            () => page.locator('.coordinates-text').innerText(),
            { timeout: 6000 },
        ).not.toBe(textBefore);
    });

    test('§25.4 the zoom readout shows a "Z<number>" value reflecting the real map zoom', async ({ page }) => {
        await bootCoords(page);

        const zoomReadout = page.locator('.coordinates-zoom');
        await expect(zoomReadout).toHaveText(/^Z\d+(\.\d+)?$/, { timeout: 6000 });

        // Change the real map zoom (zoom OUT from the initial — always allowed), then
        // assert the readout converges to the REAL resulting zoom. The control refreshes
        // on mousemove, so jiggle the cursor over the canvas each poll iteration.
        const z0 = await page.evaluate(() => globalThis.__ebgeoMap.getZoom());
        await page.evaluate((z) => globalThis.__ebgeoMap.setZoom(z), z0 - 2);
        const realZoom = await page.evaluate(() => globalThis.__ebgeoMap.getZoom());
        expect(Math.abs(realZoom - z0)).toBeGreaterThan(0.5); // the zoom actually changed

        const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
        let jig = 0;
        await expect.poll(
            async () => {
                jig = (jig + 7) % 40;
                await page.mouse.move(box.x + box.width / 2 + jig, box.y + box.height / 2 + jig);
                const txt = await zoomReadout.innerText();
                const m = txt.match(/^Z([\d.]+)$/);
                return m ? Number(m[1]) : NaN;
            },
            { timeout: 8000 },
        ).toBeCloseTo(realZoom, 0);
    });
});

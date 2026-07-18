// Path: e2e-ui/base-layer-selector.spec.js

/**
 * §13.1-2 Base layer selector — local (🟢) panel open/close + basemap selection driven
 * by REAL clicks in real Chromium. Pure-UI actions (no backend needed for the panel
 * UI): the selector renders on boot, expands on click, and flips the selected option's
 * dataset + the collapsed-view label synchronously. Asserts REAL observable DOM state.
 * The app boots from the Vite dev server; no login required.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + base-layer selector to be ready. */
async function bootSelector(page) {
    await page.goto('/');
    await expect(page.locator('#base-layer-selector')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

describeOrSkip('§13 Base layer selector (real browser, local panel + selection)', () => {
    test('§13.1 clicking the collapsed thumbnail expands the basemap list', async ({ page }) => {
        await bootSelector(page);

        const selector = page.locator('#base-layer-selector');
        const expandedView = page.locator('#base-layer-selector .base-layer-expanded');

        // Starts collapsed.
        await expect(selector).toHaveAttribute('data-expanded', 'false');

        // Click the collapsed thumbnail to open the panel.
        await page.locator('#base-layer-selector .base-layer-collapsed').click();

        // Panel becomes expanded and the option grid is visible.
        await expect(selector).toHaveAttribute('data-expanded', 'true');
        await expect(expandedView).toBeVisible();
        const options = page.locator('#base-layer-selector .base-layer-option');
        expect(await options.count()).toBeGreaterThan(0);
    });

    test('§13.1 pressing Escape collapses the open panel', async ({ page }) => {
        await bootSelector(page);

        const selector = page.locator('#base-layer-selector');
        await page.locator('#base-layer-selector .base-layer-collapsed').click();
        await expect(selector).toHaveAttribute('data-expanded', 'true');

        await page.keyboard.press('Escape');
        await expect(selector).toHaveAttribute('data-expanded', 'false');
    });

    test('§13.2 selecting a different basemap reflects in the active selection + label', async ({ page }) => {
        await bootSelector(page);

        // Open the panel.
        await page.locator('#base-layer-selector .base-layer-collapsed').click();
        await expect(page.locator('#base-layer-selector')).toHaveAttribute('data-expanded', 'true');

        // Find the option NOT currently selected (the next basemap).
        const target = page.locator(
            '#base-layer-selector .base-layer-option[data-selected="false"]',
        ).first();
        await expect(target).toBeVisible();

        const targetId = await target.getAttribute('data-layer-id');
        const labelBefore = await page.locator('#base-layer-current-label').textContent();

        // Select it.
        await target.click();

        // The chosen option becomes the selected one, and exactly that one is selected.
        const chosen = page.locator(
            `#base-layer-selector .base-layer-option[data-layer-id="${targetId}"]`,
        );
        await expect(chosen).toHaveAttribute('data-selected', 'true');
        await expect(chosen).toHaveAttribute('aria-selected', 'true');

        // Selecting collapses the panel and updates the collapsed-view label.
        await expect(page.locator('#base-layer-selector')).toHaveAttribute('data-expanded', 'false');
        await expect
            .poll(() => page.locator('#base-layer-current-label').textContent())
            .not.toBe(labelBefore);
    });
});

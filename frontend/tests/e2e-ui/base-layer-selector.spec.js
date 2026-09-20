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
    test('the key left of 1 cycles basemaps, wraps and respects text focus', async ({ page }, testInfo) => {
        await bootSelector(page);
        const { layers, initial } = await page.evaluate(async () => {
            const { getControl } = await import('/src/js/store/control.registry.js');
            const control = getControl('BaseLayerControl');
            return { layers: control.availableBasemaps, initial: control.currentLayer };
        });
        expect(layers.length).toBeGreaterThan(1);

        // Real key events traverse the document listener, debounce and MapLibre switch. The STORE is
        // deliberately NOT part of the chain since 2026-09-20: the base layer on screen is view
        // state of the person, so cycling it draws and writes nothing. The saved base of the map
        // is read once here and asserted unchanged after every press.
        const savedBase = await page.evaluate(async () => {
            const { getCurrentBaseLayer } = await import('/src/js/store/index.js');
            return getCurrentBaseLayer();
        });
        let current = initial;
        for (let i = 0; i < layers.length; i++) {
            current = layers[(layers.indexOf(current) + 1) % layers.length];
            await page.keyboard.press('Backquote');
            await expect.poll(() => page.evaluate(async () => {
                const { getControl } = await import('/src/js/store/control.registry.js');
                const control = getControl('BaseLayerControl');
                return !control.isChanging ? control.currentLayer : null;
            })).toBe(current);
            expect(await page.evaluate(async () => {
                const { getCurrentBaseLayer } = await import('/src/js/store/index.js');
                return getCurrentBaseLayer();
            }), 'cycling the base layer must not rewrite the base saved with the map').toBe(savedBase);
            await expect(page.locator(`.base-layer-option[data-layer-id="${current}"]`))
                .toHaveAttribute('data-selected', 'true');
        }
        expect(current).toBe(initial);

        // Typing into a focused field must remain text input, including on an ABNT2 keyboard.
        await page.evaluate(() => {
            const input = document.createElement('input');
            input.id = 'shortcut-focus-probe';
            document.body.append(input);
            input.focus();
        });
        await page.keyboard.press('Backquote');
        await expect(page.locator('#shortcut-focus-probe')).toHaveValue('`');
        await page.evaluate(() => document.getElementById('shortcut-focus-probe').remove());
        await page.keyboard.press('Control+Backquote');
        await page.keyboard.press('Shift+Backquote');
        // Drain the selector's debounce before checking that no forbidden switch started.
        await page.waitForTimeout(150);
        await expect(page.locator(`.base-layer-option[data-layer-id="${initial}"]`))
            .toHaveAttribute('data-selected', 'true');
        await page.screenshot({ path: testInfo.outputPath('basemap-shortcut.png') });
    });

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

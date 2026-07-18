// Path: e2e-ui/export-config.spec.js

/**
 * §6.1,3-8 Export config — local (🟢) pure-UI PDF-export configuration driven by REAL
 * clicks in real Chromium. Opening the sidebar "Exportar" tab and expanding the PDF
 * option renders the cartographic-element checkboxes (título/legenda/barra de escala/
 * seta norte + grade Lat-Long/UTM) and the scale/orientation/DPI selectors. These are
 * all LOCAL config toggles — we assert the REAL observable control state (checkbox
 * checked flag, selected <option> value, radio selection) and the export-area preview
 * source being added to / removed from the live 2D map (`globalThis.__ebgeoMap`). No
 * PDF is ever generated. The app boots from the Vite dev server; no login needed.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + sidebar nav to be ready. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('.sidebar-nav-btn[data-tab="exportar"]')).toBeAttached({
        timeout: 20000,
    });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/** Whether the PDF export-area preview source is present on the live map. */
const hasPreview = (page) =>
    page.evaluate(() => !!globalThis.__ebgeoMap.getSource('pdf-export-preview'));

/**
 * Opens the "Exportar" sidebar tab and expands the PDF export option, returning a
 * locator scoped to the rendered PDF-config panel (where the toggles/selectors live).
 */
async function openPdfConfig(page) {
    await page.locator('.sidebar-nav-btn[data-tab="exportar"]').click();

    const pdfOption = page.locator('#export-option-pdf');
    await expect(pdfOption).toBeVisible({ timeout: 10000 });

    const pdfContent = page.locator('.export-pdf-content');
    await expect(pdfContent).toHaveAttribute('data-visible', 'false');

    await pdfOption.click();
    await expect(pdfContent).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    // The cartographic config UI rendered into the panel.
    await expect(pdfContent.locator('#pdf-show-title')).toBeVisible({ timeout: 5000 });
    return pdfContent;
}

describeOrSkip('§6 Export config (real browser, local PDF-config toggles)', () => {
    test('§6.3 cartographic-element checkboxes flip their checked state', async ({ page }) => {
        await bootApp(page);
        const panel = await openPdfConfig(page);

        // Título / legenda / barra de escala / seta norte each start unchecked and
        // flip to checked on a real click (independent local config toggles).
        for (const id of [
            'pdf-show-title',
            'pdf-show-legend',
            'pdf-show-scalebar',
            'pdf-show-north',
        ]) {
            const box = panel.locator(`#${id}`);
            await expect(box).not.toBeChecked();
            await box.check();
            await expect(box).toBeChecked();
            await box.uncheck();
            await expect(box).not.toBeChecked();
        }
    });

    test('§6.4 grade Lat-Long and UTM checkboxes flip their checked state', async ({ page }) => {
        await bootApp(page);
        const panel = await openPdfConfig(page);

        const latlong = panel.locator('#pdf-show-latlong-grid');
        await expect(latlong).not.toBeChecked();
        await latlong.check();
        await expect(latlong).toBeChecked();

        // UTM is enabled at the default 1:25.000 scale; flip it on then off.
        const utm = panel.locator('#pdf-show-utm-grid');
        await expect(utm).toBeEnabled();
        await expect(utm).not.toBeChecked();
        await utm.check();
        await expect(utm).toBeChecked();
        await utm.uncheck();
        await expect(utm).not.toBeChecked();
    });

    test('§6.5 changing the scale selector updates the selected value', async ({ page }) => {
        await bootApp(page);
        const panel = await openPdfConfig(page);

        const scale = panel.locator('#pdf-scale-select');
        await expect(scale).toHaveValue('1:25000'); // constructor default

        await scale.selectOption('1:50000');
        await expect(scale).toHaveValue('1:50000');

        await scale.selectOption('1:100000');
        await expect(scale).toHaveValue('1:100000');
    });

    test('§6.6 orientation radios switch between paisagem and retrato', async ({ page }) => {
        await bootApp(page);
        const panel = await openPdfConfig(page);

        const landscape = panel.locator('input[name="pdf-orientation"][value="landscape"]');
        const portrait = panel.locator('input[name="pdf-orientation"][value="portrait"]');

        // Landscape is checked on render; selecting retrato moves the selection.
        await expect(landscape).toBeChecked();
        await portrait.check();
        await expect(portrait).toBeChecked();
        await expect(landscape).not.toBeChecked();

        await landscape.check();
        await expect(landscape).toBeChecked();
        await expect(portrait).not.toBeChecked();
    });

    test('§6.7 DPI selector switches between 150/200/300', async ({ page }) => {
        await bootApp(page);
        const panel = await openPdfConfig(page);

        const dpi = panel.locator('#pdf-dpi-select');
        await expect(dpi).toHaveValue('300'); // default quality

        await dpi.selectOption('150');
        await expect(dpi).toHaveValue('150');

        await dpi.selectOption('200');
        await expect(dpi).toHaveValue('200');

        await dpi.selectOption('300');
        await expect(dpi).toHaveValue('300');
    });

    test('§6.8 expanding/collapsing the PDF option toggles the export-area preview on the map', async ({ page }) => {
        await bootApp(page);

        // No preview before the PDF panel is opened.
        expect(await hasPreview(page)).toBe(false);

        // Expanding the PDF option adds the export-area preview source to the live map.
        await openPdfConfig(page);
        await expect.poll(() => hasPreview(page), { timeout: 5000 }).toBe(true);

        // Collapsing it (second click on the option) removes the preview source.
        await page.locator('#export-option-pdf').click();
        await expect(page.locator('.export-pdf-content')).toHaveAttribute('data-visible', 'false', {
            timeout: 5000,
        });
        await expect.poll(() => hasPreview(page), { timeout: 5000 }).toBe(false);
    });
});

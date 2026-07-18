// Path: e2e-ui/processing-tab-local.spec.js

/**
 * §4.1-2,4-5 Processing ("Processamento") sidebar tab — local (🟢) pure-UI interactions
 * driven by REAL clicks in real Chromium. Opening the sidebar Processamento tab renders
 * one card per registered geoprocessing algorithm (.processing-card[data-algorithm-id]).
 * Clicking a card opens its configuration panel in the feature panel; the mounted panel
 * is tagged with the chosen algorithm ([data-testid="processing-panel"][data-algorithm-id]),
 * the panel header shows the algorithm name, and each algorithm renders its own parameter
 * controls:
 *   - Buffer (Zona de Influência)      → a numeric "Distância" input (.attr-modern-numeric-input)
 *   - Voronoi (Zonas de Proximidade)   → a "Desenhar Retângulo" draw button + "Apenas pontos" toggle
 *   - Convex Hull (Contorno Externo)   → no extra parameter control (base scaffold only)
 *
 * Every assertion is a REAL observable effect:
 *   §4.1 the tab activates and renders the algorithm cards;
 *   §4.2/4.4 selecting each algorithm mounts THAT algorithm's panel (data-algorithm-id +
 *            header title) with its distinguishing parameter control present/absent;
 *   §4.5 typing a parameter value (buffer distance) is reflected on the input;
 *        editing the output-layer-name input is reflected on the input.
 *
 * This is all LOCAL UI — no algorithm is executed (execution is 🟡). The app boots from
 * the Vite dev server; no login is needed (these are local, anonymous-path controls).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + sidebar nav to be ready. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('.sidebar-nav-btn[data-tab="processamento"]')).toBeAttached({
        timeout: 20000,
    });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/**
 * Opens the Processamento sidebar tab and waits for the algorithm cards to render.
 * @param {import('@playwright/test').Page} page
 */
async function openProcessingTab(page) {
    await page.locator('.sidebar-nav-btn[data-tab="processamento"]').click();

    const list = page.locator('.processing-algorithm-list');
    await expect(list).toBeVisible({ timeout: 10000 });
    // At least the three core algorithms register as cards.
    await expect(list.locator('.processing-card')).toHaveCount(3, { timeout: 10000 });
}

/**
 * Selects an algorithm by clicking its card and waits for its configuration panel to
 * mount. Returns the panel locator scoped by the algorithm id, so assertions can target
 * the panel that THIS choice produced.
 * @param {import('@playwright/test').Page} page
 * @param {string} algorithmId - e.g. 'buffer' | 'voronoi' | 'convex-hull'
 */
async function selectAlgorithm(page, algorithmId) {
    const card = page.locator(`.processing-card[data-algorithm-id="${algorithmId}"]`);
    await expect(card).toBeVisible({ timeout: 5000 });
    // Dispatch the real click listener directly: the sidebar collapses/animates as the
    // feature panel opens, which can make a positional click flaky.
    await card.evaluate((el) => el.click());

    // The chosen algorithm's panel mounts, tagged with its id.
    const panel = page.locator(
        `.processing-panel[data-testid="processing-panel"][data-algorithm-id="${algorithmId}"]`,
    );
    await expect(panel).toBeVisible({ timeout: 8000 });
    return panel;
}

describeOrSkip('§4 Processing tab (real browser, local algorithm-selection UI)', () => {
    test('§4.1 opening the tab renders one card per registered algorithm', async ({ page }) => {
        await bootApp(page);
        await openProcessingTab(page);

        // Each core algorithm has its own selectable card with the right name.
        await expect(
            page.locator('.processing-card[data-algorithm-id="buffer"] .processing-card__name'),
        ).toHaveText('Zona de Influência');
        await expect(
            page.locator('.processing-card[data-algorithm-id="voronoi"] .processing-card__name'),
        ).toHaveText('Zonas de Proximidade');
        await expect(
            page.locator('.processing-card[data-algorithm-id="convex-hull"] .processing-card__name'),
        ).toHaveText('Contorno Externo');
    });

    test('§4.2/4.4 selecting Buffer mounts its panel with the distance parameter control', async ({ page }) => {
        await bootApp(page);
        await openProcessingTab(page);

        const panel = await selectAlgorithm(page, 'buffer');

        // The header reflects the chosen algorithm's name.
        await expect(page.locator('.feature-panel .sidebar-panel-title')).toContainText(
            'Zona de Influência',
        );

        // Buffer's distinguishing parameter: a numeric distance input pre-filled to its default.
        const distance = panel.locator('.attr-modern-numeric-input');
        await expect(distance).toBeVisible();
        await expect(distance).toHaveValue('500');
        // Buffer has no Voronoi-specific draw button.
        await expect(panel.locator('.processing-panel__draw-btn')).toHaveCount(0);
    });

    test('§4.4 selecting Voronoi mounts its panel with the draw-rectangle + points-only controls', async ({ page }) => {
        await bootApp(page);
        await openProcessingTab(page);

        const panel = await selectAlgorithm(page, 'voronoi');

        await expect(page.locator('.feature-panel .sidebar-panel-title')).toContainText(
            'Zonas de Proximidade',
        );

        // Voronoi's distinguishing controls: a "Desenhar Retângulo" draw button and an
        // unset clipping-area display.
        await expect(panel.locator('.processing-panel__draw-btn')).toBeVisible();
        await expect(panel.locator('.processing-panel__bbox-display')).toHaveText('Área não definida');
        // It does NOT have Buffer's numeric distance input.
        await expect(panel.locator('.attr-modern-numeric-input')).toHaveCount(0);
    });

    test('§4.4 selecting Convex Hull mounts its panel with no extra parameter control', async ({ page }) => {
        await bootApp(page);
        await openProcessingTab(page);

        const panel = await selectAlgorithm(page, 'convex-hull');

        await expect(page.locator('.feature-panel .sidebar-panel-title')).toContainText(
            'Contorno Externo',
        );

        // Convex hull uses only the base scaffold: no numeric distance, no draw button.
        await expect(panel.locator('.attr-modern-numeric-input')).toHaveCount(0);
        await expect(panel.locator('.processing-panel__draw-btn')).toHaveCount(0);
        // The base output-name input is still present (shared scaffold).
        await expect(panel.locator('.processing-panel__output-name')).toBeVisible();
    });

    test('§4.5 setting the Buffer distance parameter is reflected on the input', async ({ page }) => {
        await bootApp(page);
        await openProcessingTab(page);

        const panel = await selectAlgorithm(page, 'buffer');
        const distance = panel.locator('.attr-modern-numeric-input');
        await expect(distance).toHaveValue('500');

        // Type a new distance and commit it (blur runs the normalize/onChange handler).
        await distance.fill('1200');
        await distance.blur();
        await expect(distance).toHaveValue('1200', { timeout: 5000 });
    });

    test('§4.5 editing the output-layer-name input is reflected on the input', async ({ page }) => {
        await bootApp(page);
        await openProcessingTab(page);

        const panel = await selectAlgorithm(page, 'buffer');
        const outputName = panel.locator('.processing-panel__output-name');

        // The scaffold pre-fills a default name derived from the source layer.
        await expect(outputName).toBeVisible();
        const defaultName = await outputName.inputValue();
        expect(defaultName.length).toBeGreaterThan(0);

        // Replace it with a custom name — the input reflects the typed value.
        await outputName.fill('Minha Zona de Influência');
        await expect(outputName).toHaveValue('Minha Zona de Influência', { timeout: 5000 });
    });
});

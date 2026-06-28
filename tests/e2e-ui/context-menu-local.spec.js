// Path: e2e-ui/context-menu-local.spec.js

/**
 * §14.1,2,8,13 Map context menu — local (🟢) pure-UI interactions driven by a REAL
 * right-click on the live MapLibre canvas (`.maplibregl-canvas`) in real Chromium.
 * No backend, no login: the context menu (context-menu.control.js) is appended to
 * <body> on boot and opened via the native `contextmenu` event. We assert REAL
 * observable effects:
 *   - the `.context-menu` becomes visible with its default items;
 *   - "Copiar Coordenadas" copies a non-empty coordinate string to the clipboard and
 *     shows the success toast ("Coordenadas copiadas!");
 *   - "Orientar para Norte" resets the REAL map bearing (read via __ebgeoMap.getBearing())
 *     back to 0 after we rotate the map first.
 * The app boots from the Vite dev server.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

// Clipboard read/write needed to verify "Copiar Coordenadas".
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** Boots the app and waits for the 2D MapLibre map + its canvas to be ready. */
async function bootMap(page) {
    await page.goto('/');
    await expect(page.locator('.maplibregl-canvas')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () =>
            globalThis.__ebgeoMap &&
            typeof globalThis.__ebgeoMap.getBearing === 'function' &&
            globalThis.__ebgeoMap.loaded(),
        null,
        { timeout: 20000 },
    );
    // `map.loaded()` flips true a few seconds BEFORE the boot splash (#initial-loader) detaches:
    // hideLoadingScreen() runs only after the 'load' handler's switchMap() resolves, then fades
    // over 500ms. Until it detaches the splash overlays the canvas and swallows the real
    // right-click (the contextmenu lands on the splash, not the map). Wait it out first.
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 20000 });
}

const bearing = (page) => page.evaluate(() => Math.abs(globalThis.__ebgeoMap.getBearing()));

/** Returns the viewport-centre point of the live map canvas. */
async function canvasCenter(page) {
    const box = await page.locator('.maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Right-clicks the canvas centre and waits for the context menu to be visible. */
async function openContextMenu(page) {
    const { x, y } = await canvasCenter(page);
    // Right-click the canvas CENTRE via raw mouse coords. Clicking a canvas corner
    // (e.g. position {5,5}) can land under an overlapping control, and locator.click's
    // actionability check then hangs; page.mouse.click bypasses that and fires a real
    // contextmenu event at a clear point.
    await page.mouse.move(x, y);
    await page.mouse.click(x, y, { button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    return menu;
}

describeOrSkip('§14 Map context menu (real browser, local pure-UI)', () => {
    test('§14.1 right-click opens the context menu with its default items', async ({ page }) => {
        await bootMap(page);

        const menu = await openContextMenu(page);

        // The default options always present (no selection): Copiar Coordenadas + a
        // north-orientation item (enabled or disabled depending on bearing/pitch).
        await expect(menu.locator('.context-menu-item', { hasText: 'Copiar Coordenadas' })).toBeVisible();
        await expect(menu.locator('.context-menu-item', { hasText: 'Orientar para Norte' })).toBeVisible();
    });

    test('§14.2 "Copiar Coordenadas" copies a coordinate string and shows the success toast', async ({ page }) => {
        await bootMap(page);

        const menu = await openContextMenu(page);

        await menu.locator('.context-menu-item', { hasText: 'Copiar Coordenadas' }).click();

        // The menu closes after the action.
        await expect(menu).toBeHidden({ timeout: 5000 });

        // Real observable effect 1: a success toast with the expected message.
        await expect(page.locator('.toast--success', { hasText: 'Coordenadas copiadas!' }))
            .toBeVisible({ timeout: 5000 });

        // Real observable effect 2: the clipboard now holds a non-empty coordinate string.
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        expect(clip.trim().length).toBeGreaterThan(0);
    });

    test('§14.8,13 "Orientar para Norte" resets the real map bearing to 0', async ({ page }) => {
        await bootMap(page);

        // Rotate the map first so the item is enabled (it is disabled when already north).
        await page.evaluate(() => globalThis.__ebgeoMap.setBearing(60));
        await expect.poll(() => bearing(page), { timeout: 6000 }).toBeGreaterThan(50);

        const menu = await openContextMenu(page);
        const northItem = menu.locator('.context-menu-item', { hasText: 'Orientar para Norte' });
        await expect(northItem).toBeVisible();
        await expect(northItem).not.toHaveClass(/disabled/);

        await northItem.click();
        await expect(menu).toBeHidden({ timeout: 5000 });

        // easeTo animates; poll until the real bearing converges back to north.
        await expect.poll(() => bearing(page), { timeout: 6000 }).toBeLessThan(1);
    });
});

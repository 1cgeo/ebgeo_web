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
 *     back to 0 after we rotate the map first;
 *   - "Copiar Feição" copies the feature UNDER THE CURSOR without selecting it (the feature
 *     panel must stay collapsed), and "Colar Aqui" lands the copy near the clicked point,
 *     which is the whole promise of the command and the only place it can be measured.
 *
 * The paste cases run LOCAL and anonymous on purpose: `checkPermission` is permissive on a
 * local store, so what they measure is the GEOMETRY of the anchoring. Whether a Leitor is
 * offered the command at all, and what a locked map does to the click, needs two real
 * browsers and a real backend and lives in `colar-aqui-por-papel-e-por-estado.spec.js`.
 *
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
    await expect(page.locator('#map-sig .maplibregl-canvas')).toBeAttached({ timeout: 20000 });
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
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The expanded sidebar feature panel (present + data-expanded="true" iff something is selected). */
const selectedPanel = (page) => page.locator('.feature-panel[data-expanded="true"]');

/**
 * Seeds one point through the real draw flow at a given fraction of the canvas. The point
 * tool persists the feature, deactivates itself and AUTO-SELECTS what it drew, so the caller
 * usually wants to clear the selection afterwards.
 * @returns {Promise<{x: number, y: number}>} The viewport point it was drawn at.
 */
async function seedPointAt(page, fx, fy) {
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();

    await page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn').click();
    await expect(
        page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup'),
    ).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    const btn = page.locator('.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="point"]');
    await btn.click();
    await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 5000 });

    const at = { x: box.x + box.width * fx, y: box.y + box.height * fy };
    await page.mouse.click(at.x, at.y);
    await expect(selectedPanel(page)).toBeVisible({ timeout: 10000 });

    return at;
}

/** Every point feature currently in the store, as `[lng, lat]` pairs. */
function readPointCoords(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const features = await store.getCurrentMapFeatures();
        return (features?.points || []).map((f) => f.geometry.coordinates);
    });
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

    test('§14.14 "Copiar Feição" copies the feature under the cursor WITHOUT selecting it', async ({ page }) => {
        await bootMap(page);
        const drawnAt = await seedPointAt(page, 0.5, 0.4);

        // Clear the auto-selection: the "under the cursor" branch only exists when nothing is
        // selected, and this is also what makes the no-selection assertion below meaningful.
        await page.keyboard.press('Escape');
        await expect(selectedPanel(page)).toHaveCount(0, { timeout: 5000 });

        // Right-click ON the point.
        await page.mouse.move(drawnAt.x, drawnAt.y);
        await page.mouse.click(drawnAt.x, drawnAt.y, { button: 'right' });
        const menu = page.locator('.context-menu');
        await expect(menu).toBeVisible({ timeout: 5000 });

        const copyItem = menu.locator('.context-menu-item', { hasText: /^Copiar Feição$/ });
        await expect(copyItem).toBeVisible();
        // With nothing selected the plural command must NOT be offered: the two are exclusive.
        await expect(menu.locator('.context-menu-item', { hasText: 'Copiar Feições' })).toHaveCount(0);

        await copyItem.click();
        await expect(menu).toBeHidden({ timeout: 5000 });
        await expect(page.locator('.toast--success', { hasText: /copiada/i })).toBeVisible({ timeout: 6000 });

        // THE POINT OF THE CASE: copying did not select. Selecting would open the attributes
        // panel behind the menu and throw away whatever the person had chosen before.
        await expect(selectedPanel(page)).toHaveCount(0);
    });

    test('§14.15 "Colar Aqui" lands the copy at the CLICKED point, not beside the original', async ({ page }) => {
        await bootMap(page);
        const drawnAt = await seedPointAt(page, 0.45, 0.3);
        await page.keyboard.press('Escape');
        await expect(selectedPanel(page)).toHaveCount(0, { timeout: 5000 });

        // Copy the point under the cursor.
        await page.mouse.move(drawnAt.x, drawnAt.y);
        await page.mouse.click(drawnAt.x, drawnAt.y, { button: 'right' });
        const menu = page.locator('.context-menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        await menu.locator('.context-menu-item', { hasText: /^Copiar Feição$/ }).click();
        await expect(page.locator('.toast--success', { hasText: /copiada/i })).toBeVisible({ timeout: 6000 });

        // Right-click FAR from the original and paste there.
        const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
        const target = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.75 };
        const expected = await page.evaluate(
            ({ x, y }) => {
                const rect = globalThis.__ebgeoMap.getCanvasContainer().getBoundingClientRect();
                const c = globalThis.__ebgeoMap.unproject([x - rect.left, y - rect.top]);
                return [c.lng, c.lat];
            },
            target,
        );

        await page.mouse.move(target.x, target.y);
        await page.mouse.click(target.x, target.y, { button: 'right' });
        await expect(menu).toBeVisible({ timeout: 5000 });

        const pasteItem = menu.locator('.context-menu-item', { hasText: /^Colar Aqui \(1\)$/ });
        await expect(pasteItem).toBeVisible();
        await pasteItem.click();
        await expect(page.locator('.toast--success', { hasText: /colada/i })).toBeVisible({ timeout: 6000 });

        // TWO points now, and the NEW one sits on the clicked position. The tolerance is in
        // DEGREES and generous on purpose: what is being measured is "it landed where I
        // clicked" rather than "it landed 30 px from the original", and those two answers are
        // a third of the viewport apart at this zoom.
        await expect.poll(async () => (await readPointCoords(page)).length, { timeout: 8000 }).toBe(2);
        const coords = await readPointCoords(page);
        const pasted = coords[coords.length - 1];

        const span = Math.abs(coords[0][0] - expected[0]);
        expect(span).toBeGreaterThan(0);
        // Within a twentieth of the distance it travelled: comfortably closer to the click
        // than to the original, and not sensitive to the exact canvas offset.
        expect(Math.abs(pasted[0] - expected[0])).toBeLessThan(span / 20);
        expect(Math.abs(pasted[1] - expected[1])).toBeLessThan(span / 20);
    });
});

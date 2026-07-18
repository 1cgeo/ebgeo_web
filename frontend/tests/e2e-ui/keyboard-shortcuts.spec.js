// Path: e2e-ui/keyboard-shortcuts.spec.js

/**
 * §16.3,6 + §23 Keyboard shortcuts — local (🟢) pure-UI actions driven by REAL key
 * presses in real Chromium, with NO backend. The KeyboardShortcuts manager
 * (keyboard-shortcuts.js) is enabled on boot and listens on document keydown. We seed a
 * REAL feature through the real draw flow (point tool → canvas click → store.addFeature),
 * which auto-selects it and expands the sidebar feature panel
 * (`.feature-panel[data-expanded="true"]`). Then we assert REAL observable effects of the
 * shortcuts:
 *   §16.3 Ctrl+C copies the selected feature into the StateManager clipboard — proven by a
 *     follow-up Ctrl+V producing a "colada(s)" success toast (paste only fires when the
 *     clipboard was actually populated);
 *   §23/§16.6 Escape with a feature selected deselects it (the feature panel collapses to
 *     data-expanded="false");
 *   §23 Escape with an active draw tool deactivates it (the toolbar draw group flips
 *     data-active="false").
 *
 * The app boots from the Vite dev server; no login is needed (toolbar + map render on boot).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + toolbar to be ready and the style loaded. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () =>
            globalThis.__ebgeoMap &&
            typeof globalThis.__ebgeoMap.getZoom === 'function' &&
            globalThis.__ebgeoMap.loaded(),
        null,
        { timeout: 20000 },
    );
}

/** Returns the viewport-centre bounding box of the live map canvas. */
async function canvasCenter(page) {
    const box = await page.locator('.maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    return box;
}

/** Group button for the "Desenho" (draw) group. */
const drawGroupBtn = (page) =>
    page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn');

/** Tool button (inside the draw popup) by its tool id. */
const drawToolBtn = (page, toolId) =>
    page.locator(`.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);

/** Opens the draw group's popup and activates the given draw tool. */
async function activateDrawTool(page, toolId) {
    await drawGroupBtn(page).click();
    await expect(
        page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup'),
    ).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    const btn = drawToolBtn(page, toolId);
    await btn.click();
    await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 5000 });
}

/** The expanded sidebar feature panel (present + data-expanded="true" iff a feature is selected). */
const selectedPanel = (page) => page.locator('.feature-panel[data-expanded="true"]');

/**
 * Seeds one point feature via the real draw flow (activate point tool → single canvas
 * click). The point tool persists the feature, self-deactivates, and auto-selects it —
 * so the sidebar feature panel expands. Returns once the selection panel is visible.
 */
async function seedSelectedPoint(page) {
    const box = await canvasCenter(page);
    await activateDrawTool(page, 'point');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    // The point tool deactivates itself after creating the feature...
    await expect(drawGroupBtn(page)).toHaveAttribute('data-active', 'false', { timeout: 5000 });
    // ...and auto-selects the new feature, expanding the sidebar feature panel.
    await expect(selectedPanel(page)).toBeVisible({ timeout: 10000 });
}

describeOrSkip('§16.3,6 + §23 Keyboard shortcuts (real browser, local UI)', () => {
    // Copy/paste shortcuts touch the clipboard permission surface in the real browser.
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('§16.3 Ctrl+C copies the selected feature (Ctrl+V then pastes it)', async ({ page }) => {
        await bootApp(page);
        await seedSelectedPoint(page);

        // Copy the selected feature into the app clipboard. Success copy is silent (no toast),
        // so we prove population via a follow-up paste, which DOES toast on success.
        await page.keyboard.press('Control+c');

        // Paste: clones the copied feature → a "colada(s)" success toast confirms the
        // clipboard had real data (an empty clipboard would warn "Nenhuma feição copiada").
        await page.keyboard.press('Control+v');
        const successToast = page.locator('.toast--success', { hasText: /colada/i });
        await expect(successToast).toBeVisible({ timeout: 6000 });
        // And it is NOT the empty-clipboard warning path.
        await expect(page.locator('.toast--warning', { hasText: /Nenhuma feição copiada/i })).toHaveCount(0);
    });

    test('§23/§16.6 Escape deselects the selected feature (panel collapses)', async ({ page }) => {
        await bootApp(page);
        await seedSelectedPoint(page);

        // A feature is selected → the feature panel is expanded.
        await expect(selectedPanel(page)).toBeVisible();

        // Escape clears the selection: the panel collapses to data-expanded="false".
        await page.keyboard.press('Escape');
        await expect(selectedPanel(page)).toHaveCount(0, { timeout: 5000 });
        await expect(page.locator('.feature-panel')).toHaveAttribute('data-expanded', 'false', {
            timeout: 5000,
        });
    });

    test('§23 Escape deactivates an active draw tool', async ({ page }) => {
        await bootApp(page);

        // Activate the polygon draw tool from the toolbar.
        await activateDrawTool(page, 'polygon');
        await expect(drawGroupBtn(page)).toHaveAttribute('data-active', 'true', { timeout: 5000 });

        // Escape cancels / deactivates the active tool: the draw group flips inactive.
        await page.keyboard.press('Escape');
        await expect(drawGroupBtn(page)).toHaveAttribute('data-active', 'false', { timeout: 5000 });

        // The tool button itself is no longer active either.
        await drawGroupBtn(page).click();
        await expect(drawToolBtn(page, 'polygon')).toHaveAttribute('data-active', 'false', {
            timeout: 5000,
        });
    });
});

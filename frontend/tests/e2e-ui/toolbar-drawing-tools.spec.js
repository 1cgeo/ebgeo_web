// Path: e2e-ui/toolbar-drawing-tools.spec.js

/**
 * §7.1/§7.3 + §10.6 Drawing toolbar — local (🟢) pure-UI actions driven by REAL
 * clicks in real Chromium. Activating a drawing tool (Ponto/Linha/Polígono) from
 * the toolbar flips the tool button + group button to active (data-active=true);
 * pressing Escape (§7.3 cancel) deactivates it; toggling Snap (§10.6) flips its
 * own data-active state. No backend, no login — the toolbar renders on boot. State
 * is asserted on REAL DOM attributes mutated by the ToolManager / StateManager.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + toolbar to be ready. */
async function bootToolbar(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/** Group button for the "Desenho" (draw) group. */
const drawGroupBtn = (page) =>
    page.locator('.toolbar-group[data-group-id="draw"] .toolbar-group-btn');

/** Tool button (inside the draw popup) by its tool id. */
const drawToolBtn = (page, toolId) =>
    page.locator(`.toolbar-group[data-group-id="draw"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);

/** Opens the draw group's popup so its tool buttons become clickable. */
async function openDrawGroup(page) {
    await drawGroupBtn(page).click();
    await expect(
        page.locator('.toolbar-group[data-group-id="draw"] .toolbar-popup'),
    ).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
}

describeOrSkip('§7 Drawing tools toolbar (real browser, local UI)', () => {
    for (const { toolId, label } of [
        { toolId: 'point', label: 'Ponto' },
        { toolId: 'line', label: 'Linha' },
        { toolId: 'polygon', label: 'Polígono' },
    ]) {
        test(`activating ${label} marks the tool active, Escape deactivates it`, async ({ page }) => {
            await bootToolbar(page);
            await openDrawGroup(page);

            const btn = drawToolBtn(page, toolId);
            await expect(btn).toHaveAttribute('data-active', 'false');

            // §7.1 activate the tool from the toolbar.
            await btn.click();
            await expect(btn).toHaveAttribute('data-active', 'true', { timeout: 5000 });
            // The parent group button also reflects an active child tool.
            await expect(drawGroupBtn(page)).toHaveAttribute('data-active', 'true', { timeout: 5000 });

            // §7.3 Escape cancels / deactivates the active tool.
            await page.keyboard.press('Escape');
            await expect(drawGroupBtn(page)).toHaveAttribute('data-active', 'false', { timeout: 5000 });

            await openDrawGroup(page);
            await expect(drawToolBtn(page, toolId)).toHaveAttribute('data-active', 'false', {
                timeout: 5000,
            });
        });
    }

    test('§10.6 Snap toggle flips its active state on and off', async ({ page }) => {
        await bootToolbar(page);

        const snap = page.locator('.toolbar-standalone-btn[data-tool-id="snapping"]');
        await expect(snap).toBeVisible({ timeout: 5000 });

        const initial = await snap.getAttribute('data-active');
        const flipped = initial === 'true' ? 'false' : 'true';

        await snap.click();
        await expect(snap).toHaveAttribute('data-active', flipped, { timeout: 5000 });

        await snap.click();
        await expect(snap).toHaveAttribute('data-active', initial ?? 'false', { timeout: 5000 });
    });
});

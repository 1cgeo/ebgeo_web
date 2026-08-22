// Path: e2e-ui/utilities-measure.spec.js

/**
 * §10.1-5 Measurement utilities — local (🟢) pure-UI tools driven by REAL clicks on
 * the live MapLibre canvas (`.maplibregl-canvas`) in real Chromium. Each measure tool
 * lives in the toolbar "Utilitários" group (data-group-id="utility"): Medir Distância
 * (J), Medir Área (H), Medir Ângulo (X), and Selecionar (Q). Activating a tool flips
 * its toolbar button to data-active="true"; then clicking vertices on the canvas and
 * right-clicking to finalize opens an ephemeral results panel
 * (`.measurement-results-panel`) inside the sidebar feature panel, whose REAL displayed
 * text carries the measured value (distance with m/km, area with m²/ha, angle with °).
 * We assert that visible measurement text, not mere tool activation. No backend, no
 * login — the toolbar + map boot from the Vite dev server.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map, its canvas and the toolbar to be ready. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await expect(page.locator('#map-sig .maplibregl-canvas')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () =>
            globalThis.__ebgeoMap &&
            typeof globalThis.__ebgeoMap.getZoom === 'function' &&
            globalThis.__ebgeoMap.loaded(),
        null,
        { timeout: 20000 },
    );
}

/** Group button for the "Utilitários" (utility) toolbar group. */
const utilityGroupBtn = (page) =>
    page.locator('.toolbar-group[data-group-id="utility"] .toolbar-group-btn');

/** Tool button (inside the utility popup) by its tool id. */
const utilityToolBtn = (page, toolId) =>
    page.locator(
        `.toolbar-group[data-group-id="utility"] .toolbar-tool-btn[data-tool-id="${toolId}"]`,
    );

/** Opens the utility group's popup so its tool buttons become clickable. */
async function openUtilityGroup(page) {
    await utilityGroupBtn(page).click();
    await expect(
        page.locator('.toolbar-group[data-group-id="utility"] .toolbar-popup'),
    ).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
}

/** Activates a utility tool from the toolbar and asserts its button is active. */
async function activateUtilityTool(page, toolId) {
    await openUtilityGroup(page);
    const btn = utilityToolBtn(page, toolId);
    await expect(btn).toHaveAttribute('data-active', 'false');
    await btn.click();
    // The toolbar closes the popup after a pick; the group button reflects the active child.
    await expect(utilityGroupBtn(page)).toHaveAttribute('data-active', 'true', { timeout: 5000 });
}

/** Returns the live map canvas bounding box (asserting it is present). */
async function canvasBox(page) {
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    return box;
}

/** Left-clicks a single point on the canvas (a measurement vertex). */
async function clickPoint(page, box, fx, fy) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** Right-clicks a point on the canvas (finalizes the current measurement). */
async function finalizeAt(page, box, fx, fy) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, { button: 'right' });
}

describeOrSkip('§10.1-5 Measurement utilities (real browser, local pure-UI on canvas)', () => {
    test('§10.1 Medir Distância (J) draws two points and shows the total distance', async ({ page }) => {
        await bootApp(page);
        await activateUtilityTool(page, 'measureDistance');

        const box = await canvasBox(page);
        // Two distinct vertices, then a right-click third point finalizes the line.
        await clickPoint(page, box, 0.35, 0.4);
        await clickPoint(page, box, 0.6, 0.55);
        await finalizeAt(page, box, 0.7, 0.65);

        // The ephemeral results panel appears with a real total-distance readout.
        const panel = page.locator('.measurement-results-panel');
        await expect(panel).toBeVisible({ timeout: 8000 });
        await expect(panel.locator('.measurement-results-panel__header')).toHaveText('Medição de Distância');
        // Total carries a number + a distance unit suffix (m / km / NM / ft).
        await expect(panel.locator('.measurement-results-panel__total')).toHaveText(
            /[\d.,]+\s*(m|km|NM|ft)\b/,
            { timeout: 8000 },
        );
    });

    test('§10.2 Medir Área (H) draws 3+ points and shows the area value', async ({ page }) => {
        await bootApp(page);
        await activateUtilityTool(page, 'measureArea');

        const box = await canvasBox(page);
        // Three polygon vertices, then a right-click closes + finalizes the ring.
        await clickPoint(page, box, 0.4, 0.35);
        await clickPoint(page, box, 0.62, 0.45);
        await clickPoint(page, box, 0.5, 0.62);
        await finalizeAt(page, box, 0.42, 0.6);

        const panel = page.locator('.measurement-results-panel');
        await expect(panel).toBeVisible({ timeout: 8000 });
        await expect(panel.locator('.measurement-results-panel__header')).toHaveText('Medição de Área');
        // The area total carries a number + an area unit suffix (m² / ha / km²).
        await expect(panel.locator('.measurement-results-panel__total')).toHaveText(
            /[\d.,]+\s*(m²|ha|km²)/,
            { timeout: 8000 },
        );
    });

    test('§10.3 Medir Ângulo (X) draws 3 points and shows the angle in degrees', async ({ page }) => {
        await bootApp(page);
        await activateUtilityTool(page, 'measureAngle');

        const box = await canvasBox(page);
        // Angle tool finalizes automatically on the 3rd left-click (P1, vertex, P3).
        await clickPoint(page, box, 0.35, 0.55);
        await clickPoint(page, box, 0.5, 0.45);
        await clickPoint(page, box, 0.68, 0.58);

        const panel = page.locator('.measurement-results-panel');
        await expect(panel).toBeVisible({ timeout: 8000 });
        await expect(panel.locator('.measurement-results-panel__header')).toHaveText('Medição de Ângulo');
        // The first angle row is degrees: a number followed by the ° suffix.
        await expect(panel.locator('.measurement-results-panel__angle-value').first()).toHaveText(
            /[\d.,]+\s*°/,
            { timeout: 8000 },
        );
    });

    test('§10.4 Selecionar (Q) activates and flips its toolbar button to active', async ({ page }) => {
        await bootApp(page);

        await openUtilityGroup(page);
        const btn = utilityToolBtn(page, 'rectangleSelection');
        await expect(btn).toHaveAttribute('data-active', 'false');

        await btn.click();
        // The group button reflects the active child tool after the popup closes.
        await expect(utilityGroupBtn(page)).toHaveAttribute('data-active', 'true', { timeout: 5000 });

        // Re-open the popup and confirm the Select tool button itself is marked active.
        await openUtilityGroup(page);
        await expect(utilityToolBtn(page, 'rectangleSelection')).toHaveAttribute('data-active', 'true', {
            timeout: 5000,
        });
    });
});

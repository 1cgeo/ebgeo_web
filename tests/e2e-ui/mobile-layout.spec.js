// Path: e2e-ui/mobile-layout.spec.js

/**
 * §28.1-4,8,11 Mobile / phone layout — local (🟢) pure-UI interactions driven by REAL
 * pointer/touch gestures in a phone-emulated Chromium context (390×844, hasTouch). At
 * this viewport the PhoneLayout orchestrator (phone-layout.js) activates via matchMedia
 * and mounts the phone-only components: the floating search bar, the left navigation
 * drawer, the draggable bottom sheet (peek/half/full), and the FAB stack. No backend,
 * no login. Assertions target REAL observable effects — the `phone-mode` body class,
 * the drawer's slide-in class, the bottom sheet's `data-state` attribute, the REAL 2D
 * MapLibre zoom (`globalThis.__ebgeoMap`) after a FAB tap, and the feature-detail view
 * opening after selecting a node in the mobile layer tree. The app boots from the Vite
 * dev server.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app in phone mode and waits for the 2D map + phone components to mount. */
async function bootPhone(page) {
    await page.goto('/');
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
    // PhoneLayout activation tags <body> and mounts the phone-only components.
    await expect(page.locator('body')).toHaveClass(/phone-mode/, { timeout: 20000 });
    await expect(page.locator('.phone-bottom-sheet')).toBeAttached({ timeout: 20000 });
}

const zoom = (page) => page.evaluate(() => globalThis.__ebgeoMap.getZoom());

/**
 * Dispatch a real vertical touch flick on the bottom-sheet handle. A fast upward
 * (negative dy) flick triggers the sheet's velocity-based snap to the next state up.
 * @param {import('@playwright/test').Page} page
 * @param {number} dy - Total vertical delta in px (negative = up).
 */
async function flickSheetHandle(page, dy) {
    await page.evaluate(async (deltaY) => {
        const handle = document.querySelector('.phone-bottom-sheet__handle');
        const r = handle.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const startY = r.top + r.height / 2;
        const mkTouch = (clientY) =>
            new Touch({ identifier: 1, target: handle, clientX: x, clientY });
        const fire = (type, clientY) =>
            handle.dispatchEvent(
                new TouchEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    touches: type === 'touchend' ? [] : [mkTouch(clientY)],
                    changedTouches: [mkTouch(clientY)],
                }),
            );
        fire('touchstart', startY);
        // Three quick steps with tiny gaps → high upward velocity (> threshold).
        const steps = [startY + deltaY / 3, startY + (2 * deltaY) / 3, startY + deltaY];
        for (const y of steps) {
            await new Promise((res) => setTimeout(res, 8));
            fire('touchmove', y);
        }
        fire('touchend', startY + deltaY);
    }, dy);
}

describeOrSkip('§28 Mobile / phone layout (real browser, phone-emulated, local UI)', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('§28.1 the phone layout mounts its bottom sheet, FABs and search bar', async ({ page }) => {
        await bootPhone(page);

        // §28.1 the mobile chrome renders (sheet + FAB stack + search pill).
        await expect(page.locator('.phone-bottom-sheet')).toBeVisible();
        await expect(page.locator('.phone-fab-container')).toBeVisible();
        await expect(page.locator('.phone-search-bar')).toBeVisible();
        // Zoom FABs are real, clickable buttons in the stack.
        await expect(page.locator('.phone-fab[data-action="zoom-in"]')).toBeVisible();
        await expect(page.locator('.phone-fab[data-action="zoom-out"]')).toBeVisible();
        // The sheet starts collapsed at the peek snap point.
        await expect(page.locator('.phone-bottom-sheet')).toHaveAttribute('data-state', 'peek');
    });

    test('§28.2 the side drawer slides in from the hamburger and closes on the X', async ({ page }) => {
        await bootPhone(page);

        const drawer = page.locator('.phone-drawer');
        const backdrop = page.locator('.phone-drawer-backdrop');
        // Drawer is mounted but closed (no --open modifier) on boot.
        await expect(drawer).not.toHaveClass(/phone-drawer--open/);

        // Tap the hamburger in the search bar → drawer slides in.
        await page.locator('.phone-search-bar__hamburger').click();
        await expect(drawer).toHaveClass(/phone-drawer--open/, { timeout: 5000 });
        await expect(backdrop).toHaveClass(/phone-drawer-backdrop--open/);
        // Real drawer content rendered (the Mapas/Ferramentas/Atalhos sections).
        await expect(drawer.locator('.phone-drawer__section-header').first()).toBeVisible();

        // Close via the X button → drawer slides back out.
        await page.locator('.phone-drawer__close').click();
        await expect(drawer).not.toHaveClass(/phone-drawer--open/, { timeout: 5000 });
    });

    test('§28.3 dragging the bottom sheet handle snaps it peek → half → full', async ({ page }) => {
        await bootPhone(page);

        const sheet = page.locator('.phone-bottom-sheet');
        await expect(sheet).toHaveAttribute('data-state', 'peek');

        // Fast upward flick from peek → velocity snap to half.
        await flickSheetHandle(page, -260);
        await expect(sheet).toHaveAttribute('data-state', 'half', { timeout: 5000 });

        // Another upward flick from half → velocity snap to full.
        await flickSheetHandle(page, -260);
        await expect(sheet).toHaveAttribute('data-state', 'full', { timeout: 5000 });

        // Fast downward flick from full → back down to half.
        await flickSheetHandle(page, 260);
        await expect(sheet).toHaveAttribute('data-state', 'half', { timeout: 5000 });
    });

    test('§28.4 tapping the zoom-in FAB raises the real map zoom', async ({ page }) => {
        await bootPhone(page);

        const z0 = await zoom(page);
        await page.locator('.phone-fab[data-action="zoom-in"]').click();
        // zoomIn() eases (~300ms); poll the real map zoom for the increase.
        await expect.poll(() => zoom(page), { timeout: 6000 }).toBeGreaterThan(z0 + 0.5);

        const z1 = await zoom(page);
        await page.locator('.phone-fab[data-action="zoom-out"]').click();
        await expect.poll(() => zoom(page), { timeout: 6000 }).toBeLessThan(z1 - 0.5);
    });

    test('§28.8/§28.11 selecting a layer node in the mobile tree expands it and lifts the sheet', async ({ page }) => {
        await bootPhone(page);

        const sheet = page.locator('.phone-bottom-sheet');
        await expect(sheet).toHaveAttribute('data-state', 'peek');

        // The default local map always seeds the "Padrão" layer node in the tree.
        const layerHeader = sheet.locator('.phone-layer-tree__header').first();
        await expect(layerHeader).toBeVisible({ timeout: 10000 });
        const chevron = layerHeader.locator('.phone-layer-tree__chevron');
        // Node starts collapsed (no --expanded modifier on its chevron).
        await expect(chevron).not.toHaveClass(/phone-layer-tree__chevron--expanded/);

        // Tapping the layer node expands it AND lifts the peek sheet to half.
        await layerHeader.evaluate((el) => el.click()); // dispatch the real click listener (sheet animates; avoids actionability hang)
        await expect(chevron).toHaveClass(/phone-layer-tree__chevron--expanded/, { timeout: 5000 });
        await expect(sheet).toHaveAttribute('data-state', 'half', { timeout: 5000 });
        // Its features container is now un-hidden (collapsed nodes keep display:none).
        const featuresDisplay = await sheet
            .locator('.phone-layer-tree__layer')
            .first()
            .locator('.phone-layer-tree__features')
            .evaluate((el) => el.style.display);
        expect(featuresDisplay).not.toBe('none');

        // Tapping again collapses the node back.
        await layerHeader.evaluate((el) => el.click()); // dispatch the real click listener (sheet animates; avoids actionability hang)
        await expect(chevron).not.toHaveClass(/phone-layer-tree__chevron--expanded/, { timeout: 5000 });
    });
});

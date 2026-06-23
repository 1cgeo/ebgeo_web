// Path: e2e-ui/browser-unavailable.spec.js

/**
 * @fileoverview Boot fail-fast. The backend `GET /api/config` is the SINGLE config source (the
 * bundled config.js is an empty shell). When it's unreachable — after the boot retries — the app
 * must show the branded "EBGeo indisponível" screen and NOT boot on an empty config.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Boot fail-fast — backend unavailable', () => {
    test('shows the branded "EBGeo indisponível" screen when /api/config is unreachable', async ({ page }) => {
        // Abort every config fetch (the boot retries a few times, all fail).
        await page.route(/\/config(\?|$)/, (route) => route.abort());
        await page.goto('/');

        const screen = page.locator('[data-testid="ebgeo-unavailable"]');
        await expect(screen).toBeVisible({ timeout: 25000 });
        await expect(screen).toContainText('EBGeo indisponível');
        await expect(page.locator('[data-testid="ebgeo-unavailable-retry"]')).toBeVisible();
        // The boot splash was torn down and the app did NOT boot.
        await expect(page.locator('#initial-loader')).toHaveCount(0);
    });
});

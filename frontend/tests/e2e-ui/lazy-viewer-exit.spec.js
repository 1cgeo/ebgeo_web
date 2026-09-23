import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
test.skip(state.skip, 'Requires the backend for application configuration');

test('leaving a 2D map never loads unused 3D engines or rejects their imports', async ({ page }) => {
    const engines = [];
    const errors = [];
    page.on('request', request => {
        if (/\/(map_3d|first_person_viewer)\.js(?:\?|$)/.test(request.url())) engines.push(request.url());
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.loading-background')).toHaveCount(0);
    expect(engines).toEqual([]);
    await page.goto('/atlas.html');
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible();
    expect(engines).toEqual([]);
    expect(errors).toEqual([]);
});

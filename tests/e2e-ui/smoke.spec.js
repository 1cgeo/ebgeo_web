// Path: e2e-ui/smoke.spec.js

/**
 * Browser smoke: the real app boots in real Chromium (served by Vite) and mounts
 * a MapLibre canvas. Uncaught page errors are surfaced as a SOFT assertion (the
 * app fetches external tiles that 404 in the sandbox — those are network errors,
 * not page errors, so they don't fail the smoke).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('App smoke (real browser)', () => {
    test('boots and renders a map canvas without an uncaught error', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        const response = await page.goto('/');
        expect(response?.ok()).toBeTruthy();

        await expect(page.locator('canvas').first()).toBeAttached({ timeout: 20000 });

        expect.soft(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    });
});

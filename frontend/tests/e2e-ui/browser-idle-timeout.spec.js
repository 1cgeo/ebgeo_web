// Path: e2e-ui/browser-idle-timeout.spec.js

/**
 * Frente 4 — idle session timeout (real browser + backend). While logged in, inactivity raises a
 * warning and then ends the session, re-opening login; choosing "Continuar conectado" keeps it.
 * The idle/warning windows are config-driven, so the test shrinks them to a few seconds before login.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, openAtlasUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

// Idle phase ≈ 6s (comfortably longer than login+connect), warning visible ≈ 4s (easy to catch),
// so the warning reliably appears AFTER setup and the session doesn't expire mid-connect.
const IDLE_MINUTES = 0.17; // ≈ 10.2s total
const WARN_SECONDS = 4;

/** Seeds a user + an atlas with one named map. */
async function seedUserAtlas(page, baseUrl) {
    return page.evaluate(async (base) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        const username = `idle_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
        const password = 'Sup3r-Secret-Pw!';
        await api.register({ username, password, nome: 'Idle Tester' });
        await api.login(username, password);
        const atlas = await api.createAtlas({ name: 'Idle Atlas' });
        await api.pushOperations(atlas.id, [createOperation('map', 'create', crypto.randomUUID(), null, { name: 'Mapa' })]);
        return { username, password, atlasId: atlas.id };
    }, baseUrl);
}

/** Shrinks the idle/warning windows (in the live config the controller reads on login). */
async function shrinkIdleWindows(page, idleMinutes, warnSeconds) {
    await page.evaluate(async ({ m, w }) => {
        const config = (await import('/src/js/config.js')).default;
        config.features = config.features || {};
        config.features.idle_timeout_minutes = m;
        config.features.idle_warning_seconds = w;
    }, { m: idleMinutes, w: warnSeconds });
}

async function loginAndOpen(page, seed) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    // Set the short idle windows BEFORE login so the detector reads them when the session starts.
    await shrinkIdleWindows(page, IDLE_MINUTES, WARN_SECONDS);
    await loginUI(page, seed.username, seed.password);
    await openAtlasUI(page, seed.atlasId); // last interaction; from here we stay idle
}

describeOrSkip('Idle session timeout', () => {
    test('warns then expires → session ends and login re-opens', async ({ page }) => {
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl);
        await loginAndOpen(page, seed);

        // No interaction → the inactivity warning appears…
        await expect(page.locator('[data-testid="idle-warning"]')).toBeVisible({ timeout: 16000 });
        // …and, left unanswered, the session ends and the login modal re-opens.
        await expect(page.locator('[data-testid="login-modal"]')).toBeVisible({ timeout: 16000 });
        await expect(page.locator('[data-testid="idle-warning"]')).toHaveCount(0);
    });

    test('"Continuar conectado" dismisses the warning and keeps the session', async ({ page }) => {
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl);
        await loginAndOpen(page, seed);

        await expect(page.locator('[data-testid="idle-warning"]')).toBeVisible({ timeout: 16000 });
        await page.locator('[data-testid="idle-warning-stay"]').click();
        await expect(page.locator('[data-testid="idle-warning"]')).toHaveCount(0);

        // Still connected, no login prompt (the re-armed window has not lapsed).
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 5000 });
        await expect(page.locator('[data-testid="login-modal"]')).toHaveCount(0);
    });
});

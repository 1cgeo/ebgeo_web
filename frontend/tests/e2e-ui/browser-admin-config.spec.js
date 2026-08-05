// Path: e2e-ui/browser-admin-config.spec.js

/**
 * Browser click-through of the ADMIN PANEL → Sistema tab, in real Chromium against the REAL
 * spawned backend. A global admin edits STATIC/ENV config (app.title + features.grid) that has no
 * `resources` row; the override is stored server-side and deep-merged into GET /config. After a
 * reload the app re-fetches config — the test reads it via the live apiClient and asserts the
 * override took effect end-to-end.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

async function seedAdmin(page, baseUrl, dbName) {
    await page.goto('/');
    const creds = await page.evaluate(async (url) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        const username = `cfgadmin_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
        await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Cfg Admin' });
        return { username, password: 'Sup3r-Secret-Pw!' };
    }, baseUrl);
    await createDb(dbName).raw.none(
        "UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER($1)", [creds.username]);
    return creds;
}

async function loginThroughUi(page, baseUrl, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    // Login lands on the project chooser PAGE; "Mapa local" is a page's replacement for the old
    // picker close button.
    await page.waitForURL('**/projetos.html', { timeout: 20000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
}

describeOrSkip('Admin panel — Sistema (config) tab (real browser + real backend)', () => {
    test.afterAll(async () => { await closeDb(); });

    test('an admin edits app.title + features.grid and it propagates to GET /config', async ({ page }) => {
        const admin = await seedAdmin(page, state.baseUrl, state.dbName);
        await loginThroughUi(page, state.baseUrl, admin);

        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await page.locator('[data-testid="account-admin-btn"]').click();
        // Administração is a PAGE now: the menu item navigates to /admin.html, which re-boots
        // (config + session) before the shell exists. Wait for the navigation, not just the element.
        await page.waitForURL('**/admin.html', { timeout: 20000 });
        await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });

        // Switch to the Sistema tab and wait for the form to load.
        await page.locator('[data-testid="admin-tab-config"]').click();
        await expect(page.locator('[data-testid="admin-config-form"]')).toBeVisible({ timeout: 10000 });

        const newTitle = `EBGeo ${Math.random().toString(36).slice(2, 7)}`;
        await page.locator('[data-testid="admin-config-app-title"]').fill(newTitle);
        await page.locator('[data-testid="admin-config-feat-grid"]').check();
        // An ADVANCED override for a key with no form field (map3d.initialCamera) — proves any config
        // path is editable. The curated fields above merge on top.
        await page.locator('[data-testid="admin-config-advanced"]').fill('{"map3d":{"initialCamera":{"height":777}}}');
        await page.locator('[data-testid="admin-config-save"]').click();
        await expect(page.locator('[data-testid="admin-config-notice"]')).toBeVisible({ timeout: 10000 });

        // Reload so the app re-fetches config, then read it via the live apiClient.
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
        const cfg = await page.evaluate(async () => {
            const { apiClient } = await import('/src/js/store/sync/api-client.js');
            return apiClient.getConfig();
        });
        expect(cfg.app.title).toBe(newTitle);
        expect(cfg.features.grid).toBe(true);
        expect(cfg.map3d.initialCamera.height).toBe(777);
    });
});

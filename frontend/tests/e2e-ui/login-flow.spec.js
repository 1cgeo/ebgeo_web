// Path: e2e-ui/login-flow.spec.js

/**
 * Browser click-through: drives the REAL backend-integration UI (AccountControl →
 * login modal → project picker → sync-status badge) in real Chromium against the
 * REAL spawned backend.
 *
 * Setup seeds a user + atlas DIRECTLY via the transport modules (api-client /
 * operation-factory) imported live from the Vite dev server, then points the app's
 * syncEngine at the spawned backend via window.__EBGEO_BACKEND_URL__ (set with
 * addInitScript BEFORE the app loads) and clicks the actual UI.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Login → open project flow (real browser + real backend)', () => {
    test('logs in, picks the seeded atlas, and reaches an online sync state', async ({ page }) => {
        // 1. Seed a user + atlas directly via the transport, inside the browser page.
        await page.goto('/');
        const seed = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `uilogin_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'UI Login' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'UI Login Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            return { username, password, atlasId: atlas.id };
        }, state.baseUrl);

        // 2. Point the app's syncEngine at the spawned backend BEFORE the app loads.
        await page.addInitScript((url) => {
            window.__EBGEO_BACKEND_URL__ = url;
        }, `${state.baseUrl}/api/v1`);

        // The setup api.login() above PERSISTS a JWT to localStorage (session persistence / P7), so a
        // plain reload would boot ALREADY authenticated and hide the login button. Clear it so the
        // reload boots ANONYMOUS — this test exercises the UI login from scratch.
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });

        // 3. Reload so the init script + fresh app boot pick up the override.
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        // 4. Open the login modal and submit credentials.
        await page.locator('[data-testid="account-login-btn"]').click();
        await expect(page.locator('[data-testid="login-modal"]')).toBeVisible({ timeout: 5000 });
        await page.locator('[data-testid="login-username"]').fill(seed.username);
        await page.locator('[data-testid="login-password"]').fill(seed.password);
        await page.locator('[data-testid="login-submit"]').click();

        // 5. Pick the seeded atlas on the project chooser PAGE (login navigates there).
        await page.waitForURL('**/atlas.html', { timeout: 20000 });
        await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 10000 });
        await page
            .locator(`[data-testid="project-picker-item"][data-atlas-id="${seed.atlasId}"]`)
            .click();

        // 6. The sync badge reaches "online" and the account collapses to its
        //    avatar. The username + "Sair" now live in a dropdown: open it by
        //    clicking the avatar, then assert the logout action is visible.
        await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute(
            'data-state',
            'online',
            { timeout: 15000 },
        );
        // The login button is gone once logged in; the avatar button replaces it.
        await expect(page.locator('[data-testid="account-login-btn"]')).toBeHidden({ timeout: 5000 });
        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await expect(page.locator('[data-testid="account-user"]')).toHaveText(seed.username);
        await expect(page.locator('[data-testid="account-logout-btn"]')).toBeVisible({ timeout: 5000 });
    });
});

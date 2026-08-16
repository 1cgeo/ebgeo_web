// Path: e2e-ui/browser-admin-users.spec.js

/**
 * Browser click-through of the ADMIN PANEL → Usuários tab, in real Chromium against
 * the REAL spawned backend. A global admin is seeded by registering a user (the
 * self-registration path forces role='user') and then promoting it to role='admin'
 * directly in Postgres (the only way to mint a system admin) via the read-only DB
 * helper's `raw` escape hatch.
 *
 * Proves F3 end-to-end: the "Administração" menu item is gated by the GLOBAL admin
 * role; the panel lists users and drives create + deactivate/reactivate against the
 * existing /api/v1/users admin routes (requireAdmin). A second test proves a non-admin
 * never sees the menu item.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Registers a fresh user through the live transport (role='user'); returns its credentials. */
async function registerUser(page, baseUrl) {
    return page.evaluate(async (url) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        const username = `uiadmin_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
        const password = 'Sup3r-Secret-Pw!';
        await api.register({ username, password, nome: 'Admin Tester' });
        return { username, password };
    }, baseUrl);
}

/** Boots the app anonymous (backend override + cleared storage) and logs in through the UI. */
async function loginThroughUi(page, baseUrl, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    // Login lands on the project chooser PAGE (no atlas needed for admin work). A page has no
    // close button, so the way back to the map is its "Mapa local" action.
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
}

describeOrSkip('Admin panel — Usuários tab (real browser + real backend)', () => {
    test.afterAll(async () => { await closeDb(); });

    test('a global admin opens the panel, creates a user, and deactivates it', async ({ page }) => {
        await page.goto('/');
        const admin = await registerUser(page, state.baseUrl);
        // Promote to a GLOBAL system admin (self-registration can only create role='user').
        await createDb(state.dbName).raw.none(
            "UPDATE users SET role = 'admin' WHERE LOWER(username) = LOWER($1)",
            [admin.username]
        );

        await loginThroughUi(page, state.baseUrl, admin);

        // Open the account menu → the admin item is visible for a global admin.
        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await expect(page.locator('[data-testid="account-admin-btn"]')).toBeVisible({ timeout: 5000 });

        // Open the page; the Users tab loads the table. Administração is a PAGE now: the menu item
        // navigates to /admin.html, which re-boots (config + session) before the shell exists —
        // so wait for the navigation, not just the element.
        await page.locator('[data-testid="account-admin-btn"]').click();
        await page.waitForURL('**/admin.html', { timeout: 20000 });
        await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
        await expect(page.locator('[data-testid="admin-users-table"]')).toContainText(admin.username, { timeout: 10000 });

        // Create a new user through the form.
        const newUsername = `created_${Math.random().toString(36).slice(2, 10)}`;
        await page.locator('[data-testid="admin-users-new"]').click();
        await page.locator('[data-testid="admin-userform-nome"]').fill('Novo Fulano');
        await page.locator('[data-testid="admin-userform-username"]').fill(newUsername);
        await page.locator('[data-testid="admin-userform-password"]').fill('senha-forte-123');
        await page.locator('[data-testid="admin-userform-save"]').click();

        // Back to the list: the new user appears, active.
        const row = page.locator('[data-testid="admin-users-row"]', { hasText: newUsername });
        await expect(row).toBeVisible({ timeout: 10000 });
        await expect(row).toContainText('Ativo');

        // Deactivate it (confirm in the confirm modal, which stacks above the admin panel).
        await row.locator('[data-testid="admin-user-deactivate"]').click();
        await page.locator('.confirm-modal-overlay .confirm-modal-btn-confirm').click();

        // With "inactive" hidden, the row disappears; toggling it back shows it as Inativo.
        await expect(page.locator('[data-testid="admin-users-row"]', { hasText: newUsername })).toHaveCount(0, { timeout: 10000 });
        await page.locator('[data-testid="admin-users-include-inactive"]').check();
        const inactiveRow = page.locator('[data-testid="admin-users-row"]', { hasText: newUsername });
        await expect(inactiveRow).toBeVisible({ timeout: 10000 });
        await expect(inactiveRow).toContainText('Inativo');
    });

    test('a non-admin user never sees the Administração menu item', async ({ page }) => {
        await page.goto('/');
        const user = await registerUser(page, state.baseUrl); // stays role='user'
        await loginThroughUi(page, state.baseUrl, user);

        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await expect(page.locator('[data-testid="account-logout-btn"]')).toBeVisible({ timeout: 5000 });
        // The admin item exists in the DOM but stays hidden for a non-admin.
        await expect(page.locator('[data-testid="account-admin-btn"]')).toBeHidden();
    });

    test('a non-admin who types /admin.html is sent back to the map', async ({ page }) => {
        await page.goto('/');
        const user = await registerUser(page, state.baseUrl); // stays role='user'
        await loginThroughUi(page, state.baseUrl, user);

        // Hiding the menu item is not a gate — the page is reachable by URL. It must re-check the
        // global role on arrival and bounce, instead of rendering a shell whose every request 403s.
        await page.goto('/admin.html');
        await page.waitForURL((url) => !url.pathname.endsWith('/admin.html'), { timeout: 20000 });
        await expect(page.locator('[data-testid="admin-panel"]')).toHaveCount(0);
    });
});

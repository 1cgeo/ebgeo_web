// Path: e2e-ui/browser-atlas-drive.spec.js

/**
 * Frente 1 (Drive) — card actions. On the atlas Drive page (`atlas.html`), each card's ⋯ menu
 * drives rename / "make a copy" / move-to-trash against the existing atlas endpoints
 * (PUT /atlas/:id, POST /atlas/:id/clone, DELETE /atlas/:id). Real browser + real backend.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Registers a user, creates the given atlases, then logs in through the UI so the Drive is open. */
async function openDrive(page, atlasNames) {
    await page.goto('/');
    const creds = await page.evaluate(async ({ url, names }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        const username = `drv_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
        await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Drive Tester' });
        await api.login(username, 'Sup3r-Secret-Pw!');
        for (const n of names) await api.createAtlas({ name: n });
        return { username, password: 'Sup3r-Secret-Pw!' };
    }, { url: state.baseUrl, names: atlasNames });

    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    // The Drive is a PAGE since 2026-08-05: login navigates to it. The `project-picker-*` testids
    // were kept verbatim through the move, so everything below this line is unchanged.
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="project-picker-item"]').first()).toBeVisible({ timeout: 10000 });
    return creds;
}

/** Opens the ⋯ menu of the card containing `name`. */
async function openCardMenu(page, name) {
    const card = page.locator('[data-testid="project-picker-item"]', { hasText: name });
    await card.hover();
    await card.locator('xpath=following-sibling::*[@data-testid="project-picker-menu"]').click();
    await expect(page.locator('[data-testid="project-picker-menu-popup"]')).toBeVisible({ timeout: 5000 });
}

describeOrSkip('Atlas Drive — card actions', () => {
    test('renames a project via the ⋯ menu', async ({ page }) => {
        await openDrive(page, ['Projeto Base']);
        await openCardMenu(page, 'Projeto Base');
        await page.locator('[data-testid="project-picker-rename"]').click();
        await page.locator('.prompt-modal-overlay .prompt-modal-input').fill('Projeto Renomeado');
        await page.locator('.prompt-modal-overlay .prompt-modal-btn-confirm').click();

        await expect(page.locator('[data-testid="project-picker-item"]', { hasText: 'Projeto Renomeado' }))
            .toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="project-picker-item"]', { hasText: 'Projeto Base' }))
            .toHaveCount(0);
    });

    test('makes a copy via the ⋯ menu', async ({ page }) => {
        await openDrive(page, ['Original']);
        await openCardMenu(page, 'Original');
        await page.locator('[data-testid="project-picker-duplicate"]').click();

        await expect(page.locator('[data-testid="project-picker-item"]', { hasText: 'Original (cópia)' }))
            .toBeVisible({ timeout: 10000 });
        await expect(page.locator('[data-testid="project-picker-item"]')).toHaveCount(2);
    });

    test('moves a project to trash via the ⋯ menu', async ({ page }) => {
        await openDrive(page, ['Para Excluir', 'Fica']);
        await openCardMenu(page, 'Para Excluir');
        await page.locator('[data-testid="project-picker-trash"]').click();
        await page.locator('.confirm-modal-overlay .confirm-modal-btn-confirm').click();

        await expect(page.locator('[data-testid="project-picker-item"]', { hasText: 'Para Excluir' }))
            .toHaveCount(0, { timeout: 10000 });
        await expect(page.locator('[data-testid="project-picker-item"]', { hasText: 'Fica' })).toBeVisible();
    });

    test('restores a project from the Lixeira tab', async ({ page }) => {
        await openDrive(page, ['Para Lixeira', 'Fica Aqui']);

        // Trash it.
        await openCardMenu(page, 'Para Lixeira');
        await page.locator('[data-testid="project-picker-trash"]').click();
        await page.locator('.confirm-modal-overlay .confirm-modal-btn-confirm').click();
        await expect(page.locator('[data-testid="project-picker-item"]', { hasText: 'Para Lixeira' }))
            .toHaveCount(0, { timeout: 10000 });

        // The Lixeira tab lists it.
        await page.locator('[data-testid="project-picker-tab-lixeira"]').click();
        const trashItem = page.locator('[data-testid="project-picker-trash-item"]', { hasText: 'Para Lixeira' });
        await expect(trashItem).toBeVisible({ timeout: 10000 });

        // Restore → it leaves the trash and reappears in Recentes.
        await trashItem.locator('[data-testid="project-picker-restore"]').click();
        await expect(page.locator('[data-testid="project-picker-trash-item"]', { hasText: 'Para Lixeira' }))
            .toHaveCount(0, { timeout: 10000 });

        await page.locator('[data-testid="project-picker-tab-recentes"]').click();
        await expect(page.locator('[data-testid="project-picker-item"]', { hasText: 'Para Lixeira' }))
            .toBeVisible({ timeout: 10000 });
    });
});

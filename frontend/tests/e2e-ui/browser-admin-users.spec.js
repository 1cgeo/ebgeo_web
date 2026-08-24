// Path: e2e-ui/browser-admin-users.spec.js

/**
 * Browser click-through of the ADMIN PANEL → Usuários tab, in real Chromium against
 * the REAL spawned backend. A global admin is seeded by registering a user through the
 * public route with its e-mail confirmed (`helpers/accounts.js`, Node side — the
 * self-registration path forces role='user') and then promoting it to role='admin'
 * directly in Postgres (the only way to mint a system admin) via the read-only DB
 * helper's `raw` escape hatch.
 *
 * Proves F3 end-to-end: the "Administração" menu item is gated by the GLOBAL admin
 * role; the panel lists users and drives create + deactivate/reactivate against the
 * existing /api/v1/users admin routes (requireAdmin). Dois testes irmãos provam a
 * audiência nova: qualquer autenticado abre a página com a aba Grupos e SÓ ela, e o
 * anônimo continua sendo mandado de volta ao mapa.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Registers a fresh user and promotes it to GLOBAL admin.
 *
 * DUAS escritas de natureza diferente, e a distinção é o ponto — ela agora está dita uma vez
 * só, no `fileoverview` de `helpers/accounts.js`. A conta nasce pela rota pública, com o
 * e-mail confirmado pela rota pública, então o portão de verificação continua exercitado; a
 * PROMOÇÃO é SQL porque não existe rota: criar um administrador exige um administrador, e
 * esta camada parte de um banco vazio cuja única porta é `POST /auth/register`. A galinha e o
 * ovo não têm solução em forma de rota, então a escrita é honesta no helper em vez de
 * espalhada por cinco specs, que era o estado até 2026-08-23.
 */
async function registerAdmin() {
    return createVerifiedUser({ prefix: 'uiadmin', nome: 'Admin Tester', role: 'admin' });
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
        const admin = await registerAdmin();
        await page.goto('/');
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

    // OS DOIS CASOS ABAIXO AFIRMAVAM O MUNDO ANTERIOR A 2026-08-20 e reprovavam desde então.
    // O gate deixou de ser o papel global `admin` e passou a ser TER CONTA: `adminAudience`
    // (`js/admin/admin-audience.js`) dá a qualquer autenticado a porta rotulada pelo que ela
    // entrega, porque grupo de acesso virou entidade de usuário, com dono. Reescrever o teste para
    // o produto novo é obrigatório, e o NEGATIVO que sobrou é o anônimo/visitante: apagar os dois
    // casos e não repor negativo nenhum deixaria a porta sem guarda.
    //
    // EM 2026-08-24 ELES MUDARAM DE NOVO, pela mesma regra: a audiência ganhou a aba "Concessões"
    // (o inventário do que a pessoa concedeu e do que concederam a ela), e o rótulo acompanhou as
    // abas, virando "Acessos". Um rótulo que continuasse dizendo "Grupos" prometeria uma página
    // que já não é só isso, que é o defeito que o módulo de audiência existe para impedir.
    test('a non-admin user gets the door LABELLED for what it gives (Acessos), not Administração', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'uiadmin', nome: 'Admin Tester' }); // stays role='user'
        await page.goto('/');
        await loginThroughUi(page, state.baseUrl, user);

        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await expect(page.locator('[data-testid="account-logout-btn"]')).toBeVisible({ timeout: 5000 });
        const porta = page.locator('[data-testid="account-admin-btn"]');
        await expect(porta).toBeVisible();
        await expect(porta).toHaveText(/Acessos/);
        // A DISCRIMINAÇÃO, e ela é o ponto do caso: a porta não pode dizer "Administração" para
        // quem recebe duas abas. Sem esta linha, um rótulo fixo passaria verde na de cima.
        await expect(porta).not.toHaveText(/Administração/);
    });

    test('a non-admin who types /admin.html gets Grupos and Concessões, and NOTHING else', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'uiadmin', nome: 'Admin Tester' }); // stays role='user'
        await page.goto('/');
        await loginThroughUi(page, state.baseUrl, user);

        await page.goto('/admin.html');
        await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
        // A DISCRIMINAÇÃO É A LISTA DE ABAS, não a presença do painel: sem ela, um painel que
        // abrisse com as SEIS abas do administrador passaria verde neste caso.
        await expect(page.locator('.admin-panel__tab')).toHaveCount(2);
        await expect(page.locator('[data-testid="admin-tab-groups"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-tab-grants"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-tab-users"]')).toHaveCount(0);
        // `audit` é a ausência que espelha o 403 do servidor: a trilha do sistema não é acervo
        // privado nem grupo próprio, e oferecê-la seria a pior forma de dizer não.
        await expect(page.locator('[data-testid="admin-tab-audit"]')).toHaveCount(0);
    });

    test('an ANONYMOUS visitor who types /admin.html is sent back to the map', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/admin.html');
        await page.waitForURL((url) => !url.pathname.endsWith('/admin.html'), { timeout: 20000 });
        await expect(page.locator('[data-testid="admin-panel"]')).toHaveCount(0);
    });
});

// Path: e2e-ui/browser-signup.spec.js

/**
 * Browser click-through of self-registration + e-mail confirmation (F1 + F2): the REAL
 * AccountControl → login modal → signup modal flow in real Chromium against the REAL
 * spawned backend (ALLOW_SELF_REGISTRATION=true).
 *
 * Because the signup form carries an e-mail, the account is created PENDING: login is
 * BLOCKED until the e-mail is confirmed. The test reads the verification token straight
 * from Postgres (the user can't open a real inbox), drives the ?verify boot branch, then
 * logs in — the end-to-end proof of "create a user from the login button, confirm by e-mail".
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Signup → create account + confirm e-mail (real browser + real backend)', () => {
    test.afterAll(async () => { await closeDb(); });

    test('creates an account, is blocked until confirmation, then signs in', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        const username = `uisignup_${Math.random().toString(36).slice(2, 10)}`;
        const email = `${username}@example.mil`;
        const password = 'Sup3r-Secret-Pw!';

        // Login modal → "Criar conta" → signup modal.
        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-register"]').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        await page.locator('[data-testid="signup-nome"]').fill('Usuário de Teste');
        await page.locator('[data-testid="signup-username"]').fill(username);
        await page.locator('[data-testid="signup-email"]').fill(email);
        await page.locator('[data-testid="signup-password"]').fill(password);
        await page.locator('[data-testid="signup-password-confirm"]').fill(password);
        // Posto/Graduação + Organização Militar are required (FK dropdowns from /config).
        await page.locator('[data-testid="signup-posto"]').selectOption({ label: 'Capitão' });
        await page.locator('[data-testid="signup-om"]').selectOption({ label: 'Diretoria de Serviço Geográfico' });
        await page.locator('[data-testid="signup-submit"]').click();

        // The "verifique seu e-mail" dialog appears; dismiss it ("Entendi").
        await expect(page.locator('.confirm-modal-overlay')).toBeVisible({ timeout: 10000 });
        await page.locator('.confirm-modal-btn-cancel').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toHaveCount(0, { timeout: 5000 });

        // Login is blocked until the e-mail is confirmed.
        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-username"]').fill(username);
        await page.locator('[data-testid="login-password"]').fill(password);
        await page.locator('[data-testid="login-submit"]').click();
        await expect(page.locator('[data-testid="login-error"]')).toContainText('Confirme seu e-mail', { timeout: 10000 });

        // Read the verification token from Postgres and confirm via the ?verify boot branch.
        const rows = await createDb(state.dbName).raw.any(
            `SELECT t.token FROM email_verification_tokens t
             JOIN users u ON u.id = t.user_id
             WHERE LOWER(u.email) = LOWER($1) AND t.consumed_at IS NULL
             ORDER BY t.created_at DESC LIMIT 1`,
            [email]
        );
        const token = rows[0]?.token;
        expect(token).toBeTruthy();

        await page.goto(`/?verify=${token}`);
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        // Now login succeeds → reaching the project picker proves the account is active.
        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-username"]').fill(username);
        await page.locator('[data-testid="login-password"]').fill(password);
        await page.locator('[data-testid="login-submit"]').click();
        // Login hands over to the project chooser PAGE — wait for the navigation, not just the element.
        await page.waitForURL('**/atlas.html', { timeout: 20000 });
        await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 15000 });
    });

    test('rejects mismatched passwords inline without hitting the backend', async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });

        await page.locator('[data-testid="account-login-btn"]').click();
        await page.locator('[data-testid="login-register"]').click();
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible({ timeout: 5000 });

        const u = `uimismatch_${Math.random().toString(36).slice(2, 10)}`;
        await page.locator('[data-testid="signup-nome"]').fill('Mismatch');
        await page.locator('[data-testid="signup-username"]').fill(u);
        await page.locator('[data-testid="signup-email"]').fill(`${u}@example.mil`);
        await page.locator('[data-testid="signup-password"]').fill('abc123XYZ!');
        await page.locator('[data-testid="signup-password-confirm"]').fill('different456!');
        // posto/OM are required <select>s — fill them so native validation lets the submit through to
        // the custom password-match check (which still never hits the backend).
        await page.locator('[data-testid="signup-posto"]').selectOption({ label: 'Capitão' });
        await page.locator('[data-testid="signup-om"]').selectOption({ label: 'Diretoria de Serviço Geográfico' });
        await page.locator('[data-testid="signup-submit"]').click();

        await expect(page.locator('[data-testid="signup-error"]')).toContainText('senhas não coincidem', { timeout: 5000 });
        await expect(page.locator('[data-testid="signup-modal"]')).toBeVisible();
    });
});

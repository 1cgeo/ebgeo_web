// Path: tests/e2e-ui/browser-account-recovery-audit.spec.js
import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;
const field = (page, id) => page.getByTestId(id);

describeOrSkip('Signup and password recovery audit', () => {
    test.afterAll(async () => { await closeDb(); });
    test.beforeEach(async ({ page }) => {
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await expect(field(page, 'account-login-btn')).toBeVisible({ timeout: 20000 });
    });
    async function signup(page) {
        await field(page, 'account-login-btn').click();
        await field(page, 'login-register').click();
    }
    async function fillSignup(page) {
        const username = `ui_audit_${Math.random().toString(36).slice(2, 10)}`;
        await field(page, 'signup-nome').fill('Teste Cadastro');
        await field(page, 'signup-username').fill(username);
        await field(page, 'signup-email').fill(`${username}@example.mil`);
        await field(page, 'signup-password').fill('Original-123');
        await field(page, 'signup-password-confirm').fill('Original-123');
        await field(page, 'signup-posto').selectOption({ index: 1 });
        await field(page, 'signup-om').selectOption({ index: 1 });
        return username;
    }
    test('late signup response cannot reopen a dialog after cancellation', async ({ page }) => {
        let release, arrived;
        const delayed = new Promise((resolve) => { release = resolve; });
        const committed = new Promise((resolve) => { arrived = resolve; });
        await page.route('**/auth/register', async (route) => {
            const response = await route.fetch();
            arrived();
            await delayed;
            await route.fulfill({ response });
        });
        await signup(page);
        await fillSignup(page);
        await field(page, 'signup-submit').click();
        await committed;
        await field(page, 'signup-cancel').click();
        const response = page.waitForResponse('**/auth/register');
        release();
        await response;
        await expect(field(page, 'signup-modal')).toHaveCount(0);
        await page.waitForTimeout(250);
        await expect(page.locator('.confirm-modal-overlay')).toHaveCount(0);
    });

    test('lost signup response retains fields and retry does not duplicate the account', async ({ page }, testInfo) => {
        await signup(page);
        const username = await fillSignup(page);
        await page.route('**/auth/register', async (route) => {
            await route.fetch();
            await route.abort('connectionfailed');
        }, { times: 1 });
        await field(page, 'signup-submit').click();
        await expect(field(page, 'signup-error')).toBeVisible();
        await expect(field(page, 'signup-username')).toHaveValue(username);
        await expect(field(page, 'signup-password')).toHaveValue('Original-123');
        await page.screenshot({ path: testInfo.outputPath('signup-lost-response.png') });
        await field(page, 'signup-submit').click();
        await expect(page.locator('.confirm-modal-overlay')).toBeVisible();
        const { n } = await createDb(state.dbName).raw.one('SELECT COUNT(*)::int AS n FROM users WHERE username = $1', [username]);
        expect(n).toBe(1);
    });

    test('missing domain lists block invalid submissions with an explanation', async ({ page }, testInfo) => {
        await page.evaluate(async () => {
            const { default: config } = await import('/src/js/config.js');
            config.postos = [];
            config.organizacoesMilitares = [];
        });
        await signup(page);
        await expect(field(page, 'signup-posto')).toBeDisabled();
        await expect(field(page, 'signup-submit')).toBeDisabled();
        await expect(field(page, 'signup-error')).toContainText('carregar');
        await field(page, 'signup-error').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('signup-missing-domains.png') });
    });

    test('signup rejects a password whose UTF-8 bytes exceed bcrypt capacity', async ({ page }) => {
        await signup(page);
        await fillSignup(page);
        await field(page, 'signup-password').fill('á'.repeat(37));
        await field(page, 'signup-password-confirm').fill('á'.repeat(37));
        let requests = 0;
        page.on('request', (r) => { if (r.url().endsWith('/auth/register')) requests++; });
        await field(page, 'signup-submit').click();
        await expect(field(page, 'signup-error')).toContainText('72 bytes');
        expect(requests).toBe(0);
    });

    test('recovery survives a lost response, refuses reuse and allows login with the new password', async ({ page, request }, testInfo) => {
        const username = `recover_ui_${Math.random().toString(36).slice(2, 10)}`;
        const email = `${username}@example.mil`;
        const registered = await request.post(`${state.baseUrl}/api/v1/auth/register`, {
            data: { username, email, nome: 'Recovery UI', password: 'Original-123' },
        });
        expect(registered.status()).toBe(201);
        const db = createDb(state.dbName).raw;
        const user = await db.one('UPDATE users SET email_verified = TRUE WHERE username = $1 RETURNING id', [username]);
        await field(page, 'account-login-btn').click();
        await field(page, 'login-forgot-password').click();
        await field(page, 'login-recovery-email').fill(email);
        await field(page, 'login-recovery-request').click();
        await expect(field(page, 'login-recovery-message')).toContainText('alguns minutos');
        const { token } = await db.one("SELECT token FROM email_verification_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND consumed_at IS NULL", [user.id]);
        await field(page, 'login-recovery-code').fill(token);
        await field(page, 'login-recovery-password').fill('á'.repeat(37));
        await field(page, 'login-recovery-confirm').fill('á'.repeat(37));
        await field(page, 'login-recovery-reset').click();
        await expect(field(page, 'login-recovery-message')).toContainText('72 bytes');
        await field(page, 'login-recovery-password').fill('Replacement-123');
        await field(page, 'login-recovery-confirm').fill('Replacement-123');
        await page.route('**/auth/reset-password', async (route) => {
            await route.fetch();
            await route.abort('connectionfailed');
        }, { times: 1 });
        await field(page, 'login-recovery-reset').click();
        await expect(field(page, 'login-recovery-message')).toHaveAttribute('role', 'alert');
        await field(page, 'login-recovery-reset').click();
        await expect(field(page, 'login-recovery-message')).toContainText('inválido ou já utilizado');
        // A fresh code is the recovery path after an ambiguous network failure.
        await field(page, 'login-recovery-request').click();
        await expect(field(page, 'login-recovery-message')).toContainText('alguns minutos');
        const fresh = await db.one("SELECT token FROM email_verification_tokens WHERE user_id = $1 AND purpose = 'reset_password' AND consumed_at IS NULL", [user.id]);
        await field(page, 'login-recovery-code').fill(fresh.token);
        await field(page, 'login-recovery-reset').click();
        await expect(field(page, 'login-recovery-message')).toContainText('Senha redefinida');
        await expect(field(page, 'login-recovery-password')).toHaveValue('');
        await expect(field(page, 'login-recovery-code')).toHaveValue('');
        await page.screenshot({ path: testInfo.outputPath('recovery-complete.png') });
        await field(page, 'login-forgot-password').click();
        await field(page, 'login-username').fill(username);
        await field(page, 'login-password').fill('Replacement-123');
        await field(page, 'login-submit').click();
        await page.waitForURL('**/atlas.html');
    });
});

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
 *
 * A CONTA, porém, não nasce aqui dentro: ela vem pronta de `helpers/accounts.js`, no lado
 * Node, porque confirmar o e-mail exige ler `email_verification_tokens` no Postgres, que o
 * contexto do browser não alcança. O `page.evaluate` faz só o `login()`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Login → open project flow (real browser + real backend)', () => {
    test('logs in, picks the seeded atlas, and reaches an online sync state', async ({ page }) => {
        // 1. Seed a VERIFIED user (Node side) + an atlas via the transport inside the page.
        const user = await createVerifiedUser({ prefix: 'uilogin', nome: 'UI Login' });
        await page.goto('/');
        const seed = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'UI Login Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            return { username: u.username, password: u.password, atlasId: atlas.id };
        }, { baseUrl: state.baseUrl, u: user });

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

    test('the eye reveals the password without submitting, in the login view and in the reset step', async ({ page }) => {
        // The WIRING is what this pins: the component itself is covered by `browser-signup.spec.js`.
        // A button inside a form submits by default, so a reveal that logs the person in (or asks
        // the server for a reset) is the regression worth a case.
        let autenticou = 0;
        page.on('request', (r) => {
            const url = r.url();
            if (url.endsWith('/auth/login') || url.endsWith('/auth/reset-password')) autenticou++;
        });
        const t = (id) => page.locator(`[data-testid="${id}"]`);

        await page.goto('/');
        await t('account-login-btn').click();
        await t('login-password').fill('segredo123');
        await page.locator('[data-testid="login-password-reveal"]').click();
        await expect(t('login-password')).toHaveAttribute('type', 'text');
        await expect(page.locator('[data-testid="login-password-reveal"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(t('login-view')).toBeVisible();

        await t('login-forgot-password').click();
        await t('login-recovery-have-code').click();
        await t('login-recovery-password').fill('novaSenha1');
        await page.locator('[data-testid="login-recovery-password-reveal"]').click();
        await expect(t('login-recovery-password')).toHaveAttribute('type', 'text');
        // The sibling box keeps its own state: one eye never reveals the other field.
        await expect(t('login-recovery-confirm')).toHaveAttribute('type', 'password');
        await expect(page.locator('[data-testid="login-recovery-confirm-reveal"]')).toBeVisible();

        // CLEARED AND HIDDEN ARE ONE GESTURE. Entering recovery empties the login password; if the
        // eye stayed lit, the next password typed there would show in clear text with no gesture
        // from the person. The field was revealed above, so this is the crossing that matters.
        await t('login-recovery-back').click();
        await expect(t('login-password')).toHaveValue('');
        await expect(t('login-password')).toHaveAttribute('type', 'password');
        await expect(page.locator('[data-testid="login-password-reveal"]')).toHaveAttribute('aria-pressed', 'false');
        expect(autenticou).toBe(0);
    });

    test('two activations of Entrar open ONE dialog, not two stacked ones', async ({ page }) => {
        // A real double click cannot show this (the first dialog covers the button), but Enter held
        // down and a programmatic second activation can: both reach the opener before any paint.
        await page.goto('/');
        const botao = page.locator('[data-testid="account-login-btn"]');
        await expect(botao).toBeVisible();
        await botao.evaluate((el) => { el.click(); el.click(); });
        await expect(page.locator('[data-testid="login-password"]').first()).toBeVisible();
        await expect(page.locator('#login-modal-overlay')).toHaveCount(1);
        await expect(page.locator('#login-username')).toHaveCount(1);
    });
});

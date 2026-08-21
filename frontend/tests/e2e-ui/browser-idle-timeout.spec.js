// Path: e2e-ui/browser-idle-timeout.spec.js

/**
 * Frente 4 — idle session timeout (real browser + backend). While logged in, inactivity raises a
 * warning and then ends the session, re-opening login; choosing "Continuar conectado" keeps it.
 * The idle/warning windows are config-driven, so the test shrinks them to a few seconds before login.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, openAtlasUI } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

// Idle phase ≈ 6s (comfortably longer than login+connect), warning visible ≈ 4s (easy to catch),
// so the warning reliably appears AFTER setup and the session doesn't expire mid-connect.
const IDLE_MINUTES = 0.17; // ≈ 10.2s total
const WARN_SECONDS = 4;

/** Seeds a user + an atlas with one named map. */
async function seedUserAtlas(page, baseUrl) {
    // A conta nasce no NODE (`helpers/accounts.js`): confirmar o e-mail exige ler
    // `email_verification_tokens` no Postgres, fora do alcance do browser. Aqui isso é
    // pré-requisito e não detalhe — o teste loga pela UI, e conta pendente é login recusado.
    const u = await createVerifiedUser({ prefix: 'idle', nome: 'Idle Tester' });
    const seed = await page.evaluate(async ({ base, user }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        await api.login(user.username, user.password);
        const atlas = await api.createAtlas({ name: 'Idle Atlas' });
        await api.pushOperations(atlas.id, [createOperation('map', 'create', crypto.randomUUID(), null, { name: 'Mapa' })]);
        return { atlasId: atlas.id };
    }, { base: baseUrl, user: u });
    return { username: u.username, password: u.password, atlasId: seed.atlasId };
}

/**
 * Shrinks the idle/warning windows by rewriting the CONFIG RESPONSE inside the page.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT THE OBVIOUS TWO WAYS
 * ---------------------------------------------------------------------------
 * 1. Mutating the loaded `config` object after boot (what this file did until 2026-08-16)
 *    stopped working when login became a NAVIGATION: it lands on `atlas.html`, and every
 *    document boot re-hydrates `config` from `GET /api/config` — the backend is the single
 *    source and there is no static fallback. The mutation was thrown away before the idle
 *    detector read it, so both cases waited for a warning that was still minutes away. The
 *    failure read as "the idle warning is broken" and was "the setting did not survive a
 *    page load".
 *
 * 2. `page.route` + `route.fetch()` + `route.fulfill()` is the documented interception
 *    pattern and it does not survive here: the fetched response is DISPOSED before the body
 *    can be read back ("Response has been disposed"), inside a handler where the throw looks
 *    like a patch that quietly did nothing.
 *
 * So the rewrite happens in the page, in an init script, wrapping `window.fetch`. It runs on
 * every document with no Playwright lifecycle involved, and it patches INSIDE the envelope:
 * the controller answers `res.json({ data })` and `ApiClient._unwrap` reads `data`, so a patch
 * written at the top level edits a key nobody reads.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} idleMinutes - Idle window, in minutes.
 * @param {number} warnSeconds - Warning window, in seconds.
 * @returns {Promise<void>}
 */
async function shrinkIdleWindows(page, idleMinutes, warnSeconds) {
    await page.addInitScript(({ m, w }) => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, init) => {
            const response = await original(input, init);
            const url = typeof input === 'string' ? input : (input?.url ?? '');
            if (!/\/api\/(v1\/)?config(\?|$)/.test(url) || !response.ok) return response;
            const body = await response.clone().json().catch(() => null);
            if (!body) return response;
            const target = ('data' in body) ? body.data : body;
            target.features = target.features || {};
            target.features.idle_timeout_minutes = m;
            target.features.idle_warning_seconds = w;
            return new Response(JSON.stringify(body), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        };
    }, { m: idleMinutes, w: warnSeconds });
}

async function loginAndOpen(page, seed) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    // Positive control on the instrument itself: without it, a patch that silently stopped
    // applying would come back as "the idle warning is broken" all over again.
    //
    // POLL, NÃO LEITURA ÚNICA: `page.goto` volta no load, mas o app HIDRATA o config de forma
    // assíncrona, a partir do `GET /api/config` (o servidor é a fonte única; `config.js` é só o
    // formato). Ler uma vez logo depois do goto mede, às vezes, o objeto ainda vazio e devolve
    // `null` — foi assim que este controle reprovou em 1,8 s, acusando o instrumento de não ter
    // aplicado a janela quando ele só ainda não tinha sido consultado.
    //
    // O controle continua sendo controle: se o patch de fato nunca chegar ao config, o valor nunca
    // vira `IDLE_MINUTES` e o caso reprova com a mesma mensagem, só que pelo motivo certo.
    await expect
        .poll(async () => page.evaluate(async () => {
            const config = (await import('/src/js/config.js')).default;
            return config.features?.idle_timeout_minutes ?? null;
        }), {
            timeout: 15000,
            message: 'a janela de inatividade encurtada nao chegou ao config do app',
        })
        .toBe(IDLE_MINUTES);
    await loginUI(page, seed.username, seed.password);
    await openAtlasUI(page, seed.atlasId); // last interaction; from here we stay idle
}

describeOrSkip('Idle session timeout', () => {
    // The patch is installed before the FIRST navigation of the test, not inside
    // `loginAndOpen`. Installed later it fires on the first boot and then goes quiet: the
    // browser serves the second boot's config from its own HTTP cache, so no request reaches
    // the route and the app hydrates with the production windows. Measured, and it looked
    // exactly like "the patch does not work" rather than "the patch was never asked".
    test.beforeEach(async ({ page }) => {
        await shrinkIdleWindows(page, IDLE_MINUTES, WARN_SECONDS);
    });

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

// Path: e2e-ui/browser-atlas-url.spec.js

/**
 * Frente 3 — URL por atlas (`?atlas=<uuid>&map=<uuid>`). Two boot paths (real browser + backend):
 *   1. Logged in → the deep link opens that atlas and lands on the REQUESTED map (not just the first).
 *   2. Logged out → the deep link is remembered, login is prompted, and after auth it RESUMES straight
 *      to that atlas (no project picker).
 * Also asserts the address bar reflects the atlas/map after connecting.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, goToLocalMapUI, drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const currentMapName = (page) =>
    page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());

/** Seeds a user + an atlas with the given named maps (UUID-keyed). Returns ids keyed by name. */
async function seedUserAtlas(page, baseUrl, maps) {
    return page.evaluate(async ({ base, mapNames }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        const username = `url_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
        const password = 'Sup3r-Secret-Pw!';
        await api.register({ username, password, nome: 'URL Tester' });
        await api.login(username, password);
        const atlas = await api.createAtlas({ name: 'URL Atlas' });
        const ops = [];
        const mapIds = {};
        for (const name of mapNames) {
            const id = crypto.randomUUID();
            mapIds[name] = id;
            ops.push(createOperation('map', 'create', id, null, { name }));
        }
        await api.pushOperations(atlas.id, ops);
        return { username, password, atlasId: atlas.id, mapIds };
    }, { base: baseUrl, mapNames: maps });
}

describeOrSkip('Atlas deep link (?atlas=&map=)', () => {
    test('logged in: opens the atlas and lands on the requested map; URL reflects it', async ({ page }) => {
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl, ['Mapa Um', 'Mapa Dois']);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await loginUI(page, seed.username, seed.password); // token persisted; picker visible

        // Deep link straight to the SECOND map — the requested map must win over the first/last.
        await page.goto(`/?atlas=${seed.atlasId}&map=${seed.mapIds['Mapa Dois']}`);
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 25000 });
        await expect.poll(() => currentMapName(page), { timeout: 15000 }).toBe('Mapa Dois');

        const url = new URL(page.url());
        expect(url.searchParams.get('atlas')).toBe(seed.atlasId);
        expect(url.searchParams.get('map')).toBe(seed.mapIds['Mapa Dois']);
    });

    test('logged in WITH unsaved local work: the deep link OFFERS save/discard before replacing it', async ({ page }) => {
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl, ['Servidor']);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');
        await loginUI(page, seed.username, seed.password);
        await goToLocalMapUI(page); // logged in, local store

        // Create unsaved local work, then hit the deep link via a reload.
        await drawPointUI(page, [-43.2, -22.9]);
        await page.goto(`/?atlas=${seed.atlasId}`);

        // The boot must ASK, not wipe silently — and the answer set has three members. Until
        // 2026-08-05 this was a two-button confirm that only told the user to go download a .ebgeo
        // first; "Salvar e continuar" is what makes keeping the work an option inside the flow.
        const dialog = page.locator('.confirm-modal-overlay');
        await expect(dialog).toBeVisible({ timeout: 20000 });
        await expect(dialog.locator('[data-testid="confirm-choice-cancel"]')).toBeVisible();
        await expect(dialog.locator('[data-testid="confirm-choice-save"]')).toBeVisible();
        await expect(dialog.locator('[data-testid="confirm-choice-discard"]')).toBeVisible();

        // Cancelling leaves the local work alone: no connection, and the point is still on the map.
        await dialog.locator('[data-testid="confirm-choice-cancel"]').click();
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .not.toHaveAttribute('data-state', 'online', { timeout: 10000 });
    });

    test('logged out: prompts login, then resumes straight to the atlas', async ({ page }) => {
        await page.goto('/');
        const seed = await seedUserAtlas(page, state.baseUrl, ['Mapa Único']);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });

        // Anonymous boot WITH the deep link → the boot remembers it and opens the login modal.
        await page.goto(`/?atlas=${seed.atlasId}`);
        await expect(page.locator('[data-testid="login-modal"]')).toBeVisible({ timeout: 20000 });

        await page.locator('[data-testid="login-username"]').fill(seed.username);
        await page.locator('[data-testid="login-password"]').fill(seed.password);
        await page.locator('[data-testid="login-submit"]').click();

        // Resumes to the atlas itself — NOT the project picker.
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 25000 });
        await expect.poll(() => currentMapName(page), { timeout: 15000 }).toBe('Mapa Único');
        await expect(page.locator('[data-testid="project-picker-modal"]')).toHaveCount(0);
    });
});

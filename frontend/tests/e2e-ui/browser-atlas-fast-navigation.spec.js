// Path: e2e-ui/browser-atlas-fast-navigation.spec.js
import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { drawPointUI, readFeatures, loginUI } from './helpers/collab-helpers.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

test('rapid picker navigation preserves local and both remote atlases after reload', async ({ page, request }) => {
    test.setTimeout(360000);
    const creds = await createVerifiedUser({ prefix: 'fastnav', nome: 'Fast navigation' });
    const login = await request.post(`${state.baseUrl}/api/v1/auth/login`, {
        data: { username: creds.username, password: creds.password },
    });
    expect(login.ok()).toBe(true);
    const { data: auth } = await login.json();
    const names = ['Fast atlas A', 'Fast atlas B'];
    for (const name of names) {
        const created = await request.post(`${state.baseUrl}/api/v1/atlas`, {
            headers: { Authorization: `Bearer ${auth.accessToken}` }, data: { name },
        });
        expect(created.status()).toBe(201);
    }
    await page.addInitScript(url => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = async () => {
        await expect(page.locator('#initial-loader')).toHaveCount(0);
        await expect(page.locator('#nav-btn-zoom-in')).toBeVisible();
    };
    const picker = async () => {
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="project-picker-item"]').first()).toBeVisible();
    };
    const openRemote = async name => {
        await page.locator('[data-testid="project-picker-item"]', { hasText: name }).click();
        // Intentionally leave as soon as the connection becomes online: no settling delay.
        await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
    };
    const openLocal = async () => {
        await page.locator('[data-testid="local-atlas-item"]').first().click();
        await ready();
    };
    await page.goto('/');
    await ready();
    const localId = await drawPointUI(page, [-43.2, -22.9]);
    await loginUI(page, creds.username, creds.password);
    const remoteIds = [];
    for (const name of names) {
        await picker();
        await openRemote(name);
        await ready();
        remoteIds.push(await drawPointUI(page, [-43.2, -22.9]));
    }
    for (let round = 0; round < 4; round++) {
        for (const name of names) {
            await picker();
            await openRemote(name);
            await picker();
            await openLocal();
            await expect.poll(async () => (await readFeatures(page, 'points')).map(f => f.id)).toEqual([localId]);
        }
    }
    for (let index = 0; index < names.length; index++) {
        await picker();
        await openRemote(names[index]);
        await ready();
        await page.reload();
        await ready();
        await expect(page.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await expect.poll(async () => (await readFeatures(page, 'points')).map(f => f.id)).toEqual([remoteIds[index]]);
    }
    await picker();
    await openLocal();
    await page.reload();
    await ready();
    await expect.poll(async () => (await readFeatures(page, 'points')).map(f => f.id)).toEqual([localId]);
    expect(errors).toEqual([]);
});

// Path: e2e-ui/browser-f5-reconnect-map.repro.spec.js

/**
 * Regression: after F5 on a connected remote atlas, the active map must be resolved BY NAME, not
 * left on the raw UUID storage key. A real F5 keeps the `?atlas=&map=` address bar, so the deep-link
 * boot path re-opens the atlas on the requested map (via activateAtlasInitialMap, which resolves the
 * map id → NAME). The bug left the active map on a UUID key, so the UI showed a UUID and presence
 * broadcast under that UUID mapId, which peers (keyed by NAME) filtered out — the mouse position
 * never reached them until the user manually switched maps.
 *
 * This logs in, picks an atlas with one named synced map, reloads (keeping the session + URL), and
 * asserts the active map is the NAME after the deep-link reconnect.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const currentMapName = (page) =>
    page.evaluate(async () => (await import('/src/js/store/index.js')).getCurrentMapNameSync());

describeOrSkip('F5 on a connected atlas keeps the map active BY NAME (not a UUID)', () => {
    test('after reload the synced map is active by name, so presence emits', async ({ page }) => {
        const MAP_NAME = 'Mapa Tático';

        await page.goto('/');
        const seed = await page.evaluate(async ({ baseUrl, mapName }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `f5_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'F5 Tester' });
            await api.login(username, password);
            const atlas = await api.createAtlas({ name: 'F5 Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: mapName })]);
            return { username, password, atlasId: atlas.id };
        }, { baseUrl: state.baseUrl, mapName: MAP_NAME });

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');

        // UI login → pick the seeded atlas → land on the named synced map.
        await loginUI(page, seed.username, seed.password);
        await page.locator(`[data-testid="project-picker-item"][data-atlas-id="${seed.atlasId}"]`).click();
        // Picking navigates to `/?atlas=<uuid>`; the map page's boot router opens it.
        await page.waitForURL(/[?&]atlas=/, { timeout: 20000 });
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 20000 });
        await expect.poll(() => currentMapName(page), { timeout: 10000 }).toBe(MAP_NAME);

        // The address bar is the source of truth: opening reflects the atlas/map in the URL.
        await expect.poll(() => new URL(page.url()).searchParams.get('atlas'), { timeout: 10000 })
            .toBe(seed.atlasId);

        // F5 — a real reload KEEPS the `?atlas=&map=` URL + localStorage, so the session restores and
        // the deep-link boot path re-opens the atlas on the same map (a bare `/` would show the chooser).
        await page.reload();
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 25000 });

        // After reconnect the active map must be the NAME (the bug left it on the raw UUID key).
        await expect.poll(() => currentMapName(page), { timeout: 15000 }).toBe(MAP_NAME);
    });
});

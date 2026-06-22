// Path: e2e-ui/browser-save-local-to-server.spec.js

/**
 * @fileoverview Browser E2E for "Salvar atlas local no servidor" (item 2) — the UI flow that
 * couldn't be auto-tested at the unit/transport layer.
 *
 * A logged-in user working on the LOCAL store draws a feature, opens the account menu, clicks
 * "Salvar no servidor", names the atlas, and confirms. We then assert — by reading the connected
 * atlas id and pulling a FRESH snapshot from the backend over HTTP — that the local store was
 * packaged into a NEW server atlas (feature present) AND that the app went live on it (sync online).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Salvar atlas local no servidor (UI, item 2)', () => {
    test('logged-in local user packages the local store into a new server atlas and goes live', async ({ browser }) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');

        // Register a fresh user via the API, then log in through the real account UI.
        const creds = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `save_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Save Local' });
            return { username, password };
        }, state.baseUrl);

        await loginUI(page, creds.username, creds.password);
        // Cancel the project picker — we want to work on the LOCAL store, not open a server atlas.
        await page.locator('[data-testid="project-picker-cancel"]').click();

        // Wait for the live map, then draw a point into the LOCAL store (logged in, NOT connected).
        await page.waitForFunction(
            () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function' && globalThis.__ebgeoMap.loaded(),
            { timeout: 20000 },
        );
        const featureId = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const id = crypto.randomUUID();
            const f = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: 'Ponto Local' },
            };
            await store.addFeature('points', f);
            return id;
        });
        // Sanity: feature is in the local store and we are NOT connected to any atlas yet.
        const localCount = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
            const f = await store.getCurrentMapFeatures();
            return { points: (f.points || []).length, connected: !!syncEngine.atlasId };
        });
        expect(localCount.points).toBeGreaterThan(0);
        expect(localCount.connected).toBe(false);

        // Open the account menu → "Salvar no servidor" (visible only when logged in + local).
        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        const saveBtn = page.locator('[data-testid="account-save-server-btn"]');
        await expect(saveBtn).toBeVisible();
        await saveBtn.click();

        // Create-atlas modal: name + confirm.
        await expect(page.locator('[data-testid="create-atlas-name"]')).toBeVisible();
        await page.locator('[data-testid="create-atlas-name"]').fill('Atlas Salvo UI');
        await page.locator('[data-testid="create-atlas-confirm"]').click();

        // The app must now be LIVE on the new remote atlas.
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 20000 });

        // End-to-end check: read the connected atlas id, pull a FRESH snapshot from the backend,
        // and confirm the local feature made it to the server.
        const result = await page.evaluate(async ({ baseUrl, c, fid }) => {
            const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
            const atlasId = syncEngine.atlasId;
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(c.username, c.password);
            const pulled = await api.pullSync(atlasId, 0);
            const maps = pulled.snapshot?.maps || [];
            const points = maps.flatMap((m) => m.features?.points || []);
            return { atlasId, mapCount: maps.length, found: points.some((p) => p.properties.id === fid) };
        }, { baseUrl: state.baseUrl, c: creds, fid: featureId });

        expect(result.atlasId).toBeTruthy();
        expect(result.mapCount).toBeGreaterThan(0);
        expect(result.found).toBe(true);

        // --- Journey continues: EDIT the now-live remote atlas; the edit must sync to the server.
        //     (The user owns the atlas they just created, so editing must be permitted, and the
        //     auto-flush must carry the new op up.) ---
        const live = await page.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const id = crypto.randomUUID();
            const out = await store.addFeature('points', {
                type: 'Feature', geometry: { type: 'Point', coordinates: [-43.3, -23.0] },
                properties: { id, source: 'point', nome: 'Pos-save' },
            });
            return { id, added: !!out };
        });
        expect(live.added, 'the owner can edit the atlas they just saved').toBe(true);

        const synced = await page.evaluate(async ({ baseUrl, c, fid }) => {
            const { syncEngine } = await import('/src/js/store/sync/sync-engine.js');
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(c.username, c.password);
            for (let i = 0; i < 25; i++) {
                const pulled = await api.pullSync(syncEngine.atlasId, 0);
                const pts = (pulled.snapshot?.maps || []).flatMap((m) => m.features?.points || []);
                if (pts.some((p) => p.properties.id === fid)) return true;
                await new Promise((r) => setTimeout(r, 300));
            }
            return false;
        }, { baseUrl: state.baseUrl, c: creds, fid: live.id });
        expect(synced, 'the post-save live edit reaches the server via auto-flush').toBe(true);

        await ctx.close();
    });
});

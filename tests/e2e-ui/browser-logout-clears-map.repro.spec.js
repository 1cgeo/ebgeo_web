// Path: e2e-ui/browser-logout-clears-map.repro.spec.js

/**
 * Regression: logging out must wipe the workspace — NO traces of the old map may linger, neither in
 * the store NOR (the user-visible bug) in the live MapLibre GeoJSON sources. The user reported that
 * after "Sair" the old map's features are still drawn on the canvas. We draw a real point, log out
 * through the real account menu, then assert the point is gone from BOTH the store AND every live
 * map source, and that only the single blank default map remains.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Lingering-data snapshot: store map names, store feature count, and LIVE source feature count. */
function snapshotTraces(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const mapNames = await store.getAllMapNamesStore();
        const feats = await store.getCurrentMapFeatures();
        let storeFeatures = 0;
        for (const arr of Object.values(feats || {})) {
            if (Array.isArray(arr)) storeFeatures += arr.length;
        }
        // Live MapLibre sources: sum features across every GeoJSON source (the visual "trace").
        const map = globalThis.__ebgeoMap;
        let sourceFeatures = 0;
        const srcIds = map ? Object.keys(map.getStyle().sources || {}) : [];
        for (const id of srcIds) {
            const s = map.getSource(id);
            if (s && typeof s.getData === 'function') {
                const d = await s.getData();
                if (d && Array.isArray(d.features)) sourceFeatures += d.features.length;
            }
        }
        return { mapNames, storeFeatures, sourceFeatures };
    });
}

describeOrSkip('Logout clears the workspace — no traces of the old map', () => {
    test('a drawn feature is gone from the store AND the live map sources after logout', async ({ page }) => {
        const username = `logout_${Math.random().toString(36).slice(2, 10)}`;
        const password = 'Sup3r-Secret-Pw!';

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        // Seed the user via the transport (no e-mail → immediately active).
        await page.evaluate(async (u) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${u.base}/api/v1` });
            await api.register({ username: u.username, password: u.password, nome: 'Logout Tester' });
        }, { base: state.baseUrl, username, password });
        await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
        await page.goto('/');

        await loginUI(page, username, password);
        await page.locator('[data-testid="project-picker-cancel"]').click();
        await page.waitForFunction(
            () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function' && globalThis.__ebgeoMap.loaded(),
            { timeout: 20000 });

        // Draw a point through the REAL tool → it lives in the store AND the live 'points' source.
        const pointId = await drawPointUI(page, [-43.21, -22.91]);
        expect(pointId, 'the point tool created a feature').toBeTruthy();
        await page.keyboard.press('Escape'); // close the auto-opened feature panel

        const before = await snapshotTraces(page);
        expect(before.storeFeatures, 'point present in the store before logout').toBeGreaterThan(0);
        expect(before.sourceFeatures, 'point present in the live map source before logout').toBeGreaterThan(0);

        // Log out through the REAL account menu.
        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        await page.locator('[data-testid="account-logout-btn"]').click();
        await expect(page.locator('[data-testid="account-login-btn"]')).toBeVisible({ timeout: 15000 });

        // No traces: store back to a single blank map, and the live sources carry NO features.
        await expect.poll(async () => (await snapshotTraces(page)).storeFeatures, { timeout: 10000 }).toBe(0);
        const after = await snapshotTraces(page);
        expect(after.sourceFeatures, 'no feature traces remain in the live map sources after logout').toBe(0);
        expect(after.mapNames.length, 'only the single default map remains').toBe(1);
    });
});

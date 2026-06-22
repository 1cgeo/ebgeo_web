// Path: e2e-ui/browser-p11-roundtrip.spec.js

/**
 * @fileoverview Browser E2E for P11 (round-trip fidelity `.ebgeo` -> server -> `.ebgeo`).
 *
 * Canonical flow: user A builds a local map, "Salvar no servidor", shares the atlas with user B;
 * B opens it from the server and exports. The two `.ebgeo` payloads must carry the SAME content.
 *
 * We compare NORMALIZED export summaries (the `.ebgeo` `data` object that the exporter serializes,
 * via `buildExportDataObject`). Feature ids are UUIDs and are preserved end-to-end, so they compare
 * directly; maps are keyed by NAME so the intentionally-remapped map/layer/atlas ids don't matter
 * (P11's allowed differences). A's summary is captured from the LOCAL store BEFORE saving; B's from
 * the pulled server atlas — if they're equal, the content round-tripped with no loss.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { loginUI, openClient } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Captures a normalized summary of the current store's `.ebgeo` export data. */
function summarize(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const svc = store.getControl('exportImport');
        const mapNames = await store.getAllMapNamesStore();
        const data = await svc.buildExportDataObject(mapNames);
        const out = { mapNames: Object.keys(data.maps).sort(), maps: {} };
        for (const [name, m] of Object.entries(data.maps)) {
            const feats = {};
            for (const [type, arr] of Object.entries(m.features || {})) {
                if (!Array.isArray(arr) || arr.length === 0) continue;
                feats[type] = arr
                    .map((f) => ({ id: f.properties?.id, source: f.properties?.source, nome: f.properties?.nome, geometry: f.geometry }))
                    .sort((a, b) => (a.id < b.id ? -1 : 1));
            }
            out.maps[name] = {
                baseLayer: m.baseLayer,
                features: feats,
                grid: data.gridStyle?.[name] || null,
                temporal: data.temporal?.[name] || null,
            };
        }
        return out;
    });
}

describeOrSkip('P11 round-trip fidelity (.ebgeo -> server -> .ebgeo, two users)', () => {
    test("A's local export and B's server-pulled export carry the same content", async ({ browser }) => {
        // Register both users via the API; capture B's id for sharing.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const users = await seedPage.evaluate(async (base) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const password = 'Sup3r-Secret-Pw!';
            const mk = (n) => `${n}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            const a = { username: mk('p11a'), password, nome: 'P11 A' };
            const b = { username: mk('p11b'), password, nome: 'P11 B' };
            const apiA = new ApiClient({ baseUrl: `${base}/api/v1` });
            await apiA.register({ ...a });
            const apiB = new ApiClient({ baseUrl: `${base}/api/v1` });
            const rb = await apiB.register({ ...b });
            return { a, b: { ...b, id: rb && (rb.id || rb.user?.id) } };
        }, state.baseUrl);
        await seedPage.close();

        // ---- User A: build a local map, snapshot its .ebgeo, then save to server. ----
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        await pageA.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await pageA.goto('/');
        await loginUI(pageA, users.a.username, users.a.password);
        await pageA.locator('[data-testid="project-picker-cancel"]').click();
        await pageA.waitForFunction(
            () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.loaded === 'function' && globalThis.__ebgeoMap.loaded(),
            { timeout: 20000 },
        );

        // Draw a rich local dataset: two features + a grid style + a temporal config.
        await pageA.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            const mapName = store.getCurrentMapNameSync();
            await store.addFeature('points', {
                type: 'Feature', geometry: { type: 'Point', coordinates: [-43.21, -22.91] },
                properties: { id: crypto.randomUUID(), source: 'point', nome: 'Alfa' },
            });
            await store.addFeature('polygons', {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [[[-43.2, -22.9], [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.9]]] },
                properties: { id: crypto.randomUUID(), source: 'polygon', nome: 'Area' },
            });
            await store.setGridStyle(mapName, { format: 'utm', visible: true });
            await store.setMapTemporalConfig(mapName, { ativo: true, modo: 'absoluto', unidade: 'h', inicio: 0, fim: 1000, origem: 0 });
        });

        // A's ORIGINAL local .ebgeo summary (before any server interaction).
        const summaryA = await summarize(pageA);
        expect(Object.keys(summaryA.maps).length).toBeGreaterThan(0);

        // Save to server through the UI, then read the connected atlas id.
        await pageA.locator('[data-testid="account-control"] .account-control__identity').click();
        await pageA.locator('[data-testid="account-save-server-btn"]').click();
        await pageA.locator('[data-testid="create-atlas-name"]').fill('Atlas P11');
        await pageA.locator('[data-testid="create-atlas-confirm"]').click();
        await expect(pageA.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 20000 });
        const atlasId = await pageA.evaluate(async () =>
            (await import('/src/js/store/sync/sync-engine.js')).syncEngine.atlasId);
        expect(atlasId).toBeTruthy();

        // A shares the atlas WRITE with B (owner-only route, via A's session).
        await pageA.evaluate(async ({ base, c, id, uid }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(c.username, c.password);
            await fetch(`${base}/api/v1/atlas/${id}/sharing/users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.getAccessToken()}` },
                body: JSON.stringify({ userId: uid, permission: 'write' }),
            });
        }, { base: state.baseUrl, c: users.a, id: atlasId, uid: users.b.id });

        // ---- User B: open the shared atlas from the server, snapshot its .ebgeo. ----
        const pageB = await openClient(browser, state.baseUrl, atlasId, users.b);
        const summaryB = await summarize(pageB);

        // P11: the content must be identical (feature ids preserved; maps keyed by name).
        expect(summaryB.mapNames).toEqual(summaryA.mapNames);
        for (const name of summaryA.mapNames) {
            expect(summaryB.maps[name], `map "${name}" present for B`).toBeTruthy();
            expect(summaryB.maps[name].features, `features of "${name}"`).toEqual(summaryA.maps[name].features);
            expect(summaryB.maps[name].grid, `grid of "${name}"`).toEqual(summaryA.maps[name].grid);
            expect(summaryB.maps[name].temporal, `temporal of "${name}"`).toEqual(summaryA.maps[name].temporal);
            expect(summaryB.maps[name].baseLayer, `baseLayer of "${name}"`).toEqual(summaryA.maps[name].baseLayer);
        }

        await ctxA.close();
        await pageB.context().close();
    });
});

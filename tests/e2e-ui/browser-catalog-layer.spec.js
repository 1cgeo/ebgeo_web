// Path: e2e-ui/browser-catalog-layer.spec.js

/**
 * @fileoverview REAL-browser, REAL-backend Playwright spec for the per-layer
 * `catalogLayer` sync entity. Drives the actual frontend transport modules
 * (api-client / operation-factory), imported live from the Vite dev server INSIDE
 * real Chromium, against the spawned backend. Every assertion is backed by a real
 * HTTP round-trip and observable backend state (the persisted snapshot).
 *
 * Backend behavior under test (src/modules/sync/sync.service.js):
 *   - `catalogLayer` maps to target `catalog_layer`, a per-layer table keyed by the
 *     operation entityId, scoped to a map of the route atlas (cross-atlas IDOR guard).
 *   - create  -> INSERT ... ON CONFLICT DO NOTHING (idempotent by layer id).
 *   - update  -> overwrite the row `data` (reads op.changes ?? op.data; the factory
 *     packs everything into `data`).
 *   - delete  -> soft-delete (`deleted_at`), so the row leaves the snapshot.
 *   - legacy whole-array form: `data.catalog_layers` is an array -> written to the
 *     `maps.catalog_layers` column (does NOT surface in `map.catalogLayers`, which is
 *     fed exclusively by the per-layer table).
 *   - snapshot shape: `map.catalogLayers = [{ id, ...data, sync }]`.
 *
 * Each test creates its OWN user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Provisions a fresh authenticated user + atlas + map inside the page, returning
 * the handles the test needs. Leaves a live, logged-in ApiClient on `window.__cat`
 * so subsequent `page.evaluate` calls can reuse the same token/session.
 *
 * @param {import('@playwright/test').Page} page - The Playwright page (already at '/').
 * @param {string} baseUrl - Backend base URL (without the `/api/v1` suffix).
 * @param {string} tag - Short prefix for the generated username/atlas/map names.
 * @returns {Promise<{ atlasId: string, mapId: string }>} The created atlas and map ids.
 */
function seedAtlasAndMap(page, baseUrl, tag) {
    return page.evaluate(
        async ({ baseUrl, tag }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `${tag}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Catalog E2E' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: `${tag} Atlas` });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__cat = { api };
            return { atlasId: atlas.id, mapId };
        },
        { baseUrl, tag },
    );
}

/**
 * Pulls the persisted snapshot and returns the per-layer `catalogLayers` array for
 * the given map (or `[]` when absent), reading through the SAME shape the frontend
 * consumes.
 *
 * @param {import('@playwright/test').Page} page - The seeded page (has `window.__cat`).
 * @param {{ atlasId: string, mapId: string }} ids - Atlas + map to read.
 * @returns {Promise<Array<Object>>} The map's `catalogLayers` (per-layer entries).
 */
function readCatalogLayers(page, ids) {
    return page.evaluate(async ({ atlasId, mapId }) => {
        const pulled = await window.__cat.api.pullSync(atlasId, 0);
        const maps = (pulled && pulled.snapshot && pulled.snapshot.maps) || [];
        const list = Array.isArray(maps) ? maps : Object.values(maps);
        const map = list.find((m) => m && (m.id === mapId || m.mapId === mapId));
        return (map && map.catalogLayers) || [];
    }, ids);
}

describeOrSkip('Browser catalogLayer (per-layer) sync (real Chromium + real backend)', () => {
    test('create surfaces a per-layer entry in the snapshot with id + data + sync metadata', async ({ page }) => {
        await page.goto('/');
        const ids = await seedAtlasAndMap(page, state.baseUrl, 'catcreate');

        const layerId = await page.evaluate(async ({ atlasId, mapId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const id = crypto.randomUUID();
            await window.__cat.api.pushOperations(atlasId, [
                createOperation('catalogLayer', 'create', id, mapId, {
                    type: 'hillshade',
                    name: 'Hillshade',
                    visible: true,
                    opacity: 0.5,
                }),
            ]);
            return id;
        }, ids);

        const layers = await readCatalogLayers(page, ids);
        const entry = layers.find((l) => l.id === layerId);
        expect(entry).toBeTruthy();
        // Backend spreads the op `data` over the row: { id, ...data, sync }.
        expect(entry.type).toBe('hillshade');
        expect(entry.name).toBe('Hillshade');
        expect(entry.visible).toBe(true);
        expect(entry.opacity).toBe(0.5);
        expect(entry.sync).toBeTruthy();
        expect(typeof entry.sync.version).toBe('number');
    });

    test('update overwrites the per-layer row data (visible/opacity toggled)', async ({ page }) => {
        await page.goto('/');
        const ids = await seedAtlasAndMap(page, state.baseUrl, 'catupdate');

        const layerId = await page.evaluate(async ({ atlasId, mapId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const id = crypto.randomUUID();
            await window.__cat.api.pushOperations(atlasId, [
                createOperation('catalogLayer', 'create', id, mapId, {
                    type: 'hillshade',
                    name: 'Hillshade',
                    visible: false,
                    opacity: 1,
                }),
            ]);
            await window.__cat.api.pushOperations(atlasId, [
                createOperation('catalogLayer', 'update', id, mapId, {
                    type: 'hillshade',
                    name: 'Hillshade Renamed',
                    visible: true,
                    opacity: 0.25,
                }),
            ]);
            return id;
        }, ids);

        const layers = await readCatalogLayers(page, ids);
        const entry = layers.find((l) => l.id === layerId);
        expect(entry).toBeTruthy();
        expect(entry.name).toBe('Hillshade Renamed');
        expect(entry.visible).toBe(true);
        expect(entry.opacity).toBe(0.25);
        // Update bumps the row version (started at 1 on insert).
        expect(entry.sync.version).toBeGreaterThan(1);
    });

    test('delete soft-removes the per-layer entry from the snapshot', async ({ page }) => {
        await page.goto('/');
        const ids = await seedAtlasAndMap(page, state.baseUrl, 'catdelete');

        const layerId = await page.evaluate(async ({ atlasId, mapId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const id = crypto.randomUUID();
            await window.__cat.api.pushOperations(atlasId, [
                createOperation('catalogLayer', 'create', id, mapId, { type: 'hillshade', name: 'Doomed' }),
            ]);
            return id;
        }, ids);

        // Present before delete.
        const before = await readCatalogLayers(page, ids);
        expect(before.some((l) => l.id === layerId)).toBe(true);

        await page.evaluate(
            async ({ atlasId, mapId, layerId }) => {
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                await window.__cat.api.pushOperations(atlasId, [
                    createOperation('catalogLayer', 'delete', layerId, mapId, null),
                ]);
            },
            { ...ids, layerId },
        );

        const after = await readCatalogLayers(page, ids);
        expect(after.some((l) => l.id === layerId)).toBe(false);
    });

    test('create is idempotent by layer id: re-pushing the same id keeps the FIRST data', async ({ page }) => {
        await page.goto('/');
        const ids = await seedAtlasAndMap(page, state.baseUrl, 'catidem');

        const layerId = await page.evaluate(async ({ atlasId, mapId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const id = crypto.randomUUID();
            // First create wins; ON CONFLICT (id) DO NOTHING ignores the second.
            await window.__cat.api.pushOperations(atlasId, [
                createOperation('catalogLayer', 'create', id, mapId, { type: 'hillshade', name: 'Original' }),
            ]);
            await window.__cat.api.pushOperations(atlasId, [
                createOperation('catalogLayer', 'create', id, mapId, { type: 'hillshade', name: 'Clobbered' }),
            ]);
            return id;
        }, ids);

        const layers = await readCatalogLayers(page, ids);
        const matches = layers.filter((l) => l.id === layerId);
        expect(matches).toHaveLength(1);
        expect(matches[0].name).toBe('Original');
    });

    test('legacy whole-array form writes maps.catalog_layers but does NOT surface in per-layer catalogLayers', async ({
        page,
    }) => {
        await page.goto('/');
        const ids = await seedAtlasAndMap(page, state.baseUrl, 'catlegacy');

        // Legacy op: the entityId is the MAP id and the payload is a whole array under
        // `data.catalog_layers`. The backend routes this to the maps.catalog_layers
        // column, which is intentionally separate from the per-layer catalogLayers list.
        const arrayId = await page.evaluate(async ({ atlasId, mapId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const id = crypto.randomUUID();
            await window.__cat.api.pushOperations(atlasId, [
                createOperation('catalogLayer', 'update', mapId, mapId, {
                    catalog_layers: [{ id, type: 'hillshade', name: 'LegacyArrayLayer' }],
                }),
            ]);
            return id;
        }, ids);

        const layers = await readCatalogLayers(page, ids);
        // Edge assertion: the legacy array did NOT create a per-layer row, so the
        // per-layer catalogLayers list stays empty (no leakage between the two stores).
        expect(layers.some((l) => l.id === arrayId)).toBe(false);
        expect(layers).toHaveLength(0);
    });

    test('cross-atlas IDOR guard: a catalogLayer pinned to another atlas’ map is rejected silently', async ({
        page,
    }) => {
        await page.goto('/');
        // Victim atlas (will receive the smuggled op against ITS own atlas id but a
        // FOREIGN mapId) and an attacker atlas owning the real map.
        const victim = await seedAtlasAndMap(page, state.baseUrl, 'catidor_v');

        const foreignMapId = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `catidor_a_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Other' });
            await api.login(username, 'Sup3r-Secret-Pw!');
            const atlas = await api.createAtlas({ name: 'Other Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'Foreign' })]);
            return mapId;
        }, state.baseUrl);

        // The victim user pushes (against victim.atlasId) a catalogLayer create whose
        // mapId belongs to the OTHER atlas. The INSERT's `WHERE EXISTS (map in THIS
        // atlas)` guard makes it a no-op — no row, no error surface in the snapshot.
        const layerId = await page.evaluate(
            async ({ atlasId, foreignMapId }) => {
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                const id = crypto.randomUUID();
                await window.__cat.api.pushOperations(atlasId, [
                    createOperation('catalogLayer', 'create', id, foreignMapId, { type: 'hillshade', name: 'Smuggled' }),
                ]);
                return id;
            },
            { atlasId: victim.atlasId, foreignMapId },
        );

        // It must NOT appear under the victim's own map snapshot.
        const layers = await readCatalogLayers(page, victim);
        expect(layers.some((l) => l.id === layerId)).toBe(false);
    });
});

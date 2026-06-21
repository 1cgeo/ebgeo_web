// Path: e2e-ui/browser-layer-ops.spec.js

/**
 * @fileoverview Browser-level layer CRUD against the REAL backend. Drives the REAL
 * frontend transport modules (api-client / operation-factory) imported live from the
 * Vite dev server INSIDE real Chromium, making genuine HTTP round-trips and asserting
 * the persisted snapshot's `map.layers` reflects every layer mutation.
 *
 * Layer ops travel as CRDT sync operations (there is no REST write route for layers).
 * The backend persists a layer row per `layer` `create` op and exposes it in the
 * snapshot as `{ id, name, visible, locked, opacity, order, style, version }`
 * (`sort_order` is renamed to `order` for the frozen frontend contract). This spec
 * proves create / update(visible, locked, opacity, order) / delete each land, plus the
 * §2.2 cascade where deleting a layer soft-deletes its child features (so they vanish
 * from the snapshot).
 *
 * Each test provisions its OWN user + atlas + map for isolation. No UI is clicked; the
 * transport is exercised purely through `page.evaluate`, so no `data-testid` is needed.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Seeds a fresh authenticated session with a new atlas + map inside the page, exposing
 * the live `ApiClient`/`createOperation` on `window.__layer` for follow-up evaluations.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl - Backend origin (without the `/api/v1` suffix).
 * @param {string} tag - Short label used to namespace the generated username.
 * @returns {Promise<{ atlasId: string, mapId: string }>}
 */
function seedSession(page, baseUrl, tag) {
    return page.evaluate(
        async ({ baseUrl: url, tag: t }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${url}/api/v1` });
            const username = `${t}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Layer Ops' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Layer Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            // Stash the live transport so later page.evaluate calls reuse the session.
            window.__layer = { api, createOperation, atlasId: atlas.id, mapId };
            return { atlasId: atlas.id, mapId };
        },
        { baseUrl, tag },
    );
}

/**
 * Pulls the snapshot and returns the layer (frontend shape) for `layerId`, or null.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} layerId
 * @returns {Promise<Object|null>}
 */
function readLayer(page, layerId) {
    return page.evaluate(async (id) => {
        const { api, atlasId, mapId } = window.__layer;
        const pulled = await api.pullSync(atlasId, 0);
        const maps = pulled.snapshot?.maps || [];
        const map = maps.find((m) => m.id === mapId || m.mapId === mapId);
        const layers = map?.layers || [];
        return layers.find((l) => l.id === id) || null;
    }, layerId);
}

describeOrSkip('Layer CRUD (real Chromium + real backend, snapshot-verified)', () => {
    test('create a layer; the snapshot exposes it with the contract shape', async ({ page }) => {
        await page.goto('/');
        await seedSession(page, state.baseUrl, 'lyr_create');

        const layerId = await page.evaluate(async () => {
            const { api, createOperation, atlasId, mapId } = window.__layer;
            const id = crypto.randomUUID();
            await api.pushOperations(atlasId, [
                createOperation('layer', 'create', id, mapId, {
                    name: 'Roads',
                    visible: true,
                    locked: false,
                    opacity: 0.8,
                    order: 2,
                    style: { color: '#ff0000' },
                }),
            ]);
            return id;
        });

        const layer = await readLayer(page, layerId);
        expect(layer).not.toBeNull();
        expect(layer.id).toBe(layerId);
        expect(layer.name).toBe('Roads');
        expect(layer.visible).toBe(true);
        expect(layer.locked).toBe(false);
        expect(layer.opacity).toBe(0.8);
        // `sort_order` is renamed to `order` for the frozen frontend contract.
        expect(layer.order).toBe(2);
        expect(layer.style).toEqual({ color: '#ff0000' });
    });

    test('update visible / locked / opacity / order each round-trip into the snapshot', async ({ page }) => {
        await page.goto('/');
        await seedSession(page, state.baseUrl, 'lyr_update');

        const layerId = await page.evaluate(async () => {
            const { api, createOperation, atlasId, mapId } = window.__layer;
            const id = crypto.randomUUID();
            await api.pushOperations(atlasId, [
                createOperation('layer', 'create', id, mapId, {
                    name: 'Edits',
                    visible: true,
                    locked: false,
                    opacity: 1,
                    order: 0,
                }),
            ]);
            return id;
        });

        const before = await readLayer(page, layerId);
        expect(before).not.toBeNull();
        const versionBefore = before.version;

        // The frontend factory always puts the payload in `data`; the backend maps it
        // onto the update path and resolves the `order` -> `sort_order` alias.
        await page.evaluate(async (id) => {
            const { api, createOperation, atlasId, mapId } = window.__layer;
            await api.pushOperations(atlasId, [
                createOperation('layer', 'update', id, mapId, {
                    visible: false,
                    locked: true,
                    opacity: 0.25,
                    order: 7,
                }),
            ]);
        }, layerId);

        const after = await readLayer(page, layerId);
        expect(after).not.toBeNull();
        expect(after.visible).toBe(false);
        expect(after.locked).toBe(true);
        expect(after.opacity).toBe(0.25);
        expect(after.order).toBe(7);
        // Name was NOT in the update payload: it must be untouched.
        expect(after.name).toBe('Edits');
        // Every applied update bumps the row version.
        expect(after.version).toBeGreaterThan(versionBefore);
    });

    test('delete a layer; it disappears from the snapshot and cascades to its features', async ({ page }) => {
        await page.goto('/');
        await seedSession(page, state.baseUrl, 'lyr_delete');

        // Create a layer plus a feature that belongs to it (layerId in properties).
        const ids = await page.evaluate(async () => {
            const { api, createOperation, atlasId, mapId } = window.__layer;
            const layerId = crypto.randomUUID();
            const featureId = crypto.randomUUID();
            await api.pushOperations(atlasId, [
                createOperation('layer', 'create', layerId, mapId, { name: 'Doomed', order: 0 }),
            ]);
            await api.pushOperations(atlasId, [
                createOperation('feature', 'create', featureId, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id: featureId, source: 'point', layerId },
                }),
            ]);
            return { layerId, featureId };
        });

        // Sanity: the layer and its child feature exist before the delete.
        const present = await page.evaluate(async ({ layerId, featureId }) => {
            const { api, atlasId, mapId } = window.__layer;
            const pulled = await api.pullSync(atlasId, 0);
            const map = (pulled.snapshot?.maps || []).find((m) => m.id === mapId || m.mapId === mapId);
            const hasLayer = (map?.layers || []).some((l) => l.id === layerId);
            const points = map?.features?.points || [];
            const hasFeature = points.some((p) => p.properties.id === featureId);
            return { hasLayer, hasFeature };
        }, ids);
        expect(present.hasLayer).toBe(true);
        expect(present.hasFeature).toBe(true);

        await page.evaluate(async (layerId) => {
            const { api, createOperation, atlasId, mapId } = window.__layer;
            await api.pushOperations(atlasId, [createOperation('layer', 'delete', layerId, mapId, null)]);
        }, ids.layerId);

        // The layer is gone AND its child feature was soft-deleted by the §2.2 cascade.
        const gone = await page.evaluate(async ({ layerId, featureId }) => {
            const { api, atlasId, mapId } = window.__layer;
            const pulled = await api.pullSync(atlasId, 0);
            const map = (pulled.snapshot?.maps || []).find((m) => m.id === mapId || m.mapId === mapId);
            const hasLayer = (map?.layers || []).some((l) => l.id === layerId);
            const points = map?.features?.points || [];
            const hasFeature = points.some((p) => p.properties.id === featureId);
            return { hasLayer, hasFeature };
        }, ids);
        expect(gone.hasLayer).toBe(false);
        expect(gone.hasFeature).toBe(false);
    });

    test('idempotency: re-pushing the same create op id does not duplicate the layer', async ({ page }) => {
        await page.goto('/');
        await seedSession(page, state.baseUrl, 'lyr_idem');

        const layerId = await page.evaluate(async () => {
            const { api, createOperation, atlasId, mapId } = window.__layer;
            const id = crypto.randomUUID();
            const op = createOperation('layer', 'create', id, mapId, { name: 'Once', order: 1 });
            // Push the SAME operation object (same op id) twice; ON CONFLICT DO NOTHING
            // must make the second push a no-op rather than a duplicate row.
            await api.pushOperations(atlasId, [op]);
            await api.pushOperations(atlasId, [op]);
            return id;
        });

        const count = await page.evaluate(async (id) => {
            const { api, atlasId, mapId } = window.__layer;
            const pulled = await api.pullSync(atlasId, 0);
            const map = (pulled.snapshot?.maps || []).find((m) => m.id === mapId || m.mapId === mapId);
            return (map?.layers || []).filter((l) => l.id === id).length;
        }, layerId);
        expect(count).toBe(1);
    });
});

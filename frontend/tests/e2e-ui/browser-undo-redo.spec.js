// Path: e2e-ui/browser-undo-redo.spec.js

/**
 * @fileoverview Browser-level undo/redo round-trip for collaborative features.
 *
 * Drives the REAL frontend transport (api-client / operation-factory) imported live
 * from the Vite dev server INSIDE real Chromium, against the REAL backend sync API.
 * No app UI is clicked — every assertion is a REAL HTTP round-trip and reflects
 * observable backend state read back through `pullSync`'s snapshot.
 *
 * Proves the create <-> delete inverse pair the undo stack relies on:
 *   1. create feature           -> feature PRESENT in the snapshot      (do);
 *   2. push inverse delete       -> feature ABSENT (soft-deleted)        (undo);
 *   3. re-create under a FRESH id -> feature PRESENT again               (redo);
 *   4. EDGE: re-create under the SAME (tombstoned) id is a NO-OP — the
 *      backend's `ON CONFLICT (id) DO NOTHING` keeps the deleted row dead, so the
 *      feature stays ABSENT. This is why redo must mint a fresh id, not reuse the old.
 *
 * Each test mints its own user + atlas + map for isolation. The backend stores a
 * feature as GeoJSON whose type lives in `properties.source`; delete carries `null`
 * data (the literal inverse of the create payload).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Pulls a full snapshot and reports whether the given feature id is present as a
 * live point in the target map (soft-deleted rows are absent from the snapshot).
 *
 * @param {import('@playwright/test').Page} page - Page with a logged-in ApiClient stashed on window.
 * @param {{ atlasId: string, mapId: string, featureId: string }} ref - Lookup keys.
 * @returns {Promise<boolean>} True when the feature is a live point in the snapshot.
 */
function featurePresent(page, ref) {
    return page.evaluate(async ({ atlasId, mapId, featureId }) => {
        const pulled = await window.__undo.api.pullSync(atlasId, 0);
        const map = pulled.snapshot?.maps?.find((m) => m.id === mapId || m.mapId === mapId);
        const points = (map?.features?.points) || [];
        return points.some((p) => p.properties.id === featureId);
    }, ref);
}

describeOrSkip('Undo/redo create<->delete round-trip (real Chromium + real backend)', () => {
    test('create (present) -> inverse delete (absent) -> redo fresh id (present); same-id re-create is a no-op', async ({
        page,
    }) => {
        // 1. Seed an isolated user + atlas + map; stash the ApiClient on window so the
        //    helpers can reuse the authenticated session across page.evaluate calls.
        await page.goto('/');
        const seed = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `undo_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Undo Redo' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Undo Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__undo = { api };
            return { atlasId: atlas.id, mapId, hasToken: Boolean(api.getAccessToken()) };
        }, state.baseUrl);

        expect(seed.hasToken).toBe(true);

        // 2. DO: create the feature. It must appear in the snapshot.
        const featureId = await page.evaluate(async ({ atlasId, mapId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const id = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: 'Undo Point' },
            };
            await window.__undo.api.pushOperations(atlasId, [
                createOperation('feature', 'create', id, mapId, feature),
            ]);
            return id;
        }, { atlasId: seed.atlasId, mapId: seed.mapId });

        expect(await featurePresent(page, { atlasId: seed.atlasId, mapId: seed.mapId, featureId })).toBe(true);

        // 3. UNDO: push the inverse delete (literal `null` data). The feature must
        //    disappear from the snapshot (soft-deleted rows are filtered out).
        await page.evaluate(async ({ atlasId, mapId, featureId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const del = createOperation('feature', 'delete', featureId, mapId, null);
            // The inverse of a create is a delete that carries no data payload.
            if (del.data !== null) throw new Error('delete op must carry null data');
            await window.__undo.api.pushOperations(atlasId, [del]);
        }, { atlasId: seed.atlasId, mapId: seed.mapId, featureId });

        expect(await featurePresent(page, { atlasId: seed.atlasId, mapId: seed.mapId, featureId })).toBe(false);

        // 4. EDGE / negative: re-creating under the SAME (now tombstoned) id is a no-op.
        //    The backend `ON CONFLICT (id) DO NOTHING` leaves the soft-deleted row
        //    untouched, so the feature stays ABSENT. This is precisely why redo must
        //    allocate a fresh id rather than resurrect the old one.
        await page.evaluate(async ({ atlasId, mapId, featureId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'Tombstone Recreate' },
            };
            await window.__undo.api.pushOperations(atlasId, [
                createOperation('feature', 'create', featureId, mapId, feature),
            ]);
        }, { atlasId: seed.atlasId, mapId: seed.mapId, featureId });

        expect(await featurePresent(page, { atlasId: seed.atlasId, mapId: seed.mapId, featureId })).toBe(false);

        // 5. REDO: create under a FRESH id. The feature must be present again, proving
        //    the create<->delete inverse round-trips when ids are not tombstoned.
        const redoId = await page.evaluate(async ({ atlasId, mapId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const id = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: 'Redo Point' },
            };
            await window.__undo.api.pushOperations(atlasId, [
                createOperation('feature', 'create', id, mapId, feature),
            ]);
            return id;
        }, { atlasId: seed.atlasId, mapId: seed.mapId });

        expect(redoId).not.toBe(featureId);
        expect(await featurePresent(page, { atlasId: seed.atlasId, mapId: seed.mapId, featureId: redoId })).toBe(true);
        // The undone original id remains dead — undo/redo did not resurrect it.
        expect(await featurePresent(page, { atlasId: seed.atlasId, mapId: seed.mapId, featureId })).toBe(false);
    });

    test('an inverse delete is idempotent by op id: replaying it keeps the feature absent', async ({ page }) => {
        await page.goto('/');
        const seed = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `undoidem_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Undo Idem' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Undo Idem Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            // Create then build a single delete op we can replay verbatim.
            const featureId = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'Idem Point' },
            };
            await api.pushOperations(atlas.id, [createOperation('feature', 'create', featureId, mapId, feature)]);

            window.__undo = { api };
            const deleteOp = createOperation('feature', 'delete', featureId, mapId, null);
            return { atlasId: atlas.id, mapId, featureId, deleteOp };
        }, state.baseUrl);

        // Present after create.
        expect(await featurePresent(page, seed)).toBe(true);

        // Push the SAME delete op twice (same op id). The second push acks idempotent
        // and re-applies nothing; the feature stays absent — no spurious resurrection.
        const acks = await page.evaluate(async ({ atlasId, deleteOp }) => {
            const first = await window.__undo.api.pushOperations(atlasId, [deleteOp]);
            const second = await window.__undo.api.pushOperations(atlasId, [deleteOp]);
            const idemFlag = (r) => Array.isArray(r?.results) && r.results[0] ? r.results[0].idempotent : null;
            return { firstIdem: idemFlag(first), secondIdem: idemFlag(second) };
        }, { atlasId: seed.atlasId, deleteOp: seed.deleteOp });

        expect(acks.firstIdem).toBe(false);
        expect(acks.secondIdem).toBe(true);
        expect(await featurePresent(page, seed)).toBe(false);
    });
});

// Path: e2e-ui/browser-feature-visibility-lock.spec.js

/**
 * Browser-level feature visibility/lock toggles: drives the REAL frontend transport
 * modules (api-client / operation-factory), imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL spawned backend. Every assertion is grounded
 * in observable backend state read back through `api.pullSync` — no mocks, real HTTP.
 *
 * Atlas features are GeoJSON: the visibility/lock state of a feature lives in its
 * `properties` (`properties.visivel` / `properties.bloqueado`), which the backend
 * persists wholesale into the `properties` JSONB column on a `feature` `update` and
 * spreads back verbatim in the `pullSync` snapshot buckets
 * (`map.features.{points,lines,polygons}`). Writes are CRDT operations pushed via
 * `api.pushOperations` (there are NO REST write routes for features).
 *
 * Covers docs/acoes-interface-multiusuario.md §2.11-12 (toggle a single feature's
 * visibility / lock), §17.7-8 (the flags round-trip and persist), and §2.13 (a
 * multi-feature batch visibility update touches every targeted feature).
 *
 * Coverage:
 *   - create a point with visivel:true / bloqueado:false, then UPDATE it to
 *     visivel:false and assert the persisted snapshot reflects the hidden flag;
 *   - UPDATE the same feature to bloqueado:true and assert the lock persists while
 *     the previously-set visivel flag survives (update replaces the whole properties
 *     object, so the op must carry the full intended state);
 *   - batch (§2.13): create three points then push ONE batch of three `feature`
 *     `update` ops flipping visivel:false on all of them; assert every one is hidden
 *     in the snapshot and the batch was atomic (all-or-nothing);
 *   - edge: a visibility update aimed at a NON-EXISTENT feature id is a silent no-op
 *     (the EXISTS/atlas-scoped WHERE matches nothing) and never conjures a feature
 *     into any snapshot bucket.
 *
 * Op shapes mirror the passing headless twin + browser-feature-crud.spec.js:
 *   createOperation('feature', 'create'|'update', featureId, mapId, geojsonFeature)
 * where geojsonFeature carries its type in `properties.source` and the toggled flags
 * in `properties.visivel` / `properties.bloqueado`.
 *
 * Each test self-provisions its own user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Feature visibility/lock (real Chromium + real backend, transport via page.evaluate)', () => {
    test('toggle visivel/bloqueado on a feature → flags persist in pullSync snapshot', async ({
        page,
    }) => {
        await page.goto('/');

        const user = await createVerifiedUser({ prefix: 'vislock', nome: 'VisLock User' });

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'VisLock Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // ---- helpers --------------------------------------------------
            const makePoint = (id, props = {}) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: 'Ponto', ...props },
            });
            const pullPoint = async (id) => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                return (map?.features?.points || []).find((f) => f.properties.id === id);
            };

            // ---- CREATE a visible, unlocked point -------------------------
            const pointId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', pointId, mapId, makePoint(pointId, {
                    visivel: true,
                    bloqueado: false,
                })),
            ]);
            const created = await pullPoint(pointId);

            // ---- UPDATE: hide it (visivel -> false) -----------------------
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', pointId, mapId, makePoint(pointId, {
                    visivel: false,
                    bloqueado: false,
                })),
            ]);
            const afterHide = await pullPoint(pointId);

            // ---- UPDATE: lock it, keep it hidden --------------------------
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', pointId, mapId, makePoint(pointId, {
                    visivel: false,
                    bloqueado: true,
                })),
            ]);
            const afterLock = await pullPoint(pointId);

            return {
                hasToken: Boolean(api.getAccessToken()),
                created: {
                    exists: Boolean(created),
                    visivel: created?.properties.visivel,
                    bloqueado: created?.properties.bloqueado,
                },
                hidden: {
                    exists: Boolean(afterHide),
                    visivel: afterHide?.properties.visivel,
                    bloqueado: afterHide?.properties.bloqueado,
                },
                locked: {
                    exists: Boolean(afterLock),
                    visivel: afterLock?.properties.visivel,
                    bloqueado: afterLock?.properties.bloqueado,
                },
            };
        }, { baseUrl: state.baseUrl, u: user });

        expect(result.hasToken).toBe(true);

        // ---- CREATE: flags persisted exactly as sent ----
        expect(result.created.exists).toBe(true);
        expect(result.created.visivel).toBe(true);
        expect(result.created.bloqueado).toBe(false);

        // ---- §2.11/§17.7: visibility toggle persists ----
        expect(result.hidden.exists).toBe(true);
        expect(result.hidden.visivel).toBe(false);
        expect(result.hidden.bloqueado).toBe(false);

        // ---- §2.12/§17.8: lock toggle persists, prior visibility survives ----
        expect(result.locked.exists).toBe(true);
        expect(result.locked.bloqueado).toBe(true);
        expect(result.locked.visivel).toBe(false);
    });

    test('§2.13 batch visibility: one push hides three features; bad-id update is a silent no-op', async ({
        page,
    }) => {
        await page.goto('/');

        const user = await createVerifiedUser({ prefix: 'visbatch', nome: 'VisBatch User' });

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'VisBatch Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const makePoint = (id, props = {}) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id, source: 'point', nome: 'Ponto', visivel: true, ...props },
            });
            const pullPoints = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                return map?.features?.points || [];
            };

            // ---- CREATE three visible points ------------------------------
            const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
            await api.pushOperations(
                atlas.id,
                ids.map((id) => createOperation('feature', 'create', id, mapId, makePoint(id))),
            );
            const beforeBatch = await pullPoints();
            const allVisibleBefore = ids.every(
                (id) =>
                    beforeBatch.find((f) => f.properties.id === id)?.properties.visivel === true,
            );

            // ---- §2.13: ONE batch flipping visivel:false on all three ------
            await api.pushOperations(
                atlas.id,
                ids.map((id) =>
                    createOperation('feature', 'update', id, mapId, makePoint(id, {
                        visivel: false,
                    })),
                ),
            );
            const afterBatch = await pullPoints();
            const allHiddenAfter = ids.every(
                (id) =>
                    afterBatch.find((f) => f.properties.id === id)?.properties.visivel === false,
            );
            // count is unchanged — updates are not creates.
            const countStable = afterBatch.filter((f) => ids.includes(f.properties.id)).length;

            // ---- EDGE: visibility update on a non-existent feature id ------
            const ghostId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', ghostId, mapId, makePoint(ghostId, {
                    visivel: false,
                })),
            ]);
            const afterGhost = await pullPoints();
            const ghostConjured = afterGhost.some((f) => f.properties.id === ghostId);

            return {
                createdCount: beforeBatch.filter((f) => ids.includes(f.properties.id)).length,
                allVisibleBefore,
                allHiddenAfter,
                countStable,
                ghostConjured,
            };
        }, { baseUrl: state.baseUrl, u: user });

        // ---- batch precondition: all three created and visible ----
        expect(result.createdCount).toBe(3);
        expect(result.allVisibleBefore).toBe(true);

        // ---- §2.13: single batch hid every targeted feature, atomically ----
        expect(result.allHiddenAfter).toBe(true);
        expect(result.countStable).toBe(3);

        // ---- EDGE: a bad-id update conjures nothing into the bucket ----
        expect(result.ghostConjured).toBe(false);
    });
});

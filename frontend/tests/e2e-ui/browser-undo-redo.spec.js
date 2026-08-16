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
 *   1. create feature             -> feature PRESENT in the snapshot     (do);
 *   2. push inverse delete        -> feature ABSENT (soft-deleted)       (undo);
 *   3. re-create under the SAME id -> feature PRESENT again              (redo);
 *   4. re-create under a FRESH id -> that one is present too, independently.
 *
 * STEP 3 REVERSED, AND THE OLD ASSERTIONS WERE TROCADAS, NEVER SOMADAS. Until 2026-08-16
 * this file asserted the opposite: that a re-create under a tombstoned id was a NO-OP, so
 * "redo must mint a fresh id, not reuse the old". That was true of the backend when it was
 * written and stopped being true on 2026-07-19, when RESURRECT-ON-CREATE was decided
 * (`backend/src/modules/sync/sync.service.js`, the `case 'create'` comment). The reason is
 * exactly this gesture: the client's undo of a delete replays the ORIGINAL entity WITH its
 * original id, so `DO NOTHING` acked a silent no-op — the feature stayed alive on the
 * client, dead on the server, and died locally at the next snapshot. Permanent data loss in
 * the most common gesture of the product.
 *
 * The guard that keeps resurrection honest is asserted here too: only TOMBSTONES revive. A
 * replayed create against a LIVE row must not clobber it, which is what the
 * `WHERE features.deleted_at IS NOT NULL` clause buys.
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
    test('create -> inverse delete -> redo under the SAME id resurrects it; a live row is never clobbered', async ({
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

        // 4. REDO, the real gesture: the undo stack replays the ORIGINAL entity, id and all.
        //    The backend resurrects the tombstone instead of acking a silent no-op.
        await page.evaluate(async ({ atlasId, mapId, featureId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'Ressuscitado' },
            };
            await window.__undo.api.pushOperations(atlasId, [
                createOperation('feature', 'create', featureId, mapId, feature),
            ]);
        }, { atlasId: seed.atlasId, mapId: seed.mapId, featureId });

        expect(
            await featurePresent(page, { atlasId: seed.atlasId, mapId: seed.mapId, featureId }),
            'Ctrl+Z depois de apagar tem de trazer a feicao de volta, com o id original',
        ).toBe(true);

        // 4b. THE GUARD ON THE RESURRECTION: only a TOMBSTONE revives. A replayed create
        //     against the now-LIVE row must not clobber it with the stale payload, which is
        //     what `WHERE features.deleted_at IS NOT NULL` buys. Without this assertion the
        //     case above would pass just as well against an unconditional upsert, and a
        //     stale replay would silently overwrite newer edits.
        const nameAfterStaleReplay = await page.evaluate(async ({ atlasId, mapId, featureId }) => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            await window.__undo.api.pushOperations(atlasId, [
                createOperation('feature', 'create', featureId, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                    properties: { id: featureId, source: 'point', nome: 'Replay Obsoleto' },
                }),
            ]);
            const pulled = await window.__undo.api.pullSync(atlasId, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId || m.mapId === mapId);
            const hit = (map?.features?.points || []).find((p) => p.properties.id === featureId);
            return hit?.properties?.nome ?? null;
        }, { atlasId: seed.atlasId, mapId: seed.mapId, featureId });

        expect(
            nameAfterStaleReplay,
            'um create repetido contra linha VIVA nao pode sobrescrever o dado corrente',
        ).toBe('Ressuscitado');

        // 5. A create under a FRESH id lands independently, which is what keeps step 4
        //    from being satisfied by "every create in this map produces a live point".
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

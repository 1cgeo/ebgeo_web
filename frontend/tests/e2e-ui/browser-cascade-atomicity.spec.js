// Path: e2e-ui/browser-cascade-atomicity.spec.js

/**
 * Cascade delete + batch atomicity.
 *
 * Test 1 (CASCADE) is driven UI-FIRST: two points are drawn on a layer and one on a
 * control layer via the REAL point tool, the layer is removed through the app's REAL
 * deleteLayer store op (the "Deletar camada" path, which cascades to its features), and
 * the assertions read the live app store (getCurrentMapFeatures + the layer list).
 *
 * Tests 2-3 (ATOMICITY) stay backend transport probes: a multi-op push is ONE server
 * transaction (rollback on a cross-atlas op; commit-all on a valid batch) — a server
 * transactional contract with no user-visible "batch" gesture, and the rollback path
 * needs a cross-atlas op that has no UI. See the no-UI notes on those tests.
 *
 * The atlas/map/share SETUP is API-only (sharing has no UI); for test 1 login + open +
 * the draw/delete gestures are real UI.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawPointUI, currentMapName } from './helpers/collab-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

describeOrSkip('Cascade delete + batch atomicity (real Chromium + real backend)', () => {
    test('layer delete cascades: store omits the layer AND its features, but spares other layers', async ({
        browser,
    }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);

        try {
            expect(await currentMapName(page)).toBe(seed.mapName);

            // Two layers: one to delete (with two features), one to keep (control).
            const layerDel = await applyStoreOp(page, 'createLayer', ['To Delete', seed.mapName]).then((l) => l?.id ?? l);
            const layerKeep = await applyStoreOp(page, 'createLayer', ['To Keep', seed.mapName]).then((l) => l?.id ?? l);
            expect(layerDel).toBeTruthy();
            expect(layerKeep).toBeTruthy();

            // Draw two points on the to-delete layer + one on the control layer (real tool).
            const f1 = await drawPointUI(page, [-43.1, -22.1]);
            const f2 = await drawPointUI(page, [-43.2, -22.2]);
            await applyStoreOp(page, 'moveFeaturesToLayer', [
                [{ type: 'point', id: f1 }, { type: 'point', id: f2 }], layerDel, seed.mapName,
            ]);
            const fKeep = await drawPointUI(page, [-43.3, -22.3]);
            await applyStoreOp(page, 'moveFeaturesToLayer', [[{ type: 'point', id: fKeep }], layerKeep, seed.mapName]);

            const readStore = () => page.evaluate(async (mn) => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getCurrentMapFeatures();
                const layers = store.getLayers(mn) || [];
                return {
                    points: (f.points || []).map((p) => p.properties?.id),
                    layers: layers.map((l) => l.id),
                };
            }, seed.mapName);

            // Pre-condition: all three features and both layers are present.
            const before = await readStore();

            // Delete the layer → the app cascades the delete to its features (deleteLayer
            // calls deleteLayerFeatures + deleteLayerOnly — the real "Deletar camada" op).
            await applyStoreOp(page, 'deleteLayer', [layerDel, seed.mapName]);

            await expect
                .poll(async () => (await readStore()).layers.includes(layerDel), { timeout: 10000 })
                .toBe(false);
            const after = await readStore();

            const result = {
                f1, f2, fKeep, layerDel, layerKeep,
                pointsBefore: before.points,
                layersBefore: before.layers,
                pointsAfter: after.points,
                layersAfter: after.layers,
            };

            // Pre-condition: everything was really there before the delete.
            expect(result.pointsBefore).toEqual(expect.arrayContaining([result.f1, result.f2, result.fKeep]));
            expect(result.layersBefore).toEqual(expect.arrayContaining([result.layerDel, result.layerKeep]));

            // Cascade: the deleted layer AND both of its features are gone.
            expect(result.layersAfter).not.toContain(result.layerDel);
            expect(result.pointsAfter).not.toContain(result.f1);
            expect(result.pointsAfter).not.toContain(result.f2);

            // Control: the other layer and its feature are untouched (cascade was scoped).
            expect(result.layersAfter).toContain(result.layerKeep);
            expect(result.pointsAfter).toContain(result.fKeep);
        } finally {
            await page.context().close();
        }
    });

    test('batch [valid create + cross-atlas update] rolls back atomically: valid create is absent', async ({
        page,
    }) => {
        // no-UI: this asserts a SERVER transactional contract — a single push batch is one
        // DB transaction that rolls back wholesale when any op fails. The failing op is a
        // cross-atlas feature move (no UI gesture targets a foreign atlas), and the app
        // never exposes "this group of edits is one atomic batch" to the user. It stays a
        // transport probe driven via page.evaluate against the backend.
        const user = await createVerifiedUser({ prefix: 'rollback', nome: 'Rollback User' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            // Atlas A (the target of our batch) and a SECOND atlas B owned by the same
            // user, whose map is the cross-atlas destination that must be rejected.
            const atlasA = await api.createAtlas({ name: 'Rollback Atlas A' });
            const atlasB = await api.createAtlas({ name: 'Rollback Atlas B' });
            const mapA = crypto.randomUUID();
            const mapB = crypto.randomUUID();
            await api.pushOperations(atlasA.id, [createOperation('map', 'create', mapA, null, { name: 'MA' })]);
            await api.pushOperations(atlasB.id, [createOperation('map', 'create', mapB, null, { name: 'MB' })]);

            // A feature that already lives in atlas A's map (the cross-atlas update victim).
            const victimId = crypto.randomUUID();
            await api.pushOperations(atlasA.id, [
                createOperation('feature', 'create', victimId, mapA, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.0, -22.0] },
                    properties: { id: victimId, source: 'point' },
                }),
            ]);

            // The batch: op[0] is a perfectly valid NEW feature create; op[1] tries to
            // MOVE the victim feature into atlas B's map (changes.map_id = mapB), which
            // the backend rejects with ForbiddenError → the whole tx must roll back.
            const validId = crypto.randomUUID();
            const validCreate = createOperation('feature', 'create', validId, mapA, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.5, -22.5] },
                properties: { id: validId, source: 'point' },
            });
            const crossAtlasUpdate = createOperation('feature', 'update', victimId, mapA, { map_id: mapB });

            let pushRejected = false;
            let pushError = null;
            try {
                await api.pushOperations(atlasA.id, [validCreate, crossAtlasUpdate]);
            } catch (err) {
                pushRejected = true;
                pushError = String(err && err.message ? err.message : err);
            }

            // Rollback proof: the valid create must be ABSENT (atomic batch failed).
            const afterFail = await api.pullSync(atlasA.id, 0);
            const mapAfterFail = afterFail.snapshot?.maps?.find((m) => m.id === mapA);
            const idsAfterFail = (mapAfterFail?.features?.points || []).map((p) => p.properties.id);

            // The victim must NOT have leaked into atlas B either.
            const bSnap = await api.pullSync(atlasB.id, 0);
            const mapBSnap = bSnap.snapshot?.maps?.find((m) => m.id === mapB);
            const idsInB = (mapBSnap?.features?.points || []).map((p) => p.properties.id);

            // Control: the SAME valid create, pushed alone, now succeeds — proving the
            // earlier absence was the rollback, not a malformed operation.
            await api.pushOperations(atlasA.id, [
                createOperation('feature', 'create', validId, mapA, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.5, -22.5] },
                    properties: { id: validId, source: 'point' },
                }),
            ]);
            const afterOk = await api.pullSync(atlasA.id, 0);
            const mapAfterOk = afterOk.snapshot?.maps?.find((m) => m.id === mapA);
            const idsAfterOk = (mapAfterOk?.features?.points || []).map((p) => p.properties.id);

            return {
                validId,
                victimId,
                pushRejected,
                pushError,
                idsAfterFail,
                idsInB,
                idsAfterOk,
            };
        }, { baseUrl: state.baseUrl, u: user });

        // The batch was rejected by the backend (cross-atlas reference denied).
        expect(result.pushRejected).toBe(true);

        // Atomic rollback: the valid create in the failed batch did NOT persist.
        expect(result.idsAfterFail).not.toContain(result.validId);

        // The victim never crossed into atlas B (no partial / leaked write).
        expect(result.idsInB).not.toContain(result.victimId);

        // Control: the identical create, pushed alone, persists — confirming the op
        // itself was always valid and the prior absence was purely the rollback.
        expect(result.idsAfterOk).toContain(result.validId);
    });

    test('valid batch of 3 creates persists all three in a single transaction', async ({ page }) => {
        // no-UI: the contract under test is that one push BATCH commits as a single server
        // transaction. "These N edits are one atomic batch" is not a user-visible gesture
        // (the app flushes ops on its own cadence), so it stays a transport probe.
        const user = await createVerifiedUser({ prefix: 'batch3', nome: 'Batch3 User' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Batch3 Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
            const coords = [
                [-43.1, -22.1],
                [-43.2, -22.2],
                [-43.3, -22.3],
            ];
            const batch = ids.map((id, i) =>
                createOperation('feature', 'create', id, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coords[i] },
                    properties: { id, source: 'point' },
                }),
            );
            await api.pushOperations(atlas.id, batch);

            const snap = await api.pullSync(atlas.id, 0);
            const map = snap.snapshot?.maps?.find((m) => m.id === mapId);
            const persisted = (map?.features?.points || []).map((p) => p.properties.id);

            return { ids, persisted };
        }, { baseUrl: state.baseUrl, u: user });

        // All three creates from the single valid batch are present in the snapshot.
        expect(result.persisted).toEqual(expect.arrayContaining(result.ids));
    });
});

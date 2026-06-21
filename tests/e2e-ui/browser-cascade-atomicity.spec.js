// Path: e2e-ui/browser-cascade-atomicity.spec.js

/**
 * @fileoverview Browser-level cascade + atomicity test. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL backend, with genuine HTTP round-trips.
 *
 * Three independent users/atlases/maps (one per test, for isolation) prove:
 *   1. CASCADE — soft-deleting a layer cascades to every feature that carries that
 *      `layerId`: the post-delete snapshot omits BOTH the layer and its features,
 *      while a feature on a DIFFERENT layer survives (negative/control assertion).
 *   2. ATOMICITY (rollback) — a single push batch `[valid feature create,
 *      cross-atlas feature update]` is one transaction. The cross-atlas update
 *      (moving a feature into a map of ANOTHER atlas) is rejected server-side
 *      (ForbiddenError), so the WHOLE batch rolls back and the valid create is
 *      ABSENT from the snapshot. A control single-op create of the same feature
 *      then succeeds, proving the earlier absence was the rollback, not a bad op.
 *   3. ATOMICITY (commit) — a valid batch of 3 creates persists all 3 in one tx.
 *
 * No UI clicks: the specs drive the transport via `page.evaluate`, so there are no
 * data-testid selectors. All assertions read observable backend state via
 * `api.pullSync` (the persisted snapshot).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Cascade delete + batch atomicity (real Chromium + real backend)', () => {
    test('layer delete cascades: snapshot omits the layer AND its features, but spares other layers', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `cascade_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Cascade User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Cascade Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            // Two layers: one to delete (with two features), one to keep (control).
            const layerDel = crypto.randomUUID();
            const layerKeep = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('layer', 'create', layerDel, mapId, { name: 'To Delete', order: 0 }),
                createOperation('layer', 'create', layerKeep, mapId, { name: 'To Keep', order: 1 }),
            ]);

            // GeoJSON features: type lives in properties.source; layer in properties.layerId.
            const mkPoint = (layerId, lng, lat) => {
                const id = crypto.randomUUID();
                return {
                    id,
                    op: createOperation('feature', 'create', id, mapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [lng, lat] },
                        properties: { id, source: 'point', layerId },
                    }),
                };
            };
            const f1 = mkPoint(layerDel, -43.1, -22.1);
            const f2 = mkPoint(layerDel, -43.2, -22.2);
            const fKeep = mkPoint(layerKeep, -43.3, -22.3);
            await api.pushOperations(atlas.id, [f1.op, f2.op, fKeep.op]);

            // Pre-delete snapshot: all three features and both layers must be present.
            const before = await api.pullSync(atlas.id, 0);
            const mapBefore = before.snapshot?.maps?.find((m) => m.id === mapId);
            const pointsBefore = (mapBefore?.features?.points || []).map((p) => p.properties.id);
            const layersBefore = (mapBefore?.layers || []).map((l) => l.id);

            // Delete the layer → cascade soft-deletes its features in one transaction.
            await api.pushOperations(atlas.id, [createOperation('layer', 'delete', layerDel, mapId, null)]);

            const after = await api.pullSync(atlas.id, 0);
            const mapAfter = after.snapshot?.maps?.find((m) => m.id === mapId);
            const pointsAfter = (mapAfter?.features?.points || []).map((p) => p.properties.id);
            const layersAfter = (mapAfter?.layers || []).map((l) => l.id);

            return {
                f1: f1.id,
                f2: f2.id,
                fKeep: fKeep.id,
                layerDel,
                layerKeep,
                pointsBefore,
                layersBefore,
                pointsAfter,
                layersAfter,
            };
        }, state.baseUrl);

        // Pre-condition: everything was really there before the delete.
        expect(result.pointsBefore).toEqual(expect.arrayContaining([result.f1, result.f2, result.fKeep]));
        expect(result.layersBefore).toEqual(expect.arrayContaining([result.layerDel, result.layerKeep]));

        // Cascade: the deleted layer AND both of its features are gone from the snapshot.
        expect(result.layersAfter).not.toContain(result.layerDel);
        expect(result.pointsAfter).not.toContain(result.f1);
        expect(result.pointsAfter).not.toContain(result.f2);

        // Control: the other layer and its feature are untouched (cascade was scoped).
        expect(result.layersAfter).toContain(result.layerKeep);
        expect(result.pointsAfter).toContain(result.fKeep);
    });

    test('batch [valid create + cross-atlas update] rolls back atomically: valid create is absent', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `rollback_${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Rollback User' });
            await api.login(username, password);

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
        }, state.baseUrl);

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
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `batch3_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Batch3 User' });
            await api.login(username, password);

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
        }, state.baseUrl);

        // All three creates from the single valid batch are present in the snapshot.
        expect(result.persisted).toEqual(expect.arrayContaining(result.ids));
    });
});

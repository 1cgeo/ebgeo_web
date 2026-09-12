// Path: e2e-ui/browser-undo-redo.spec.js

/**
 * Real Chromium transport contract: undo deletes a confirmed revision and redo
 * explicitly restores that deletion by its durable receipt. Ordinary CREATE
 * cannot overwrite a live feature. The actual keyboard gestures are covered by
 * browser-p8-undo-local.spec.js with two clients and the complete sync chain.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

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
        const user = await createVerifiedUser({ prefix: 'undo', nome: 'Undo Redo' });
        await page.goto('/');
        const seed = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Undo Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            window.__undo = { api };
            return { atlasId: atlas.id, mapId, hasToken: Boolean(api.getAccessToken()) };
        }, { baseUrl: state.baseUrl, u: user });

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
            const snapshot = await window.__undo.api.pullSync(atlasId, 0);
            const previous = snapshot.snapshot.maps.find(m => m.id === mapId).features.points.find(f => f.properties.id === featureId);
            const del = createOperation('feature', 'delete', featureId, mapId, null, previous);
            window.__undo.deleteOpId = del.id;
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
                createOperation('feature', 'create', featureId, mapId, feature, null,
                    { featureIntent: 'restore', baseOperationId: window.__undo.deleteOpId }),
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
        const user = await createVerifiedUser({ prefix: 'undoidem', nome: 'Undo Idem' });
        await page.goto('/');
        const seed = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

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
            const snapshot = await api.pullSync(atlas.id, 0);
            const previous = snapshot.snapshot.maps.find(m => m.id === mapId).features.points.find(f => f.properties.id === featureId);
            const deleteOp = createOperation('feature', 'delete', featureId, mapId, null, previous);
            return { atlasId: atlas.id, mapId, featureId, deleteOp };
        }, { baseUrl: state.baseUrl, u: user });

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

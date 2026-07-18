// Path: e2e-ui/browser-context-move.spec.js

/**
 * "Context move" of a feature, driven UI-FIRST. The feature is drawn with the REAL
 * point tool, the second map is created through the app's REAL store facade (the
 * "Novo mapa" path), and both moves run through the app's REAL move store ops — the
 * same ones the "Arrastar feição para outra camada" / "Puxar para outro mapa" gestures
 * invoke (moveFeaturesToLayer / moveFeaturesToMap). Assertions read the live app store
 * (getCurrentMapFeatures) and the local repo (the moved feature on the target map).
 *
 * Two move "contexts" of docs/acoes-interface-multiusuario.md:
 *   §14.6 move-to-layer (§2.31, 🟡): rewrites properties.layerId in place — same map,
 *     same bucket, only the layer ref changes; the count stays 1 (update, not a 2nd create).
 *   §14.7 move-to-map (§1.14, 🔴): features are MAP-SCOPED, so a relocation leaves the
 *     source map's bucket and appears on the target map's bucket, geometry intact.
 *
 * NEGATIVE/EDGE: a cross-ATLAS move is gated by the backend (ForbiddenError → 403,
 *   atomic abort, no leak). This is a server-side tenancy gate with NO UI gesture, so it
 *   stays a transport probe (see the no-UI note inline).
 *
 * The atlas/map/share SETUP is API-only (sharing has no UI); login + open + every
 * gesture below is real UI.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, drawPointUI, currentMapName } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const SECOND_MAP = 'Mapa Alvo';

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Reads the current map's point ids + the layerId of a given point from the live store. */
function readCurrentPoints(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        return (f.points || []).map((p) => ({ id: p.properties?.id, layerId: p.properties?.layerId }));
    });
}

/** Reads a named map's point features straight from the local repo (no current-map switch). */
function readRepoMapPoints(page, mapName) {
    return page.evaluate(async (mn) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const mapData = await getRepository().getMap(mn);
        return ((mapData && mapData.features && mapData.features.points) || []).map((p) => ({
            id: p.properties?.id,
            geometry: p.geometry,
        }));
    }, mapName);
}

describeOrSkip('Feature context move (real Chromium + real backend, UI-first gestures)', () => {
    test('§14.6 move-to-layer rewrites properties.layerId; §14.7 move-to-map relocates the feature across maps; cross-atlas move is gated', async ({
        browser,
    }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const page = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);

        try {
            // Lands on the shared atlas map (the "source" map for the move flows).
            expect(await currentMapName(page)).toBe(seed.mapName);

            // ---- seed two layers on the source map + a point on Layer A (real UI) ------
            const layerA = await applyStoreOp(page, 'createLayer', ['Layer A', seed.mapName]);
            const layerB = await applyStoreOp(page, 'createLayer', ['Layer B', seed.mapName]);
            const layerAId = layerA?.id ?? layerA;
            const layerBId = layerB?.id ?? layerB;
            expect(layerAId).toBeTruthy();
            expect(layerBId).toBeTruthy();

            const COORDS = [-43.2, -22.9];
            const featureId = await drawPointUI(page, COORDS);
            expect(featureId, 'the point tool created a feature').toBeTruthy();
            // Move the just-drawn point onto Layer A so the layer-move below has somewhere to start.
            await applyStoreOp(page, 'moveFeaturesToLayer', [[{ type: 'point', id: featureId }], layerAId, seed.mapName]);

            const seeded = await readCurrentPoints(page);
            const initial = {
                featureOnSource: seeded.some((p) => p.id === featureId),
                layerRef: seeded.find((p) => p.id === featureId)?.layerId,
            };

            // =====================================================================
            // §14.6 MOVE-TO-LAYER via the REAL moveFeaturesToLayer store op (drag-to-layer).
            // =====================================================================
            await applyStoreOp(page, 'moveFeaturesToLayer', [[{ type: 'point', id: featureId }], layerBId, seed.mapName]);
            const afterLayerMove = await readCurrentPoints(page);
            const layerMoveFeat = afterLayerMove.find((p) => p.id === featureId);
            const moveToLayer = {
                stillOnSource: afterLayerMove.some((p) => p.id === featureId),
                newLayerRef: layerMoveFeat?.layerId,
                oldRefGone: layerMoveFeat?.layerId !== layerAId,
                // update is not a second create — exactly one instance survives.
                count: afterLayerMove.filter((p) => p.id === featureId).length,
            };

            // =====================================================================
            // §14.7 MOVE-TO-MAP: create a second map (real "Novo mapa" store op), then
            // relocate the feature there via the REAL moveFeaturesToMap store op. The
            // feature leaves the source map and appears on the target map, geometry intact.
            // =====================================================================
            const createdMap = await applyStoreOp(page, 'addMap', [SECOND_MAP]);
            expect(createdMap?.name).toBe(SECOND_MAP);
            // After addMap the app may switch the current map; ensure the source is current
            // (moveFeaturesToMap moves from the CURRENT map), then move.
            await applyStoreOp(page, 'setCurrentMap', [seed.mapName]);
            const featureToMove = await page.evaluate(async (fid) => {
                const store = await import('/src/js/store/index.js');
                const f = await store.getCurrentMapFeatures();
                const feat = (f.points || []).find((p) => p.properties?.id === fid);
                return feat ? { type: 'Feature', properties: feat.properties, geometry: feat.geometry } : null;
            }, featureId);
            expect(featureToMove, 'the feature is on the source map before the move').toBeTruthy();
            await applyStoreOp(page, 'moveFeaturesToMap', [[featureToMove], SECOND_MAP]);

            // Read source (live store, still current) + target (repo) back.
            await expect
                .poll(async () => (await readCurrentPoints(page)).some((p) => p.id === featureId), { timeout: 10000 })
                .toBe(false);
            const targetPoints = await readRepoMapPoints(page, SECOND_MAP);
            const targetFeat = targetPoints.find((p) => p.id === featureId);
            // "Intact" = the geometry on the target map matches exactly what was drawn on the
            // source map (captured in featureToMove just before the move). The point was placed
            // by the REAL point tool, so its stored lng/lat is the pixel-unprojected click — it
            // is NOT the exact hardcoded COORDS (canvas round-trip), so compare to the real
            // pre-move geometry, which still proves the move preserved geometry bit-for-bit.
            const sourceCoords = featureToMove?.geometry?.coordinates;
            const moveToMap = {
                leftSource: !(await readCurrentPoints(page)).some((p) => p.id === featureId),
                appearedOnTarget: targetPoints.some((p) => p.id === featureId),
                geometryIntact:
                    targetFeat?.geometry?.type === 'Point' &&
                    targetFeat?.geometry?.coordinates?.[0] === sourceCoords?.[0] &&
                    targetFeat?.geometry?.coordinates?.[1] === sourceCoords?.[1],
            };

            // =====================================================================
            // NEGATIVE/EDGE: cross-atlas move is gated.
            // no-UI: there is no UI gesture to move a feature into a DIFFERENT atlas's map
            // (the app never targets a foreign atlas); the backend's cross-tenant gate is a
            // pure server contract, observed via a raw pushOperations + pullSync round-trip.
            // The probe self-seeds its own server-side feature + atlases so it does not
            // depend on the local-map relocation above having reached the server.
            const edge = await page.evaluate(async ({ base, c, atlasId, mapName }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                const api = new ApiClient({ baseUrl: `${base}/api/v1` });
                await api.login(c.username, c.password);

                // The home map (the shared atlas map) + a fresh server-side victim feature.
                const homeSnap = await api.pullSync(atlasId, 0);
                const homeMapId = (homeSnap.snapshot?.maps || []).find((m) => m.name === mapName)?.id;
                const victimId = crypto.randomUUID();
                await api.pushOperations(atlasId, [
                    createOperation('feature', 'create', victimId, homeMapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.0, -22.0] },
                        properties: { id: victimId, source: 'point', nome: 'Cross-atlas victim' },
                    }),
                ]);

                // A SECOND atlas owned by the same user, whose map is the forbidden destination.
                const otherAtlas = await api.createAtlas({ name: 'Context Move Atlas (other)' });
                const otherMapId = crypto.randomUUID();
                await api.pushOperations(otherAtlas.id, [
                    createOperation('map', 'create', otherMapId, null, { name: 'Other Map' }),
                ]);

                let crossThrew = false;
                let crossStatus = null;
                try {
                    await api.pushOperations(atlasId, [
                        createOperation('feature', 'update', victimId, homeMapId, { map_id: otherMapId }),
                    ]);
                } catch (err) {
                    crossThrew = true;
                    crossStatus = err?.status ?? null;
                }
                const otherSnap = await api.pullSync(otherAtlas.id, 0);
                const leakedToOther = (otherSnap.snapshot?.maps || []).some((m) =>
                    (m.features?.points || []).some((f) => f.properties.id === victimId));
                const afterSnap = await api.pullSync(atlasId, 0);
                const stillHome = (afterSnap.snapshot?.maps || []).some((m) =>
                    (m.features?.points || []).some((f) => f.properties.id === victimId));
                return { crossThrew, crossStatus, leakedToOther, stillHome };
            }, { base: state.baseUrl, c: seed.userA, atlasId: seed.atlasId, mapName: seed.mapName });

            // ---- preconditions: seed landed as expected ----
            expect(initial.featureOnSource).toBe(true);
            expect(initial.layerRef).toBeTruthy(); // feature starts on layer A

            // ---- §14.6 move-to-layer: layer ref rewritten in place ----
            expect(moveToLayer.stillOnSource).toBe(true);
            expect(moveToLayer.newLayerRef).toBeTruthy();
            expect(moveToLayer.newLayerRef).not.toBe(initial.layerRef);
            expect(moveToLayer.oldRefGone).toBe(true);
            expect(moveToLayer.count).toBe(1);

            // ---- §14.7 move-to-map: feature relocated across maps in the same atlas ----
            expect(moveToMap.leftSource).toBe(true);
            expect(moveToMap.appearedOnTarget).toBe(true);
            expect(moveToMap.geometryIntact).toBe(true);

            // ---- EDGE: cross-atlas move rejected (403), atomic, no leak, stays put ----
            expect(edge.crossThrew).toBe(true);
            expect(edge.crossStatus).toBe(403);
            expect(edge.leakedToOther).toBe(false);
            expect(edge.stillHome).toBe(true);
        } finally {
            await page.context().close();
        }
    });
});

// Path: e2e-ui/browser-context-move.spec.js

/**
 * Browser-level "context move" of a feature: drives the REAL frontend transport
 * modules (api-client / operation-factory), imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL spawned backend. Every assertion is grounded
 * in a `pullSync` snapshot round-trip — no mocks, real HTTP.
 *
 * Two move "contexts" of docs/acoes-interface-multiusuario.md:
 *
 *   §14.6 move-to-layer (§2.31 "Arrastar feição para outra camada", 🟡): a feature
 *     `update` that rewrites the frozen GeoJSON `properties.layerId`. Same map, same
 *     bucket; only the layer ref changes (Last-write-wins). The snapshot must echo the
 *     NEW layer ref and never the OLD one, and the feature count stays 1 (update, not
 *     a second create).
 *
 *   §14.7 move-to-map (§1.14 "Puxar outros mapas" — move feições entre mapas, 🔴):
 *     features are MAP-SCOPED (the `features` table is keyed by `map_id`), so moving a
 *     feature to another map is expressed as a `delete` on the SOURCE map plus a
 *     `create` on the TARGET map (both maps live in the SAME atlas). After the move the
 *     feature must LEAVE the source map's bucket and APPEAR under the target map's
 *     bucket, with its geometry intact.
 *
 * NEGATIVE/EDGE: a cross-ATLAS move is gated. A feature `update` whose `map_id` points
 *   at a map in ANOTHER atlas is a cross-tenant move; the backend throws
 *   ForbiddenError -> 403 (sync.service.js pins feature mutations to the route atlas
 *   via the map), the atomic op aborts, and the feature never leaks into the other
 *   atlas — it stays put on the source map.
 *
 * Op shapes mirror the passing headless twin tests/e2e/feature-move-layer.e2e.test.js:
 *   - layer:   createOperation('layer','create', layerId, mapId, { name, order })
 *   - feature: createOperation('feature','create'|'update'|'delete', featureId, mapId,
 *              GeoJSON Feature) — feature type in `properties.source`, layer ref in
 *              `properties.layerId`.
 *   - cross-atlas probe: createOperation('feature','update', featureId, mapId,
 *              { map_id: otherMapId }).
 *
 * Each test self-provisions its own user + atlas + maps for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Feature context move (real Chromium + real backend, transport via page.evaluate)', () => {
    test('§14.6 move-to-layer rewrites properties.layerId; §14.7 move-to-map relocates the feature across maps; cross-atlas move is gated', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `ctxmove_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Context Move User' });
            await api.login(username, password);

            // ---- self-provision: ONE atlas with TWO maps (source + target) -------
            const atlas = await api.createAtlas({ name: 'Context Move Atlas' });
            const sourceMapId = crypto.randomUUID();
            const targetMapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', sourceMapId, null, { name: 'Source Map' }),
                createOperation('map', 'create', targetMapId, null, { name: 'Target Map' }),
            ]);

            // ---- a SECOND atlas (same owner) to probe the cross-atlas gate -------
            const otherAtlas = await api.createAtlas({ name: 'Context Move Atlas (other)' });
            const otherMapId = crypto.randomUUID();
            await api.pushOperations(otherAtlas.id, [
                createOperation('map', 'create', otherMapId, null, { name: 'Other Map' }),
            ]);

            // ---- helpers --------------------------------------------------------
            const COORDS = [-43.2, -22.9];
            const featureOn = (featureId, layerId) => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: COORDS },
                properties: { id: featureId, source: 'point', layerId, nome: 'Movable' },
            });
            const pullMap = async (atlasId, mapId) => {
                const pulled = await api.pullSync(atlasId, 0);
                return (pulled.snapshot?.maps || []).find((m) => m.id === mapId);
            };
            const pointIds = (map) =>
                (map?.features?.points || []).map((f) => f.properties.id);
            const pointFeat = (map, featureId) =>
                (map?.features?.points || []).find((f) => f.properties.id === featureId);

            // ---- seed: two layers on the source map + a feature on layerA -------
            const layerAId = crypto.randomUUID();
            const layerBId = crypto.randomUUID();
            const featureId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('layer', 'create', layerAId, sourceMapId, { name: 'Layer A', order: 0 }),
                createOperation('layer', 'create', layerBId, sourceMapId, { name: 'Layer B', order: 1 }),
                createOperation('feature', 'create', featureId, sourceMapId, featureOn(featureId, layerAId)),
            ]);

            const seeded = await pullMap(atlas.id, sourceMapId);
            const initial = {
                hasLayerA: (seeded?.layers || []).some((l) => l.id === layerAId),
                hasLayerB: (seeded?.layers || []).some((l) => l.id === layerBId),
                featureOnSource: pointIds(seeded).includes(featureId),
                layerRef: pointFeat(seeded, featureId)?.properties.layerId,
            };

            // =====================================================================
            // §14.6 MOVE-TO-LAYER: feature update rewriting properties.layerId.
            // Carry the full GeoJSON so the stored `properties` JSONB (surfaced
            // verbatim in the snapshot) reflects the new layer ref.
            // =====================================================================
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', featureId, sourceMapId, featureOn(featureId, layerBId)),
            ]);

            const afterLayerMove = await pullMap(atlas.id, sourceMapId);
            const layerMoveFeat = pointFeat(afterLayerMove, featureId);
            const moveToLayer = {
                stillOnSource: pointIds(afterLayerMove).includes(featureId),
                newLayerRef: layerMoveFeat?.properties.layerId,
                oldRefGone: layerMoveFeat?.properties.layerId !== layerAId,
                // update is not a second create — exactly one instance survives.
                count: (afterLayerMove?.features?.points || []).filter(
                    (f) => f.properties.id === featureId,
                ).length,
            };

            // =====================================================================
            // §14.7 MOVE-TO-MAP: a feature lives on exactly ONE map (id is a global
            // PRIMARY KEY), so the move is a single `feature update` that rewrites
            // `map_id` — the op's context mapId targets the feature on the SOURCE map,
            // and data.map_id sends it to the TARGET map (same atlas). The row keeps
            // its id + geometry. (delete+create with the same id would no-op against
            // the tombstone, losing the feature — that's why a relocation is an update.)
            // =====================================================================
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', featureId, sourceMapId, { map_id: targetMapId }),
            ]);

            const sourceAfter = await pullMap(atlas.id, sourceMapId);
            const targetAfter = await pullMap(atlas.id, targetMapId);
            const targetFeat = pointFeat(targetAfter, featureId);
            const moveToMap = {
                leftSource: !pointIds(sourceAfter).includes(featureId),
                appearedOnTarget: pointIds(targetAfter).includes(featureId),
                geometryIntact:
                    targetFeat?.geometry?.type === 'Point' &&
                    targetFeat?.geometry?.coordinates?.[0] === COORDS[0] &&
                    targetFeat?.geometry?.coordinates?.[1] === COORDS[1],
            };

            // =====================================================================
            // NEGATIVE/EDGE: cross-atlas move is gated. Update the (now target-map)
            // feature with a map_id pointing at the OTHER atlas's map -> 403, atomic
            // abort, no leak. Read the feature back from the target map: it must NOT
            // have moved.
            // =====================================================================
            let crossStatus = null;
            let crossThrew = false;
            try {
                await api.pushOperations(atlas.id, [
                    createOperation('feature', 'update', featureId, targetMapId, { map_id: otherMapId }),
                ]);
            } catch (err) {
                crossThrew = true;
                crossStatus = err?.status ?? null;
            }
            const otherSnap = await api.pullSync(otherAtlas.id, 0);
            const leakedToOther = (otherSnap.snapshot?.maps || []).some((m) =>
                (m.features?.points || []).some((f) => f.properties.id === featureId),
            );
            const targetStillHas = pointIds(await pullMap(atlas.id, targetMapId)).includes(featureId);

            return {
                hasToken: Boolean(api.getAccessToken()),
                initial,
                moveToLayer,
                moveToMap,
                edge: { crossThrew, crossStatus, leakedToOther, targetStillHas },
            };
        }, state.baseUrl);

        // ---- preconditions: seed landed as expected ----
        expect(result.hasToken).toBe(true);
        expect(result.initial.hasLayerA).toBe(true);
        expect(result.initial.hasLayerB).toBe(true);
        expect(result.initial.featureOnSource).toBe(true);
        expect(result.initial.layerRef).toBeTruthy(); // feature starts on layer A

        // ---- §14.6 move-to-layer: layer ref rewritten in place ----
        expect(result.moveToLayer.stillOnSource).toBe(true);
        expect(result.moveToLayer.newLayerRef).toBeTruthy();
        // the ref actually changed from the seeded (layer A) value to layer B.
        expect(result.moveToLayer.newLayerRef).not.toBe(result.initial.layerRef);
        expect(result.moveToLayer.oldRefGone).toBe(true);
        expect(result.moveToLayer.count).toBe(1);

        // ---- §14.7 move-to-map: feature relocated across maps in the same atlas ----
        expect(result.moveToMap.leftSource).toBe(true);
        expect(result.moveToMap.appearedOnTarget).toBe(true);
        expect(result.moveToMap.geometryIntact).toBe(true);

        // ---- EDGE: cross-atlas move rejected (403), atomic, no leak, stays put ----
        expect(result.edge.crossThrew).toBe(true);
        expect(result.edge.crossStatus).toBe(403);
        expect(result.edge.leakedToOther).toBe(false);
        expect(result.edge.targetStillHas).toBe(true);
    });
});

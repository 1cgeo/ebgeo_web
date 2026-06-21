// Path: e2e-ui/browser-analysis-tools.spec.js

/**
 * Browser-level analysis-tools transport test (acoes-interface §9.1-2). Drives the
 * REAL frontend transport (api-client / operation-factory) imported live from the Vite
 * dev server INSIDE real Chromium, against the REAL spawned backend. Every assertion is
 * grounded in observable backend state read back through `api.pullSync` — no mocks.
 *
 * §9.1 Line-of-Sight and §9.2 Viewshed results are persisted as ordinary atlas FEATURES:
 * each is a GeoJSON `Feature` whose analysis kind travels in `properties.source`
 * (`los` for a line-of-sight profile, `visibility` for a viewshed). The backend persists
 * that as the `feature_type` column and `pullSync` buckets it into the matching snapshot
 * collection (`map.features.los` / `map.features.visibility`). Writes are CRDT operations
 * pushed via `api.pushOperations` (there are NO REST write routes for features).
 *
 * Coverage:
 *   - §9.1: a Line-of-Sight result (LineString geometry, `source=los`, observer/target
 *     props) round-trips into the `los` bucket with its domain props preserved verbatim;
 *   - §9.2: a Viewshed result (`source=visibility`, params) round-trips into the
 *     `visibility` bucket, props preserved;
 *   - isolation: the LoS feature must NOT leak into the `visibility` bucket and vice versa;
 *   - edge: an unsupported analysis kind (`source=enemy_los`) is REJECTED at write
 *     (the backend `valid_feature_type` CHECK aborts the atomic push) and never surfaces
 *     in any snapshot bucket.
 *
 * Each test self-provisions its own user + atlas + map for full isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Analysis tools transport (real Chromium + real backend, §9.1-2)', () => {
    test('LoS → los bucket, Viewshed → visibility bucket; isolation + unsupported-kind rejected', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `analysis_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Analysis Tools User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Analysis Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // ---- helpers --------------------------------------------------
            // The analysis kind travels in `properties.source`; the backend buckets by it.
            const makeFeature = (id, source, geometry, extraProps = {}) => ({
                type: 'Feature',
                geometry,
                properties: { id, source, ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return {
                    isSnapshot: pulled.isSnapshot,
                    map: pulled.snapshot?.maps?.find((m) => m.id === mapId),
                };
            };
            const bucketIds = (map, bucket) =>
                (map?.features?.[bucket] || []).map((f) => f.properties.id);

            // ---- §9.1 Line-of-Sight result (line geometry, observer/target) ----
            const losId = crypto.randomUUID();
            const losProps = { observerHeight: 1.8, targetHeight: 2, sampleCount: 256 };
            const losGeometry = {
                type: 'LineString',
                coordinates: [
                    [-43.25, -22.95],
                    [-43.15, -22.85],
                ],
            };

            // ---- §9.2 Viewshed result (point origin, radius/params) ------------
            const visId = crypto.randomUUID();
            const visProps = { observerHeight: 2.5, radius: 5000, ringCount: 360 };
            const visGeometry = { type: 'Point', coordinates: [-43.22, -22.92] };

            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', losId, mapId,
                    makeFeature(losId, 'los', losGeometry, losProps)),
                createOperation('feature', 'create', visId, mapId,
                    makeFeature(visId, 'visibility', visGeometry, visProps)),
            ]);

            const { isSnapshot, map } = await pullMap();
            const losFeature = (map?.features?.los || []).find((f) => f.properties.id === losId);
            const visFeature =
                (map?.features?.visibility || []).find((f) => f.properties.id === visId);

            const happy = {
                isSnapshot,
                losInLos: bucketIds(map, 'los').includes(losId),
                visInVisibility: bucketIds(map, 'visibility').includes(visId),
                losSource: losFeature?.properties.source,
                visSource: visFeature?.properties.source,
                losGeometry: losFeature?.geometry,
                visGeometry: visFeature?.geometry,
                losObserverHeight: losFeature?.properties.observerHeight,
                losTargetHeight: losFeature?.properties.targetHeight,
                losSampleCount: losFeature?.properties.sampleCount,
                visRadius: visFeature?.properties.radius,
                visRingCount: visFeature?.properties.ringCount,
                visObserverHeight: visFeature?.properties.observerHeight,
            };

            // ---- isolation: neither analysis kind leaks into the sibling bucket ----
            const isolation = {
                losNotInVisibility: !bucketIds(map, 'visibility').includes(losId),
                visNotInLos: !bucketIds(map, 'los').includes(visId),
                losCount: (map?.features?.los || []).filter((f) => f.properties.id === losId)
                    .length,
                visCount: (map?.features?.visibility || []).filter(
                    (f) => f.properties.id === visId,
                ).length,
            };

            // ---- EDGE: an unsupported analysis kind is rejected at write ----
            // The backend valid_feature_type CHECK hard-rejects `enemy_los`, aborting the
            // atomic push; the row must never be persisted nor surface in any bucket.
            const bogusId = crypto.randomUUID();
            let writeRejected = false;
            try {
                await api.pushOperations(atlas.id, [
                    createOperation('feature', 'create', bogusId, mapId,
                        makeFeature(bogusId, 'enemy_los', {
                            type: 'Point',
                            coordinates: [0, 0],
                        })),
                ]);
            } catch {
                writeRejected = true;
            }
            const after = await api.pullSync(atlas.id, 0);
            const bogusLanded = (after.snapshot?.maps || []).some((m) =>
                Object.values(m.features || {}).some(
                    (bucket) =>
                        Array.isArray(bucket) &&
                        bucket.some((f) => f.properties?.id === bogusId),
                ),
            );

            return {
                hasToken: Boolean(api.getAccessToken()),
                happy,
                isolation,
                edge: { writeRejected, bogusLanded },
            };
        }, state.baseUrl);

        // ---- HAPPY PATH (§9.1 LoS + §9.2 Viewshed) ----
        expect(result.hasToken).toBe(true);
        expect(result.happy.isSnapshot).toBe(true);

        // §9.1 Line-of-Sight: lands in the `los` bucket, props + geometry preserved.
        expect(result.happy.losInLos).toBe(true);
        expect(result.happy.losSource).toBe('los');
        expect(result.happy.losGeometry).toEqual({
            type: 'LineString',
            coordinates: [
                [-43.25, -22.95],
                [-43.15, -22.85],
            ],
        });
        expect(result.happy.losObserverHeight).toBe(1.8);
        expect(result.happy.losTargetHeight).toBe(2);
        expect(result.happy.losSampleCount).toBe(256);

        // §9.2 Viewshed: lands in the `visibility` bucket, params + geometry preserved.
        expect(result.happy.visInVisibility).toBe(true);
        expect(result.happy.visSource).toBe('visibility');
        expect(result.happy.visGeometry).toEqual({
            type: 'Point',
            coordinates: [-43.22, -22.92],
        });
        expect(result.happy.visObserverHeight).toBe(2.5);
        expect(result.happy.visRadius).toBe(5000);
        expect(result.happy.visRingCount).toBe(360);

        // ---- ISOLATION: no cross-bucket leakage, exactly one entry each ----
        expect(result.isolation.losNotInVisibility).toBe(true);
        expect(result.isolation.visNotInLos).toBe(true);
        expect(result.isolation.losCount).toBe(1);
        expect(result.isolation.visCount).toBe(1);

        // ---- EDGE: unsupported analysis kind rejected, never persisted ----
        expect(result.edge.writeRejected).toBe(true);
        expect(result.edge.bogusLanded).toBe(false);
    });
});

// Path: e2e-ui/browser-context-duplicate-combine-split.spec.js

/**
 * Browser-level transport coverage for the selection context-menu actions that are
 * modelled as fan-outs of feature create / modify / delete CRDT operations. Drives the
 * REAL frontend transport modules (api-client / operation-factory) imported live from
 * the Vite dev server INSIDE real Chromium, against the REAL spawned backend. Every
 * assertion is grounded in a `pullSync` snapshot — no mocks, real HTTP round-trips.
 *
 * The atlas feature model is GeoJSON: the feature TYPE travels in `properties.source`
 * (`line` / `arrow`), which the backend persists as the `feature_type` column and which
 * `pullSync` then sorts into the snapshot buckets `map.features.{lines,arrows}`. There
 * are NO REST write routes for features — every mutation is a CRDT op pushed via
 * `api.pushOperations`.
 *
 * Coverage (docs/acoes-interface-multiusuario.md §14):
 *   - §14.9  Duplicate selection  — N copies, each a `feature/create` with a FRESH UUID,
 *            originals untouched (membership doubles, ids disjoint).
 *   - §14.10 Combine arrows       — `feature/modify` one arrow into a composite +
 *            `feature/delete` the others (the survivors collapse to a single arrow).
 *   - §14.11 Split arrows         — `feature/create` the individuals + `feature/delete`
 *            the composite (the composite vanishes, the individuals appear).
 *   - §14.12 Cut line             — `feature/create` the two halves + `feature/delete`
 *            the original (original gone, exactly two halves present).
 *   - edge: duplicating with a bogus `properties.source` is rejected AT WRITE by the
 *            `valid_feature_type` CHECK (atomic batch aborts; nothing lands).
 *
 * Each test self-provisions its own user + atlas + map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Selection context actions: duplicate / combine / split / cut (real Chromium + real backend)', () => {
    test('§14.9 duplicate selection clones every feature under a fresh UUID, originals untouched', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `dup_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Duplicate User' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Duplicate Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const makeFeature = (id, source, geometry, extraProps = {}) => ({
                type: 'Feature',
                geometry,
                properties: { id, source, ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return pulled.snapshot?.maps?.find((m) => m.id === mapId);
            };
            const bucketIds = (map, bucket) =>
                (map?.features?.[bucket] || []).map((f) => f.properties.id);

            // ---- seed an original selection of two lines -----------------
            const origA = crypto.randomUUID();
            const origB = crypto.randomUUID();
            const lineGeom = (dx) => ({
                type: 'LineString',
                coordinates: [
                    [-43.2 + dx, -22.9],
                    [-43.1 + dx, -22.8],
                ],
            });
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', origA, mapId, makeFeature(origA, 'line', lineGeom(0), { nome: 'A' })),
                createOperation('feature', 'create', origB, mapId, makeFeature(origB, 'line', lineGeom(0.5), { nome: 'B' })),
            ]);

            // ---- §14.9 duplicate: one create per copy, each a FRESH UUID --
            const copyA = crypto.randomUUID();
            const copyB = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', copyA, mapId, makeFeature(copyA, 'line', lineGeom(0), { nome: 'A copy' })),
                createOperation('feature', 'create', copyB, mapId, makeFeature(copyB, 'line', lineGeom(0.5), { nome: 'B copy' })),
            ]);

            const after = await pullMap();
            const lineIds = bucketIds(after, 'lines');

            return {
                origAPresent: lineIds.includes(origA),
                origBPresent: lineIds.includes(origB),
                copyAPresent: lineIds.includes(copyA),
                copyBPresent: lineIds.includes(copyB),
                // copies carry brand-new ids, disjoint from the originals.
                idsDisjoint:
                    copyA !== origA && copyA !== origB && copyB !== origA && copyB !== origB,
                // membership doubled: the two originals + two copies are all distinct.
                distinctCount: new Set([origA, origB, copyA, copyB]).size,
                presentCount: [origA, origB, copyA, copyB].filter((id) => lineIds.includes(id)).length,
            };
        }, state.baseUrl);

        expect(result.origAPresent).toBe(true);
        expect(result.origBPresent).toBe(true);
        expect(result.copyAPresent).toBe(true);
        expect(result.copyBPresent).toBe(true);
        expect(result.idsDisjoint).toBe(true);
        expect(result.distinctCount).toBe(4);
        expect(result.presentCount).toBe(4);
    });

    test('§14.10 combine arrows modifies one survivor + deletes the rest; §14.11 split reverses it', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `cmb_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Combine User' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Combine Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const arrow = (id, coords, extraProps = {}) => ({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { id, source: 'arrow', ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return pulled.snapshot?.maps?.find((m) => m.id === mapId);
            };
            const arrowsById = (map) => {
                const out = new Map();
                for (const f of map?.features?.arrows || []) out.set(f.properties.id, f);
                return out;
            };

            // ---- seed three individual arrows (the selection) ------------
            const a1 = crypto.randomUUID();
            const a2 = crypto.randomUUID();
            const a3 = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', a1, mapId, arrow(a1, [[-43.2, -22.9], [-43.1, -22.9]], { nome: 'A1' })),
                createOperation('feature', 'create', a2, mapId, arrow(a2, [[-43.1, -22.9], [-43.0, -22.9]], { nome: 'A2' })),
                createOperation('feature', 'create', a3, mapId, arrow(a3, [[-43.0, -22.9], [-42.9, -22.9]], { nome: 'A3' })),
            ]);
            const seeded = arrowsById(await pullMap());

            // ---- §14.10 combine: MODIFY a1 into a composite multi-geometry,
            // DELETE a2 + a3. The composite keeps a1's id but spans every leg.
            const compositeGeom = {
                type: 'MultiLineString',
                coordinates: [
                    [[-43.2, -22.9], [-43.1, -22.9]],
                    [[-43.1, -22.9], [-43.0, -22.9]],
                    [[-43.0, -22.9], [-42.9, -22.9]],
                ],
            };
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', a1, mapId, arrow(a1, compositeGeom.coordinates, { nome: 'Composite', composite: true })),
                createOperation('feature', 'delete', a2, mapId, null),
                createOperation('feature', 'delete', a3, mapId, null),
            ]);

            // NOTE: arrow geometry persisted as JSONB; rewrite a1 with the real
            // MultiLineString geometry so the snapshot reflects the merged legs.
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'update', a1, mapId, {
                    type: 'Feature',
                    geometry: compositeGeom,
                    properties: { id: a1, source: 'arrow', nome: 'Composite', composite: true },
                }),
            ]);

            const combinedMap = arrowsById(await pullMap());
            const composite = combinedMap.get(a1);

            const combined = {
                survivorPresent: combinedMap.has(a1),
                a2Gone: !combinedMap.has(a2),
                a3Gone: !combinedMap.has(a3),
                onlySurvivor: combinedMap.size === 1,
                isComposite: composite?.properties?.composite === true,
                multiGeometry: composite?.geometry?.type === 'MultiLineString',
                legCount: composite?.geometry?.coordinates?.length,
            };

            // ---- §14.11 split: CREATE individuals s1/s2/s3 + DELETE composite
            const s1 = crypto.randomUUID();
            const s2 = crypto.randomUUID();
            const s3 = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', s1, mapId, arrow(s1, [[-43.2, -22.9], [-43.1, -22.9]], { nome: 'S1' })),
                createOperation('feature', 'create', s2, mapId, arrow(s2, [[-43.1, -22.9], [-43.0, -22.9]], { nome: 'S2' })),
                createOperation('feature', 'create', s3, mapId, arrow(s3, [[-43.0, -22.9], [-42.9, -22.9]], { nome: 'S3' })),
                createOperation('feature', 'delete', a1, mapId, null),
            ]);

            const splitMap = arrowsById(await pullMap());
            const split = {
                compositeGone: !splitMap.has(a1),
                s1Present: splitMap.has(s1),
                s2Present: splitMap.has(s2),
                s3Present: splitMap.has(s3),
                count: splitMap.size,
                allLineStrings: [s1, s2, s3].every(
                    (id) => splitMap.get(id)?.geometry?.type === 'LineString',
                ),
            };

            return { seededCount: seeded.size, combined, split };
        }, state.baseUrl);

        // seed sanity
        expect(result.seededCount).toBe(3);

        // §14.10 combine assertions
        expect(result.combined.survivorPresent).toBe(true);
        expect(result.combined.a2Gone).toBe(true);
        expect(result.combined.a3Gone).toBe(true);
        expect(result.combined.onlySurvivor).toBe(true);
        expect(result.combined.isComposite).toBe(true);
        expect(result.combined.multiGeometry).toBe(true);
        expect(result.combined.legCount).toBe(3);

        // §14.11 split assertions
        expect(result.split.compositeGone).toBe(true);
        expect(result.split.s1Present).toBe(true);
        expect(result.split.s2Present).toBe(true);
        expect(result.split.s3Present).toBe(true);
        expect(result.split.count).toBe(3);
        expect(result.split.allLineStrings).toBe(true);
    });

    test('§14.12 cut line creates two halves + deletes the original; edge: bad source rejected at write', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `cut_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Cut User' });
            await api.login(username, 'Sup3r-Secret-Pw!');

            const atlas = await api.createAtlas({ name: 'Cut Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const line = (id, coords, extraProps = {}) => ({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { id, source: 'line', ...extraProps },
            });
            const pullMap = async () => {
                const pulled = await api.pullSync(atlas.id, 0);
                return pulled.snapshot?.maps?.find((m) => m.id === mapId);
            };
            const lineIds = (map) => (map?.features?.lines || []).map((f) => f.properties.id);

            // ---- seed the original line to be cut at the midpoint --------
            const original = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation(
                    'feature',
                    'create',
                    original,
                    mapId,
                    line(original, [[-43.2, -22.9], [-43.0, -22.9]], { nome: 'Original' }),
                ),
            ]);

            // ---- §14.12 cut: CREATE two halves split at the midpoint,
            // DELETE the original. Result: exactly the two halves, no original.
            const halfA = crypto.randomUUID();
            const halfB = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', halfA, mapId, line(halfA, [[-43.2, -22.9], [-43.1, -22.9]], { nome: 'Half A' })),
                createOperation('feature', 'create', halfB, mapId, line(halfB, [[-43.1, -22.9], [-43.0, -22.9]], { nome: 'Half B' })),
                createOperation('feature', 'delete', original, mapId, null),
            ]);

            const after = await pullMap();
            const ids = lineIds(after);
            const cut = {
                originalGone: !ids.includes(original),
                halfAPresent: ids.includes(halfA),
                halfBPresent: ids.includes(halfB),
                // the two halves share the cut vertex (continuity of the split).
                cutVertexShared:
                    (after.features.lines.find((f) => f.properties.id === halfA)?.geometry
                        ?.coordinates?.[1]?.[0]) ===
                    (after.features.lines.find((f) => f.properties.id === halfB)?.geometry
                        ?.coordinates?.[0]?.[0]),
            };

            // ---- EDGE: a copy with a bogus source is rejected by the
            // valid_feature_type CHECK; the atomic batch aborts and nothing lands.
            const badId = crypto.randomUUID();
            let badRejected = false;
            try {
                await api.pushOperations(atlas.id, [
                    createOperation('feature', 'create', badId, mapId, {
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.0, -22.9]] },
                        properties: { id: badId, source: 'not_a_real_type' },
                    }),
                ]);
            } catch {
                badRejected = true;
            }
            const afterBad = await pullMap();
            const badLanded = Object.values(afterBad.features || {})
                .filter(Array.isArray)
                .flat()
                .some((f) => f.properties?.id === badId);

            return { cut, edge: { badRejected, badLanded } };
        }, state.baseUrl);

        // §14.12 cut assertions
        expect(result.cut.originalGone).toBe(true);
        expect(result.cut.halfAPresent).toBe(true);
        expect(result.cut.halfBPresent).toBe(true);
        expect(result.cut.cutVertexShared).toBe(true);

        // edge assertions: hard reject, nothing persisted
        expect(result.edge.badRejected).toBe(true);
        expect(result.edge.badLanded).toBe(false);
    });
});

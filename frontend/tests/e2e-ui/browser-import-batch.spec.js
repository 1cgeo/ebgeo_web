// Path: e2e-ui/browser-import-batch.spec.js

/**
 * Browser-level BATCH IMPORT transport test. Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server inside
 * real Chromium, against the REAL spawned backend. Every assertion is grounded in
 * a `pullSync` snapshot — no mocks, real HTTP round-trips.
 *
 * Covers the multiuser-interface sync actions:
 *   - §5.1 "Importar GeoJSON" — a heterogeneous batch of feature `create` ops
 *     (points + a line + a polygon) pushed in ONE `pushOperations` call, asserting
 *     ALL land atomically in their respective snapshot buckets;
 *   - §5.8 / §24.9 "adicionar pontos por coordenadas" — a batch of N point `create`
 *     ops pushed in ONE call, asserting every coordinate pair round-trips into the
 *     `points` bucket with geometry intact;
 *   - BLAST RADIUS (negative/edge): a batch where ONE op carries an invalid
 *     `properties.source` (refused by the `valid_feature_type` CHECK at write time,
 *     002_atlas.sql). The invalid op writes NOTHING; its valid siblings in the same
 *     batch COMMIT. See the case below for why this reversed on 2026-07-24.
 *
 * A feature carries its TYPE in `properties.source` (GeoJSON Feature); the backend
 * buckets by `feature_type`. Writes are CRDT operations (no REST write routes).
 *
 * Each test self-provisions its own user + atlas + map for full isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Batch import / points-by-coordinates (real Chromium + real backend)', () => {
    test('§5.1 import GeoJSON: heterogeneous feature batch lands atomically in its buckets', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `imp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Import User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Import Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const makeFeature = (id, source, geometry, extraProps = {}) => ({
                type: 'Feature',
                geometry,
                properties: { id, source, ...extraProps },
            });

            // A GeoJSON import is a heterogeneous batch: two points, one line, one
            // polygon — all created in a SINGLE pushOperations call (one transaction).
            const p1 = crypto.randomUUID();
            const p2 = crypto.randomUUID();
            const lineId = crypto.randomUUID();
            const polyId = crypto.randomUUID();

            const batch = [
                createOperation('feature', 'create', p1, mapId,
                    makeFeature(p1, 'point', { type: 'Point', coordinates: [-43.21, -22.91] }, { nome: 'P1' })),
                createOperation('feature', 'create', p2, mapId,
                    makeFeature(p2, 'point', { type: 'Point', coordinates: [-43.22, -22.92] }, { nome: 'P2' })),
                createOperation('feature', 'create', lineId, mapId,
                    makeFeature(lineId, 'line', {
                        type: 'LineString',
                        coordinates: [[-43.2, -22.9], [-43.1, -22.8]],
                    }, { nome: 'L1' })),
                createOperation('feature', 'create', polyId, mapId,
                    makeFeature(polyId, 'polygon', {
                        type: 'Polygon',
                        coordinates: [[[-43.2, -22.9], [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.9]]],
                    }, { nome: 'Poly1' })),
            ];

            const pushRes = await api.pushOperations(atlas.id, batch);

            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const bucketIds = (bucket) => (map?.features?.[bucket] || []).map((f) => f.properties.id);
            const pointById = (id) => (map?.features?.points || []).find((f) => f.properties.id === id);

            return {
                ackCount: pushRes.results?.length ?? 0,
                isSnapshot: pulled.isSnapshot,
                ids: { p1, p2, lineId, polyId },
                pointIds: bucketIds('points'),
                lineIds: bucketIds('lines'),
                polygonIds: bucketIds('polygons'),
                p1Coords: pointById(p1)?.geometry?.coordinates,
                p2Coords: pointById(p2)?.geometry?.coordinates,
                // cross-bucket isolation: the line must NOT leak into points.
                lineNotInPoints: !bucketIds('points').includes(lineId),
            };
        }, state.baseUrl);

        // The single push acked all four ops.
        expect(result.ackCount).toBe(4);
        expect(result.isSnapshot).toBe(true);

        const { p1, p2, lineId, polyId } = result.ids;
        // ALL members of the heterogeneous batch landed, each in its own bucket.
        expect(result.pointIds).toContain(p1);
        expect(result.pointIds).toContain(p2);
        expect(result.lineIds).toContain(lineId);
        expect(result.polygonIds).toContain(polyId);
        // Geometry round-tripped intact for the imported points.
        expect(result.p1Coords).toEqual([-43.21, -22.91]);
        expect(result.p2Coords).toEqual([-43.22, -22.92]);
        // Isolation: a line never surfaces as a point.
        expect(result.lineNotInPoints).toBe(true);
    });

    test('§5.8/§24.9 points by coordinates: N point creates in ONE push all round-trip', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `coord_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Coord User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Coord Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            // "Adicionar pontos por coordenadas": a batch of distinct points, each
            // an individual point `create` op, all in ONE pushOperations call.
            const coords = [
                [-43.10, -22.80],
                [-43.11, -22.81],
                [-43.12, -22.82],
                [-43.13, -22.83],
                [-43.14, -22.84],
            ];
            const entries = coords.map((c) => ({ id: crypto.randomUUID(), c }));
            const batch = entries.map(({ id, c }) =>
                createOperation('feature', 'create', id, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: c },
                    properties: { id, source: 'point', nome: `Pt ${c[0]},${c[1]}` },
                }),
            );

            const pushRes = await api.pushOperations(atlas.id, batch);

            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const points = map?.features?.points || [];

            // Verify every requested coordinate pair landed with geometry intact.
            const persisted = entries.map(({ id, c }) => {
                const f = points.find((p) => p.properties.id === id);
                return {
                    found: Boolean(f),
                    coordsMatch: f ? f.geometry.coordinates[0] === c[0] && f.geometry.coordinates[1] === c[1] : false,
                    sourceIsPoint: f?.properties.source === 'point',
                };
            });

            return {
                ackCount: pushRes.results?.length ?? 0,
                expected: entries.length,
                pointBucketCount: points.length,
                persisted,
            };
        }, state.baseUrl);

        expect(result.ackCount).toBe(result.expected);
        expect(result.pointBucketCount).toBe(result.expected);
        // Each coordinate pair round-tripped into the points bucket, intact.
        for (const p of result.persisted) {
            expect(p.found).toBe(true);
            expect(p.coordsMatch).toBe(true);
            expect(p.sourceIsPoint).toBe(true);
        }
    });

    /**
     * ONE INVALID OP NO LONGER TAKES THE BATCH DOWN, AND THE CASE WAS REPLACED, NOT PATCHED.
     *
     * This case asserted whole-batch rollback, and it was right when it was written: a data
     * violation aborted the single transaction wrapping the push, so the valid siblings were
     * lost with it. On 2026-07-24 the blast radius was deliberately narrowed — each op runs
     * inside its own savepoint, and a data violation (SQLSTATE class 22/23) is refused PER
     * OPERATION with HTTP 200 and `rejected: true`, so the neighbours commit. The reason is
     * the outbound queue: one poisoned op used to freeze every op behind it.
     *
     * The old assertions were TROCADAS, never kept alongside the new ones. A case that keeps
     * demanding the previous contract makes the correction read as a regression, and this
     * file sat red for weeks saying exactly that — unnoticed, because the browser layer runs
     * outside `npm test`.
     *
     * What did NOT change, and is still asserted: the invalid op persists nothing, and the
     * atlas is not wedged afterwards.
     */
    test('BLAST RADIUS: one invalid op writes nothing while its valid siblings commit', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `atom_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Atomic User' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Atomic Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'M1' }),
            ]);

            const goodA = crypto.randomUUID();
            const goodB = crypto.randomUUID();
            const badId = crypto.randomUUID();

            // The batch interleaves two VALID point creates around one create whose
            // `properties.source` is an UNKNOWN feature type. The `valid_feature_type` CHECK
            // refuses that one at INSERT time; its savepoint rolls back and the two
            // neighbours commit. Interleaving matters: a sibling BEFORE and AFTER the bad op
            // proves the refusal does not poison what came earlier or abort what comes next.
            const batch = [
                createOperation('feature', 'create', goodA, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.30, -22.70] },
                    properties: { id: goodA, source: 'point', nome: 'GoodA' },
                }),
                createOperation('feature', 'create', badId, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.31, -22.71] },
                    properties: { id: badId, source: 'not_a_real_feature_type', nome: 'Bad' },
                }),
                createOperation('feature', 'create', goodB, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.32, -22.72] },
                    properties: { id: goodB, source: 'point', nome: 'GoodB' },
                }),
            ];

            // The whole push must REJECT (the invalid op violates the CHECK constraint
            // inside the transaction). Capture whether it threw without aborting the test.
            const pushRes = await api.pushOperations(atlas.id, batch);
            const outcomes = (pushRes.results || []).map((r) => ({
                success: r.success, rejected: Boolean(r.rejected), reason: r.reason ?? null,
            }));

            // Verification: the siblings live, the bad one does not.
            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const allFeatureIds = Object.values(map?.features || {})
                .filter(Array.isArray)
                .flat()
                .map((f) => f.properties?.id);

            // Sanity: a SUBSEQUENT all-valid push still succeeds (the refused op does not
            // wedge the atlas, which is the whole reason the blast radius was narrowed).
            const recoverId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('feature', 'create', recoverId, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.40, -22.60] },
                    properties: { id: recoverId, source: 'point', nome: 'Recover' },
                }),
            ]);
            const pulled2 = await api.pullSync(atlas.id, 0);
            const map2 = pulled2.snapshot?.maps?.find((m) => m.id === mapId);
            const pointIds2 = (map2?.features?.points || []).map((f) => f.properties.id);

            return {
                outcomes,
                goodAPersisted: allFeatureIds.includes(goodA),
                goodBPersisted: allFeatureIds.includes(goodB),
                badPersisted: allFeatureIds.includes(badId),
                featureCountAfterFailedBatch: allFeatureIds.length,
                recoverPersisted: pointIds2.includes(recoverId),
            };
        }, state.baseUrl);

        // The push answers PER OPERATION: two accepted, the middle one refused.
        expect(result.outcomes).toHaveLength(3);
        expect(result.outcomes[0].success, 'the sibling BEFORE the bad op was accepted').toBe(true);
        expect(result.outcomes[2].success, 'the sibling AFTER the bad op was accepted').toBe(true);
        expect(result.outcomes[1].success).toBe(false);
        expect(result.outcomes[1].rejected, 'the bad op is refused, not merely failed').toBe(true);
        expect(result.outcomes[1].reason).toMatch(/^Alteração descartada:/);
        // The refusal is CONTAINED: neighbours committed, the invalid op wrote nothing.
        expect(result.goodAPersisted, 'the sibling before the bad op survived').toBe(true);
        expect(result.goodBPersisted, 'the sibling after the bad op survived').toBe(true);
        expect(result.badPersisted, 'the refused op must never be persisted').toBe(false);
        expect(result.featureCountAfterFailedBatch, 'exactly the two valid siblings').toBe(2);
        // The atlas remains usable: a later valid push lands normally.
        expect(result.recoverPersisted).toBe(true);
    });
});

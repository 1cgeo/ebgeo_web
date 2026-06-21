// Path: e2e-ui/browser-feature-types.spec.js

/**
 * Browser-level coverage of ALL 18 backend feature types. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL backend, making genuine HTTP round-trips.
 *
 * The frontend encodes a feature's TYPE in `properties.source` (GeoJSON Feature);
 * the backend persists it as `feature_type` and, on `pullSync`, transforms the flat
 * feature list back into per-type buckets on `map.features` (points, lines, polygons,
 * texts, images, circles, rectangles, ellipses, brushes, arrows, boundarys,
 * occupied_fronts, military_symbols, coordination_measures, los, visibility,
 * processed_los, processed_visibility).
 *
 * This spec creates ONE feature of each of the 18 types in a single atomic push, then
 * pulls the snapshot and asserts each feature landed in EXACTLY its expected bucket
 * (and nowhere else). It also asserts a negative: an unknown `source` is dropped by
 * the backend's type→bucket mapping and appears in none of the buckets.
 *
 * Creates its own user + atlas + map per test for isolation. No UI clicks — the
 * transport is exercised directly via page.evaluate, so no data-testid selectors.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * The 18 backend feature types paired with the snapshot bucket each must land in,
 * exactly as the backend's `transformFeaturesToFrontend` mapping dictates. Note the
 * intentionally irregular plurals/identities (`boundary`→`boundarys`, `los`→`los`,
 * `visibility`→`visibility`, the `processed_*` pair) — these are part of the frozen
 * frontend contract and must NOT be "corrected".
 *
 * @type {Array<{ source: string, bucket: string }>}
 */
const TYPE_TO_BUCKET = [
    { source: 'point', bucket: 'points' },
    { source: 'line', bucket: 'lines' },
    { source: 'polygon', bucket: 'polygons' },
    { source: 'text', bucket: 'texts' },
    { source: 'image', bucket: 'images' },
    { source: 'circle', bucket: 'circles' },
    { source: 'rectangle', bucket: 'rectangles' },
    { source: 'ellipse', bucket: 'ellipses' },
    { source: 'brush', bucket: 'brushes' },
    { source: 'arrow', bucket: 'arrows' },
    { source: 'boundary', bucket: 'boundarys' },
    { source: 'occupied_front', bucket: 'occupied_fronts' },
    { source: 'military_symbol', bucket: 'military_symbols' },
    { source: 'coordination_measure', bucket: 'coordination_measures' },
    { source: 'los', bucket: 'los' },
    { source: 'visibility', bucket: 'visibility' },
    { source: 'processed_los', bucket: 'processed_los' },
    { source: 'processed_visibility', bucket: 'processed_visibility' },
];

describeOrSkip('Feature types (all 18, real Chromium + real backend)', () => {
    test('one feature of each type lands in exactly its snapshot bucket', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, typeToBucket }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                const username = `ftypes_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
                const password = 'Sup3r-Secret-Pw!';
                await api.register({ username, password, nome: 'Feature Types' });
                await api.login(username, password);

                const atlas = await api.createAtlas({ name: 'Feature Types Atlas' });
                const mapId = crypto.randomUUID();
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'All Types Map' }),
                ]);

                // Build one feature per type, each with a distinct id, the type in
                // `properties.source`, and a geometry that does not depend on the type
                // (the backend buckets purely on `feature_type`, derived from `source`).
                const expected = {};
                const ops = [];
                for (let i = 0; i < typeToBucket.length; i += 1) {
                    const { source, bucket } = typeToBucket[i];
                    const featureId = crypto.randomUUID();
                    expected[source] = { featureId, bucket };
                    const feature = {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2 + i * 0.01, -22.9] },
                        properties: { id: featureId, source, nome: `feat-${source}` },
                    };
                    ops.push(createOperation('feature', 'create', featureId, mapId, feature));
                }

                // One atomic push of the 18 valid ops.
                await api.pushOperations(atlas.id, ops);

                // NEGATIVE: an unknown source is rejected by the backend's
                // `valid_feature_type` CHECK constraint at WRITE time (the push throws).
                // It MUST go in its OWN push: bundling it with the 18 valid ops would
                // abort the whole atomic batch (correct behavior — see backend
                // batch-atomicity). The row is never inserted, so it can never leak.
                const unknownId = crypto.randomUUID();
                let unknownRejected = false;
                try {
                    await api.pushOperations(atlas.id, [
                        createOperation('feature', 'create', unknownId, mapId, {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [0, 0] },
                            properties: { id: unknownId, source: 'not_a_real_type' },
                        }),
                    ]);
                } catch {
                    unknownRejected = true;
                }

                const pulled = await api.pullSync(atlas.id, 0);
                const maps = pulled.snapshot ? pulled.snapshot.maps : null;
                const list = Array.isArray(maps) ? maps : maps ? Object.values(maps) : [];
                const map = list.find((m) => m && (m.id === mapId || m.mapId === mapId));
                const buckets = (map && map.features) || {};
                const bucketNames = Object.keys(buckets);

                // For each type: present in its own bucket, absent from every other.
                const checks = typeToBucket.map(({ source, bucket }) => {
                    const id = expected[source].featureId;
                    const inOwn = Array.isArray(buckets[bucket])
                        && buckets[bucket].some((f) => f.properties && f.properties.id === id);
                    const otherBuckets = bucketNames.filter((b) => b !== bucket);
                    const leaked = otherBuckets.filter(
                        (b) => Array.isArray(buckets[b])
                            && buckets[b].some((f) => f.properties && f.properties.id === id),
                    );
                    const ownEntry = inOwn
                        ? buckets[bucket].find((f) => f.properties.id === id)
                        : null;
                    return {
                        source,
                        bucket,
                        inOwn,
                        leaked,
                        // The backend re-stamps `properties.source` from `feature_type`.
                        stampedSource: ownEntry ? ownEntry.properties.source : null,
                    };
                });

                // Negative check: unknown id is in none of the buckets.
                const unknownLeaked = bucketNames.filter(
                    (b) => Array.isArray(buckets[b])
                        && buckets[b].some((f) => f.properties && f.properties.id === unknownId),
                );

                return {
                    isSnapshot: pulled.isSnapshot,
                    mapFound: Boolean(map),
                    bucketNames,
                    checks,
                    unknownLeaked,
                    unknownRejected,
                };
            },
            { baseUrl: state.baseUrl, typeToBucket: TYPE_TO_BUCKET },
        );

        // Sanity: we got a snapshot and the map we created.
        expect(result.isSnapshot).toBe(true);
        expect(result.mapFound).toBe(true);

        // Every one of the 18 types must be present in its own bucket, leak into no
        // other bucket, and be re-stamped with the same `source` on the way back.
        for (const check of result.checks) {
            expect(
                check.inOwn,
                `type "${check.source}" should be in bucket "${check.bucket}"`,
            ).toBe(true);
            expect(
                check.leaked,
                `type "${check.source}" leaked into buckets: ${check.leaked.join(', ')}`,
            ).toEqual([]);
            expect(check.stampedSource).toBe(check.source);
        }

        // We asserted on exactly 18 types.
        expect(result.checks).toHaveLength(18);

        // NEGATIVE: the unknown-type push was rejected at write time by the backend's
        // `valid_feature_type` CHECK constraint (the separate push threw)...
        expect(result.unknownRejected).toBe(true);
        // ...so the row was never inserted and appears in no bucket at all.
        expect(
            result.unknownLeaked,
            `unknown type leaked into buckets: ${result.unknownLeaked.join(', ')}`,
        ).toEqual([]);
    });
});

// Path: e2e-ui/browser-feature-types.spec.js

/**
 * Browser-level coverage of EVERY backend feature type (list DERIVED, never counted). Drives the REAL frontend
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
 * This spec creates ONE feature of each type in a single atomic push, then
 * pulls the snapshot and asserts each feature landed in EXACTLY its expected bucket
 * (and nowhere else). It also asserts a negative: an unknown `source` is dropped by
 * the backend's type→bucket mapping and appears in none of the buckets.
 *
 * Creates its own user + atlas + map per test for isolation. No UI clicks — the
 * transport is exercised directly via page.evaluate, so no data-testid selectors.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { FEATURE_TYPE_MAPPINGS } from '../../src/js/store/store.constants.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Every backend feature type paired with the snapshot bucket it must land in, DERIVED.
 *
 * It used to be eighteen pairs written out here, under a header announcing "ALL 18 backend
 * feature types", while the store, the Joi schema and the database CHECK all agreed on
 * TWENTY: `sector` and `magnetic_declination` were missing. A sweep that names itself "all"
 * and covers a subset is the most dangerous copy in the repository, because it wears the
 * clothes of a verification. `FEATURE_TYPE_MAPPINGS` derives from
 * `store/feature-type.registry.js`, so a type born there arrives here with no edit.
 *
 * The irregular plurals/identities survive the derivation because they live in the registry:
 * `boundary`→`boundarys`, `sector`→`setores`, `los`→`los`, and the `processed_*` pair whose
 * bucket is the source name verbatim. They are frozen contract and must NOT be "corrected".
 *
 * @type {Array<{ source: string, bucket: string }>}
 */
const TYPE_TO_BUCKET = Object.entries(FEATURE_TYPE_MAPPINGS)
    .map(([source, bucket]) => ({ source, bucket }));

describeOrSkip('Feature types (every one, real Chromium + real backend)', () => {
    test('one feature of each type lands in exactly its snapshot bucket', async ({ page }) => {
        await page.goto('/');

        const user = await createVerifiedUser({ prefix: 'ftypes', nome: 'Feature Types' });

        const result = await page.evaluate(
            async ({ baseUrl, typeToBucket, u }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                await api.login(u.username, u.password);

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

                // One push carrying every valid op.
                await api.pushOperations(atlas.id, ops);

                // NEGATIVE: an unknown source is refused by the backend's
                // `valid_feature_type` CHECK. The REFUSAL SHAPE changed on 2026-07-24 and this
                // block asserted the old one until 2026-08-16: a data violation (SQLSTATE class
                // 22/23) is now refused PER OPERATION — HTTP 200, `rejected: true`, and a
                // generic pt-BR reason that never echoes the driver text — instead of throwing
                // and aborting the batch. The contract that did NOT change is the one that
                // matters: the row is never inserted, so it can never leak into a bucket.
                const unknownId = crypto.randomUUID();
                const unknownRes = await api.pushOperations(atlas.id, [
                    createOperation('feature', 'create', unknownId, mapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [0, 0] },
                        properties: { id: unknownId, source: 'not_a_real_type' },
                    }),
                ]);
                const unknownOutcome = unknownRes.results?.[0] ?? null;

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
                    unknownOutcome,
                };
            },
            { baseUrl: state.baseUrl, typeToBucket: TYPE_TO_BUCKET, u: user },
        );

        // Sanity: we got a snapshot and the map we created.
        expect(result.isSnapshot).toBe(true);
        expect(result.mapFound).toBe(true);

        // Every type must be present in its own bucket, leak into no
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

        // We asserted on every type the store declares, and the floor is absolute so a
        // derivation that broke and yielded {} cannot pass by iterating zero times.
        expect(result.checks.length, 'the derived type list came back empty or truncated')
            .toBeGreaterThanOrEqual(20);
        expect(result.checks).toHaveLength(TYPE_TO_BUCKET.length);

        // NEGATIVE: the unknown type is refused PER OPERATION (HTTP 200, `rejected: true`,
        // generic pt-BR reason that never echoes the constraint name)...
        expect(result.unknownOutcome, 'the push returned no per-operation outcome').toBeTruthy();
        expect(result.unknownOutcome.success).toBe(false);
        expect(result.unknownOutcome.rejected).toBe(true);
        expect(result.unknownOutcome.reason).toMatch(/^Alteração descartada:/);
        expect(result.unknownOutcome.reason).not.toMatch(/constraint|features_|check/i);
        // ...so the row was never inserted and appears in no bucket at all.
        expect(
            result.unknownLeaked,
            `unknown type leaked into buckets: ${result.unknownLeaked.join(', ')}`,
        ).toEqual([]);
    });
});

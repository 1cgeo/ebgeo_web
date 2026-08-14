// Path: e2e-ui/browser-military-tools.spec.js

/**
 * Browser-level military-symbology transport test (§8.2-7 of
 * docs/acoes-interface-multiusuario.md). Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server inside
 * real Chromium, against the REAL spawned backend. Every assertion is grounded in
 * the persisted snapshot read back through `api.pullSync` — no mocks, real HTTP.
 *
 * The atlas feature model is GeoJSON: a feature's TYPE travels in
 * `properties.source`, which the backend persists as the `feature_type` column and
 * `pullSync` then files into the matching `map.features.<bucket>` collection. The
 * twenty valid types are enforced by the `valid_feature_type` CHECK in 002_atlas.sql;
 * an UNKNOWN source is refused PER OPERATION at write time (the batch still answers
 * 200 and names the op as rejected) and never persists. Writes are CRDT operations
 * pushed via `api.pushOperations` (no REST write routes exist).
 *
 * Coverage — one create per §8 toolbar action, each filed into its OWN bucket with
 * source + domain props preserved:
 *   - §8.2 military_symbol (Point + SIDC + rotation)        -> features.military_symbols
 *   - §8.3 coordination_measure (LineString + measureType)  -> features.coordination_measures
 *   - §8.4 arrow (LineString)                                -> features.arrows
 *   - §8.5 boundary (LineString)                             -> features.boundarys
 *   - §8.6 occupied_front (LineString)                       -> features.occupied_fronts
 *   - §8.7 declination diagram (Point + magneticDeclination) -> features.points
 *   - negative/edge: an UNSUPPORTED source is refused per-op and never persists.
 *
 * Op shapes mirror the passing headless twin tests/e2e/military-and-analysis.e2e.test.js:
 *   createOperation('feature', 'create', uuid, mapId, geojsonFeature) where the
 *   feature is { type:'Feature', geometry, properties:{ source:<type>, ...props } }.
 *
 * Each test self-provisions its own user + atlas + map for isolation. No UI clicks —
 * the transport is driven entirely through `page.evaluate`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * The six §8.2-7 military toolbar feature types under test: the `properties.source`
 * the frontend writes, the snapshot collection the backend files it into, a
 * representative GeoJSON geometry, and the domain properties that must round-trip
 * verbatim. The declination diagram (§8.7) persists as a `point` feature carrying
 * the WMM declination/north-reference props (the azimuth tool maps its output mode
 * to point/line/polygon via MODE_TO_SOURCE).
 * @type {Array<{ label: string, type: string, collection: string, geometry: Object, props: Object }>}
 */
const CASES = [
    {
        label: '§8.2 military_symbol',
        type: 'military_symbol',
        collection: 'military_symbols',
        geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
        props: { sidc: 'SFGPUCI-----', SIDC: 'SFGPUCI-----', rotation: 135, affiliation: 'friend', echelon: 'company', label: '1a Cia Fzo' },
    },
    {
        label: '§8.3 coordination_measure',
        type: 'coordination_measure',
        collection: 'coordination_measures',
        geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
        props: { measureType: 'boundary', label: 'LD VERDE', echelon: 'battalion' },
    },
    {
        label: '§8.4 arrow',
        type: 'arrow',
        collection: 'arrows',
        geometry: { type: 'LineString', coordinates: [[-43.22, -22.93], [-43.12, -22.83]] },
        props: { arrowType: 'attack', color: '#ff0000', width: 4 },
    },
    {
        label: '§8.5 boundary',
        type: 'boundary',
        collection: 'boundarys',
        geometry: { type: 'LineString', coordinates: [[-43.24, -22.95], [-43.14, -22.85]] },
        props: { boundaryType: 'phase_line', echelon: 'brigade', label: 'LP AZUL' },
    },
    {
        label: '§8.6 occupied_front',
        type: 'occupied_front',
        collection: 'occupied_fronts',
        geometry: { type: 'LineString', coordinates: [[-43.26, -22.97], [-43.16, -22.87]] },
        props: { frontType: 'defensive', echelon: 'company', label: 'FRENTE NORTE' },
    },
    {
        label: '§8.7 declination diagram',
        type: 'point',
        collection: 'points',
        geometry: { type: 'Point', coordinates: [-43.3, -23.0] },
        props: {
            tool: 'declinationDiagram',
            magneticDeclination: -21.5,
            northReference: 'magnetic',
            referencePoint: [-43.3, -23.0],
            convergence: 1.2,
        },
    },
];

describeOrSkip('Military symbology transport §8.2-7 (real Chromium + real backend)', () => {
    test('each military toolbar feature is filed into its OWN bucket with source + key props preserved', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, cases }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `mil_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Military Tools' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Military Tools Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'Mapa Operacoes' }),
            ]);

            // One create op per §8 type, with a unique per-feature marker, pushed in a
            // single atomic batch over real HTTP. The feature TYPE travels in
            // properties.source — the only thing the backend buckets on.
            const seeded = {};
            const ops = [];
            for (const c of cases) {
                const entityId = crypto.randomUUID();
                const marker = `mk_${c.type}_${crypto.randomUUID().slice(0, 8)}`;
                seeded[c.type] = { entityId, marker };
                ops.push(
                    createOperation('feature', 'create', entityId, mapId, {
                        type: 'Feature',
                        geometry: c.geometry,
                        properties: { source: c.type, marker, ...c.props },
                    }),
                );
            }
            const pushRes = await api.pushOperations(atlas.id, ops);

            // Read the persisted state back through a real snapshot pull.
            const pulled = await api.pullSync(atlas.id, 0);
            const map = (pulled.snapshot?.maps || []).find((m) => m.id === mapId);

            return {
                hasToken: Boolean(api.getAccessToken()),
                isSnapshot: pulled.isSnapshot,
                pushCount: pushRes.results?.length ?? null,
                pushAllOk: (pushRes.results || []).every((r) => r.success === true && r.idempotent === false),
                features: map?.features ?? null,
                seeded,
            };
        }, { baseUrl: state.baseUrl, cases: CASES });

        // Transport sanity (grounded, not vacuous): authenticated, atomic batch acked,
        // and a real snapshot came back with a feature map.
        expect(result.hasToken).toBe(true);
        expect(result.isSnapshot).toBe(true);
        expect(result.pushCount).toBe(CASES.length);
        expect(result.pushAllOk).toBe(true);
        expect(result.features).toBeTruthy();

        // Every §8 type must land in its OWN collection with source + props intact.
        for (const c of CASES) {
            const bucket = result.features[c.collection];
            expect(Array.isArray(bucket), `${c.label}: ${c.collection} must be an array`).toBe(true);

            const { entityId, marker } = result.seeded[c.type];
            const found = bucket.find((f) => f.properties && f.properties.id === entityId);
            expect(found, `${c.label}: must be filed into ${c.collection}`).toBeTruthy();

            // The backend tags it as a GeoJSON Feature whose source is its type.
            expect(found.type, `${c.label}: GeoJSON Feature`).toBe('Feature');
            expect(found.properties.source, `${c.label}: source preserved`).toBe(c.type);
            expect(found.properties.marker, `${c.label}: marker round-trips`).toBe(marker);

            // Geometry round-trips verbatim.
            expect(found.geometry, `${c.label}: geometry round-trips`).toEqual(c.geometry);

            // Every domain property survives the round-trip untouched (SIDC + rotation
            // for §8.2, measureType for §8.3, declination for §8.7, etc.).
            for (const [key, value] of Object.entries(c.props)) {
                expect(found.properties[key], `${c.label}: property ${key} must round-trip`).toEqual(value);
            }
        }

        // Cross-bucket isolation (negative): the military_symbol must appear ONLY in
        // its own collection, never leaking into a sibling military bucket.
        const symId = result.seeded.military_symbol.entityId;
        for (const c of CASES) {
            const bucket = result.features[c.collection] || [];
            const hits = bucket.filter((f) => f.properties && f.properties.id === symId);
            if (c.type === 'military_symbol') {
                expect(hits, 'military_symbol must appear exactly once in its bucket').toHaveLength(1);
            } else {
                expect(hits, `military_symbol must not leak into ${c.collection}`).toHaveLength(0);
            }
        }
    });

    /**
     * Why this expectation changed (2026-08-14).
     *
     * This test used to demand that `pushOperations` THROW, and it was red for as long
     * as the per-op SAVEPOINT has existed (2026-07-25), because the push does not throw
     * and must not: a whole-batch 400 is exactly the failure that change removed. The
     * client does not dequeue on a non-2xx, so a permanently poisonous op (the same
     * bytes fail forever) used to be replayed every 1.5s and that user's sync stopped,
     * silently and for good.
     *
     * What the backend actually does — verified against real Postgres in
     * backend/tests/integration/sync-unsupported-feature-source.test.js — is refuse the
     * op INDIVIDUALLY: the INSERT raises 23514 on `valid_feature_type`, the savepoint
     * rolls back log and effect together, and the 200 batch carries a per-operation ack
     * of `success: false` + `rejected: true` + a displayable `reason`. Nothing persists.
     *
     * So the guarantee is kept and what is asserted below is stronger than the old pair
     * (a throw is also satisfied by a 500, a timeout or a network error): the op must be
     * NAMED as refused, so the client can drop it knowing it never landed.
     *
     * The `leaked` assertion cannot carry this test on its own, and the negative control
     * proved it: with 'enemy_symbol' temporarily added to the CHECK, the row persisted in
     * Postgres and `leaked` was STILL false, because the snapshot builder has no bucket
     * for an unknown feature_type and drops the row on the way out. The ack is what
     * distinguishes "refused" from "written and invisible"; the row-level proof lives in
     * the backend test cited above.
     */
    test('edge: an unsupported military source is refused per-op and never persists', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `milx_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await api.register({ username, password, nome: 'Military Tools Edge' });
            await api.login(username, password);

            const atlas = await api.createAtlas({ name: 'Military Tools Edge Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [
                createOperation('map', 'create', mapId, null, { name: 'Mapa Edge' }),
            ]);

            // An unknown feature source is rejected by the valid_feature_type CHECK at
            // write time. Push it ALONE, which is the harshest shape: no sibling op keeps
            // the batch alive, so a regression that abandoned per-op refusal would show up
            // here as a rejected HTTP request instead of an acked refusal.
            const bogusId = crypto.randomUUID();
            const bogusOp = createOperation('feature', 'create', bogusId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { source: 'enemy_symbol', marker: 'mk_bogus' },
            });
            let threw = false;
            let ack = null;
            try {
                const pushRes = await api.pushOperations(atlas.id, [bogusOp]);
                ack = (pushRes.results || []).find((r) => r.operationId === bogusOp.id) ?? null;
            } catch {
                threw = true;
            }

            // The rejected row must not surface in ANY bucket of the snapshot.
            const pulled = await api.pullSync(atlas.id, 0);
            const map = (pulled.snapshot?.maps || []).find((m) => m.id === mapId);
            const leaked = Object.values(map?.features || {})
                .filter(Array.isArray)
                .flat()
                .some((f) => f.properties && f.properties.id === bogusId);

            return { threw, ack, leaked };
        }, state.baseUrl);

        // The transport completes: the batch is answered, not blown up.
        expect(result.threw).toBe(false);

        // …and the offending op is named as REFUSED, which is what lets the client drop
        // it instead of replaying it forever. `success: true` here would be the real
        // defect: the client would believe an unsupported feature had synced.
        expect(result.ack, 'the push must ack the offending op by id').toBeTruthy();
        expect(result.ack.success, 'a refused op is never acked as success').toBe(false);
        expect(result.ack.rejected, 'the refusal is explicit').toBe(true);
        expect(typeof result.ack.reason, 'the refusal carries a displayable reason').toBe('string');
        expect(result.ack.reason.length).toBeGreaterThan(0);

        // And nothing leaked: the row never reached any bucket of the snapshot.
        expect(result.leaked).toBe(false);
    });
});

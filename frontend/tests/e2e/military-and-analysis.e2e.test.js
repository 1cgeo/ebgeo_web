// Path: tests/e2e/military-and-analysis.e2e.test.js

/**
 * @fileoverview E2E (§8/§9): round-trips the military-symbology and analysis feature
 * families through real HTTP push/pull against the live backend. Creates one feature of
 * each type (military_symbol, coordination_measure, los, visibility, processed_los,
 * processed_visibility) carrying TYPE-SPECIFIC properties and `properties.source=type`,
 * then asserts the server snapshot files each one into its dedicated collection bucket
 * (military_symbols, coordination_measures, los, visibility, processed_los,
 * processed_visibility) with its geometry and domain properties preserved verbatim.
 *
 * Drives the backend only through the public ApiClient + createOperation — real HTTP
 * round-trips, observable state asserted via api.pullSync. No DB access.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * The six military/analysis feature types under test, the snapshot collection each
 * lands in, a representative GeoJSON geometry, and the type-specific properties that
 * must round-trip untouched through the backend.
 * @type {Array<{ type: string, collection: string, geometry: Object, props: Object }>}
 */
const CASES = [
    {
        type: 'military_symbol',
        collection: 'military_symbols',
        geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
        props: { sidc: 'SFGPUCI-----', affiliation: 'friend', echelon: 'company', label: '1a Cia Fzo' },
    },
    {
        type: 'coordination_measure',
        collection: 'coordination_measures',
        geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
        props: { measureType: 'boundary', label: 'LD VERDE', echelon: 'battalion' },
    },
    {
        type: 'los',
        collection: 'los',
        geometry: { type: 'LineString', coordinates: [[-43.25, -22.95], [-43.15, -22.85]] },
        props: { observerHeight: 1.8, targetHeight: 2, sampleCount: 256 },
    },
    {
        type: 'visibility',
        collection: 'visibility',
        geometry: { type: 'Point', coordinates: [-43.22, -22.92] },
        props: { observerHeight: 2.5, radius: 5000, ringCount: 360 },
    },
    {
        type: 'processed_los',
        collection: 'processed_los',
        geometry: { type: 'LineString', coordinates: [[-43.26, -22.96], [-43.16, -22.86]] },
        props: { visible: true, obstructionDistance: 1234.5, profile: [0, 12, 30, 8] },
    },
    {
        type: 'processed_visibility',
        collection: 'processed_visibility',
        geometry: {
            type: 'Polygon',
            coordinates: [[[-43.3, -23], [-43.2, -23], [-43.2, -22.9], [-43.3, -22.9], [-43.3, -23]]],
        },
        props: { coveragePercent: 42.7, computedAt: 1718800000000, cellSize: 30 },
    },
];

/**
 * Builds a raw GeoJSON Feature whose type travels in `properties.source`, tagged with a
 * unique marker plus the case's domain properties.
 * @param {{ type: string, geometry: Object, props: Object }} c
 * @param {string} marker
 * @returns {Object}
 */
function makeFeatureData(c, marker) {
    return {
        type: 'Feature',
        geometry: c.geometry,
        properties: { source: c.type, marker, ...c.props },
    };
}

describe.skipIf(E2E_SKIP)('e2e: military-and-analysis', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;
    /** @type {Map<string, { entityId: string, marker: string }>} type -> seeded ids */
    const seeded = new Map();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Military & Analysis E2E' });
        const atlas = await createAtlas(api, { name: 'Military Analysis Atlas' });
        atlasId = atlas.id;
        expect(atlasId).toBeTruthy();
        mapId = await createMap(api, atlasId, { name: 'Mapa Operacoes' });
        expect(mapId).toBeTruthy();

        // One create op per type, pushed in a single atomic batch over real HTTP.
        const ops = [];
        for (const c of CASES) {
            const entityId = generateUUID();
            const marker = `mk_${c.type}_${generateUUID().slice(0, 8)}`;
            seeded.set(c.type, { entityId, marker });
            ops.push(createOperation('feature', 'create', entityId, mapId, makeFeatureData(c, marker)));
        }

        const res = await api.pushOperations(atlasId, ops);
        expect(res.results).toHaveLength(CASES.length);
        for (const r of res.results) {
            expect(r.success).toBe(true);
            expect(r.idempotent).toBe(false);
        }
        expect(res.serverVersion).toBeGreaterThan(0);
    }, 30000);

    afterAll(async () => {
        if (api) await api.logout().catch(() => {});
    });

    it('buckets each military/analysis type into its own collection with props preserved', async () => {
        const pulled = await api.pullSync(atlasId, 0);
        expect(pulled.isSnapshot).toBe(true);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'seeded map must be present in snapshot').toBeTruthy();
        const buckets = map.features;

        for (const c of CASES) {
            const arr = buckets[c.collection];
            expect(Array.isArray(arr), `${c.collection} must be an array`).toBe(true);

            const { entityId, marker } = seeded.get(c.type);
            const found = arr.find((f) => f.properties && f.properties.id === entityId);
            expect(found, `type ${c.type} must land in ${c.collection}`).toBeTruthy();

            // Server tags the feature with its source type and is a GeoJSON Feature.
            expect(found.type).toBe('Feature');
            expect(found.properties.source).toBe(c.type);
            expect(found.properties.marker).toBe(marker);

            // Geometry round-trips verbatim (point / line / polygon shapes intact).
            expect(found.geometry).toEqual(c.geometry);

            // Every type-specific domain property survives the round-trip untouched.
            for (const [key, value] of Object.entries(c.props)) {
                expect(found.properties[key], `${c.type}.${key} must round-trip`).toEqual(value);
            }
        }
    });

    it('does not leak an analysis feature into a sibling collection (negative)', async () => {
        const pulled = await api.pullSync(atlasId, 0);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        const buckets = map.features;

        // The processed_visibility feature's id must appear ONLY in its own bucket.
        const targetId = seeded.get('processed_visibility').entityId;
        const allCollections = CASES.map((c) => c.collection);
        for (const collection of allCollections) {
            const arr = buckets[collection] || [];
            const hits = arr.filter((f) => f.properties && f.properties.id === targetId);
            if (collection === 'processed_visibility') {
                expect(hits, 'feature must appear exactly once in its bucket').toHaveLength(1);
            } else {
                expect(hits, `processed_visibility must not leak into ${collection}`).toHaveLength(0);
            }
        }
    });

    it('refuses an unsupported feature type per-op, inserting nothing while its batch sibling applies', async () => {
        // The backend CHECK constraint still hard-rejects unknown feature types, and
        // the bogus row must never be persisted. What changed (2026-07-24) is the
        // blast radius: a data violation (SQLSTATE class 22/23) is now refused
        // PER-OPERATION — HTTP 200, `rejected: true`, generic pt-BR reason — and each
        // op runs inside its own savepoint, so the VALID sibling in the same batch is
        // committed. Before, the whole batch aborted with 400 and the sibling was
        // lost. Both halves are asserted below: nothing for the invalid op,
        // everything for its neighbour.
        const bogusId = generateUUID();
        const siblingCase = {
            type: 'military_symbol',
            geometry: { type: 'Point', coordinates: [-43.19, -22.93] },
            props: { sidc: 'SFGPUCI-----', label: 'Sibling do lote' },
        };
        const siblingId = generateUUID();
        const siblingMarker = `mk_sibling_${generateUUID().slice(0, 8)}`;

        const res = await api.pushOperations(atlasId, [
            createOperation(
                'feature',
                'create',
                bogusId,
                mapId,
                makeFeatureData(
                    { type: 'enemy_los', geometry: { type: 'Point', coordinates: [0, 0] }, props: {} },
                    'mk_bogus',
                ),
            ),
            createOperation('feature', 'create', siblingId, mapId, makeFeatureData(siblingCase, siblingMarker)),
        ]);

        expect(res.results).toHaveLength(2);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].rejected).toBe(true);
        // Generic, user-facing pt-BR reason: the driver text (constraint name,
        // err.detail) must never reach the client.
        expect(res.results[0].reason).toMatch(/^Alteração descartada:/);
        expect(res.results[0].reason).not.toMatch(/constraint|features_|enemy_los/i);
        expect(res.results[1].success).toBe(true);
        expect(res.results[1].rejected).toBeUndefined();

        const after = await api.pullSync(atlasId, 0);
        const afterMap = after.snapshot.maps.find((m) => m.id === mapId);
        const leaked = Object.values(afterMap.features)
            .filter(Array.isArray)
            .flat()
            .some((f) => f.properties && f.properties.id === bogusId);
        expect(leaked, 'unsupported feature type must not appear in any bucket').toBe(false);

        // The savepoint isolated the failure: the sibling really committed.
        const sibling = afterMap.features.military_symbols.find((f) => f.properties.id === siblingId);
        expect(sibling, 'valid sibling of a refused op must be persisted').toBeTruthy();
        expect(sibling.properties.marker).toBe(siblingMarker);
    });
});

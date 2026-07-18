// Path: tests/e2e/feature-types-all.e2e.test.js

/**
 * @fileoverview E2E: round-trips a feature of EVERY backend feature type through a
 * real HTTP push and asserts the server's snapshot buckets each one under the right
 * collection. Drives the live backend only via the public ApiClient + createOperation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

/**
 * The 18 frontend feature types and the snapshot collection each lands in.
 * Mirrors the backend's `transformFeaturesToFrontend` typeToCollection map.
 * @type {Array<[string, string]>}
 */
const TYPE_TO_COLLECTION = [
    ['point', 'points'],
    ['line', 'lines'],
    ['polygon', 'polygons'],
    ['text', 'texts'],
    ['image', 'images'],
    ['circle', 'circles'],
    ['rectangle', 'rectangles'],
    ['ellipse', 'ellipses'],
    ['brush', 'brushes'],
    ['arrow', 'arrows'],
    ['boundary', 'boundarys'],
    ['occupied_front', 'occupied_fronts'],
    ['military_symbol', 'military_symbols'],
    ['coordination_measure', 'coordination_measures'],
    ['los', 'los'],
    ['visibility', 'visibility'],
    ['processed_los', 'processed_los'],
    ['processed_visibility', 'processed_visibility'],
];

/**
 * Builds a raw GeoJSON Feature whose type travels in properties.source, tagged with a
 * unique marker so we can find this exact feature in the snapshot bucket.
 * @param {string} type
 * @param {string} marker
 * @returns {Object}
 */
function makeFeatureData(type, marker) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.18 + Math.random(), -22.9 + Math.random()] },
        properties: { source: type, marker },
    };
}

describe.skipIf(E2E_SKIP)('e2e: feature-types-all', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;
    /** @type {Map<string, string>} type -> entityId */
    const featureIdByType = new Map();
    /** @type {Map<string, string>} type -> unique marker */
    const markerByType = new Map();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Feature Types E2E' });
        const atlas = await createAtlas(api, { name: 'Feature Types Atlas' });
        atlasId = atlas.id;
        expect(atlasId).toBeTruthy();
        mapId = await createMap(api, atlasId, { name: 'Mapa Tipos' });
        expect(mapId).toBeTruthy();

        // One create op per type, pushed in a single batch over real HTTP. Each
        // feature gets a real uuid entityId and a unique marker for later lookup.
        const ops = [];
        for (const [type] of TYPE_TO_COLLECTION) {
            const entityId = crypto.randomUUID();
            const marker = `mk_${type}_${crypto.randomUUID().slice(0, 8)}`;
            featureIdByType.set(type, entityId);
            markerByType.set(type, marker);
            ops.push(createOperation('feature', 'create', entityId, mapId, makeFeatureData(type, marker)));
        }

        const res = await api.pushOperations(atlasId, ops);
        // Every op must be acked as a fresh (non-idempotent) success.
        expect(res.results).toHaveLength(TYPE_TO_COLLECTION.length);
        for (const r of res.results) {
            expect(r.success).toBe(true);
            expect(r.idempotent).toBe(false);
        }
        expect(res.serverVersion).toBeGreaterThan(0);
    }, 30000);

    it('returns a full snapshot containing the seeded map', async () => {
        const pulled = await api.pullSync(atlasId, 0);
        expect(pulled.isSnapshot).toBe(true);
        expect(pulled.snapshot).toBeTruthy();
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'seeded map must be present in snapshot').toBeTruthy();
        expect(map.features).toBeTruthy();
    });

    it('buckets each of the 18 feature types into its own collection', async () => {
        const pulled = await api.pullSync(atlasId, 0);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        const buckets = map.features;

        for (const [type, collection] of TYPE_TO_COLLECTION) {
            const arr = buckets[collection];
            expect(Array.isArray(arr), `${collection} must be an array`).toBe(true);

            const expectedId = featureIdByType.get(type);
            const expectedMarker = markerByType.get(type);
            const found = arr.find((f) => f.properties && f.properties.id === expectedId);

            expect(found, `type ${type} must land in ${collection}`).toBeTruthy();
            // The server tags every feature with its source type in properties.source.
            expect(found.properties.source).toBe(type);
            expect(found.properties.marker).toBe(expectedMarker);
            expect(found.type).toBe('Feature');
            expect(found.geometry.type).toBe('Point');
        }
    });

    it('does not leak a feature into a sibling collection (negative)', async () => {
        const pulled = await api.pullSync(atlasId, 0);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        const buckets = map.features;

        // The 'point' feature's id must appear ONLY in `points`, nowhere else.
        const pointId = featureIdByType.get('point');
        for (const [, collection] of TYPE_TO_COLLECTION) {
            const arr = buckets[collection] || [];
            const hits = arr.filter((f) => f.properties && f.properties.id === pointId);
            if (collection === 'points') {
                expect(hits).toHaveLength(1);
            } else {
                expect(hits, `point must not leak into ${collection}`).toHaveLength(0);
            }
        }

        // An unknown/unsupported feature type is rejected by the server's CHECK
        // constraint (HTTP 400) — the row is never inserted, so it can never leak
        // into any bucket. The contract is a hard reject, not a silent bucket-drop.
        const unknownId = crypto.randomUUID();
        await expect(
            api.pushOperations(atlasId, [
                createOperation('feature', 'create', unknownId, mapId, makeFeatureData('not_a_real_type', 'mk_bogus')),
            ]),
        ).rejects.toThrow();
        const after = await api.pullSync(atlasId, 0);
        const afterMap = after.snapshot.maps.find((m) => m.id === mapId);
        const leaked = Object.values(afterMap.features)
            .filter(Array.isArray)
            .flat()
            .some((f) => f.properties && f.properties.id === unknownId);
        expect(leaked, 'unknown feature type must not appear in any bucket').toBe(false);
    });
});

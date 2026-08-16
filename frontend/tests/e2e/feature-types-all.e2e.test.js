// Path: tests/e2e/feature-types-all.e2e.test.js

/**
 * @fileoverview E2E: round-trips a feature of EVERY backend feature type (list DERIVED, never counted) through a
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
import { FEATURE_TYPE_MAPPINGS } from '../../src/js/store/store.constants.js';

/**
 * Every frontend feature type and the snapshot collection it lands in, DERIVED.
 *
 * It used to be eighteen pairs written out by hand, under a JSDoc that said "the 18
 * frontend feature types" and a case named "buckets each of the 18 feature types". The map
 * it claimed to mirror (`transformFeaturesToFrontend`, `backend/src/modules/sync/sync.service.js`)
 * has TWENTY: `sector` and `magnetic_declination` were missing here and present there, and
 * both sides of the round trip handled them correctly the whole time. So the sweep announced
 * completeness over a subset and reported success — a false green inside the very command
 * the Definition of Done names, and the most dangerous kind of copy, because it wears the
 * clothes of a verification.
 *
 * `FEATURE_TYPE_MAPPINGS` is itself derived from `store/feature-type.registry.js`, so a type
 * born there reaches this sweep with no edit here. The absolute floor below is what keeps
 * the derivation from failing silently: a broken import that yielded `{}` would make every
 * loop below iterate zero times and pass.
 * @type {Array<[string, string]>}
 */
const TYPE_TO_COLLECTION = Object.entries(FEATURE_TYPE_MAPPINGS);

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

    it('the sweep covers every bucket the LIVE server declares, so it cannot silently shrink', async () => {
        // The floor that the old hand-written list did not have. `transformFeaturesToFrontend`
        // (backend) builds one bucket per type it knows; a type present there and absent from
        // this sweep is exactly the hole that lived here for months, and comparing against a
        // NUMBER would only have frozen it. Comparing against the live snapshot closes it
        // against the server itself, which is the authority.
        const pulled = await api.pullSync(atlasId, 0);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);

        const doServidor = Object.keys(map.features).filter((k) => Array.isArray(map.features[k])).sort();
        const daVarredura = TYPE_TO_COLLECTION.map(([, collection]) => collection).sort();

        // Absolute, so a derivation that broke and yielded `{}` cannot pass by being a
        // subset of everything.
        expect(daVarredura.length, 'the derived type list came back empty or truncated')
            .toBeGreaterThanOrEqual(20);
        expect(doServidor, 'the server declares a bucket this sweep never pushes into')
            .toEqual(daVarredura);
    });

    it('buckets each feature type into its own collection', async () => {
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

        // An unknown/unsupported feature type still violates the server's CHECK
        // constraint, and the row is never inserted, so it can never leak into any
        // bucket. What changed (2026-07-24) is the refusal SHAPE: a data violation
        // (SQLSTATE class 22/23) is now per-operation — HTTP 200 with
        // `rejected: true` and a generic pt-BR reason that never echoes the driver
        // text — instead of aborting the whole batch with 400. The contract is
        // still a hard reject, not a silent bucket-drop.
        // This op travels ALONE, so what it pins is only "the invalid op writes
        // nothing"; the sibling-survives half is pinned in
        // military-and-analysis.e2e.test.js.
        const unknownId = crypto.randomUUID();
        const rejectRes = await api.pushOperations(atlasId, [
            createOperation('feature', 'create', unknownId, mapId, makeFeatureData('not_a_real_type', 'mk_bogus')),
        ]);
        expect(rejectRes.results).toHaveLength(1);
        expect(rejectRes.results[0].success).toBe(false);
        expect(rejectRes.results[0].rejected).toBe(true);
        expect(rejectRes.results[0].reason).toMatch(/^Alteração descartada:/);
        // The reason must stay a user-facing message: no constraint/index names.
        expect(rejectRes.results[0].reason).not.toMatch(/constraint|features_|check/i);

        const after = await api.pullSync(atlasId, 0);
        const afterMap = after.snapshot.maps.find((m) => m.id === mapId);
        const leaked = Object.values(afterMap.features)
            .filter(Array.isArray)
            .flat()
            .some((f) => f.properties && f.properties.id === unknownId);
        expect(leaked, 'unknown feature type must not appear in any bucket').toBe(false);
    });
});

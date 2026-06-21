// Path: tests/e2e/batch-atomicity.e2e.test.js

/**
 * @fileoverview E2E for §29.12 batch atomicity against the live backend. A single
 * sync push is one transaction: if any op in the batch is rejected, the whole
 * batch rolls back. Here a batch of [valid feature create, feature update whose
 * `map_id` points to a DIFFERENT atlas's map] must fail with 403 (cross-atlas
 * guard), and — crucially — the valid create in the SAME batch must NOT persist.
 * A separately pushed fully-valid batch of 3 creates must all persist.
 *
 * Every assertion checks observable backend state via api.pullSync snapshots;
 * the 403 is asserted on the thrown ApiError.status. Real HTTP round-trips only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a feature `create` op carrying a raw GeoJSON Point Feature whose feature
 * type lives in `properties.source` (frozen frontend contract).
 * @param {string} featureId
 * @param {string} mapId
 * @param {Array<number>} coordinates - [lng, lat]
 * @returns {Object} sync operation
 */
function pointCreateOp(featureId, mapId, coordinates) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: { source: 'point', layerId: null },
    });
}

/** Pulls a fresh snapshot and returns the map object matching `mapId`. */
async function pullMap(api, atlasId, mapId) {
    const r = await api.pullSync(atlasId, 0);
    expect(r.isSnapshot).toBe(true);
    expect(r.snapshot).toBeTruthy();
    const map = r.snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return map;
}

/** True when a point feature with `featureId` exists in the map's points bucket. */
function hasPoint(map, featureId) {
    return (map.features.points || []).some((f) => f.properties.id === featureId);
}

describe.skipIf(E2E_SKIP)('E2E batch-atomicity', () => {
    let api;
    let atlasId;
    let mapId;
    let foreignMapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Batch Atomicity Owner' });
        const atlas = await createAtlas(api, { name: 'Batch Atomicity Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Batch' });

        // A SECOND atlas owned by the same user, supplying a map id that does NOT
        // belong to `atlasId` — the cross-atlas reference the rejected op targets.
        const foreign = await createAtlas(api, { name: 'Batch Atomicity Foreign' });
        foreignMapId = await createMap(api, foreign.id, { name: 'Mapa Foreign' });
        expect(foreignMapId).not.toBe(mapId);
    });

    it('rolls back the whole batch (403) when one op references a foreign atlas map', async () => {
        const goodCreateId = generateUUID();
        const victimId = generateUUID();

        // Pre-seed a feature we will try to "move" cross-atlas in the same batch.
        const seed = await api.pushOperations(atlasId, [
            pointCreateOp(victimId, mapId, [-43.18, -22.90]),
        ]);
        expect(seed.results[0].success).toBe(true);

        const before = await pullMap(api, atlasId, mapId);
        expect(hasPoint(before, victimId)).toBe(true);
        expect(hasPoint(before, goodCreateId)).toBe(false);

        // Batch: [valid create] + [update whose changes.map_id is a DIFFERENT atlas's
        // map]. The update is the frontend `data` payload; the backend reads it as
        // `changes`, sees `map_id`, and rejects the entire transaction with 403.
        const batch = [
            pointCreateOp(goodCreateId, mapId, [-43.20, -22.95]),
            createOperation('feature', 'update', victimId, mapId, {
                map_id: foreignMapId,
            }),
        ];

        let thrown;
        try {
            await api.pushOperations(atlasId, batch);
        } catch (e) {
            thrown = e;
        }
        expect(thrown, 'push must reject').toBeTruthy();
        expect(thrown.status).toBe(403);

        // Atomicity: the VALID create in the rejected batch must NOT have persisted.
        const after = await pullMap(api, atlasId, mapId);
        expect(hasPoint(after, goodCreateId)).toBe(false);

        // The victim survives unmoved: still present in this atlas's map, never
        // relocated by the rejected cross-atlas update (negative leak assertion).
        expect(hasPoint(after, victimId)).toBe(true);
    });

    it('persists every op of a fully-valid batch of 3 creates', async () => {
        const ids = [generateUUID(), generateUUID(), generateUUID()];
        const batch = [
            pointCreateOp(ids[0], mapId, [-43.10, -22.80]),
            pointCreateOp(ids[1], mapId, [-43.11, -22.81]),
            pointCreateOp(ids[2], mapId, [-43.12, -22.82]),
        ];

        const res = await api.pushOperations(atlasId, batch);
        expect(res.results).toHaveLength(3);
        expect(res.results.every((r) => r.success)).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        for (const id of ids) {
            expect(hasPoint(map, id), `feature ${id} persisted`).toBe(true);
        }
    });
});

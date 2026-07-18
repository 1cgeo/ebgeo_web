// Path: tests/e2e/cross-atlas-idor.e2e.test.js

/**
 * @fileoverview E2E negative test for the cross-atlas IDOR guard. The backend
 * pins map-scoped writes to the ROUTE atlas via `WHERE EXISTS (maps.atlas_id = ...)`.
 * Pushing a feature op to atlas A while supplying a mapId that belongs to atlas B
 * must insert zero rows, so the feature appears in NEITHER atlas's snapshot.
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
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Counts the point features across all maps in a pullSync snapshot whose feature
 * id matches the given id.
 * @param {Object} snapshot - The snapshot from pullSync (snapshot.maps[].features.points).
 * @param {string} featureId
 * @returns {number}
 */
function countFeatureInSnapshot(snapshot, featureId) {
    let n = 0;
    for (const map of snapshot.maps || []) {
        const points = (map.features && map.features.points) || [];
        for (const f of points) {
            if (f.properties && f.properties.id === featureId) n += 1;
        }
    }
    return n;
}

describe.skipIf(E2E_SKIP)('cross-atlas-idor', () => {
    let api;
    let atlasA;
    let atlasB;
    let mapAId;
    let mapBId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'IDOR Owner' });
        atlasA = await createAtlas(api, { name: 'Atlas A (IDOR)' });
        atlasB = await createAtlas(api, { name: 'Atlas B (IDOR)' });
        mapAId = await createMap(api, atlasA.id, { name: 'Map A' });
        mapBId = await createMap(api, atlasB.id, { name: 'Map B' });
    });

    it('drops a feature pushed to atlas A under atlas B\'s mapId (EXISTS guard)', async () => {
        // Sanity: maps were really created and live in their own atlases.
        const snapA0 = (await api.pullSync(atlasA.id, 0)).snapshot;
        const snapB0 = (await api.pullSync(atlasB.id, 0)).snapshot;
        expect(snapA0.maps.some((m) => m.id === mapAId)).toBe(true);
        expect(snapB0.maps.some((m) => m.id === mapBId)).toBe(true);
        expect(snapA0.maps.some((m) => m.id === mapBId)).toBe(false);
        expect(snapB0.maps.some((m) => m.id === mapAId)).toBe(false);

        // Forge a feature op routed to atlas A but carrying atlas B's mapId.
        const featureId = generateUUID();
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { id: featureId, source: 'point', layerId: null, name: 'idor probe' },
        };
        const op = createOperation('feature', 'create', featureId, mapBId, feature);

        // Pushed to atlas A's route — the server still acks the op (it is logged),
        // but the INSERT...WHERE EXISTS(maps.atlas_id = A) matches zero rows because
        // mapBId belongs to atlas B.
        const res = await api.pushOperations(atlasA.id, [op]);
        expect(res.results).toHaveLength(1);
        expect(res.results[0].success).toBe(true);
        expect(res.results[0].operationId).toBe(op.id);

        // The feature must appear in NEITHER atlas snapshot.
        const snapA = (await api.pullSync(atlasA.id, 0)).snapshot;
        const snapB = (await api.pullSync(atlasB.id, 0)).snapshot;
        expect(countFeatureInSnapshot(snapA, featureId)).toBe(0);
        expect(countFeatureInSnapshot(snapB, featureId)).toBe(0);

        // Edge/positive control: the SAME feature pushed to atlas A under atlas A's
        // own mapId DOES land — proving the drop above was the guard, not a bug in
        // the create path or the snapshot reader.
        const okId = generateUUID();
        const okFeature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.1, -22.8] },
            properties: { id: okId, source: 'point', layerId: null, name: 'legit point' },
        };
        const okOp = createOperation('feature', 'create', okId, mapAId, okFeature);
        await api.pushOperations(atlasA.id, [okOp]);

        const snapAok = (await api.pullSync(atlasA.id, 0)).snapshot;
        const snapBok = (await api.pullSync(atlasB.id, 0)).snapshot;
        expect(countFeatureInSnapshot(snapAok, okId)).toBe(1);
        // ...and it stays scoped to atlas A only.
        expect(countFeatureInSnapshot(snapBok, okId)).toBe(0);
    });
});

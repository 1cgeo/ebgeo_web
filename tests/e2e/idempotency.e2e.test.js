// Path: tests/e2e/idempotency.e2e.test.js

/**
 * @fileoverview E2E: op-id idempotency against the live backend.
 *
 * Contract under test (backend `pushOperations`): operations are inserted into the
 * log with `ON CONFLICT (atlas_id, op_id) DO NOTHING`, so re-pushing an op carrying
 * the SAME `id` must NOT create a second entity and must ack `idempotent: true`.
 * We verify the effect end-to-end via a real snapshot pull (the feature appears
 * exactly once) and assert the ack flags on both the first and the duplicate push.
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

describe.skipIf(E2E_SKIP)('e2e: op-id idempotency', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Idempotency Tester' });
        const atlas = await createAtlas(api, { name: 'Idempotency Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Idem' });
    });

    /**
     * Builds a GeoJSON point feature create op (type in properties.source).
     * @param {string} featureId
     * @returns {object}
     */
    function buildFeatureOp(featureId) {
        return createOperation('feature', 'create', featureId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { source: 'point', layerId: null, label: 'Idem Point' },
        });
    }

    it('creates the entity once and acks the duplicate as idempotent', async () => {
        const op = buildFeatureOp('11111111-2222-3333-4444-555555555555');

        // First push: the op is brand new -> applied, ack idempotent:false.
        const first = await api.pushOperations(atlasId, [op]);
        expect(first.acks).toHaveLength(1);
        expect(first.acks[0].opId).toBe(op.id);
        expect(first.acks[0].idempotent).toBe(false);
        expect(first.results[0].idempotent).toBe(false);
        expect(first.results[0].operationId).toBe(op.id);
        const firstVersion = first.acks[0].serverVersion;
        expect(Number(firstVersion)).toBeGreaterThan(0);

        // Second push of the SAME op object (same id/op_id) -> no-op, idempotent ack.
        const second = await api.pushOperations(atlasId, [op]);
        expect(second.acks).toHaveLength(1);
        expect(second.acks[0].opId).toBe(op.id);
        expect(second.acks[0].idempotent).toBe(true);
        expect(second.results[0].idempotent).toBe(true);
        // The recorded server_version of the original op is echoed back unchanged.
        expect(Number(second.acks[0].serverVersion)).toBe(Number(firstVersion));

        // Observable backend state: a fresh full snapshot has the feature exactly once.
        const pull = await api.pullSync(atlasId, 0);
        expect(pull.isSnapshot).toBe(true);
        const snapMap = pull.snapshot.maps.find((m) => m.id === mapId);
        expect(snapMap).toBeTruthy();
        const points = snapMap.features.points;
        const matches = points.filter((f) => f.properties.id === op.entityId);
        expect(matches).toHaveLength(1);
        expect(matches[0].geometry.coordinates).toEqual([-43.2, -22.9]);
        expect(matches[0].properties.source).toBe('point');
    });

    it('does not duplicate even when the same op is replayed inside one batch', async () => {
        const op = buildFeatureOp('66666666-7777-8888-9999-aaaaaaaaaaaa');

        // Same op twice in ONE request body: the first applies, the second hits the
        // op_id conflict and is acked idempotent -> still a single feature.
        const res = await api.pushOperations(atlasId, [op, op]);
        expect(res.acks).toHaveLength(2);
        expect(res.acks[0].idempotent).toBe(false);
        expect(res.acks[1].idempotent).toBe(true);

        const pull = await api.pullSync(atlasId, 0);
        const snapMap = pull.snapshot.maps.find((m) => m.id === mapId);
        const matches = snapMap.features.points.filter(
            (f) => f.properties.id === op.entityId,
        );
        // Negative/edge assertion: NOT two copies despite the duplicated batch entry.
        expect(matches).toHaveLength(1);
    });
});

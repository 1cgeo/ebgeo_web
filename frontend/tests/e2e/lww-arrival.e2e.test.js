// Path: tests/e2e/lww-arrival.e2e.test.js
import {
    confirmedFeature,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';

/**
 * Confirmed sequential edits follow server order even if a client's wall clock
 * moves backwards. Each update uses the preceding confirmed revision; concurrent
 * stale edits are covered separately by concurrent-update-converge.e2e.test.js.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a raw GeoJSON 'point' feature op payload. The backend reads the type
 * from `properties.source` and the layer from `properties.layerId`, and stores
 * the properties as JSONB after merging the versioned patch.
 * @param {string} featureId
 * @param {Object} props - Extra properties merged on top of the base contract.
 * @returns {Object}
 */
function pointFeatureData(featureId, props = {}) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: {
            id: featureId,
            source: 'point',
            ...props,
        },
    };
}

/**
 * Pulls a full snapshot and returns the first 'point' feature matching `id`.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @param {string} featureId
 * @returns {Promise<Object|null>}
 */
async function findPoint(api, atlasId, mapId, featureId) {
    const res = await api.pullSync(atlasId, 0);
    if (!res.isSnapshot || !res.snapshot) return null;
    const map = (res.snapshot.maps || []).find((m) => m.id === mapId);
    if (!map) return null;
    const points = (map.features && map.features.points) || [];
    return points.find((f) => f.properties && f.properties.id === featureId) || null;
}

describe.skipIf(E2E_SKIP)('e2e: confirmed revisions ignore wall-clock order', () => {
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'LWW Arrival' });
        const atlas = await createAtlas(api, { name: 'LWW Arrival Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa LWW' });
        expect(atlasId).toBeTruthy();
        expect(mapId).toBeTruthy();
    });

    it('last-arriving update wins even when it carries the SMALLER timestamp', async () => {
        const featureId = generateUUID();

        // Create the feature with a baseline label.
        const createOp = createOperation(
            'feature', 'create', featureId, mapId,
            pointFeatureData(featureId, { label: 'inicial' }),
        );
        await api.pushOperations(atlasId, [createOp]);

        // Sanity: the feature exists in the snapshot with the baseline label.
        const created = await waitFor(() => findPoint(api, atlasId, mapId, featureId));
        expect(created.properties.label).toBe('inicial');

        // A later confirmed revision remains valid after a wall-clock rollback.
        const opA = createOperation(
            'feature', 'update', featureId, mapId,
            pointFeatureData(featureId, { label: 'primeiro-arrival', winner: false }), created,
        );
        // Force opA (first arrival) to have the LARGER wall-clock timestamp.
        opA.timestamp = 9_000_000_000_000; // far future

        // Push them in arrival order A then B (separate requests guarantee ordering).
        const ackA = await api.pushOperations(atlasId, [opA]);
        expect(ackA.results[0].success).toBe(true);
        const opB = createOperation(
            'feature', 'update', featureId, mapId,
            pointFeatureData(featureId, { label: 'segundo-arrival', winner: true }),
            await confirmedFeature(api, atlasId, mapId, featureId),
        );
        opB.timestamp = 1_000;
        expect(opA.timestamp).toBeGreaterThan(opB.timestamp);
        await api.pushOperations(atlasId, [opB]);

        // The LAST arrival (opB) wins despite the smaller timestamp.
        const after = await waitFor(async () => {
            const f = await findPoint(api, atlasId, mapId, featureId);
            return f && f.properties.label === 'segundo-arrival' ? f : null;
        });
        expect(after.properties.label).toBe('segundo-arrival');
        expect(after.properties.winner).toBe(true);

        // Negative assertion: the earlier (larger-timestamp) write must NOT survive.
        // The explicit patch replaces both the label and its flag.
        expect(after.properties.label).not.toBe('primeiro-arrival');
        expect(after.properties.label).not.toBe('inicial');
        expect(after.properties.winner).not.toBe(false);
    });
});

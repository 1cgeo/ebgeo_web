// Path: tests/e2e/lock-enforcement.e2e.test.js

/**
 * @fileoverview E2E map-lock enforcement against the live backend (spec §1.5/§2.5).
 *
 * Scenario, driven only through the public ApiClient + createOperation + harness:
 *  1. The owner creates an atlas + map and grants a SECOND user `write` access via
 *     `POST /atlas/:id/sharing/users`.
 *  2. The owner pushes a map update `{ locked: true }` (lock/unlock is owner-only).
 *  3. The write-share user's feature create on that locked map is rejected with 409
 *     (`ConflictError` -> `ApiError`), and a NEGATIVE assertion confirms the feature
 *     never reached the snapshot.
 *  4. As an edge control, the write-share user also CANNOT flip the lock itself
 *     (lock/unlock is owner-only -> 403), proving the gate is authorization, not luck.
 *  5. The owner unlocks `{ locked: false }`; the same user's feature write now
 *     succeeds (200) and appears in the pullSync snapshot's points bucket.
 *
 * Every assertion checks observable backend state (snapshot or the thrown ApiError);
 * no direct DB access. The test owns its api/users/atlas/map for isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { ApiError } from '../../src/js/store/sync/api-client.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a feature `create` op carrying a raw GeoJSON point Feature (feature type in
 * the frozen `properties.source` slot the backend derives from).
 * @param {string} featureId - Entity id for the new feature.
 * @param {string} mapId - Parent map id (lock context).
 * @param {[number, number]} coordinates - [lng, lat].
 * @returns {Object} The sync operation.
 */
function pointCreateOp(featureId, mapId, coordinates) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: { source: 'point', layerId: null },
    });
}

/**
 * Pushes a map `locked` toggle (owner-only) and returns the push result.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @param {boolean} locked
 * @returns {Promise<Object>} The pushOperations result.
 */
function setMapLocked(api, atlasId, mapId, locked) {
    const op = createOperation('map', 'update', mapId, null, { locked });
    return api.pushOperations(atlasId, [op]);
}

/**
 * Pulls a fresh snapshot and returns the map object matching `mapId`.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @returns {Promise<Object>} The snapshot map object.
 */
async function pullMap(api, atlasId, mapId) {
    const r = await api.pullSync(atlasId, 0);
    expect(r.isSnapshot).toBe(true);
    expect(r.snapshot).toBeTruthy();
    const map = r.snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return map;
}

describe.skipIf(E2E_SKIP)('e2e: map-lock enforcement (write share)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let ownerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let writerApi;
    /** @type {string} */
    let atlasId;
    /** @type {string} */
    let mapId;

    // Feature pushed while LOCKED (must be rejected and never land in the snapshot).
    const blockedFeatureId = generateUUID();
    // Feature pushed AFTER unlock (must succeed and appear in the snapshot).
    const allowedFeatureId = generateUUID();

    beforeAll(async () => {
        ownerApi = makeApi();
        writerApi = makeApi();

        await registerAndLogin(ownerApi, { nome: 'Lock Owner' });
        const writer = await registerAndLogin(writerApi, { nome: 'Lock Writer' });

        const atlas = await createAtlas(ownerApi, { name: 'Lock Enforcement Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(ownerApi, atlasId, { name: 'Locked Map' });

        // Owner grants the second user WRITE access.
        const share = await ownerApi._request(
            'POST',
            `/atlas/${atlasId}/sharing/users`,
            { body: { userId: writer.user.id, permission: 'write' } },
        );
        expect(share.permission).toBe('write');
    }, 30000);

    it('lets the write-share user push to the map BEFORE it is locked (control)', async () => {
        const baselineId = generateUUID();
        const res = await writerApi.pushOperations(atlasId, [
            pointCreateOp(baselineId, mapId, [-43.2, -22.9]),
        ]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(writerApi, atlasId, mapId);
        expect(map.features.points.some((f) => f.properties.id === baselineId)).toBe(true);
        // Sanity: the map is not yet locked.
        expect(map.locked).toBe(false);
    });

    it('owner locks the map: snapshot reflects locked=true', async () => {
        const res = await setMapLocked(ownerApi, atlasId, mapId, true);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.locked).toBe(true);
    });

    it('rejects the write-share user creating a feature on a locked map (409 ApiError)', async () => {
        let thrown;
        try {
            await writerApi.pushOperations(atlasId, [
                pointCreateOp(blockedFeatureId, mapId, [-43.3, -22.95]),
            ]);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown.status).toBe(409);

        // Negative assertion: the blocked feature must NOT have leaked into the snapshot
        // (one push = one atomic tx, so the rejected op leaves no trace).
        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.features.points.some((f) => f.properties.id === blockedFeatureId)).toBe(false);
    });

    it('also forbids the write-share user from unlocking the map (owner-only -> 403)', async () => {
        // Edge: lock/unlock is an authorization gate, not the same 409 lock gate.
        // A write-share user trying to clear the lock gets 403, and the map stays locked.
        let thrown;
        try {
            await setMapLocked(writerApi, atlasId, mapId, false);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown.status).toBe(403);

        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.locked).toBe(true);
    });

    it('owner unlocks; the write-share user write now succeeds and appears in the snapshot', async () => {
        const unlock = await setMapLocked(ownerApi, atlasId, mapId, false);
        expect(unlock.results[0].success).toBe(true);

        const res = await writerApi.pushOperations(atlasId, [
            pointCreateOp(allowedFeatureId, mapId, [-43.4, -23.0]),
        ]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(writerApi, atlasId, mapId);
        expect(map.locked).toBe(false);
        const point = map.features.points.find((f) => f.properties.id === allowedFeatureId);
        expect(point, 'unlocked write present in snapshot').toBeTruthy();
        expect(point.geometry).toEqual({ type: 'Point', coordinates: [-43.4, -23.0] });
        // The previously blocked feature is still absent — it was never retried.
        expect(map.features.points.some((f) => f.properties.id === blockedFeatureId)).toBe(false);
    });
});

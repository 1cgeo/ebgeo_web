// Path: tests/e2e/lock-enforcement.e2e.test.js

/**
 * @fileoverview E2E map-lock enforcement against the live backend (spec §1.5/§2.5).
 *
 * Scenario, driven only through the public ApiClient + createOperation + harness:
 *  1. The owner creates an atlas + TWO maps and grants a SECOND user `write` access
 *     via `POST /atlas/:id/sharing/users`.
 *  2. The owner pushes a map update `{ locked: true }` on the first map (lock/unlock
 *     is owner-only).
 *  3. The write-share user's feature create on that locked map is REFUSED, and a
 *     NEGATIVE assertion confirms the feature never reached the snapshot.
 *  4. As an edge control, the write-share user also CANNOT flip the lock itself
 *     (lock/unlock is owner-only), proving the gate is authorization, not luck.
 *  5. The owner unlocks `{ locked: false }`; the same user's feature write now
 *     succeeds (200) and appears in the pullSync snapshot's points bucket.
 *
 * SHAPE OF THE REFUSAL — changed in `aec63f8` (2026-07-24). Both refusals above used
 * to throw (409 for the locked map, 403 for the lock flip). They are now
 * PER-OPERATION: HTTP 200 with `results[i] = { success: false, rejected: true,
 * reason }`. The 409 was an outright defect: the client only dequeues on 2xx, so a
 * single locked map froze the whole outbound queue — INCLUDING ops addressed to
 * other, unlocked maps. This file therefore pins the batch-isolation half too: an op
 * for a sibling map in the same batch still applies.
 *
 * Every assertion checks observable backend state (snapshot or the push result);
 * no direct DB access. The test owns its api/users/atlas/maps for isolation.
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
    /** @type {string} Sibling map that is NEVER locked (batch-isolation control). */
    let openMapId;

    // Feature pushed while LOCKED (must be refused and never land in the snapshot).
    const blockedFeatureId = generateUUID();
    // Feature pushed to the UNLOCKED sibling map in the same refused batch.
    const siblingFeatureId = generateUUID();
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
        openMapId = await createMap(ownerApi, atlasId, { name: 'Open Map' });

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

    it('refuses the write-share user creating a feature on a locked map per-op, without poisoning the batch', async () => {
        // The push RESOLVES (no throw): the locked-map denial is per-operation, so
        // the client can dequeue the refused op and keep going. The op for the
        // sibling, UNLOCKED map in the SAME batch must still apply — that is the
        // exact regression the 409 caused (one locked map froze the whole queue).
        const res = await writerApi.pushOperations(atlasId, [
            pointCreateOp(blockedFeatureId, mapId, [-43.3, -22.95]),
            pointCreateOp(siblingFeatureId, openMapId, [-43.31, -22.96]),
        ]);

        expect(res.results).toHaveLength(2);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[0].reason).toMatch(/bloquead/i);
        expect(res.results[1].success).toBe(true);
        expect(res.results[1].rejected).toBeUndefined();

        // Negative assertion: the blocked feature must NOT have leaked into the
        // snapshot — the refusal happens before any write.
        const map = await pullMap(ownerApi, atlasId, mapId);
        expect(map.features.points.some((f) => f.properties.id === blockedFeatureId)).toBe(false);

        // ...while its batch sibling on the open map really landed.
        const openMap = await pullMap(ownerApi, atlasId, openMapId);
        expect(openMap.locked).toBe(false);
        expect(openMap.features.points.some((f) => f.properties.id === siblingFeatureId)).toBe(true);
    });

    it('also refuses the write-share user unlocking the map (owner-only), leaving it locked', async () => {
        // Edge: lock/unlock is an authorization gate, distinct from the locked-map
        // gate above, but since `aec63f8` both answer in the same per-op shape.
        const res = await setMapLocked(writerApi, atlasId, mapId, false);

        expect(res.results).toHaveLength(1);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[0].reason).toMatch(/dono do atlas/i);

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

// Path: tests/e2e/authz-map-delete.e2e.test.js

/**
 * @fileoverview Real-backend E2E for spec §1.9: map deletion authorization.
 *
 * Owner shares an atlas with WRITE permission to a second user, then:
 *  - user2 pushes a `map` DELETE op  -> backend rejects with 403 (owner-only),
 *    and the map is STILL present in the pulled snapshot;
 *  - the OWNER pushes the same `map` DELETE op -> succeeds (200), and the map is
 *    absent from a freshly pulled snapshot.
 *
 * The whole assertion chain rides REAL HTTP round-trips against the spawned
 * backend and reads observable state back via `api.pullSync` snapshots.
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

/**
 * Pulls a full snapshot and returns the list of (non-deleted) map ids it contains.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @returns {Promise<string[]>} Map ids present in the snapshot.
 */
async function snapshotMapIds(api, atlasId) {
    const pull = await api.pullSync(atlasId, 0);
    expect(pull.isSnapshot).toBe(true);
    return (pull.snapshot.maps || []).map((m) => m.id);
}

describe.skipIf(E2E_SKIP)('§1.9 map delete authorization (owner-only)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let ownerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let writerApi;
    /** @type {string} */
    let atlasId;
    /** @type {string} */
    let mapId;

    beforeAll(async () => {
        // Owner: own user + atlas + map (isolation).
        ownerApi = makeApi();
        await registerAndLogin(ownerApi, { nome: 'Owner §1.9' });
        const atlas = await createAtlas(ownerApi, { name: 'authz-map-delete' });
        atlasId = atlas.id;
        mapId = await createMap(ownerApi, atlasId, { name: 'Map under test' });

        // Second user, shared WRITE on the owner's atlas.
        writerApi = makeApi();
        const writer = await registerAndLogin(writerApi, { nome: 'Writer §1.9' });
        await ownerApi._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: writer.user.id, permission: 'write' },
        });
    });

    it('lets the WRITE user read the atlas but rejects their map DELETE with 403', async () => {
        // Precondition: the map exists in the snapshot for both principals.
        expect(await snapshotMapIds(ownerApi, atlasId)).toContain(mapId);
        // The shared writer can actually pull the atlas (share is effective).
        const writerIds = await snapshotMapIds(writerApi, atlasId);
        expect(writerIds).toContain(mapId);

        // Writer attempts a map DELETE -> owner-only -> 403, whole push rejected.
        const delOp = createOperation('map', 'delete', mapId, null, null);
        let status = null;
        try {
            await writerApi.pushOperations(atlasId, [delOp]);
        } catch (err) {
            status = err.status;
        }
        expect(status).toBe(403);

        // Negative/edge: the rejected DELETE left no trace — map STILL present.
        expect(await snapshotMapIds(ownerApi, atlasId)).toContain(mapId);
        expect(await snapshotMapIds(writerApi, atlasId)).toContain(mapId);
    });

    it('lets the OWNER delete the map, after which it is absent from the snapshot', async () => {
        const delOp = createOperation('map', 'delete', mapId, null, null);
        const res = await ownerApi.pushOperations(atlasId, [delOp]);
        // One push = one atomic ack; the op applied (not idempotent no-op).
        expect(res.results).toHaveLength(1);
        expect(res.results[0].success).toBe(true);

        // Observable state: the map is gone from a freshly pulled snapshot.
        expect(await snapshotMapIds(ownerApi, atlasId)).not.toContain(mapId);
    });
});

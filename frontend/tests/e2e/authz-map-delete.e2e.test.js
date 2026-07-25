// Path: tests/e2e/authz-map-delete.e2e.test.js

/**
 * @fileoverview Real-backend E2E for spec §1.9: map deletion authorization.
 *
 * The invariant this file pins has always been the same: a share BELOW `manage`
 * cannot delete a map, and the refused delete leaves the map standing. What
 * changed (commit `aec63f8`, 2026-07-24) is the SHAPE of the refusal and the
 * LEVEL required:
 *
 *  - a POLICY refusal is now PER-OPERATION: HTTP 200 with
 *    `results[i] = { success: false, rejected: true, reason }`. It no longer
 *    throws, because a thrown 4xx made the client keep the whole batch queued
 *    (it only dequeues on 2xx), freezing the outbound queue behind one refused op;
 *  - map delete is gated by the HIERARCHY at `manage` and above, NOT owner-only.
 *    A co-Gestor (`manage`) deletes maps; a `write` share does not.
 *
 * Both halves are asserted here against real HTTP round-trips, with observable
 * state read back via `api.pullSync` snapshots.
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

describe.skipIf(E2E_SKIP)('§1.9 map delete authorization (manage and above)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let ownerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let writerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let managerApi;
    /** @type {string} */
    let atlasId;
    /** @type {string} */
    let mapId;
    /** @type {string} Second map, deleted by the `manage` share. */
    let managedMapId;

    beforeAll(async () => {
        // Owner: own user + atlas + maps (isolation).
        ownerApi = makeApi();
        await registerAndLogin(ownerApi, { nome: 'Owner §1.9' });
        const atlas = await createAtlas(ownerApi, { name: 'authz-map-delete' });
        atlasId = atlas.id;
        mapId = await createMap(ownerApi, atlasId, { name: 'Map under test' });
        managedMapId = await createMap(ownerApi, atlasId, { name: 'Map for the co-Gestor' });

        // Second user, shared WRITE (below `manage`) on the owner's atlas.
        writerApi = makeApi();
        const writer = await registerAndLogin(writerApi, { nome: 'Writer §1.9' });
        await ownerApi._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: writer.user.id, permission: 'write' },
        });

        // Third user, shared MANAGE (co-Gestor) — above the delete threshold.
        managerApi = makeApi();
        const manager = await registerAndLogin(managerApi, { nome: 'Manager §1.9' });
        await ownerApi._request('POST', `/atlas/${atlasId}/sharing/users`, {
            body: { userId: manager.user.id, permission: 'manage' },
        });
    }, 30000);

    it('lets the WRITE user read the atlas but refuses their map DELETE per-op (200, rejected)', async () => {
        // Precondition: the map exists in the snapshot for both principals.
        expect(await snapshotMapIds(ownerApi, atlasId)).toContain(mapId);
        // The shared writer can actually pull the atlas (share is effective).
        const writerIds = await snapshotMapIds(writerApi, atlasId);
        expect(writerIds).toContain(mapId);

        // Writer attempts a map DELETE. Below `manage` -> refused, but the refusal
        // is per-operation: the HTTP call RESOLVES (no throw) so the client can
        // dequeue the op instead of retrying it forever.
        const delOp = createOperation('map', 'delete', mapId, null, null);
        const res = await writerApi.pushOperations(atlasId, [delOp]);

        expect(res.results).toHaveLength(1);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].rejected).toBe(true);
        // Reason is a pt-BR message for the user, naming the level that would pass.
        expect(res.results[0].reason).toMatch(/co-Gestor/i);
        expect(res.results[0].idempotent).toBe(false);

        // Negative/edge: the refused DELETE left no trace — map STILL present.
        expect(await snapshotMapIds(ownerApi, atlasId)).toContain(mapId);
        expect(await snapshotMapIds(writerApi, atlasId)).toContain(mapId);
    });

    it('does not poison the batch: a sibling op of the refused DELETE still applies', async () => {
        // This is the reason the refusal became per-op. One unauthorized op in a
        // batch must not discard its neighbours (each op runs in its own savepoint).
        const delOp = createOperation('map', 'delete', mapId, null, null);
        const renameOp = createOperation('map', 'update', mapId, null, { name: 'Renomeado pelo writer' });

        const res = await writerApi.pushOperations(atlasId, [delOp, renameOp]);
        expect(res.results).toHaveLength(2);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[1].success).toBe(true);
        expect(res.results[1].rejected).toBeUndefined();

        // The sibling really landed, and the map is still alive.
        const pull = await ownerApi.pullSync(atlasId, 0);
        const map = pull.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'map survived the refused delete').toBeTruthy();
        expect(map.name).toBe('Renomeado pelo writer');
    });

    it('lets a MANAGE share (co-Gestor) delete a map — the gate is the hierarchy, not the owner', async () => {
        expect(await snapshotMapIds(managerApi, atlasId)).toContain(managedMapId);

        const delOp = createOperation('map', 'delete', managedMapId, null, null);
        const res = await managerApi.pushOperations(atlasId, [delOp]);
        expect(res.results[0].success).toBe(true);
        expect(res.results[0].rejected).toBeUndefined();

        expect(await snapshotMapIds(ownerApi, atlasId)).not.toContain(managedMapId);
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

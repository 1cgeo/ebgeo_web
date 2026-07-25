// Path: tests/e2e/authz-map-lock.e2e.test.js

/**
 * @fileoverview E2E (§1.5): map lock is owner-only.
 *
 * An owner creates an atlas + map and grants a SECOND user `write` access via
 * `POST /atlas/:id/sharing/users`. We then drive the real backend through the
 * public ApiClient + createOperation and assert observable state:
 *  - a write-share user pushing a `map` update `{ locked: true }` is REFUSED —
 *    lock/unlock stays reserved for the atlas owner (strict equality, not the
 *    hierarchy: it is a coordination override, not a management action);
 *  - the refusal is PER-OPERATION, not a thrown 403: since `aec63f8`
 *    (2026-07-24) a policy denial answers HTTP 200 with
 *    `results[i] = { success: false, rejected: true, reason }`, so one refused op
 *    no longer discards its batch siblings nor freezes the client's outbound
 *    queue (the client only dequeues on 2xx);
 *  - the refused op still has NO effect: the map stays `locked === false`;
 *  - the OWNER can set `locked: true`, and the snapshot then reflects it;
 *  - negative/edge control: the write-share user CAN still push a non-lock map
 *    update (e.g. `name`), proving the refusal is specific to the lock field and
 *    not a blanket write denial.
 *
 * No direct DB access — all assertions read the backend snapshot via pullSync.
 * Each test file owns its api/user/atlas/map for isolation.
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
 * Pulls a fresh snapshot and returns the map row for `mapId`, or undefined.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @returns {Promise<Object|undefined>}
 */
async function fetchMap(api, atlasId, mapId) {
    const result = await api.pullSync(atlasId, 0);
    expect(result.isSnapshot).toBe(true);
    return result.snapshot.maps.find((m) => m.id === mapId);
}

describe.skipIf(E2E_SKIP)('e2e: authz — map lock is owner-only (§1.5)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let ownerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let writerApi;
    /** @type {Object} */
    let atlas;
    /** @type {Object} */
    let writerUser;
    /** @type {string} */
    let mapId;

    beforeAll(async () => {
        ownerApi = makeApi();
        writerApi = makeApi();

        await registerAndLogin(ownerApi, { nome: 'Lock Owner' });
        const writer = await registerAndLogin(writerApi, { nome: 'Lock Writer' });
        writerUser = writer.user;

        atlas = await createAtlas(ownerApi, { name: 'Map Lock Atlas' });
        mapId = await createMap(ownerApi, atlas.id, { name: 'Lockable Map' });

        // Owner grants the second user WRITE access (still not owner).
        const share = await ownerApi._request(
            'POST',
            `/atlas/${atlas.id}/sharing/users`,
            { body: { userId: writerUser.id, permission: 'write' } },
        );
        expect(share.permission).toBe('write');

        // Sanity: the freshly created map starts unlocked.
        const map = await fetchMap(ownerApi, atlas.id, mapId);
        expect(map).toBeTruthy();
        expect(map.locked).toBe(false);
    }, 30000);

    it('refuses a write-share user setting locked:true per-op (200 + rejected), sibling op still applies', async () => {
        const lockOp = createOperation('map', 'update', mapId, null, { locked: true });
        // Sibling in the SAME batch: an ordinary field a writer may change. It is
        // the control for "one refused op does not poison the batch".
        const siblingOp = createOperation('map', 'update', mapId, null, { name: 'Sibling Applied' });

        // No throw: a policy refusal resolves 200 so the client can dequeue it.
        const res = await writerApi.pushOperations(atlas.id, [lockOp, siblingOp]);

        expect(res.results).toHaveLength(2);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[0].reason).toMatch(/dono do atlas/i);
        expect(res.results[1].success).toBe(true);
        expect(res.results[1].rejected).toBeUndefined();

        // The sibling landed; the refused lock did not.
        const map = await fetchMap(writerApi, atlas.id, mapId);
        expect(map.name).toBe('Sibling Applied');
        expect(map.locked).toBe(false);
    });

    it('leaves the map unlocked in the snapshot after the refused push', async () => {
        // The refused op ran in its own savepoint and touched nothing.
        const map = await fetchMap(writerApi, atlas.id, mapId);
        expect(map).toBeTruthy();
        expect(map.locked).toBe(false);
    });

    it('still lets the write-share user push a non-lock map update (name)', async () => {
        // Edge control: the refusal is specific to the `locked` field, not a
        // blanket write denial — a field like `name` is accepted for a writer.
        const newName = 'Renamed By Writer';
        const op = createOperation('map', 'update', mapId, null, { name: newName });

        const res = await writerApi.pushOperations(atlas.id, [op]);
        expect(res.serverVersion).toBeGreaterThan(0);

        const map = await fetchMap(writerApi, atlas.id, mapId);
        expect(map.name).toBe(newName);
        // ...and the name update did not flip lock on.
        expect(map.locked).toBe(false);
    });

    it('lets the OWNER set locked:true and reflects it in the snapshot', async () => {
        const op = createOperation('map', 'update', mapId, null, { locked: true });

        const res = await ownerApi.pushOperations(atlas.id, [op]);
        expect(res.serverVersion).toBeGreaterThan(0);

        const map = await fetchMap(ownerApi, atlas.id, mapId);
        expect(map).toBeTruthy();
        expect(map.locked).toBe(true);
    });
});

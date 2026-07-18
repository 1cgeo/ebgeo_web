// Path: tests/e2e/map-lifecycle.e2e.test.js

/**
 * @fileoverview Real-backend E2E for the map lifecycle (spec §1.7/§1.8/§1.9).
 *
 * Drives the frontend sync transport against the live ebgeo_backend and asserts
 * observable server state via the atlas snapshot (`api.pullSync`). Maps have no
 * REST write route: create/update/delete all travel as CRDT operations through
 * `POST /atlas/:id/sync`. Each scenario is verified by pulling a fresh snapshot
 * and inspecting the canonical `maps` array (soft-deleted maps are absent).
 *
 * Every entity id is a UUID and the suite provisions its own user/atlas in
 * `beforeAll` so it stays isolated across the shared backend.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Pulls a fresh snapshot and returns the map row for `mapId`, or undefined when
 * the map is absent (e.g. soft-deleted).
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @returns {Promise<Object|undefined>}
 */
async function findMap(api, atlasId, mapId) {
    const { snapshot } = await api.pullSync(atlasId, 0);
    return snapshot.maps.find((m) => m.id === mapId);
}

describe.skipIf(E2E_SKIP)('map lifecycle (real backend)', () => {
    let api;
    let atlasId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Map Lifecycle E2E' });
        const atlas = await createAtlas(api, { name: 'Map Lifecycle Atlas' });
        atlasId = atlas.id;
    });

    it('§1.7 create: a map create op lands in the snapshot', async () => {
        const mapId = generateUUID();
        const op = createOperation('map', 'create', mapId, null, { name: 'Alpha' });
        const res = await api.pushOperations(atlasId, [op]);

        // The push is acknowledged and the server version advances past genesis.
        expect(res.serverVersion).toBeGreaterThan(0);

        const map = await findMap(api, atlasId, mapId);
        expect(map).toBeDefined();
        expect(map.name).toBe('Alpha');
    });

    it('§1.8 update: a plain {name} update renames the map', async () => {
        const mapId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('map', 'create', mapId, null, { name: 'Bravo' }),
        ]);

        // Plain map update touching the `name` column (not a sub-typed field).
        await api.pushOperations(atlasId, [
            createOperation('map', 'update', mapId, null, { name: 'Bravo Renamed' }),
        ]);

        const map = await findMap(api, atlasId, mapId);
        expect(map).toBeDefined();
        expect(map.name).toBe('Bravo Renamed');
    });

    it('§1.9 delete: a deleted map is absent from the snapshot', async () => {
        const mapId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('map', 'create', mapId, null, { name: 'Charlie' }),
        ]);

        // Sanity: present before the delete.
        expect(await findMap(api, atlasId, mapId)).toBeDefined();

        await api.pushOperations(atlasId, [
            createOperation('map', 'delete', mapId, null, null),
        ]);

        // Negative assertion: soft-deleted map no longer appears in the snapshot,
        // while a sibling map from this suite remains untouched.
        const { snapshot } = await api.pullSync(atlasId, 0);
        expect(snapshot.maps.some((m) => m.id === mapId)).toBe(false);
        expect(snapshot.maps.length).toBeGreaterThan(0);
    });

    it('idempotency: re-pushing the same create op does not duplicate the map', async () => {
        const mapId = generateUUID();
        const op = createOperation('map', 'create', mapId, null, { name: 'Delta' });

        await api.pushOperations(atlasId, [op]);
        // Same op_id replayed -> ON CONFLICT DO NOTHING server-side.
        await api.pushOperations(atlasId, [op]);

        const { snapshot } = await api.pullSync(atlasId, 0);
        const matches = snapshot.maps.filter((m) => m.id === mapId);
        expect(matches).toHaveLength(1);
        expect(matches[0].name).toBe('Delta');
    });
});

// Path: tests/e2e/sharing-write.e2e.test.js

/**
 * @fileoverview E2E: write-permission sharing enforcement against the live backend.
 *
 * An owner creates an atlas + map and grants a SECOND user `write` permission via
 * `POST /atlas/:id/sharing/users`. We then assert real backend behavior driven only
 * through the public ApiClient + createOperation (no DB access):
 *  - the write-shared user CAN push a feature create op (one push = one tx), and the
 *    feature is observable in the pullSync snapshot's points bucket; and
 *  - a THIRD, unrelated user with NO share is denied: pulling the snapshot and pushing
 *    an op both fail with an ApiError (403 forbidden or 404 not-found — the backend
 *    must not leak the atlas to a non-collaborator).
 *
 * Each test owns its own apis/users/atlas for isolation across the shared backend.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { ApiError } from '../../src/js/store/sync/api-client.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a feature `create` op carrying a raw GeoJSON Feature whose feature type
 * lives in `properties.source` (frozen frontend contract the backend derives from).
 * @param {string} featureId
 * @param {string} mapId
 * @param {Object} geometry - GeoJSON geometry
 * @param {Object} [props]
 * @returns {Object} sync operation
 */
function featureCreateOp(featureId, mapId, geometry, props = {}) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry,
        properties: { source: 'point', layerId: null, ...props },
    });
}

describe.skipIf(E2E_SKIP)('e2e: sharing — write (read/write) share', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let ownerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let writerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let strangerApi;
    /** @type {Object} */
    let atlas;
    /** @type {string} */
    let mapId;
    /** @type {Object} */
    let writerUser;

    const writerFeatureId = generateUUID();

    beforeAll(async () => {
        ownerApi = makeApi();
        writerApi = makeApi();
        strangerApi = makeApi();

        await registerAndLogin(ownerApi, { nome: 'Owner User' });
        const writer = await registerAndLogin(writerApi, { nome: 'Writer User' });
        await registerAndLogin(strangerApi, { nome: 'Stranger User' });
        writerUser = writer.user;

        atlas = await createAtlas(ownerApi, { name: 'Write Share Atlas' });
        mapId = await createMap(ownerApi, atlas.id, { name: 'Mapa Share' });

        // Owner grants the second user WRITE access.
        const share = await ownerApi._request(
            'POST',
            `/atlas/${atlas.id}/sharing/users`,
            { body: { userId: writerUser.id, permission: 'write' } },
        );
        expect(share).toBeTruthy();
        expect(share.permission).toBe('write');
    }, 30000);

    it('lets the write-shared user push a feature that lands in the snapshot', async () => {
        const geom = { type: 'Point', coordinates: [-43.18, -22.91] };
        const op = featureCreateOp(writerFeatureId, mapId, geom, { nome: 'Writer Ponto' });

        const res = await writerApi.pushOperations(atlas.id, [op]);
        expect(res.results).toHaveLength(1);
        expect(res.results[0].success).toBe(true);
        expect(res.serverVersion).toBeGreaterThan(0);

        // Observable in the OWNER's snapshot — the write persisted server-side.
        const pulled = await ownerApi.pullSync(atlas.id, 0);
        expect(pulled.isSnapshot).toBe(true);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'map present in snapshot').toBeTruthy();
        const point = map.features.points.find((f) => f.properties.id === writerFeatureId);
        expect(point, 'writer feature present in points bucket').toBeTruthy();
        expect(point.geometry).toEqual(geom);
        expect(point.properties.source).toBe('point');
        expect(point.properties.nome).toBe('Writer Ponto');
    });

    it('denies an unrelated (unshared) user from reading the snapshot', async () => {
        let thrown;
        try {
            await strangerApi.pullSync(atlas.id, 0);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(ApiError);
        // Non-collaborator must be rejected; backend may answer 403 or 404 (no leak).
        expect([403, 404]).toContain(thrown.status);
    });

    it('denies an unrelated (unshared) user from pushing an operation', async () => {
        const op = featureCreateOp(generateUUID(), mapId, {
            type: 'Point',
            coordinates: [0, 0],
        });

        let thrown;
        try {
            await strangerApi.pushOperations(atlas.id, [op]);
        } catch (err) {
            thrown = err;
        }
        expect(thrown).toBeInstanceOf(ApiError);
        expect([403, 404]).toContain(thrown.status);

        // Negative: the stranger's rejected op left NO trace in the snapshot.
        const pulled = await ownerApi.pullSync(atlas.id, 0);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        expect(map.features.points.some((f) => f.properties.id === op.entityId)).toBe(false);
    });
});

// Path: tests/e2e/permissions-viewer.e2e.test.js

/**
 * @fileoverview E2E: read-only (viewer) sharing enforcement.
 *
 * An owner creates an atlas and grants a SECOND user `read` permission via
 * `POST /atlas/:id/sharing/users`. We then assert the real backend behavior:
 *  - the viewer CAN pull the atlas snapshot (read access works), and
 *  - the viewer CANNOT push a CRDT operation (sync push requires `write`) — the
 *    backend answers 403, surfaced as an `ApiError` from the ApiClient.
 *
 * Everything is driven through the public ApiClient + createOperation + harness;
 * no direct DB access. Each test owns its api/user/atlas for isolation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    E2E_SKIP,
} from './helpers/harness.js';
import { ApiError } from '../../src/js/store/sync/api-client.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: permissions — viewer (read-only) share', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let ownerApi;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let viewerApi;
    /** @type {Object} */
    let atlas;
    /** @type {Object} */
    let viewerUser;

    beforeAll(async () => {
        ownerApi = makeApi();
        viewerApi = makeApi();

        await registerAndLogin(ownerApi, { nome: 'Owner User' });
        const viewer = await registerAndLogin(viewerApi, { nome: 'Viewer User' });
        viewerUser = viewer.user;

        atlas = await createAtlas(ownerApi, { name: 'Viewer Perms Atlas' });

        // Owner grants the second user READ access.
        const share = await ownerApi._request(
            'POST',
            `/atlas/${atlas.id}/sharing/users`,
            { body: { userId: viewerUser.id, permission: 'read' } },
        );
        expect(share).toBeTruthy();
        expect(share.permission).toBe('read');
    }, 30000);

    it('grants the viewer read access (pullSync returns a snapshot)', async () => {
        const result = await viewerApi.pullSync(atlas.id, 0);
        expect(result).toBeTruthy();
        // sinceVersion 0 yields a full snapshot the viewer is allowed to read.
        expect(result.isSnapshot).toBe(true);
        expect(result.snapshot).toBeTruthy();
        expect(typeof result.currentVersion).toBe('number');
    });

    it('rejects a viewer pushing an operation with 403 (ApiError)', async () => {
        const op = createOperation('feature', 'create', generateUUID(), null, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [0, 0] },
            properties: { source: 'point', layerId: 'default' },
        });

        let thrown;
        try {
            await viewerApi.pushOperations(atlas.id, [op]);
        } catch (err) {
            thrown = err;
        }

        expect(thrown).toBeInstanceOf(ApiError);
        expect(thrown.status).toBe(403);
    });

    it('still lets the owner push the same operation (positive control)', async () => {
        const op = createOperation('feature', 'create', generateUUID(), null, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [1, 1] },
            properties: { source: 'point', layerId: 'default' },
        });

        const res = await ownerApi.pushOperations(atlas.id, [op]);
        expect(res).toBeTruthy();
        expect(typeof res.serverVersion).toBe('number');
        expect(res.serverVersion).toBeGreaterThan(0);
    });
});

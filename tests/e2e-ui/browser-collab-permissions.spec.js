// Path: e2e-ui/browser-collab-permissions.spec.js

/**
 * PERMISSIONS — dynamic share control across TWO real browsers + real backend. The
 * permission gate was a real bug (the atlas role was ignored on connect), so the
 * DYNAMICS deserve a faithful end-to-end guard:
 *
 *   1. read-only peer: B (read) CANNOT write (guardWrite blocks locally; the owner never
 *      sees the attempt), yet B DOES see the owner's writes.
 *   2. upgrade: the owner promotes B read→write; after B reconnects it CAN edit and the
 *      owner sees it.
 *   3. revoke: the owner removes B's share; B then loses access to the atlas (HTTP denied).
 *
 * Sharing is a backend route (no UI); the seed + setSharePermission drive it via the API.
 *
 * Run headed:  npx playwright test browser-collab-permissions --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import {
    seedSharedAtlas,
    openClient,
    readFeatures,
    pollPeerFeature,
    setSharePermission,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const hasLine = async (page, id) => (await readFeatures(page, 'lines')).some((x) => x.id === id);

const newLine = (id) => ({
    type: 'Feature',
    properties: { id, source: 'line', layerId: 'default', lineColor: '#3f4fb5', lineWidth: 4 },
    geometry: { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] },
});

describeOrSkip('Permissions — dynamic share control cross-client', () => {
    test('read-only peer cannot write, but sees the owner writes', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Owner writes → read-only B receives it.
            const idA = crypto.randomUUID();
            await applyStoreOp(A, 'addFeature', ['lines', newLine(idA)]);
            await pollPeerFeature(B, 'lines', idA);

            // Read-only B tries to write → blocked on B itself (guardWrite) and never reaches A.
            const idB = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(idB)]);
            await B.waitForTimeout(4000);
            expect(await hasLine(B, idB), 'read-only write is blocked locally on B').toBe(false);
            expect(await hasLine(A, idB), 'read-only write never reached the owner').toBe(false);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('owner upgrades a read-only peer to write → after reconnect B can edit', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'read' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        let B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Read-only: B cannot write.
            const blocked = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(blocked)]);
            expect(await hasLine(B, blocked), 'still read-only — write blocked').toBe(false);

            // Owner promotes B to write.
            const status = await setSharePermission(A, state.baseUrl, seed.userA, seed.atlasId, seed.userB.id, 'write');
            expect(status, 'PUT share permission succeeded').toBeLessThan(300);

            // B reconnects (fresh session picks up the new atlas role).
            await B.context().close();
            B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

            // Now B can write → the owner sees it.
            const idB = crypto.randomUUID();
            await applyStoreOp(B, 'addFeature', ['lines', newLine(idB)]);
            expect(await hasLine(B, idB), 'B can write after upgrade').toBe(true);
            await pollPeerFeature(A, 'lines', idB);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });

    test('owner revokes a peer → B loses access to the atlas (HTTP denied)', async ({ browser }) => {
        const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);
        try {
            // Sanity: while shared, B can read the atlas over HTTP.
            const before = await B.evaluate(async ({ base, c, id }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const api = new ApiClient({ baseUrl: `${base}/api/v1` });
                await api.login(c.username, c.password);
                const res = await fetch(`${base}/api/v1/atlas/${id}`, { headers: { Authorization: `Bearer ${api.getAccessToken()}` } });
                return res.status;
            }, { base: state.baseUrl, c: seed.userB, id: seed.atlasId });
            expect(before, 'shared peer can GET the atlas').toBeLessThan(300);

            // Owner revokes B's share.
            const status = await setSharePermission(A, state.baseUrl, seed.userA, seed.atlasId, seed.userB.id, null);
            expect(status, 'DELETE share succeeded').toBeLessThan(300);

            // B is now denied at the HTTP layer (defense in depth, independent of the live WS).
            const after = await B.evaluate(async ({ base, c, id }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const api = new ApiClient({ baseUrl: `${base}/api/v1` });
                await api.login(c.username, c.password);
                const res = await fetch(`${base}/api/v1/atlas/${id}`, { headers: { Authorization: `Bearer ${api.getAccessToken()}` } });
                return res.status;
            }, { base: state.baseUrl, c: seed.userB, id: seed.atlasId });
            expect(after, 'revoked peer is denied').toBeGreaterThanOrEqual(400);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});

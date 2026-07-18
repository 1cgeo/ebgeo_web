// Path: e2e-ui/browser-sharing-lifecycle.spec.js

/**
 * @fileoverview Browser-level user-share LIFECYCLE test. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL backend, and exercises the sharing REST
 * routes that the existing `browser-sharing-public` spec does NOT cover — read-only
 * grant, permission upgrade (PUT), revoke (DELETE), and the sharing-config read (GET)
 * — via authenticated `fetch` using the live owner token (`api.getAccessToken()`).
 *
 * Proves, with real HTTP round-trips in the browser, the share-lifecycle contract:
 *   1. Owner grants READ to user2 (`POST /atlas/:id/sharing/users` permission:'read').
 *      user2 can PULL the snapshot but is DENIED (403) on PUSH (read-only). This is the
 *      mandated NEGATIVE access test: a user WITH a share but WITHOUT write cannot write.
 *   2. `GET /atlas/:id/sharing` reports the atlas as not-public with one share for
 *      user2 at permission 'read'.
 *   3. Owner UPGRADES the share to write (`PUT /atlas/:id/sharing/users/:userId`).
 *      user2 can now PUSH, and the op lands in the owner's snapshot.
 *   4. Owner REVOKES the share (`DELETE /atlas/:id/sharing/users/:userId` → 204).
 *      user2's subsequent PUSH is DENIED again, and re-removing the now-missing share
 *      404s.
 *
 * The test seeds its own owner + user2 for isolation. No app UI is clicked (no
 * data-testid needed): the spec drives the transport in `page.evaluate`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const PASSWORD = 'Sup3r-Secret-Pw!';

describeOrSkip('User-share lifecycle: read → upgrade → revoke (real Chromium + real backend)', () => {
    test('read-only share blocks push; PUT upgrades to write; DELETE revokes; GET reports state', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, password }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const apiBase = `${baseUrl}/api/v1`;
                const mkUser = (prefix) =>
                    `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

                /** Registers + logs in a fresh user, returning a ready ApiClient and the user record. */
                const newClient = async (prefix, nome) => {
                    const api = new ApiClient({ baseUrl: apiBase });
                    const username = mkUser(prefix);
                    const user = await api.register({ username, password, nome });
                    await api.login(username, password);
                    return { api, user };
                };

                /** Pushes one point-feature op; returns { ok, status, featureId } (status 0 on success). */
                const tryPushFeature = async (api, atlasId, mapId, label) => {
                    const featureId = crypto.randomUUID();
                    const op = createOperation('feature', 'create', featureId, mapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: { id: featureId, source: 'point', nome: label },
                    });
                    try {
                        await api.pushOperations(atlasId, [op]);
                        return { ok: true, status: 0, featureId };
                    } catch (err) {
                        return { ok: false, status: err.status, code: err.code, featureId };
                    }
                };

                /** Owner-authenticated raw fetch against a sharing route. */
                const ownerFetch = (api, path, method, body) =>
                    fetch(`${apiBase}${path}`, {
                        method,
                        headers: {
                            ...(body ? { 'Content-Type': 'application/json' } : {}),
                            Authorization: `Bearer ${api.getAccessToken()}`,
                        },
                        body: body ? JSON.stringify(body) : undefined,
                    });

                // --- Seed owner + atlas + map, and a second user. ---
                const owner = await newClient('shl_owner', 'Lifecycle Owner');
                const user2 = await newClient('shl_user2', 'Lifecycle Target');
                const atlas = await owner.api.createAtlas({ name: 'Lifecycle Atlas' });
                const mapId = crypto.randomUUID();
                await owner.api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'M1' }),
                ]);

                // 1. Grant READ to user2.
                const grantRes = await ownerFetch(
                    owner.api,
                    `/atlas/${atlas.id}/sharing/users`,
                    'POST',
                    { userId: user2.user.id, permission: 'read' },
                );
                const grantBody = await grantRes.json();

                // user2 CAN pull (read) but CANNOT push (read-only).
                let readSharePullOk = false;
                try {
                    await user2.api.pullSync(atlas.id, 0);
                    readSharePullOk = true;
                } catch {
                    readSharePullOk = false;
                }
                const readSharePush = await tryPushFeature(user2.api, atlas.id, mapId, 'read-share');

                // 2. GET sharing config: not public, one share for user2 at 'read'.
                const cfgRes = await ownerFetch(owner.api, `/atlas/${atlas.id}/sharing`, 'GET');
                const cfgBody = await cfgRes.json();
                const cfg = cfgBody?.data;
                const shareForUser2 = (cfg?.shares || []).find(
                    (s) => s.userId === user2.user.id || s.user_id === user2.user.id,
                );

                // 3. UPGRADE the share to write, then user2 can push.
                const upgradeRes = await ownerFetch(
                    owner.api,
                    `/atlas/${atlas.id}/sharing/users/${user2.user.id}`,
                    'PUT',
                    { permission: 'write' },
                );
                const upgradeBody = await upgradeRes.json();
                const afterUpgradePush = await tryPushFeature(user2.api, atlas.id, mapId, 'write-share');

                // Owner reads back the snapshot: user2's upgraded-write feature is persisted.
                const pulled = await owner.api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const points = map?.features?.points || [];
                const ownerSeesUpgradeFeature = points.some(
                    (p) => p.properties.id === afterUpgradePush.featureId,
                );

                // 4. REVOKE the share; user2 is denied again; re-revoking 404s.
                const revokeRes = await ownerFetch(
                    owner.api,
                    `/atlas/${atlas.id}/sharing/users/${user2.user.id}`,
                    'DELETE',
                );
                const afterRevokePush = await tryPushFeature(user2.api, atlas.id, mapId, 'post-revoke');
                const reRevokeRes = await ownerFetch(
                    owner.api,
                    `/atlas/${atlas.id}/sharing/users/${user2.user.id}`,
                    'DELETE',
                );

                return {
                    grantStatus: grantRes.status,
                    grantPermission: grantBody?.data?.permission,
                    readSharePullOk,
                    readSharePush,
                    cfgStatus: cfgRes.status,
                    cfgIsPublic: cfg?.isPublic,
                    cfgSharePermission: shareForUser2?.permission,
                    upgradeStatus: upgradeRes.status,
                    upgradePermission: upgradeBody?.data?.permission,
                    afterUpgradePush,
                    ownerSeesUpgradeFeature,
                    revokeStatus: revokeRes.status,
                    afterRevokePush,
                    reRevokeStatus: reRevokeRes.status,
                };
            },
            { baseUrl: state.baseUrl, password: PASSWORD },
        );

        // 1. Read grant created (201) at permission 'read'.
        expect(result.grantStatus).toBe(201);
        expect(result.grantPermission).toBe('read');

        // Read share: PULL allowed, PUSH denied (read-only → 403/404). NEGATIVE access test.
        expect(result.readSharePullOk).toBe(true);
        expect(result.readSharePush.ok).toBe(false);
        expect([403, 404]).toContain(result.readSharePush.status);

        // 2. Sharing config reports a non-public atlas with user2 at 'read'.
        expect(result.cfgStatus).toBe(200);
        expect(result.cfgIsPublic).toBe(false);
        expect(result.cfgSharePermission).toBe('read');

        // 3. Upgrade to write (200) lets user2 push, and the op persists for the owner.
        expect(result.upgradeStatus).toBe(200);
        expect(result.upgradePermission).toBe('write');
        expect(result.afterUpgradePush.ok).toBe(true);
        expect(result.ownerSeesUpgradeFeature).toBe(true);

        // 4. Revoke (204) re-denies user2; re-revoking a missing share 404s.
        expect(result.revokeStatus).toBe(204);
        expect(result.afterRevokePush.ok).toBe(false);
        expect([403, 404]).toContain(result.afterRevokePush.status);
        expect(result.reRevokeStatus).toBe(404);
    });
});

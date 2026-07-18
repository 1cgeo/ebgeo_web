// Path: e2e-ui/browser-lock-authz.spec.js

/**
 * @fileoverview Two-client browser map-lock authorization test. Drives the REAL
 * frontend transport (api-client / operation-factory) imported live from the Vite
 * dev server inside TWO separate Chromium contexts, against the REAL backend, and
 * asserts the multiuser lock/authz contract end to end with in-browser `ApiError`
 * statuses:
 *
 *   1. The OWNER registers, creates an atlas + map, and shares WRITE access to a
 *      second real user (`user2`) via an authenticated `POST /atlas/:id/sharing/users`
 *      fetch (the ApiClient has no sharing helper, so we hit the route directly with
 *      `api.getAccessToken()`).
 *   2. The OWNER locks the map by pushing a `map` `update` op `{ locked: true }`.
 *   3. `user2` (with WRITE) tries to create a feature on the locked map → the backend
 *      rejects it with HTTP 409 (`ConflictError 'Map is locked'`), surfaced in-browser
 *      as `ApiError { status: 409 }`.
 *   4. `user2` tries to DELETE the map → rejected with HTTP 403 (`ForbiddenError`,
 *      map-delete is owner-only) — even though the map is locked, this is an authz
 *      failure, not a lock conflict.
 *   5. The OWNER unlocks the map (`{ locked: false }`); `user2`'s feature write now
 *      succeeds and the persisted snapshot reports the feature.
 *
 * Every assertion is a REAL HTTP round-trip made by browser `fetch` against the
 * spawned backend; the 409/403 statuses come from the live backend, not a stub.
 * Each test self-provisions its own users/atlas/map for isolation.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Map lock authorization (two real browser clients + real backend)', () => {
    test('owner shares write; lock blocks user2 write (409); user2 map-delete denied (403); unlock re-enables write', async ({
        browser,
    }) => {
        // ---- Provision user2 in its own context (real register → real user id). ----
        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        await pageB.addInitScript((url) => {
            window.__EBGEO_BACKEND_URL__ = url;
        }, `${state.baseUrl}/api/v1`);
        await pageB.goto('/');

        const user2 = await pageB.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `lz_user2_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
            const created = await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Lock User2' });
            return { username, userId: created.id };
        }, state.baseUrl);
        expect(typeof user2.userId).toBe('string');
        expect(user2.userId.length).toBeGreaterThan(0);

        // ---- OWNER context: register, create atlas + map, share WRITE to user2. ----
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        await pageA.addInitScript((url) => {
            window.__EBGEO_BACKEND_URL__ = url;
        }, `${state.baseUrl}/api/v1`);
        await pageA.goto('/');

        const owner = await pageA.evaluate(
            async ({ baseUrl, user2Id }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                const username = `lz_owner_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
                await api.register({ username, password: 'Sup3r-Secret-Pw!', nome: 'Lock Owner' });
                await api.login(username, 'Sup3r-Secret-Pw!');

                const atlas = await api.createAtlas({ name: 'Lock Authz Atlas' });
                const mapId = crypto.randomUUID();
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'M1' }),
                ]);

                // Share WRITE access to user2 via the owner-only sharing route. The
                // ApiClient has no sharing helper, so call the REST route directly with
                // the owner's access token.
                const shareRes = await fetch(`${baseUrl}/api/v1/atlas/${atlas.id}/sharing/users`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${api.getAccessToken()}`,
                    },
                    body: JSON.stringify({ userId: user2Id, permission: 'write' }),
                });

                window.__owner = { api, atlasId: atlas.id, mapId };
                return { atlasId: atlas.id, mapId, shareStatus: shareRes.status };
            },
            { baseUrl: state.baseUrl, user2Id: user2.userId },
        );
        // Sharing a user returns 201 Created.
        expect(owner.shareStatus).toBe(201);

        // ---- user2 logs in and confirms WRITE works BEFORE the lock (edge baseline). ----
        const preLock = await pageB.evaluate(
            async ({ baseUrl, username, atlasId, mapId }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                await api.login(username, 'Sup3r-Secret-Pw!');
                window.__user2 = { api, atlasId, mapId };

                const fid = crypto.randomUUID();
                const feature = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.1, -22.8] },
                    properties: { id: fid, source: 'point', nome: 'Pre-lock point' },
                };
                try {
                    await api.pushOperations(atlasId, [createOperation('feature', 'create', fid, mapId, feature)]);
                    return { ok: true };
                } catch (err) {
                    return { ok: false, status: err.status, code: err.code };
                }
            },
            { baseUrl: state.baseUrl, username: user2.username, atlasId: owner.atlasId, mapId: owner.mapId },
        );
        // Baseline: WRITE share is genuinely effective before the map is locked.
        expect(preLock.ok).toBe(true);

        // ---- OWNER locks the map (owner-only lock op). ----
        const locked = await pageA.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__owner;
            const op = createOperation('map', 'update', mapId, null, { locked: true });
            const res = await api.pushOperations(atlasId, [op]);
            return { serverVersion: res.serverVersion };
        });
        expect(typeof locked.serverVersion).toBe('number');

        // ---- user2 feature write on the LOCKED map → ApiError 409 in-browser. ----
        const writeWhileLocked = await pageB.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { ApiError } = await import('/src/js/store/sync/api-client.js');
            const { api, atlasId, mapId } = window.__user2;
            const fid = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: fid, source: 'point', nome: 'Blocked point' },
            };
            try {
                await api.pushOperations(atlasId, [createOperation('feature', 'create', fid, mapId, feature)]);
                return { rejected: false, fid };
            } catch (err) {
                return {
                    rejected: true,
                    fid,
                    status: err.status,
                    code: err.code,
                    isApiError: err instanceof ApiError,
                };
            }
        });
        expect(writeWhileLocked.rejected).toBe(true);
        expect(writeWhileLocked.isApiError).toBe(true);
        expect(writeWhileLocked.status).toBe(409);

        // ---- user2 map-delete → ApiError 403 (owner-only authz, NOT a lock conflict). ----
        const deleteByUser2 = await pageB.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { ApiError } = await import('/src/js/store/sync/api-client.js');
            const { api, atlasId, mapId } = window.__user2;
            try {
                await api.pushOperations(atlasId, [createOperation('map', 'delete', mapId, null, {})]);
                return { rejected: false };
            } catch (err) {
                return {
                    rejected: true,
                    status: err.status,
                    code: err.code,
                    isApiError: err instanceof ApiError,
                };
            }
        });
        expect(deleteByUser2.rejected).toBe(true);
        expect(deleteByUser2.isApiError).toBe(true);
        expect(deleteByUser2.status).toBe(403);

        // ---- OWNER unlocks the map. ----
        const unlocked = await pageA.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__owner;
            const res = await api.pushOperations(atlasId, [
                createOperation('map', 'update', mapId, null, { locked: false }),
            ]);
            return { serverVersion: res.serverVersion };
        });
        expect(typeof unlocked.serverVersion).toBe('number');

        // ---- user2 feature write now SUCCEEDS; snapshot must report the feature. ----
        const afterUnlock = await pageB.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__user2;
            const fid = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.3, -23.0] },
                properties: { id: fid, source: 'point', nome: 'After-unlock point' },
            };
            try {
                await api.pushOperations(atlasId, [createOperation('feature', 'create', fid, mapId, feature)]);
            } catch (err) {
                return { ok: false, status: err.status, code: err.code };
            }

            // Read back the persisted snapshot and confirm the feature landed.
            const deadline = Date.now() + 5000;
            let found = false;
            while (Date.now() < deadline && !found) {
                const pull = await api.pullSync(atlasId, 0);
                const map = pull?.snapshot?.maps?.find((m) => m.id === mapId);
                const points = map?.features?.points || [];
                found = points.some((p) => p.properties && p.properties.id === fid);
                if (!found) await new Promise((r) => setTimeout(r, 50));
            }
            return { ok: true, fid, found };
        });
        expect(afterUnlock.ok).toBe(true);
        expect(afterUnlock.found).toBe(true);

        await ctxA.close();
        await ctxB.close();
    });
});

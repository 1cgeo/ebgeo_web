// Path: e2e-ui/browser-sharing-public.spec.js

/**
 * Browser-level sharing + public-link test. Drives the REAL frontend transport
 * (api-client / operation-factory) imported live from the Vite dev server INSIDE
 * real Chromium, against the REAL backend, and exercises the backend's
 * REST sharing/public routes via authenticated `fetch` (using the live access
 * token from `api.getAccessToken()`).
 *
 * Proves, with real HTTP round-trips in the browser, the access-control contract:
 *   1. An owner shares WRITE to user2 (`POST /atlas/:id/sharing/users`); user2 can
 *      then push a sync op (write permission), and the op is visible in the owner's
 *      snapshot. An UNRELATED user (no share) is denied (403/404) on the same push,
 *      and (negative edge) so is user2 BEFORE the share exists.
 *   2. The owner publishes the atlas (`POST /atlas/:id/sharing/public`); an
 *      anonymous visitor resolves the public link (`GET /atlas/public/:link`),
 *      receives a read-only `publicToken`, can PULL the snapshot with it, but is
 *      DENIED (403) when attempting to PUSH (read-only public access).
 *
 * Each test seeds its own user(s) + atlas + map for isolation. No app UI is
 * clicked (no data-testid needed): the specs drive the transport in `page.evaluate`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const PASSWORD = 'Sup3r-Secret-Pw!';

describeOrSkip('Sharing + public link access control (real Chromium + real backend)', () => {
    test('owner shares WRITE to user2 → user2 writes; unrelated user denied; pre-share denied', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, password }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const apiBase = `${baseUrl}/api/v1`;
                const mkUser = () => `share_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

                /** Registers + logs in a fresh user, returning a ready ApiClient and the user record. */
                const newClient = async (nome) => {
                    const api = new ApiClient({ baseUrl: apiBase });
                    const username = mkUser();
                    // register() returns no account data on purpose (anti-enumeration:
                    // same answer whether it created the account or found one), so the
                    // user record comes from the login.
                    await api.register({ username, password, nome });
                    const user = await api.login(username, password);
                    return { api, user };
                };

                /** Pushes one feature op and returns { status, ok } (status 0 on success). */
                const tryPushFeature = async (api, atlasId, mapId) => {
                    const featureId = crypto.randomUUID();
                    const feature = {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: { id: featureId, source: 'point', nome: 'shared write' },
                    };
                    const op = createOperation('feature', 'create', featureId, mapId, feature);
                    try {
                        await api.pushOperations(atlasId, [op]);
                        return { ok: true, status: 0, featureId };
                    } catch (err) {
                        return { ok: false, status: err.status, code: err.code, featureId };
                    }
                };

                // --- Seed owner + atlas + map. ---
                const owner = await newClient('Share Owner');
                const atlas = await owner.api.createAtlas({ name: 'Share Atlas' });
                const mapId = crypto.randomUUID();
                await owner.api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'M1' }),
                ]);

                // --- Two more independent users. ---
                const user2 = await newClient('Share Target');
                const stranger = await newClient('Unrelated User');

                // (negative edge) user2 has NO share yet → push must be denied.
                const beforeShare = await tryPushFeature(user2.api, atlas.id, mapId);

                // Owner grants WRITE to user2 via the REST sharing route (auth = owner token).
                const shareRes = await fetch(`${apiBase}/atlas/${atlas.id}/sharing/users`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${owner.api.getAccessToken()}`,
                    },
                    body: JSON.stringify({ userId: user2.user.id, permission: 'write' }),
                });
                const shareBody = await shareRes.json();

                // user2 can now push (write permission).
                const afterShare = await tryPushFeature(user2.api, atlas.id, mapId);

                // The unrelated user (no share) is denied on the same push.
                const strangerPush = await tryPushFeature(stranger.api, atlas.id, mapId);

                // Owner reads back the snapshot: user2's feature must be persisted.
                const pulled = await owner.api.pullSync(atlas.id, 0);
                const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                const points = map?.features?.points || [];
                const ownerSeesUser2Feature = points.some(
                    (p) => p.properties.id === afterShare.featureId,
                );
                const strangerFeatureAbsent = !points.some(
                    (p) => p.properties.id === strangerPush.featureId,
                );

                return {
                    beforeShare,
                    shareStatus: shareRes.status,
                    sharePermission: shareBody?.data?.permission,
                    afterShare,
                    strangerPush,
                    ownerSeesUser2Feature,
                    strangerFeatureAbsent,
                };
            },
            { baseUrl: state.baseUrl, password: PASSWORD },
        );

        // Pre-share: user2 had no access → denied.
        expect(result.beforeShare.ok).toBe(false);
        expect([403, 404]).toContain(result.beforeShare.status);

        // Share created (201) with write permission.
        expect(result.shareStatus).toBe(201);
        expect(result.sharePermission).toBe('write');

        // After share: user2 writes successfully and the op is persisted.
        expect(result.afterShare.ok).toBe(true);
        expect(result.ownerSeesUser2Feature).toBe(true);

        // Unrelated user denied; its op never persisted.
        expect(result.strangerPush.ok).toBe(false);
        expect([403, 404]).toContain(result.strangerPush.status);
        expect(result.strangerFeatureAbsent).toBe(true);
    });

    test('publish atlas → public token can PULL but not PUSH (read-only public access)', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, password }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const apiBase = `${baseUrl}/api/v1`;

                // --- Seed owner + atlas + map + one feature (so the public pull has content). ---
                const owner = new ApiClient({ baseUrl: apiBase });
                const username = `pub_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
                await owner.register({ username, password, nome: 'Public Owner' });
                await owner.login(username, password);

                const atlas = await owner.createAtlas({ name: 'Public Atlas' });
                const mapId = crypto.randomUUID();
                await owner.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'M1' }),
                ]);
                const seededFeatureId = crypto.randomUUID();
                await owner.pushOperations(atlas.id, [
                    createOperation('feature', 'create', seededFeatureId, mapId, {
                        type: 'Feature',
                        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        properties: { id: seededFeatureId, source: 'point', nome: 'public point' },
                    }),
                ]);

                // (negative edge) BEFORE publishing, the public-link lookup must 404.
                const fakeLink = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
                const preLookup = await fetch(`${apiBase}/atlas/public/${fakeLink}`);

                // Owner enables public sharing → { publicLink }.
                const enableRes = await fetch(`${apiBase}/atlas/${atlas.id}/sharing/public`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${owner.getAccessToken()}` },
                });
                const enableBody = await enableRes.json();
                const publicLink = enableBody?.data?.publicLink;

                // Anonymous visitor resolves the public link (NO auth header) → atlas + publicToken.
                const lookupRes = await fetch(`${apiBase}/atlas/public/${publicLink}`);
                const lookupBody = await lookupRes.json();
                const publicToken = lookupBody?.data?.publicToken;
                const resolvedAtlasId = lookupBody?.data?.id;

                // Visitor uses a SEPARATE client carrying ONLY the read-only public token.
                const visitor = new ApiClient({ baseUrl: apiBase });
                visitor.setTokens({ accessToken: publicToken });

                // PULL with the public token must succeed and expose the seeded feature.
                let pullOk = false;
                let pullSeesFeature = false;
                let pullStatus = 0;
                try {
                    const pulled = await visitor.pullSync(resolvedAtlasId, 0);
                    pullOk = true;
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                    const points = map?.features?.points || [];
                    pullSeesFeature = points.some((p) => p.properties.id === seededFeatureId);
                } catch (err) {
                    pullStatus = err.status;
                }

                // PUSH with the public token must be DENIED (read-only).
                let pushStatus = 0;
                let pushOk = false;
                const intruderFeatureId = crypto.randomUUID();
                try {
                    await visitor.pushOperations(resolvedAtlasId, [
                        createOperation('feature', 'create', intruderFeatureId, mapId, {
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: [0, 0] },
                            properties: { id: intruderFeatureId, source: 'point' },
                        }),
                    ]);
                    pushOk = true;
                } catch (err) {
                    pushStatus = err.status;
                }

                // The denied push must NOT have persisted (owner re-reads the snapshot).
                const ownerPull = await owner.pullSync(atlas.id, 0);
                const ownerMap = ownerPull.snapshot?.maps?.find((m) => m.id === mapId);
                const ownerPoints = ownerMap?.features?.points || [];
                const intruderAbsent = !ownerPoints.some(
                    (p) => p.properties.id === intruderFeatureId,
                );

                return {
                    preLookupStatus: preLookup.status,
                    enableStatus: enableRes.status,
                    hasPublicLink: Boolean(publicLink),
                    lookupStatus: lookupRes.status,
                    hasPublicToken: Boolean(publicToken),
                    resolvedMatchesAtlas: resolvedAtlasId === atlas.id,
                    pullOk,
                    pullStatus,
                    pullSeesFeature,
                    pushOk,
                    pushStatus,
                    intruderAbsent,
                };
            },
            { baseUrl: state.baseUrl, password: PASSWORD },
        );

        // (negative edge) unknown public link → 404.
        expect(result.preLookupStatus).toBe(404);

        // Publish succeeded and yielded a link.
        expect(result.enableStatus).toBe(200);
        expect(result.hasPublicLink).toBe(true);

        // Anonymous link resolution succeeded and returned a read-only public token.
        expect(result.lookupStatus).toBe(200);
        expect(result.hasPublicToken).toBe(true);
        expect(result.resolvedMatchesAtlas).toBe(true);

        // Public token CAN pull (read).
        expect(result.pullOk).toBe(true);
        expect(result.pullSeesFeature).toBe(true);

        // Public token CANNOT push (read-only) → 403, and nothing was persisted.
        expect(result.pushOk).toBe(false);
        expect(result.pushStatus).toBe(403);
        expect(result.intruderAbsent).toBe(true);
    });
});

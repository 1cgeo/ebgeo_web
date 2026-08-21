// Path: e2e-ui/browser-public-lifecycle.spec.js

/**
 * @fileoverview Browser-level public-link LIFECYCLE test. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * INSIDE real Chromium, against the REAL backend. Complements `browser-sharing-public`
 * (which proves a live public token reads but cannot write) by exercising the
 * DISABLE half of the public-sharing lifecycle (`DELETE /atlas/:id/sharing/public`)
 * via authenticated `fetch` using the live owner token (`api.getAccessToken()`).
 *
 * Proves, with real HTTP round-trips in the browser, the public-disable contract:
 *   1. Owner enables public sharing (`POST /sharing/public`) → a `publicLink`. The
 *      anonymous lookup (`GET /atlas/public/:link`, NO auth) resolves the atlas and
 *      mints a read-only `publicToken`, which can PULL the seeded snapshot.
 *   2. Owner DISABLES public sharing (`DELETE /sharing/public` → 204). The SAME link
 *      now 404s on the anonymous lookup (the backend nulls `public_link` + flips
 *      `is_public=false`, and the lookup query filters `is_public = true`). The
 *      sharing-config read reports `isPublic=false` with a null link.
 *   3. A `publicToken` minted BEFORE the disable can no longer reach the atlas: a PULL
 *      with that stale token is denied (access is re-evaluated server-side, not frozen
 *      into the token). NEGATIVE access test for the revoked public path.
 *
 * The test seeds its own owner + atlas + map + feature for isolation. No app UI is
 * clicked (no data-testid needed): the spec drives the transport in `page.evaluate`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Public-link lifecycle: enable → disable revokes the link (real Chromium + real backend)', () => {
    test('disabling public sharing 404s the old link and revokes a previously-minted public token', async ({
        page,
    }) => {
        // A conta do dono nasce no NODE, com o e-mail já confirmado pela rota pública: o token
        // de verificação só existe como linha no Postgres, fora do alcance do `page.evaluate`.
        const ownerUser = await createVerifiedUser({ prefix: 'publc', nome: 'Public Lifecycle Owner' });
        await page.goto('/');

        const result = await page.evaluate(
            async ({ baseUrl, u }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const apiBase = `${baseUrl}/api/v1`;

                /** Owner-authenticated raw fetch against a sharing route. */
                const ownerFetch = (api, path, method) =>
                    fetch(`${apiBase}${path}`, {
                        method,
                        headers: { Authorization: `Bearer ${api.getAccessToken()}` },
                    });

                // --- Seed owner + atlas + map + one feature (so the public pull has content). ---
                const owner = new ApiClient({ baseUrl: apiBase });
                await owner.login(u.username, u.password);

                const atlas = await owner.createAtlas({ name: 'Public Lifecycle Atlas' });
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

                // 1. Enable public sharing → publicLink.
                const enableRes = await ownerFetch(owner, `/atlas/${atlas.id}/sharing/public`, 'POST');
                const enableBody = await enableRes.json();
                const publicLink = enableBody?.data?.publicLink;

                // Anonymous lookup resolves the atlas + a read-only public token (NO auth header).
                const lookupRes = await fetch(`${apiBase}/atlas/public/${publicLink}`);
                const lookupBody = await lookupRes.json();
                const publicToken = lookupBody?.data?.publicToken;
                const resolvedAtlasId = lookupBody?.data?.id;

                // The minted public token can PULL while sharing is live.
                const visitor = new ApiClient({ baseUrl: apiBase });
                visitor.setTokens({ accessToken: publicToken });
                let prePullOk = false;
                let prePullSeesFeature = false;
                try {
                    const pulled = await visitor.pullSync(resolvedAtlasId, 0);
                    prePullOk = true;
                    const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
                    const points = map?.features?.points || [];
                    prePullSeesFeature = points.some((p) => p.properties.id === seededFeatureId);
                } catch {
                    prePullOk = false;
                }

                // 2. Disable public sharing (204).
                const disableRes = await ownerFetch(owner, `/atlas/${atlas.id}/sharing/public`, 'DELETE');

                // The SAME link now 404s on the anonymous lookup.
                const postLookupRes = await fetch(`${apiBase}/atlas/public/${publicLink}`);

                // Owner's sharing-config read now reports not-public with a null link.
                const cfgRes = await ownerFetch(owner, `/atlas/${atlas.id}/sharing`, 'GET');
                const cfgBody = await cfgRes.json();
                const cfg = cfgBody?.data;

                // 3. The stale public token minted earlier can no longer reach the atlas.
                let postPullOk = false;
                let postPullStatus = 0;
                try {
                    await visitor.pullSync(resolvedAtlasId, 0);
                    postPullOk = true;
                } catch (err) {
                    postPullStatus = err.status;
                }

                return {
                    enableStatus: enableRes.status,
                    hasPublicLink: Boolean(publicLink),
                    lookupStatus: lookupRes.status,
                    hasPublicToken: Boolean(publicToken),
                    resolvedMatchesAtlas: resolvedAtlasId === atlas.id,
                    prePullOk,
                    prePullSeesFeature,
                    disableStatus: disableRes.status,
                    postLookupStatus: postLookupRes.status,
                    cfgIsPublic: cfg?.isPublic,
                    cfgPublicLinkNull: cfg?.publicLink === null || cfg?.publicLink === undefined,
                    postPullOk,
                    postPullStatus,
                };
            },
            { baseUrl: state.baseUrl, u: ownerUser },
        );

        // 1. Enable + anonymous lookup succeed; the minted token reads the seeded feature.
        expect(result.enableStatus).toBe(200);
        expect(result.hasPublicLink).toBe(true);
        expect(result.lookupStatus).toBe(200);
        expect(result.hasPublicToken).toBe(true);
        expect(result.resolvedMatchesAtlas).toBe(true);
        expect(result.prePullOk).toBe(true);
        expect(result.prePullSeesFeature).toBe(true);

        // 2. Disable (204) → the old link 404s; config reports not-public with a null link.
        expect(result.disableStatus).toBe(204);
        expect(result.postLookupStatus).toBe(404);
        expect(result.cfgIsPublic).toBe(false);
        expect(result.cfgPublicLinkNull).toBe(true);

        // 3. The stale public token can no longer pull the atlas. NEGATIVE access test.
        expect(result.postPullOk).toBe(false);
        expect([401, 403, 404]).toContain(result.postPullStatus);
    });
});

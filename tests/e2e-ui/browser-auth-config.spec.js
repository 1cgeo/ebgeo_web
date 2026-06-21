// Path: e2e-ui/browser-auth-config.spec.js

/**
 * Browser-level auth + config contracts: drives the REAL frontend transport
 * (api-client) imported live from the Vite dev server INSIDE real Chromium, against
 * the REAL spawned backend. Every assertion is a genuine HTTP round-trip made by the
 * browser's own fetch/CORS stack — no mocks, no Node-side HTTP.
 *
 * Coverage:
 *   - register → login → refresh: a fresh user registers, logs in (tokens stored),
 *     then rotates its token via `api.refresh()`. The access token must CHANGE and
 *     still authorize an authenticated route (`api.listAtlas()`). Edge: refreshing
 *     with a bogus refresh token is rejected by the backend.
 *   - getConfig(): the frozen `GET /api/v1/config` contract is a BARE object (no
 *     `{ data }` envelope) and must expose the frozen top-level keys
 *     `app` / `features` / `basemaps` with their frozen shapes. Edge: it works for an
 *     ANONYMOUS client (no token) and returns the SAME shape as an authenticated one.
 *   - GET /nomes/busca with NO auth returns a JSON ARRAY (frozen gazetteer contract,
 *     anonymous path). Edge: the same endpoint enforces its Joi query schema — a too
 *     short `q` is rejected (422), proving validation runs on the anonymous route.
 *
 * Each test self-provisions its own user for isolation where a user is needed.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Auth + config contracts (real Chromium + real backend, transport via page.evaluate)', () => {
    test('register → login → refresh rotates the access token and still authorizes; bad refresh is rejected', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient, ApiError } = await import('/src/js/store/sync/api-client.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `auth_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';

            await api.register({ username, password, nome: 'Auth E2E' });
            const user = await api.login(username, password);
            const tokenBeforeRefresh = api.getAccessToken();

            // An authenticated route must work with the login token.
            const atlasesBefore = await api.listAtlas();

            // Rotate the token. Backend issues a fresh access token (and rotates the
            // refresh token); the access token must actually change. The HS256 access
            // token's only time claim is `iat` at SECOND granularity, so a refresh in
            // the SAME wall-clock second re-issues a byte-identical token. Wait past the
            // second boundary so a genuinely fresh token (different iat) is minted.
            await new Promise((r) => setTimeout(r, 1100));
            await api.refresh();
            const tokenAfterRefresh = api.getAccessToken();

            // The rotated token must still authorize an authenticated route.
            const atlasesAfter = await api.listAtlas();

            // Edge: a bogus refresh token must be rejected by the backend.
            const bogus = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            bogus.setTokens({ accessToken: null, refreshToken: 'not-a-real-refresh-token' });
            let bogusRejected = false;
            let bogusIsApiError = false;
            try {
                await bogus.refresh();
            } catch (err) {
                bogusRejected = true;
                bogusIsApiError = err instanceof ApiError;
            }

            return {
                hasUser: Boolean(user && user.username === username),
                hadTokenBefore: Boolean(tokenBeforeRefresh),
                hasTokenAfter: Boolean(tokenAfterRefresh),
                tokenChanged: Boolean(tokenBeforeRefresh) && tokenBeforeRefresh !== tokenAfterRefresh,
                atlasesBeforeIsArray: Array.isArray(atlasesBefore),
                atlasesAfterIsArray: Array.isArray(atlasesAfter),
                bogusRejected,
                bogusIsApiError,
            };
        }, state.baseUrl);

        expect(result.hasUser).toBe(true);
        expect(result.hadTokenBefore).toBe(true);
        expect(result.hasTokenAfter).toBe(true);
        expect(result.tokenChanged).toBe(true);
        expect(result.atlasesBeforeIsArray).toBe(true);
        expect(result.atlasesAfterIsArray).toBe(true);
        expect(result.bogusRejected).toBe(true);
        expect(result.bogusIsApiError).toBe(true);
    });

    test('getConfig() returns the frozen bare config object (app/features/basemaps) for anonymous AND authed clients', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');

            // 1. ANONYMOUS client: no token at all.
            const anon = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const cfg = await anon.getConfig();

            // The frozen contract is a BARE object: NOT wrapped in a `{ data }`
            // envelope and NOT an array.
            const isBareObject =
                cfg != null && typeof cfg === 'object' && !Array.isArray(cfg) && !('data' in cfg);

            // 2. AUTHED client: register + login, then fetch the same config. The
            //    public config shape must be identical regardless of auth.
            const authed = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            const username = `cfg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
            const password = 'Sup3r-Secret-Pw!';
            await authed.register({ username, password, nome: 'Config E2E' });
            await authed.login(username, password);
            const cfgAuthed = await authed.getConfig();

            return {
                isBareObject,
                wasAnonymous: anon.getAccessToken() === null,
                hasApp: Boolean(cfg && cfg.app && typeof cfg.app.title === 'string'),
                hasFeatures:
                    Boolean(cfg && cfg.features) && typeof cfg.features.map_3d === 'boolean',
                // basemaps is an OBJECT keyed by id (frontend indexes by id), not an array.
                basemapsIsObject:
                    Boolean(cfg && cfg.basemaps) &&
                    typeof cfg.basemaps === 'object' &&
                    !Array.isArray(cfg.basemaps),
                basemapKeyCount: cfg && cfg.basemaps ? Object.keys(cfg.basemaps).length : 0,
                topLevelKeysMatch:
                    JSON.stringify(Object.keys(cfg || {}).sort()) ===
                    JSON.stringify(Object.keys(cfgAuthed || {}).sort()),
                appTitleMatches: Boolean(cfg && cfgAuthed && cfg.app.title === cfgAuthed.app.title),
            };
        }, state.baseUrl);

        expect(result.isBareObject).toBe(true);
        expect(result.wasAnonymous).toBe(true);
        expect(result.hasApp).toBe(true);
        expect(result.hasFeatures).toBe(true);
        expect(result.basemapsIsObject).toBe(true);
        expect(result.basemapKeyCount).toBeGreaterThan(0);
        expect(result.topLevelKeysMatch).toBe(true);
        expect(result.appTitleMatches).toBe(true);
    });

    test('GET /nomes/busca with NO auth returns a JSON array; an invalid query is rejected (422)', async ({
        page,
    }) => {
        await page.goto('/');

        const result = await page.evaluate(async (baseUrl) => {
            // Drive the raw frozen gazetteer contract with the browser's own fetch and
            // NO Authorization header — the anonymous path must work.
            const base = `${baseUrl}/api/v1`;

            // 1. A valid query (q >= 3 chars + lat/lon, per the backend Joi schema).
            const params = new URLSearchParams({ q: 'rio', lat: '-22.9', lon: '-43.2', zoom: '10' });
            const res = await fetch(`${base}/nomes/busca?${params.toString()}`);
            const body = await res.json();

            // The frozen contract is a BARE JSON array (no `{ data }` envelope).
            const isArray = Array.isArray(body);

            // 2. Edge: the Joi query schema still runs on the anonymous route — a too
            //    short `q` must be rejected with a 422 validation error envelope.
            const badParams = new URLSearchParams({ q: 'ab', lat: '-22.9', lon: '-43.2' });
            const badRes = await fetch(`${base}/nomes/busca?${badParams.toString()}`);
            let badBody = null;
            try {
                badBody = await badRes.json();
            } catch {
                badBody = null;
            }

            return {
                ok: res.ok,
                status: res.status,
                isArray,
                badStatus: badRes.status,
                badHasErrorEnvelope: Boolean(badBody && badBody.error && badBody.error.code),
            };
        }, state.baseUrl);

        expect(result.ok).toBe(true);
        expect(result.status).toBe(200);
        expect(result.isArray).toBe(true);
        expect(result.badStatus).toBe(422);
        expect(result.badHasErrorEnvelope).toBe(true);
    });
});

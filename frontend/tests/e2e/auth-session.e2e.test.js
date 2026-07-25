// Path: tests/e2e/auth-session.e2e.test.js

/**
 * @fileoverview E2E "auth-session" scenario against the live backend.
 *
 * Exercises the auth lifecycle through the public ApiClient only:
 *   register -> login (tokens stored) -> token refresh (rotation) ->
 *   getConfig (frozen config contract) -> logout (tokens cleared).
 *
 * Each assertion is a real HTTP round-trip; no direct DB access.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { makeApi, getBaseUrl, E2E_SKIP } from './helpers/harness.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import { ApiError } from '../../src/js/store/sync/api-client.js';

describe.skipIf(E2E_SKIP)('e2e auth-session', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    const username = `e2e_${generateUUID().replace(/-/g, '').slice(0, 16)}`;
    const password = 'Sup3r-Secret-Pw!';

    beforeAll(() => {
        // Own isolated client; do NOT use registerAndLogin so we can assert each step.
        api = makeApi();
    });

    it('registers a brand-new user (201 -> account-free body)', async () => {
        // The response says NOTHING about the account, deliberately: it is identical
        // whether the backend created one or found the username/e-mail already taken, so
        // /auth/register cannot be used to enumerate accounts. Proof that the account
        // exists is the login below, not this body.
        const res = await api.register({ username, password, nome: 'Auth Session' });
        expect(res).toEqual({ success: true });
    });

    it('a duplicate registration is indistinguishable from a new one (negative)', async () => {
        // Was: rejects with ApiError (the backend answered 409). That 409 WAS the
        // enumeration oracle. It now resolves the same way as the first call; the
        // refusal is real but reported only by e-mail, to the address' owner.
        const res = await api.register({ username, password, nome: 'Dupe' });
        expect(res).toEqual({ success: true });
        // And the duplicate did not overwrite the account: the original password still works.
        const other = makeApi();
        await expect(other.login(username, password)).resolves.toBeTruthy();
    });

    it('login stores an access token on the client', async () => {
        expect(api.isAuthenticated()).toBe(false);
        const user = await api.login(username, password);
        expect(user.username).toBe(username);
        expect(api.isAuthenticated()).toBe(true);
        expect(api.getAccessToken()).toBeTruthy();
        // JWT shape: three dot-separated segments.
        expect(api.getAccessToken().split('.')).toHaveLength(3);
    });

    it('rejects login with the wrong password (negative)', async () => {
        const other = makeApi();
        await expect(other.login(username, 'wrong-password')).rejects.toBeInstanceOf(ApiError);
        expect(other.isAuthenticated()).toBe(false);
    });

    it('refresh rotates the access token', async () => {
        const before = api.getAccessToken();
        // The HS256 access token's only time claim is `iat` at SECOND granularity,
        // so a refresh in the same wall-clock second re-issues a byte-identical
        // token. Wait past the second boundary to prove a fresh token is actually
        // minted (different iat), which is the rotation the contract guarantees.
        await new Promise((r) => setTimeout(r, 1100));
        await api.refresh();
        const after = api.getAccessToken();
        expect(after).toBeTruthy();
        expect(after.split('.')).toHaveLength(3);
        // Rotation: a fresh token is issued (iat differs from the previous one).
        expect(after).not.toBe(before);
        // The rotated token still authenticates a real protected call.
        const atlases = await api.listAtlas();
        expect(Array.isArray(atlases)).toBe(true);
    });

    it('getConfig returns the frozen config contract', async () => {
        // Config is public (auth:false) and a BARE object (no { data } envelope).
        const cfg = await api.getConfig();
        expect(cfg).toBeTruthy();
        expect(cfg).toHaveProperty('app');
        expect(cfg).toHaveProperty('features');
        expect(cfg).toHaveProperty('basemaps');
        // basemaps is an OBJECT keyed by id, not an array.
        expect(Array.isArray(cfg.basemaps)).toBe(false);
        expect(typeof cfg.basemaps).toBe('object');
        // It is the bare contract: must not be wrapped under a `data` key.
        expect('data' in cfg).toBe(false);
    });

    it('logout clears the local tokens', async () => {
        expect(api.isAuthenticated()).toBe(true);
        await api.logout();
        expect(api.isAuthenticated()).toBe(false);
        expect(api.getAccessToken()).toBeNull();
    });

    it('exposes a usable base url (sanity)', () => {
        expect(getBaseUrl()).toMatch(/^http/);
    });
});

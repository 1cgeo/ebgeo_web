import { describe, it, expect, beforeEach, vi } from 'vitest';

// §item8: a login must survive F5 until the JWT/refresh token expires. Tokens are persisted
// to localStorage by the ApiClient, and the session context carries the display name so the
// account UI can render the avatar after a restore without the login modal.

const ls = (() => {
    const s = {};
    return {
        getItem: (k) => (k in s ? s[k] : null),
        setItem: (k, v) => { s[k] = String(v); },
        removeItem: (k) => { delete s[k]; },
        clear: () => { for (const k of Object.keys(s)) delete s[k]; }
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });

// ApiClient only touches globalThis.fetch when a request is made (not in these tests).
vi.stubGlobal('fetch', vi.fn());

import { ApiClient } from '../../src/js/store/sync/api-client.js';
import { sessionContext } from '../../src/js/store/sync/session-context.js';

beforeEach(() => {
    ls.clear();
});

describe('ApiClient token persistence', () => {
    it('persists tokens on setTokens and a fresh client restores them via loadStoredTokens', () => {
        const a = new ApiClient({ baseUrl: '/api/v1' });
        a.setTokens({ accessToken: 'acc', refreshToken: 'ref' });
        expect(ls.getItem('ebgeo_auth')).toBeTruthy();

        // A fresh client simulates a page reload: in-memory tokens start empty, then restore.
        const b = new ApiClient({ baseUrl: '/api/v1' });
        expect(b.isAuthenticated()).toBe(false);
        expect(b.loadStoredTokens()).toBe(true);
        expect(b.isAuthenticated()).toBe(true);
        expect(b.getAccessToken()).toBe('acc');
    });

    it('clearTokens removes the persisted tokens (logout)', () => {
        const a = new ApiClient({ baseUrl: '/api/v1' });
        a.setTokens({ accessToken: 'acc', refreshToken: 'ref' });
        a.clearTokens();
        expect(ls.getItem('ebgeo_auth')).toBeNull();
        expect(new ApiClient({ baseUrl: '/api/v1' }).loadStoredTokens()).toBe(false);
    });

    it('loadStoredTokens returns false when nothing is stored', () => {
        expect(new ApiClient({ baseUrl: '/api/v1' }).loadStoredTokens()).toBe(false);
    });
});

describe('ApiClient request timeout', () => {
    it('aborts a hung request after requestTimeoutMs (so a slow backend never blocks boot)', async () => {
        // A fetch that only ever settles when its AbortSignal fires.
        const hangingFetch = vi.fn((url, opts) => new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));
        const client = new ApiClient({ baseUrl: '/api/v1', fetch: hangingFetch, bootTimeoutMs: 20 });

        // getConfig is boot-critical → bounded by bootTimeoutMs.
        await expect(client.getConfig()).rejects.toBeTruthy();
        expect(hangingFetch).toHaveBeenCalled();
    });
});

describe('session context username', () => {
    it('exposes the username after setSession and clears it on clearSession', () => {
        sessionContext.setSession({ userId: 'u1', role: 'editor', username: 'cap.silva' });
        expect(sessionContext.username).toBe('cap.silva');
        expect(sessionContext.isAuthenticated()).toBe(true);

        sessionContext.clearSession();
        expect(sessionContext.username).toBeNull();
        expect(sessionContext.isAuthenticated()).toBe(false);
    });
});

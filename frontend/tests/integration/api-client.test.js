import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiClient, ApiError } from '../../src/js/store/sync/api-client.js';

/**
 * HTTP transport tests. The backend is mocked via an injectable `fetch`; these
 * pin the wire contract (envelope unwrap, auth header, 401 refresh+retry, error
 * mapping, sync/atlas URLs, and the WS URL builder).
 */

/** Builds a fetch Response-like object. */
function resp(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
}

function makeClient(fetchImpl, baseUrl = 'http://api.test/api/v1') {
    return new ApiClient({ baseUrl, fetch: fetchImpl });
}

describe('ApiClient — auth', () => {
    it('login stores tokens and returns the user; sends no Authorization', async () => {
        const fetchImpl = vi.fn(async () => resp(200, {
            data: { accessToken: 'access-1', refreshToken: 'refresh-1', user: { id: 'u1', username: 'ana' } },
        }));
        const api = makeClient(fetchImpl);

        const user = await api.login('ana', 'secret');

        expect(user).toEqual({ id: 'u1', username: 'ana' });
        expect(api.getAccessToken()).toBe('access-1');
        expect(api.isAuthenticated()).toBe(true);

        const [url, opts] = fetchImpl.mock.calls[0];
        expect(url).toBe('http://api.test/api/v1/auth/login');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ username: 'ana', password: 'secret' });
        expect(opts.headers.Authorization).toBeUndefined();
    });

    it('attaches the Bearer token on authenticated requests', async () => {
        const fetchImpl = vi.fn(async () => resp(200, { data: [] }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });

        await api.listAtlas();

        const [, opts] = fetchImpl.mock.calls[0];
        expect(opts.headers.Authorization).toBe('Bearer tok');
    });

    it('refreshes once and retries on a 401, then succeeds', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (url.endsWith('/atlas')) {
                // First /atlas call 401s; after refresh the retry succeeds.
                return fetchImpl.mock.calls.filter(c => c[0].endsWith('/atlas')).length === 1
                    ? resp(401, { error: { code: 'UNAUTHORIZED', message: 'expired' } })
                    : resp(200, { data: [{ id: 'a1' }] });
            }
            if (url.endsWith('/auth/refresh')) {
                return resp(200, { data: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
            }
            throw new Error(`unexpected url ${url}`);
        });
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });

        const list = await api.listAtlas();

        expect(list).toEqual([{ id: 'a1' }]);
        expect(api.getAccessToken()).toBe('access-2');
        // /atlas (401) → /auth/refresh → /atlas (retry)
        expect(fetchImpl.mock.calls.map(c => c[0].replace('http://api.test/api/v1', ''))).toEqual([
            '/atlas', '/auth/refresh', '/atlas',
        ]);
    });

    it('fires the auth-lost handler and clears tokens when refresh terminally fails', async () => {
        const fetchImpl = vi.fn(async (url) => {
            if (url.endsWith('/auth/refresh')) return resp(401, { error: { code: 'INVALID_REFRESH' } });
            if (url.endsWith('/atlas')) return resp(401, { error: { code: 'UNAUTHORIZED' } });
            throw new Error(`unexpected url ${url}`);
        });
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
        const onAuthLost = vi.fn();
        api.setAuthLostHandler(onAuthLost);

        await expect(api.listAtlas()).rejects.toBeInstanceOf(ApiError);
        expect(onAuthLost).toHaveBeenCalledTimes(1);
        expect(api.isAuthenticated()).toBe(false); // dead tokens dropped
    });

    it('server-side session REVOCATION lands on the same auth-lost path', async () => {
        // Cross-package contract (backend achado 35 + migration 008). Until then a mass
        // revocation could not reach a client holding a live access token at all; now the
        // access token 401s ("Session revoked") AND the refresh fails, because the family
        // went with it. There is no new client code for this — the point of the test is
        // that there does not NEED to be: the shape the backend produces is exactly what
        // the existing terminal-refresh-failure path already handles.
        const seen = [];
        const fetchImpl = vi.fn(async (url) => {
            seen.push(url.replace('http://api.test/api/v1', ''));
            if (url.endsWith('/auth/refresh')) {
                return resp(401, { error: { code: 'UNAUTHORIZED', message: 'Sessão inválida. Entre novamente.' } });
            }
            return resp(401, { error: { code: 'UNAUTHORIZED', message: 'Session revoked' } });
        });
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'stolen-but-cut', refreshToken: 'also-revoked' });
        const onAuthLost = vi.fn();
        api.setAuthLostHandler(onAuthLost);

        await expect(api.listAtlas()).rejects.toBeInstanceOf(ApiError);

        expect(seen).toEqual(['/atlas', '/auth/refresh']); // one retry attempt, then give up
        expect(onAuthLost).toHaveBeenCalledTimes(1);
        expect(api.isAuthenticated()).toBe(false);
        expect(api.getAccessToken()).toBeNull(); // the dead token is not kept around
    });

    it('fires the auth-lost handler at most once across a burst of failures', async () => {
        const fetchImpl = vi.fn(async () => resp(401, { error: {} }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'a', refreshToken: 'r' });
        const onAuthLost = vi.fn();
        api.setAuthLostHandler(onAuthLost);

        await expect(api.listAtlas()).rejects.toBeTruthy();
        await expect(api.listAtlas()).rejects.toBeTruthy(); // no refresh token left → no second notify
        expect(onAuthLost).toHaveBeenCalledTimes(1);
    });

    it('maps a non-2xx error envelope to ApiError', async () => {
        const fetchImpl = vi.fn(async () => resp(403, { error: { code: 'FORBIDDEN', message: 'no access' } }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });

        await expect(api.getAtlas('x')).rejects.toMatchObject({
            name: 'ApiError', status: 403, code: 'FORBIDDEN', message: 'no access',
        });
        await expect(api.getAtlas('x')).rejects.toBeInstanceOf(ApiError);
    });

    // sv360 diverges on purpose and sends a FLAT `{ error: '...' }`. Three admin
    // 360 routes go through this generic client, and `.message` off a string is
    // undefined — the admin catalog tab showed "HTTP 404" instead of the server's
    // message.
    it('maps the FLAT sv360 error envelope to ApiError, keeping the message', async () => {
        const fetchImpl = vi.fn(async () => resp(404, { error: 'Project not found' }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });

        await expect(api.getAtlas('x')).rejects.toMatchObject({
            name: 'ApiError', status: 404, message: 'Project not found',
        });
    });

    it('still falls back to HTTP <status> when the body carries no usable error', async () => {
        for (const body of [{}, { error: null }, { error: {} }, null]) {
            const api = makeClient(vi.fn(async () => resp(500, body)));
            api.setTokens({ accessToken: 'tok' });
            await expect(api.getAtlas('x')).rejects.toMatchObject({
                name: 'ApiError', status: 500, message: 'HTTP 500',
            });
        }
    });
});

describe('ApiClient — envelope unwrap', () => {
    let api;
    beforeEach(() => { api = makeClient(vi.fn()); api.setTokens({ accessToken: 't' }); });

    it('unwraps the { data } envelope', async () => {
        api._fetch = async () => resp(200, { data: { serverVersion: 7 } });
        expect(await api.pushOperations('a1', [])).toEqual({ serverVersion: 7 });
    });

    it('returns the bare config object (frozen contract, no data key) as-is', async () => {
        api._fetch = async () => resp(200, { app: { title: 'X' }, features: { grid: true } });
        const cfg = await api.getConfig();
        expect(cfg.app.title).toBe('X');
        expect(cfg.features.grid).toBe(true);
    });

    it('returns bare arrays as-is', async () => {
        api._fetch = async () => resp(200, [{ id: 'a1' }, { id: 'a2' }]);
        expect(await api.listAtlas()).toHaveLength(2);
    });

    it('returns null on 204 (logout)', async () => {
        api._fetch = async () => resp(204);
        await expect(api.logout()).resolves.toBeUndefined();
        expect(api.getAccessToken()).toBeNull();
    });
});

describe('ApiClient — sync URLs', () => {
    it('pullSync hits /atlas/:id/sync/:version', async () => {
        const fetchImpl = vi.fn(async () => resp(200, { data: { isSnapshot: true, snapshot: {}, currentVersion: 3 } }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 't' });

        const out = await api.pullSync('atlas-9', 0);

        expect(out.isSnapshot).toBe(true);
        expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/atlas/atlas-9/sync/0');
    });

    it('pushOperations posts { operations } to /atlas/:id/sync', async () => {
        const fetchImpl = vi.fn(async () => resp(200, { data: { results: [], serverVersion: 1 } }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 't' });

        await api.pushOperations('atlas-9', [{ id: 'op1' }]);

        const [url, opts] = fetchImpl.mock.calls[0];
        expect(url).toBe('http://api.test/api/v1/atlas/atlas-9/sync');
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ operations: [{ id: 'op1' }] });
    });
});

describe('ApiClient — wsUrl', () => {
    it('builds an absolute ws URL from an absolute base with token + clientId', () => {
        const api = makeClient(vi.fn(), 'http://localhost:3001/api/v1');
        api.setTokens({ accessToken: 'jwt-123' });

        const url = new URL(api.wsUrl('atlas-1', { clientId: 'client-7' }));
        expect(url.protocol).toBe('ws:');
        expect(url.host).toBe('localhost:3001');
        expect(url.pathname).toBe('/api/v1/collab');
        expect(url.searchParams.get('atlasId')).toBe('atlas-1');
        expect(url.searchParams.get('token')).toBe('jwt-123');
        expect(url.searchParams.get('clientId')).toBe('client-7');
    });

    it('uses wss for an https base', () => {
        const api = makeClient(vi.fn(), 'https://ebgeo.example/api/v1');
        api.setTokens({ accessToken: 't' });
        expect(api.wsUrl('a1').startsWith('wss://ebgeo.example/api/v1/collab')).toBe(true);
    });
});

describe('ApiClient — images (§17.14 photos / §17.19 custom icons)', () => {
    it('uploadImage posts multipart to /atlas/:id/images with Authorization (no Content-Type)', async () => {
        const fetchImpl = vi.fn(async () => resp(201, { data: { id: 'img-1', filename: 'icon.png' } }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });
        const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

        const out = await api.uploadImage('atlas-1', blob, 'icon.png');

        expect(out).toEqual({ id: 'img-1', filename: 'icon.png' });
        const [url, opts] = fetchImpl.mock.calls[0];
        expect(url).toBe('http://api.test/api/v1/atlas/atlas-1/images');
        expect(opts.method).toBe('POST');
        expect(opts.headers.Authorization).toBe('Bearer tok');
        expect(opts.headers['Content-Type']).toBeUndefined();
        expect(opts.body).toBeInstanceOf(FormData);
    });

    it('uploadImage maps a rejected type to ApiError (400)', async () => {
        const fetchImpl = vi.fn(async () => resp(400, { error: { code: 'BAD_REQUEST', message: 'Invalid file type' } }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });
        const blob = new Blob([new Uint8Array([1])], { type: 'image/svg+xml' });
        await expect(api.uploadImage('a', blob, 'x.svg')).rejects.toMatchObject({ name: 'ApiError', status: 400 });
    });

    it('imageUrl builds the path; deleteImage hits DELETE', async () => {
        const fetchImpl = vi.fn(async () => resp(204));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });
        expect(api.imageUrl('a1', 'img-9')).toBe('http://api.test/api/v1/atlas/a1/images/img-9');
        await api.deleteImage('a1', 'img-9');
        expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/atlas/a1/images/img-9');
        expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
    });
});

/**
 * Proactive token renewal.
 *
 * The reactive 401 retry does not cover two upload paths: `uploadImage` builds its own
 * request and never retries, and `POST /images/bulk` only gets the backend's enlarged
 * 50 MB body parser when a VERIFIED principal is already attached — so an expired token
 * makes a >10 MB batch answer 413, which nothing here reacts to. Renewing before the
 * request is what keeps both alive.
 *
 * Negative control: drop the `_ensureFreshAccessToken()` call from `_request` and the
 * first and last cases fail; drop it from `uploadImage` and the multipart case fails.
 */
describe('ApiClient — proactive token renewal', () => {
    /** Builds a JWT-shaped token whose `exp` is `secondsFromNow` away. Signature is fake. */
    function jwtExpiringIn(secondsFromNow) {
        const b64url = (obj) => btoa(JSON.stringify(obj))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
        return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', exp })}.sig`;
    }

    it('renews an about-to-expire token BEFORE sending, and sends the NEW one', async () => {
        const fetchImpl = vi.fn(async (url) => (
            url.endsWith('/auth/refresh')
                ? resp(200, { data: { accessToken: jwtExpiringIn(900), refreshToken: 'refresh-2' } })
                : resp(200, { data: [] })
        ));
        const api = makeClient(fetchImpl);
        // 10s of life left, inside the 30s renewal headroom.
        api.setTokens({ accessToken: jwtExpiringIn(10), refreshToken: 'refresh-1' });

        await api.listAtlas();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/auth/refresh');
        const [url, opts] = fetchImpl.mock.calls[1];
        expect(url).toBe('http://api.test/api/v1/atlas');
        // The point of renewing before the header is built: the request must not carry
        // the stale token it was about to be refused for.
        expect(opts.headers.Authorization).toBe(`Bearer ${api.getAccessToken()}`);
        expect(opts.headers.Authorization).not.toBe('Bearer refresh-1');
    });

    it('leaves a token with plenty of life alone (no extra round trip)', async () => {
        const fetchImpl = vi.fn(async () => resp(200, { data: [] }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: jwtExpiringIn(900), refreshToken: 'refresh-1' });

        await api.listAtlas();

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/atlas');
    });

    it('leaves an UNREADABLE token alone rather than refreshing on every request', async () => {
        const fetchImpl = vi.fn(async () => resp(200, { data: [] }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'opaque-not-a-jwt', refreshToken: 'refresh-1' });

        await api.listAtlas();

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('uploadImage renews too — it is the path with no 401 retry at all', async () => {
        const fetchImpl = vi.fn(async (url) => (
            url.endsWith('/auth/refresh')
                ? resp(200, { data: { accessToken: jwtExpiringIn(900), refreshToken: 'refresh-2' } })
                : resp(201, { data: { id: 'img-1' } })
        ));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: jwtExpiringIn(5), refreshToken: 'refresh-1' });

        const created = await api.uploadImage('atlas-1', new Blob([new Uint8Array([1])]), 'x.png');

        expect(created).toEqual({ id: 'img-1' });
        expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/auth/refresh');
        expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${api.getAccessToken()}`);
    });

    it('a FAILED renewal surfaces the server 401, never a client-side throw', async () => {
        const fetchImpl = vi.fn(async (url) => (
            url.endsWith('/auth/refresh')
                ? resp(401, { error: { code: 'UNAUTHORIZED', message: 'Refresh token inválido' } })
                : resp(401, { error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } })
        ));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: jwtExpiringIn(1), refreshToken: 'refresh-dead' });

        // The request still goes out (anonymous) and the route's own 401 is what the
        // caller sees, with the same shape as before this renewal existed.
        await expect(api.listAtlas()).rejects.toMatchObject({ name: 'ApiError', status: 401 });
        expect(api.isAuthenticated()).toBe(false);
        // Asserted because the status alone proves nothing here: the REACTIVE path
        // (send → 401 → refresh → fail) ends in the very same ApiError, so without
        // this the case would stay green with the renewal removed.
        expect(fetchImpl.mock.calls[0][0]).toBe('http://api.test/api/v1/auth/refresh');
    });
});

describe('ApiClient — renovação proativa e o relógio local', () => {
    function jwtExpiringIn(secondsFromNow) {
        const b64url = (obj) => btoa(JSON.stringify(obj))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
        return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u1', exp })}.sig`;
    }

    it('stands down after ONE refresh when the renewed token still reads as expired', async () => {
        // Relógio local adiantado: todo token emitido pelo servidor já nasce "vencido"
        // para este cliente. Sem a rendição, seriam N refreshes para N requisições, cada
        // um rotacionando a família — e o limiter do /auth/refresh não cobra sucesso,
        // então nada freia. O comportamento correto é voltar ao caminho reativo de 401.
        const fetchImpl = vi.fn(async (url) => (
            url.endsWith('/auth/refresh')
                // O servidor devolve um token bom; é o RELÓGIO daqui que o lê como vencido.
                ? resp(200, { data: { accessToken: jwtExpiringIn(-3600), refreshToken: 'r-novo' } })
                : resp(200, { data: [] })
        ));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: jwtExpiringIn(-3600), refreshToken: 'r-1' });

        await api.listAtlas();
        await api.listAtlas();
        await api.listAtlas();

        const refreshes = fetchImpl.mock.calls.filter(([u]) => u.endsWith('/auth/refresh'));
        expect(refreshes).toHaveLength(1);
        // E as três requisições saíram assim mesmo: render-se não é falhar.
        expect(fetchImpl.mock.calls.filter(([u]) => u.endsWith('/atlas'))).toHaveLength(3);
    });

    it('does NOT stand down when the renewal actually produced a fresh token', async () => {
        // Controle do caso acima: com relógio são, a renovação tem de continuar armada.
        // Sem este teste, o anterior passaria igual se a renovação tivesse sido desligada
        // de vez. O que discrimina é a SEGUNDA renovação: só acontece se a bandeira de
        // rendição não foi levantada na primeira.
        const fetchImpl = vi.fn(async (url) => (
            url.endsWith('/auth/refresh')
                ? resp(200, { data: { accessToken: jwtExpiringIn(900), refreshToken: 'r-novo' } })
                : resp(200, { data: [] })
        ));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: jwtExpiringIn(5), refreshToken: 'r-1' });

        await api.listAtlas(); // renova (1): o token novo tem 900s, nada de rendição
        await api.listAtlas(); // token bom, nenhuma renovação
        // Passaram-se ~15 min de sessão: o token voltou a se aproximar do vencimento.
        api.setTokens({ accessToken: jwtExpiringIn(5), refreshToken: 'r-novo' });
        await api.listAtlas(); // renova (2) — prova que a rendição não foi acionada

        expect(fetchImpl.mock.calls.filter(([u]) => u.endsWith('/auth/refresh'))).toHaveLength(2);
        expect(fetchImpl.mock.calls.filter(([u]) => u.endsWith('/atlas'))).toHaveLength(3);
    });
});

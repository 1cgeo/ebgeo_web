import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    ApiClient,
    ApiError,
    buildApiErrorMessage,
    isTerminalRefreshFailure,
} from '@store/sync/api-client.js';

/**
 * Two contracts with the backend that used to be decided (or discarded) in the wrong place:
 *
 * 1. WHICH refresh failure ends the session. `refresh()` cleared the tokens and fired
 *    auth-lost on ANY error, and the chain from there is destructive:
 *    `handleSessionLost` → `_handleLogout` → `clearAllDataStore()`. The `refreshLimiter`
 *    is keyed by IP and the deployment is a military network behind NAT, so a 429 on
 *    `/auth/refresh` is an expected outcome of shared egress — and it was erasing unsynced
 *    local work. The decision is extracted into `isTerminalRefreshFailure` precisely so it
 *    can be pinned here, in node, without a server.
 *
 * 2. WHAT a 422 tells the user. The backend names the offending field only inside
 *    `error.details`, as a finished pt-BR sentence; the top-level message is the constant
 *    'Falha na validação'.
 */

/** Builds a fetch Response-like object. */
function resp(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
}

function makeClient(fetchImpl) {
    return new ApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fetchImpl });
}

afterEach(() => {
    vi.useRealTimers();
});

describe('isTerminalRefreshFailure — só credencial recusada é terminal', () => {
    it('treats a credential rejection as terminal', () => {
        // 401: dead/reused refresh token. 403: deactivated organization (ForbiddenError in
        // auth.service). Neither improves by trying again.
        expect(isTerminalRefreshFailure(new ApiError('x', { status: 401, code: 'UNAUTHORIZED' }))).toBe(true);
        expect(isTerminalRefreshFailure(new ApiError('x', { status: 403, code: 'FORBIDDEN' }))).toBe(true);
    });

    it('treats a throttled or broken server as TRANSIENT', () => {
        // The case that motivated the fix: 429 from the IP-keyed refreshLimiter.
        expect(isTerminalRefreshFailure(new ApiError('x', { status: 429, code: 'TOO_MANY_REQUESTS' }))).toBe(false);
        expect(isTerminalRefreshFailure(new ApiError('x', { status: 500, code: 'INTERNAL_ERROR' }))).toBe(false);
        expect(isTerminalRefreshFailure(new ApiError('x', { status: 502 }))).toBe(false);
        expect(isTerminalRefreshFailure(new ApiError('x', { status: 503 }))).toBe(false);
    });

    it('treats a failure with NO status (network, abort) as transient', () => {
        expect(isTerminalRefreshFailure(new TypeError('Failed to fetch'))).toBe(false);
        const aborted = new Error('The operation was aborted');
        aborted.name = 'AbortError';
        expect(isTerminalRefreshFailure(aborted)).toBe(false);
    });

    it('falls back to the code only when there is no status', () => {
        expect(isTerminalRefreshFailure({ code: 'UNAUTHORIZED' })).toBe(true);
        expect(isTerminalRefreshFailure({ code: 'FORBIDDEN' })).toBe(true);
        expect(isTerminalRefreshFailure({ code: 'TOO_MANY_REQUESTS' })).toBe(false);
        // Status wins when present: it is what the server derives the code from, and a body
        // from a proxy can carry anything.
        expect(isTerminalRefreshFailure({ status: 429, code: 'UNAUTHORIZED' })).toBe(false);
    });

    it('is safe on garbage input (bordas)', () => {
        for (const bad of [null, undefined, {}, 'boom', 0, new Error('plain')]) {
            expect(isTerminalRefreshFailure(bad)).toBe(false);
        }
        // NaN/non-numeric status must not read as "some HTTP status", nor as terminal.
        expect(isTerminalRefreshFailure({ status: NaN })).toBe(false);
        expect(isTerminalRefreshFailure({ status: '401' })).toBe(false);
    });
});

describe('ApiClient.refresh — a sessão só morre quando o servidor recusa a credencial', () => {
    it('KEEPS the tokens and does not notify on a 429 (NAT compartilhado)', async () => {
        const fetchImpl = vi.fn(async () => resp(429, {
            error: { code: 'TOO_MANY_REQUESTS', message: 'Muitas tentativas. Tente novamente mais tarde.' },
        }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
        const onAuthLost = vi.fn();
        api.setAuthLostHandler(onAuthLost);

        await expect(api.refresh()).rejects.toMatchObject({ name: 'ApiError', status: 429 });

        expect(onAuthLost).not.toHaveBeenCalled();
        expect(api.isAuthenticated()).toBe(true);
        expect(api.getAccessToken()).toBe('access-1');
    });

    it('KEEPS the tokens on a 5xx and on a dead network', async () => {
        const cases = [
            async () => resp(503, { error: { code: 'INTERNAL_ERROR', message: 'down' } }),
            async () => { throw new TypeError('Failed to fetch'); },
        ];
        for (const fetchImpl of cases) {
            const api = makeClient(vi.fn(fetchImpl));
            api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
            const onAuthLost = vi.fn();
            api.setAuthLostHandler(onAuthLost);

            await expect(api.refresh()).rejects.toBeTruthy();

            expect(onAuthLost).not.toHaveBeenCalled();
            expect(api.isAuthenticated()).toBe(true);
        }
    });

    it('still DROPS the session on a 401 (controle do caso acima)', async () => {
        // Without this the whole suite would stay green with the terminal branch deleted.
        const fetchImpl = vi.fn(async () => resp(401, {
            error: { code: 'UNAUTHORIZED', message: 'Sessão inválida. Entre novamente.' },
        }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
        const onAuthLost = vi.fn();
        api.setAuthLostHandler(onAuthLost);

        await expect(api.refresh()).rejects.toMatchObject({ name: 'ApiError', status: 401 });

        expect(onAuthLost).toHaveBeenCalledTimes(1);
        expect(api.isAuthenticated()).toBe(false);
        expect(api.getAccessToken()).toBeNull();
    });

    it('a transient failure lets the NEXT call succeed, once the cooldown is over', async () => {
        vi.useFakeTimers();
        let failNext = true;
        const fetchImpl = vi.fn(async () => (failNext
            ? resp(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } })
            : resp(200, { data: { accessToken: 'access-2', refreshToken: 'refresh-2' } })));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });

        await expect(api.refresh()).rejects.toMatchObject({ status: 429 });

        // Inside the cooldown the client does NOT ask again: keeping the tokens means the
        // caller retries (sync-flush every 1.5 s), and hammering a limiter that only charges
        // failures would punish every client on the same address.
        failNext = false;
        await expect(api.refresh()).rejects.toMatchObject({ status: 429 });
        expect(fetchImpl).toHaveBeenCalledTimes(1);

        vi.setSystemTime(Date.now() + 31000);
        await api.refresh();

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(api.getAccessToken()).toBe('access-2');
    });
});

describe('ApiError — o campo que o servidor nomeou chega ao usuário', () => {
    it('composes the message from `details` on a 422 and keeps `details` on the error', async () => {
        // The envelope is what the server really sends since 2026-08-16: `message` is a
        // complete pt-BR sentence naming the field in Portuguese, `field` stays the wire key
        // (`backend/src/utils/validation-messages.js`).
        const fetchImpl = vi.fn(async () => resp(422, {
            error: {
                code: 'VALIDATION_ERROR',
                message: 'Falha na validação',
                details: [
                    { field: 'username', message: 'Usuário aceita apenas letras, números, ponto, hífen e sublinhado.' },
                    { field: 'password', message: 'Senha deve ter ao menos 6 caracteres.' },
                ],
            },
        }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });

        const error = await api.createUser({ username: 'a b', password: '1' }).catch(e => e);

        expect(error).toBeInstanceOf(ApiError);
        expect(error.status).toBe(422);
        expect(error.details).toHaveLength(2);
        // The wire key survives on `details` for anything that needs it...
        expect(error.details[0].field).toBe('username');
        // ...while the message the user reads is the server's sentence, verbatim. The generic
        // 'Falha na validação' is gone, and no `password:` prefix is bolted onto a sentence
        // that already says "Senha".
        expect(error.message).toBe(
            'Usuário aceita apenas letras, números, ponto, hífen e sublinhado.'
            + '; Senha deve ter ao menos 6 caracteres.'
        );
    });

    it('leaves every other envelope exactly as it was', async () => {
        const fetchImpl = vi.fn(async () => resp(403, { error: { code: 'FORBIDDEN', message: 'no access' } }));
        const api = makeClient(fetchImpl);
        api.setTokens({ accessToken: 'tok' });

        await expect(api.getAtlas('x')).rejects.toMatchObject({
            status: 403, code: 'FORBIDDEN', message: 'no access', details: null,
        });
    });
});

describe('buildApiErrorMessage — bordas', () => {
    it('falls back to the envelope message when details are absent or unusable', () => {
        const base = { code: 'VALIDATION_ERROR', message: 'Falha na validação' };
        expect(buildApiErrorMessage({ ...base, details: [] }, 422)).toBe('Falha na validação');
        expect(buildApiErrorMessage({ ...base, details: null }, 422)).toBe('Falha na validação');
        expect(buildApiErrorMessage({ ...base, details: 'boom' }, 422)).toBe('Falha na validação');
        expect(buildApiErrorMessage({ ...base, details: [{}, { field: '' }] }, 422)).toBe('Falha na validação');
    });

    it('does not compose for a code that is not VALIDATION_ERROR', () => {
        const err = { code: 'CONFLICT', message: 'Já existe um registro com esses dados. Altere e tente de novo.', details: [{ field: 'x', message: 'y' }] };
        expect(buildApiErrorMessage(err, 409)).toBe('Já existe um registro com esses dados. Altere e tente de novo.');
    });

    it('uses the field alone when the detail has no message, and HTTP <status> as the floor', () => {
        expect(buildApiErrorMessage({ code: 'VALIDATION_ERROR', details: [{ field: 'nome' }] }, 422)).toBe('nome');
        expect(buildApiErrorMessage(null, 500)).toBe('HTTP 500');
        expect(buildApiErrorMessage(undefined, 404)).toBe('HTTP 404');
        expect(buildApiErrorMessage({}, 418)).toBe('HTTP 418');
    });
});

// Path: tests/integration/envio-413-sessao-vencida.repro.test.js

/**
 * REPRO: a large image upload whose session the SERVER no longer recognizes answers 413, not 401,
 * and the photo became a definitive refusal.
 *
 * The backend picks the enlarged body parser (50 MB) for the image bulk route and the two import
 * routes only when `flexibleAuth` has already attached a verified principal (`backend/src/app.js`),
 * and it stays that way on purpose: an anonymous caller must never buy the bigger buffer. So with
 * a token the server reads as expired, a body over the global 10 MB cap falls to the small parser
 * and is refused by SIZE before any route can say 401. The proactive renewal
 * (`_ensureFreshAccessToken`) covers the expiry the local clock sees; it misses a clock that runs
 * behind the server's and a session cut on the server. Nothing reacted to that 413, so the blob
 * queue recorded the photo as refused for good (`atlas-image-upload.js`).
 *
 * Owner's decision of 2026-09-26: the client renews and tries once more. It does not resend on
 * every 413, because a 413 that is really about size is routine (the bulk upload splits its chunk
 * on it) and a blind resend would cost up to 50 MB each time. After a 413 it asks the cheapest
 * authenticated question (`GET /auth/me`): if answering it needed a renewal, the session was the
 * cause and the request goes again, once; if not, the 413 stands.
 *
 * The server half (a credential it does not verify gets the small parser and a 413) is pinned by
 * `backend/tests/integration/bulk-parser-scope.repro.test.js`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiClient, ApiError } from '../../src/js/store/sync/api-client.js';

function resp(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
}

const BASE = 'http://api.test/api/v1';
const ATLAS = '11111111-2222-4333-8444-555555555555';
const BULK = `/atlas/${ATLAS}/images/bulk`;
const GRANDE = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' } };
const imagem = { localId: 'img-1', filename: 'foto.jpg', mimeType: 'image/jpeg', data: 'AAAA' };

/**
 * A server that recognizes only `access-2`: under any other token the bulk route answers 413 (the
 * small parser) and `/auth/me` answers 401. `bulkSempre413` makes the size refusal real.
 */
function servidor({ bulkSempre413 = false } = {}) {
    const fetchImpl = vi.fn(async (url, opts) => {
        const caminho = url.replace(BASE, '');
        const valido = opts.headers?.Authorization === 'Bearer access-2';
        if (caminho === '/auth/refresh') {
            return resp(200, { data: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
        }
        if (caminho === '/auth/me') {
            return valido ? resp(200, { data: { id: 'u1' } }) : resp(401, { error: { code: 'UNAUTHORIZED' } });
        }
        if (caminho === BULK) {
            if (bulkSempre413 || !valido) return resp(413, GRANDE);
            return resp(200, { data: { uploaded: [{ localId: 'img-1' }], failed: [], mapping: { 'img-1': 'srv-1' } } });
        }
        throw new Error(`unexpected url ${url}`);
    });
    return fetchImpl;
}

const caminhos = (fetchImpl) => fetchImpl.mock.calls.map((c) => c[0].replace(BASE, ''));

describe('413 no envio de imagem com a sessão vencida no servidor', () => {
    it('renova a sessão e reenvia UMA vez, e a foto sobe', async () => {
        const fetchImpl = servidor();
        const api = new ApiClient({ baseUrl: BASE, fetch: fetchImpl });
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });

        const res = await api.bulkUploadImages(ATLAS, [imagem]);

        expect(res.mapping).toEqual({ 'img-1': 'srv-1' });
        expect(caminhos(fetchImpl)).toEqual([BULK, '/auth/me', '/auth/refresh', '/auth/me', BULK]);
        expect(fetchImpl.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer access-2');
    });

    it('com a sessão viva, o 413 é de TAMANHO: sobe como está, sem reenviar os bytes', async () => {
        const fetchImpl = servidor({ bulkSempre413: true });
        const api = new ApiClient({ baseUrl: BASE, fetch: fetchImpl });
        api.setTokens({ accessToken: 'access-2', refreshToken: 'refresh-2' });

        const erro = await api.bulkUploadImages(ATLAS, [imagem]).catch((e) => e);

        expect(erro).toBeInstanceOf(ApiError);
        expect(erro.status).toBe(413);
        expect(caminhos(fetchImpl)).toEqual([BULK, '/auth/me']);
    });

    it('tenta UMA vez só: um segundo 413 depois da renovação sobe, sem nova sonda', async () => {
        const fetchImpl = servidor({ bulkSempre413: true });
        const api = new ApiClient({ baseUrl: BASE, fetch: fetchImpl });
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });

        const erro = await api.bulkUploadImages(ATLAS, [imagem]).catch((e) => e);

        expect(erro.status).toBe(413);
        expect(caminhos(fetchImpl)).toEqual([BULK, '/auth/me', '/auth/refresh', '/auth/me', BULK]);
    });

    it('sem sessão renovável (link público, anônimo) não há o que perguntar: o 413 sobe direto', async () => {
        const fetchImpl = servidor({ bulkSempre413: true });
        const api = new ApiClient({ baseUrl: BASE, fetch: fetchImpl });
        api.setTokens({ accessToken: 'access-1' });

        const erro = await api.bulkUploadImages(ATLAS, [imagem]).catch((e) => e);

        expect(erro.status).toBe(413);
        expect(caminhos(fetchImpl)).toEqual([BULK]);
    });

    it('vale também para a importação, que usa o mesmo parser (o envio ao servidor de um atlas local)', async () => {
        const fetchImpl = vi.fn(async (url, opts) => {
            const caminho = url.replace(BASE, '');
            const valido = opts.headers?.Authorization === 'Bearer access-2';
            if (caminho === '/auth/refresh') return resp(200, { data: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
            if (caminho === '/auth/me') return valido ? resp(200, { data: { id: 'u1' } }) : resp(401, {});
            if (caminho === '/atlas/imports') return valido ? resp(200, { data: { imageIds: [] } }) : resp(413, GRANDE);
            throw new Error(`unexpected url ${url}`);
        });
        const api = new ApiClient({ baseUrl: BASE, fetch: fetchImpl });
        api.setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });

        const res = await api._request('POST', '/atlas/imports', { body: { id: 'x' }, timeoutMs: 120000 });

        expect(res).toEqual({ imageIds: [] });
        expect(caminhos(fetchImpl)).toEqual(['/atlas/imports', '/auth/me', '/auth/refresh', '/auth/me', '/atlas/imports']);
    });
});

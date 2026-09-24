import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, uploadDeadlineMs } from '../../src/js/store/sync/api-client.js';

afterEach(() => vi.useRealTimers());

describe('Sync HTTP deadline and cancellation', () => {
    it('bounds a push even when the transport ignores abort', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() => new Promise(() => {}));
        const api = new ApiClient({ fetch });
        const sent = api.pushOperations('atlas', [{ id: 'original-id' }]);
        const rejected = expect(sent).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(uploadDeadlineMs(JSON.stringify({ operations: [{ id: 'original-id' }] }).length));
        await rejected;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(JSON.parse(fetch.mock.calls[0][1].body).operations[0].id).toBe('original-id');
    });

    /**
     * O PRAZO DO PUSH CRESCE COM O CORPO (2026-09-23). Com os 30 s fixos, um lote que precisa de
     * mais tempo que isso para SUBIR era cortado no meio do envio a cada tentativa, o servidor não
     * o via nunca e a fila reenviava a mesma cabeça para sempre, segurando toda edição seguinte.
     * Medido no navegador em `tests/e2e-ui/push-em-link-lento.repro.spec.js` (40 kbps, 324 KB).
     */
    it('does not cut a large push at 30 s: the deadline is sized from the body', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() => new Promise(() => {}));
        const api = new ApiClient({ fetch });
        const big = [{ id: 'big', data: { coords: 'x'.repeat(324000) } }];
        let settled = null;
        api.pushOperations('atlas', big).then(() => { settled = 'ok'; }, (e) => { settled = e.code; });
        await vi.advanceTimersByTimeAsync(90000);
        expect(settled, 'a 324 KB push needs ~65 s at 40 kbps and must still be in flight at 90 s').toBeNull();
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
        const bytes = new TextEncoder().encode(fetch.mock.calls[0][1].body).byteLength;
        await vi.advanceTimersByTimeAsync(uploadDeadlineMs(bytes) - 90000);
        expect(settled).toBe('REQUEST_TIMEOUT');
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('sizes the upload deadline from the body: base for nothing, monotonic, never NaN', () => {
        const base = uploadDeadlineMs(0);
        expect(base).toBe(30000);
        for (const bad of [-1, NaN, Infinity, -Infinity, undefined, null, '10']) {
            expect(uploadDeadlineMs(bad), String(bad)).toBe(base);
        }
        expect(uploadDeadlineMs(1)).toBe(31000);
        // 40 kbps (5000 B/s) must fit with margin: twice the body's own transfer time at that rate
        // is always inside the deadline.
        for (const bytes of [2000, 150000, 324000, 1000000, 10 * 1024 * 1024]) {
            expect(uploadDeadlineMs(bytes), String(bytes)).toBeGreaterThanOrEqual(base + (bytes / 5000) * 1000 * 2);
            expect(uploadDeadlineMs(bytes + 1)).toBeGreaterThanOrEqual(uploadDeadlineMs(bytes));
        }
    });

    it('sizes the receipt lookup deadline the same way', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() => new Promise(() => {}));
        const api = new ApiClient({ fetch });
        let settled = null;
        api.lookupOperationReceipts('atlas', [{ id: 'big', data: 'y'.repeat(200000) }])
            .then(() => { settled = 'ok'; }, (e) => { settled = e.code; });
        await vi.advanceTimersByTimeAsync(60000);
        expect(settled).toBeNull();
        const bytes = new TextEncoder().encode(fetch.mock.calls[0][1].body).byteLength;
        await vi.advanceTimersByTimeAsync(uploadDeadlineMs(bytes) - 60000);
        expect(settled).toBe('REQUEST_TIMEOUT');
    });

    /**
     * O PRIMEIRO PEDIDO DE TODO `connect` TEM PRAZO (2026-09-23). Sem `timeoutMs`, `_request` só
     * desiste quando outro gesto aborta a sessão, e um servidor que aceitou a conexão e nunca
     * respondeu segurava a abertura do atlas inteira, sem `connecting`, sem socket e sem falha de
     * onde a cadeia de boot pudesse cair. Mesmo prazo dos recibos, e com o mesmo sinal de parada.
     */
    it('bounds the protocol negotiation, which is the first request of every connect', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() => new Promise(() => {}));
        const api = new ApiClient({ fetch });
        const rejected = expect(api.getSyncProtocol('atlas')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(30000);
        await rejected;
        expect(fetch.mock.calls[0][0]).toMatch(/\/atlas\/atlas\/sync\/protocol$/);
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    });

    it('keeps the deadline until the response body is read', async () => {
        vi.useFakeTimers();
        const api = new ApiClient({ fetch: vi.fn(async () => ({
            ok: true, status: 200, text: () => new Promise(() => {}),
        })) });
        const rejected = expect(api.pullSync('atlas')).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(180000);
        await rejected;
    });

    it('a closed atlas cancels its request before a delayed response can be used', async () => {
        const api = new ApiClient({ fetch: vi.fn(() => new Promise(() => {})) });
        const controller = new AbortController();
        const request = api.pullSync('atlas', 12, { signal: controller.signal });
        const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await rejected;
    });

    it('exposes Retry-After for the flush backoff', async () => {
        const api = new ApiClient({ fetch: vi.fn(async () => ({
            ok: false, status: 429, headers: new Headers({ 'Retry-After': '120' }),
            text: async () => JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Aguarde.' } }),
        })) });
        await expect(api.pushOperations('atlas', [{ id: 'a' }])).rejects.toMatchObject({
            status: 429, retryAfterMs: 120000,
        });
    });

    /**
     * O `Retry-After` HTTP-DATE, que é a outra forma que a RFC permite. Um servidor atrás de um
     * proxy pode mandar qualquer uma das duas, e ler só o inteiro deixaria `retryAfterMs`
     * indefinido: o flush voltaria ao backoff curto contra um servidor que pediu minutos.
     */
    it('reads Retry-After as an HTTP date too, never as NaN', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
        const api = new ApiClient({ fetch: vi.fn(async () => ({
            ok: false, status: 503, headers: new Headers({ 'Retry-After': 'Sun, 13 Sep 2026 12:01:00 GMT' }),
            text: async () => JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Em manutenção.' } }),
        })) });
        await expect(api.pushOperations('atlas', [{ id: 'a' }])).rejects.toMatchObject({
            status: 503, retryAfterMs: 60000,
        });

        // CONTROLE NEGATIVO da leitura: cabeçalho ilegível não pode virar prazo inventado, nem um
        // `NaN` que o `Math.max` do flush propagaria como espera eterna.
        const ilegivel = new ApiClient({ fetch: vi.fn(async () => ({
            ok: false, status: 503, headers: new Headers({ 'Retry-After': 'depois' }),
            text: async () => '',
        })) });
        await expect(ilegivel.pushOperations('atlas', [{ id: 'a' }])).rejects.toMatchObject({
            status: 503, retryAfterMs: undefined,
        });
    });

    /**
     * CANCELAR NÃO É RECUSAR, e este é o lado do cliente do que
     * `tests/integration/sync-engine.test.js` mede na fila: o erro que sai daqui não carrega
     * `status` nenhum, então nenhuma classificação a jusante pode lê-lo como "o servidor disse
     * não" e descartar a operação.
     */
    it('a cancelled push carries no rejection status, so nothing downstream reads it as a refusal', async () => {
        const api = new ApiClient({ fetch: vi.fn(() => new Promise(() => {})) });
        const controller = new AbortController();
        const push = api.pushOperations('atlas', [{ id: 'op-1' }], { signal: controller.signal });
        const rejeitado = push.catch(error => error);
        controller.abort();
        const error = await rejeitado;
        expect(error.name).toBe('AbortError');
        expect(error.status).toBeUndefined();
        expect(error.retryAfterMs).toBeUndefined();
    });

    /**
     * O RETRY DE 401 REENVIA O MESMO CORPO. O envelope carrega o `op.id` que torna a aplicação
     * idempotente no servidor, então um retry que recunhasse o pedido pediria para aplicar duas
     * vezes a mesma edição.
     */
    it('the transparent 401 retry re-sends the identical envelope', async () => {
        const respostas = [
            { ok: false, status: 401, headers: new Headers(), text: async () => JSON.stringify({ error: { code: 'TOKEN_EXPIRED' } }) },
            { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: { results: [] } }) },
        ];
        const fetch = vi.fn(async (url) => (url.endsWith('/auth/refresh')
            ? { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ data: { accessToken: 'novo', refreshToken: 'r2' } }) }
            : respostas.shift()));
        const api = new ApiClient({ fetch });
        api.setTokens({ accessToken: 'velho', refreshToken: 'r1' });

        await api.pushOperations('atlas', [{ id: 'op-1', lamportTimestamp: 7 }]);

        const corpos = fetch.mock.calls
            .filter(([url]) => url.endsWith('/sync'))
            .map(([, init]) => JSON.parse(init.body));
        expect(corpos).toHaveLength(2);
        expect(corpos[0]).toEqual(corpos[1]);
        expect(corpos[1].operations[0].id).toBe('op-1');
    });
});

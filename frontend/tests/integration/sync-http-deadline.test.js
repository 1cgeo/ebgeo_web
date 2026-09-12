import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

afterEach(() => vi.useRealTimers());

describe('Sync HTTP deadline and cancellation', () => {
    it('bounds a push even when the transport ignores abort', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn(() => new Promise(() => {}));
        const api = new ApiClient({ fetch });
        const sent = api.pushOperations('atlas', [{ id: 'original-id' }]);
        const rejected = expect(sent).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
        await vi.advanceTimersByTimeAsync(30000);
        await rejected;
        expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
        expect(JSON.parse(fetch.mock.calls[0][1].body).operations[0].id).toBe('original-id');
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
});

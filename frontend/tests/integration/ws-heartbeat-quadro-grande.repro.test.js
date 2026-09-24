// Path: tests/integration/ws-heartbeat-quadro-grande.repro.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WsClient } from '../../src/js/store/sync/ws-client.js';
import { ConnectionState } from '../../src/js/store/sync/connection-state.js';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

/**
 * REPRO: the client heartbeat closed a CONGESTED socket as if it were dead, and on a slow downlink
 * that became a reconnection loop that never converged.
 *
 * The browser delivers a WebSocket message only when the whole frame has arrived, and the server's
 * `pong` travels behind whatever it queued first. At 40 kbps a 324 KB frame (a `sync_response`
 * replay, or one detailed feature broadcast live) takes about 65 s; the heartbeat closed the socket
 * at its second tick (25 to 50 s), the reconnect asked for the same tail, the server queued the
 * same frame, and the heartbeat cut it again. The browser proof is
 * `tests/e2e-ui/ws-quadro-grande-em-link-lento.repro.spec.js`; this is the interleaving made
 * deterministic, with the clock faked and the link modelled as "everything the server sends on a
 * socket arrives 65 s after that socket connects".
 */

const HEARTBEAT_MS = 25000;
const FRAME_MS = 65000;

class FakeSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 1;
        this.sent = [];
        this.closedWith = null;
        FakeSocket.instances.push(this);
    }
    send(str) {
        const msg = JSON.parse(str);
        this.sent.push(msg);
        // Once the large frame is through, the link answers pings at once.
        if (this.healthy && msg.type === 'ping') queueMicrotask(() => this.emit({ type: 'pong' }));
    }
    close(code, reason) {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.closedWith = { code, reason, at: Date.now() };
        this.onclose?.({ code, reason });
    }
    emit(obj) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(obj) }); }
    pings() { return this.sent.filter((m) => m.type === 'ping').length; }
}
FakeSocket.instances = [];

function setup({ congested = true } = {}) {
    FakeSocket.instances = [];
    const api = new ApiClient({ baseUrl: 'http://h:3001/api/v1', fetch: vi.fn() });
    api.setTokens({ accessToken: 'jwt' });
    const delivered = [];
    const ws = new WsClient({
        apiClient: api,
        connectionState: new ConnectionState(),
        clientId: 'me',
        heartbeatMs: HEARTBEAT_MS,
        reconnectBaseMs: 50,
        socketFactory: (url) => {
            const sock = new FakeSocket(url);
            // The handshake frame is small and arrives at once; the tail asked by `sync_request`
            // is the large frame, and every pong queued after it arrives only with it.
            queueMicrotask(() => sock.emit({ type: 'connected', sessionId: 'me', permission: 'write', role: 'editor' }));
            if (congested) {
                const connectedAt = Date.now();
                setTimeout(() => {
                    if (sock.readyState !== 1) return;
                    sock.emit({ type: 'sync_response', isSnapshot: false, ops: [], currentVersion: 42 });
                    for (let i = 0; i < sock.pings(); i++) sock.emit({ type: 'pong' });
                    sock.healthy = true;
                }, connectedAt + FRAME_MS - Date.now());
            }
            return sock;
        },
    });
    ws.on('syncResponse', async (msg) => { delivered.push({ at: Date.now(), version: msg.currentVersion }); });
    return { ws, delivered };
}

afterEach(() => { vi.useRealTimers(); });

describe('heartbeat on a congested downlink', () => {
    it('a frame that takes 65 s to arrive is delivered, after at most one reconnection', async () => {
        vi.useFakeTimers();
        const { ws, delivered } = setup();
        const t0 = Date.now();
        ws.connect('atlas-1').catch(() => {});
        await vi.advanceTimersByTimeAsync(400000);

        expect(delivered.length, 'the large frame reached the client').toBeGreaterThan(0);
        expect(FakeSocket.instances.length, 'converged without a reconnection loop').toBeLessThanOrEqual(2);
        // Once the frame is through, the link is healthy again and nothing else is closed.
        const survivor = FakeSocket.instances[FakeSocket.instances.length - 1];
        expect(survivor.readyState).toBe(1);
        expect(ws._lastVersion).toBe(42);
        expect(delivered[0].at - t0).toBeLessThan(200000);
        ws.disconnect();
    });

    it('while the pong is overdue the ping keeps going up, so the server does not reap the socket', async () => {
        vi.useFakeTimers();
        const { ws } = setup();
        ws.connect('atlas-1').catch(() => {});
        // First socket closes at its second tick (tolerance 1), the second one waits.
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 1000);
        expect(FakeSocket.instances.length).toBe(2);
        const second = FakeSocket.instances[1];
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 5000);
        // Two ticks with the pong overdue, and a ping went up on each: the server sees a frame at
        // least every 25 s, inside its 30 s sweep.
        expect(second.readyState).toBe(1);
        expect(second.pings()).toBeGreaterThanOrEqual(2);
        ws.disconnect();
    });

    it('a dead link is still closed: the escalation is bounded', async () => {
        vi.useFakeTimers();
        const { ws } = setup({ congested: false });
        ws.connect('atlas-1').catch(() => {});
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 1000);
        // Tolerance 1: the historical behaviour on a socket that never answers.
        expect(FakeSocket.instances[0].closedWith?.reason).toBe('heartbeat timeout');
        // Keep the link dead through several escalations; every socket is eventually closed and
        // none waits more than the cap.
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 60);
        const lived = FakeSocket.instances.filter((s) => s.closedWith).map((s, i) => ({ i, reason: s.closedWith.reason }));
        expect(lived.length).toBeGreaterThanOrEqual(4);
        expect(lived.every((s) => s.reason === 'heartbeat timeout')).toBe(true);
        ws.disconnect();
    });

    it('a pong within its own tick brings the tolerance back to one', async () => {
        vi.useFakeTimers();
        const { ws } = setup({ congested: false });
        ws.connect('atlas-1').catch(() => {});
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 1000);
        expect(FakeSocket.instances).toHaveLength(2);
        expect(ws._missedTicksAllowed).toBe(2);
        const second = FakeSocket.instances[1];
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
        second.emit({ type: 'pong' });
        expect(ws._missedTicksAllowed).toBe(1);
        // And a fresh connect() is a new intent: strict again even after escalation.
        ws.disconnect();
        ws._missedTicksAllowed = 8;
        ws.connect('atlas-2').catch(() => {});
        expect(ws._missedTicksAllowed).toBe(1);
        ws.disconnect();
    });
});

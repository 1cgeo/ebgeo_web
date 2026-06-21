import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsClient } from '../../src/js/store/sync/ws-client.js';
import { ConnectionState, ConnectionStates } from '../../src/js/store/sync/connection-state.js';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

/**
 * WS transport tests against a fake socket (WHATWG WebSocket API surface). Pin the
 * handshake → state machine, inbound routing, own-echo filtering, ack/sync_response,
 * and reconnect-with-replay.
 */

/** Minimal fake of the global WebSocket (onopen/onmessage/onclose/onerror + send/close). */
class FakeSocket {
    constructor(url) {
        this.url = url;
        this.readyState = 1; // OPEN
        this.sent = [];
        FakeSocket.instances.push(this);
    }
    send(str) { this.sent.push(JSON.parse(str)); }
    close(code, reason) {
        this.readyState = 3; // CLOSED
        this.onclose?.({ code, reason });
    }
    /** Test helper: deliver a server message. */
    emit(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
    get last() { return this.sent[this.sent.length - 1]; }
}
FakeSocket.instances = [];

function setup({ clientId = 'me', heartbeatMs = 10_000_000, reconnectBaseMs = 50 } = {}) {
    FakeSocket.instances = [];
    const conn = new ConnectionState();
    const api = new ApiClient({ baseUrl: 'http://h:3001/api/v1', fetch: vi.fn() });
    api.setTokens({ accessToken: 'jwt' });
    const ws = new WsClient({
        apiClient: api,
        connectionState: conn,
        socketFactory: (url) => new FakeSocket(url),
        clientId,
        heartbeatMs,
        reconnectBaseMs,
    });
    return { ws, conn, api };
}

describe('WsClient — handshake', () => {
    it('connects: OFFLINE → CONNECTING → ONLINE on the connected frame', async () => {
        const { ws, conn } = setup();
        const onConnected = vi.fn();
        ws.on('connected', onConnected);

        const p = ws.connect('atlas-1');
        expect(conn.getState()).toBe(ConnectionStates.CONNECTING);

        const sock = FakeSocket.instances[0];
        expect(new URL(sock.url).searchParams.get('atlasId')).toBe('atlas-1');
        sock.emit({ type: 'connected', sessionId: 'me', permission: 'owner', role: 'owner', usersOnline: [] });

        const session = await p;
        expect(session.permission).toBe('owner');
        expect(conn.getState()).toBe(ConnectionStates.ONLINE);
        expect(ws.isConnected()).toBe(true);
        expect(onConnected).toHaveBeenCalledOnce();
    });
});

describe('WsClient — inbound routing', () => {
    let ctx, sock;
    beforeEach(async () => {
        ctx = setup();
        const p = ctx.ws.connect('atlas-1');
        sock = FakeSocket.instances[0];
        sock.emit({ type: 'connected', sessionId: 'me', permission: 'owner', role: 'owner' });
        await p;
    });

    // Inbound ops apply on a serialized microtask chain (the handler does an async
    // read-modify-write), so assertions must let the chain drain first.
    const drain = () => new Promise((r) => setTimeout(r, 0));

    it('routes inbound operations to the operation handler', async () => {
        const onOp = vi.fn();
        ctx.ws.on('operation', onOp);
        sock.emit({ type: 'operations', userId: 'u2', ops: [{ id: 'o1', clientId: 'other', entityType: 'feature' }] });
        await drain();
        expect(onOp).toHaveBeenCalledWith(expect.objectContaining({ id: 'o1' }));
    });

    it('skips this client\'s own echoed operations', async () => {
        const onOp = vi.fn();
        ctx.ws.on('operation', onOp);
        sock.emit({ type: 'operations', ops: [
            { id: 'mine', clientId: 'me' },
            { id: 'theirs', clientId: 'other' },
        ] });
        await drain();
        expect(onOp).toHaveBeenCalledTimes(1);
        expect(onOp).toHaveBeenCalledWith(expect.objectContaining({ id: 'theirs' }));
    });

    // Regression: a batch of inbound ops must apply ONE AT A TIME in arrival order. The
    // handler does an async read-modify-write of the map's store entry; applying a batch
    // concurrently raced and clobbered all but the last (real cross-client data loss —
    // only 1 of 18 features survived in the collab harness until this was serialized).
    it('serializes inbound op application (no concurrent async applies, order preserved)', async () => {
        const order = [];
        let active = 0;
        let maxActive = 0;
        const onOp = vi.fn(async (op) => {
            active += 1; maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 5));
            order.push(op.id);
            active -= 1;
        });
        ctx.ws.on('operation', onOp);
        sock.emit({ type: 'operations', ops: [
            { id: 'a', clientId: 'other' },
            { id: 'b', clientId: 'other' },
            { id: 'c', clientId: 'other' },
        ] });
        await new Promise((r) => setTimeout(r, 60));
        expect(order).toEqual(['a', 'b', 'c']);
        expect(maxActive).toBe(1);
    });

    it('fires ack for ack and ack_batch frames', () => {
        const onAck = vi.fn();
        ctx.ws.on('ack', onAck);
        sock.emit({ type: 'ack', opId: 'o1', serverVersion: 5, result: { ok: true } });
        sock.emit({ type: 'ack_batch', opIds: ['o2', 'o3'], serverVersion: 7, results: [] });
        expect(onAck).toHaveBeenNthCalledWith(1, expect.objectContaining({ opIds: ['o1'], serverVersion: 5 }));
        expect(onAck).toHaveBeenNthCalledWith(2, expect.objectContaining({ opIds: ['o2', 'o3'], serverVersion: 7 }));
    });

    it('tracks last version from sync_response', () => {
        const onSync = vi.fn();
        ctx.ws.on('syncResponse', onSync);
        sock.emit({ type: 'sync_response', isSnapshot: false, ops: [], currentVersion: 42 });
        expect(onSync).toHaveBeenCalledWith(expect.objectContaining({ currentVersion: 42 }));
        expect(ctx.ws._lastVersion).toBe(42);
    });
});

describe('WsClient — outbound', () => {
    it('sends operations only when open; returns false otherwise', async () => {
        const { ws } = setup();
        expect(ws.sendOperation({ id: 'x' })).toBe(false); // not connected yet

        const p = ws.connect('atlas-1');
        const sock = FakeSocket.instances[0];
        sock.emit({ type: 'connected', permission: 'owner' });
        await p;

        expect(ws.sendOperation({ id: 'op-1' })).toBe(true);
        expect(sock.last).toEqual({ type: 'operation', op: { id: 'op-1' } });
    });
});

describe('WsClient — presence/awareness outbound (cases C/E/F/D)', () => {
    /** @type {ReturnType<typeof setup>['ws']} */
    let ws;
    /** @type {FakeSocket} */
    let sock;
    beforeEach(async () => {
        ({ ws } = setup());
        const p = ws.connect('atlas-1');
        sock = FakeSocket.instances[0];
        sock.emit({ type: 'connected', permission: 'owner' });
        await p;
    });

    it('sendCursor frames carry position + mapId (currentMap piggyback, case C/cursor)', () => {
        expect(ws.sendCursor({ position: { lng: 1, lat: 2 }, mapId: 'm1' })).toBe(true);
        expect(sock.last).toEqual({ type: 'cursor', position: { lng: 1, lat: 2 }, mapId: 'm1' });
        // Positionless map-switch frame still carries the mapId.
        ws.sendCursor({ position: null, mapId: 'm2' });
        expect(sock.last).toEqual({ type: 'cursor', position: null, mapId: 'm2' });
    });

    it('sendSelection frames carry featureIds + mapId (case F)', () => {
        expect(ws.sendSelection({ featureIds: ['f1', 'f2'], mapId: 'm1' })).toBe(true);
        expect(sock.last).toEqual({ type: 'selection', featureIds: ['f1', 'f2'], mapId: 'm1' });
    });

    it('sendTemporal emits a temporal frame with state + mapId (case E)', () => {
        const stateBlob = { cursor: 3, label: 'D+3', playing: true };
        expect(ws.sendTemporal(stateBlob, 'm1')).toBe(true);
        expect(sock.last).toEqual({ type: 'temporal', state: stateBlob, mapId: 'm1' });
    });

    it('sendBriefingEditStart/End emit briefing_edit_start/end frames (case D)', () => {
        expect(ws.sendBriefingEditStart('b1')).toBe(true);
        expect(sock.last).toEqual({ type: 'briefing_edit_start', briefingId: 'b1' });
        expect(ws.sendBriefingEditEnd('b1')).toBe(true);
        expect(sock.last).toEqual({ type: 'briefing_edit_end', briefingId: 'b1' });
    });

    it('returns false for awareness sends when not connected', () => {
        const { ws: ws2 } = setup();
        expect(ws2.sendTemporal({ cursor: 1 }, 'm1')).toBe(false);
        expect(ws2.sendBriefingEditStart('b1')).toBe(false);
        expect(ws2.sendBriefingEditEnd('b1')).toBe(false);
    });
});

describe('WsClient — presence/awareness inbound routing (cases E/D)', () => {
    let ctx, sock;
    beforeEach(async () => {
        ctx = setup();
        const p = ctx.ws.connect('atlas-1');
        sock = FakeSocket.instances[0];
        sock.emit({ type: 'connected', permission: 'owner' });
        await p;
    });

    it("routes inbound 'temporal' frames to the temporal handler (case E)", () => {
        const onTemporal = vi.fn();
        ctx.ws.on('temporal', onTemporal);
        const msg = { type: 'temporal', userId: 'u2', state: { cursor: 7, label: 'D+7' }, mapId: 'm1' };
        sock.emit(msg);
        expect(onTemporal).toHaveBeenCalledWith(expect.objectContaining(msg));
    });

    it("routes briefing_edit_started/ended to the briefingEdit handler (case D)", () => {
        const onBriefing = vi.fn();
        ctx.ws.on('briefingEdit', onBriefing);
        sock.emit({ type: 'briefing_edit_started', userId: 'u2', userName: 'Alice', briefingId: 'b1' });
        sock.emit({ type: 'briefing_edit_ended', userId: 'u2', userName: 'Alice', briefingId: 'b1' });
        expect(onBriefing).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'briefing_edit_started', briefingId: 'b1' }));
        expect(onBriefing).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'briefing_edit_ended', briefingId: 'b1' }));
    });
});

describe('WsClient — reconnect with replay', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reconnects after an unexpected close and requests a replay since lastVersion', async () => {
        const { ws, conn } = setup({ reconnectBaseMs: 50 });
        const p = ws.connect('atlas-1');
        const sock1 = FakeSocket.instances[0];
        sock1.emit({ type: 'connected', permission: 'owner' });
        await p;
        // Apply some ops so we have a version to replay from.
        sock1.emit({ type: 'sync_response', ops: [], currentVersion: 10 });
        expect(ws._lastVersion).toBe(10);

        // Unexpected network drop (not intentional) → RECONNECTING + scheduled reconnect.
        sock1.close(1006, 'drop');
        expect(conn.getState()).toBe(ConnectionStates.RECONNECTING);

        await vi.advanceTimersByTimeAsync(60);
        const sock2 = FakeSocket.instances[1];
        expect(sock2).toBeTruthy();

        // New socket handshakes → ONLINE again and replays since version 10.
        sock2.emit({ type: 'connected', permission: 'owner' });
        expect(conn.getState()).toBe(ConnectionStates.ONLINE);
        expect(sock2.sent).toContainEqual({ type: 'sync_request', lastVersion: 10 });
    });

    it('disconnect() is intentional: goes OFFLINE, sends leave, no reconnect', async () => {
        const { ws, conn } = setup();
        const p = ws.connect('atlas-1');
        const sock = FakeSocket.instances[0];
        sock.emit({ type: 'connected', permission: 'owner' });
        await p;

        ws.disconnect();
        expect(sock.sent).toContainEqual({ type: 'leave' });
        expect(conn.getState()).toBe(ConnectionStates.OFFLINE);

        await vi.advanceTimersByTimeAsync(1000);
        expect(FakeSocket.instances).toHaveLength(1); // no reconnect attempt
    });
});

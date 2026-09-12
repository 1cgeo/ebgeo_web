// Path: tests/integration/recovery-ws-client.test.js
import { describe, it, expect, vi } from 'vitest';
import { WsClient } from '../../src/js/store/sync/ws-client.js';
import { ConnectionState } from '../../src/js/store/sync/connection-state.js';
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


describe('AUDIT durable receive cursor', () => {
 it('does not skip earlier commits when live broadcasts arrive out of order', async () => {
  const { ws } = setup();
  const connecting = ws.connect('atlas-1', { lastVersion: 10 });
  const socket = FakeSocket.instances[0];
  socket.emit({ type: 'connected' });
  await connecting;
  const applied = [];
  ws.on('operation', async op => { applied.push(op.id); return true; });
  socket.emit({ type: 'operation', op: { id: 'commit-12', clientId: 'peer', serverVersion: 12 } });
  await ws._applyChain;
  expect(applied).toEqual(['commit-12']);
  // Commit 11 may exist even though its controller has not broadcast it yet.
  // A reconnect must still request the complete tail after the last replay boundary.
  expect(ws._lastVersion).toBe(10);
  ws.on('syncResponse', async msg => {
   for (const op of msg.ops) applied.push(op.id);
   return true;
  });
  socket.emit({ type: 'sync_response', currentVersion: 12, ops: [{ id: 'commit-11' }, { id: 'commit-12' }] });
  await ws._applyChain;
  expect(applied).toContain('commit-11');
  expect(ws._lastVersion).toBe(12);
  ws.disconnect();
 });
 it('AUDIT failed local apply must remain eligible for replay', async () => {
  const {ws}=setup(); const p=ws.connect('atlas-1',{lastVersion:10});
  const sock=FakeSocket.instances[0]; sock.emit({type:'connected'}); await p;
  ws.on('operation',async()=>{throw new Error('injected IndexedDB write failure');});
  sock.emit({type:'operation',op:{id:'audit-op',clientId:'other',serverVersion:11}});
  await ws._applyChain;
  expect(ws._lastVersion).toBe(10);
  expect(sock.readyState).toBe(3);
  sock.emit({type:'operation',op:{id:'later-op',clientId:'other',serverVersion:12}});
  await ws._applyChain;
  expect(ws._lastVersion).toBe(10);
  ws.disconnect();
 });
 it('AUDIT delayed close of previous socket must not clear new socket', async () => {
  const {ws}=setup(); const p=ws.connect('atlas-1'); const old=FakeSocket.instances[0]; old.emit({type:'connected'}); await p;
  old.close=()=>{old.readyState=3;};
  ws.disconnect(); const p2=ws.connect('atlas-2'); const current=FakeSocket.instances[1]; current.emit({type:'connected'}); await p2;
  old.onclose({code:1000,reason:'leave'});
  const retained=ws._socket===current; ws.disconnect(); expect(retained).toBe(true);
 });
});

it('AUDIT initial handshake must replay changes after the HTTP snapshot',async()=>{
 const {ws}=setup(); const p=ws.connect('atlas-1',{lastVersion:10});
 const sock=FakeSocket.instances[0]; sock.emit({type:'connected'}); await p;
 ws.disconnect();
 expect(sock.sent.some(x=>x.type==='sync_request'&&x.lastVersion===10)).toBe(true);
});

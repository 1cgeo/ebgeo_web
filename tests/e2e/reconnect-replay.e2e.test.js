// Path: tests/e2e/reconnect-replay.e2e.test.js

/**
 * @fileoverview E2E: reconnect replay. Client B opens a WS to the live collab
 * gateway and records the connect version. The underlying socket is then force-
 * closed with a non-clean code (1006-style abnormal drop) WHILE client A pushes a
 * feature op over HTTP that B never saw on the wire. The WsClient auto-reconnects
 * (small reconnectBaseMs), and because it re-enters from the RECONNECTING state it
 * fires a `sync_request` with B's last applied version; the server replays the
 * missed op in a `sync_response`. We assert B observes that exact op via its
 * 'syncResponse' handler — proving missed work is recovered on reconnect.
 *
 * Negative/edge assertions:
 *  - the missed op is NOT delivered while B's socket is down;
 *  - the replayed sync_response is INCREMENTAL (isSnapshot === false), and the
 *    replayed op carries the exact entityId/lamportTimestamp client A pushed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    makeWs,
    newClientId,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

describe.skipIf(E2E_SKIP)('e2e: reconnect-replay', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let apiA;
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let apiB;
    let atlasId;
    let mapId;
    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient} */
    let wsB;

    beforeAll(async () => {
        // Owner (A) creates the atlas + map and is the HTTP pusher.
        apiA = makeApi();
        await registerAndLogin(apiA, { nome: 'Reconnect A' });
        const atlas = await createAtlas(apiA, { name: 'Reconnect Replay Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(apiA, atlasId, { name: 'Mapa Reconnect' });

        // Client B is the SAME identity (owner token) so it is allowed into the room.
        // It reuses A's tokens by sharing the access token via its own ApiClient.
        apiB = makeApi();
        apiB.setTokens({
            accessToken: apiA.getAccessToken(),
        });
    });

    afterAll(() => {
        if (wsB) wsB.disconnect();
    });

    it('replays the op B missed while its socket was down', async () => {
        const clientIdB = newClientId();
        wsB = makeWs(apiB, { clientId: clientIdB });
        // Fast reconnect so the test stays well under the WS waitFor budget.
        wsB._reconnectBaseMs = 60;

        /** @type {Object[]} */
        const inboundOps = [];
        /** @type {Object[]} */
        const syncResponses = [];
        wsB.on('operation', (op) => inboundOps.push(op));
        wsB.on('syncResponse', (msg) => syncResponses.push(msg));

        // Initial handshake. The `connected` frame resolves connect().
        const connected = await wsB.connect(atlasId, { lastVersion: 0 });
        expect(connected.type).toBe('connected');
        expect(wsB.isConnected()).toBe(true);

        // Establish B's baseline version from an HTTP pull (the version it "has").
        const baseline = await apiA.pullSync(atlasId, 0);
        const baseVersion = baseline.currentVersion;
        expect(baseVersion).toBeGreaterThanOrEqual(1); // at least the map create
        wsB.setLastVersion(baseVersion);

        // ---- B drops abnormally (simulated 1006). We DO NOT call disconnect()
        // (that would be intentional and disable reconnect); instead we close the
        // raw socket with a non-clean code so _wantConnected stays true.
        expect(wsB._socket).toBeTruthy();
        wsB._socket.close(4001, 'simulated abnormal drop');

        // The socket is now closing/closed: B must NOT be online.
        await waitFor(() => !wsB.isConnected(), { timeout: 2000 });
        expect(wsB.isConnected()).toBe(false);

        const opsBeforeMiss = inboundOps.length;

        // ---- While B is down, A pushes a feature op B will miss on the wire.
        const missedEntityId = crypto.randomUUID();
        const missedOp = createOperation('feature', 'create', missedEntityId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [12, 34] },
            properties: { source: 'point', name: 'Missed' },
        });
        missedOp.lamportTimestamp = 4242;

        const pushed = await apiA.pushOperations(atlasId, [missedOp]);
        expect(pushed.acks).toHaveLength(1);
        expect(pushed.acks[0].idempotent).toBe(false);
        const missedVersion = pushed.serverVersion;
        expect(missedVersion).toBeGreaterThan(baseVersion);

        // Edge: while the socket is down, the op was NOT delivered live to B.
        expect(inboundOps.length).toBe(opsBeforeMiss);

        // ---- B auto-reconnects; on the `connected`-from-RECONNECTING path it fires
        // sync_request(lastVersion=baseVersion) and the server replays the missed op.
        await waitFor(() => wsB.isConnected(), { timeout: 6000 });
        expect(wsB.isConnected()).toBe(true);

        const replay = await waitFor(
            () => syncResponses.find((m) => Array.isArray(m.ops) && m.ops.length > 0),
            { timeout: 6000 }
        );

        // Incremental replay (not a full snapshot) covering exactly the missed op.
        expect(replay.isSnapshot).toBe(false);
        expect(replay.currentVersion).toBe(missedVersion);
        expect(Array.isArray(replay.ops)).toBe(true);

        const replayed = replay.ops.find((o) => o.entityId === missedEntityId);
        expect(replayed).toBeTruthy();
        expect(replayed.entityType).toBe('feature');
        expect(replayed.operationType).toBe('create');
        // The logical clock and identity survived the drop + replay verbatim.
        expect(replayed.lamportTimestamp).toBe(4242);
        expect(replayed.serverVersion).toBe(missedVersion);

        // The WsClient tracked the replayed tip as its new last version.
        expect(wsB._lastVersion).toBe(missedVersion);
    });
});

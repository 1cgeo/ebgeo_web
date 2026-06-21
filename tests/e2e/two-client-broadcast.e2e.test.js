// Path: tests/e2e/two-client-broadcast.e2e.test.js

/**
 * @fileoverview E2E "two-client-broadcast": a real HTTP+WS round-trip against the
 * live backend. Client A pushes a CRDT operation over HTTP (POST /atlas/:id/sync);
 * the backend broadcasts a `{type:'operations'}` frame to WS peers; client B — a
 * WsClient connected to the same atlas — observes it via its `on('operation')`
 * handler. Asserts the op crosses the wire intact and that B's own echoes are
 * filtered out (the negative assertion).
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
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: two-client-broadcast', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    /** @type {Object} */
    let atlas;
    /** @type {Object} The authenticated owner user. */
    let user;
    /** @type {string} */
    let mapId;
    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient} */
    let wsB;
    /** Stable client id for the WS peer (client B). */
    const clientIdB = newClientId();
    /** Inbound ops captured by client B's on('operation') handler. */
    const received = [];

    beforeAll(async () => {
        // Isolation: this suite owns its api/user/atlas/map — nothing shared.
        api = makeApi();
        ({ user } = await registerAndLogin(api, { nome: 'Broadcast Owner' }));
        atlas = await createAtlas(api, { name: 'Broadcast Atlas' });
        mapId = await createMap(api, atlas.id, { name: 'Mapa Broadcast' });

        // Client B connects over WebSocket with its own clientId.
        wsB = makeWs(api, { clientId: clientIdB });
        wsB.on('operation', (op) => received.push(op));
        const connected = await wsB.connect(atlas.id, { lastVersion: 0 });

        // Sanity: the handshake frame carries the documented fields.
        expect(connected.type).toBe('connected');
        expect(connected.userId).toBe(user.id);
        expect(connected.sessionId).toBe(clientIdB);
    }, 20000);

    afterAll(async () => {
        if (wsB) wsB.disconnect();
        try {
            await api?.logout();
        } catch {
            /* best-effort cleanup */
        }
    });

    it('broadcasts an HTTP-pushed op to a WS peer', async () => {
        const featureId = generateUUID();
        const layerId = generateUUID();
        // Raw-GeoJSON feature create. `createOperation` stamps op.clientId from the
        // shared session client id, which differs from client B's WS clientId, so B
        // will NOT filter it as its own echo.
        const op = createOperation('feature', 'create', featureId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
            properties: { source: 'military_symbol', layerId, name: 'PC Comando' },
        });
        expect(op.clientId).not.toBe(clientIdB);

        const res = await api.pushOperations(atlas.id, [op]);
        // Negative/edge: the HTTP push really persisted (server advanced its version).
        expect(res.serverVersion).toBeGreaterThan(0);

        // Client B should receive the broadcast and surface the exact op.
        await waitFor(() => received.some((r) => r.entityId === featureId), { timeout: 6000 });

        const got = received.find((r) => r.entityId === featureId);
        expect(got).toBeTruthy();
        expect(got.entityType).toBe('feature');
        expect(got.operationType).toBe('create');
        expect(got.mapId).toBe(mapId);
        expect(got.data.geometry).toEqual({ type: 'Point', coordinates: [-43.18, -22.91] });
        expect(got.data.properties.source).toBe('military_symbol');
        expect(got.data.properties.layerId).toBe(layerId);
        // The op id survives the round-trip (idempotency key).
        expect(got.id).toBe(op.id);
    });

    it('does not deliver a WS peer its own echoed op', async () => {
        // Client B authors an op (clientId === clientIdB) and pushes it over HTTP.
        // The broadcast reaches B's own socket, but WsClient filters self-echoes,
        // so it must never reach the on('operation') handler.
        const selfFeatureId = generateUUID();
        const selfOp = {
            ...createOperation('feature', 'create', selfFeatureId, mapId, {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { source: 'military_symbol', layerId: generateUUID() },
            }),
            clientId: clientIdB,
        };

        const beforeCount = received.length;
        const res = await api.pushOperations(atlas.id, [selfOp]);
        expect(res.serverVersion).toBeGreaterThan(0);

        // Push a follow-up foreign op as a barrier: once it arrives we know the
        // self-echo had its chance to (wrongly) land and did not.
        const barrierId = generateUUID();
        const barrierOp = createOperation('feature', 'create', barrierId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.3, -22.8] },
            properties: { source: 'military_symbol', layerId: generateUUID() },
        });
        expect(barrierOp.clientId).not.toBe(clientIdB);
        await api.pushOperations(atlas.id, [barrierOp]);

        await waitFor(() => received.some((r) => r.entityId === barrierId), { timeout: 6000 });

        // The self-authored op was filtered; only foreign ops (incl. the barrier) landed.
        expect(received.some((r) => r.entityId === selfFeatureId)).toBe(false);
        expect(received.length).toBeGreaterThan(beforeCount);
    });
});

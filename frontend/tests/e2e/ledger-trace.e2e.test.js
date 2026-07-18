// Path: tests/e2e/ledger-trace.e2e.test.js

/**
 * @fileoverview E2E "SyncLedger trace" — a transport-level round-trip that asserts the
 * OBSERVABILITY layer, not just the data: client A pushes a feature over HTTP; the
 * server records server.inserted / server.applied / server.broadcast (read back via the
 * env-gated GET /api/v1/debug/trace), and client B's WsClient records ws.inbound. This
 * makes "the op crossed the wire AND the server actually wrote a row AND the peer
 * received it" a single, structured assertion — the core SyncLedger contract.
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
    enableClientTrace,
    getClientTrace,
    getServerTrace,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: SyncLedger trace (transport-level)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    /** @type {Object} */
    let atlas;
    /** @type {string} */
    let mapId;
    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient} */
    let wsB;
    const clientIdB = newClientId();
    const received = [];

    beforeAll(async () => {
        enableClientTrace();
        api = makeApi();
        await registerAndLogin(api, { nome: 'Ledger Owner' });
        atlas = await createAtlas(api, { name: 'Ledger Atlas' });
        mapId = await createMap(api, atlas.id, { name: 'Mapa Ledger' });

        wsB = makeWs(api, { clientId: clientIdB });
        wsB.on('operation', (op) => received.push(op));
        await wsB.connect(atlas.id, { lastVersion: 0 });
    }, 20000);

    afterAll(async () => {
        if (wsB) wsB.disconnect();
        try {
            await api?.logout();
        } catch {
            /* best-effort cleanup */
        }
    });

    it('records the server insert/apply/broadcast spans and the peer ws.inbound span', async () => {
        const featureId = generateUUID();
        const op = createOperation('feature', 'create', featureId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
            properties: { source: 'point', layerId: generateUUID(), name: 'Trace PC' },
        });
        expect(op.clientId).not.toBe(clientIdB);

        await api.pushOperations(atlas.id, [op]);
        await waitFor(() => received.some((r) => r.entityId === featureId), { timeout: 6000 });

        // CLIENT (peer B) ring: the inbound op was traced with the SAME op.id.
        const inbound = getClientTrace((s) => s.stage === 'ws.inbound' && s.opId === op.id);
        expect(inbound.length).toBeGreaterThan(0);
        expect(inbound[0].clientId).toBe(op.clientId);

        // SERVER ring (env-gated debug endpoint): inserted (op.id ↔ serverVersion),
        // applied (rows>0 — NOT no-effect), and broadcast (fan-out is now observable).
        const server = await getServerTrace(api, atlas.id, { opId: op.id });
        const stages = server.map((s) => s.stage);
        expect(stages).toContain('server.inserted');
        expect(stages).toContain('server.applied');
        expect(stages).toContain('server.broadcast');

        const inserted = server.find((s) => s.stage === 'server.inserted');
        expect(inserted.serverVersion).toBeGreaterThan(0);
        expect(inserted.idempotent).toBe(false);

        const applied = server.find((s) => s.stage === 'server.applied');
        expect(applied.outcome).not.toBe('no-effect');
        expect(applied.rowsAffected).toBe(1);
    });
});

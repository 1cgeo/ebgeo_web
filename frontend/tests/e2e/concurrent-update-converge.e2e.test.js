// Path: tests/e2e/concurrent-update-converge.e2e.test.js

/**
 * @fileoverview E2E repro + regression for the concurrent-edit DIVERGENCE bug the SyncLedger
 * surfaced. Two clients edit the SAME feature "at once"; the documented model is LWW by server
 * ARRIVAL ORDER (serverVersion). The root cause was that the WS broadcast op carried NO
 * serverVersion, so a peer could not order concurrent edits and the clients diverged.
 *
 * The decisive wire-contract assertion (fails before the fix, passes after): each broadcast
 * feature-update op carries a serverVersion, and the LATER-arriving op carries the LARGER one —
 * the ordering a peer's LWW guard needs to converge.
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
    getServerTrace,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: concurrent-update convergence (serverVersion on the broadcast)', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlas;
    let mapId;
    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient} An observer peer. */
    let wsC;
    const clientIdA = newClientId();
    const clientIdB = newClientId();
    const clientIdC = newClientId();
    const received = [];

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Converge Owner' });
        atlas = await createAtlas(api, { name: 'Converge Atlas' });
        mapId = await createMap(api, atlas.id, { name: 'Mapa Converge' });

        wsC = makeWs(api, { clientId: clientIdC });
        wsC.on('operation', (op) => received.push(op));
        await wsC.connect(atlas.id, { lastVersion: 0 });
    }, 20000);

    afterAll(async () => {
        if (wsC) wsC.disconnect();
        try {
            await api.logout();
        } catch {
            /* best-effort cleanup */
        }
    });

    it('stamps a monotonic serverVersion on each broadcast op (the LWW ordering peers need)', async () => {
        const fId = generateUUID();
        const layerId = generateUUID();
        const point = (color) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
            properties: { id: fId, source: 'point', layerId, color },
        });
        const updateOp = (color, clientId) => ({
            ...createOperation('feature', 'update', fId, mapId, point(color)),
            clientId,
        });

        // Seed the feature.
        await api.pushOperations(atlas.id, [{
            ...createOperation('feature', 'create', fId, mapId, point('#000000')),
            clientId: clientIdA,
        }]);

        // Two concurrent updates, pushed in a deterministic order (A then B → B wins by arrival).
        const opA = updateOp('#ff0000', clientIdA);
        const opB = updateOp('#0000ff', clientIdB);
        await api.pushOperations(atlas.id, [opA]);
        await api.pushOperations(atlas.id, [opB]);

        // Observer C receives both broadcasts.
        await waitFor(() => received.some((r) => r.id === opB.id), { timeout: 6000 });
        const gotA = received.find((r) => r.id === opA.id);
        const gotB = received.find((r) => r.id === opB.id);
        expect(gotA, 'A update broadcast reached the peer').toBeTruthy();
        expect(gotB, 'B update broadcast reached the peer').toBeTruthy();

        // THE WIRE CONTRACT (the fix): each broadcast op carries its server arrival order, and
        // the later-arriving op carries the larger serverVersion. Before the fix: undefined.
        expect(gotA.serverVersion).toBeGreaterThan(0);
        expect(gotB.serverVersion).toBeGreaterThan(gotA.serverVersion);

        // Cross-check against the server ring: arrival order matches (opB inserted after opA).
        const svA = (await getServerTrace(api, atlas.id, { opId: opA.id })).find((s) => s.stage === 'server.inserted');
        const svB = (await getServerTrace(api, atlas.id, { opId: opB.id })).find((s) => s.stage === 'server.inserted');
        expect(svA?.serverVersion).toBeGreaterThan(0);
        expect(svB.serverVersion).toBeGreaterThan(svA.serverVersion);
    });
});

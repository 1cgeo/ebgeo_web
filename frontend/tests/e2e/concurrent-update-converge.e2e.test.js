// Path: tests/e2e/concurrent-update-converge.e2e.test.js
import {
    confirmedFeature,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    confirmedDefaultLayerId,
    makeWs,
    newClientId,
    waitFor,
    getServerTrace,
    E2E_SKIP,
} from './helpers/harness.js';

/**
 * Concurrent edits of the same field conflict. A deliberate reapplication uses
 * a fresh operation id and the latest confirmed base. Only accepted edits are
 * broadcast, with increasing serverVersion for ordered client projection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

    it('refuses the stale same-field edit and broadcasts the explicit reapplication in order', async () => {
        const fId = generateUUID();
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const point = (color) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
            properties: { id: fId, source: 'point', layerId, color },
        });
        const updateOp = (color, clientId, previous) => ({
            ...createOperation('feature', 'update', fId, mapId, point(color), previous),
            clientId,
        });

        // Seed the feature.
        await api.pushOperations(atlas.id, [{
            ...createOperation('feature', 'create', fId, mapId, point('#000000')),
            clientId: clientIdA,
        }]);

        const base = await confirmedFeature(api, atlas.id, mapId, fId);
        const opA = updateOp('#ff0000', clientIdA, base);
        const staleB = updateOp('#0000ff', clientIdB, base);
        const accepted = await api.pushOperations(atlas.id, [opA]);
        expect(accepted.results[0].success).toBe(true);
        const refused = await api.pushOperations(atlas.id, [staleB]);
        expect(refused.results[0].success).toBe(false);
        expect(refused.results[0].conflict.fields).toContainEqual(['properties', 'color']);
        expect((await confirmedFeature(api, atlas.id, mapId, fId)).properties.color).toBe('#ff0000');
        // Deliberate re-application is a new intention against the current confirmed base.
        const opB = updateOp('#0000ff', clientIdB, await confirmedFeature(api, atlas.id, mapId, fId));
        expect(opB.id).not.toBe(staleB.id);
        const reapplied = await api.pushOperations(atlas.id, [opB]);
        expect(reapplied.results[0].success).toBe(true);

        // Observer C receives both broadcasts.
        await waitFor(() => received.some((r) => r.id === opB.id), { timeout: 6000 });
        expect(received.some(r => r.id === staleB.id)).toBe(false);
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

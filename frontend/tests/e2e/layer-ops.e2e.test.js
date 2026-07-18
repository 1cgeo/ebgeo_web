// Path: tests/e2e/layer-ops.e2e.test.js

/**
 * @fileoverview Real end-to-end coverage for layer CRDT operations against the
 * live backend. Drives create / update (name, visible, locked, opacity) /
 * reorder (order -> sort_order) / delete through createOperation + ApiClient,
 * and verifies each mutation via the pullSync snapshot's `map.layers`.
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

/**
 * Pulls a fresh snapshot and returns the single layer matching `layerId` from
 * the given map, or undefined when it is absent (e.g. soft-deleted).
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @param {string} layerId
 * @returns {Promise<Object|undefined>}
 */
async function fetchLayer(api, atlasId, mapId, layerId) {
    const result = await api.pullSync(atlasId, 0);
    const snapshot = result.snapshot;
    const map = (snapshot.maps || []).find((m) => m.id === mapId);
    return (map?.layers || []).find((l) => l.id === layerId);
}

describe.skipIf(E2E_SKIP)('e2e: layer operations', () => {
    let api;
    let atlasId;
    let mapId;
    let ws;
    const clientId = newClientId();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Layer E2E' });
        const atlas = await createAtlas(api, { name: 'Layer Ops Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Camadas' });

        ws = makeWs(api, { clientId });
        await ws.connect(atlasId, { lastVersion: 0 });
    }, 20000);

    afterAll(() => {
        ws?.disconnect();
    });

    it('creates a layer and reflects it in the snapshot', async () => {
        const layerId = generateUUID();
        const op = createOperation('layer', 'create', layerId, mapId, {
            name: 'Camada A',
            visible: true,
            locked: false,
            opacity: 1,
            order: 0,
        });
        const res = await api.pushOperations(atlasId, [op]);
        expect(res.serverVersion).toBeGreaterThan(0);

        const layer = await fetchLayer(api, atlasId, mapId, layerId);
        expect(layer).toBeDefined();
        expect(layer.name).toBe('Camada A');
        expect(layer.visible).toBe(true);
        expect(layer.locked).toBe(false);
        expect(layer.opacity).toBe(1);
        // The snapshot exposes sort_order mapped to `order`.
        expect(layer.order).toBe(0);
    });

    it('updates name, visible, locked and opacity', async () => {
        const layerId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('layer', 'create', layerId, mapId, {
                name: 'Original',
                visible: true,
                locked: false,
                opacity: 1,
                order: 1,
            }),
        ]);

        await api.pushOperations(atlasId, [
            createOperation('layer', 'update', layerId, mapId, {
                name: 'Renomeada',
                visible: false,
                locked: true,
                opacity: 0.4,
            }),
        ]);

        const layer = await fetchLayer(api, atlasId, mapId, layerId);
        expect(layer).toBeDefined();
        expect(layer.name).toBe('Renomeada');
        expect(layer.visible).toBe(false);
        expect(layer.locked).toBe(true);
        expect(layer.opacity).toBeCloseTo(0.4, 5);
        // Untouched field must survive a partial update.
        expect(layer.order).toBe(1);
    });

    it('reorders a layer via the order field (mapped to sort_order)', async () => {
        const layerId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('layer', 'create', layerId, mapId, {
                name: 'Movel',
                visible: true,
                locked: false,
                opacity: 1,
                order: 2,
            }),
        ]);

        await api.pushOperations(atlasId, [
            createOperation('layer', 'update', layerId, mapId, { order: 7 }),
        ]);

        const layer = await fetchLayer(api, atlasId, mapId, layerId);
        expect(layer).toBeDefined();
        expect(layer.order).toBe(7);
        // Reorder must not clobber unrelated fields.
        expect(layer.name).toBe('Movel');
    });

    it('soft-deletes a layer (absent from the snapshot afterwards)', async () => {
        const layerId = generateUUID();
        await api.pushOperations(atlasId, [
            createOperation('layer', 'create', layerId, mapId, {
                name: 'Descartavel',
                visible: true,
                locked: false,
                opacity: 1,
                order: 3,
            }),
        ]);

        // Present before delete.
        expect(await fetchLayer(api, atlasId, mapId, layerId)).toBeDefined();

        await api.pushOperations(atlasId, [
            createOperation('layer', 'delete', layerId, mapId, null),
        ]);

        // Soft-deleted layers are filtered out of the snapshot.
        expect(await fetchLayer(api, atlasId, mapId, layerId)).toBeUndefined();
    });

    it('broadcasts a layer create over WS to a peer client', async () => {
        // A second WS on the SAME owner api observes the broadcast; a distinct
        // clientId is required because inbound ops with our own clientId are skipped.
        const peerClientId = newClientId();
        const peerWs = makeWs(api, { clientId: peerClientId });
        await peerWs.connect(atlasId, { lastVersion: 0 });

        const received = [];
        peerWs.on('operation', (incoming) => received.push(incoming));

        const layerId = generateUUID();
        const op = createOperation('layer', 'create', layerId, mapId, {
            name: 'Broadcast',
            visible: true,
            locked: false,
            opacity: 1,
            order: 4,
        });
        // Push from the first client; the peer (different clientId) should see it.
        await api.pushOperations(atlasId, [op]);

        await waitFor(
            () => received.some((o) => o.entityId === layerId),
            { timeout: 5000 },
        );
        const broadcast = received.find((o) => o.entityId === layerId);
        expect(broadcast.entityType).toBe('layer');
        expect(broadcast.operationType).toBe('create');

        peerWs.disconnect();
    }, 15000);
});

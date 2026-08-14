// Path: tests/e2e/streetview360-annot.e2e.test.js

/**
 * @fileoverview E2E: flat Street View 360 annotation ops (orientation360 /
 * marker360) travel through the real backend sync pipeline and surface in the
 * pullSync snapshot under `map.streetview360`, with `photoName` preserved as the
 * orientation key and on each marker. Also asserts the cross-client WS broadcast
 * delivers the 360 payload intact.
 *
 * NOT covered here: the WsClient self-echo filter (a peer dropping an op it
 * authored itself). This suite used to claim it in a test title while asserting
 * `received.some(o => o.clientId === peerClientId) === false` over a stream where
 * NO op had ever been published with the peer's clientId — true with the filter
 * on or off. The filter is entity-agnostic (`ws-client.js` compares clientIds
 * before routing, regardless of entityType), and it is proved with a barrier op
 * in `two-client-broadcast.e2e.test.js`; a second copy here would pin nothing new.
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

describe.skipIf(E2E_SKIP)('e2e streetview360-annot', () => {
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'SV360 Annot User' });
        const atlas = await createAtlas(api, { name: 'SV360 Annot Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa SV360' });
    });

    afterAll(() => {
        // no shared external resources to tear down beyond the backend itself
    });

    it('persists a flat orientation360 op keyed by photoName in the snapshot', async () => {
        const photoName = `pano_${newClientId().slice(0, 8)}.webp`;
        const id = newClientId();
        const op = createOperation('orientation360', 'create', id, mapId, {
            id,
            photoName,
            lon: -43.123456,
            lat: -22.987654,
            fov: 75,
        });

        const res = await api.pushOperations(atlasId, [op]);
        expect(res.serverVersion).toBeGreaterThan(0);

        const pulled = await api.pullSync(atlasId, 0);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        expect(map).toBeTruthy();

        const sv = map.streetview360;
        expect(sv).toBeTruthy();
        expect(sv.orientations).toBeTruthy();

        const orientation = sv.orientations[photoName];
        expect(orientation, `orientation keyed by ${photoName}`).toBeTruthy();
        expect(orientation.id).toBe(id);
        expect(orientation.photoName).toBe(photoName);
        expect(orientation.lon).toBeCloseTo(-43.123456, 6);
        expect(orientation.lat).toBeCloseTo(-22.987654, 6);
        expect(orientation.fov).toBe(75);
        // Negative assertion: photoName is the key only — no bogus key materializes.
        expect(sv.orientations['does-not-exist.webp']).toBeUndefined();
    });

    it('persists a flat marker360 op with photoName and nested fields preserved', async () => {
        const photoName = `pano_${newClientId().slice(0, 8)}.webp`;
        const id = newClientId();
        const position = { x: 0.25, y: -0.5, z: 0.8 };
        const properties = { label: 'Ponto de referência', color: '#ff0000' };
        const op = createOperation('marker360', 'create', id, mapId, {
            id,
            photoName,
            position,
            properties,
        });

        await api.pushOperations(atlasId, [op]);

        const pulled = await api.pullSync(atlasId, 0);
        const map = pulled.snapshot.maps.find((m) => m.id === mapId);
        const sv = map.streetview360;
        expect(Array.isArray(sv.markers)).toBe(true);

        const marker = sv.markers.find((m) => m.id === id);
        expect(marker, 'marker present in snapshot').toBeTruthy();
        expect(marker.photoName).toBe(photoName);
        expect(marker.position).toEqual(position);
        expect(marker.properties).toEqual(properties);
        // Markers are an array, not keyed by photoName.
        expect(sv.markers).not.toHaveProperty(photoName);
    });

    it('broadcasts a marker360 op INTACT to a connected WS peer', async () => {
        const peerClientId = newClientId();
        const ws = makeWs(api, { clientId: peerClientId });
        const received = [];
        ws.on('operation', (op) => received.push(op));

        await ws.connect(atlasId, { lastVersion: 0 });

        const senderClientId = newClientId();
        const id = newClientId();
        const photoName = `pano_${newClientId().slice(0, 8)}.webp`;
        const op = createOperation('marker360', 'create', id, mapId, {
            id,
            photoName,
            position: { x: 1, y: 2, z: 3 },
            properties: { label: 'WS broadcast' },
        });
        op.clientId = senderClientId; // a DIFFERENT client than the WS peer

        await api.pushOperations(atlasId, [op]);

        const got = await waitFor(
            () => received.find((o) => o.entityId === id || (o.data && o.data.id === id)),
            { timeout: 4000 },
        );
        expect(got).toBeTruthy();
        // The 360 payload survives the WS wire, field by field: entity routing,
        // the photoName key, the nested position and the op idempotency key.
        expect(got.entityType).toBe('marker360');
        expect(got.operationType).toBe('create');
        expect(got.mapId).toBe(mapId);
        expect(got.id).toBe(op.id);
        expect(got.data.photoName).toBe(photoName);
        expect(got.data.position).toEqual({ x: 1, y: 2, z: 3 });
        expect(got.data.properties.label).toBe('WS broadcast');
        // Delivered precisely BECAUSE it was authored by a foreign client.
        expect(got.clientId).toBe(senderClientId);

        ws.disconnect();
    });
});

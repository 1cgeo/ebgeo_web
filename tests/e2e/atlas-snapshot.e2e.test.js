// Path: tests/e2e/atlas-snapshot.e2e.test.js

/**
 * @fileoverview Real end-to-end test for the atlas snapshot contract.
 *
 * Drives the live backend (brought up by global-setup.js) only through the
 * public ApiClient + createOperation + the shared harness. Verifies that after
 * creating an atlas and a map (via a CRDT 'map' create op), pullSync(atlasId, 0)
 * returns a full snapshot whose `maps` include the created map with the
 * IndexedDB-shaped feature buckets.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

describe.skipIf(E2E_SKIP)('e2e: atlas-snapshot', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlas;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Snapshot User' });
        atlas = await createAtlas(api, { name: 'Snapshot Atlas' });
        mapId = await createMap(api, atlas.id, { name: 'Mapa Alpha' });
    });

    it('pullSync(0) returns a snapshot containing the created map', async () => {
        const r = await api.pullSync(atlas.id, 0);

        // Version 0 must yield a full snapshot, not an incremental op stream.
        expect(r.isSnapshot).toBe(true);
        expect(r.snapshot).toBeDefined();
        expect(r.snapshot.atlas.id).toBe(atlas.id);
        expect(typeof r.currentVersion).toBe('number');
        expect(r.currentVersion).toBeGreaterThan(0);

        const maps = r.snapshot.maps;
        expect(Array.isArray(maps)).toBe(true);

        const created = maps.find((m) => m.id === mapId);
        expect(created).toBeDefined();
        expect(created.name).toBe('Mapa Alpha');
    });

    it('snapshot map carries IndexedDB-shaped (empty) feature buckets', async () => {
        const r = await api.pullSync(atlas.id, 0);
        const map = r.snapshot.maps.find((m) => m.id === mapId);

        expect(map.features).toBeDefined();
        // IndexedDB-shaped buckets, keyed by collection name.
        for (const bucket of ['points', 'lines', 'polygons', 'texts', 'images']) {
            expect(Array.isArray(map.features[bucket])).toBe(true);
        }
        // Fresh map: every bucket is empty (negative/edge assertion).
        expect(map.features.points).toHaveLength(0);
        expect(map.features.lines).toHaveLength(0);
        expect(map.features.polygons).toHaveLength(0);

        // Collateral structures are present and empty too.
        expect(Array.isArray(map.layers)).toBe(true);
        expect(Array.isArray(map.groups)).toBe(true);
    });

    it('an added point feature appears in the points bucket after sync', async () => {
        const featureId = crypto.randomUUID();
        const feature = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.18, -22.91] },
            properties: { id: featureId, source: 'point' },
        };
        const op = createOperation('feature', 'create', featureId, mapId, feature);
        await api.pushOperations(atlas.id, [op]);

        const r = await api.pullSync(atlas.id, 0);
        const map = r.snapshot.maps.find((m) => m.id === mapId);

        const points = map.features.points;
        expect(points).toHaveLength(1);
        const stored = points[0];
        expect(stored.type).toBe('Feature');
        expect(stored.properties.id).toBe(featureId);
        expect(stored.properties.source).toBe('point');
        expect(stored.geometry.coordinates).toEqual([-43.18, -22.91]);

        // Negative: a point must NOT leak into another bucket.
        expect(map.features.lines).toHaveLength(0);
        expect(map.features.polygons).toHaveLength(0);
    });
});

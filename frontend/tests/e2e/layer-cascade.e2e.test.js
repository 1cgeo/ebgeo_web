// Path: tests/e2e/layer-cascade.e2e.test.js

/**
 * @fileoverview Real-backend E2E for the §2.2 layer-delete cascade.
 *
 * Drives the frontend sync transport against the live ebgeo_backend: creates a
 * layer with two features referencing it (`properties.layerId`) plus a feature
 * on a second layer, then pushes a layer DELETE op. Asserts via the real
 * `pullSync` snapshot that the deleted layer and its two features are gone while
 * the surviving layer and its feature remain — proving the server-side cascade
 * (layer delete soft-deletes every feature carrying that `layer_id`).
 */

import { describe, it, beforeAll, expect } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a minimal GeoJSON point Feature payload for a 'feature' create op.
 * The backend derives `feature_type`/`layer_id` from `properties.source`/
 * `properties.layerId`, so both must live in `properties`.
 * @param {string} id - Feature entity id.
 * @param {string} layerId - Owning layer id (`properties.layerId`).
 * @param {[number, number]} coords - [lng, lat] coordinates.
 * @returns {Object} GeoJSON Feature payload.
 */
function pointFeature(id, layerId, coords) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { id, source: 'point', layerId },
    };
}

/**
 * Flattens a snapshot map's `features.points` collection into the GeoJSON
 * point features present in the snapshot (server already soft-delete-filters).
 * @param {Object} map - Snapshot map.
 * @returns {Object[]} Point features.
 */
function snapshotPoints(map) {
    return (map.features && map.features.points) || [];
}

describe.skipIf(E2E_SKIP)('§2.2 layer delete cascades to its features (real backend)', () => {
    let api;
    let atlasId;
    let mapId;

    const layerA = generateUUID();
    const layerB = generateUUID();
    const featA1 = generateUUID();
    const featA2 = generateUUID();
    const featB1 = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Layer Cascade Owner' });
        const atlas = await createAtlas(api, { name: 'Layer Cascade Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Cascade Map' });

        // Two layers; two features on layer A and one on layer B.
        await api.pushOperations(atlasId, [
            createOperation('layer', 'create', layerA, mapId, { name: 'Layer A', order: 0 }),
            createOperation('layer', 'create', layerB, mapId, { name: 'Layer B', order: 1 }),
            createOperation('feature', 'create', featA1, mapId, pointFeature(featA1, layerA, [0, 0])),
            createOperation('feature', 'create', featA2, mapId, pointFeature(featA2, layerA, [1, 1])),
            createOperation('feature', 'create', featB1, mapId, pointFeature(featB1, layerB, [2, 2])),
        ]);
    });

    it('seeds 2 layers and 3 features before the delete', async () => {
        const { snapshot } = await api.pullSync(atlasId, 0);
        const map = snapshot.maps.find((m) => m.id === mapId);
        expect(map).toBeTruthy();

        const layerIds = map.layers.map((l) => l.id);
        expect(layerIds).toContain(layerA);
        expect(layerIds).toContain(layerB);

        const points = snapshotPoints(map);
        const ids = points.map((f) => f.properties.id);
        expect(ids).toEqual(expect.arrayContaining([featA1, featA2, featB1]));
        expect(ids).toHaveLength(3);

        // Edge: the two layer-A features really do carry the layerId reference the
        // cascade keys on (otherwise the test below would pass vacuously).
        const a1 = points.find((f) => f.properties.id === featA1);
        const a2 = points.find((f) => f.properties.id === featA2);
        expect(a1.properties.layerId).toBe(layerA);
        expect(a2.properties.layerId).toBe(layerA);
    });

    it('deleting layer A omits layer A and its 2 features, keeps layer B and its feature', async () => {
        await api.pushOperations(atlasId, [
            createOperation('layer', 'delete', layerA, mapId, null),
        ]);

        const { snapshot } = await api.pullSync(atlasId, 0);
        const map = snapshot.maps.find((m) => m.id === mapId);
        expect(map).toBeTruthy();

        // Deleted layer is omitted; surviving layer remains.
        const layerIds = map.layers.map((l) => l.id);
        expect(layerIds).not.toContain(layerA);
        expect(layerIds).toContain(layerB);

        // The two features on layer A are gone; the layer-B feature survives.
        const ids = snapshotPoints(map).map((f) => f.properties.id);
        expect(ids).not.toContain(featA1);
        expect(ids).not.toContain(featA2);
        expect(ids).toEqual([featB1]);
        expect(ids).toHaveLength(1);
    });
});

// Path: tests/e2e/feature-move-layer.e2e.test.js

/**
 * @fileoverview E2E for moving a feature between layers (spec §14.6 / §2.31) against
 * the live backend, driving only the public ApiClient + createOperation.
 *
 * Scenario: create layerA + layerB in the same map, create a feature referencing
 * layerA (via the frozen GeoJSON `properties.layerId`), then push a feature `update`
 * that rewrites `properties.layerId` to layerB. The pullSync snapshot must echo the
 * feature with the NEW layer ref (and never the old one).
 *
 * Negative: a feature `update` whose `map_id` points to a map in ANOTHER atlas is a
 * cross-tenant move and the backend rejects it with 403 (the feature stays put).
 *
 * Every assertion checks observable backend state via a real pullSync round-trip.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { ApiError } from '../../src/js/store/sync/api-client.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/**
 * Builds a layer `create` op (layers travel as CRDT operations).
 * @param {string} layerId
 * @param {string} mapId
 * @param {string} name
 * @param {number} order
 * @returns {Object} sync operation
 */
function layerCreateOp(layerId, mapId, name, order) {
    return createOperation('layer', 'create', layerId, mapId, { name, order });
}

/**
 * Builds a feature `create` op carrying a raw GeoJSON Feature whose feature type
 * lives in `properties.source` and whose layer ref lives in `properties.layerId`.
 * @param {string} featureId
 * @param {string} mapId
 * @param {string} layerId
 * @returns {Object} sync operation
 */
function featureCreateOp(featureId, mapId, layerId) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { source: 'point', layerId, nome: 'Movable' },
    });
}

/** Pulls a fresh snapshot and returns the map object matching `mapId`. */
async function pullMap(api, atlasId, mapId) {
    const r = await api.pullSync(atlasId, 0);
    expect(r.isSnapshot).toBe(true);
    expect(r.snapshot).toBeTruthy();
    const map = r.snapshot.maps.find((m) => m.id === mapId);
    expect(map, 'map present in snapshot').toBeTruthy();
    return map;
}

describe.skipIf(E2E_SKIP)('E2E feature-move-layer', () => {
    let api;
    let atlasId;
    let mapId;
    // A second atlas/map owned by the SAME user, used to probe the cross-atlas move.
    let otherAtlasId;
    let otherMapId;

    const layerAId = generateUUID();
    const layerBId = generateUUID();
    const featureId = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Move Layer Owner' });

        const atlas = await createAtlas(api, { name: 'Move Layer Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Move' });

        const other = await createAtlas(api, { name: 'Move Layer Atlas (other)' });
        otherAtlasId = other.id;
        otherMapId = await createMap(api, otherAtlasId, { name: 'Mapa Other' });

        // layerA + layerB live in the same map; the feature starts on layerA.
        await api.pushOperations(atlasId, [
            layerCreateOp(layerAId, mapId, 'Layer A', 0),
            layerCreateOp(layerBId, mapId, 'Layer B', 1),
            featureCreateOp(featureId, mapId, layerAId),
        ]);
    });

    it('starts with the feature referencing layerA in the snapshot', async () => {
        const map = await pullMap(api, atlasId, mapId);
        expect(map.layers.some((l) => l.id === layerAId)).toBe(true);
        expect(map.layers.some((l) => l.id === layerBId)).toBe(true);

        const feat = map.features.points.find((f) => f.properties.id === featureId);
        expect(feat, 'feature present').toBeTruthy();
        expect(feat.properties.layerId).toBe(layerAId);
    });

    it('moves the feature to layerB: snapshot shows the new layer ref', async () => {
        // The frontend update factory puts the payload in `data`; the backend folds
        // `data` into `changes` for updates and derives the `layer_id` column from
        // `properties.layerId`. Carry the full GeoJSON so the stored `properties`
        // JSONB (surfaced verbatim in the snapshot) also reflects the new ref.
        const moveOp = createOperation('feature', 'update', featureId, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { source: 'point', layerId: layerBId, nome: 'Movable' },
        });
        const res = await api.pushOperations(atlasId, [moveOp]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        const feat = map.features.points.find((f) => f.properties.id === featureId);
        expect(feat, 'feature still present after move').toBeTruthy();
        // Positive: the new layer ref is reflected.
        expect(feat.properties.layerId).toBe(layerBId);
        // Negative: the old layer ref is gone.
        expect(feat.properties.layerId).not.toBe(layerAId);
        // Version advanced past the create.
        expect(feat.properties.version).toBeGreaterThan(1);
    });

    it('rejects a cross-atlas map_id move with 403 and leaves the feature put', async () => {
        // A feature update whose map_id points to a map in ANOTHER atlas is a
        // cross-tenant move; the backend throws ForbiddenError -> 403.
        const crossOp = createOperation('feature', 'update', featureId, mapId, {
            map_id: otherMapId,
        });

        await expect(api.pushOperations(atlasId, [crossOp])).rejects.toMatchObject({
            status: 403,
        });
        // Be explicit it is the ApiError type, not some transport failure.
        await expect(
            api.pushOperations(atlasId, [
                createOperation('feature', 'update', featureId, mapId, { map_id: otherMapId }),
            ]),
        ).rejects.toBeInstanceOf(ApiError);

        // The feature must NOT have moved into the other atlas, and must remain on
        // layerB in its original atlas/map (the rejected op was atomic).
        const otherSnap = (await api.pullSync(otherAtlasId, 0)).snapshot;
        const leaked = (otherSnap.maps || []).some((m) =>
            (m.features?.points || []).some((f) => f.properties.id === featureId),
        );
        expect(leaked, 'feature did not leak into the other atlas').toBe(false);

        const map = await pullMap(api, atlasId, mapId);
        const feat = map.features.points.find((f) => f.properties.id === featureId);
        expect(feat, 'feature still in its original atlas/map').toBeTruthy();
        expect(feat.properties.layerId).toBe(layerBId);
    });
});

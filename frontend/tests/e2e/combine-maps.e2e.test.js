// Path: tests/e2e/combine-maps.e2e.test.js

/**
 * @fileoverview E2E for §1.14 / §24.3 "combine maps" against the live backend.
 *
 * Builds two source maps, each carrying one feature pushed as a CRDT sync op
 * (raw GeoJSON, type in `properties.source`), then calls the atomic structural
 * merge route `POST /atlas/:atlasId/maps/:destMapId/merge` with both source ids.
 * Per the route contract (maps.service.mergeMaps) the sources' sub-entities are
 * MOVED into the destination map in one transaction; the source maps themselves
 * are NOT deleted (only their contents move).
 *
 * Every assertion checks observable backend state via a real pullSync snapshot
 * (and the merge route's own `moved` counts). Negatives: a merge naming a
 * foreign/non-existent source map must 404 and leave state untouched; a source
 * naming only the destination is a no-op.
 */

import { describe, it, expect, beforeAll } from 'vitest';
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
 * Pushes a feature `create` op (raw GeoJSON Point) onto `mapId`.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @param {string} featureId
 * @param {[number, number]} coords - [lng, lat]
 * @returns {Promise<void>}
 */
async function pushPoint(api, atlasId, mapId, featureId, coords) {
    const op = createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: { source: 'point', layerId: null },
    });
    const res = await api.pushOperations(atlasId, [op]);
    expect(res.results[0].success).toBe(true);
}

/** Pulls a fresh snapshot and returns the map object matching `mapId`. */
async function pullMap(api, atlasId, mapId) {
    const r = await api.pullSync(atlasId, 0);
    expect(r.isSnapshot).toBe(true);
    const map = r.snapshot.maps.find((m) => m.id === mapId);
    expect(map, `map ${mapId} present in snapshot`).toBeTruthy();
    return map;
}

/** Returns the ids of every point feature on a snapshot map. */
function pointIds(map) {
    return map.features.points.map((f) => f.properties.id);
}

describe.skipIf(E2E_SKIP)('E2E combine-maps (merge route)', () => {
    let api;
    let atlasId;
    let destMapId;
    let srcAMapId;
    let srcBMapId;

    const destFeatureId = generateUUID();
    const featAId = generateUUID();
    const featBId = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Combine Maps User' });
        const atlas = await createAtlas(api, { name: 'Combine Maps Atlas' });
        atlasId = atlas.id;

        destMapId = await createMap(api, atlasId, { name: 'Mapa Destino' });
        srcAMapId = await createMap(api, atlasId, { name: 'Mapa Origem A' });
        srcBMapId = await createMap(api, atlasId, { name: 'Mapa Origem B' });

        // One distinct feature per map so we can track exactly where each lands.
        await pushPoint(api, atlasId, destMapId, destFeatureId, [-43.0, -22.0]);
        await pushPoint(api, atlasId, srcAMapId, featAId, [-43.1, -22.1]);
        await pushPoint(api, atlasId, srcBMapId, featBId, [-43.2, -22.2]);
    }, 30000);

    it('seeds each map with exactly its own feature before the merge', async () => {
        const dest = await pullMap(api, atlasId, destMapId);
        const a = await pullMap(api, atlasId, srcAMapId);
        const b = await pullMap(api, atlasId, srcBMapId);

        expect(pointIds(dest)).toEqual([destFeatureId]);
        expect(pointIds(a)).toEqual([featAId]);
        expect(pointIds(b)).toEqual([featBId]);
    });

    it('merges two source maps: all features end up on the destination map', async () => {
        const result = await api._request(
            'POST',
            `/atlas/${atlasId}/maps/${destMapId}/merge`,
            { body: { sourceMapIds: [srcAMapId, srcBMapId] } }
        );

        // Route contract: the two sources are moved (dest excluded), feature counts echoed.
        expect(result.destMapId).toBe(destMapId);
        expect(result.sourceMapIds.sort()).toEqual([srcAMapId, srcBMapId].sort());
        expect(result.moved.features).toBe(2);

        // Destination now owns its original + both moved features.
        const dest = await pullMap(api, atlasId, destMapId);
        const destIds = pointIds(dest);
        expect(destIds).toContain(destFeatureId);
        expect(destIds).toContain(featAId);
        expect(destIds).toContain(featBId);
        expect(destIds).toHaveLength(3);

        // Source maps survive the merge (not deleted) but are emptied of features.
        const a = await pullMap(api, atlasId, srcAMapId);
        const b = await pullMap(api, atlasId, srcBMapId);
        expect(pointIds(a)).toEqual([]);
        expect(pointIds(b)).toEqual([]);
    });

    it('treats a source list of only the destination as a no-op (nothing moves)', async () => {
        const before = pointIds(await pullMap(api, atlasId, destMapId));

        const result = await api._request(
            'POST',
            `/atlas/${atlasId}/maps/${destMapId}/merge`,
            { body: { sourceMapIds: [destMapId] } }
        );
        // Destination is filtered out of its own source set -> empty move.
        expect(result.sourceMapIds).toEqual([]);
        expect(result.moved).toEqual({});

        const after = pointIds(await pullMap(api, atlasId, destMapId));
        expect(after.sort()).toEqual(before.sort());
    });

    it('rejects a merge naming an unknown/foreign source map (404) and leaves state intact', async () => {
        const bogusSource = generateUUID();
        const before = pointIds(await pullMap(api, atlasId, destMapId));

        await expect(
            api._request('POST', `/atlas/${atlasId}/maps/${destMapId}/merge`, {
                body: { sourceMapIds: [bogusSource] },
            })
        ).rejects.toMatchObject({ status: 404 });

        // The atomic transaction must not have partially applied anything.
        const after = pointIds(await pullMap(api, atlasId, destMapId));
        expect(after.sort()).toEqual(before.sort());
    });
});

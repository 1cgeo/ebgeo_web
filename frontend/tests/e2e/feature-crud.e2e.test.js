// Path: tests/e2e/feature-crud.e2e.test.js

/**
 * @fileoverview E2E feature CRUD against the live backend. Drives the server only
 * through the public ApiClient + createOperation: pushes feature create/update/delete
 * sync ops (raw GeoJSON, type in `properties.source`) and asserts the pullSync
 * snapshot reflects each change in the correct bucket (points/lines/polygons).
 *
 * Each case is a real HTTP round-trip; every assertion checks observable backend
 * state, including a negative assertion (deleted feature gone from the snapshot).
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
 * Builds a feature `create` op carrying a raw GeoJSON Feature whose feature type
 * lives in `properties.source` (frozen frontend contract the backend derives from).
 * @param {string} featureId
 * @param {string} mapId
 * @param {string} source - 'point' | 'line' | 'polygon'
 * @param {Object} geometry - GeoJSON geometry
 * @param {Object} [props]
 * @returns {Object} sync operation
 */
function featureCreateOp(featureId, mapId, source, geometry, props = {}) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry,
        properties: { source, layerId: null, ...props },
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

describe.skipIf(E2E_SKIP)('E2E feature-crud', () => {
    let api;
    let atlasId;
    let mapId;

    const pointId = generateUUID();
    const lineId = generateUUID();
    const polygonId = generateUUID();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api);
        const atlas = await createAtlas(api, { name: 'Feature CRUD Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa CRUD' });
    });

    it('creates point/line/polygon and they land in the right snapshot buckets', async () => {
        const pointGeom = { type: 'Point', coordinates: [-43.2, -22.9] };
        const lineGeom = {
            type: 'LineString',
            coordinates: [[-43.2, -22.9], [-43.1, -22.8]],
        };
        const polygonGeom = {
            type: 'Polygon',
            coordinates: [[[-43.2, -22.9], [-43.1, -22.9], [-43.1, -22.8], [-43.2, -22.9]]],
        };

        const ops = [
            featureCreateOp(pointId, mapId, 'point', pointGeom, { nome: 'Ponto A' }),
            featureCreateOp(lineId, mapId, 'line', lineGeom),
            featureCreateOp(polygonId, mapId, 'polygon', polygonGeom),
        ];
        const res = await api.pushOperations(atlasId, ops);
        expect(res.results).toHaveLength(3);
        expect(res.results.every((r) => r.success)).toBe(true);
        expect(res.serverVersion).toBeGreaterThan(0);

        const map = await pullMap(api, atlasId, mapId);

        const point = map.features.points.find((f) => f.properties.id === pointId);
        expect(point, 'point in points bucket').toBeTruthy();
        expect(point.geometry).toEqual(pointGeom);
        expect(point.properties.source).toBe('point');
        expect(point.properties.nome).toBe('Ponto A');

        const line = map.features.lines.find((f) => f.properties.id === lineId);
        expect(line, 'line in lines bucket').toBeTruthy();
        expect(line.geometry).toEqual(lineGeom);

        const polygon = map.features.polygons.find((f) => f.properties.id === polygonId);
        expect(polygon, 'polygon in polygons bucket').toBeTruthy();
        expect(polygon.geometry).toEqual(polygonGeom);

        // Negative: a point must NOT leak into the lines/polygons buckets.
        expect(map.features.lines.some((f) => f.properties.id === pointId)).toBe(false);
        expect(map.features.polygons.some((f) => f.properties.id === pointId)).toBe(false);
    });

    it('updates a feature: new geometry and properties are reflected', async () => {
        const newGeom = { type: 'Point', coordinates: [-43.5, -23.0] };
        const updateOp = createOperation('feature', 'update', pointId, mapId, {
            geometry: newGeom,
            properties: { source: 'point', nome: 'Ponto B', extra: 42 },
        });
        const res = await api.pushOperations(atlasId, [updateOp]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        const point = map.features.points.find((f) => f.properties.id === pointId);
        expect(point, 'updated point still present').toBeTruthy();
        expect(point.geometry).toEqual(newGeom);
        expect(point.properties.nome).toBe('Ponto B');
        expect(point.properties.extra).toBe(42);
        // Version monotonically advanced past the initial create.
        expect(point.properties.version).toBeGreaterThan(1);
    });

    it('is idempotent: replaying the same create op id is a no-op ack', async () => {
        const dupId = generateUUID();
        const op = featureCreateOp(dupId, mapId, 'point', {
            type: 'Point',
            coordinates: [-43.0, -22.0],
        });
        const first = await api.pushOperations(atlasId, [op]);
        expect(first.results[0].idempotent).toBe(false);

        // Same op (same op.id) again -> recorded as idempotent, no duplicate row.
        const second = await api.pushOperations(atlasId, [op]);
        expect(second.results[0].idempotent).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        const matches = map.features.points.filter((f) => f.properties.id === dupId);
        expect(matches).toHaveLength(1);
    });

    it('deletes a feature: it disappears from the snapshot', async () => {
        const deleteOp = createOperation('feature', 'delete', lineId, mapId, null);
        const res = await api.pushOperations(atlasId, [deleteOp]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        // Negative assertion: the soft-deleted line is gone from the snapshot.
        expect(map.features.lines.some((f) => f.properties.id === lineId)).toBe(false);
        // Sanity: the point and polygon survive the line's deletion.
        expect(map.features.points.some((f) => f.properties.id === pointId)).toBe(true);
        expect(map.features.polygons.some((f) => f.properties.id === polygonId)).toBe(true);
    });
});

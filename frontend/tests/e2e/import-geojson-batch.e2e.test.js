// Path: tests/e2e/import-geojson-batch.e2e.test.js

/**
 * @fileoverview E2E §5.1: a single atomic batch import of 10 feature `create`
 * ops (mixed point/line/polygon, each a raw GeoJSON Feature whose type lives in
 * `properties.source`). Drives the live backend through the public ApiClient and
 * one `pushOperations` call (one push = one tx), then asserts the pullSync
 * snapshot contains all 10 features bucketed by their derived `feature_type`
 * (points/lines/polygons). Every assertion checks observable backend state; no
 * DB access. Includes negative/edge assertions: every push result succeeds and
 * is non-idempotent, no feature leaks into a foreign bucket, and replaying the
 * exact same batch is recorded as idempotent with zero duplicate rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    E2E_SKIP,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/** Geometry builders keyed by `source` so each feature gets a valid GeoJSON shape. */
const GEOMETRY_BY_SOURCE = {
    point: (i) => ({ type: 'Point', coordinates: [-43.2 + i * 0.01, -22.9 - i * 0.01] }),
    line: (i) => ({
        type: 'LineString',
        coordinates: [
            [-43.2 + i * 0.01, -22.9],
            [-43.1 + i * 0.01, -22.8],
        ],
    }),
    polygon: (i) => ({
        type: 'Polygon',
        coordinates: [[
            [-43.2 + i * 0.01, -22.9],
            [-43.1 + i * 0.01, -22.9],
            [-43.1 + i * 0.01, -22.8],
            [-43.2 + i * 0.01, -22.9],
        ]],
    }),
};

/**
 * Builds a feature `create` op carrying a raw GeoJSON Feature whose feature type
 * lives in `properties.source` (frozen frontend contract the backend derives from).
 * @param {string} featureId
 * @param {string} mapId
 * @param {string} source - 'point' | 'line' | 'polygon'
 * @param {number} i - Index used to spread geometry coordinates apart.
 * @returns {Object} sync operation
 */
function featureCreateOp(featureId, mapId, source, i) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: GEOMETRY_BY_SOURCE[source](i),
        properties: { id: featureId, source, layerId: null, label: `${source}-${i}` },
    });
}

describe.skipIf(E2E_SKIP)('e2e: import-geojson-batch', () => {
    let api;
    let atlasId;
    let mapId;

    // 10 mixed features: 4 points, 3 lines, 3 polygons.
    const SOURCES = ['point', 'line', 'polygon', 'point', 'line', 'polygon', 'point', 'line', 'polygon', 'point'];
    const expected = SOURCES.map((source, i) => ({ id: generateUUID(), source, i }));
    const idsBySource = {
        point: expected.filter((e) => e.source === 'point').map((e) => e.id),
        line: expected.filter((e) => e.source === 'line').map((e) => e.id),
        polygon: expected.filter((e) => e.source === 'polygon').map((e) => e.id),
    };

    let batchOps;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'GeoJSON Batch User' });
        const atlas = await createAtlas(api, { name: 'GeoJSON Batch Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Batch' });
        batchOps = expected.map((e) => featureCreateOp(e.id, mapId, e.source, e.i));
    });

    afterAll(async () => {
        if (api) await api.logout().catch(() => {});
    });

    it('imports a single batch of 10 mixed features atomically into the right buckets', async () => {
        expect(batchOps).toHaveLength(10);

        // One push = one tx: all 10 features land (or none do).
        const res = await api.pushOperations(atlasId, batchOps);
        expect(res.results).toHaveLength(10);
        expect(res.results.every((r) => r.success)).toBe(true);
        // Edge: a fresh batch is never idempotent on first arrival.
        expect(res.results.every((r) => r.idempotent === false)).toBe(true);
        expect(res.serverVersion).toBeGreaterThan(0);

        const pull = await api.pullSync(atlasId, 0);
        expect(pull.isSnapshot).toBe(true);
        expect(pull.snapshot).toBeTruthy();

        const map = pull.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'map present in snapshot').toBeTruthy();

        const points = map.features.points || [];
        const lines = map.features.lines || [];
        const polygons = map.features.polygons || [];

        // All 10 present, each in its derived bucket.
        for (const id of idsBySource.point) {
            const f = points.find((p) => p.properties.id === id);
            expect(f, `point ${id} in points bucket`).toBeTruthy();
            expect(f.type).toBe('Feature');
            expect(f.geometry.type).toBe('Point');
            expect(f.properties.source).toBe('point');
        }
        for (const id of idsBySource.line) {
            const f = lines.find((l) => l.properties.id === id);
            expect(f, `line ${id} in lines bucket`).toBeTruthy();
            expect(f.geometry.type).toBe('LineString');
            expect(f.properties.source).toBe('line');
        }
        for (const id of idsBySource.polygon) {
            const f = polygons.find((p) => p.properties.id === id);
            expect(f, `polygon ${id} in polygons bucket`).toBeTruthy();
            expect(f.geometry.type).toBe('Polygon');
            expect(f.properties.source).toBe('polygon');
        }

        // Bucket counts exactly match the batch composition.
        const allIds = new Set(expected.map((e) => e.id));
        expect(points.filter((f) => allIds.has(f.properties.id))).toHaveLength(4);
        expect(lines.filter((f) => allIds.has(f.properties.id))).toHaveLength(3);
        expect(polygons.filter((f) => allIds.has(f.properties.id))).toHaveLength(3);

        // Negative: no feature leaks into a foreign bucket (bucketed by derived
        // type, not duplicated across collections).
        const pointSet = new Set(idsBySource.point);
        const lineSet = new Set(idsBySource.line);
        const polySet = new Set(idsBySource.polygon);
        expect(lines.some((f) => pointSet.has(f.properties.id))).toBe(false);
        expect(polygons.some((f) => pointSet.has(f.properties.id))).toBe(false);
        expect(points.some((f) => lineSet.has(f.properties.id))).toBe(false);
        expect(points.some((f) => polySet.has(f.properties.id))).toBe(false);
    });

    it('replaying the identical batch is idempotent with zero duplicate rows', async () => {
        // Same op ids again: every op recorded as idempotent (ON CONFLICT DO NOTHING).
        const res = await api.pushOperations(atlasId, batchOps);
        expect(res.results).toHaveLength(10);
        expect(res.results.every((r) => r.idempotent === true)).toBe(true);

        const pull = await api.pullSync(atlasId, 0);
        const map = pull.snapshot.maps.find((m) => m.id === mapId);
        const allIds = new Set(expected.map((e) => e.id));

        // Negative/edge: no duplicates — each of the 10 ids appears exactly once
        // across all feature buckets.
        const everywhere = [
            ...(map.features.points || []),
            ...(map.features.lines || []),
            ...(map.features.polygons || []),
        ].filter((f) => allIds.has(f.properties.id));
        expect(everywhere).toHaveLength(10);
        for (const id of allIds) {
            expect(everywhere.filter((f) => f.properties.id === id)).toHaveLength(1);
        }
    });
});

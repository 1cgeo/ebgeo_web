// Path: tests/e2e/temporal-feature.e2e.test.js

/**
 * @fileoverview E2E for §29.13-17 temporal feature properties against the live
 * backend. A point feature carries temporal authoring data inside its GeoJSON
 * `properties`: `temporalInicio`/`temporalFim` (epoch ms) and a `trajetoria`
 * array of `{ t, lng, lat }` samples. The backend stores `properties` as opaque
 * JSONB, so these custom keys must round-trip verbatim through a pullSync snapshot
 * and reflect a subsequent update.
 *
 * Every assertion is a real HTTP round-trip checking observable backend state
 * (the pullSync snapshot). Includes a negative assertion: clearing the temporal
 * keys via update actually removes them (properties is a full JSONB replace, not
 * a deep merge), and a non-temporal sibling point never gains temporal data.
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
 * Builds a feature `create` op carrying a raw GeoJSON point Feature whose feature
 * type lives in `properties.source` (frozen frontend contract the backend derives
 * from). Extra props (temporal keys) ride along verbatim in `properties`.
 * @param {string} featureId
 * @param {string} mapId
 * @param {[number, number]} coordinates
 * @param {Object} props - Extra properties merged after `source`/`layerId`.
 * @returns {Object} sync operation
 */
function pointCreateOp(featureId, mapId, coordinates, props = {}) {
    return createOperation('feature', 'create', featureId, mapId, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates },
        properties: { source: 'point', layerId: null, ...props },
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

/** Finds the point feature with the given id in the snapshot's points bucket. */
function findPoint(map, id) {
    return map.features.points.find((f) => f.properties.id === id);
}

describe.skipIf(E2E_SKIP)('E2E temporal-feature', () => {
    let api;
    let atlasId;
    let mapId;

    const temporalId = generateUUID();
    const plainId = generateUUID();

    // §29.13-17: epoch-ms window + sampled trajectory ([{t,lng,lat}]).
    const temporalInicio = Date.UTC(2024, 0, 1, 12, 0, 0); // 1704110400000
    const temporalFim = Date.UTC(2024, 0, 1, 13, 30, 0); // 1704115800000
    const trajetoria = [
        { t: temporalInicio, lng: -43.2, lat: -22.9 },
        { t: temporalInicio + 1_800_000, lng: -43.15, lat: -22.85 },
        { t: temporalFim, lng: -43.1, lat: -22.8 },
    ];

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api);
        const atlas = await createAtlas(api, { name: 'Temporal Feature Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Temporal' });
    });

    it('creates a point whose temporal properties round-trip verbatim', async () => {
        const createTemporal = pointCreateOp(temporalId, mapId, [-43.2, -22.9], {
            nome: 'Unidade Movel',
            temporalInicio,
            temporalFim,
            trajetoria,
        });
        // A sibling point with NO temporal data, to prove isolation.
        const createPlain = pointCreateOp(plainId, mapId, [-44.0, -23.5], {
            nome: 'Marco Fixo',
        });

        const res = await api.pushOperations(atlasId, [createTemporal, createPlain]);
        expect(res.results).toHaveLength(2);
        expect(res.results.every((r) => r.success)).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        const point = findPoint(map, temporalId);
        expect(point, 'temporal point in points bucket').toBeTruthy();

        // Scalars survive as exact epoch-ms numbers (no string coercion / drift).
        expect(point.properties.temporalInicio).toBe(temporalInicio);
        expect(point.properties.temporalFim).toBe(temporalFim);
        expect(typeof point.properties.temporalInicio).toBe('number');

        // The trajectory array round-trips structurally identical (key order in
        // each sample object is irrelevant; toEqual is deep, value-based).
        expect(point.properties.trajetoria).toEqual(trajetoria);
        expect(point.properties.trajetoria).toHaveLength(3);
        expect(point.properties.trajetoria[1]).toEqual({
            t: temporalInicio + 1_800_000,
            lng: -43.15,
            lat: -22.85,
        });

        // Negative: the plain sibling never acquired temporal keys.
        const plain = findPoint(map, plainId);
        expect(plain, 'plain point present').toBeTruthy();
        expect(plain.properties.temporalInicio).toBeUndefined();
        expect(plain.properties.temporalFim).toBeUndefined();
        expect(plain.properties.trajetoria).toBeUndefined();
    });

    it('updates temporal window and trajectory; the snapshot reflects new values', async () => {
        const newInicio = temporalInicio + 3_600_000; // shifted +1h
        const newFim = temporalFim + 3_600_000;
        const newTrajetoria = [
            { t: newInicio, lng: -43.05, lat: -22.75 },
            { t: newFim, lng: -42.95, lat: -22.65 },
        ];

        // properties is a full JSONB replace, so carry the whole object (incl. source).
        const updateOp = createOperation('feature', 'update', temporalId, mapId, {
            properties: {
                source: 'point',
                layerId: null,
                nome: 'Unidade Movel',
                temporalInicio: newInicio,
                temporalFim: newFim,
                trajetoria: newTrajetoria,
            },
        });
        const res = await api.pushOperations(atlasId, [updateOp]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        const point = findPoint(map, temporalId);
        expect(point, 'updated temporal point still present').toBeTruthy();

        expect(point.properties.temporalInicio).toBe(newInicio);
        expect(point.properties.temporalFim).toBe(newFim);
        expect(point.properties.trajetoria).toEqual(newTrajetoria);
        expect(point.properties.trajetoria).toHaveLength(2);
        // Version advanced past the initial create (proves a real write happened).
        expect(point.properties.version).toBeGreaterThan(1);
    });

    it('clearing temporal keys via update removes them from the snapshot', async () => {
        // Replace properties WITHOUT the temporal keys: a full JSONB replace must
        // drop them (negative/edge: not a deep merge that would retain stale data).
        const clearOp = createOperation('feature', 'update', temporalId, mapId, {
            properties: { source: 'point', layerId: null, nome: 'Unidade Parada' },
        });
        const res = await api.pushOperations(atlasId, [clearOp]);
        expect(res.results[0].success).toBe(true);

        const map = await pullMap(api, atlasId, mapId);
        const point = findPoint(map, temporalId);
        expect(point, 'point survives the clear update').toBeTruthy();
        expect(point.properties.nome).toBe('Unidade Parada');
        expect(point.properties.temporalInicio).toBeUndefined();
        expect(point.properties.temporalFim).toBeUndefined();
        expect(point.properties.trajetoria).toBeUndefined();
    });
});

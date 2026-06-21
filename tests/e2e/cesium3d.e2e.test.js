// Path: tests/e2e/cesium3d.e2e.test.js

/**
 * @fileoverview Real end-to-end test for FLAT camelCase Cesium 3D sync operations
 * (marker3d / measurement3d / viewshed3d / cameraPosition3d). Drives the live
 * backend only through ApiClient + createOperation + the harness, then asserts the
 * pullSync snapshot reshapes the flat ops into the frozen frontend hierarchy
 * `map.cesium3d = { cameraPositions, markers, measurements, viewsheds }` with
 * `tilesetId` preserved and the flat fields carried inside each entry.
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

describe.skipIf(E2E_SKIP)('e2e: cesium3d flat 3D sync', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;

    const TILESET = 'tileset-alpha';

    const marker = {
        id: crypto.randomUUID(),
        tilesetId: TILESET,
        position: { lon: -43.2, lat: -22.9, height: 12.5 },
        properties: { name: 'Posto Avancado' },
        style: { color: '#ff0000', scale: 1.5 },
    };
    const measurement = {
        id: crypto.randomUUID(),
        tilesetId: TILESET,
        positions: [
            { lon: -43.2, lat: -22.9 },
            { lon: -43.1, lat: -22.8 },
        ],
        distance: 1523.7,
        properties: { unit: 'm' },
    };
    const viewshed = {
        id: crypto.randomUUID(),
        tilesetId: TILESET,
        position: { lon: -43.2, lat: -22.9, height: 30 },
        radius: 500,
        horizontalAngle: 120,
        verticalAngle: 60,
    };
    const camera = {
        id: crypto.randomUUID(),
        tilesetId: TILESET,
        position: { lon: -43.2, lat: -22.9, height: 800 },
        heading: 45,
        pitch: -30,
        roll: 0,
    };

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Cesium3D E2E' });
        const atlas = await createAtlas(api, { name: 'Cesium3D Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa 3D' });

        const ops = [
            createOperation('marker3d', 'create', marker.id, mapId, marker),
            createOperation('measurement3d', 'create', measurement.id, mapId, measurement),
            createOperation('viewshed3d', 'create', viewshed.id, mapId, viewshed),
            createOperation('cameraPosition3d', 'create', camera.id, mapId, camera),
        ];
        const res = await api.pushOperations(atlasId, ops);
        expect(res.serverVersion).toBeGreaterThan(0);
    }, 30000);

    /**
     * Pulls a full snapshot and returns the target map's cesium3d block.
     * @returns {Promise<Object>}
     */
    async function pullCesium3d() {
        const r = await api.pullSync(atlasId, 0);
        expect(r.snapshot).toBeTruthy();
        const maps = r.snapshot.maps || [];
        const m = maps.find((x) => x.id === mapId);
        expect(m, 'created map present in snapshot').toBeTruthy();
        return m.cesium3d;
    }

    it('snapshot exposes the frozen cesium3d hierarchy with all four buckets', async () => {
        const c = await pullCesium3d();
        expect(Array.isArray(c.markers)).toBe(true);
        expect(Array.isArray(c.measurements)).toBe(true);
        expect(Array.isArray(c.viewsheds)).toBe(true);
        expect(c.cameraPositions).toBeTypeOf('object');
        expect(Array.isArray(c.cameraPositions)).toBe(false);

        expect(c.markers).toHaveLength(1);
        expect(c.measurements).toHaveLength(1);
        expect(c.viewsheds).toHaveLength(1);
    });

    it('marker3d preserves tilesetId and flat fields inside the entry', async () => {
        const c = await pullCesium3d();
        const entry = c.markers[0];
        expect(entry.id).toBe(marker.id);
        expect(entry.tilesetId).toBe(TILESET);
        expect(entry.position).toEqual(marker.position);
        expect(entry.properties).toEqual(marker.properties);
        expect(entry.style).toEqual(marker.style);
    });

    it('measurement3d and viewshed3d carry their flat numeric fields', async () => {
        const c = await pullCesium3d();
        const meas = c.measurements[0];
        expect(meas.id).toBe(measurement.id);
        expect(meas.tilesetId).toBe(TILESET);
        expect(meas.distance).toBe(measurement.distance);
        expect(meas.positions).toEqual(measurement.positions);

        const vs = c.viewsheds[0];
        expect(vs.id).toBe(viewshed.id);
        expect(vs.tilesetId).toBe(TILESET);
        expect(vs.radius).toBe(viewshed.radius);
        expect(vs.horizontalAngle).toBe(viewshed.horizontalAngle);
        expect(vs.verticalAngle).toBe(viewshed.verticalAngle);
    });

    it('cameraPosition3d is keyed by tilesetId in cameraPositions map', async () => {
        const c = await pullCesium3d();
        const cam = c.cameraPositions[TILESET];
        expect(cam, 'camera keyed by tilesetId').toBeTruthy();
        expect(cam.id).toBe(camera.id);
        expect(cam.tilesetId).toBe(TILESET);
        expect(cam.heading).toBe(camera.heading);
        expect(cam.pitch).toBe(camera.pitch);
        expect(cam.roll).toBe(camera.roll);

        // Negative/edge: an unknown tileset key is not present.
        expect(c.cameraPositions['tileset-does-not-exist']).toBeUndefined();
    });

    it('does not leak entities into the wrong bucket', async () => {
        const c = await pullCesium3d();
        // Each typed op landed only in its own bucket (no cross-contamination).
        expect(c.markers.every((e) => e.id === marker.id)).toBe(true);
        expect(c.measurements.some((e) => e.id === marker.id)).toBe(false);
        expect(c.viewsheds.some((e) => e.id === marker.id)).toBe(false);
    });
});

// Path: tests/integration/frente-ocupada-antimeridiano.repro.test.js

/**
 * @fileoverview Regression test for the occupied front drawn across the antimeridian.
 *
 * ROOT CAUSE: `AddOccupiedFrontGeometry.destination` is the tool's own great-circle
 * projector (it does NOT use turf), and it returned `lng2 * 180 / Math.PI` raw. The
 * spherical formula happily produces 181.79 for a point 200 km east of 179.99, which
 * is off-globe: MapLibre renders it in an empty world copy, so the operator saw the
 * arm vanish. Every one of the five segments per arm is placed by this function, and
 * so are both arrowhead lines, so a single front straddling the seam lost most of its
 * drawing while `createOccupiedFrontGeometry` reported a full ten-segment geometry.
 *
 * NOT the bug, and worth recording because the backlog blamed it: `calculateBearing`
 * crosses the seam correctly and always has, for free, because deltaLng only ever
 * feeds sin/cos, which are periodic.
 *
 * FIX: wrap the longitude into [-180, 180]. The wrap is GUARDED by a range test so an
 * in-range longitude comes back bit-identical; the modulo round trip costs about
 * 1e-14 degrees, and this tool's callers compare positions.
 *
 * There is no stub here: the module's own trigonometry runs, and the distances are
 * measured with a haversine written in this file, so the check does not compose the
 * function it is checking.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tools', async () => {
    const { calculateDistance } = await import('@js/utilities/geometry-utils.js');

    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = properties; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});

const { default: AddOccupiedFrontGeometry } = await import(
    '@js/military_tools/occupied_front_tool/add_occupied_front_geometry.js'
);

const geom = new AddOccupiedFrontGeometry();

/**
 * Independent haversine (asin form, not the module's atan2 route).
 * @param {Array<number>} a - [lng, lat]
 * @param {Array<number>} b - [lng, lat]
 * @returns {number} Great-circle distance in metres on a 6371 km sphere
 */
function haversine(a, b) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad;
    const dLng = (b[0] - a[0]) * rad;
    const s = Math.sin(dLat / 2) ** 2
        + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(s));
}

/** Segments produced by one non-degenerate arm: 3 body + 2 arrow-head lines. */
const SEGMENTS_PER_ARM = 5;

describe('repro: frente ocupada no antimeridiano', () => {
    it('destination devolve longitude DENTRO de [-180, 180] atravessando a costura', () => {
        const leste = geom.destination([179.99, 0], 200000, 90);
        const oeste = geom.destination([-179.99, 0], 200000, 270);

        expect(leste[0]).toBeLessThanOrEqual(180);
        expect(leste[0]).toBeGreaterThanOrEqual(-180);
        expect(oeste[0]).toBeLessThanOrEqual(180);
        expect(oeste[0]).toBeGreaterThanOrEqual(-180);

        // The wrap must relabel the longitude, not move the point: measured from the
        // start, both targets are still 200 km away.
        expect(haversine([179.99, 0], leste)).toBeCloseTo(200000, 3);
        expect(haversine([-179.99, 0], oeste)).toBeCloseTo(200000, 3);
    });

    it('CONTROLE: longe da costura a longitude sai bit-idêntica (o wrap é guardado)', () => {
        expect(geom.destination([-43.2, -22.9], 0, 137)[0]).toBe(-43.2);
        expect(geom.destination([0, 0], 0, 0)[0]).toBe(0);
    });

    it('a frente inteira desenhada sobre a costura fica no globo', () => {
        // P1 just west of the antimeridian, both arms reaching across it.
        const p1 = [179.9, 0];
        const p2 = [-179.8, 0.1];
        const p3 = [-179.8, -0.1];

        const geometry = geom.createOccupiedFrontGeometry([p1, p2, p3]);

        expect(geometry.type).toBe('MultiLineString');
        expect(geometry.coordinates).toHaveLength(2 * SEGMENTS_PER_ARM);

        const todosOsPontos = geometry.coordinates.flat();
        expect(todosOsPontos.length).toBe(2 * SEGMENTS_PER_ARM * 2);
        for (const [lng, lat] of todosOsPontos) {
            expect(Number.isFinite(lng)).toBe(true);
            expect(lng).toBeGreaterThanOrEqual(-180);
            expect(lng).toBeLessThanOrEqual(180);
            expect(Math.abs(lat)).toBeLessThanOrEqual(90);
        }
    });

    it('CONTROLE: a mesma frente longe da costura tem a mesma contagem de segmentos', () => {
        // Rules out "the geometry got shorter and that is why nothing is off-globe".
        const geometry = geom.createOccupiedFrontGeometry([[0, 0], [0.1, 0.1], [0.1, -0.1]]);

        expect(geometry.coordinates).toHaveLength(2 * SEGMENTS_PER_ARM);
    });
});

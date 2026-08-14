// Path: tests/unit/phone-move-geometry.test.js

/**
 * @fileoverview Unit tests for the phone move-mode geometry translation.
 *
 * What these tests are here to catch (each one is a way the move can look like
 * it worked and be wrong):
 * - a translation that only handles the depth of a Point, so polygons with
 *   holes and multi-geometries move partially or not at all;
 * - a per-vertex longitude wrap, which tears a shape straddling the
 *   antimeridian into two halves on opposite edges of the world;
 * - a geometry that moves while `center` / `trajetoria` stay behind, which
 *   snaps a circle back the next time its radius is edited and a trajectory
 *   feature back on the next playback frame;
 * - a NaN sneaking into a persisted coordinate.
 */

import { describe, it, expect } from 'vitest';
import {
    translateFeature,
    translateGeometry,
    firstPosition,
    POSITION_PROPERTIES,
} from '@js/phone/phone-move-geometry.js';

/** Collect every position of a coordinates tree, in order. */
function flattenPositions(coordinates) {
    if (!Array.isArray(coordinates)) return [];
    if (typeof coordinates[0] === 'number') return [coordinates];
    return coordinates.flatMap(flattenPositions);
}

const feature = (geometry, properties = {}) => ({
    type: 'Feature',
    geometry,
    properties: { id: 'f-1', ...properties },
});

describe('firstPosition', () => {
    it('finds the position at every nesting depth', () => {
        expect(firstPosition({ type: 'Point', coordinates: [10, 20] })).toEqual([10, 20]);
        expect(firstPosition({ type: 'LineString', coordinates: [[1, 2], [3, 4]] })).toEqual([1, 2]);
        expect(firstPosition({ type: 'Polygon', coordinates: [[[5, 6], [7, 8]]] })).toEqual([5, 6]);
        expect(firstPosition({ type: 'MultiPolygon', coordinates: [[[[9, 10], [11, 12]]]] })).toEqual([9, 10]);
    });

    it('descends into a GeometryCollection', () => {
        const geometry = {
            type: 'GeometryCollection',
            geometries: [
                { type: 'LineString', coordinates: [[1, 2], [3, 4]] },
                { type: 'Point', coordinates: [5, 6] },
            ],
        };
        expect(firstPosition(geometry)).toEqual([1, 2]);
    });

    it('returns null for absent, empty or malformed geometry', () => {
        expect(firstPosition(null)).toBeNull();
        expect(firstPosition(undefined)).toBeNull();
        expect(firstPosition({ type: 'Point' })).toBeNull();
        expect(firstPosition({ type: 'LineString', coordinates: [] })).toBeNull();
        expect(firstPosition({ type: 'GeometryCollection', geometries: [] })).toBeNull();
    });
});

describe('translateGeometry — every geometry type', () => {
    const dLng = 1.5;
    const dLat = -0.25;

    it('translates a Point', () => {
        const moved = translateGeometry({ type: 'Point', coordinates: [-43.2, -22.9] }, dLng, dLat);
        expect(moved.coordinates).toEqual([-41.7, -23.15]);
    });

    it('translates a LineString', () => {
        const moved = translateGeometry(
            { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, dLng, dLat,
        );
        expect(moved.coordinates).toEqual([[1.5, -0.25], [2.5, 0.75]]);
    });

    it('translates a MultiPoint', () => {
        const moved = translateGeometry(
            { type: 'MultiPoint', coordinates: [[0, 0], [10, 10]] }, dLng, dLat,
        );
        expect(moved.coordinates).toEqual([[1.5, -0.25], [11.5, 9.75]]);
    });

    it('translates a Polygon INCLUDING its holes', () => {
        const polygon = {
            type: 'Polygon',
            coordinates: [
                [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],   // exterior ring
                [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],   // hole
            ],
        };
        const moved = translateGeometry(polygon, 10, 20);

        expect(moved.coordinates).toHaveLength(2);
        expect(moved.coordinates[0][0]).toEqual([10, 20]);
        // The hole must move by the same delta; a translation that only walks
        // the first ring leaves it behind and turns the polygon inside out.
        expect(moved.coordinates[1]).toEqual([
            [11, 21], [12, 21], [12, 22], [11, 22], [11, 21],
        ]);
    });

    it('translates a MultiLineString and a MultiPolygon', () => {
        const multiLine = translateGeometry(
            { type: 'MultiLineString', coordinates: [[[0, 0], [1, 0]], [[5, 5], [6, 5]]] }, 1, 1,
        );
        expect(multiLine.coordinates).toEqual([[[1, 1], [2, 1]], [[6, 6], [7, 6]]]);

        const multiPolygon = translateGeometry(
            {
                type: 'MultiPolygon',
                coordinates: [
                    [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                    [[[10, 10], [11, 10], [11, 11], [10, 10]]],
                ],
            }, 1, 1,
        );
        expect(multiPolygon.coordinates).toEqual([
            [[[1, 1], [2, 1], [2, 2], [1, 1]]],
            [[[11, 11], [12, 11], [12, 12], [11, 11]]],
        ]);
    });

    it('translates every member of a GeometryCollection', () => {
        const moved = translateGeometry({
            type: 'GeometryCollection',
            geometries: [
                { type: 'Point', coordinates: [0, 0] },
                { type: 'Polygon', coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] },
            ],
        }, 1, 1);

        expect(moved.geometries[0].coordinates).toEqual([1, 1]);
        expect(moved.geometries[1].coordinates[0][0]).toEqual([2, 2]);
    });

    it('preserves the altitude of a 3D position', () => {
        const moved = translateGeometry({ type: 'Point', coordinates: [1, 2, 350] }, 1, 1);
        expect(moved.coordinates).toEqual([2, 3, 350]);
    });

    it('does not mutate the input', () => {
        const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
        const snapshot = JSON.stringify(geometry);
        translateGeometry(geometry, 5, 5);
        expect(JSON.stringify(geometry)).toBe(snapshot);
    });
});

describe('translateGeometry — antimeridian', () => {
    it('wraps a point that crosses +180 back into range', () => {
        const moved = translateGeometry({ type: 'Point', coordinates: [179.5, 10] }, 1, 0);
        expect(moved.coordinates[0]).toBeCloseTo(-179.5, 9);
        expect(moved.coordinates[1]).toBe(10);
    });

    it('wraps a point that crosses -180 back into range', () => {
        const moved = translateGeometry({ type: 'Point', coordinates: [-179.5, 10] }, -1, 0);
        expect(moved.coordinates[0]).toBeCloseTo(179.5, 9);
    });

    it('handles a pan of several turns around the globe', () => {
        const moved = translateGeometry({ type: 'Point', coordinates: [0, 0] }, 725, 0);
        // 725 = two full turns (720) plus 5 degrees.
        expect(moved.coordinates[0]).toBeCloseTo(5, 9);
    });

    it('shifts a straddling shape as ONE piece instead of wrapping each vertex', () => {
        // The delta is chosen so that only PART of the ring crosses +180: the
        // anchor lands at 179.5 (in range) while the opposite side lands at
        // 181.5 (out of range). Per-vertex wrapping sends that side to -178.5
        // and tears the polygon into a band across the whole world; a uniform
        // shift (here, zero) keeps it in one piece.
        const ring = [[179, 0], [181, 0], [181, 1], [179, 1], [179, 0]];
        const moved = translateGeometry({ type: 'Polygon', coordinates: [ring] }, 0.5, 0);
        const longitudes = flattenPositions(moved.coordinates).map(p => p[0]);

        expect(longitudes[0]).toBeCloseTo(179.5, 9);
        expect(longitudes[1]).toBeCloseTo(181.5, 9);

        const span = Math.max(...longitudes) - Math.min(...longitudes);
        expect(span).toBeCloseTo(2, 9);
    });

    it('shifts the whole shape once when the anchor itself crosses', () => {
        const ring = [[179, 0], [181, 0], [181, 1], [179, 1], [179, 0]];
        const moved = translateGeometry({ type: 'Polygon', coordinates: [ring] }, 2, 0);
        const longitudes = flattenPositions(moved.coordinates).map(p => p[0]);

        // Anchor 179+2=181 wraps to -179, so the WHOLE ring shifts by -358.
        expect(longitudes[0]).toBeCloseTo(-179, 9);
        expect(longitudes[1]).toBeCloseTo(-177, 9);
        expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeCloseTo(2, 9);
    });

    it('keeps every longitude difference exact for any delta', () => {
        const ring = [[-10, 0], [30, 0], [170, 5], [-10, 0]];
        for (const delta of [0.5, 45, 179, 200, -400, 1000]) {
            const moved = translateGeometry({ type: 'LineString', coordinates: ring }, delta, 0);
            const longitudes = flattenPositions(moved.coordinates).map(p => p[0]);
            for (let i = 1; i < ring.length; i++) {
                expect(longitudes[i] - longitudes[i - 1]).toBeCloseTo(ring[i][0] - ring[i - 1][0], 9);
            }
        }
    });

    it('is the identity for a zero delta on in-range coordinates', () => {
        const geometry = { type: 'LineString', coordinates: [[-43.2, -22.9], [-43.1, -22.8]] };
        const moved = translateGeometry(geometry, 0, 0);
        expect(moved.coordinates).toEqual([[-43.2, -22.9], [-43.1, -22.8]]);
    });

    it('canonicalizes an already-unwrapped anchor even at zero delta', () => {
        // Documented behaviour, not an accident: the output anchor is ALWAYS in
        // [-180, 180], so a feature authored past the antimeridian comes back
        // canonical. It renders identically (MapLibre wraps) and it is what a
        // backend validating WGS84 bounds expects.
        const moved = translateGeometry({ type: 'Point', coordinates: [181, 10] }, 0, 0);
        expect(moved.coordinates[0]).toBeCloseTo(-179, 9);
        expect(moved.coordinates[1]).toBe(10);
    });
});

describe('translateGeometry — latitude bounds', () => {
    it('clamps at the poles instead of wrapping past them', () => {
        const north = translateGeometry({ type: 'Point', coordinates: [0, 80] }, 0, 30);
        expect(north.coordinates[1]).toBe(90);

        const south = translateGeometry({ type: 'Point', coordinates: [0, -80] }, 0, -30);
        expect(south.coordinates[1]).toBe(-90);
    });
});

describe('translateGeometry — refusals', () => {
    it('returns null for a non-finite delta', () => {
        const point = { type: 'Point', coordinates: [1, 2] };
        expect(translateGeometry(point, NaN, 0)).toBeNull();
        expect(translateGeometry(point, 0, Infinity)).toBeNull();
        expect(translateGeometry(point, undefined, 0)).toBeNull();
    });

    it('returns null rather than persisting NaN when a coordinate is unusable', () => {
        expect(translateGeometry({ type: 'Point', coordinates: [NaN, 2] }, 1, 1)).toBeNull();
        expect(translateGeometry({ type: 'Point', coordinates: [1, null] }, 1, 1)).toBeNull();
        expect(translateGeometry(
            { type: 'LineString', coordinates: [[0, 0], [1, 'x']] }, 1, 1,
        )).toBeNull();
    });

    it('returns null for absent or empty geometry', () => {
        expect(translateGeometry(null, 1, 1)).toBeNull();
        expect(translateGeometry({ type: 'Point', coordinates: [] }, 1, 1)).toBeNull();
        expect(translateGeometry({ type: 'Polygon', coordinates: [[]] }, 1, 1)).toBeNull();
    });
});

describe('translateFeature — position-bearing properties', () => {
    it('exposes the properties it moves', () => {
        expect([...POSITION_PROPERTIES]).toEqual(['center', 'trajetoria']);
    });

    it('moves the `center` of a circle with its geometry', () => {
        const circle = feature(
            { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
            { center: [0.5, 0.5], radius: 100 },
        );
        const moved = translateFeature(circle, 2, 3);

        expect(moved.geometry.coordinates[0][0]).toEqual([2, 3]);
        expect(moved.properties.center).toEqual([2.5, 3.5]);
        expect(moved.properties.radius).toBe(100);
    });

    it('accepts a JSON-string `center` and gives one back', () => {
        const circle = feature(
            { type: 'Point', coordinates: [0, 0] },
            { center: '[0,0]' },
        );
        const moved = translateFeature(circle, 1, 1);
        expect(moved.properties.center).toBe('[1,1]');
    });

    it('applies the SAME antimeridian shift to geometry and center', () => {
        const circle = feature(
            { type: 'Point', coordinates: [179, 0] },
            { center: [179, 0] },
        );
        const moved = translateFeature(circle, 2, 0);
        expect(moved.geometry.coordinates[0]).toBeCloseTo(-179, 9);
        expect(moved.properties.center[0]).toBeCloseTo(-179, 9);
    });

    it('moves trajectory keypoints, keeping their timestamps', () => {
        const symbol = feature(
            { type: 'Point', coordinates: [0, 0] },
            {
                trajetoria: [
                    { t: 1000, lng: 0, lat: 0 },
                    { t: 2000, lng: 1, lat: 1 },
                ],
            },
        );
        const moved = translateFeature(symbol, 5, -5);

        expect(moved.properties.trajetoria).toEqual([
            { t: 1000, lng: 5, lat: -5 },
            { t: 2000, lng: 6, lat: -4 },
        ]);
    });

    it('refuses the whole move when a position-bearing property is broken', () => {
        const brokenCenter = feature(
            { type: 'Point', coordinates: [0, 0] },
            { center: 'nao-e-json' },
        );
        expect(translateFeature(brokenCenter, 1, 1)).toBeNull();

        const brokenTrajectory = feature(
            { type: 'Point', coordinates: [0, 0] },
            { trajetoria: [{ t: 1, lng: 'x', lat: 0 }] },
        );
        expect(translateFeature(brokenTrajectory, 1, 1)).toBeNull();
    });

    it('ignores an absent or null position-bearing property', () => {
        const plain = feature({ type: 'Point', coordinates: [0, 0] }, { center: null });
        const moved = translateFeature(plain, 1, 1);
        expect(moved.geometry.coordinates).toEqual([1, 1]);
        expect(moved.properties.center).toBeNull();
    });

    it('preserves every other property and does not mutate the input', () => {
        const original = feature(
            { type: 'Point', coordinates: [0, 0] },
            { nome: 'Posto', visivel: true, bloqueado: false },
        );
        const snapshot = JSON.stringify(original);

        const moved = translateFeature(original, 1, 1);

        expect(moved.properties.nome).toBe('Posto');
        expect(moved.properties.visivel).toBe(true);
        expect(moved.type).toBe('Feature');
        expect(JSON.stringify(original)).toBe(snapshot);
    });

    it('returns null for a feature with no usable geometry', () => {
        expect(translateFeature(null, 1, 1)).toBeNull();
        expect(translateFeature({ type: 'Feature', properties: {} }, 1, 1)).toBeNull();
        expect(translateFeature(feature({ type: 'Point', coordinates: [0, 0] }), NaN, 1)).toBeNull();
    });
});

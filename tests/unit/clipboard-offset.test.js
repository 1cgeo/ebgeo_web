import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    extractGeometryCoordinates,
    computePasteAnchor,
    calculateOffsetToTarget
} from '../../src/js/tool_manager/clipboard-offset.js';

const pointFeature = (lng, lat) => ({
    geometry: { type: 'Point', coordinates: [lng, lat] }
});

describe('extractGeometryCoordinates', () => {
    it('returns the single pair of a Point', () => {
        expect(extractGeometryCoordinates({ type: 'Point', coordinates: [10, 20] }))
            .toEqual([[10, 20]]);
    });

    it('returns the vertices of a LineString and a MultiPoint', () => {
        const coords = [[0, 0], [1, 1], [2, 2]];
        expect(extractGeometryCoordinates({ type: 'LineString', coordinates: coords }))
            .toEqual(coords);
        expect(extractGeometryCoordinates({ type: 'MultiPoint', coordinates: coords }))
            .toEqual(coords);
    });

    it('flattens a Polygon WITH a hole (both rings)', () => {
        const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
        const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
        const out = extractGeometryCoordinates({ type: 'Polygon', coordinates: [outer, hole] });
        expect(out).toHaveLength(outer.length + hole.length);
        expect(out).toContainEqual([6, 6]);
    });

    it('flattens a MultiLineString and a MultiPolygon to the same depth', () => {
        expect(extractGeometryCoordinates({
            type: 'MultiLineString',
            coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]
        })).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);

        expect(extractGeometryCoordinates({
            type: 'MultiPolygon',
            coordinates: [[[[0, 0], [1, 0], [0, 1], [0, 0]]], [[[5, 5], [6, 5], [5, 6], [5, 5]]]]
        })).toEqual([[0, 0], [1, 0], [0, 1], [0, 0], [5, 5], [6, 5], [5, 6], [5, 5]]);
    });

    it('recurses into a GeometryCollection', () => {
        expect(extractGeometryCoordinates({
            type: 'GeometryCollection',
            geometries: [
                { type: 'Point', coordinates: [1, 2] },
                { type: 'LineString', coordinates: [[3, 4], [5, 6]] }
            ]
        })).toEqual([[1, 2], [3, 4], [5, 6]]);
    });

    it('returns [] for anything unusable instead of throwing', () => {
        expect(extractGeometryCoordinates(null)).toEqual([]);
        expect(extractGeometryCoordinates(undefined)).toEqual([]);
        expect(extractGeometryCoordinates({})).toEqual([]);
        expect(extractGeometryCoordinates({ type: 'Point' })).toEqual([]);
        expect(extractGeometryCoordinates({ type: 'Nonsense', coordinates: [[1, 2]] })).toEqual([]);
        expect(extractGeometryCoordinates({ type: 'GeometryCollection' })).toEqual([]);
    });
});

describe('computePasteAnchor', () => {
    it('returns the point itself for a single point feature', () => {
        expect(computePasteAnchor([pointFeature(10, 20)])).toEqual([10, 20]);
    });

    it('returns the bbox center of a rectangle (not its first vertex)', () => {
        const rectangle = {
            geometry: {
                type: 'Polygon',
                coordinates: [[[0, 0], [10, 0], [10, 4], [0, 4], [0, 0]]]
            }
        };
        expect(computePasteAnchor([rectangle])).toEqual([5, 2]);
    });

    it('returns the center of the UNION of two distant features', () => {
        const anchor = computePasteAnchor([pointFeature(-10, -10), pointFeature(30, 50)]);
        expect(anchor).toEqual([10, 20]);
    });

    it('unwraps across the antimeridian: 179.9 and -179.9 anchor near ±180, never 0', () => {
        const anchor = computePasteAnchor([pointFeature(179.9, 0), pointFeature(-179.9, 0)]);
        expect(Math.abs(anchor[0])).toBeCloseTo(180, 9);
        expect(anchor[1]).toBe(0);
    });

    it('anchors an antimeridian pair asymmetrically when it is not centered on 180', () => {
        // 179.0 and -179.5 span 1.5 degrees; the middle sits at 179.75.
        const anchor = computePasteAnchor([pointFeature(179.0, 0), pointFeature(-179.5, 0)]);
        expect(anchor[0]).toBeCloseTo(179.75, 9);
    });

    it('returns null for an empty or non-array set', () => {
        expect(computePasteAnchor([])).toBeNull();
        expect(computePasteAnchor(null)).toBeNull();
        expect(computePasteAnchor(undefined)).toBeNull();
    });

    it('returns null when no feature carries a usable geometry', () => {
        expect(computePasteAnchor([{}, { geometry: null }, { geometry: {} }])).toBeNull();
    });

    it('ignores NaN / Infinity coordinates instead of poisoning the anchor', () => {
        const dirty = {
            geometry: {
                type: 'LineString',
                coordinates: [[NaN, 5], [10, 20], [Infinity, 3], [20, 30], [5, -Infinity]]
            }
        };
        expect(computePasteAnchor([dirty])).toEqual([15, 25]);
    });

    it('returns null when EVERY coordinate is non-finite', () => {
        const dirty = {
            geometry: { type: 'LineString', coordinates: [[NaN, NaN], [Infinity, 0]] }
        };
        expect(computePasteAnchor([dirty])).toBeNull();
    });
});

describe('calculateOffsetToTarget', () => {
    it('returns null when the anchor is missing (empty clipboard set)', () => {
        expect(calculateOffsetToTarget(null, [1, 2])).toBeNull();
        expect(calculateOffsetToTarget(undefined, [1, 2])).toBeNull();
    });

    it('returns null for an unusable target', () => {
        expect(calculateOffsetToTarget([1, 2], null)).toBeNull();
        expect(calculateOffsetToTarget([1, 2], [NaN, 3])).toBeNull();
        expect(calculateOffsetToTarget([1, 2], [3, Infinity])).toBeNull();
        expect(calculateOffsetToTarget([NaN, 2], [3, 4])).toBeNull();
    });

    it('is the plain difference away from the antimeridian', () => {
        expect(calculateOffsetToTarget([10, 20], [15, 25])).toEqual({ dx: 5, dy: 5 });
        expect(calculateOffsetToTarget([15, 25], [10, 20])).toEqual({ dx: -5, dy: -5 });
    });

    it('takes the SHORT way across the antimeridian (dx ≈ 1, not -359)', () => {
        const offset = calculateOffsetToTarget([179.5, 0], [-179.5, 0]);
        expect(offset.dx).toBeCloseTo(1, 9);
        expect(offset.dy).toBe(0);
    });

    it('is zero when the anchor already sits on the target', () => {
        expect(calculateOffsetToTarget([-45.3, -23.7], [-45.3, -23.7])).toEqual({ dx: 0, dy: 0 });
    });

    it('keeps latitude untouched by the longitude wrap', () => {
        expect(calculateOffsetToTarget([0, -80], [0, 80])).toEqual({ dx: 0, dy: 160 });
    });
});

describe('anchor/offset round trip', () => {
    // Longitudes are kept inside ±45 so translated coordinates never leave
    // [-180, 180]: the property under test is the anchoring, not the wrap.
    const lng = () => fc.double({ min: -45, max: 45, noNaN: true });
    const lat = () => fc.double({ min: -60, max: 60, noNaN: true });

    const featureArb = fc.record({
        geometry: fc.record({
            type: fc.constant('LineString'),
            coordinates: fc.array(fc.tuple(lng(), lat()), { minLength: 1, maxLength: 8 })
        })
    });

    it('translating the set by the computed offset lands its anchor on the target', () => {
        fc.assert(fc.property(
            fc.array(featureArb, { minLength: 1, maxLength: 5 }),
            lng(), lat(),
            (features, targetLng, targetLat) => {
                const anchor = computePasteAnchor(features);
                fc.pre(anchor !== null);

                const target = [targetLng, targetLat];
                const offset = calculateOffsetToTarget(anchor, target);
                expect(offset).not.toBeNull();

                const translated = features.map(f => ({
                    geometry: {
                        ...f.geometry,
                        coordinates: f.geometry.coordinates.map(
                            ([x, y]) => [x + offset.dx, y + offset.dy]
                        )
                    }
                }));

                const moved = computePasteAnchor(translated);
                expect(moved[0]).toBeCloseTo(target[0], 8);
                expect(moved[1]).toBeCloseTo(target[1], 8);
            }
        ));
    });

    it('a zero offset leaves the anchor where it was (idempotence)', () => {
        fc.assert(fc.property(
            fc.array(featureArb, { minLength: 1, maxLength: 5 }),
            (features) => {
                const anchor = computePasteAnchor(features);
                fc.pre(anchor !== null);
                expect(calculateOffsetToTarget(anchor, anchor)).toEqual({ dx: 0, dy: 0 });
            }
        ));
    });
});

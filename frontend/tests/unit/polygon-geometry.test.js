import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

// add_polygon_geometry imports BaseGeometry from the tool_manager barrel
// (resolved via the `@tools` alias), which pulls in DOM/MapLibre-coupled
// modules. Mock the barrel with a trivial BaseGeometry that supplies a real
// Haversine `calculateDistance`, so the pure geometry math (perimeter, minimum
// distances, point-proximity) works in the `node` environment.
const EARTH_RADIUS_METERS = 6371000;
const DEG_TO_RAD = Math.PI / 180;

function haversine(point1, point2) {
    const lat1Rad = point1[1] * DEG_TO_RAD;
    const lat2Rad = point2[1] * DEG_TO_RAD;
    const deltaLat = (point2[1] - point1[1]) * DEG_TO_RAD;
    const deltaLng = (point2[0] - point1[0]) * DEG_TO_RAD;
    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}

vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance(p1, p2) { return haversine(p1, p2); }
    },
}));

const { default: AddPolygonGeometry } = await import(
    '../../src/js/draw_tools/polygon_tool/add_polygon_geometry.js'
);

const geom = new AddPolygonGeometry();

// A simple ~1° triangle around the equator; all segments far exceed 1 m.
const TRI = [[0, 0], [1, 0], [0, 1]];

// ============================================================================
// validate
// ============================================================================

describe('AddPolygonGeometry.validate', () => {
    it('accepts a valid triangle (>= 3 finite points)', () => {
        expect(geom.validate(TRI)).toBe(true);
    });

    it('rejects null / non-array', () => {
        expect(geom.validate(null)).toBe(false);
        expect(geom.validate(undefined)).toBe(false);
        expect(geom.validate('nope')).toBe(false);
        expect(geom.validate({})).toBe(false);
    });

    it('rejects fewer than MIN_POINTS (3) coordinates', () => {
        expect(geom.validate([])).toBe(false);
        expect(geom.validate([[0, 0]])).toBe(false);
        expect(geom.validate([[0, 0], [1, 1]])).toBe(false);
    });

    it('rejects points that are not arrays of length >= 2', () => {
        expect(geom.validate([[0, 0], [1, 0], [1]])).toBe(false);
        expect(geom.validate([[0, 0], [1, 0], 5])).toBe(false);
        expect(geom.validate([[0, 0], [1, 0], null])).toBe(false);
    });

    it('rejects NaN coordinates', () => {
        expect(geom.validate([[0, 0], [1, 0], [NaN, 1]])).toBe(false);
        expect(geom.validate([[0, 0], [1, 0], [0, NaN]])).toBe(false);
    });

    it('rejects non-number coordinate values (strings)', () => {
        expect(geom.validate([[0, 0], [1, 0], ['0', 1]])).toBe(false);
    });

    // BUG FIX: previously used !isNaN(x), and isNaN(Infinity) === false, so
    // Infinity / -Infinity passed validation. Now guarded with Number.isFinite.
    it('rejects Infinity / -Infinity coordinates (regression)', () => {
        expect(geom.validate([[0, 0], [1, 0], [Infinity, 1]])).toBe(false);
        expect(geom.validate([[0, 0], [1, 0], [0, Infinity]])).toBe(false);
        expect(geom.validate([[0, 0], [1, 0], [-Infinity, 1]])).toBe(false);
    });

    it('accepts extra ordinates (e.g. [lng, lat, z]) as long as the first two are finite', () => {
        expect(geom.validate([[0, 0, 100], [1, 0, 50], [0, 1, 0]])).toBe(true);
    });
});

// ============================================================================
// isPolygonClosed
// ============================================================================

describe('AddPolygonGeometry.isPolygonClosed', () => {
    it('returns false when the first and last points differ', () => {
        expect(geom.isPolygonClosed(TRI)).toBe(false);
    });

    it('returns true when first === last', () => {
        expect(geom.isPolygonClosed([[0, 0], [1, 0], [0, 1], [0, 0]])).toBe(true);
    });

    it('returns false for fewer than 2 points', () => {
        expect(geom.isPolygonClosed([])).toBe(false);
        expect(geom.isPolygonClosed([[0, 0]])).toBe(false);
    });
});

// ============================================================================
// createPolygonGeometry / generate
// ============================================================================

describe('AddPolygonGeometry.createPolygonGeometry', () => {
    it('returns a GeoJSON Polygon with a single ring', () => {
        const g = geom.createPolygonGeometry(TRI);
        expect(g.type).toBe('Polygon');
        expect(Array.isArray(g.coordinates)).toBe(true);
        expect(g.coordinates).toHaveLength(1);
    });

    it('auto-closes the ring (first === last) without mutating the input', () => {
        const input = [[0, 0], [1, 0], [0, 1]];
        const g = geom.createPolygonGeometry(input);
        const ring = g.coordinates[0];
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        expect(ring).toHaveLength(4); // 3 vertices + closing point
        expect(input).toHaveLength(3); // input untouched
    });

    it('does not double-close an already-closed ring', () => {
        const closed = [[0, 0], [1, 0], [0, 1], [0, 0]];
        const ring = geom.createPolygonGeometry(closed).coordinates[0];
        expect(ring).toHaveLength(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it('throws on invalid coordinates', () => {
        expect(() => geom.createPolygonGeometry([[0, 0]])).toThrow(/Invalid coordinates/);
        expect(() => geom.createPolygonGeometry([[0, 0], [1, 0], [Infinity, 1]]))
            .toThrow(/Invalid coordinates/);
    });

    it('generate() delegates to createPolygonGeometry', () => {
        expect(geom.generate(TRI)).toEqual(geom.createPolygonGeometry(TRI));
    });
});

// ============================================================================
// calculateMidpoint
// ============================================================================

describe('AddPolygonGeometry.calculateMidpoint', () => {
    it('averages the two coordinates component-wise', () => {
        expect(geom.calculateMidpoint([0, 0], [2, 4])).toEqual([1, 2]);
        expect(geom.calculateMidpoint([-10, 10], [10, -10])).toEqual([0, 0]);
    });

    it('property: midpoint lies on the segment endpoints average', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            (ax, ay, bx, by) => {
                const m = geom.calculateMidpoint([ax, ay], [bx, by]);
                expect(m[0]).toBeCloseTo((ax + bx) / 2, 9);
                expect(m[1]).toBeCloseTo((ay + by) / 2, 9);
            }
        ));
    });
});

// ============================================================================
// validateMinimumDistances / isPointTooClose
// ============================================================================

describe('AddPolygonGeometry.validateMinimumDistances', () => {
    it('returns true when every segment (incl. closing) exceeds the minimum', () => {
        expect(geom.validateMinimumDistances(TRI)).toBe(true);
    });

    it('returns false when two consecutive points are identical', () => {
        expect(geom.validateMinimumDistances([[0, 0], [0, 0], [1, 1]])).toBe(false);
    });

    it('checks the closing segment too (last point identical to first)', () => {
        // first === last → closing segment has zero length → too short
        expect(geom.validateMinimumDistances([[0, 0], [1, 0], [0, 0]])).toBe(false);
    });

    it('returns false when points are sub-metre apart', () => {
        // ~1e-6 deg ≈ 0.11 m, below the 1 m minimum
        expect(geom.validateMinimumDistances([[0, 0], [0.000001, 0], [0, 1]])).toBe(false);
    });
});

describe('AddPolygonGeometry.isPointTooClose', () => {
    it('returns false when there are no existing points', () => {
        expect(geom.isPointTooClose([0, 0], [])).toBe(false);
    });

    it('returns true when the new point coincides with the last existing point', () => {
        expect(geom.isPointTooClose([5, 5], [[0, 0], [5, 5]])).toBe(true);
    });

    it('returns false when the new point is far from the last existing point', () => {
        expect(geom.isPointTooClose([10, 10], [[0, 0], [1, 1]])).toBe(false);
    });

    it('only compares against the LAST existing point', () => {
        // new point equals the FIRST existing point but is far from the last → not too close
        expect(geom.isPointTooClose([0, 0], [[0, 0], [10, 10]])).toBe(false);
    });
});

// ============================================================================
// calculatePerimeter
// ============================================================================

describe('AddPolygonGeometry.calculatePerimeter', () => {
    it('returns 0 for invalid coordinates', () => {
        expect(geom.calculatePerimeter(null)).toBe(0);
        expect(geom.calculatePerimeter([[0, 0]])).toBe(0);
        expect(geom.calculatePerimeter([[0, 0], [1, 0], [Infinity, 1]])).toBe(0);
    });

    it('sums all segment lengths including the closing segment', () => {
        const p = geom.calculatePerimeter(TRI);
        const expected =
            haversine(TRI[0], TRI[1]) +
            haversine(TRI[1], TRI[2]) +
            haversine(TRI[2], TRI[0]);
        expect(p).toBeCloseTo(expected, 6);
        expect(p).toBeGreaterThan(0);
    });

    it('is invariant to ring orientation (CW vs CCW)', () => {
        const cw = TRI;
        const ccw = [...TRI].reverse();
        expect(geom.calculatePerimeter(cw)).toBeCloseTo(geom.calculatePerimeter(ccw), 6);
    });

    it('property: perimeter is finite and >= 0 for valid rings', () => {
        fc.assert(fc.property(
            fc.array(
                fc.tuple(
                    fc.double({ min: -10, max: 10, noNaN: true }),
                    fc.double({ min: -10, max: 10, noNaN: true })
                ),
                { minLength: 3, maxLength: 8 }
            ),
            (coords) => {
                const p = geom.calculatePerimeter(coords);
                expect(Number.isFinite(p)).toBe(true);
                expect(p).toBeGreaterThanOrEqual(0);
            }
        ));
    });
});

// ============================================================================
// removeVertexAtIndex
// ============================================================================

describe('AddPolygonGeometry.removeVertexAtIndex', () => {
    const quad = [[0, 0], [1, 0], [1, 1], [0, 1]];

    it('removes the vertex at the given index without mutating the input', () => {
        const result = geom.removeVertexAtIndex(quad, 1);
        expect(result).toEqual([[0, 0], [1, 1], [0, 1]]);
        expect(quad).toHaveLength(4); // input untouched
    });

    it('returns null when removal would drop below MIN_POINTS (3)', () => {
        expect(geom.removeVertexAtIndex(TRI, 0)).toBeNull();
    });

    it('returns null for out-of-range / negative index', () => {
        expect(geom.removeVertexAtIndex(quad, -1)).toBeNull();
        expect(geom.removeVertexAtIndex(quad, 4)).toBeNull();
        expect(geom.removeVertexAtIndex(quad, 99)).toBeNull();
    });

    it('returns null for missing coordinates', () => {
        expect(geom.removeVertexAtIndex(null, 0)).toBeNull();
    });
});

// ============================================================================
// insertVertexAtIndex
// ============================================================================

describe('AddPolygonGeometry.insertVertexAtIndex', () => {
    const quad = [[0, 0], [1, 0], [1, 1], [0, 1]];

    it('inserts at the given index without mutating the input', () => {
        const result = geom.insertVertexAtIndex(quad, 1, [0.5, 0]);
        expect(result).toEqual([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]]);
        expect(quad).toHaveLength(4); // input untouched
    });

    it('inserts at the front for index 0', () => {
        const result = geom.insertVertexAtIndex(quad, 0, [9, 9]);
        expect(result[0]).toEqual([9, 9]);
        expect(result).toHaveLength(5);
    });

    it('inserts at the end for index === length', () => {
        const result = geom.insertVertexAtIndex(quad, quad.length, [9, 9]);
        expect(result[result.length - 1]).toEqual([9, 9]);
        expect(result).toHaveLength(5);
    });

    // BUG FIX: previously no bounds check, so a negative index made splice()
    // insert relative to the end and an over-large index just appended, both
    // silently. Now the index is clamped to [0, length].
    it('clamps a negative index to the front (regression)', () => {
        const result = geom.insertVertexAtIndex(quad, -5, [9, 9]);
        expect(result[0]).toEqual([9, 9]);
        expect(result).toHaveLength(5);
    });

    it('clamps an over-large index to the end (regression)', () => {
        const result = geom.insertVertexAtIndex(quad, 999, [9, 9]);
        expect(result[result.length - 1]).toEqual([9, 9]);
        expect(result).toHaveLength(5);
    });

    it('treats a non-finite index as append (regression)', () => {
        const resInf = geom.insertVertexAtIndex(quad, Infinity, [9, 9]);
        expect(resInf[resInf.length - 1]).toEqual([9, 9]);
        const resNaN = geom.insertVertexAtIndex(quad, NaN, [7, 7]);
        expect(resNaN[resNaN.length - 1]).toEqual([7, 7]);
    });

    it('truncates a fractional index before inserting (regression)', () => {
        const result = geom.insertVertexAtIndex(quad, 1.9, [5, 5]);
        // trunc(1.9) === 1 → inserted at position 1
        expect(result[1]).toEqual([5, 5]);
    });

    it('returns null for non-array coordinates (regression)', () => {
        expect(geom.insertVertexAtIndex(null, 0, [0, 0])).toBeNull();
    });
});

// ============================================================================
// updateFromHandle
// ============================================================================

describe('AddPolygonGeometry.updateFromHandle', () => {
    const baseFeature = (coords) => ({
        properties: { id: 'p1', baseCoordinates: coords },
    });
    const quad = [[0, 0], [1, 0], [1, 1], [0, 1]];

    it('returns null for invalid baseCoordinates', () => {
        expect(geom.updateFromHandle('vertex', [0, 0], { properties: { baseCoordinates: 42 } }, 0))
            .toBeNull();
    });

    it('returns null for a missing/invalid handleType', () => {
        expect(geom.updateFromHandle(null, [0, 0], baseFeature(quad), 0)).toBeNull();
        expect(geom.updateFromHandle(123, [0, 0], baseFeature(quad), 0)).toBeNull();
    });

    it('moves an existing vertex (vertex + index)', () => {
        const r = geom.updateFromHandle('vertex', [0.25, 0.25], baseFeature(quad), 0);
        expect(r).not.toBeNull();
        expect(r.baseCoordinates[0]).toEqual([0.25, 0.25]);
        expect(r.baseCoordinates).toHaveLength(4); // moved, not inserted
        expect(r.geometry.type).toBe('Polygon');
    });

    it('moves an existing vertex via the legacy "vertex-N" format', () => {
        const r = geom.updateFromHandle('vertex-2', [9, 9], baseFeature(quad));
        expect(r.baseCoordinates[2]).toEqual([9, 9]);
        expect(r.baseCoordinates).toHaveLength(4);
    });

    it('inserts a new vertex for a non-closing midpoint (segment i -> i+1)', () => {
        // segment 0 is between vertex 0 and vertex 1 → insert at index 1
        const r = geom.updateFromHandle('midpoint', [0.5, 0], baseFeature(quad), 0);
        expect(r.baseCoordinates).toHaveLength(5);
        expect(r.baseCoordinates[1]).toEqual([0.5, 0]);
    });

    it('inserts a new vertex via the legacy "midpoint-N" format', () => {
        const r = geom.updateFromHandle('midpoint-1', [1, 0.5], baseFeature(quad));
        expect(r.baseCoordinates).toHaveLength(5);
        expect(r.baseCoordinates[2]).toEqual([1, 0.5]);
    });

    it('returns null when the resulting segments are too short', () => {
        // Move vertex 1 on top of vertex 0 → zero-length segment
        const r = geom.updateFromHandle('vertex', [0, 0], baseFeature(quad), 1);
        expect(r).toBeNull();
    });

    // DOCUMENTED CURRENT BEHAVIOR (not changed): for the closing segment
    // (handleIndex === length - 1), insertIndex = (length-1+1) % length = 0, so
    // the new vertex is spliced in at index 0 (the FRONT of the open ring), not
    // appended at the end. In the auto-closed ring this still places the new
    // vertex on the closing edge (between the last and first vertices), so the
    // resulting polygon is geometrically valid — only the stored vertex order
    // differs from an append. Pinned here to lock the behavior.
    it('closing-segment midpoint inserts the new vertex at index 0 (documented)', () => {
        const r = geom.updateFromHandle('midpoint', [-0.5, 0.5], baseFeature(quad), quad.length - 1);
        expect(r).not.toBeNull();
        expect(r.baseCoordinates).toHaveLength(5);
        expect(r.baseCoordinates[0]).toEqual([-0.5, 0.5]);
        // The auto-closed geometry remains a valid closed ring.
        const ring = r.geometry.coordinates[0];
        expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it('parses string baseCoordinates (JSON) before editing', () => {
        const r = geom.updateFromHandle('vertex', [2, 2], baseFeature(JSON.stringify(quad)), 0);
        expect(r.baseCoordinates[0]).toEqual([2, 2]);
    });
});

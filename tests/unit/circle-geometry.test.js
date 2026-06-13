import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// add_circle_geometry imports BaseGeometry from the `../../tool_manager` barrel,
// which pulls in DOM/MapLibre-coupled modules. Mock it with a trivial BaseGeometry
// so the pure geometry math can be tested in the `node` environment.
//
// The source uses the *relative* specifier `../../tool_manager`, so the mock id
// must match that resolved module (the same file `@tools` aliases to). Mocking
// the alias too keeps this robust if the import path is ever normalized.
// NOTE: vi.mock is hoisted above module scope, so the factory must be inlined.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
        // Overridable in tests that exercise handle/preview math.
        calculateDistance() { return 0; }
    },
}));
vi.mock('../../src/js/tool_manager/index.js', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = { ...properties }; }
        calculateDistance() { return 0; }
    },
}));

const { default: AddCircleGeometry } = await import(
    '../../src/js/draw_tools/circle_tool/add_circle_geometry.js'
);

// Equirectangular projection constant used by the source.
const M_PER_DEG = 111320;

let geom;
beforeEach(() => {
    geom = new AddCircleGeometry();
});

// ============================================================================
// validate
// ============================================================================

describe('AddCircleGeometry.validate', () => {
    it('accepts a valid center and radius', () => {
        expect(geom.validate([0, 0], 1000)).toBe(true);
    });

    it('accepts the 10 m radius boundary', () => {
        expect(geom.validate([0, 0], 10)).toBe(true);
    });

    it('rejects radius just below the 10 m minimum', () => {
        expect(geom.validate([0, 0], 9.999)).toBe(false);
    });

    it('rejects a null/undefined center', () => {
        expect(geom.validate(null, 1000)).toBe(false);
        expect(geom.validate(undefined, 1000)).toBe(false);
    });

    it('rejects a non-array center', () => {
        expect(geom.validate('0,0', 1000)).toBe(false);
        expect(geom.validate({ 0: 0, 1: 0, length: 2 }, 1000)).toBe(false);
    });

    it('rejects a center with fewer than 2 elements', () => {
        expect(geom.validate([0], 1000)).toBe(false);
        expect(geom.validate([], 1000)).toBe(false);
    });

    // BUG FIX: validate previously accepted radius NaN/Infinity because
    // `typeof NaN === 'number'` and `NaN < 10` / `Infinity < 10` are both false.
    it('rejects radius NaN (regression: non-finite radius)', () => {
        expect(geom.validate([0, 0], NaN)).toBe(false);
    });
    it('rejects radius +Infinity (regression: non-finite radius)', () => {
        expect(geom.validate([0, 0], Infinity)).toBe(false);
    });
    it('rejects radius -Infinity', () => {
        expect(geom.validate([0, 0], -Infinity)).toBe(false);
    });

    it('rejects a non-number radius', () => {
        expect(geom.validate([0, 0], '1000')).toBe(false);
        expect(geom.validate([0, 0], null)).toBe(false);
        expect(geom.validate([0, 0], undefined)).toBe(false);
    });

    // BUG FIX: a center built from strings used to pass because only
    // Array.isArray + length were checked.
    it('rejects a center made of strings (regression: numeric center)', () => {
        expect(geom.validate(['0', '0'], 1000)).toBe(false);
    });
    it('rejects a center with NaN/Infinity coordinates', () => {
        expect(geom.validate([NaN, 0], 1000)).toBe(false);
        expect(geom.validate([0, Infinity], 1000)).toBe(false);
    });

    it('property: never accepts a non-finite radius', () => {
        fc.assert(fc.property(
            fc.constantFrom(NaN, Infinity, -Infinity),
            (r) => {
                expect(geom.validate([0, 0], r)).toBe(false);
            }
        ));
    });

    it('property: accepts any finite center with radius >= 10', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -85, max: 85, noNaN: true }),
            fc.double({ min: 10, max: 1e6, noNaN: true }),
            (lng, lat, r) => {
                expect(geom.validate([lng, lat], r)).toBe(true);
            }
        ));
    });
});

// ============================================================================
// generateCircleGeometry — projection (M_PER_DEG, cosLat), closed ring
// ============================================================================

describe('AddCircleGeometry.generateCircleGeometry', () => {
    it('returns a GeoJSON Polygon', () => {
        const g = geom.generateCircleGeometry([0, 0], 1000);
        expect(g.type).toBe('Polygon');
        expect(Array.isArray(g.coordinates)).toBe(true);
        expect(Array.isArray(g.coordinates[0])).toBe(true);
    });

    it('produces 65 vertices (64 segments, ring closed)', () => {
        const ring = geom.generateCircleGeometry([0, 0], 1000).coordinates[0];
        expect(ring.length).toBe(65);
    });

    it('closes the ring (first === last vertex)', () => {
        const ring = geom.generateCircleGeometry([10, 20], 1500).coordinates[0];
        expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it('first vertex (angle 0) is due east of center by radius/cosLat degrees', () => {
        const center = [0, 0];
        const radius = 1000;
        const ring = geom.generateCircleGeometry(center, radius).coordinates[0];
        const expectedLng = center[0] + (radius / M_PER_DEG) / Math.cos(center[1] * Math.PI / 180);
        expect(ring[0][0]).toBeCloseTo(expectedLng, 9);
        expect(ring[0][1]).toBeCloseTo(center[1], 9);
    });

    it('vertex at angle 90deg is due north by radius/M_PER_DEG degrees', () => {
        const center = [0, 0];
        const radius = 1000;
        const ring = geom.generateCircleGeometry(center, radius).coordinates[0];
        // i = 16 of 64 => angle 90deg.
        const north = ring[16];
        expect(north[0]).toBeCloseTo(center[0], 6);
        expect(north[1]).toBeCloseTo(center[1] + radius / M_PER_DEG, 9);
    });

    it('applies cosLat longitude scaling (wider lng span at high latitude)', () => {
        const radius = 1000;
        const ringEq = geom.generateCircleGeometry([0, 0], radius).coordinates[0];
        const ringHigh = geom.generateCircleGeometry([0, 60], radius).coordinates[0];
        // East offset in degrees = radius / M_PER_DEG / cos(lat).
        const dxEq = ringEq[0][0] - 0;
        const dxHigh = ringHigh[0][0] - 0;
        // cos(60deg) = 0.5 -> offset doubles relative to the equator.
        expect(dxHigh).toBeCloseTo(dxEq / Math.cos(60 * Math.PI / 180), 9);
        expect(dxHigh).toBeGreaterThan(dxEq);
    });

    it('property: every vertex sits ~radius metres from the centre (equator)', () => {
        const center = [0, 0];
        fc.assert(fc.property(
            fc.double({ min: 10, max: 100000, noNaN: true }),
            (radius) => {
                const ring = geom.generateCircleGeometry(center, radius).coordinates[0];
                for (const [lng, lat] of ring) {
                    // Invert the equirectangular projection (cosLat ~= 1 at equator).
                    const dx = lng * M_PER_DEG * Math.cos(center[1] * Math.PI / 180);
                    const dy = lat * M_PER_DEG;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    expect(Math.abs(dist - radius)).toBeLessThan(radius * 1e-6 + 1e-6);
                }
            }
        ));
    });
});

// ============================================================================
// getBoundingBox
// ============================================================================

describe('AddCircleGeometry.getBoundingBox', () => {
    it('returns [minLng, minLat, maxLng, maxLat] symmetric about the center', () => {
        const center = [0, 0];
        const radius = 1000;
        const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox(center, radius);
        const degLat = radius / M_PER_DEG;
        const degLng = degLat / Math.cos(center[1] * Math.PI / 180);
        expect(minLng).toBeCloseTo(center[0] - degLng, 9);
        expect(maxLng).toBeCloseTo(center[0] + degLng, 9);
        expect(minLat).toBeCloseTo(center[1] - degLat, 9);
        expect(maxLat).toBeCloseTo(center[1] + degLat, 9);
    });

    it('box is wider in longitude than latitude away from the equator', () => {
        const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox([0, 60], 1000);
        const lngSpan = maxLng - minLng;
        const latSpan = maxLat - minLat;
        expect(lngSpan).toBeGreaterThan(latSpan);
    });

    it('encloses every generated ring vertex', () => {
        const center = [10, 45];
        const radius = 2500;
        const [minLng, minLat, maxLng, maxLat] = geom.getBoundingBox(center, radius);
        const ring = geom.generateCircleGeometry(center, radius).coordinates[0];
        for (const [lng, lat] of ring) {
            expect(lng).toBeGreaterThanOrEqual(minLng - 1e-9);
            expect(lng).toBeLessThanOrEqual(maxLng + 1e-9);
            expect(lat).toBeGreaterThanOrEqual(minLat - 1e-9);
            expect(lat).toBeLessThanOrEqual(maxLat + 1e-9);
        }
    });
});

// ============================================================================
// updateFromHandle
// ============================================================================

describe('AddCircleGeometry.updateFromHandle', () => {
    const featureFor = (center) => ({ properties: { id: 'c1', center } });

    it('rejects an unknown handle type', () => {
        geom.calculateDistance = () => 5000;
        expect(geom.updateFromHandle('rotation', [1, 0], featureFor([0, 0]))).toBeNull();
    });

    it('returns null when the center is invalid', () => {
        geom.calculateDistance = () => 5000;
        expect(geom.updateFromHandle('radius', [1, 0], featureFor('not-json{'))).toBeNull();
    });

    it('returns null when the new radius is below 10 m', () => {
        geom.calculateDistance = () => 5;
        expect(geom.updateFromHandle('radius', [0.0001, 0], featureFor([0, 0]))).toBeNull();
    });

    it('returns updated geometry + radius for a valid drag', () => {
        geom.calculateDistance = () => 2000;
        const res = geom.updateFromHandle('radius', [0.02, 0], featureFor([0, 0]));
        expect(res).not.toBeNull();
        expect(res.radius).toBe(2000);
        expect(res.geometry.type).toBe('Polygon');
        expect(res.geometry.coordinates[0].length).toBe(65);
    });

    it('accepts a center provided as a JSON string (normalizeCenter)', () => {
        geom.calculateDistance = () => 1500;
        const res = geom.updateFromHandle('radius', [0.01, 0], featureFor('[0, 0]'));
        expect(res).not.toBeNull();
        expect(res.radius).toBe(1500);
    });
});

// ============================================================================
// calculatePreview
// ============================================================================

describe('AddCircleGeometry.calculatePreview', () => {
    it('returns null when the radius is below 10 m', () => {
        geom.calculateDistance = () => 9;
        expect(geom.calculatePreview([0, 0], [0.00001, 0])).toBeNull();
    });

    it('returns geometry, handlePosition and radius for a valid drag', () => {
        geom.calculateDistance = () => 3000;
        const res = geom.calculatePreview([0, 0], [0.03, 0]);
        expect(res).not.toBeNull();
        expect(res.radius).toBe(3000);
        expect(res.geometry.type).toBe('Polygon');
        expect(res.geometry.coordinates[0].length).toBe(65);
        // Handle sits due east of the centre at radius/cosLat degrees.
        const expectedLng = 0 + (3000 / M_PER_DEG) / Math.cos(0);
        expect(res.handlePosition[0]).toBeCloseTo(expectedLng, 9);
        expect(res.handlePosition[1]).toBeCloseTo(0, 9);
    });

    it('handlePosition matches the first generated ring vertex (angle 0)', () => {
        geom.calculateDistance = () => 4200;
        const center = [5, 30];
        const res = geom.calculatePreview(center, [5.05, 30]);
        const ring = res.geometry.coordinates[0];
        expect(res.handlePosition[0]).toBeCloseTo(ring[0][0], 9);
        expect(res.handlePosition[1]).toBeCloseTo(ring[0][1], 9);
    });
});

// ============================================================================
// normalizeCenter / isValidCenter (supporting helpers)
// ============================================================================

describe('AddCircleGeometry.normalizeCenter', () => {
    it('parses a JSON-string center', () => {
        expect(geom.normalizeCenter('[1, 2]')).toEqual([1, 2]);
    });
    it('passes through an array center', () => {
        expect(geom.normalizeCenter([3, 4])).toEqual([3, 4]);
    });
    it('returns null for malformed JSON', () => {
        expect(geom.normalizeCenter('[1,')).toBeNull();
    });
    it('returns null for a too-short array', () => {
        expect(geom.normalizeCenter([1])).toBeNull();
    });
});

describe('AddCircleGeometry.isValidCenter', () => {
    it('accepts two finite numbers', () => {
        expect(geom.isValidCenter([0, 0])).toBe(true);
    });
    it('rejects NaN coordinates', () => {
        expect(geom.isValidCenter([NaN, 0])).toBe(false);
    });
    it('rejects string coordinates', () => {
        expect(geom.isValidCenter(['0', '0'])).toBe(false);
    });
    it('rejects null (returns a falsy value)', () => {
        // Short-circuit returns `null` (falsy) rather than literal false.
        expect(geom.isValidCenter(null)).toBeFalsy();
    });
});

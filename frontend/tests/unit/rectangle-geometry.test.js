// Path: tests/unit/rectangle-geometry.test.js
/**
 * @fileoverview Pins the pure math of
 * `frontend/src/js/draw_tools/rectangle_tool/add_rectangle_geometry.js`.
 *
 * WHAT THIS SUITE PINS
 * - `validate` / `areValidCorners` / `isValidCoordinate`: the two guards used to
 *   disagree about non-finite input (Infinity passed one and failed the other) and
 *   now agree; this suite fixes the agreement in BOTH directions.
 * - `calculateDimensionsFromCorners`: width is measured at the CENTRAL latitude
 *   (so it shrinks by cos(lat)), height at the central longitude; the centre of an
 *   antimeridian-crossing pair lands on the wrong side of the globe.
 * - `generateRectangleGeometry` (axis-aligned) and `generateRoundedRectangleGeometry`:
 *   ring order, closure, vertex counts, and the degenerate borderRadius=10 case.
 * - `rotateAndTranslate`: the local (x, y) frame is fed to `turf.destination` as a
 *   COMPASS bearing, so +x maps to NORTH and +y to EAST. That is unusual but
 *   internally consistent with the handle placement, and this suite fixes the wiring
 *   with a turf spy so a "fix" to one half cannot pass silently.
 * - `calculateDimensionsFromRotatedCorners`: round-trips against `rotateAndTranslate`.
 * - `calculateCornersFromCenterAndDimensions`: the 111320 m/deg vs 6371 km sphere
 *   mismatch (~0.11% round-trip error) and the polar cos(lat) blow-up.
 * - `updateFromHandle` / `calculatePreview`: handle dispatch, the rotation handle
 *   round-trip (placed at bearing-90, read back as +90), and the minimum-dimension
 *   guard, which now stops a non-finite dimension as well as a small one (every
 *   comparison against NaN is false, so `width < 10` alone never did).
 * - `extractCornersFromGeometry` / `synchronizePropertiesWithGeometry`: the AABB
 *   normalisation, which is now taken ONLY by an unrotated rectangle, whose AABB
 *   genuinely is the rectangle. A rotated one keeps its stored dimensions and only
 *   has its corner pair refreshed; the declared gap (a rotated feature with no
 *   stored dimensions) is pinned too.
 *
 * WHAT THIS SUITE DOES NOT REACH
 * - `turf` is a GLOBAL (<script> tag) in production, not an npm dep. It is stubbed
 *   here with an exact FLAT-PLANE model (no cos(lat), no ellipsoid), so every turf
 *   assertion below tests ORCHESTRATION (which arguments the geometry passes and
 *   how it recombines the results), never real geodesy.
 * - `BaseGeometry` comes from the `@tools` barrel, which drags DOM/MapLibre in. It
 *   is mocked, but `calculateDistance` is wired to the REAL `geometry-utils`
 *   haversine, because `validate` depends on its exact value.
 * - Nothing here touches `add_rectangle_control.js` (MapLibre IControl, Phase 2) or
 *   the attributes panel (DOM).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';

// The source imports BaseGeometry from the relative `../../tool_manager` barrel,
// which is the same module the `@tools` alias points at. Mock both ids: the alias
// is what vitest resolves, the relative one keeps this robust if the import is
// ever normalised. `calculateDistance` MUST stay faithful (validate reads its
// value against a 10 m threshold), so it delegates to the real leaf util.
vi.mock('@tools', async () => {
    const { calculateDistance } = await import('../../src/js/utilities/geometry-utils.js');
    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = { ...properties }; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});
vi.mock('../../src/js/tool_manager/index.js', async () => {
    const { calculateDistance } = await import('../../src/js/utilities/geometry-utils.js');
    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = { ...properties }; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});

const { default: AddRectangleGeometry } = await import(
    '../../src/js/draw_tools/rectangle_tool/add_rectangle_geometry.js'
);

// ---------------------------------------------------------------------------
// turf stub: an EXACT flat plane. `destination` and (`distance`, `bearing`) are
// perfect inverses of each other, which is what makes the round-trip invariants
// below meaningful. KM_PER_DEG is the source's own 111320 m/deg, in kilometres.
// ---------------------------------------------------------------------------
const KM_PER_DEG = 111.32;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

let turfCalls;

beforeAll(() => {
    globalThis.turf = {
        destination(origin, distanceKm, bearingDeg, options) {
            turfCalls.destination.push({ origin, distanceKm, bearingDeg, options });
            const rad = bearingDeg * D2R;
            const north = distanceKm * Math.cos(rad);
            const east = distanceKm * Math.sin(rad);
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [origin[0] + east / KM_PER_DEG, origin[1] + north / KM_PER_DEG],
                },
            };
        },
        distance(a, b, options) {
            turfCalls.distance.push({ a, b, options });
            const east = (b[0] - a[0]) * KM_PER_DEG;
            const north = (b[1] - a[1]) * KM_PER_DEG;
            return Math.sqrt(east * east + north * north);
        },
        bearing(a, b) {
            turfCalls.bearing.push({ a, b });
            const east = (b[0] - a[0]) * KM_PER_DEG;
            const north = (b[1] - a[1]) * KM_PER_DEG;
            return Math.atan2(east, north) * R2D;
        },
    };
});

afterAll(() => {
    delete globalThis.turf;
});

let geom;
beforeEach(() => {
    turfCalls = { destination: [], distance: [], bearing: [] };
    geom = new AddRectangleGeometry();
});

/** Silence the module's console noise for one call and return the result. */
function quiet(fn) {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        return fn();
    } finally {
        err.mockRestore();
        warn.mockRestore();
    }
}

/** Independent bbox of a ring, derived without touching the source. */
function ringBbox(ring) {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    return { minLng, maxLng, minLat, maxLat };
}

// ============================================================================
// validate
// ============================================================================

describe('AddRectangleGeometry.validate', () => {
    it('accepts a rectangle above the 10 m minimum on both sides', () => {
        // 0.001 deg ~ 111 m at the equator, well above the threshold.
        expect(geom.validate([0, 0], [0.001, 0.001])).toBe(true);
    });

    it('rejects a missing or too-short corner', () => {
        expect(geom.validate(null, [1, 1])).toBe(false);
        expect(geom.validate([0, 0], null)).toBe(false);
        expect(geom.validate([0], [1, 1])).toBe(false);
        expect(geom.validate([0, 0], [1])).toBe(false);
        expect(geom.validate('0,0', [1, 1])).toBe(false);
    });

    it('rejects a degenerate rectangle (both corners equal)', () => {
        expect(geom.validate([0, 0], [0, 0])).toBe(false);
    });

    it('brackets the 10 m threshold on each axis independently', () => {
        // 10 m of latitude on the 6371 km sphere is 8.9932e-5 deg.
        const overTenMetres = 1e-4;   // ~11.1 m
        const underTenMetres = 8e-5;  // ~8.9 m
        expect(geom.validate([0, 0], [overTenMetres, overTenMetres])).toBe(true);
        // Wide enough, too short: height fails.
        expect(geom.validate([0, 0], [overTenMetres, underTenMetres])).toBe(false);
        // Tall enough, too narrow: width fails.
        expect(geom.validate([0, 0], [underTenMetres, overTenMetres])).toBe(false);
    });

    it('rejects NaN and Infinity, because the haversine turns them into NaN', () => {
        // This is the class that bit circle/line/polygon/ellipse (Lote 1) and
        // brush/text/image/point (2026-08-24). The rectangle is NOT affected: it
        // never compares the raw input, only the haversine of it, and haversine
        // of a non-finite coordinate is NaN, which fails `>= 10`.
        expect(geom.validate([NaN, 0], [1, 1])).toBe(false);
        expect(geom.validate([0, NaN], [1, 1])).toBe(false);
        expect(geom.validate([Infinity, 0], [1, 1])).toBe(false);
        expect(geom.validate([0, 0], [Infinity, Infinity])).toBe(false);
        expect(geom.validate([0, 0], [-Infinity, 1])).toBe(false);
        expect(geom.validate(['a', 'b'], [1, 1])).toBe(false);
    });

    it('is symmetric in the corner order', () => {
        fc.assert(fc.property(
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            (a, b, c, d) => {
                expect(geom.validate([a, b], [c, d])).toBe(geom.validate([c, d], [a, b]));
            }
        ));
    });
});

// ============================================================================
// isValidCoordinate / areValidCorners
// ============================================================================

describe('AddRectangleGeometry.isValidCoordinate', () => {
    it('accepts a numeric pair and rejects the obvious junk', () => {
        expect(geom.isValidCoordinate([0, 0])).toBe(true);
        expect(geom.isValidCoordinate([1, 2, 3])).toBe(true); // length >= 2, z ignored
        expect(geom.isValidCoordinate(null)).toBeFalsy();
        expect(geom.isValidCoordinate([0])).toBe(false);
        expect(geom.isValidCoordinate(['0', '0'])).toBe(false); // strings, not numbers
        expect(geom.isValidCoordinate([NaN, 0])).toBe(false);
        expect(geom.isValidCoordinate([0, NaN])).toBe(false);
    });

    it('CORRIGIDO: Infinity is rejected (the guard is Number.isFinite, no longer !isNaN)', () => {
        // `typeof Infinity === 'number'` and `!isNaN(Infinity)` are both true, which is how
        // an infinite coordinate used to pass here while `validate` rejected the same pair.
        expect(geom.isValidCoordinate([Infinity, 0])).toBe(false);
        expect(geom.isValidCoordinate([0, -Infinity])).toBe(false);
        // CONTROLE: a finite pair still passes, so the guard did not close everything.
        expect(geom.isValidCoordinate([-43.2, -22.9])).toBe(true);
    });
});

describe('AddRectangleGeometry.areValidCorners', () => {
    it('requires BOTH axes to differ (a degenerate side is rejected)', () => {
        expect(geom.areValidCorners([0, 0], [1, 1])).toBe(true);
        expect(geom.areValidCorners([0, 0], [0, 1])).toBe(false); // same lng
        expect(geom.areValidCorners([0, 0], [1, 0])).toBe(false); // same lat
    });

    it('OBSERVADO: -0 and 0 count as the SAME coordinate (=== on -0 is true)', () => {
        expect(geom.areValidCorners([-0, -0], [0, 0])).toBe(false);
    });

    it('CORRIGIDO: it AGREES with validate about Infinity — both reject infinite corners', () => {
        // `validate` always rejected this pair (haversine -> NaN) while `areValidCorners`
        // accepted it: two guards over the same input with opposite verdicts, so any call
        // site trusting `areValidCorners` alone let a non-finite corner into the geometry.
        expect(geom.areValidCorners([Infinity, 0], [0, 1])).toBe(false);
        expect(geom.validate([Infinity, 0], [0, 1])).toBe(false);
        expect(geom.areValidCorners([0, 1], [-Infinity, 0])).toBe(false);
        expect(geom.validate([0, 1], [-Infinity, 0])).toBe(false);
        // CONTROLE: a legitimate pair is still accepted by BOTH, so the agreement is not
        // "they both say no to everything".
        const a = [0, 0];
        const b = [0.01, 0.01];
        expect(geom.areValidCorners(a, b)).toBe(true);
        expect(geom.validate(a, b)).toBe(true);
    });

    it('rejects junk corners', () => {
        expect(geom.areValidCorners(null, [1, 1])).toBeFalsy();
        expect(geom.areValidCorners([NaN, 0], [1, 1])).toBe(false);
    });
});

// ============================================================================
// normalizeCorner / normalizeCenter
// ============================================================================

describe('AddRectangleGeometry.normalizeCorner', () => {
    it('parses a JSON array string', () => {
        expect(geom.normalizeCorner('[1,2]')).toEqual([1, 2]);
    });

    it('returns the SAME array reference when given an array (no copy)', () => {
        const input = [1, 2];
        expect(geom.normalizeCorner(input)).toBe(input);
    });

    it('returns null for malformed JSON', () => {
        expect(quiet(() => geom.normalizeCorner('[1,'))).toBeNull();
    });

    it('returns null for JSON that parses to a non-array', () => {
        // The backlog flags this shape for the arrow tool; the rectangle guards it.
        expect(quiet(() => geom.normalizeCorner('5'))).toBeNull();
        expect(quiet(() => geom.normalizeCorner('null'))).toBeNull();
        expect(quiet(() => geom.normalizeCorner('{"0":1,"1":2}'))).toBeNull();
    });

    it('returns null for a short array', () => {
        expect(quiet(() => geom.normalizeCorner([1]))).toBeNull();
        expect(quiet(() => geom.normalizeCorner([]))).toBeNull();
    });

    it('OBSERVADO: it does not check the element TYPE — ["a","b"] passes through', () => {
        expect(geom.normalizeCorner('["a","b"]')).toEqual(['a', 'b']);
    });

    it('normalizeCenter is the same function under another name', () => {
        expect(geom.normalizeCenter('[3,4]')).toEqual([3, 4]);
        expect(quiet(() => geom.normalizeCenter('5'))).toBeNull();
    });
});

// ============================================================================
// calculateDimensionsFromCorners
// ============================================================================

describe('AddRectangleGeometry.calculateDimensionsFromCorners', () => {
    it('measures width at the CENTRAL latitude, so it shrinks by cos(lat)', () => {
        const atEquator = geom.calculateDimensionsFromCorners([0, 0], [0.01, 0.01]);
        const atSixty = geom.calculateDimensionsFromCorners([0, 60], [0.01, 60.01]);
        // Height is a pure meridian arc: latitude does not change it.
        expect(atSixty.height).toBeCloseTo(atEquator.height, 3);
        // Width is a parallel arc at the central latitude: cos(60.005 deg) ~ 0.4999.
        const expectedRatio = Math.cos(60.005 * D2R);
        expect(atSixty.width / atEquator.width).toBeCloseTo(expectedRatio, 4);
    });

    it('returns the arithmetic mean of the corners as the centre', () => {
        const { center } = geom.calculateDimensionsFromCorners([-10, -20], [30, 40]);
        expect(center).toEqual([10, 10]);
    });

    it('LIMITACAO CONHECIDA: the antimeridian puts the centre on the wrong side', () => {
        // [179, 0] and [-179, 0] are 2 deg apart ACROSS the seam; the mean lands
        // on the prime meridian, half a globe away from the real centre (180).
        const { center, width } = geom.calculateDimensionsFromCorners([179, 0], [-179, 0]);
        expect(center[0]).toBe(0);
        // The haversine itself takes the short way round, so the WIDTH is right
        // (2 deg ~ 222.4 km) even though the centre is not.
        expect(width).toBeGreaterThan(220000);
        expect(width).toBeLessThan(225000);
    });

    it('is symmetric in the corner order', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            (a, b, c, d) => {
                const one = geom.calculateDimensionsFromCorners([a, b], [c, d]);
                const two = geom.calculateDimensionsFromCorners([c, d], [a, b]);
                expect(one.center).toEqual(two.center);
                expect(one.width).toBeCloseTo(two.width, 6);
                expect(one.height).toBeCloseTo(two.height, 6);
            }
        ));
    });
});

// ============================================================================
// generateRectangleGeometry (axis aligned)
// ============================================================================

describe('AddRectangleGeometry.generateRectangleGeometry', () => {
    it('emits a closed 5-vertex ring in NW -> NE -> SE -> SW order', () => {
        const g = geom.generateRectangleGeometry([1, 2], [3, 5], 0);
        expect(g.type).toBe('Polygon');
        expect(g.coordinates).toHaveLength(1);
        expect(g.coordinates[0]).toEqual([
            [1, 5],
            [3, 5],
            [3, 2],
            [1, 2],
            [1, 5],
        ]);
    });

    it('normalises the corner order (swapped corners give the same ring)', () => {
        const a = geom.generateRectangleGeometry([3, 5], [1, 2], 0);
        const b = geom.generateRectangleGeometry([1, 2], [3, 5], 0);
        expect(a).toEqual(b);
    });

    it('treats borderRadius 0, negative, undefined and NaN as "no rounding"', () => {
        const sharp = geom.generateRectangleGeometry([0, 0], [1, 1], 0).coordinates[0].length;
        expect(sharp).toBe(5);
        expect(geom.generateRectangleGeometry([0, 0], [1, 1], -3).coordinates[0]).toHaveLength(5);
        expect(geom.generateRectangleGeometry([0, 0], [1, 1]).coordinates[0]).toHaveLength(5);
        // `!borderRadius` is true for NaN, so NaN silently means "sharp corners".
        expect(geom.generateRectangleGeometry([0, 0], [1, 1], NaN).coordinates[0]).toHaveLength(5);
    });

    it('a positive borderRadius switches to 4 arcs of 9 points plus closure (37)', () => {
        const ring = geom.generateRectangleGeometry([0, 0], [1, 1], 5).coordinates[0];
        expect(ring).toHaveLength(37);
        expect(ring[0]).toEqual(ring[36]);
    });

    it('property: the ring bbox is exactly the bbox of the two corners', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -80, max: 80, noNaN: true }),
            (a, b, c, d) => {
                const ring = geom.generateRectangleGeometry([a, b], [c, d], 0).coordinates[0];
                const box = ringBbox(ring);
                expect(box.minLng).toBe(Math.min(a, c));
                expect(box.maxLng).toBe(Math.max(a, c));
                expect(box.minLat).toBe(Math.min(b, d));
                expect(box.maxLat).toBe(Math.max(b, d));
            }
        ));
    });
});

// ============================================================================
// generateRoundedRectangleGeometry / addRoundedCorner
// ============================================================================

describe('AddRectangleGeometry.generateRoundedRectangleGeometry', () => {
    it('keeps every arc vertex inside the sharp rectangle (property)', () => {
        fc.assert(fc.property(
            fc.double({ min: 0.001, max: 10, noNaN: true }),
            fc.double({ min: 0.001, max: 10, noNaN: true }),
            fc.integer({ min: 1, max: 10 }),
            (w, h, br) => {
                const ring = geom.generateRoundedRectangleGeometry(0, 0, w, h, br).coordinates[0];
                const box = ringBbox(ring);
                const eps = 1e-9 * Math.max(w, h, 1);
                expect(box.minLng).toBeGreaterThanOrEqual(-eps);
                expect(box.maxLng).toBeLessThanOrEqual(w + eps);
                expect(box.minLat).toBeGreaterThanOrEqual(-eps);
                expect(box.maxLat).toBeLessThanOrEqual(h + eps);
            }
        ));
    });

    it('borderRadius 10 on a square degenerates into a circle (all arc centres collapse)', () => {
        // radius = min(minDim * 10/10 * 0.5, minDim/2) — the two arms are equal at
        // br=10, so the radius is exactly half the short side and the four arc
        // centres coincide at the rectangle centre.
        const ring = geom.generateRoundedRectangleGeometry(0, 0, 2, 2, 10).coordinates[0];
        for (const [lng, lat] of ring) {
            const dx = lng - 1;
            const dy = lat - 1;
            expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(1, 9);
        }
    });

    it('degenerate extents give a radius of 0: every vertex collapses onto one point', () => {
        const ring = geom.generateRoundedRectangleGeometry(5, 5, 5, 5, 7).coordinates[0];
        expect(ring).toHaveLength(37);
        for (const p of ring) expect(p).toEqual([5, 5]);
    });

    it('addRoundedCorner appends segments+1 points and honours the angular sweep', () => {
        const out = [];
        geom.addRoundedCorner(out, 0, 0, 1, 1, 0, Math.PI / 2, 4);
        expect(out).toHaveLength(5);
        expect(out[0][0]).toBeCloseTo(1, 12);
        expect(out[0][1]).toBeCloseTo(0, 12);
        expect(out[4][0]).toBeCloseTo(0, 12);
        expect(out[4][1]).toBeCloseTo(1, 12);
    });

    it('LIMITACAO CONHECIDA: the radius is a DEGREE value shared by lat and lng', () => {
        // The rounding is computed on raw degree extents, so away from the equator
        // the corner arcs are not circular on the ground. A 1 deg x 1 deg box at
        // lat 60 rounds by the same degree radius in both axes.
        const ring = geom.generateRoundedRectangleGeometry(0, 60, 1, 61, 10).coordinates[0];
        const box = ringBbox(ring);
        expect(box.maxLng - box.minLng).toBeCloseTo(box.maxLat - box.minLat, 9);
    });
});

// ============================================================================
// rotateAndTranslate — the atan2/compass mix
// ============================================================================

describe('AddRectangleGeometry.rotateAndTranslate', () => {
    it('feeds turf.destination the LOCAL atan2 angle as a COMPASS bearing', () => {
        // atan2(y, x) is 0 along +x and grows counter-clockwise; turf.destination
        // reads 0 as NORTH and grows clockwise. The source adds `bearing` to the
        // atan2 angle and hands the sum straight over, so +x becomes NORTH.
        geom.rotateAndTranslate(1000, 0, [0, 0], 0);
        expect(turfCalls.destination).toHaveLength(1);
        expect(turfCalls.destination[0].distanceKm).toBeCloseTo(1, 12);
        expect(turfCalls.destination[0].bearingDeg).toBeCloseTo(0, 12);
        expect(turfCalls.destination[0].options).toEqual({ units: 'kilometers' });
    });

    it('+x maps to north and +y maps to east (a mirrored local frame)', () => {
        const north = geom.rotateAndTranslate(1000, 0, [0, 0], 0);
        expect(north[1]).toBeGreaterThan(0);
        expect(north[0]).toBeCloseTo(0, 12);

        const east = geom.rotateAndTranslate(0, 1000, [0, 0], 0);
        expect(east[0]).toBeGreaterThan(0);
        expect(east[1]).toBeCloseTo(0, 12);
    });

    it('the bearing argument rotates the whole local frame', () => {
        geom.rotateAndTranslate(0, 1000, [0, 0], 45);
        // atan2(1000, 0) = 90 deg, plus the 45 deg bearing.
        expect(turfCalls.destination[0].bearingDeg).toBeCloseTo(135, 10);
    });

    it('the origin maps to distance 0 (no direction information survives)', () => {
        const p = geom.rotateAndTranslate(0, 0, [10, 20], 33);
        expect(turfCalls.destination[0].distanceKm).toBe(0);
        expect(p).toEqual([10, 20]);
    });
});

// ============================================================================
// generateRotatedRectangleGeometry
// ============================================================================

describe('AddRectangleGeometry.generateRotatedRectangleGeometry', () => {
    it('emits 4 rotated corners plus the closing vertex', () => {
        const g = geom.generateRotatedRectangleGeometry([0, 0], 2000, 1000, 0, 30);
        expect(g.type).toBe('Polygon');
        const ring = g.coordinates[0];
        expect(ring).toHaveLength(5);
        expect(ring[0]).toEqual(ring[4]);
    });

    it('property: the diagonal obeys w^2 + h^2 = diag^2 at any bearing', () => {
        fc.assert(fc.property(
            fc.double({ min: 20, max: 20000, noNaN: true }),
            fc.double({ min: 20, max: 20000, noNaN: true }),
            fc.double({ min: 0, max: 359.999, noNaN: true }),
            (w, h, bearing) => {
                const ring = geom.generateRotatedRectangleGeometry([0, 0], w, h, 0, bearing)
                    .coordinates[0];
                // Corners 0 and 2 are opposite (local (+hw,+hh) and (-hw,-hh)).
                const diagKm = globalThis.turf.distance(ring[0], ring[2]);
                const diag = diagKm * 1000;
                expect(diag).toBeCloseTo(Math.sqrt(w * w + h * h), 3);
                // And the two sides come out as w and h.
                const side1 = globalThis.turf.distance(ring[0], ring[1]) * 1000;
                const side2 = globalThis.turf.distance(ring[1], ring[2]) * 1000;
                expect(Math.max(side1, side2)).toBeCloseTo(Math.max(w, h), 3);
                expect(Math.min(side1, side2)).toBeCloseTo(Math.min(w, h), 3);
            }
        ));
    });

    it('a positive borderRadius switches to the rounded rotated path (37 vertices)', () => {
        const ring = geom.generateRotatedRectangleGeometry([0, 0], 2000, 1000, 5, 30)
            .coordinates[0];
        expect(ring).toHaveLength(37);
        expect(ring[0]).toEqual(ring[36]);
    });

    it('OBSERVADO: the rounded path still computes the 4 sharp corners first', () => {
        // `generateRotatedRectangleGeometry` maps all four local corners through
        // `rotateAndTranslate` BEFORE deciding to delegate to the rounded builder,
        // so 4 turf.destination calls are thrown away on every rounded rectangle.
        geom.generateRotatedRectangleGeometry([0, 0], 2000, 1000, 5, 30);
        expect(turfCalls.destination).toHaveLength(4 + 36);
    });
});

// ============================================================================
// calculateDimensionsFromRotatedCorners
// ============================================================================

describe('AddRectangleGeometry.calculateDimensionsFromRotatedCorners', () => {
    it('round-trips against rotateAndTranslate for a known rectangle', () => {
        const center = [0, 0];
        const width = 4000;
        const height = 3000;
        const bearing = 25;
        const c1 = geom.rotateAndTranslate(width / 2, height / 2, center, bearing);
        const c2 = geom.rotateAndTranslate(-width / 2, -height / 2, center, bearing);

        const out = geom.calculateDimensionsFromRotatedCorners(c1, c2, bearing);
        expect(out.width).toBeCloseTo(width, 6);
        expect(out.height).toBeCloseTo(height, 6);
        expect(out.center[0]).toBeCloseTo(center[0], 12);
        expect(out.center[1]).toBeCloseTo(center[1], 12);
    });

    it('property: the round-trip holds for any bearing and any aspect ratio', () => {
        fc.assert(fc.property(
            fc.double({ min: 50, max: 50000, noNaN: true }),
            fc.double({ min: 50, max: 50000, noNaN: true }),
            fc.double({ min: 0, max: 359.999, noNaN: true }),
            (w, h, bearing) => {
                const c1 = geom.rotateAndTranslate(w / 2, h / 2, [0, 0], bearing);
                const c2 = geom.rotateAndTranslate(-w / 2, -h / 2, [0, 0], bearing);
                const out = geom.calculateDimensionsFromRotatedCorners(c1, c2, bearing);
                expect(out.width).toBeCloseTo(w, 3);
                expect(out.height).toBeCloseTo(h, 3);
            }
        ));
    });

    it('OBSERVADO: a bearing 90 deg off swaps width and height', () => {
        const c1 = geom.rotateAndTranslate(2000, 1000, [0, 0], 0);
        const c2 = geom.rotateAndTranslate(-2000, -1000, [0, 0], 0);
        const straight = geom.calculateDimensionsFromRotatedCorners(c1, c2, 0);
        const rotated = geom.calculateDimensionsFromRotatedCorners(c1, c2, 90);
        expect(straight.width).toBeCloseTo(rotated.height, 6);
        expect(straight.height).toBeCloseTo(rotated.width, 6);
    });

    it('takes the absolute value, so it never reports a negative side', () => {
        fc.assert(fc.property(
            fc.double({ min: -360, max: 720, noNaN: true }),
            (bearing) => {
                const out = geom.calculateDimensionsFromRotatedCorners([0, 0], [0.01, 0.01], bearing);
                expect(out.width).toBeGreaterThanOrEqual(0);
                expect(out.height).toBeGreaterThanOrEqual(0);
            }
        ));
    });
});

// ============================================================================
// generate — the dispatch between the rotated and the axis-aligned path
// ============================================================================

describe('AddRectangleGeometry.generate', () => {
    it('bearing 0 (or omitted) takes the axis-aligned path', () => {
        const g = geom.generate([1, 2], [3, 5]);
        expect(g.coordinates[0]).toHaveLength(5);
        expect(turfCalls.destination).toHaveLength(0);
        expect(geom.generate([1, 2], [3, 5], 0, 0).coordinates[0]).toEqual(g.coordinates[0]);
    });

    it('a non-zero bearing takes the rotated path', () => {
        geom.generate([0, 0], [0.02, 0.02], 0, 30);
        expect(turfCalls.destination.length).toBeGreaterThan(0);
    });

    it('OBSERVADO: a NaN bearing is falsy, so it silently means "not rotated"', () => {
        const g = geom.generate([1, 2], [3, 5], 0, NaN);
        expect(g.coordinates[0]).toHaveLength(5);
        expect(turfCalls.destination).toHaveLength(0);
    });

    it('uses the supplied width/height instead of recomputing them from the corners', () => {
        geom.generate([0, 0], [0.02, 0.02], 0, 30, 5000, 1000);
        // No turf.distance/bearing call means the corner-derived path was skipped.
        expect(turfCalls.distance).toHaveLength(0);
        expect(turfCalls.bearing).toHaveLength(0);
        // Half-diagonal of 5000 x 1000 is 2549.5 m -> 2.5495 km.
        const half = Math.sqrt(2500 * 2500 + 500 * 500) / 1000;
        for (const call of turfCalls.destination) {
            expect(call.distanceKm).toBeCloseTo(half, 9);
        }
    });

    it('falls back to the corner-derived dimension when only ONE of the pair is null', () => {
        geom.generate([0, 0], [0.02, 0.02], 0, 30, 5000, null);
        expect(turfCalls.distance.length).toBeGreaterThan(0);
    });

    it('OBSERVADO: `??` does not guard NaN — a NaN width is used as-is', () => {
        // Both arguments are non-null, so the recompute branch is skipped entirely
        // and the NaN flows into the geometry.
        const g = geom.generate([0, 0], [0.02, 0.02], 0, 30, NaN, 1000);
        expect(Number.isNaN(g.coordinates[0][0][0])).toBe(true);
    });
});

// ============================================================================
// Handle positions and the rotation round-trip
// ============================================================================

describe('AddRectangleGeometry handle positions', () => {
    const center = [0, 0];

    it('places the width handle along the bearing, at half the width', () => {
        geom.calculateWidthHandlePosition(center, 2000, 40);
        expect(turfCalls.destination[0].distanceKm).toBeCloseTo(1, 12);
        expect(turfCalls.destination[0].bearingDeg).toBe(40);
    });

    it('places the height handle at bearing + 90 and the rotation handle at bearing - 90', () => {
        geom.calculateHeightHandlePosition(center, 1000, 40);
        geom.calculateRotationHandlePosition(center, 1000, 40);
        expect(turfCalls.destination[0].bearingDeg).toBe(130);
        expect(turfCalls.destination[1].bearingDeg).toBe(-50);
        expect(turfCalls.destination[0].distanceKm).toBeCloseTo(0.5, 12);
        expect(turfCalls.destination[1].distanceKm).toBeCloseTo(0.5, 12);
    });

    it('the height and rotation handles sit on opposite sides of the centre', () => {
        const h = geom.calculateHeightHandlePosition(center, 1000, 40);
        const r = geom.calculateRotationHandlePosition(center, 1000, 40);
        expect(h[0]).toBeCloseTo(-r[0], 12);
        expect(h[1]).toBeCloseTo(-r[1], 12);
    });

    it('property: place the rotation handle then read it back gives the bearing again', () => {
        fc.assert(fc.property(
            fc.double({ min: -179.999, max: 180, noNaN: true }),
            (bearing) => {
                const pos = geom.calculateRotationHandlePosition(center, 2000, bearing);
                const back = geom.calculateBearingFromRotationHandle(center, pos);
                let diff = Math.abs(back - bearing);
                if (diff > 180) diff = 360 - diff;
                expect(diff).toBeLessThan(1e-9);
            }
        ));
    });

    it('OBSERVADO: calculateBearingFromRotationHandle can return more than 180', () => {
        // turf.bearing is in (-180, 180]; adding 90 pushes the top quadrant past
        // 180 without any wrap. Nothing downstream normalises it.
        const pos = globalThis.turf.destination(center, 1, 170, { units: 'kilometers' })
            .geometry.coordinates;
        expect(geom.calculateBearingFromRotationHandle(center, pos)).toBeCloseTo(260, 6);
    });

    it('calculateWidthFromHandle/HeightFromHandle both return the plain metric distance', () => {
        const p = globalThis.turf.destination(center, 3, 77, { units: 'kilometers' })
            .geometry.coordinates;
        expect(geom.calculateWidthFromHandle(center, p, 0)).toBeCloseTo(3000, 6);
        // The bearing argument is ignored, by design (the handle defines it).
        expect(geom.calculateHeightFromHandle(center, p, 123)).toBeCloseTo(3000, 6);
    });
});

// ============================================================================
// createHandlesFromGeometry
// ============================================================================

describe('AddRectangleGeometry.createHandlesFromGeometry', () => {
    const props = { center: [0, 0], width: 2000, height: 1000 };

    it('creates exactly three handles with stable ids and roles', () => {
        const handles = geom.createHandlesFromGeometry(null, 'feat-1', 0, props);
        expect(handles).toHaveLength(3);
        expect(handles.map(h => h.id)).toEqual([
            'rectangle-handle-feat-1-width',
            'rectangle-handle-feat-1-height',
            'rectangle-handle-feat-1-rotation',
        ]);
        expect(handles.map(h => h.properties.handleId)).toEqual([
            'width-resize', 'height-resize', 'rotation',
        ]);
        for (const h of handles) {
            expect(h.type).toBe('Feature');
            expect(h.geometry.type).toBe('Point');
            expect(h.properties.role).toBe('handle');
            expect(h.properties.mode).toBe('rectangle_editing');
            expect(h.properties.user_isEditingHandle).toBe(true);
        }
        // Only the rotation handle is an eccentricity handle.
        expect(handles.map(h => h.properties.handleType))
            .toEqual(['vertex', 'vertex', 'eccentricity']);
    });

    it('returns [] when center, width or height is missing', () => {
        expect(quiet(() => geom.createHandlesFromGeometry(null, 'f', 0, null))).toEqual([]);
        expect(quiet(() => geom.createHandlesFromGeometry(null, 'f', 0, { center: [0, 0], width: 1 })))
            .toEqual([]);
    });

    it('OBSERVADO: falsy-zero — width 0 is rejected by `!properties.width`', () => {
        // Benign today (0 is below the 10 m minimum anyway), but it is the same
        // `!value` shape that produced real defects elsewhere in the tool family.
        expect(quiet(() => geom.createHandlesFromGeometry(null, 'f', 0, { ...props, width: 0 })))
            .toEqual([]);
    });

    it('OBSERVADO: the `geometry` argument is never read', () => {
        const a = geom.createHandlesFromGeometry(null, 'f', 0, props);
        const b = geom.createHandlesFromGeometry(
            { type: 'Polygon', coordinates: [[[9, 9], [9, 9]]] }, 'f', 0, props
        );
        expect(a).toEqual(b);
    });

    it('accepts a JSON-string centre, through normalizeCenter', () => {
        const handles = geom.createHandlesFromGeometry(null, 'f', 0, { ...props, center: '[0,0]' });
        expect(handles).toHaveLength(3);
    });
});

// ============================================================================
// updateFromHandle
// ============================================================================

function rectFeature(overrides = {}) {
    return {
        properties: {
            center: [0, 0],
            width: 2000,
            height: 1000,
            bearing: 0,
            borderRadius: 0,
            ...overrides,
        },
    };
}

describe('AddRectangleGeometry.updateFromHandle', () => {
    it('width-resize sets the width to TWICE the centre-to-handle distance', () => {
        const pos = globalThis.turf.destination([0, 0], 1.5, 0, { units: 'kilometers' })
            .geometry.coordinates;
        const out = geom.updateFromHandle('width-resize', pos, rectFeature());
        expect(out.width).toBeCloseTo(3000, 6);
        expect(out.height).toBe(1000);
        expect(out.bearing).toBe(0);
    });

    it('height-resize sets the height to TWICE the centre-to-handle distance', () => {
        const pos = globalThis.turf.destination([0, 0], 0.75, 90, { units: 'kilometers' })
            .geometry.coordinates;
        const out = geom.updateFromHandle('height-resize', pos, rectFeature());
        expect(out.height).toBeCloseTo(1500, 6);
        expect(out.width).toBe(2000);
    });

    it('rotation round-trips through the handle placement', () => {
        const pos = geom.calculateRotationHandlePosition([0, 0], 1000, 37);
        const out = geom.updateFromHandle('rotation', pos, rectFeature());
        expect(out.bearing).toBeCloseTo(37, 9);
        expect(out.width).toBe(2000);
        expect(out.height).toBe(1000);
    });

    it('returns the two opposite corners derived from the new dimensions', () => {
        const out = geom.updateFromHandle('rotation', geom.calculateRotationHandlePosition([0, 0], 1000, 0), rectFeature());
        // corner1 is local (+w/2, +h/2), corner2 is local (-w/2, -h/2): opposite.
        expect(out.corner1[0]).toBeCloseTo(-out.corner2[0], 12);
        expect(out.corner1[1]).toBeCloseTo(-out.corner2[1], 12);
        expect(out.center).toEqual([0, 0]);
    });

    it('returns null for an unknown handle type', () => {
        expect(quiet(() => geom.updateFromHandle('bogus', [0, 0], rectFeature()))).toBeNull();
        expect(quiet(() => geom.updateFromHandle(undefined, [0, 0], rectFeature()))).toBeNull();
    });

    it('returns null when the centre cannot be normalised', () => {
        expect(quiet(() => geom.updateFromHandle('rotation', [0, 0], rectFeature({ center: '5' }))))
            .toBeNull();
    });

    it('refuses a resize below the 10 m minimum', () => {
        const tiny = globalThis.turf.destination([0, 0], 0.004, 0, { units: 'kilometers' })
            .geometry.coordinates; // 4 m -> width 8 m
        expect(quiet(() => geom.updateFromHandle('width-resize', tiny, rectFeature()))).toBeNull();
    });

    it('treats a falsy borderRadius as 0 (0 stays 0, undefined becomes 0)', () => {
        const pos = globalThis.turf.destination([0, 0], 1.5, 0, { units: 'kilometers' })
            .geometry.coordinates;
        const withZero = geom.updateFromHandle('width-resize', pos, rectFeature({ borderRadius: 0 }));
        const withUndef = geom.updateFromHandle('width-resize', pos, rectFeature({ borderRadius: undefined }));
        expect(withZero.geometry.coordinates[0]).toHaveLength(5);
        expect(withUndef.geometry.coordinates[0]).toHaveLength(5);
    });

    // ------------------------------------------------------------------
    // DEFEITO: the minimum-dimension guard is `width < 10 || height < 10`,
    // and every comparison against NaN is false, so a non-finite dimension
    // walks straight past it. Same class as the `validate` accepting NaN
    // that Lote 1 closed in circle/line/polygon/ellipse.
    // ------------------------------------------------------------------
    it('CONTROLE: the guard IS reachable and does reject a genuinely tiny drag', () => {
        const tiny = globalThis.turf.destination([0, 0], 0.001, 0, { units: 'kilometers' })
            .geometry.coordinates;
        expect(quiet(() => geom.updateFromHandle('width-resize', tiny, rectFeature()))).toBeNull();
        // ...and a legitimate drag still produces a result.
        const ok = globalThis.turf.destination([0, 0], 1, 0, { units: 'kilometers' })
            .geometry.coordinates;
        expect(geom.updateFromHandle('width-resize', ok, rectFeature())).not.toBeNull();
    });

    it('CORRIGIDO: a NaN handle position is rejected, instead of yielding a NaN-width rectangle', () => {
        // Every comparison against NaN is false, so `width < 10 || height < 10` used to wave
        // it through and the method returned a non-null result with `width: NaN` and four NaN
        // vertices: a rectangle that vanishes from the map with no error anywhere.
        expect(quiet(() => geom.updateFromHandle('width-resize', [NaN, NaN], rectFeature())))
            .toBeNull();
        expect(quiet(() => geom.updateFromHandle('height-resize', [NaN, NaN], rectFeature())))
            .toBeNull();
    });

    it('CORRIGIDO: a missing stored dimension is rejected too', () => {
        // `undefined < 10` is false as well, so rotating a feature whose height was never
        // written emitted a rectangle with NaN vertices.
        expect(quiet(() => geom.updateFromHandle(
            'rotation',
            geom.calculateRotationHandlePosition([0, 0], 1000, 20),
            rectFeature({ height: undefined })
        ))).toBeNull();
        expect(quiet(() => geom.updateFromHandle(
            'rotation',
            geom.calculateRotationHandlePosition([0, 0], 1000, 20),
            rectFeature({ width: Infinity })
        ))).toBeNull();
    });
});

// ============================================================================
// calculatePreview
// ============================================================================

describe('AddRectangleGeometry.calculatePreview', () => {
    it('mirrors updateFromHandle and adds the three handle positions', () => {
        const pos = globalThis.turf.destination([0, 0], 1.5, 0, { units: 'kilometers' })
            .geometry.coordinates;
        const preview = geom.calculatePreview('width-resize', pos, rectFeature());
        const update = geom.updateFromHandle('width-resize', pos, rectFeature());
        expect(preview.width).toBeCloseTo(update.width, 12);
        expect(preview.height).toBe(update.height);
        expect(preview.bearing).toBe(update.bearing);
        expect(preview.geometry).toEqual(update.geometry);
        expect(Object.keys(preview.handlePositions).sort())
            .toEqual(['height', 'rotation', 'width']);
    });

    it('returns null for an unknown handle type and for an unusable centre', () => {
        expect(geom.calculatePreview('bogus', [0, 0], rectFeature())).toBeNull();
        expect(quiet(() => geom.calculatePreview('rotation', [0, 0], rectFeature({ center: null }))))
            .toBeNull();
    });

    it('CONTROLE: it refuses a drag that really is below the minimum', () => {
        const tiny = globalThis.turf.destination([0, 0], 0.002, 0, { units: 'kilometers' })
            .geometry.coordinates;
        expect(geom.calculatePreview('width-resize', tiny, rectFeature())).toBeNull();
    });

    it('CORRIGIDO: it shares the closed NaN hole with updateFromHandle', () => {
        expect(geom.calculatePreview('width-resize', [NaN, NaN], rectFeature())).toBeNull();
        expect(geom.calculatePreview('height-resize', [NaN, NaN], rectFeature())).toBeNull();
        expect(geom.calculatePreview('rotation', [0.01, 0], rectFeature({ height: undefined })))
            .toBeNull();
    });
});

// ============================================================================
// extractCornersFromGeometry / getBoundingBox
// ============================================================================

describe('AddRectangleGeometry.extractCornersFromGeometry', () => {
    it('returns the AABB corners of the ring, ordered min then max', () => {
        const g = { coordinates: [[[3, 5], [1, 5], [1, 2], [3, 2], [3, 5]]] };
        expect(geom.extractCornersFromGeometry(g)).toEqual({
            corner1: [1, 2],
            corner2: [3, 5],
        });
    });

    it('returns a null pair for junk geometry', () => {
        expect(quiet(() => geom.extractCornersFromGeometry(null)))
            .toEqual({ corner1: null, corner2: null });
        expect(quiet(() => geom.extractCornersFromGeometry({})))
            .toEqual({ corner1: null, corner2: null });
        expect(quiet(() => geom.extractCornersFromGeometry({ coordinates: [] })))
            .toEqual({ corner1: null, corner2: null });
    });

    it('OBSERVADO: an empty ring yields the Infinity sentinels of Math.min/max', () => {
        const out = geom.extractCornersFromGeometry({ coordinates: [[]] });
        expect(out.corner1).toEqual([Infinity, Infinity]);
        expect(out.corner2).toEqual([-Infinity, -Infinity]);
    });

    it('LIMITACAO CONHECIDA: a ROTATED rectangle is normalised into its AABB', () => {
        const ring = geom.generateRotatedRectangleGeometry([0, 0], 4000, 1000, 0, 45)
            .coordinates[0];
        const { corner1, corner2 } = geom.extractCornersFromGeometry({ coordinates: [ring] });
        // The AABB of a 45 deg rotated 4000 x 1000 box is a square of side
        // (4000 + 1000) / sqrt(2) ~ 3535.5 m, so the rotation is gone.
        const sideLng = (corner2[0] - corner1[0]) * KM_PER_DEG * 1000;
        const sideLat = (corner2[1] - corner1[1]) * KM_PER_DEG * 1000;
        expect(sideLng).toBeCloseTo(5000 / Math.SQRT2, 3);
        expect(sideLat).toBeCloseTo(5000 / Math.SQRT2, 3);
    });
});

describe('AddRectangleGeometry.getBoundingBox', () => {
    it('returns [minLng, minLat, maxLng, maxLat] regardless of corner order', () => {
        expect(geom.getBoundingBox([3, 5], [1, 2])).toEqual([1, 2, 3, 5]);
        expect(geom.getBoundingBox([1, 2], [3, 5])).toEqual([1, 2, 3, 5]);
    });

    it('OBSERVADO: NaN poisons the whole box (Math.min/max propagate it)', () => {
        const box = geom.getBoundingBox([NaN, 0], [1, 1]);
        expect(Number.isNaN(box[0])).toBe(true);
        expect(Number.isNaN(box[2])).toBe(true);
    });

    it('property: the box contains both corners and is order-independent', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -90, max: 90, noNaN: true }),
            (a, b, c, d) => {
                const box = geom.getBoundingBox([a, b], [c, d]);
                expect(geom.getBoundingBox([c, d], [a, b])).toEqual(box);
                expect(box[0]).toBeLessThanOrEqual(a);
                expect(box[2]).toBeGreaterThanOrEqual(a);
                expect(box[1]).toBeLessThanOrEqual(b);
                expect(box[3]).toBeGreaterThanOrEqual(b);
            }
        ));
    });
});

// ============================================================================
// calculateCornersFromCenterAndDimensions
// ============================================================================

describe('AddRectangleGeometry.calculateCornersFromCenterAndDimensions', () => {
    it('centres the corners and applies the cos(lat) correction to width only', () => {
        const atEquator = geom.calculateCornersFromCenterAndDimensions([0, 0], 2000, 2000);
        const atSixty = geom.calculateCornersFromCenterAndDimensions([0, 60], 2000, 2000);
        const spanLngEq = atEquator.corner2[0] - atEquator.corner1[0];
        const spanLng60 = atSixty.corner2[0] - atSixty.corner1[0];
        const spanLatEq = atEquator.corner2[1] - atEquator.corner1[1];
        const spanLat60 = atSixty.corner2[1] - atSixty.corner1[1];
        // Latitude span is unchanged; longitude span doubles at lat 60.
        expect(spanLat60).toBeCloseTo(spanLatEq, 12);
        expect(spanLng60 / spanLngEq).toBeCloseTo(1 / Math.cos(60 * D2R), 9);
    });

    it('round-trips through calculateDimensionsFromCorners inside 0.5%', () => {
        // The two directions use different earth models (111320 m/deg going out,
        // a 6371 km sphere coming back), so the round-trip is off by ~0.11%.
        const { corner1, corner2 } = geom.calculateCornersFromCenterAndDimensions([0, 0], 5000, 3000);
        const back = geom.calculateDimensionsFromCorners(corner1, corner2);
        expect(back.width / 5000).toBeGreaterThan(0.995);
        expect(back.width / 5000).toBeLessThan(1.005);
        expect(back.height / 3000).toBeGreaterThan(0.995);
        expect(back.height / 3000).toBeLessThan(1.005);
    });

    it('property: the round-trip error stays under 0.5% at any latitude off the poles', () => {
        fc.assert(fc.property(
            fc.double({ min: -70, max: 70, noNaN: true }),
            fc.double({ min: 100, max: 50000, noNaN: true }),
            fc.double({ min: 100, max: 50000, noNaN: true }),
            (lat, w, h) => {
                const { corner1, corner2 } = geom.calculateCornersFromCenterAndDimensions([0, lat], w, h);
                const back = geom.calculateDimensionsFromCorners(corner1, corner2);
                expect(Math.abs(back.width / w - 1)).toBeLessThan(0.005);
                expect(Math.abs(back.height / h - 1)).toBeLessThan(0.005);
            }
        ));
    });

    it('OBSERVADO: at the pole cos(lat) is 6.1e-17, not 0, so the width explodes but stays finite', () => {
        const { corner1, corner2 } = geom.calculateCornersFromCenterAndDimensions([0, 90], 1000, 1000);
        const span = corner2[0] - corner1[0];
        expect(Number.isFinite(span)).toBe(true);
        expect(span).toBeGreaterThan(1e12);
    });

    it('OBSERVADO: a NaN dimension flows through unchecked', () => {
        const { corner1 } = geom.calculateCornersFromCenterAndDimensions([0, 0], NaN, 100);
        expect(Number.isNaN(corner1[0])).toBe(true);
    });
});

// ============================================================================
// synchronizePropertiesWithGeometry
// ============================================================================

describe('AddRectangleGeometry.synchronizePropertiesWithGeometry', () => {
    it('rewrites corner1/corner2/center/width/height and keeps the rest', () => {
        const feature = {
            type: 'Feature',
            geometry: { coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] },
            properties: { nome: 'R1', bearing: 0, width: 999999 },
        };
        const out = geom.synchronizePropertiesWithGeometry(feature);
        expect(out.properties.nome).toBe('R1');
        expect(out.properties.corner1).toEqual([0, 0]);
        expect(out.properties.corner2).toEqual([0.01, 0.01]);
        // 0.01 deg on the 6371 km sphere is 1111.95 m (width is measured at the
        // central latitude 0.005 deg, where cos(lat) is 1 to twelve digits).
        expect(out.properties.width).toBeCloseTo(1111.95, 1);
        expect(out.properties.height).toBeCloseTo(1111.95, 1);
    });

    it('does not mutate the input feature', () => {
        const feature = {
            geometry: { coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            properties: { width: 42 },
        };
        geom.synchronizePropertiesWithGeometry(feature);
        expect(feature.properties.width).toBe(42);
        expect(feature.properties.corner1).toBeUndefined();
    });

    it('CORRIGIDO: syncing a ROTATED rectangle keeps its stored size, and the corners follow the bearing', () => {
        // Before: `extractCornersFromGeometry` hands back the AABB of the ring, whose side is
        // ~3535 m on BOTH axes for this shape, so a 4000 x 1000 rectangle came back as a
        // near-square while `bearing` stayed at 45. The properties then described a rectangle
        // that is not the one on screen, and re-deriving the geometry from them would have
        // redrawn the feature at the wrong size.
        const ring = geom.generateRotatedRectangleGeometry([0, 0], 4000, 1000, 0, 45)
            .coordinates[0];
        const feature = {
            geometry: { coordinates: [ring] },
            properties: { center: [0, 0], width: 4000, height: 1000, bearing: 45 },
        };
        const out = geom.synchronizePropertiesWithGeometry(feature);

        expect(out.properties.width).toBe(4000);
        expect(out.properties.height).toBe(1000);
        expect(out.properties.bearing).toBe(45);
        expect(out.properties.center).toEqual([0, 0]);

        // The corner pair IS refreshed, in the same convention updateFromHandle uses:
        // corner1 at +half/+half and corner2 at -half/-half, both rotated. So they are the
        // two opposite corners of the ring, not of its bounding box.
        expect(out.properties.corner1).toEqual(
            geom.rotateAndTranslate(2000, 500, [0, 0], 45)
        );
        expect(out.properties.corner2).toEqual(
            geom.rotateAndTranslate(-2000, -500, [0, 0], 45)
        );

        // ROUND TRIP: re-deriving the geometry from the synced properties reproduces the ring
        // it came from. This is the property the AABB rewrite destroyed, and it is the reason
        // the assertions above are not just "the numbers did not change".
        const redraw = geom.generateRotatedRectangleGeometry(
            out.properties.center, out.properties.width, out.properties.height, 0,
            out.properties.bearing
        );
        expect(redraw.coordinates[0]).toHaveLength(ring.length);
        for (let i = 0; i < ring.length; i += 1) {
            expect(redraw.coordinates[0][i][0], `lng ${i}`).toBeCloseTo(ring[i][0], 9);
            expect(redraw.coordinates[0][i][1], `lat ${i}`).toBeCloseTo(ring[i][1], 9);
        }
    });

    it('a rotated rectangle WITHOUT stored dimensions still takes the AABB path (declared gap)', () => {
        // Nothing authoritative to fall back to, so the old behaviour stands: guessing
        // dimensions from an AABB that does not touch the rectangle's own corners would be a
        // different wrong answer, not a better one. Pinned so the gap is visible, not implied.
        const ring = geom.generateRotatedRectangleGeometry([0, 0], 4000, 1000, 0, 45)
            .coordinates[0];
        const out = geom.synchronizePropertiesWithGeometry({
            geometry: { coordinates: [ring] },
            properties: { bearing: 45 },
        });
        expect(out.properties.width).toBeGreaterThan(3400);
        expect(out.properties.width).toBeLessThan(3700);
    });

    it('CONTROLE: an axis-aligned rectangle survives the same round-trip', () => {
        const ring = geom.generateRotatedRectangleGeometry([0, 0], 4000, 1000, 0, 0)
            .coordinates[0];
        const feature = {
            geometry: { coordinates: [ring] },
            properties: { center: [0, 0], width: 4000, height: 1000, bearing: 0 },
        };
        const out = geom.synchronizePropertiesWithGeometry(feature);
        // +x maps to NORTH in this tool's local frame, so the axis-aligned box has
        // its `width` running north-south: the AABB recovers 1000 x 4000, swapped.
        expect(out.properties.width).toBeCloseTo(1000, -1);
        expect(out.properties.height).toBeCloseTo(4000, -1);
    });
});

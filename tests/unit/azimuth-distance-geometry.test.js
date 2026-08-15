import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import {
    convertAzimuth,
    convertDistance,
    applyDeclination,
    normalizeAzimuth,
    calculateContraAzimuth,
    generateGeometry,
    calculateTotalDistance,
    validateLeg,
    canCreateFeature,
    calculateWaypoints,
} from '../../src/js/azimuth_distance_tool/azimuth_distance_geometry.js';
import {
    ANGULAR_UNIT,
    DISTANCE_UNIT,
    NORTH_REFERENCE,
    OUTPUT_MODE,
} from '../../src/js/azimuth_distance_tool/azimuth_distance_constants.js';

// ============================================================================
// normalizeAzimuth
// ============================================================================

describe('normalizeAzimuth', () => {
    it('wraps above 360', () => expect(normalizeAzimuth(370)).toBe(10));
    it('wraps negatives into [0,360)', () => expect(normalizeAzimuth(-10)).toBe(350));
    it('maps 360 to 0', () => expect(normalizeAzimuth(360)).toBe(0));
    it('keeps 0', () => expect(normalizeAzimuth(0)).toBe(0));

    it('property: result is always in [0, 360)', () => {
        fc.assert(fc.property(fc.double({ min: -100000, max: 100000, noNaN: true }), (a) => {
            const r = normalizeAzimuth(a);
            return r >= 0 && r < 360;
        }));
    });

    it('property: idempotent', () => {
        fc.assert(fc.property(fc.double({ min: -100000, max: 100000, noNaN: true }), (a) => {
            expect(normalizeAzimuth(normalizeAzimuth(a))).toBeCloseTo(normalizeAzimuth(a), 9);
        }));
    });

    // Regression for the two rounding failures the property above used to find,
    // one every few hundred runs. Root cause: `((a % 360) + 360) % 360` adds a
    // circle that the input did not need, and the sum has no double.
    it('is idempotent one hair short of north', () => {
        // The largest double below 360. The old form pushed it to 720, which
        // rounds to exactly 720, and 720 % 360 is 0 — north, off by 5.7e-14.
        const a = 359.99999999999994;
        expect(normalizeAzimuth(a)).toBe(a);
        expect(normalizeAzimuth(normalizeAzimuth(a))).toBe(a);
    });

    it('folds a negative hair to zero, never to 360', () => {
        // -1e-14 + 360 rounds up to exactly 360, and 360 is outside [0, 360).
        expect(normalizeAzimuth(-1e-14)).toBe(0);
        expect(Object.is(normalizeAzimuth(-0), 0)).toBe(true);
        expect(Object.is(normalizeAzimuth(-720), 0)).toBe(true);
    });

    it('non-finite input stays non-finite', () => {
        expect(normalizeAzimuth(NaN)).toBeNaN();
        expect(normalizeAzimuth(Infinity)).toBeNaN();
        expect(normalizeAzimuth(-Infinity)).toBeNaN();
    });
});

// ============================================================================
// Unit conversions
// ============================================================================

describe('convertAzimuth (degrees <-> mils)', () => {
    it('360° = 6400 mils', () => {
        expect(convertAzimuth(360, ANGULAR_UNIT.DEGREES, ANGULAR_UNIT.MILS)).toBe(6400);
    });
    it('1600 mils = 90°', () => {
        expect(convertAzimuth(1600, ANGULAR_UNIT.MILS, ANGULAR_UNIT.DEGREES)).toBe(90);
    });
    it('same unit is a no-op', () => {
        expect(convertAzimuth(123, ANGULAR_UNIT.DEGREES, ANGULAR_UNIT.DEGREES)).toBe(123);
    });

    it('property: deg -> mil -> deg recovers value (within rounding)', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 360, noNaN: true }), (deg) => {
            const mil = convertAzimuth(deg, ANGULAR_UNIT.DEGREES, ANGULAR_UNIT.MILS);
            const back = convertAzimuth(mil, ANGULAR_UNIT.MILS, ANGULAR_UNIT.DEGREES);
            // 1 mil ≈ 0.056° → round-trip error bounded by ~0.06°
            expect(Math.abs(back - deg)).toBeLessThan(0.1);
        }));
    });
});

describe('convertDistance (m <-> km)', () => {
    it('1500 m = 1.5 km', () => {
        expect(convertDistance(1500, DISTANCE_UNIT.METERS, DISTANCE_UNIT.KILOMETERS)).toBe(1.5);
    });
    it('2 km = 2000 m', () => {
        expect(convertDistance(2, DISTANCE_UNIT.KILOMETERS, DISTANCE_UNIT.METERS)).toBe(2000);
    });
});

// ============================================================================
// Declination + contra-azimuth
// ============================================================================

describe('applyDeclination', () => {
    it('true north reference only normalizes', () => {
        expect(applyDeclination(370, -21, NORTH_REFERENCE.TRUE)).toBe(10);
    });
    it('magnetic: true = magnetic + declination (West negative), wrapped', () => {
        // 10° magnetic with -21° declination → -11° → 349°
        expect(applyDeclination(10, -21, NORTH_REFERENCE.MAGNETIC)).toBe(349);
    });

    it('property: output always normalized', () => {
        fc.assert(fc.property(
            fc.double({ min: 0, max: 360, noNaN: true }),
            fc.double({ min: -30, max: 30, noNaN: true }),
            (az, decl) => {
                const r = applyDeclination(az, decl, NORTH_REFERENCE.MAGNETIC);
                return r >= 0 && r < 360;
            }
        ));
    });
});

describe('calculateContraAzimuth', () => {
    it('90° -> 270°', () => expect(calculateContraAzimuth(90, ANGULAR_UNIT.DEGREES)).toBe(270));
    it('270° -> 90°', () => expect(calculateContraAzimuth(270, ANGULAR_UNIT.DEGREES)).toBe(90));
    it('0 mils -> 3200 mils', () => expect(calculateContraAzimuth(0, ANGULAR_UNIT.MILS)).toBe(3200));

    it('property: contra(contra(x)) ≈ x (degrees)', () => {
        fc.assert(fc.property(fc.double({ min: 0, max: 359.9, noNaN: true }), (az) => {
            const twice = calculateContraAzimuth(calculateContraAzimuth(az, ANGULAR_UNIT.DEGREES), ANGULAR_UNIT.DEGREES);
            expect(Math.abs(twice - az)).toBeLessThan(0.11);
        }));
    });
});

// ============================================================================
// Validation
// ============================================================================

describe('validateLeg', () => {
    it('accepts an in-range azimuth and distance', () => {
        expect(validateLeg({ azimuth: 90, distance: 500 }, ANGULAR_UNIT.DEGREES).valid).toBe(true);
    });
    it('rejects azimuth above 360 in degrees', () => {
        expect(validateLeg({ azimuth: 400, distance: 1 }, ANGULAR_UNIT.DEGREES).valid).toBe(false);
    });
    it('accepts azimuth up to 6400 in mils', () => {
        expect(validateLeg({ azimuth: 6400, distance: 1 }, ANGULAR_UNIT.MILS).valid).toBe(true);
    });
    it('rejects negative distance', () => {
        expect(validateLeg({ azimuth: 10, distance: -5 }, ANGULAR_UNIT.DEGREES).valid).toBe(false);
    });
    it('treats empty azimuth as not provided (no error)', () => {
        expect(validateLeg({ azimuth: '', distance: '' }, ANGULAR_UNIT.DEGREES).valid).toBe(true);
    });
});

describe('canCreateFeature', () => {
    const legs = [{ azimuth: 90, distance: 100 }, { azimuth: 180, distance: 100 }];
    it('rejects without a reference point', () => {
        expect(canCreateFeature(null, legs, OUTPUT_MODE.ROUTE).canCreate).toBe(false);
    });
    it('rejects with no complete legs', () => {
        expect(canCreateFeature([0, 0], [{ azimuth: '', distance: '' }], OUTPUT_MODE.ROUTE).canCreate).toBe(false);
    });
    it('rejects area with a single leg', () => {
        expect(canCreateFeature([0, 0], [legs[0]], OUTPUT_MODE.AREA).canCreate).toBe(false);
    });
    it('accepts a valid route', () => {
        expect(canCreateFeature([0, 0], legs, OUTPUT_MODE.ROUTE).canCreate).toBe(true);
    });
});

// ============================================================================
// Geometry generation (pure)
// ============================================================================

describe('generateGeometry', () => {
    const wp = [[0, 0], [0, 1], [1, 1]];
    it('POINT mode returns null (points handled separately)', () => {
        expect(generateGeometry(wp, [0, 0], OUTPUT_MODE.POINT)).toBeNull();
    });
    it('ROUTE returns a LineString of all waypoints', () => {
        const g = generateGeometry(wp, [0, 0], OUTPUT_MODE.ROUTE);
        expect(g.type).toBe('LineString');
        expect(g.coordinates).toEqual(wp);
    });
    it('ROUTE with <2 points returns null', () => {
        expect(generateGeometry([[0, 0]], [0, 0], OUTPUT_MODE.ROUTE)).toBeNull();
    });
    it('AREA returns a closed Polygon (first === last)', () => {
        const g = generateGeometry(wp, [0, 0], OUTPUT_MODE.AREA);
        expect(g.type).toBe('Polygon');
        const ring = g.coordinates[0];
        expect(ring[0]).toEqual(ring[ring.length - 1]);
    });
    it('AREA with <3 points returns null', () => {
        expect(generateGeometry([[0, 0], [0, 1]], [0, 0], OUTPUT_MODE.AREA)).toBeNull();
    });
    it('empty waypoints returns null', () => {
        expect(generateGeometry([], [0, 0], OUTPUT_MODE.ROUTE)).toBeNull();
    });
});

describe('calculateTotalDistance', () => {
    it('sums leg distances, ignoring blanks', () => {
        expect(calculateTotalDistance([{ distance: 100 }, { distance: '' }, { distance: 250 }])).toBe(350);
    });
});

// ============================================================================
// calculateWaypoints — orchestration (turf stubbed)
// ============================================================================

describe('calculateWaypoints (turf stubbed)', () => {
    beforeAll(() => {
        // Deterministic flat-earth stub: enough to validate orchestration, not geodesy.
        globalThis.turf = {
            point: (coords) => ({ geometry: { coordinates: coords } }),
            destination: (from, distKm, _bearing, _opts) => ({
                geometry: { coordinates: [from.geometry.coordinates[0] + distKm * 0.01, from.geometry.coordinates[1]] }
            }),
        };
    });
    afterAll(() => { delete globalThis.turf; });

    it('returns [] for an invalid reference point', () => {
        expect(calculateWaypoints(null, [], 0, NORTH_REFERENCE.TRUE, ANGULAR_UNIT.DEGREES, DISTANCE_UNIT.METERS)).toEqual([]);
    });

    it('returns just the reference point when there are no legs', () => {
        const r = calculateWaypoints([0, 0], [], 0, NORTH_REFERENCE.TRUE, ANGULAR_UNIT.DEGREES, DISTANCE_UNIT.METERS);
        expect(r).toEqual([[0, 0]]);
    });

    it('adds one waypoint per complete leg and skips incomplete ones', () => {
        const legs = [
            { azimuth: 90, distance: 100 },   // complete
            { azimuth: '', distance: 100 },   // incomplete (no azimuth)
            { azimuth: 45, distance: 0 },     // incomplete (no distance)
            { azimuth: 180, distance: 200 },  // complete
        ];
        const r = calculateWaypoints([0, 0], legs, 0, NORTH_REFERENCE.TRUE, ANGULAR_UNIT.DEGREES, DISTANCE_UNIT.METERS);
        expect(r).toHaveLength(3); // reference + 2 complete legs
    });
});

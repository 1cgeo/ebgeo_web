// Path: tests/unit/occupied-front-geometry.test.js

/**
 * @fileoverview Pins the pure geometry of the "frente ocupada" military tool
 * (`military_tools/occupied_front_tool/add_occupied_front_geometry.js`).
 *
 * WHAT THIS SUITE HOLDS
 *  - the shape contract of `createOccupiedFrontGeometry`: two independent arms,
 *    five segments each, and the 60% / 10% / 10% ratios of `createRay`, measured
 *    with a haversine written HERE (not the module's own `calculateDistance`),
 *    so the check does not compose the very functions it is checking;
 *  - the degenerate cases that silently drop an arm (`distance < 1 m`);
 *  - the three DIFFERENT validity policies of the file (`validate`,
 *    `areValidBaseCoordinates`, `normalizeBaseCoordinates`) and where they disagree;
 *  - the two known holes the backlog suspected: `p3` is never distance-checked,
 *    and `calculatePreview` has no handleType allowlist;
 *  - immutability of the caller's `baseCoordinates` across update/preview.
 *
 * WHAT IT DOES NOT REACH
 *  - `add_occupied_front_control.js` (MapLibre IControl, store I/O, `updateFeatureForMove`);
 *  - `occupied_front_attributes_panel.js` (DOM);
 *  - the real `BaseGeometry` from the `@tools` barrel: only `calculateDistance` is
 *    used by this module, and the mock below delegates it to the same
 *    `utilities/geometry-utils.js` haversine the real base class delegates to
 *    (that function has its own suite in `tests/unit/geometry-utils.test.js`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// `add_occupied_front_geometry` imports BaseGeometry from the `@tools` barrel,
// which pulls DOM/MapLibre-coupled modules. Mock the barrel, keeping the ONE
// inherited method the module actually calls wired to the real haversine.
vi.mock('@tools', async () => {
    const { calculateDistance } = await import('../../src/js/utilities/geometry-utils.js');

    return {
        BaseGeometry: class {
            constructor(properties = {}) { this.properties = properties; }
            calculateDistance(a, b) { return calculateDistance(a, b); }
        },
    };
});

const { default: AddOccupiedFrontGeometry } = await import(
    '../../src/js/military_tools/occupied_front_tool/add_occupied_front_geometry.js'
);

const geom = new AddOccupiedFrontGeometry();

/**
 * Independent haversine, deliberately NOT the one the module uses.
 * Uses asin instead of atan2 so the two formulations differ in shape as well.
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

const P1 = [0, 0];
const P2 = [0.01, 0.01];
const P3 = [0.01, -0.01];

/** Segments produced by one non-degenerate arm: 3 body + 2 arrow-head lines. */
const SEGMENTS_PER_ARM = 5;

let warn;
let error;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
});

// ============================================================================
// calculateBearing (the tool carries its OWN copy, distinct from geometry-utils)
// ============================================================================

describe('AddOccupiedFrontGeometry.calculateBearing', () => {
    it('maps the four cardinal directions to 0/90/180/270', () => {
        expect(geom.calculateBearing([0, 0], [0, 1])).toBeCloseTo(0, 9);
        expect(geom.calculateBearing([0, 0], [1, 0])).toBeCloseTo(90, 9);
        expect(geom.calculateBearing([0, 0], [0, -1])).toBeCloseTo(180, 9);
        expect(geom.calculateBearing([0, 0], [-1, 0])).toBeCloseTo(270, 9);
    });

    it('returns 0 for two identical points (atan2(0,0) === 0)', () => {
        expect(geom.calculateBearing([10, -20], [10, -20])).toBe(0);
    });

    it('CROSSES THE ANTIMERIDIAN CORRECTLY: 179E to 179W reads as due east', () => {
        // The backlog listed this as "antimeridiano NAO tratado (bug)". It IS
        // handled, and for free: deltaLng feeds sin/cos, which are periodic, so
        // -358 degrees and +2 degrees are the same argument.
        expect(geom.calculateBearing([179, 0], [-179, 0])).toBeCloseTo(90, 9);
        expect(geom.calculateBearing([-179, 0], [179, 0])).toBeCloseTo(270, 9);
    });

    it('always lands inside [0, 360) for arbitrary finite pairs', () => {
        fc.assert(fc.property(
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -85, max: 85, noNaN: true }),
            fc.double({ min: -180, max: 180, noNaN: true }),
            fc.double({ min: -85, max: 85, noNaN: true }),
            (lng1, lat1, lng2, lat2) => {
                const bearing = geom.calculateBearing([lng1, lat1], [lng2, lat2]);

                expect(Number.isFinite(bearing)).toBe(true);
                expect(bearing).toBeGreaterThanOrEqual(0);
                expect(bearing).toBeLessThan(360);
            }
        ), { numRuns: 300 });
    });

    it('is the inverse of destination: bearing then travel lands on the target', () => {
        fc.assert(fc.property(
            fc.double({ min: -170, max: 170, noNaN: true }),
            fc.double({ min: -70, max: 70, noNaN: true }),
            fc.double({ min: 100, max: 200000, noNaN: true }),
            fc.double({ min: 0, max: 359.99, noNaN: true }),
            (lng, lat, distance, bearing) => {
                const start = [lng, lat];
                const target = geom.destination(start, distance, bearing);

                // Compare modulo 360: a bearing of 0 comes back as 359.999...
                const separation = Math.abs(
                    ((geom.calculateBearing(start, target) - bearing + 540) % 360) - 180
                );

                expect(separation).toBeLessThan(1e-6);
                expect(haversine(start, target)).toBeCloseTo(distance, 3);
            }
        ), { numRuns: 300 });
    });
});

// ============================================================================
// destination
// ============================================================================

describe('AddOccupiedFrontGeometry.destination', () => {
    it('moves due north by the requested distance', () => {
        const target = geom.destination([0, 0], 111195, 0);

        expect(target[0]).toBeCloseTo(0, 9);
        expect(target[1]).toBeCloseTo(1, 4);
        expect(haversine([0, 0], target)).toBeCloseTo(111195, 3);
    });

    it('LIMITATION: longitude is never wrapped, so crossing 180 yields lng > 180', () => {
        const target = geom.destination([179.99, 0], 200000, 90);

        expect(target[0]).toBeGreaterThan(180);
    });

    it('returns the start point for a zero distance', () => {
        const target = geom.destination([-43.2, -22.9], 0, 137);

        expect(target[0]).toBeCloseTo(-43.2, 12);
        expect(target[1]).toBeCloseTo(-22.9, 12);
    });
});

// ============================================================================
// createRay
// ============================================================================

describe('AddOccupiedFrontGeometry.createRay', () => {
    it('produces exactly five segments for a non-degenerate arm', () => {
        const arm = geom.createRay(P1, P2, -1);

        expect(arm).toHaveLength(SEGMENTS_PER_ARM);
        arm.forEach((segment) => expect(segment).toHaveLength(2));
    });

    it('anchors the first segment at the start and the last two at the end point', () => {
        const arm = geom.createRay(P1, P2, -1);

        expect(arm[0][0]).toBe(P1);
        expect(arm[2][1]).toBe(P2);
        expect(arm[3][1]).toBe(P2);
        expect(arm[4][1]).toBe(P2);
    });

    it('honours the 60% / 10% / 10% ratios, measured with an independent haversine', () => {
        const total = haversine(P1, P2);
        const arm = geom.createRay(P1, P2, -1);

        expect(haversine(arm[0][0], arm[0][1]) / total).toBeCloseTo(0.6, 9);
        expect(haversine(arm[1][0], arm[1][1]) / total).toBeCloseTo(0.1, 9);
        expect(haversine(arm[3][0], arm[3][1]) / total).toBeCloseTo(0.1, 9);
        expect(haversine(arm[4][0], arm[4][1]) / total).toBeCloseTo(0.1, 9);
    });

    it('turns the elbow by +225 or -225 degrees according to turnDirection', () => {
        const initial = geom.calculateBearing(P1, P2);

        for (const turnDirection of [-1, 1]) {
            const arm = geom.createRay(P1, P2, turnDirection);
            const elbowBearing = geom.calculateBearing(arm[1][0], arm[1][1]);
            const expected = ((initial + 225 * turnDirection) % 360 + 360) % 360;

            expect(elbowBearing).toBeCloseTo(expected, 6);
        }
    });

    it('opens the arrow head at +/-150 degrees off the closing segment', () => {
        const arm = geom.createRay(P1, P2, -1);
        const closing = geom.calculateBearing(arm[2][0], arm[2][1]);

        // The head lines are drawn head -> tip, so the stored direction is the
        // reverse of the (closing +/- 150) bearing used to place them.
        const back1 = geom.calculateBearing(P2, arm[3][0]);
        const back2 = geom.calculateBearing(P2, arm[4][0]);

        expect(back1).toBeCloseTo(((closing + 150) % 360 + 360) % 360, 4);
        expect(back2).toBeCloseTo(((closing - 150) % 360 + 360) % 360, 4);
    });

    it('drops the whole arm when the two points are closer than 1 m', () => {
        expect(geom.createRay(P1, P1, -1)).toEqual([]);
        // ~0.55 m apart at the equator.
        expect(geom.createRay([0, 0], [0.000005, 0], -1)).toEqual([]);
    });

    it('keeps the arm at the 1 m boundary (strict `<`)', () => {
        // 1 m north of the equator, in degrees on a 6371 km sphere.
        const oneMetre = 1 / (6371000 * Math.PI / 180);
        const arm = geom.createRay([0, 0], [0, oneMetre * 1.0001], -1);

        expect(arm).toHaveLength(SEGMENTS_PER_ARM);
    });
});

// ============================================================================
// createOccupiedFrontGeometry
// ============================================================================

describe('AddOccupiedFrontGeometry.createOccupiedFrontGeometry', () => {
    it('emits a MultiLineString of ten segments for three well-spread points', () => {
        const geometry = geom.createOccupiedFrontGeometry([P1, P2, P3]);

        expect(geometry.type).toBe('MultiLineString');
        expect(geometry.coordinates).toHaveLength(2 * SEGMENTS_PER_ARM);
    });

    it('curves the upper arm right and the lower arm left (opposite turn signs)', () => {
        const geometry = geom.createOccupiedFrontGeometry([P1, P2, P3]);
        const upperElbow = geom.calculateBearing(
            geometry.coordinates[1][0], geometry.coordinates[1][1]
        );
        const lowerElbow = geom.calculateBearing(
            geometry.coordinates[SEGMENTS_PER_ARM + 1][0],
            geometry.coordinates[SEGMENTS_PER_ARM + 1][1]
        );
        const upperInitial = geom.calculateBearing(P1, P2);
        const lowerInitial = geom.calculateBearing(P1, P3);

        expect(upperElbow).toBeCloseTo(((upperInitial - 225) % 360 + 360) % 360, 6);
        expect(lowerElbow).toBeCloseTo(((lowerInitial + 225) % 360 + 360) % 360, 6);
    });

    it('silently emits only five segments when one arm collapses onto the origin', () => {
        const geometry = geom.createOccupiedFrontGeometry([P1, P2, [0, 0]]);

        expect(geometry.type).toBe('MultiLineString');
        expect(geometry.coordinates).toHaveLength(SEGMENTS_PER_ARM);
    });

    it('emits an EMPTY MultiLineString (not null) when both arms collapse', () => {
        const geometry = geom.createOccupiedFrontGeometry([P1, P1, P1]);

        expect(geometry).toEqual({ type: 'MultiLineString', coordinates: [] });
    });

    it('returns null for fewer than three points, null and undefined', () => {
        expect(geom.createOccupiedFrontGeometry([P1, P2])).toBeNull();
        expect(geom.createOccupiedFrontGeometry([])).toBeNull();
        expect(geom.createOccupiedFrontGeometry(null)).toBeNull();
        expect(geom.createOccupiedFrontGeometry(undefined)).toBeNull();
    });

    it('ignores a fourth point instead of failing', () => {
        const three = geom.createOccupiedFrontGeometry([P1, P2, P3]);
        const four = geom.createOccupiedFrontGeometry([P1, P2, P3, [5, 5]]);

        expect(four.coordinates).toEqual(three.coordinates);
    });

    it('generate() is a pass-through to createOccupiedFrontGeometry', () => {
        expect(geom.generate([P1, P2, P3]))
            .toEqual(geom.createOccupiedFrontGeometry([P1, P2, P3]));
    });
});

// ============================================================================
// validate — and how it disagrees with areValidBaseCoordinates
// ============================================================================

describe('AddOccupiedFrontGeometry.validate', () => {
    it('accepts three points at least 10 m apart between p1 and p2', () => {
        expect(geom.validate([P1, P2, P3])).toBe(true);
    });

    it('rejects null, non-array and fewer than three points', () => {
        expect(geom.validate(null)).toBe(false);
        expect(geom.validate(undefined)).toBe(false);
        expect(geom.validate('[[0,0],[1,1],[2,2]]')).toBe(false);
        expect(geom.validate([P1, P2])).toBe(false);
    });

    it('rejects a coordinate that is not an array of at least two numbers', () => {
        expect(geom.validate([P1, P2, [0]])).toBe(false);
        expect(geom.validate([P1, P2, null])).toBe(false);
    });

    it('rejects p1-p2 below the 10 m floor and accepts it at/above', () => {
        const metre = 1 / (6371000 * Math.PI / 180);

        expect(geom.validate([[0, 0], [0, metre * 9], P3])).toBe(false);
        expect(geom.validate([[0, 0], [0, metre * 11], P3])).toBe(true);
    });

    it('never inspects p3 distance: p3 sitting on top of p1 still validates', () => {
        expect(geom.validate([P1, P2, [0, 0]])).toBe(true);
    });

    it('rejects NaN only by accident, through `NaN >= 10` being false', () => {
        expect(geom.validate([[NaN, 0], P2, P3])).toBe(false);
        // ... and the accident does not cover p3, which is never measured.
        expect(geom.validate([P1, P2, [NaN, NaN]])).toBe(true);
    });

    it('DEFECT: accepts STRING coordinates, which areValidBaseCoordinates rejects', () => {
        const stringy = [['0', '0'], ['0.01', '0.01'], ['0.01', '-0.01']];

        expect(geom.validate(stringy)).toBe(true);
        expect(geom.areValidBaseCoordinates(stringy)).toBe(false);
    });
});

describe('AddOccupiedFrontGeometry.areValidBaseCoordinates', () => {
    it('accepts three numeric pairs and tolerates a third (z) component', () => {
        expect(geom.areValidBaseCoordinates([P1, P2, P3])).toBe(true);
        expect(geom.areValidBaseCoordinates([[0, 0, 5], [1, 1, 5], [2, 2, 5]])).toBe(true);
    });

    it('rejects short arrays, non-arrays, NaN and non-number members', () => {
        expect(geom.areValidBaseCoordinates([P1, P2])).toBe(false);
        expect(geom.areValidBaseCoordinates(null)).toBe(false);
        expect(geom.areValidBaseCoordinates('nope')).toBe(false);
        expect(geom.areValidBaseCoordinates([[NaN, 0], P2, P3])).toBe(false);
        expect(geom.areValidBaseCoordinates([[0, '0'], P2, P3])).toBe(false);
    });

    it('DEFECT: accepts Infinity, because the guard is isNaN and not Number.isFinite', () => {
        expect(geom.areValidBaseCoordinates([[Infinity, 0], P2, P3])).toBe(true);
        expect(geom.areValidBaseCoordinates([[0, -Infinity], P2, P3])).toBe(true);
    });

    // CONTROL for the it.fails below: the predicate is reachable and it DOES
    // discriminate. Without this pair, the it.fails would go green on any throw,
    // an import error included.
    it('control: the predicate is reachable and separates valid from NaN input', () => {
        expect(geom.areValidBaseCoordinates([P1, P2, P3])).toBe(true);
        expect(geom.areValidBaseCoordinates([[NaN, 0], P2, P3])).toBe(false);
    });

    it.fails(
        'DEFECT (expected red): a non-finite coordinate should be rejected, '
        + 'and areValidBaseCoordinates lets Infinity through',
        () => {
            expect(geom.areValidBaseCoordinates([[Infinity, 0], P2, P3])).toBe(false);
        }
    );
});

// ============================================================================
// normalizeBaseCoordinates / normalizeCenter — asymmetric sentinels
// ============================================================================

describe('AddOccupiedFrontGeometry.normalizeBaseCoordinates', () => {
    it('parses a JSON string into the array it encodes', () => {
        expect(geom.normalizeBaseCoordinates('[[1,2],[3,4],[5,6]]'))
            .toEqual([[1, 2], [3, 4], [5, 6]]);
    });

    it('returns the SAME reference for an array input (no defensive copy)', () => {
        const input = [P1, P2, P3];

        expect(geom.normalizeBaseCoordinates(input)).toBe(input);
    });

    it('falls back to [] for malformed JSON and for non-array JSON scalars', () => {
        expect(geom.normalizeBaseCoordinates('nope')).toEqual([]);
        expect(geom.normalizeBaseCoordinates('42')).toEqual([]);
        expect(geom.normalizeBaseCoordinates('null')).toEqual([]);
        expect(geom.normalizeBaseCoordinates(null)).toEqual([]);
        expect(geom.normalizeBaseCoordinates(undefined)).toEqual([]);
        expect(geom.normalizeBaseCoordinates(42)).toEqual([]);
    });

    it('loses the sign of negative zero, because JSON.stringify(-0) is "0"', () => {
        // Not a fault of the module; recorded so the property below can exclude it
        // instead of the property silently being weakened by an unexplained filter.
        expect(geom.normalizeBaseCoordinates(JSON.stringify([[-0, 0]]))).toEqual([[0, 0]]);
    });

    it('round-trips any array of pairs through JSON.stringify (negative zero aside)', () => {
        /** @param {number} v - Raw sample @returns {number} Sample with -0 folded to 0 */
        const noMinusZero = (v) => (v === 0 ? 0 : v);

        fc.assert(fc.property(
            fc.array(fc.tuple(
                fc.double({ min: -180, max: 180, noNaN: true }).map(noMinusZero),
                fc.double({ min: -90, max: 90, noNaN: true }).map(noMinusZero)
            ), { minLength: 0, maxLength: 8 }),
            (coords) => {
                expect(geom.normalizeBaseCoordinates(JSON.stringify(coords))).toEqual(coords);
            }
        ), { numRuns: 200 });
    });
});

describe('AddOccupiedFrontGeometry.normalizeCenter', () => {
    it('uses null as its failure sentinel, where normalizeBaseCoordinates uses []', () => {
        expect(geom.normalizeCenter('nope')).toBeNull();
        expect(geom.normalizeCenter('42')).toBeNull();
        expect(geom.normalizeCenter([0])).toBeNull();
        expect(geom.normalizeBaseCoordinates('nope')).toEqual([]);
    });

    it('parses and passes through valid centers', () => {
        expect(geom.normalizeCenter('[1,2]')).toEqual([1, 2]);
        expect(geom.normalizeCenter([1, 2, 3])).toEqual([1, 2, 3]);
    });
});

// ============================================================================
// getBoundingBox / calculateCenter / getOriginPoint
// ============================================================================

describe('AddOccupiedFrontGeometry.getBoundingBox', () => {
    it('returns [minLng, minLat, maxLng, maxLat]', () => {
        expect(geom.getBoundingBox([P1, P2, P3])).toEqual([0, -0.01, 0.01, 0.01]);
    });

    it('returns null when the coordinates fail areValidBaseCoordinates', () => {
        expect(geom.getBoundingBox([P1, P2])).toBeNull();
        expect(geom.getBoundingBox(null)).toBeNull();
        expect(geom.getBoundingBox([[NaN, 0], P2, P3])).toBeNull();
    });

    it('DEFECT: an Infinity coordinate passes the guard and poisons the box', () => {
        expect(geom.getBoundingBox([[Infinity, 0], [1, 1], [2, 2]]))
            .toEqual([1, 0, Infinity, 2]);
    });

    it('LIMITATION: the box is naive across the antimeridian and spans the globe', () => {
        expect(geom.getBoundingBox([[179, 0], [-179, 1], [179.5, 0.5]]))
            .toEqual([-179, 0, 179.5, 1]);
    });

    it('contains every input point', () => {
        fc.assert(fc.property(
            fc.array(fc.tuple(
                fc.double({ min: -180, max: 180, noNaN: true }),
                fc.double({ min: -90, max: 90, noNaN: true })
            ), { minLength: 3, maxLength: 8 }),
            (coords) => {
                const box = geom.getBoundingBox(coords);

                expect(box).not.toBeNull();
                expect(coords.length).toBeGreaterThanOrEqual(3);
                coords.forEach(([lng, lat]) => {
                    expect(lng).toBeGreaterThanOrEqual(box[0]);
                    expect(lat).toBeGreaterThanOrEqual(box[1]);
                    expect(lng).toBeLessThanOrEqual(box[2]);
                    expect(lat).toBeLessThanOrEqual(box[3]);
                });
            }
        ), { numRuns: 200 });
    });
});

describe('AddOccupiedFrontGeometry.calculateCenter', () => {
    it('is p1, NOT the centroid of the three points', () => {
        expect(geom.calculateCenter([P1, P2, P3])).toBe(P1);
    });

    it('returns null for invalid coordinates', () => {
        expect(geom.calculateCenter([P1, P2])).toBeNull();
        expect(geom.calculateCenter(null)).toBeNull();
    });
});

describe('AddOccupiedFrontGeometry.getOriginPoint', () => {
    it('normalizes first, so a JSON string works', () => {
        expect(geom.getOriginPoint('[[7,8],[1,1],[2,2]]')).toEqual([7, 8]);
    });

    it('returns null when normalization yields an empty array', () => {
        expect(geom.getOriginPoint('nope')).toBeNull();
        expect(geom.getOriginPoint([])).toBeNull();
    });

    it('does NOT validate: a single bogus point still comes back', () => {
        expect(geom.getOriginPoint([['a', 'b']])).toEqual(['a', 'b']);
    });
});

// ============================================================================
// createHandles
// ============================================================================

describe('AddOccupiedFrontGeometry.createHandles', () => {
    /**
     * @param {Array} baseCoordinates - Value for properties.baseCoordinates
     * @returns {Object} Minimal feature the geometry class accepts
     */
    function feature(baseCoordinates) {
        return { properties: { id: 'of-1', baseCoordinates } };
    }

    it('emits exactly three handles, one per control point, in p1/p2/p3 order', () => {
        const handles = geom.createHandles(feature([P1, P2, P3]));

        expect(handles).toHaveLength(3);
        expect(handles.map(h => h.properties.handleId)).toEqual(['p1', 'p2', 'p3']);
        expect(handles.map(h => h.properties.handleType))
            .toEqual(['center', 'primary', 'secondary']);
        expect(handles.map(h => h.properties.index)).toEqual([0, 1, 2]);
        expect(handles.map(h => h.geometry.coordinates)).toEqual([P1, P2, P3]);
    });

    it('derives the handle ids from the feature id', () => {
        const handles = geom.createHandles(feature([P1, P2, P3]));

        expect(handles.map(h => h.id)).toEqual([
            'occupied-front-handle-of-1-p1',
            'occupied-front-handle-of-1-p2',
            'occupied-front-handle-of-1-p3',
        ]);
    });

    it('returns [] when fewer than three coordinates survive normalization', () => {
        expect(geom.createHandles(feature([P1, P2]))).toEqual([]);
        expect(geom.createHandles(feature('nope'))).toEqual([]);
    });
});

// ============================================================================
// updateFromHandle / calculatePreview
// ============================================================================

describe('AddOccupiedFrontGeometry.updateFromHandle', () => {
    /**
     * @returns {Object} Fresh feature, so mutation checks are not cross-contaminated
     */
    function freshFeature() {
        return { properties: { id: 'of-1', baseCoordinates: [[...P1], [...P2], [...P3]] } };
    }

    it('rejects a handleType outside the p1/p2/p3 allowlist', () => {
        expect(geom.updateFromHandle('bogus', [1, 1], freshFeature())).toBeNull();
        expect(geom.updateFromHandle(undefined, [1, 1], freshFeature())).toBeNull();
        expect(warn).toHaveBeenCalled();
    });

    it('rejects a feature whose baseCoordinates do not normalize to three points', () => {
        expect(geom.updateFromHandle('p1', [1, 1], { properties: { baseCoordinates: [P1] } }))
            .toBeNull();
    });

    it('moves the addressed point and regenerates the geometry', () => {
        const result = geom.updateFromHandle('p2', [0.02, 0.02], freshFeature());

        expect(result.baseCoordinates).toEqual([P1, [0.02, 0.02], P3]);
        expect(result.geometry.coordinates).toHaveLength(2 * SEGMENTS_PER_ARM);
    });

    it('refuses a p1 or p2 move that brings them under 10 m apart', () => {
        expect(geom.updateFromHandle('p2', [0, 0], freshFeature())).toBeNull();
        expect(geom.updateFromHandle('p1', [0.01, 0.01], freshFeature())).toBeNull();
    });

    it('DEFECT: p3 is never distance-checked, so it may collapse onto p1', () => {
        const result = geom.updateFromHandle('p3', [0, 0], freshFeature());

        expect(result).not.toBeNull();
        expect(result.baseCoordinates[2]).toEqual([0, 0]);
        // The lower arm silently disappears from the drawing.
        expect(result.geometry.coordinates).toHaveLength(SEGMENTS_PER_ARM);
    });

    it('does not mutate the feature it was handed', () => {
        const feature = freshFeature();
        const before = JSON.parse(JSON.stringify(feature.properties.baseCoordinates));

        geom.updateFromHandle('p1', [0.005, 0.005], feature);

        expect(feature.properties.baseCoordinates).toEqual(before);
    });
});

describe('AddOccupiedFrontGeometry.calculatePreview', () => {
    /**
     * @returns {Object} Fresh feature for preview checks
     */
    function freshFeature() {
        return { properties: { id: 'of-1', baseCoordinates: [[...P1], [...P2], [...P3]] } };
    }

    it('mirrors updateFromHandle for the three known handles', () => {
        const preview = geom.calculatePreview('p2', [0.02, 0.02], freshFeature());
        const update = geom.updateFromHandle('p2', [0.02, 0.02], freshFeature());

        expect(preview.baseCoordinates).toEqual(update.baseCoordinates);
        expect(preview.geometry).toEqual(update.geometry);
    });

    it('DEFECT: no handleType allowlist, so an unknown handle yields geometry anyway', () => {
        const preview = geom.calculatePreview('bogus', [9, 9], freshFeature());

        expect(preview).not.toBeNull();
        // Nothing moved, and nothing complained: updateFromHandle returns null here.
        expect(preview.baseCoordinates).toEqual([P1, P2, P3]);
        expect(geom.updateFromHandle('bogus', [9, 9], freshFeature())).toBeNull();
    });

    it('returns null under the 10 m floor for p1 and p2', () => {
        expect(geom.calculatePreview('p1', [0.01, 0.01], freshFeature())).toBeNull();
        expect(geom.calculatePreview('p2', [0, 0], freshFeature())).toBeNull();
    });

    it('returns null when baseCoordinates do not normalize to three points', () => {
        expect(geom.calculatePreview('p1', [1, 1], { properties: { baseCoordinates: 'nope' } }))
            .toBeNull();
    });

    it('ALIASES baseCoordinates and handlePositions to the same array', () => {
        const preview = geom.calculatePreview('p1', [0.005, 0.005], freshFeature());

        // A caller that edits handlePositions in place also edits baseCoordinates.
        expect(preview.baseCoordinates).toBe(preview.handlePositions);
    });

    it('does not mutate the feature it was handed', () => {
        const feature = freshFeature();
        const before = JSON.parse(JSON.stringify(feature.properties.baseCoordinates));

        geom.calculatePreview('p3', [0.05, -0.05], feature);

        expect(feature.properties.baseCoordinates).toEqual(before);
    });
});

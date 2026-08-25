// Path: tests/unit/pointer-utils-gestos.test.js

/**
 * @fileoverview Pins the three pure gesture primitives of
 * `utilities/pointer-utils.js`: `getTouchesDistance`, `getTouchesAngle` and
 * `getTouchesMidpoint`.
 *
 * What this suite HOLDS: the "< 2 touches" degenerate answers (which DIFFER
 * between the three, and one of them throws), the unit of the angle (DEGREES,
 * not radians) and its sign convention, the fact that only the FIRST TWO
 * touches are ever read, and the symmetry/antisymmetry of each function when
 * the two touches swap places.
 *
 * What it does NOT reach: `isTouchDevice`, `getPointerPosition`,
 * `preventDefaultGestures`/`restoreDefaultGestures` and the three handler
 * factories, all of which need a DOM (`window`, `navigator`, elements with
 * `getBoundingClientRect` and real listeners). The environment here is node.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    getTouchesDistance,
    getTouchesAngle,
    getTouchesMidpoint,
} from '../../src/js/utilities/pointer-utils.js';

/** Builds an array-like touch list from [x, y] pairs. */
const touches = (...pairs) => pairs.map(([clientX, clientY]) => ({ clientX, clientY }));

// ============================================================================
// getTouchesDistance
// ============================================================================

describe('getTouchesDistance', () => {
    it('measures the 3-4-5 triangle', () => {
        expect(getTouchesDistance(touches([0, 0], [3, 4]))).toBe(5);
    });

    it('returns 0 for two touches on the same pixel', () => {
        expect(getTouchesDistance(touches([7, 7], [7, 7]))).toBe(0);
    });

    it('returns 0 for a single touch', () => {
        expect(getTouchesDistance(touches([10, 10]))).toBe(0);
    });

    it('returns 0 for an empty list (no throw)', () => {
        expect(getTouchesDistance(touches())).toBe(0);
    });

    it('ignores a third touch entirely', () => {
        expect(getTouchesDistance(touches([0, 0], [3, 4], [1000, 1000]))).toBe(5);
    });

    it('is symmetric under swapping the two touches', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: -5000, max: 5000 }),
                fc.integer({ min: -5000, max: 5000 }), fc.integer({ min: -5000, max: 5000 }),
                (ax, ay, bx, by) => {
                    expect(getTouchesDistance(touches([ax, ay], [bx, by])))
                        .toBe(getTouchesDistance(touches([bx, by], [ax, ay])));
                }
            ),
            { numRuns: 300 }
        );
    });

    it('is never negative and matches an independently derived hypotenuse', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -2000, max: 2000 }), fc.integer({ min: -2000, max: 2000 }),
                fc.integer({ min: -2000, max: 2000 }), fc.integer({ min: -2000, max: 2000 }),
                (ax, ay, bx, by) => {
                    const got = getTouchesDistance(touches([ax, ay], [bx, by]));
                    // Derived from the squares, not by reusing Math.hypot.
                    const expected = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
                    expect(got).toBeGreaterThanOrEqual(0);
                    expect(got).toBeCloseTo(expected, 9);
                }
            ),
            { numRuns: 300 }
        );
    });

    it('OBSERVADO: a NaN coordinate propagates (there is no Number.isFinite guard)', () => {
        expect(getTouchesDistance(touches([0, 0], [NaN, 0]))).toBeNaN();
        expect(getTouchesDistance(touches([0, 0], [Infinity, 0]))).toBe(Infinity);
    });
});

// ============================================================================
// getTouchesAngle
// ============================================================================

describe('getTouchesAngle', () => {
    it('answers in DEGREES, not radians, and due east is 0', () => {
        expect(getTouchesAngle(touches([0, 0], [10, 0]))).toBe(0);
    });

    it('a downward vector (growing clientY) is +90 degrees', () => {
        // Screen coordinates: y grows downward, and atan2(dy, dx) is not negated.
        expect(getTouchesAngle(touches([0, 0], [0, 10]))).toBe(90);
    });

    it('an upward vector is -90 degrees', () => {
        expect(getTouchesAngle(touches([0, 0], [0, -10]))).toBe(-90);
    });

    it('due west is exactly 180, never -180, for a zero dy', () => {
        expect(getTouchesAngle(touches([0, 0], [-10, 0]))).toBe(180);
    });

    it('the diagonal is 45 degrees', () => {
        expect(getTouchesAngle(touches([0, 0], [10, 10]))).toBeCloseTo(45, 12);
    });

    it('returns 0 for fewer than two touches, which is INDISTINGUISHABLE from due east', () => {
        expect(getTouchesAngle(touches([10, 10]))).toBe(0);
        expect(getTouchesAngle(touches())).toBe(0);
        expect(getTouchesAngle(touches([0, 0], [10, 0]))).toBe(0);
    });

    it('returns 0 when the two touches coincide (atan2(0, 0) === 0)', () => {
        expect(getTouchesAngle(touches([4, 4], [4, 4]))).toBe(0);
    });

    it('ignores a third touch', () => {
        expect(getTouchesAngle(touches([0, 0], [0, 10], [999, 999]))).toBe(90);
    });

    it('always lands in (-180, 180]', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }),
                fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }),
                (ax, ay, bx, by) => {
                    const a = getTouchesAngle(touches([ax, ay], [bx, by]));
                    expect(a).toBeGreaterThan(-180.0000001);
                    expect(a).toBeLessThanOrEqual(180);
                }
            ),
            { numRuns: 300 }
        );
    });

    it('swapping the touches turns the angle by 180 degrees', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }),
                fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }),
                (ax, ay, bx, by) => {
                    fc.pre(ax !== bx || ay !== by);
                    const forward = getTouchesAngle(touches([ax, ay], [bx, by]));
                    const backward = getTouchesAngle(touches([bx, by], [ax, ay]));
                    const delta = Math.abs(((forward - backward) % 360 + 360) % 360);
                    expect(delta).toBeCloseTo(180, 9);
                }
            ),
            { numRuns: 300 }
        );
    });
});

// ============================================================================
// getTouchesMidpoint
// ============================================================================

describe('getTouchesMidpoint', () => {
    it('averages the two touches', () => {
        expect(getTouchesMidpoint(touches([0, 0], [10, 20]))).toEqual({ x: 5, y: 10 });
    });

    it('handles negative coordinates without sign trouble', () => {
        expect(getTouchesMidpoint(touches([-10, -20], [10, 20]))).toEqual({ x: 0, y: 0 });
    });

    it('degrades to the FIRST touch when there is only one, NOT to zero', () => {
        // This is the asymmetry with distance/angle: they answer 0, this one
        // answers a position, which is the only useful answer for a pan.
        expect(getTouchesMidpoint(touches([42, 7]))).toEqual({ x: 42, y: 7 });
    });

    it('CONSERTADO: an EMPTY list degrades to the origin, like the two siblings', () => {
        // `touches[0].clientX` on an empty list was a read of undefined. The two
        // sibling functions answer 0 for the same input, and the three are called
        // together from the same handlers.
        expect(getTouchesMidpoint(touches())).toEqual({ x: 0, y: 0 });
        expect(getTouchesDistance(touches())).toBe(0);
        expect(getTouchesAngle(touches())).toBe(0);
    });

    it('CONTROLE: one touch still answers that touch, not the origin', () => {
        // Sem isto o conserto seria indistinguivel de devolver sempre {0,0}.
        expect(getTouchesMidpoint(touches([1, 2]))).toEqual({ x: 1, y: 2 });
    });

    it('ignores a third touch', () => {
        expect(getTouchesMidpoint(touches([0, 0], [10, 20], [1000, 1000])))
            .toEqual({ x: 5, y: 10 });
    });

    it('is symmetric under swapping and always lies on the segment', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }),
                fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }),
                (ax, ay, bx, by) => {
                    const forward = getTouchesMidpoint(touches([ax, ay], [bx, by]));
                    const backward = getTouchesMidpoint(touches([bx, by], [ax, ay]));
                    expect(forward).toEqual(backward);
                    expect(forward.x).toBeGreaterThanOrEqual(Math.min(ax, bx));
                    expect(forward.x).toBeLessThanOrEqual(Math.max(ax, bx));
                    expect(forward.y).toBeGreaterThanOrEqual(Math.min(ay, by));
                    expect(forward.y).toBeLessThanOrEqual(Math.max(ay, by));
                }
            ),
            { numRuns: 300 }
        );
    });

    it('the midpoint is equidistant from both touches', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }),
                fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 }),
                (ax, ay, bx, by) => {
                    const m = getTouchesMidpoint(touches([ax, ay], [bx, by]));
                    const da = Math.sqrt((m.x - ax) ** 2 + (m.y - ay) ** 2);
                    const db = Math.sqrt((m.x - bx) ** 2 + (m.y - by) ** 2);
                    expect(da).toBeCloseTo(db, 9);
                    expect(da * 2).toBeCloseTo(
                        getTouchesDistance(touches([ax, ay], [bx, by])), 9
                    );
                }
            ),
            { numRuns: 300 }
        );
    });
});

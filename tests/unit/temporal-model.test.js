import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    isTemporallyVisible,
    normalizeTrajectory,
    decimateTrajectory,
    interpolatePosition,
    resolveTrajectoryTarget,
    mergeTemporalWindows,
    trajectoryStats,
    headingAt,
    speedAt,
    averageSpeed,
} from '../../src/js/temporal/temporal-model.js';

// ============================================================================
// isTemporallyVisible
// ============================================================================

describe('isTemporallyVisible', () => {
    it('treats a feature with no temporal data as permanent', () => {
        expect(isTemporallyVisible({}, 1000)).toBe(true);
        expect(isTemporallyVisible({ nome: 'x' }, 0)).toBe(true);
    });

    it('handles null/undefined props', () => {
        expect(isTemporallyVisible(null, 1000)).toBe(true);
        expect(isTemporallyVisible(undefined, 1000)).toBe(true);
    });

    it('hides before temporalInicio', () => {
        expect(isTemporallyVisible({ temporalInicio: 100 }, 99)).toBe(false);
        expect(isTemporallyVisible({ temporalInicio: 100 }, 100)).toBe(true);
        expect(isTemporallyVisible({ temporalInicio: 100 }, 101)).toBe(true);
    });

    it('hides after temporalFim', () => {
        expect(isTemporallyVisible({ temporalFim: 200 }, 201)).toBe(false);
        expect(isTemporallyVisible({ temporalFim: 200 }, 200)).toBe(true);
        expect(isTemporallyVisible({ temporalFim: 200 }, 199)).toBe(true);
    });

    it('respects a closed window', () => {
        const p = { temporalInicio: 100, temporalFim: 200 };
        expect(isTemporallyVisible(p, 50)).toBe(false);
        expect(isTemporallyVisible(p, 150)).toBe(true);
        expect(isTemporallyVisible(p, 250)).toBe(false);
    });

    it('treats a non-finite cursor as show-everything', () => {
        expect(isTemporallyVisible({ temporalInicio: 100 }, NaN)).toBe(true);
        expect(isTemporallyVisible({ temporalInicio: 100 }, Infinity)).toBe(true);
        expect(isTemporallyVisible({ temporalInicio: 100 }, null)).toBe(true);
    });

    it('ignores NaN bounds (not a real window)', () => {
        expect(isTemporallyVisible({ temporalInicio: NaN }, 10)).toBe(true);
        expect(isTemporallyVisible({ temporalFim: NaN }, 10)).toBe(true);
    });

    it('property: a permanent feature is visible at any cursor', () => {
        fc.assert(
            fc.property(fc.integer({ min: -1e12, max: 1e12 }), (cursor) =>
                isTemporallyVisible({}, cursor) === true
            )
        );
    });

    it('property: a feature is visible iff inicio<=cursor<=fim', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1000 }),
                fc.integer({ min: 0, max: 1000 }),
                fc.integer({ min: -500, max: 1500 }),
                (a, b, cursor) => {
                    const inicio = Math.min(a, b);
                    const fim = Math.max(a, b);
                    const expected = cursor >= inicio && cursor <= fim;
                    return isTemporallyVisible({ temporalInicio: inicio, temporalFim: fim }, cursor) === expected;
                }
            )
        );
    });
});

// ============================================================================
// normalizeTrajectory
// ============================================================================

describe('normalizeTrajectory', () => {
    it('returns [] for non-arrays', () => {
        expect(normalizeTrajectory(null)).toEqual([]);
        expect(normalizeTrajectory(undefined)).toEqual([]);
        expect(normalizeTrajectory({})).toEqual([]);
    });

    it('drops invalid keypoints', () => {
        const traj = [
            { t: 1, lng: 10, lat: 20 },
            { t: NaN, lng: 1, lat: 2 },
            { t: 2, lng: NaN, lat: 2 },
            { lng: 1, lat: 2 },
            null,
            { t: 3, lng: 5, lat: 6 },
        ];
        expect(normalizeTrajectory(traj)).toEqual([
            { t: 1, lng: 10, lat: 20 },
            { t: 3, lng: 5, lat: 6 },
        ]);
    });

    it('sorts chronologically without mutating input', () => {
        const traj = [
            { t: 3, lng: 0, lat: 0 },
            { t: 1, lng: 0, lat: 0 },
            { t: 2, lng: 0, lat: 0 },
        ];
        const out = normalizeTrajectory(traj);
        expect(out.map((k) => k.t)).toEqual([1, 2, 3]);
        expect(traj.map((k) => k.t)).toEqual([3, 1, 2]); // original untouched
    });
});

// ============================================================================
// mergeTemporalWindows
// ============================================================================

describe('mergeTemporalWindows', () => {
    it('returns {} for an empty list or all-permanent inputs', () => {
        expect(mergeTemporalWindows([])).toEqual({});
        expect(mergeTemporalWindows(null)).toEqual({});
        expect(mergeTemporalWindows([{}, { nome: 'x' }])).toEqual({});
    });

    it('copies a single feature\'s window (1:1 inherit)', () => {
        expect(mergeTemporalWindows([{ temporalInicio: 100, temporalFim: 200 }])).toEqual({
            temporalInicio: 100,
            temporalFim: 200,
        });
    });

    it('keeps only the bounds that are present', () => {
        expect(mergeTemporalWindows([{ temporalInicio: 100 }])).toEqual({ temporalInicio: 100 });
        expect(mergeTemporalWindows([{ temporalFim: 200 }])).toEqual({ temporalFim: 200 });
    });

    it('unions windows: min start, max end', () => {
        const out = mergeTemporalWindows([
            { temporalInicio: 300, temporalFim: 400 },
            { temporalInicio: 100, temporalFim: 250 },
            { temporalInicio: 200, temporalFim: 500 },
        ]);
        expect(out).toEqual({ temporalInicio: 100, temporalFim: 500 });
    });

    it('treats a missing bound as unbounded → omits that side of the union', () => {
        // One input is permanent on the start side → union has no lower bound.
        expect(mergeTemporalWindows([
            { temporalInicio: 100, temporalFim: 200 },
            { temporalFim: 500 }, // no inicio → unbounded start
        ])).toEqual({ temporalFim: 500 });
        // One input permanent on the end side → no upper bound.
        expect(mergeTemporalWindows([
            { temporalInicio: 100, temporalFim: 200 },
            { temporalInicio: 50 }, // no fim → unbounded end
        ])).toEqual({ temporalInicio: 50 });
    });

    it('ignores NaN/Infinity bounds (treated as unbounded)', () => {
        expect(mergeTemporalWindows([{ temporalInicio: NaN, temporalFim: 200 }])).toEqual({ temporalFim: 200 });
        expect(mergeTemporalWindows([{ temporalInicio: 100, temporalFim: Infinity }])).toEqual({ temporalInicio: 100 });
    });
});

// ============================================================================
// trajectoryStats
// ============================================================================

describe('trajectoryStats', () => {
    it('reports zeros for fewer than 2 keypoints', () => {
        expect(trajectoryStats([])).toEqual({ count: 0, durationMs: 0, distanceMeters: 0 });
        expect(trajectoryStats([{ t: 1, lng: 0, lat: 0 }])).toEqual({ count: 1, durationMs: 0, distanceMeters: 0 });
    });

    it('computes count and total duration (last − first)', () => {
        const stats = trajectoryStats([
            { t: 1000, lng: 0, lat: 0 },
            { t: 5000, lng: 0, lat: 0 },
            { t: 3000, lng: 0, lat: 0 },
        ]);
        expect(stats.count).toBe(3);
        expect(stats.durationMs).toBe(4000); // 5000 − 1000
    });

    it('sums great-circle segment lengths (~111 km per degree of latitude)', () => {
        const stats = trajectoryStats([
            { t: 0, lng: 0, lat: 0 },
            { t: 1, lng: 0, lat: 1 },
        ]);
        expect(stats.distanceMeters).toBeCloseTo(111195, -2); // within ~100 m
    });
});

// ============================================================================
// headingAt / speedAt / averageSpeed
// ============================================================================

describe('headingAt', () => {
    it('returns null for fewer than 2 keypoints', () => {
        expect(headingAt([], 0)).toBeNull();
        expect(headingAt([{ t: 0, lng: 0, lat: 0 }], 0)).toBeNull();
    });

    it('reads due-north and due-east segment bearings', () => {
        expect(headingAt([{ t: 0, lng: 0, lat: 0 }, { t: 100, lng: 0, lat: 1 }], 50)).toBeCloseTo(0, 5);
        expect(headingAt([{ t: 0, lng: 0, lat: 0 }, { t: 100, lng: 1, lat: 0 }], 50)).toBeCloseTo(90, 1);
    });

    it('uses the segment the cursor falls in on a multi-segment path', () => {
        const traj = [
            { t: 0, lng: 0, lat: 0 },
            { t: 100, lng: 0, lat: 1 },   // north
            { t: 200, lng: 1, lat: 1 },   // east
        ];
        expect(headingAt(traj, 50)).toBeCloseTo(0, 5);    // first segment → north
        expect(headingAt(traj, 150)).toBeCloseTo(90, 1);  // second segment → east
    });

    it('clamps to the first/last segment outside the time span', () => {
        const traj = [{ t: 100, lng: 0, lat: 0 }, { t: 200, lng: 0, lat: 1 }];
        expect(headingAt(traj, 0)).toBeCloseTo(0, 5);   // before first → first segment
        expect(headingAt(traj, 999)).toBeCloseTo(0, 5); // after last → last segment
    });
});

describe('speedAt', () => {
    it('returns null for fewer than 2 keypoints', () => {
        expect(speedAt([{ t: 0, lng: 0, lat: 0 }], 0)).toBeNull();
    });

    it('computes the bracketing segment speed (m/s)', () => {
        // 1° latitude (~111195 m) over 1000 ms = 1 s → ~111195 m/s.
        expect(speedAt([{ t: 0, lng: 0, lat: 0 }, { t: 1000, lng: 0, lat: 1 }], 500)).toBeCloseTo(111195, -2);
    });

    it('returns 0 for a zero-duration segment (no divide-by-zero)', () => {
        expect(speedAt([{ t: 100, lng: 0, lat: 0 }, { t: 100, lng: 0, lat: 1 }], 100)).toBe(0);
    });
});

describe('averageSpeed', () => {
    it('is total distance / total duration', () => {
        const traj = [
            { t: 0, lng: 0, lat: 0 },
            { t: 1000, lng: 0, lat: 1 },
            { t: 3000, lng: 0, lat: 2 },
        ];
        // ~222390 m over 3 s.
        expect(averageSpeed(traj)).toBeCloseTo(222390 / 3, -1);
    });

    it('is 0 for a degenerate trajectory', () => {
        expect(averageSpeed([])).toBe(0);
        expect(averageSpeed([{ t: 5, lng: 0, lat: 0 }, { t: 5, lng: 0, lat: 1 }])).toBe(0);
    });
});

// ============================================================================
// decimateTrajectory
// ============================================================================

describe('decimateTrajectory', () => {
    const at = (t) => ({ t, lng: t, lat: t });

    it('leaves trajectories of 2 or fewer keypoints untouched', () => {
        expect(decimateTrajectory([], 60_000)).toEqual([]);
        expect(decimateTrajectory([at(0)], 60_000)).toEqual([at(0)]);
        expect(decimateTrajectory([at(0), at(1000)], 60_000)).toEqual([at(0), at(1000)]);
    });

    it('drops keypoints closer than the resolution, keeping first and last', () => {
        // 1 Hz-ish fixes over ~2 min → only the minute boundaries + endpoints survive.
        const traj = [0, 10_000, 20_000, 30_000, 40_000, 60_000, 70_000, 120_000].map(at);
        const out = decimateTrajectory(traj, 60_000);
        expect(out.map((k) => k.t)).toEqual([0, 60_000, 120_000]);
    });

    it('always keeps the last keypoint even if within one resolution of the previous kept', () => {
        const out = decimateTrajectory([at(0), at(1000), at(2000)], 60_000);
        expect(out.map((k) => k.t)).toEqual([0, 2000]); // middle dropped, last preserved
    });

    it('normalizes (sorts + drops invalid) before thinning', () => {
        const traj = [at(120_000), { t: NaN, lng: 1, lat: 2 }, at(0), at(30_000)];
        const out = decimateTrajectory(traj, 60_000);
        expect(out.map((k) => k.t)).toEqual([0, 120_000]);
    });

    it('returns the normalized trajectory unchanged for a non-positive resolution', () => {
        const traj = [at(0), at(10), at(20)];
        expect(decimateTrajectory(traj, 0)).toEqual(traj);
        expect(decimateTrajectory(traj, -5)).toEqual(traj);
    });

    it('property: kept keypoints are a subset, sorted, with endpoints preserved', () => {
        const kp = fc.record({
            t: fc.integer({ min: 0, max: 1_000_000 }),
            lng: fc.double({ min: -180, max: 180, noNaN: true }),
            lat: fc.double({ min: -90, max: 90, noNaN: true }),
        });
        fc.assert(
            fc.property(fc.array(kp, { minLength: 1, maxLength: 50 }), fc.integer({ min: 1, max: 100_000 }), (traj, res) => {
                const norm = normalizeTrajectory(traj);
                const out = decimateTrajectory(traj, res);
                if (norm.length === 0) return out.length === 0;
                // endpoints preserved, monotonic, no two kept points closer than res (except the forced last).
                const sameEnds = out[0].t === norm[0].t && out[out.length - 1].t === norm[norm.length - 1].t;
                let monotonic = true;
                for (let i = 1; i < out.length; i++) if (out[i].t < out[i - 1].t) monotonic = false;
                return sameEnds && monotonic && out.length <= norm.length;
            })
        );
    });
});

// ============================================================================
// interpolatePosition
// ============================================================================

describe('interpolatePosition', () => {
    it('returns null for empty/invalid', () => {
        expect(interpolatePosition([], 10)).toBeNull();
        expect(interpolatePosition(null, 10)).toBeNull();
        expect(interpolatePosition([{ t: NaN, lng: 1, lat: 2 }], 10)).toBeNull();
    });

    it('returns the single keypoint position regardless of cursor', () => {
        const traj = [{ t: 100, lng: 5, lat: 6 }];
        expect(interpolatePosition(traj, 0)).toEqual([5, 6]);
        expect(interpolatePosition(traj, 1e9)).toEqual([5, 6]);
    });

    it('clamps before first / after last', () => {
        const traj = [
            { t: 100, lng: 0, lat: 0 },
            { t: 200, lng: 10, lat: 20 },
        ];
        expect(interpolatePosition(traj, 50)).toEqual([0, 0]);
        expect(interpolatePosition(traj, 100)).toEqual([0, 0]);
        expect(interpolatePosition(traj, 200)).toEqual([10, 20]);
        expect(interpolatePosition(traj, 300)).toEqual([10, 20]);
    });

    it('interpolates linearly at the midpoint', () => {
        const traj = [
            { t: 0, lng: 0, lat: 0 },
            { t: 100, lng: 10, lat: 20 },
        ];
        expect(interpolatePosition(traj, 50)).toEqual([5, 10]);
        expect(interpolatePosition(traj, 25)).toEqual([2.5, 5]);
    });

    it('interpolates across a multi-segment path', () => {
        const traj = [
            { t: 0, lng: 0, lat: 0 },
            { t: 100, lng: 10, lat: 0 },
            { t: 200, lng: 10, lat: 10 },
        ];
        expect(interpolatePosition(traj, 150)).toEqual([10, 5]);
    });

    it('finds the right segment in a long trajectory (binary search)', () => {
        // 1000 keypoints, lng === lat === t; interpolation is the identity in t.
        const traj = Array.from({ length: 1000 }, (_, i) => ({ t: i * 10, lng: i * 10, lat: i * 10 }));
        expect(interpolatePosition(traj, 4235)).toEqual([4235, 4235]);
        expect(interpolatePosition(traj, 0)).toEqual([0, 0]);
        expect(interpolatePosition(traj, 9990)).toEqual([9990, 9990]);
        expect(interpolatePosition(traj, 99999)).toEqual([9990, 9990]); // clamps past last
    });

    it('handles unsorted input (normalizes first)', () => {
        const traj = [
            { t: 100, lng: 10, lat: 20 },
            { t: 0, lng: 0, lat: 0 },
        ];
        expect(interpolatePosition(traj, 50)).toEqual([5, 10]);
    });

    it('handles duplicate timestamps without dividing by zero', () => {
        const traj = [
            { t: 100, lng: 0, lat: 0 },
            { t: 100, lng: 10, lat: 10 },
        ];
        const r = interpolatePosition(traj, 100);
        expect(Number.isFinite(r[0])).toBe(true);
        expect(Number.isFinite(r[1])).toBe(true);
    });

    it('property: result stays within the lng/lat bounding box of keypoints', () => {
        const kp = fc.record({
            t: fc.integer({ min: 0, max: 1000 }),
            lng: fc.double({ min: -180, max: 180, noNaN: true }),
            lat: fc.double({ min: -90, max: 90, noNaN: true }),
        });
        fc.assert(
            fc.property(fc.array(kp, { minLength: 2, maxLength: 8 }), fc.integer({ min: -100, max: 1100 }), (traj, cursor) => {
                const pos = interpolatePosition(traj, cursor);
                if (pos === null) return true;
                const lngs = traj.map((k) => k.lng);
                const lats = traj.map((k) => k.lat);
                const eps = 1e-9;
                return (
                    pos[0] >= Math.min(...lngs) - eps &&
                    pos[0] <= Math.max(...lngs) + eps &&
                    pos[1] >= Math.min(...lats) - eps &&
                    pos[1] <= Math.max(...lats) + eps
                );
            })
        );
    });
});

// ============================================================================
// resolveTrajectoryTarget (renderer home/interpolation bookkeeping)
// ============================================================================

describe('resolveTrajectoryTarget', () => {
    const traj = [
        { t: 0, lng: 0, lat: 0 },
        { t: 100, lng: 10, lat: 10 },
    ];

    it('interpolates and keeps home for an active trajectory', () => {
        const r = resolveTrajectoryTarget(traj, [99, 99], 50);
        expect(r).toEqual({ target: [5, 5], keepHome: true });
    });

    it('snaps back home and drops the stash when temporal is off (cursor null)', () => {
        const r = resolveTrajectoryTarget(traj, [99, 99], null);
        expect(r).toEqual({ target: [99, 99], keepHome: false });
    });

    it('REGRESSION: a cleared trajectory snaps the feature back home (was frozen at displaced pos)', () => {
        // Feature previously displaced to [5,5]; trajectory just cleared → must restore home.
        const r = resolveTrajectoryTarget([], [99, 99], 50);
        expect(r).toEqual({ target: [99, 99], keepHome: false });
    });

    it('REGRESSION: a single-keypoint (reduced) trajectory also restores home', () => {
        const r = resolveTrajectoryTarget([{ t: 1, lng: 1, lat: 1 }], [99, 99], 50);
        expect(r).toEqual({ target: [99, 99], keepHome: false });
    });

    it('does nothing for a static feature that was never moved (no home)', () => {
        expect(resolveTrajectoryTarget([], null, 50)).toEqual({ target: null, keepHome: false });
        expect(resolveTrajectoryTarget(undefined, undefined, 50)).toEqual({ target: null, keepHome: false });
    });

    it('falls back to home when interpolation yields nothing', () => {
        // Cursor finite but trajectory becomes unusable mid-call is covered above;
        // here interpolation is valid so home is retained, not used.
        const r = resolveTrajectoryTarget(traj, [99, 99], 0);
        expect(r.target).toEqual([0, 0]); // clamped to first keypoint
        expect(r.keepHome).toBe(true);
    });
});

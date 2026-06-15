import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    isTemporallyVisible,
    normalizeTrajectory,
    interpolatePosition,
    resolveTrajectoryTarget,
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

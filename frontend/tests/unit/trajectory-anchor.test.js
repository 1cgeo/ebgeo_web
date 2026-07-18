import { describe, it, expect } from 'vitest';
import { repositionAnchor, reanchorOnMove } from '../../src/js/temporal/trajectory-anchor.js';

describe('repositionAnchor', () => {
    it('returns null when there is no trajectory or anchor', () => {
        expect(repositionAnchor(undefined, 1, 2)).toBeNull();
        expect(repositionAnchor(null, 1, 2)).toBeNull();
        expect(repositionAnchor([], 1, 2)).toBeNull();
        // Only invalid keypoints → nothing to anchor.
        expect(repositionAnchor([{ t: NaN, lng: 0, lat: 0 }], 1, 2)).toBeNull();
    });

    it('returns null for non-finite coordinates', () => {
        const traj = [{ t: 1, lng: 0, lat: 0 }];
        expect(repositionAnchor(traj, NaN, 2)).toBeNull();
        expect(repositionAnchor(traj, 1, Infinity)).toBeNull();
    });

    it('returns null when the anchor already sits at the target', () => {
        const traj = [{ t: 10, lng: 5, lat: 6 }, { t: 20, lng: 7, lat: 8 }];
        expect(repositionAnchor(traj, 5, 6)).toBeNull();
    });

    it('moves the earliest keypoint, preserving its time and the rest', () => {
        const traj = [{ t: 200, lng: 7, lat: 8 }, { t: 100, lng: 5, lat: 6 }];
        const out = repositionAnchor(traj, 9, 9);
        // Normalized chronological order: kp0 is t=100 (moved), kp1 is t=200 (intact).
        expect(out).toEqual([
            { t: 100, lng: 9, lat: 9 },
            { t: 200, lng: 7, lat: 8 },
        ]);
    });

    it('does not mutate the input array', () => {
        const traj = [{ t: 100, lng: 5, lat: 6 }, { t: 200, lng: 7, lat: 8 }];
        const snapshot = JSON.parse(JSON.stringify(traj));
        repositionAnchor(traj, 1, 1);
        expect(traj).toEqual(snapshot);
    });

    it('repositions the chronologically-first keypoint even when out of array order', () => {
        const traj = [
            { t: 300, lng: 3, lat: 3 },
            { t: 50, lng: 1, lat: 1 },
            { t: 150, lng: 2, lat: 2 },
        ];
        const out = repositionAnchor(traj, 0, 0);
        expect(out[0]).toEqual({ t: 50, lng: 0, lat: 0 });
        expect(out[1]).toEqual({ t: 150, lng: 2, lat: 2 });
        expect(out[2]).toEqual({ t: 300, lng: 3, lat: 3 });
    });
});

describe('reanchorOnMove', () => {
    const traj = () => [{ t: 100, lng: 5, lat: 6 }, { t: 200, lng: 7, lat: 8 }];

    it('returns null without a trajectory', () => {
        expect(reanchorOnMove({}, [1, 2])).toBeNull();
        expect(reanchorOnMove({ trajetoria: [] }, [1, 2])).toBeNull();
    });

    it('returns null for invalid coords', () => {
        expect(reanchorOnMove({ trajetoria: traj() }, [NaN, 2])).toBeNull();
        expect(reanchorOnMove({ trajetoria: traj() }, null)).toBeNull();
    });

    it('re-anchors a non-displaced feature (no _temporalHome) without touching home', () => {
        const patch = reanchorOnMove({ trajetoria: traj() }, [9, 9]);
        expect(patch).toEqual({ trajetoria: [{ t: 100, lng: 9, lat: 9 }, { t: 200, lng: 7, lat: 8 }] });
        expect(patch._temporalHome).toBeUndefined();
    });

    it('re-anchors a displaced feature parked at home, moving _temporalHome too', () => {
        const props = { trajetoria: traj(), _temporalHome: [5, 6] };
        const patch = reanchorOnMove(props, [9, 9], [5, 6]);
        expect(patch.trajetoria[0]).toEqual({ t: 100, lng: 9, lat: 9 });
        expect(patch._temporalHome).toEqual([9, 9]);
    });

    it('does NOT re-anchor a feature displaced mid-trajectory (transient drag)', () => {
        const props = { trajetoria: traj(), _temporalHome: [5, 6] };
        // Currently displayed at an interpolated mid point, not at home.
        expect(reanchorOnMove(props, [9, 9], [6, 7])).toBeNull();
    });

    it('returns null when the anchor already matches the new home', () => {
        expect(reanchorOnMove({ trajetoria: traj() }, [5, 6])).toBeNull();
    });
});

import { describe, it, expect } from 'vitest';
import {
    buildPathCollection,
    buildHandleCollection,
    moveKeypoint,
    insertKeypointAtSegment,
    removeKeypoint,
} from '../../src/js/temporal/trajectory-tool/trajectory-edit-geometry.js';

describe('buildPathCollection', () => {
    it('returns an empty collection for fewer than 2 keypoints', () => {
        expect(buildPathCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
        expect(buildPathCollection([{ t: 1, lng: 0, lat: 0 }])).toEqual({ type: 'FeatureCollection', features: [] });
        expect(buildPathCollection(null)).toEqual({ type: 'FeatureCollection', features: [] });
    });

    it('builds a single time-ordered LineString through the keypoints', () => {
        const fc = buildPathCollection([
            { t: 200, lng: 1, lat: 1 },
            { t: 100, lng: 0, lat: 0 },
        ]);
        expect(fc.features).toHaveLength(1);
        expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
    });

    it('drops invalid keypoints before building the path', () => {
        const fc = buildPathCollection([
            { t: 1, lng: 0, lat: 0 },
            { t: NaN, lng: 5, lat: 5 },
            { t: 2, lng: 1, lat: 1 },
        ]);
        expect(fc.features[0].geometry.coordinates).toEqual([[0, 0], [1, 1]]);
    });
});

describe('buildHandleCollection', () => {
    const traj = [
        { t: 100, lng: 0, lat: 0 },
        { t: 200, lng: 10, lat: 0 },
        { t: 300, lng: 10, lat: 10 },
    ];

    it('emits a numbered vertex handle per keypoint (in time order)', () => {
        const vertices = buildHandleCollection(traj).features.filter((f) => f.properties.handleType === 'vertex');
        expect(vertices).toHaveLength(3);
        expect(vertices.map((f) => f.properties.index)).toEqual([0, 1, 2]);
        expect(vertices.map((f) => f.properties.label)).toEqual(['1', '2', '3']);
        expect(vertices[1].geometry.coordinates).toEqual([10, 0]);
    });

    it('emits a midpoint handle per segment at the segment centre', () => {
        const mids = buildHandleCollection(traj).features.filter((f) => f.properties.handleType === 'midpoint');
        expect(mids).toHaveLength(2);
        expect(mids[0].geometry.coordinates).toEqual([5, 0]);
        expect(mids[0].properties.index).toBe(0);
        expect(mids[1].geometry.coordinates).toEqual([10, 5]);
    });

    it('normalizes (sorts) before building handles', () => {
        const vertices = buildHandleCollection([
            { t: 300, lng: 9, lat: 9 },
            { t: 100, lng: 1, lat: 1 },
        ]).features.filter((f) => f.properties.handleType === 'vertex');
        expect(vertices.map((f) => f.geometry.coordinates)).toEqual([[1, 1], [9, 9]]);
    });
});

describe('moveKeypoint', () => {
    const traj = [
        { t: 100, lng: 0, lat: 0 },
        { t: 200, lng: 10, lat: 10 },
    ];

    it('moves a vertex, keeping its time', () => {
        expect(moveKeypoint(traj, 0, 5, 6)).toEqual([
            { t: 100, lng: 5, lat: 6 },
            { t: 200, lng: 10, lat: 10 },
        ]);
    });

    it('returns null for an invalid index or position', () => {
        expect(moveKeypoint(traj, 5, 1, 1)).toBeNull();
        expect(moveKeypoint(traj, 0, NaN, 1)).toBeNull();
    });

    it('does not mutate the input', () => {
        const copy = traj.map((k) => ({ ...k }));
        moveKeypoint(traj, 0, 99, 99);
        expect(traj).toEqual(copy);
    });
});

describe('insertKeypointAtSegment', () => {
    const traj = [
        { t: 100, lng: 0, lat: 0 },
        { t: 200, lng: 10, lat: 0 },
        { t: 400, lng: 10, lat: 10 },
    ];

    it('inserts a keypoint with the average time of its neighbours', () => {
        const out = insertKeypointAtSegment(traj, 0, 5, 1);
        expect(out).toHaveLength(4);
        expect(out[1]).toEqual({ t: 150, lng: 5, lat: 1 }); // (100+200)/2
        expect(out.map((k) => k.t)).toEqual([100, 150, 200, 400]); // stays sorted
    });

    it('uses the right neighbours for a later segment', () => {
        const out = insertKeypointAtSegment(traj, 1, 12, 5);
        expect(out[2]).toEqual({ t: 300, lng: 12, lat: 5 }); // (200+400)/2
    });

    it('returns null for an out-of-range segment', () => {
        expect(insertKeypointAtSegment(traj, 2, 1, 1)).toBeNull(); // only segments 0,1
        expect(insertKeypointAtSegment(traj, -1, 1, 1)).toBeNull();
    });
});

describe('removeKeypoint', () => {
    const traj = [
        { t: 100, lng: 0, lat: 0 },
        { t: 200, lng: 10, lat: 0 },
        { t: 300, lng: 10, lat: 10 },
    ];

    it('removes the keypoint at the given index', () => {
        expect(removeKeypoint(traj, 1).map((k) => k.t)).toEqual([100, 300]);
    });

    it('can reduce below 2 keypoints (feature then snaps home)', () => {
        const one = removeKeypoint([{ t: 1, lng: 0, lat: 0 }, { t: 2, lng: 1, lat: 1 }], 0);
        expect(one).toEqual([{ t: 2, lng: 1, lat: 1 }]);
    });

    it('returns null for an invalid index', () => {
        expect(removeKeypoint(traj, 9)).toBeNull();
    });
});

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    buildPathCollection,
    buildHandleCollection,
    moveKeypoint,
    insertKeypointAtSegment,
    removeKeypoint,
    isInAnchorRingHole,
    grabOffset,
    ANCHOR_RING_RADIUS_PX,
    ANCHOR_RING_STROKE_PX,
    ANCHOR_RING_HOLE_PX,
} from '../../src/js/temporal/trajectory-tool/trajectory-edit-geometry.js';

/** Screen coordinates a canvas can hold, with room for a drag off its edge. */
const px = () => fc.double({ min: -5000, max: 5000, noNaN: true });

describe('isInAnchorRingHole: the hole of the departure ring is the feature\'s', () => {
    const centre = { x: 400, y: 300 };

    it('the centre itself, where a person grabs the symbol, is in the hole', () => {
        expect(isInAnchorRingHole(centre, centre)).toBe(true);
        expect(isInAnchorRingHole({ x: 411.9, y: 300 }, centre)).toBe(true);
    });

    it('the boundary is the ring\'s: exactly the hole radius is out, in any direction', () => {
        expect(isInAnchorRingHole({ x: 412, y: 300 }, centre)).toBe(false);
        expect(isInAnchorRingHole({ x: 400, y: 288 }, centre)).toBe(false);
        // 3-4-5 triangle scaled to 12: the diagonal reads the same distance as the axis.
        expect(isInAnchorRingHole({ x: 407.2, y: 309.6 }, centre)).toBe(false);
        expect(isInAnchorRingHole({ x: 407.1, y: 309.5 }, centre)).toBe(true);
    });

    it('every pixel of the PAINTED ring is outside the hole, so the ring that is seen is the handle', () => {
        // MapLibre paints the stroke outside the radius: the band runs from RADIUS to RADIUS + STROKE.
        expect(ANCHOR_RING_HOLE_PX).toBeLessThan(ANCHOR_RING_RADIUS_PX);
        for (let r = ANCHOR_RING_RADIUS_PX; r <= ANCHOR_RING_RADIUS_PX + ANCHOR_RING_STROKE_PX; r += 0.5) {
            expect(isInAnchorRingHole({ x: centre.x - r, y: centre.y }, centre), `raio ${r}`).toBe(false);
        }
    });

    it('reads [x, y] pairs as well as {x, y} points (the context menu hands a pair)', () => {
        expect(isInAnchorRingHole([405, 300], [400, 300])).toBe(true);
        expect(isInAnchorRingHole([420, 300], { x: 400, y: 300 })).toBe(false);
    });

    it.each([
        ['x NaN', { x: NaN, y: 300 }, centre],
        ['x Infinity', { x: Infinity, y: 300 }, centre],
        ['centre -Infinity', centre, { x: -Infinity, y: 300 }],
        ['null point', null, centre],
        ['undefined centre', centre, undefined],
        ['null coordinate in a pair', [null, null], [0, 0]],
        ['string coordinate', { x: '400', y: '300' }, centre],
        ['empty pair', [], centre],
    ])('%s: not in the hole, so the press stays the handle\'s as before the ring', (_r, point, c) => {
        expect(isInAnchorRingHole(point, c)).toBe(false);
    });

    it.each([
        ['zero', 0],
        ['negative', -5],
        ['NaN', NaN],
        ['Infinity', Infinity],
    ])('a hole of %s size contains nothing, not even the centre', (_r, hole) => {
        expect(isInAnchorRingHole(centre, centre, hole)).toBe(false);
    });

    it('INVARIANT: the answer depends only on the distance (translation and symmetry)', () => {
        fc.assert(fc.property(px(), px(), fc.double({ min: -40, max: 40, noNaN: true }), fc.double({ min: -40, max: 40, noNaN: true }),
            (cx, cy, dx, dy) => {
                const c = { x: cx, y: cy };
                const p = { x: cx + dx, y: cy + dy };
                const esperado = Math.hypot(p.x - c.x, p.y - c.y) < ANCHOR_RING_HOLE_PX;
                expect(isInAnchorRingHole(p, c)).toBe(esperado);
                expect(isInAnchorRingHole(c, p)).toBe(esperado);
            }));
    });
});

describe('grabOffset: the ring is dragged by where it was taken', () => {
    it('is the press minus the centre, in screen pixels', () => {
        expect(grabOffset({ x: 382, y: 300 }, { x: 400, y: 300 })).toEqual({ dx: -18, dy: 0 });
        expect(grabOffset([410, 290], [400, 300])).toEqual({ dx: 10, dy: -10 });
    });

    it('a press on the centre has no offset, and never a -0', () => {
        const o = grabOffset({ x: -0, y: -0 }, { x: 0, y: 0 });
        expect(Object.is(o.dx, -0)).toBe(false);
        expect(Object.is(o.dy, -0)).toBe(false);
        expect(o).toEqual({ dx: 0, dy: 0 });
    });

    it.each([
        ['NaN point', { x: NaN, y: 0 }, { x: 0, y: 0 }],
        ['Infinity centre', { x: 0, y: 0 }, { x: Infinity, y: 0 }],
        ['Infinity minus Infinity', { x: Infinity, y: 0 }, { x: Infinity, y: 0 }],
        ['null', null, null],
        ['undefined centre', { x: 1, y: 1 }, undefined],
    ])('%s: zero offset, the drag of before the ring (the handle follows the pointer)', (_r, point, centre) => {
        expect(grabOffset(point, centre)).toEqual({ dx: 0, dy: 0 });
    });

    it('ROUND-TRIP: with the offset held, the handle moves by exactly what the pointer moved', () => {
        fc.assert(fc.property(px(), px(), px(), px(), px(), px(), (cx, cy, px0, py0, mx, my) => {
            const { dx, dy } = grabOffset({ x: px0, y: py0 }, { x: cx, y: cy });
            // The press itself puts the handle back on its centre (no jump on the first move)...
            expect(px0 - dx).toBeCloseTo(cx, 6);
            expect(py0 - dy).toBeCloseTo(cy, 6);
            // ...and a later pointer position carries the handle by the same displacement.
            expect((px0 + mx) - dx).toBeCloseTo(cx + mx, 6);
            expect((py0 + my) - dy).toBeCloseTo(cy + my, 6);
        }));
    });
});

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

import { describe, it, expect } from 'vitest';
import { StreetViewNavigator } from '../../src/js/street_view_tool/navigation/navigator.js';
import { StreetViewProjector } from '../../src/js/street_view_tool/navigation/projector.js';

/**
 * The direction layout does not depend on where the camera points, so the 360
 * render loop memoizes it. These tests pin the INVALIDATION: every input that can
 * change the layout (targets, camera config, FOV, canvas height) must produce a
 * recomputed layout with different CONTENT, not just a different call count — a
 * layout frozen on the previous photo would draw the previous photo's arrows.
 */

const WIDTH = 1200;
const HEIGHT = 800;
const FOV = 75;

/** Navigator stub carrying only what the layout path touches (no canvas, no WebGL). */
function navStub(targets, cameraConfig = { lon: 0, lat: 0, floor_level: 1 }) {
    const projector = new StreetViewProjector(WIDTH, HEIGHT);
    projector.setCameraConfig(cameraConfig);
    const nav = {
        projector,
        cameraConfig,
        targets,
        calls: 0,
        _directionLayoutCache: null,
        resolveTargetVector: StreetViewNavigator.prototype.resolveTargetVector,
        deltaDeAndar: StreetViewNavigator.prototype.deltaDeAndar,
        directionLayoutFor: StreetViewNavigator.prototype.directionLayoutFor,
        layoutDirections(...args) {
            nav.calls++;
            return StreetViewNavigator.prototype.layoutDirections.apply(nav, args);
        },
    };
    return nav;
}

/** A target as the API delivers it: bearing/distance already resolved. */
function target(id, bearing, distance, extra = {}) {
    return { id, bearing, distance, floor_level: 1, ...extra };
}

describe('directionLayoutFor — memo by input identity', () => {
    it('computes once and reuses the same layout while nothing changes', () => {
        const nav = navStub([target('a', 0, 10), target('b', 90, 20)]);

        const first = nav.directionLayoutFor(FOV);
        const second = nav.directionLayoutFor(FOV);
        const third = nav.directionLayoutFor(FOV);

        expect(nav.calls).toBe(1);
        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(first.get('a').radius).toBeGreaterThan(0);
    });

    it('recomputes when the photo changes the target list', () => {
        const nav = navStub([target('a', 0, 10)]);
        const before = nav.directionLayoutFor(FOV);
        expect(before.has('novo')).toBe(false);

        // setPhoto replaces the array (never mutates it in place).
        nav.targets = [target('a', 0, 10), target('novo', 180, 30)];
        const after = nav.directionLayoutFor(FOV);

        expect(nav.calls).toBe(2);
        expect(after).not.toBe(before);
        expect(after.has('novo')).toBe(true);
    });

    it('recomputes when the camera config changes the floor step', () => {
        const alvo = target('a', 0, 10, { floor_level: 3 });
        const nav = navStub([alvo], { lon: 0, lat: 0, floor_level: 3 });
        const mesmoAndar = nav.directionLayoutFor(FOV).get('a').elevationDeg;

        // Same photo position, one floor below the target: the icon must move to
        // the other side of the horizon.
        nav.cameraConfig = { lon: 0, lat: 0, floor_level: 1 };
        const subindo = nav.directionLayoutFor(FOV).get('a').elevationDeg;

        expect(nav.calls).toBe(2);
        expect(subindo).toBeGreaterThan(0);
        expect(subindo).not.toBeCloseTo(mesmoAndar, 6);
    });

    it('recomputes on a zoom (FOV change) with a different icon radius', () => {
        const nav = navStub([target('a', 0, 10)]);
        const wide = nav.directionLayoutFor(FOV).get('a').radius;
        const zoomed = nav.directionLayoutFor(FOV / 2).get('a').radius;

        expect(nav.calls).toBe(2);
        expect(zoomed).toBeGreaterThan(wide); // angular size, so zooming grows the icon

        // And going back to the first FOV recomputes rather than returning the
        // zoomed layout (the memo holds one entry, keyed by the current inputs).
        expect(nav.directionLayoutFor(FOV).get('a').radius).toBeCloseTo(wide, 10);
        expect(nav.calls).toBe(3);
    });

    it('recomputes after a resize, because the radius is in pixels', () => {
        const nav = navStub([target('a', 0, 10)]);
        const before = nav.directionLayoutFor(FOV).get('a').radius;

        nav.projector.resize(WIDTH / 2, HEIGHT / 2);
        const after = nav.directionLayoutFor(FOV).get('a').radius;

        expect(nav.calls).toBe(2);
        expect(after).toBeCloseTo(before / 2, 6);
    });

    it('handles a photo with no targets, and still recomputes when targets arrive', () => {
        const nav = navStub([]);
        const empty = nav.directionLayoutFor(FOV);

        expect(empty.size).toBe(0);
        expect(nav.directionLayoutFor(FOV)).toBe(empty);
        expect(nav.calls).toBe(1);

        nav.targets = [target('a', 0, 10)];
        expect(nav.directionLayoutFor(FOV).size).toBe(1);
        expect(nav.calls).toBe(2);
    });

    it('keeps the layout identical to the uncached computation', () => {
        const targets = [target('a', 0, 10), target('b', 2, 12), target('c', 120, 40)];
        const nav = navStub(targets);
        const cached = nav.directionLayoutFor(FOV);
        const direct = StreetViewNavigator.prototype.layoutDirections.call(nav, targets, FOV);

        expect([...cached.keys()]).toEqual([...direct.keys()]);
        for (const [id, placement] of direct) {
            expect(cached.get(id)).toEqual(placement);
        }
    });
});

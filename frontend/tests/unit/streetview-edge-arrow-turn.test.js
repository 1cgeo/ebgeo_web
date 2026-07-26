// Path: tests/unit/streetview-edge-arrow-turn.test.js
//
// An EDGE ARROW must TURN the view, never travel.
//
// The 360 navigator draws two different things for a neighbouring photo: a sphere
// when the photo is inside the field of view (that one IS the target — clicking it
// walks there), and an arrow pinned to the screen edge when it is not. The arrow is
// a POINTER AT something you cannot see; acting on it used to call navigateToTarget,
// so the operator was moved to a place they had never laid eyes on, losing their
// bearings with no way to preview.
//
// This pins the DECISION, which is the part a screenshot cannot prove: clicking an
// off-screen marker and clicking empty space both leave the photo unchanged, so
// "the panorama did not change" is true whether the branch works or not.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replaced wholesale so the dynamic import inside turnToTarget resolves to a spy
// (and so the real viewer, with Three.js and a WebGL context, never loads here).
const turnViewBy = vi.fn();
vi.mock('../../src/js/street_view_tool/street_view_viewer.js', () => ({
    turnViewBy: (...args) => turnViewBy(...args),
}));

import { StreetViewNavigator } from '../../src/js/street_view_tool/navigation/navigator.js';

/**
 * Minimal stand-in for a live navigator: only what handleNavigationClick reads.
 * The method is invoked off the prototype so no canvas/WebGL is constructed.
 */
function makeNav(hit) {
    return {
        markerToolActive: false,
        selectedPOIId: null,
        cameraConfig: { img: 'FOTO_ATUAL' },
        hitTester: { testPoint: () => hit },
        turnToTarget: vi.fn(),
        navigateToTarget: vi.fn(),
        selectPOI: vi.fn(),
        deselectPOI: vi.fn(),
    };
}

const call = (nav) => StreetViewNavigator.prototype.handleNavigationClick.call(nav, 10, 20);

describe('handleNavigationClick — edge arrow vs sphere', () => {
    let nav;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('TURNS towards an off-screen navigation target and does not travel', () => {
        nav = makeNav({ type: 'navigation', offscreen: true, azimuthRelDeg: -47, data: { img: 'VIZINHA' } });
        const result = call(nav);

        expect(nav.turnToTarget).toHaveBeenCalledTimes(1);
        expect(nav.navigateToTarget).not.toHaveBeenCalled();
        expect(result.type).toBe('turn');
    });

    it('passes the marker along, so the turn knows HOW FAR to swing', () => {
        const marker = { type: 'navigation', offscreen: true, azimuthRelDeg: 62, data: { img: 'VIZINHA' } };
        nav = makeNav(marker);
        call(nav);

        // The azimuth is the arrow's entire content; dropping it would turn by nothing.
        expect(nav.turnToTarget).toHaveBeenCalledWith(marker);
        expect(nav.turnToTarget.mock.calls[0][0].azimuthRelDeg).toBe(62);
    });

    it('TRAVELS to an on-screen navigation target (the sphere keeps its meaning)', () => {
        const target = { img: 'VIZINHA' };
        nav = makeNav({ type: 'navigation', offscreen: false, sphere: true, data: target });
        const result = call(nav);

        expect(nav.navigateToTarget).toHaveBeenCalledWith(target);
        expect(nav.turnToTarget).not.toHaveBeenCalled();
        expect(result.type).toBe('navigation');
    });

    it('a marker with no offscreen flag at all still travels (older marker shape)', () => {
        nav = makeNav({ type: 'navigation', data: { img: 'VIZINHA' } });
        call(nav);

        expect(nav.navigateToTarget).toHaveBeenCalledTimes(1);
        expect(nav.turnToTarget).not.toHaveBeenCalled();
    });

    it('does neither when the click lands on empty space', () => {
        nav = makeNav(null);
        const result = call(nav);

        expect(nav.turnToTarget).not.toHaveBeenCalled();
        expect(nav.navigateToTarget).not.toHaveBeenCalled();
        expect(result).toBe(null);
    });
});

describe('turnToTarget', () => {
    beforeEach(() => {
        turnViewBy.mockClear();
    });

    it('turns the view by the marker azimuth, sign preserved', async () => {
        await StreetViewNavigator.prototype.turnToTarget.call({}, { azimuthRelDeg: -47.5 });
        await vi.waitFor(() => expect(turnViewBy).toHaveBeenCalledWith(-47.5));
    });

    it('never turns by a non-finite amount', async () => {
        // NaN/Infinity would reach `lon` and leave the panorama pointing nowhere,
        // with no error to explain it. `?? 0` would NOT guard NaN — hence Number.isFinite.
        for (const bad of [undefined, null, NaN, Infinity, -Infinity, 'x', {}]) {
            await StreetViewNavigator.prototype.turnToTarget.call({}, { azimuthRelDeg: bad });
        }
        await StreetViewNavigator.prototype.turnToTarget.call({}, null);
        await new Promise((r) => setTimeout(r, 20)); // let any stray dynamic import settle
        expect(turnViewBy).not.toHaveBeenCalled();
    });

    it('turns by exactly zero rather than skipping (a target dead ahead is finite)', async () => {
        await StreetViewNavigator.prototype.turnToTarget.call({}, { azimuthRelDeg: 0 });
        await vi.waitFor(() => expect(turnViewBy).toHaveBeenCalledWith(0));
    });
});

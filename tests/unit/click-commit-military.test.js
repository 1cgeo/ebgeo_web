// Path: tests/unit/click-commit-military.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * THE CLICK COMMITS THE VERTEX. No 250 ms hold.
 *
 * The hold existed so that a second click on the SAME spot re-armed the pending
 * point instead of adding a duplicate vertex. It is redundant: `isPointTooClose`
 * already rejects a point within `MIN_DISTANCE_METERS` of the last committed
 * vertex, and after an immediate commit that last vertex IS the one the first
 * click made. Same rejection, no waiting.
 *
 * What the hold cost was measured in real Chromium on 2026-09-04: 260 to 290 ms
 * from the click to the vertex. The preview hides it while the mouse keeps
 * moving, because it drew the pending point; on touch there is no preview, and
 * the finish button counted the vertex a quarter of a second late.
 *
 * The three cases below are the ones the decision turns on: a repeat click is
 * still ONE vertex, two distinct clicks 100 ms apart are TWO (the old timer kept
 * only the last of a quick pair), and one click is a vertex with NO clock
 * advanced at all.
 *
 * The near and far fixtures are checked against the tool's OWN
 * `MIN_DISTANCE_METERS` rather than against a 5 repeated here, so a change to
 * the threshold moves the test with the code instead of against it.
 */

vi.mock('../../src/js/snapping/snapping.service.js', () => ({
    getSnappingService: () => ({
        resolve: (map, point, lngLat) => ({ lng: lngLat.lng, lat: lngLat.lat, snapped: false, snapType: null }),
        showIndicator: () => {},
        hideIndicator: () => {},
    }),
    SnappingService: class {},
}));

/** A hand-driven rAF, installed after the fake timers so it survives them. */
const clock = {
    scheduled: new Map(),
    nextId: 0,
    install() {
        this.scheduled = new Map();
        this.nextId = 0;
        globalThis.requestAnimationFrame = (callback) => {
            const id = ++this.nextId;
            this.scheduled.set(id, callback);
            return id;
        };
        globalThis.cancelAnimationFrame = (id) => { this.scheduled.delete(id); };
    },
};

const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

beforeEach(() => {
    vi.useFakeTimers();
    clock.install();
});

afterEach(() => {
    vi.useRealTimers();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
});

/** Two clicks a hair apart, as a repeat click on a real mouse actually lands. */
const FIRST = [0, 0];
const JITTERED_REPEAT = [0.00001, 0];
/** A second vertex the user meant to draw. */
const ELSEWHERE = [0.01, 0];

/**
 * A control wired to a fake map, keeping its REAL geometry so the dedup under
 * test is the tool's own `isPointTooClose`, not a copy of it.
 * @param {Function} Control - The control class
 * @returns {Object} The control, the map and the finish button recorder
 */
function buildDrawingControl(Control) {
    const canvas = {
        style: {},
        addEventListener() {},
        removeEventListener() {},
        setPointerCapture() {},
        releasePointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    const listeners = new Map();
    const control = new Control({
        selectionManager: { getSelectedFeaturesByType: () => [], uiManager: {} },
    });
    const map = {
        getZoom: () => 10,
        getSource: () => ({ setData: () => {} }),
        getCanvas: () => canvas,
        getCanvasContainer: () => canvas,
        unproject: ([x, y]) => ({ lng: x, lat: y }),
        queryRenderedFeatures: () => [],
        dragPan: { enable() {}, disable() {} },
        on: (event, handler) => listeners.set(event, handler),
        off: (event, handler) => { if (listeners.get(event) === handler) listeners.delete(event); },
    };
    control.onAdd(map);
    control.isActive = true;

    const finishStates = [];
    control._finishButton = { updateState: (count, minimum) => finishStates.push([count, minimum]) };

    return { control, map, finishStates };
}

/** One left click at `[lng, lat]`. */
function click(control, [lng, lat]) {
    control.handleMapClick({ point: { x: lng, y: lat }, lngLat: { lng, lat } });
}

const TOOLS = [
    {
        name: 'boundary',
        path: '../../src/js/military_tools/boundary_tool/add_boundary_control.js',
    },
    {
        name: 'coordination line',
        path: '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js',
    },
];

describe.each(TOOLS)('the drawing click of the $name', ({ path }) => {
    async function setup() {
        const { default: Control } = await import(path);
        return buildDrawingControl(Control);
    }

    it('puts the two fixtures on either side of the tool own threshold', async () => {
        const { control } = await setup();
        const floor = control.geometry.MIN_DISTANCE_METERS;

        expect(control.geometry.calculateDistance(FIRST, JITTERED_REPEAT)).toBeLessThan(floor);
        expect(control.geometry.calculateDistance(FIRST, ELSEWHERE)).toBeGreaterThan(floor);
    });

    it('commits the vertex on the click, with no clock advanced', async () => {
        const { control } = await setup();

        click(control, FIRST);

        expect(control.drawPoints).toEqual([FIRST]);
        // Nothing is waiting to happen later: the hold is gone, not shortened.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps ONE vertex for two clicks on the same spot 100 ms apart', async () => {
        const { control } = await setup();

        click(control, FIRST);
        vi.advanceTimersByTime(100);
        click(control, JITTERED_REPEAT);
        vi.advanceTimersByTime(1000);

        // The dedup is `isPointTooClose` against the vertex the first click
        // committed, which is exactly what the hold was standing in for.
        expect(control.drawPoints).toEqual([FIRST]);
    });

    it('keeps ONE vertex for an exact repeat click too', async () => {
        const { control } = await setup();

        click(control, FIRST);
        click(control, FIRST);
        vi.advanceTimersByTime(1000);

        expect(control.drawPoints).toEqual([FIRST]);
    });

    it('keeps TWO vertices for two distinct clicks 100 ms apart', async () => {
        const { control } = await setup();

        click(control, FIRST);
        vi.advanceTimersByTime(100);
        click(control, ELSEWHERE);
        vi.advanceTimersByTime(1000);

        expect(control.drawPoints).toEqual([FIRST, ELSEWHERE]);
    });

    it('counts the vertex on the finish button at the click, not a timer later', async () => {
        const { control, finishStates } = await setup();

        click(control, FIRST);

        // This is what the 260 to 290 ms cost on touch, where no preview covers
        // for the wait: the button is the only feedback there is.
        expect(finishStates).toEqual([[1, 2]]);
    });

    it('finishes on the right click with the clicked vertices, and leaves no timer', async () => {
        const { control } = await setup();
        control.createFeature = async () => {};
        control.stopDrawing = () => {};

        click(control, FIRST);
        click(control, ELSEWHERE);
        await control.handleRightClick({
            preventDefault() {},
            stopPropagation() {},
            offsetX: 0.02,
            offsetY: 0,
        });

        expect(control.drawPoints).toEqual([FIRST, ELSEWHERE, [0.02, 0]]);
        expect(vi.getTimerCount()).toBe(0);
    });
});

// Path: tests/unit/drag-flush-military.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A handle drag that is BORN AND DIES INSIDE ONE FRAME.
 *
 * `pointerdown`, one `pointermove`, `pointerup`, and no frame in between. The
 * move only PARKS the pointer in the rAF gate, so `lastPreviewPosition` is
 * written by the frame callback and by nothing else; a `pointerup` that arrives
 * first reads it as null, skips the whole update block and leaves the feature
 * where it was. Nothing on screen says so: the user let go and the vertex did
 * not follow.
 *
 * That is not a corner case built to fail. A tap on a handle with a few pixels
 * of travel, a trackpad flick and a touch drag all land inside 16.7 ms.
 *
 * The fix is `flush()` at the top of the end-of-drag handler: it delivers the
 * parked pointer NOW and cancels the frame it had asked for. The second test in
 * each pair is the control, with a frame between the move and the release: it
 * passes with or without the flush, which is what makes the first one the
 * discriminator instead of a test that merely repeats the drag path.
 *
 * The geometry helper is a recorder, as in `preview-frame-gate-driven.test.js`:
 * what is under test is WHERE the feature ends up, not the turf maths.
 */

const snapping = vi.hoisted(() => ({
    resolveCalls: [],
    indicatorCalls: [],
    hideCalls: 0,
    reset() {
        this.resolveCalls.length = 0;
        this.indicatorCalls.length = 0;
        this.hideCalls = 0;
    },
}));

vi.mock('../../src/js/snapping/snapping.service.js', () => ({
    getSnappingService: () => ({
        resolve: (map, point, lngLat, excludeFeatureId = null) => {
            snapping.resolveCalls.push({ point, lngLat, excludeFeatureId });
            return { lng: lngLat.lng, lat: lngLat.lat, snapped: false, snapType: null };
        },
        showIndicator: (map, snap, type) => snapping.indicatorCalls.push({ snap, type }),
        hideIndicator: () => { snapping.hideCalls += 1; },
    }),
    SnappingService: class {},
}));

/** A hand-driven rAF: nothing runs until `frame()` is called. */
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
    frame() {
        const due = [...this.scheduled.values()];
        this.scheduled.clear();
        for (const callback of due) callback();
        return due.length;
    },
};

const originalRaf = globalThis.requestAnimationFrame;
const originalCancelRaf = globalThis.cancelAnimationFrame;

beforeEach(() => {
    snapping.reset();
    clock.install();
});

afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
});

/**
 * A control wired to a fake map, with its geometry replaced by a recorder.
 * Copied from `preview-frame-gate-driven.test.js`, which owns the original.
 * @param {Function} Control - The control class
 * @param {Object} geometry - The recorder to install
 * @param {Function} [prepare] - Runs on the control before `onAdd`
 * @returns {Object} The control, the map and the recorded writes
 */
function buildControl(Control, geometry, prepare) {
    const written = [];
    const listeners = new Map();
    const canvas = {
        style: {},
        addEventListener() {},
        removeEventListener() {},
        setPointerCapture() {},
        releasePointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    const control = new Control({
        selectionManager: { getSelectedFeaturesByType: () => [], uiManager: {} },
    });
    control.geometry = geometry;
    prepare?.(control);

    const map = {
        listeners,
        getZoom: () => 10,
        getSource: (name) => ({ setData: (data) => written.push({ name, data }) }),
        getCanvas: () => canvas,
        getCanvasContainer: () => canvas,
        unproject: ([x, y]) => ({ lng: x, lat: y }),
        queryRenderedFeatures: () => [],
        dragPan: { enable() {}, disable() {} },
        on: (event, handler) => listeners.set(event, handler),
        off: (event, handler) => { if (listeners.get(event) === handler) listeners.delete(event); },
    };
    control.onAdd(map);
    return { control, map, written };
}

/** Where the drag lets go. The fake `unproject` is the identity. */
const DROP = { x: 42, y: 17 };
const DROPPED_AT = [DROP.x, DROP.y];

/**
 * Cut the control off from the store, the panels and the source, and record what
 * the end of the drag tried to write into the main source.
 * @param {Object} control - The control under test
 * @returns {Array<Object>} The features handed to `forceUpdateMainSource`
 */
function silenceSideEffects(control) {
    const forced = [];
    control.forceUpdateMainSource = async (feature) => { forced.push(feature); };
    control.updateSelectionManagerFeature = () => {};
    control.updateDependentFeatures = async () => {};
    control.createEditHandles = () => {};
    control.updateUIAfterEdit = () => {};
    control.saveFeatureChanges = async () => {};
    return forced;
}

/** `pointerdown` on a handle, one `pointermove`, then `pointerup`. */
async function dragInOneFrame(control, { frameBetween = false } = {}) {
    control._onEditPointerDown({
        isPrimary: true, button: 0, clientX: 3, clientY: 3, pointerId: 1, preventDefault() {},
    });
    control._onEditPointerMove({ isPrimary: true, clientX: DROP.x, clientY: DROP.y, pointerId: 1 });
    if (frameBetween) clock.frame();
    await control._onEditPointerUp({ isPrimary: true, pointerId: 1 });
}

describe('the arrow handle drag inside one frame', () => {
    async function setup() {
        const { default: AddArrowControl } = await import(
            '../../src/js/military_tools/arrow_tool/add_arrow_control.js'
        );
        const built = buildControl(AddArrowControl, {
            generate: () => ({ type: 'Polygon', coordinates: [] }),
            calculatePreview: () => ({ geometry: {}, handles: [] }),
            updateFromHandle: (type, position) => ({
                properties: { id: 'arrow-1', movedTo: position },
                geometry: { type: 'Point', coordinates: position },
            }),
        });
        const feature = { properties: { id: 'arrow-1' }, geometry: {} };
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [{ properties: { handleType: 'vertex', index: 0 } }];
        return { ...built, forced: silenceSideEffects(built.control) };
    }

    it('moves the feature when down, move and up land in the same frame', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control);

        expect(forced).toHaveLength(1);
        expect(forced[0].geometry.coordinates).toEqual(DROPPED_AT);
        // The flush cancelled the frame it delivered: nothing is left pending.
        expect(clock.frame()).toBe(0);
    });

    it('still moves the feature when a frame did fire first', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control, { frameBetween: true });

        expect(forced).toHaveLength(1);
        expect(forced[0].geometry.coordinates).toEqual(DROPPED_AT);
    });
});

describe('the occupied front handle drag inside one frame', () => {
    async function setup() {
        const { default: AddOccupiedFrontControl } = await import(
            '../../src/js/military_tools/occupied_front_tool/add_occupied_front_control.js'
        );
        const built = buildControl(AddOccupiedFrontControl, {
            generate: (coordinates) => ({ type: 'LineString', coordinates }),
            normalizeBaseCoordinates: (coordinates) => coordinates.map(point => [...point]),
            updateFromHandle: () => ({ baseCoordinates: [[0, 0], [1, 1], [2, 2]], geometry: {} }),
            createHandles: () => [],
        });
        const feature = {
            properties: { id: 'of-1', baseCoordinates: [[0, 0], [1, 1], [2, 2]] },
            geometry: {},
        };
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [{ properties: { handleId: 'p2' } }];
        return { ...built, forced: silenceSideEffects(built.control) };
    }

    it('moves the feature when down, move and up land in the same frame', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control);

        expect(forced).toHaveLength(1);
        expect(forced[0].properties.baseCoordinates[1]).toEqual(DROPPED_AT);
        expect(clock.frame()).toBe(0);
    });

    it('still moves the feature when a frame did fire first', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control, { frameBetween: true });

        expect(forced).toHaveLength(1);
        expect(forced[0].properties.baseCoordinates[1]).toEqual(DROPPED_AT);
    });
});

describe('the boundary handle drag inside one frame', () => {
    async function setup() {
        const { default: AddBoundaryControl } = await import(
            '../../src/js/military_tools/boundary_tool/add_boundary_control.js'
        );
        const built = buildControl(AddBoundaryControl, {
            generate: (properties) => ({ type: 'LineString', coordinates: properties.baseCoordinates }),
            normalizeBaseCoordinates: (coordinates) => coordinates,
            createHandles: () => [],
            updateFromHandle: (type, position) => ({
                properties: { id: 'boundary-1', movedTo: position },
                geometry: { type: 'Point', coordinates: position },
            }),
        });
        const feature = {
            properties: { id: 'boundary-1', baseCoordinates: [[0, 0], [1, 1]] },
            geometry: {},
        };
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [
            { properties: { user_isEditingHandle: true, type: 'vertex', index: 0 } },
        ];
        return { ...built, forced: silenceSideEffects(built.control) };
    }

    it('moves the feature when down, move and up land in the same frame', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control);

        expect(forced).toHaveLength(1);
        expect(forced[0].geometry.coordinates).toEqual(DROPPED_AT);
        expect(clock.frame()).toBe(0);
    });

    it('still moves the feature when a frame did fire first', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control, { frameBetween: true });

        expect(forced).toHaveLength(1);
        expect(forced[0].geometry.coordinates).toEqual(DROPPED_AT);
    });
});

describe('the coordination line handle drag inside one frame', () => {
    async function setup() {
        const { default: AddCoordinationLineControl } = await import(
            '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js'
        );
        const built = buildControl(AddCoordinationLineControl, {
            generate: (properties) => ({ type: 'LineString', coordinates: properties.baseCoordinates }),
            normalizeBaseCoordinates: (coordinates) => coordinates,
            createHandles: () => [],
            updateFromHandle: (type, position) => ({
                properties: { id: 'cl-1', movedTo: position },
                geometry: { type: 'Point', coordinates: position },
            }),
        });
        const feature = { properties: { id: 'cl-1', baseCoordinates: [[0, 0], [1, 1]] }, geometry: {} };
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [
            { properties: { user_isEditingHandle: true, type: 'vertex', index: 0 } },
        ];
        return { ...built, forced: silenceSideEffects(built.control) };
    }

    it('moves the feature when down, move and up land in the same frame', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control);

        expect(forced).toHaveLength(1);
        expect(forced[0].geometry.coordinates).toEqual(DROPPED_AT);
        expect(clock.frame()).toBe(0);
    });

    it('still moves the feature when a frame did fire first', async () => {
        const { control, forced } = await setup();

        await dragInOneFrame(control, { frameBetween: true });

        expect(forced).toHaveLength(1);
        expect(forced[0].geometry.coordinates).toEqual(DROPPED_AT);
    });
});

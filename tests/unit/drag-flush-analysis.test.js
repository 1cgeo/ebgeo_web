// Path: tests/unit/drag-flush-analysis.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The drag that is born and dies inside ONE frame.
 *
 * `tests/unit/preview-frame-gate-driven.test.js` proves that a burst of pointer
 * events inside one frame is coalesced into a single draw. This file proves the
 * OTHER end of that gate: the gesture that never gets a frame at all.
 *
 * A handle drag whose `pointerdown`, `pointermove` and `pointerup` all land
 * inside the same frame parks a pointer that the scheduled callback never gets
 * to deliver. The end-of-drag handler reads `this.lastPreviewPosition`, which
 * only that callback writes, so before the fix of 2026-09-04 the whole edit was
 * dropped in silence: no exception, no console line, the handle simply snapped
 * back. `flush()` at the top of the handler delivers the parked pointer and
 * cancels the frame it was waiting for.
 *
 * Driven, not read as text: the control is built against a fake map and a
 * hand-driven `requestAnimationFrame`, and the frame is NEVER advanced between
 * the down and the up.
 */

const snapping = vi.hoisted(() => ({
    resolveCalls: [],
    hideCalls: 0,
    reset() {
        this.resolveCalls.length = 0;
        this.hideCalls = 0;
    },
}));

vi.mock('../../src/js/snapping/snapping.service.js', () => ({
    getSnappingService: () => ({
        resolve: (map, point, lngLat, excludeFeatureId = null) => {
            snapping.resolveCalls.push({ point, lngLat, excludeFeatureId });
            return { lng: lngLat.lng, lat: lngLat.lat, snapped: false, snapType: null };
        },
        showIndicator: () => {},
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
    get pendentes() {
        return this.scheduled.size;
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

/** Let the promise chains the handler starts (getData, the recalculation queue) run. */
const microtarefas = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A control wired to a fake map, with its geometry replaced by a recorder.
 * The shape is the one of `preview-frame-gate-driven.test.js`; the map here also
 * answers `getData` and `queryRenderedFeatures`, which the end of a handle drag
 * needs and a preview does not.
 *
 * @param {Function} Control - The control class
 * @param {Object} geometry - The recorder to install
 * @param {Function} [prepare] - Runs on the control before `onAdd`, for the one
 *   tool whose `onAdd` builds DOM (the visibility modal), which `node` has not got
 * @returns {Object} The control, the map, the recorded writes and the map's data
 */
function buildControl(Control, geometry, prepare) {
    const written = [];
    const listeners = new Map();
    const dados = new Map();
    const canvas = {
        style: {},
        addEventListener() {},
        removeEventListener() {},
        setPointerCapture() {},
        releasePointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    const selecionados = [];
    const control = new Control({
        selectionManager: {
            getSelectedFeaturesByType: () => [],
            updateSelectedFeature: (type, id, feature) => selecionados.push({ type, id, feature }),
            updateUI() {},
            uiManager: {},
        },
    });
    control.geometry = geometry;
    prepare?.(control);

    const map = {
        listeners,
        // The handles the next `queryRenderedFeatures` will answer with.
        alcas: [],
        getZoom: () => 10,
        getSource: (name) => ({
            setData: (data) => { written.push({ name, data }); dados.set(name, data); },
            getData: async () => dados.get(name) ?? { type: 'FeatureCollection', features: [] },
        }),
        getCanvas: () => canvas,
        getCanvasContainer: () => canvas,
        unproject: ([x, y]) => ({ lng: x, lat: y }),
        queryRenderedFeatures: () => map.alcas,
        dragPan: { enable() {}, disable() {} },
        on: (event, handler) => listeners.set(event, handler),
        off: (event, handler) => { if (listeners.get(event) === handler) listeners.delete(event); },
    };
    control.onAdd(map);
    return { control, map, written, dados, selecionados };
}

const pointer = (x, y) => ({ isPrimary: true, clientX: x, clientY: y, pointerId: 1, preventDefault() {} });

describe('the visibility handle drag', () => {
    async function setup() {
        const { default: AddVisibilityControl } = await import(
            '../../src/js/analysis_tools/visibility_tool/add_visibility_control.js'
        );
        const fromHandle = [];
        const previews = [];
        const built = buildControl(
            AddVisibilityControl,
            {
                isTerrainAvailable: () => true,
                normalizeFeatureProperties: (properties) => properties,
                normalizeCenter: (center) => center,
                calculatePreview: (handleId, position) => {
                    previews.push(position);
                    return { geometry: {}, handles: [[1, 1], [2, 2], [0, 0]] };
                },
                // The recorder derives the radius FROM the position, so the
                // assertion below reads the position the drag ended on and not a
                // constant this file wrote twice.
                updateFromHandle: (handleId, position) => {
                    fromHandle.push({ handleId, position });
                    return { radius: position[0] * 10, bearing: position[1], aperture: 60 };
                },
            },
            // `onAdd` builds the progress modal out of `document`, which `node`
            // has not got; the modal is not what is under test here.
            (control) => { control.createProgressModal = () => {}; },
        );

        const feature = {
            properties: { id: 'vis-1', center: [0, 0], radius: 100, bearing: 0, aperture: 60 },
            geometry: { type: 'Polygon', coordinates: [] },
        };
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        // The map source already holds the feature, so the write-back has
        // something to find and the assertion can read it there.
        built.dados.set('visibility', { type: 'FeatureCollection', features: [feature] });
        built.map.alcas = [{ properties: { handleId: 'radius' } }];

        // The viewshed recalculation is a terrain job with a modal; what is under
        // test is whether the drag REACHES it, and with which position.
        const recalculos = [];
        built.control.recalculateAfterParameterChange = async (features, center) => {
            recalculos.push({ ids: features.map((f) => f.properties.id), center });
        };

        return { ...built, feature, fromHandle, previews, recalculos };
    }

    it('applies the edit of a drag whose down, move and up land in the SAME frame', async () => {
        const { control, feature, fromHandle, recalculos, dados } = await setup();

        control._onEditPointerDown(pointer(5, 5));
        expect(control.isDraggingHandle).toBe(true);
        expect(control.activeHandleId).toBe('radius');

        control._onEditPointerMove(pointer(42, 17));

        // The whole point: the frame is scheduled and has NOT run. Before the
        // fix, `lastPreviewPosition` was still null right here, and stayed null.
        expect(clock.pendentes).toBe(1);
        expect(fromHandle).toHaveLength(0);
        expect(control.lastPreviewPosition).toBeNull();

        control._onEditPointerUp(pointer(42, 17));
        await microtarefas();

        expect(fromHandle).toEqual([{ handleId: 'radius', position: [42, 17] }]);
        // The snap of the drag was resolved once, excluding the dragged feature.
        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('vis-1');

        // The feature ends on the NEW position, in memory and in the map source.
        expect(feature.properties.radius).toBe(420);
        expect(feature.properties.bearing).toBe(17);
        const naFonte = dados.get('visibility').features[0];
        expect(naFonte.properties.radius).toBe(420);
        expect(naFonte.properties.bearing).toBe(17);

        // And the viewshed recalculation was queued for it.
        expect(recalculos).toEqual([{ ids: ['vis-1'], center: [0, 0] }]);

        // The frame the drag was waiting for is gone: no second draw after the up.
        expect(clock.frame()).toBe(0);
        expect(fromHandle).toHaveLength(1);
    });

    it('the drag state is cleared and the map given back, same frame or not', async () => {
        const { control } = await setup();

        control._onEditPointerDown(pointer(5, 5));
        control._onEditPointerMove(pointer(42, 17));
        control._onEditPointerUp(pointer(42, 17));
        await microtarefas();

        expect(control.isDraggingHandle).toBe(false);
        expect(control.activeHandleId).toBeNull();
        expect(control._activePointerId).toBeNull();
    });

    it('the ordinary drag, with a frame in the middle, still ends on the last position', async () => {
        const { control, feature, fromHandle, previews, recalculos } = await setup();

        control._onEditPointerDown(pointer(5, 5));
        control._onEditPointerMove(pointer(11, 11));
        control._onEditPointerMove(pointer(80, 90));
        expect(clock.frame()).toBe(1);

        // One frame, one preview, with the LAST position of the frame.
        expect(previews).toEqual([[80, 90]]);

        control._onEditPointerUp(pointer(80, 90));
        await microtarefas();

        expect(fromHandle).toEqual([{ handleId: 'radius', position: [80, 90] }]);
        expect(feature.properties.radius).toBe(800);
        expect(recalculos).toHaveLength(1);
        // The `flush` of the up had nothing parked: it redrew what was already
        // there and moved no position.
        expect(previews).toEqual([[80, 90], [80, 90]]);
    });

    it('a drag that never moved edits nothing, and does not throw', async () => {
        const { control, feature, fromHandle, recalculos } = await setup();

        control._onEditPointerDown(pointer(5, 5));
        control._onEditPointerUp(pointer(5, 5));
        await microtarefas();

        // No pointer was ever parked, so there is no position to edit from.
        expect(fromHandle).toHaveLength(0);
        expect(recalculos).toHaveLength(0);
        expect(feature.properties.radius).toBe(100);
        expect(control.isDraggingHandle).toBe(false);
    });
});

describe('the LOS tool', () => {
    /**
     * The LOS has NO handle drag: `getEditHandleSources()` is empty,
     * `hasEditHandle()` is false, and the control has no `_onEditPointerDown` /
     * `_onEditPointerUp` at all. Its `lastPreviewPosition` is read only inside
     * the frame callback that writes it, so the one-frame gesture cannot lose an
     * edit there. This is a tripwire, not a decoration: the day the LOS grows a
     * handle drag, this test fails and the `flush()` above has to be repeated in
     * its end-of-drag handler.
     */
    it('has no handle drag to lose, so there is nothing to flush', async () => {
        const { default: AddLOSControl } = await import('../../src/js/analysis_tools/los_tool/add_los_control.js');
        const { control } = buildControl(AddLOSControl, {
            generate: (coordinates) => ({ type: 'LineString', coordinates }),
            isTerrainAvailable: () => true,
        });

        expect(control.getEditHandleSources()).toEqual([]);
        expect(control.getEditHandleSource()).toBeNull();
        expect(control.hasEditHandle('los-1')).toBe(false);
        expect(control._onEditPointerDown).toBeUndefined();
        expect(control._onEditPointerUp).toBeUndefined();
        expect(control.isDraggingHandle).toBeUndefined();
    });
});

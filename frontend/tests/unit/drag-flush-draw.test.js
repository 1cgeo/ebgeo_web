// Path: tests/unit/drag-flush-draw.test.js

import { beforeAll, describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * A handle drag that is born and dies inside ONE frame.
 *
 * The rAF gate parks the pointer on the raw event and writes
 * `lastPreviewPosition` only inside the frame callback. A drag made of
 * `mousedown`, ONE `mousemove` and `mouseup` before the browser ever paints
 * therefore reaches the end handler with no position at all, and the feature
 * does not move: the whole edit is silently dropped. Before the gate the
 * position was written on the raw event, so the same drag moved the feature.
 *
 * The end handler has to `flush()` the gate first, which delivers the parked
 * pointer synchronously and cancels the frame that would have delivered it too
 * late. These tests drive the real controls with a hand-driven rAF that is
 * NEVER run, which is exactly the case the browser produces.
 */

const snapping = vi.hoisted(() => ({
    resolveCalls: [],
    reset() {
        this.resolveCalls.length = 0;
    },
}));

// The destination writes every migrated source through the diff dispatcher, whose real
// flush waits for a map settle signal a fake map never sends (2 s per flush, two flushes
// per forced write, and the 5 s test timeout kills it). The stand-in applies each add
// straight into the source, so what the test reads back is what the control asked for.
vi.mock('@layers/geojson-dispatcher.js', async () => {
    const { makeFakeDispatcherModule } = await import('../helpers/fake-geojson-dispatcher.js');
    return makeFakeDispatcherModule();
});

vi.mock('../../src/js/snapping/snapping.service.js', () => ({
    getSnappingService: () => ({
        resolve: (map, point, lngLat, excludeFeatureId = null) => {
            snapping.resolveCalls.push({ point, lngLat, excludeFeatureId });
            return { lng: lngLat.lng, lat: lngLat.lat, snapped: false, snapType: null };
        },
        showIndicator: () => {},
        hideIndicator: () => {},
    }),
    SnappingService: class {},
}));

// The persistence call at the end of the drag is not what is under test, and
// the real one talks to the store.
vi.mock('../../src/js/store', async (importOriginal) => ({
    ...(await importOriginal()),
    updateFeature: vi.fn(async () => {}),
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

/**
 * The first import of a control pulls the whole store graph, and on a loaded machine that
 * costs more than the 5 s a test gets. Paid inside the first test it kills it, and the
 * timed-out test then leaks its late async work into the next one, which fails on a count
 * that has nothing to do with the code. Measured here on 2026-09-04: two runs in three
 * failed that way while another job held the machine, zero after this hook. A hook has its
 * own budget, so the cost is paid once and out of the measurement. The four shapes joined
 * the list on 2026-09-05, when they got their own describes.
 */
const MODULOS_PESADOS = [
    '../../src/js/draw_tools/line_tool/add_line_control.js',
    '../../src/js/draw_tools/polygon_tool/add_polygon_control.js',
    '../../src/js/draw_tools/brush_tool/add_brush_control.js',
    '../../src/js/draw_tools/circle_tool/add_circle_control.js',
    '../../src/js/draw_tools/ellipse_tool/add_ellipse_control.js',
    '../../src/js/draw_tools/sector_tool/add_sector_control.js',
    '../../src/js/draw_tools/rectangle_tool/add_rectangle_control.js',
];

beforeAll(async () => {
    for (const modulo of MODULOS_PESADOS) await import(/* @vite-ignore */ modulo);
}, 120000);

beforeEach(() => {
    snapping.reset();
    clock.install();
});

afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
});

/**
 * A control wired to a fake map whose sources READ BACK what was written, which
 * `forceUpdateMainSource` needs (it does `getData()`, edits, `setData()`).
 *
 * Copied and widened from `tests/unit/preview-frame-gate-driven.test.js`, which
 * is shared with other work and is left untouched.
 *
 * @param {Function} Control - The control class
 * @param {Object} geometry - The geometry recorder to install
 * @param {Object} [seed] - Initial data per source id
 * @returns {Object} The control, the map, the recorded writes and the sources
 */
function buildControl(Control, geometry, seed = {}) {
    const written = [];
    const sources = new Map(Object.entries(seed));
    const canvas = {
        style: {},
        addEventListener() {},
        removeEventListener() {},
        setPointerCapture() {},
        releasePointerCapture() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    };
    const control = new Control({
        selectionManager: {
            getSelectedFeaturesByType: () => [],
            updateSelectedFeature: () => {},
            updateUI: () => {},
            uiManager: { updateSelectionHighlight: () => {}, updatePanels: () => {} },
        },
    });
    control.geometry = geometry;

    const map = {
        getZoom: () => 10,
        getSource: (name) => {
            if (!sources.has(name)) sources.set(name, { type: 'FeatureCollection', features: [] });
            return {
                setData: (data) => { sources.set(name, data); written.push({ name, data }); },
                getData: async () => sources.get(name),
            };
        },
        getCanvas: () => canvas,
        getCanvasContainer: () => canvas,
        unproject: ([x, y]) => ({ lng: x, lat: y }),
        queryRenderedFeatures: () => [],
        dragPan: { enable() {}, disable() {} },
        on: () => {},
        off: () => {},
    };
    control.onAdd(map);
    // Labels and measurements are DOM work, and neither is what is under test.
    control.updateFeatureMeasurement = () => {};
    return { control, map, written, sources };
}

/** The vertex handle the drag grabs, as `queryRenderedFeatures` returns it. */
const vertexHandle = { properties: { handleType: 'vertex', index: 0 } };

/** A geometry recorder that moves vertex 0 to the dragged position. */
function movingGeometry(build) {
    return {
        createHandles: () => [],
        calculatePreview: () => ({ geometry: {}, handles: [] }),
        updateFromHandle: (type, position, feature) => {
            const base = [position, ...feature.properties.baseCoordinates.slice(1)];
            return { baseCoordinates: base, geometry: build(base) };
        },
    };
}

describe('the line tool, drag inside one frame', () => {
    async function setup() {
        const { default: AddLineControl } = await import('../../src/js/draw_tools/line_tool/add_line_control.js');
        const feature = {
            type: 'Feature',
            properties: { id: 'line-1', source: 'line', baseCoordinates: [[0, 0], [1, 1]] },
            geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        };
        const built = buildControl(
            AddLineControl,
            movingGeometry((base) => ({ type: 'LineString', coordinates: base })),
            { lines: { type: 'FeatureCollection', features: [structuredClone(feature)] } },
        );
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [vertexHandle];
        return { ...built, feature };
    }

    it('moves the feature when down, ONE move and up land before any frame runs', async () => {
        const { control, written } = await setup();

        control.onEditMouseDown({ point: { x: 1, y: 1 }, originalEvent: { button: 0 }, preventDefault: () => {} });
        control.onEditMouseMove({ point: { x: 5, y: 5 }, lngLat: { lng: 5, lat: 5 } });
        await control.onEditMouseUp();

        // The end handler had to deliver the parked pointer itself: the frame
        // that would have delivered it never ran, and must not run later.
        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(clock.frame()).toBe(0);

        const mainWrites = written.filter(write => write.name === 'lines');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].geometry.coordinates).toEqual([[5, 5], [1, 1]]);
    });

    it('still moves the feature when the frame DID run before the mouseup', async () => {
        const { control, written } = await setup();

        control.onEditMouseDown({ point: { x: 1, y: 1 }, originalEvent: { button: 0 }, preventDefault: () => {} });
        control.onEditMouseMove({ point: { x: 7, y: 7 }, lngLat: { lng: 7, lat: 7 } });
        expect(clock.frame()).toBe(1);
        await control.onEditMouseUp();

        // The flush over an empty gate resolves no second snap and loses nothing.
        expect(snapping.resolveCalls).toHaveLength(1);
        const mainWrites = written.filter(write => write.name === 'lines');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].geometry.coordinates).toEqual([[7, 7], [1, 1]]);
    });

    it('writes nothing when the drag never moved at all', async () => {
        const { control, written } = await setup();

        control.onEditMouseDown({ point: { x: 1, y: 1 }, originalEvent: { button: 0 }, preventDefault: () => {} });
        await control.onEditMouseUp();

        expect(written.filter(write => write.name === 'lines')).toHaveLength(0);
    });
});

describe('the polygon tool, drag inside one frame', () => {
    async function setup() {
        const { default: AddPolygonControl } = await import('../../src/js/draw_tools/polygon_tool/add_polygon_control.js');
        const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
        const feature = {
            type: 'Feature',
            properties: { id: 'polygon-1', source: 'polygon', baseCoordinates: ring },
            geometry: { type: 'Polygon', coordinates: [ring] },
        };
        const built = buildControl(
            AddPolygonControl,
            movingGeometry((base) => ({ type: 'Polygon', coordinates: [base] })),
            { polygons: { type: 'FeatureCollection', features: [structuredClone(feature)] } },
        );
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [vertexHandle];
        return { ...built, feature };
    }

    it('moves the feature when down, ONE move and up land before any frame runs', async () => {
        const { control, written } = await setup();

        control.onEditMouseDown({ point: { x: 2, y: 2 }, originalEvent: { button: 0 }, preventDefault: () => {} });
        control.onEditMouseMove({ point: { x: 9, y: 9 }, lngLat: { lng: 9, lat: 9 } });
        await control.onEditMouseUp();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 9, lat: 9 });
        expect(clock.frame()).toBe(0);

        const mainWrites = written.filter(write => write.name === 'polygons');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].geometry.coordinates[0][0]).toEqual([9, 9]);
    });

    it('still moves the feature when the frame DID run before the mouseup', async () => {
        const { control, written } = await setup();

        control.onEditMouseDown({ point: { x: 2, y: 2 }, originalEvent: { button: 0 }, preventDefault: () => {} });
        control.onEditMouseMove({ point: { x: 4, y: 4 }, lngLat: { lng: 4, lat: 4 } });
        expect(clock.frame()).toBe(1);
        await control.onEditMouseUp();

        expect(snapping.resolveCalls).toHaveLength(1);
        const mainWrites = written.filter(write => write.name === 'polygons');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].geometry.coordinates[0][0]).toEqual([4, 4]);
    });
});

/**
 * The circle drags a RADIUS handle, not a vertex, and its end handler is a
 * pointer event on the canvas container rather than a MapLibre `mouseup`. Until
 * 2026-09-05 it wrote `lastPreviewPosition` on the raw `pointermove`, so this
 * drag already moved the feature and a test here would have passed for the wrong
 * reason; the gate moved that write into the frame, and the `flush()` at the top
 * of `_onEditPointerUp` is what keeps it passing.
 */
describe('the circle tool, handle drag inside one frame', () => {
    /** The radius handle, as `queryRenderedFeatures` returns it. */
    const radiusHandle = { properties: { role: 'handle', handleType: 'radius', user_isEditingHandle: true } };

    async function setup() {
        const { default: AddCircleControl } = await import('../../src/js/draw_tools/circle_tool/add_circle_control.js');
        const feature = {
            type: 'Feature',
            properties: { id: 'circle-1', source: 'circle', center: [0, 0], radius: 100 },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        };
        const built = buildControl(
            AddCircleControl,
            {
                normalizeCenter: (center) => center,
                createHandles: () => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }),
                calculatePreview: () => ({ geometry: {}, handlePosition: [0, 0] }),
                // The real one returns null below the 10 m floor, and there is no
                // radius at all without a position: a drag that never moved must
                // not write. The radius follows the dragged position so the
                // source write can be checked against it.
                updateFromHandle: (type, position) => (position
                    ? { radius: position[0] * 100, geometry: { type: 'Polygon', coordinates: [[position, [1, 1], position]] } }
                    : null),
            },
            { circles: { type: 'FeatureCollection', features: [structuredClone(feature)] } },
        );
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [radiusHandle];
        return { ...built, feature };
    }

    it('resizes the circle when down, ONE move and up land before any frame runs', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 5, clientY: 5 });
        await control._onEditPointerUp({ pointerId: 1 });

        // The end handler had to deliver the parked pointer itself: the frame
        // that would have delivered it never ran, and must not run later.
        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('circle-1');
        expect(clock.frame()).toBe(0);

        const mainWrites = written.filter(write => write.name === 'circles');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.radius).toBe(500);
        expect(mainWrites[0].data.features[0].geometry.coordinates[0][0]).toEqual([5, 5]);
    });

    it('still resizes when the frame DID run before the pointerup', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 7, clientY: 7 });
        expect(clock.frame()).toBe(1);
        await control._onEditPointerUp({ pointerId: 1 });

        // The flush over an empty gate resolves no second snap and loses nothing.
        expect(snapping.resolveCalls).toHaveLength(1);
        const mainWrites = written.filter(write => write.name === 'circles');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.radius).toBe(700);
    });

    it('writes nothing when the drag never moved at all', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        await control._onEditPointerUp({ pointerId: 1 });

        expect(written.filter(write => write.name === 'circles')).toHaveLength(0);
    });
});

/**
 * The ellipse drags one of THREE handles (horizontal, vertical, rotation), which
 * the `pointerdown` fixes in `activeHandleType`, and its end handler is a pointer
 * event on the canvas container. Until 2026-09-05 it wrote `lastPreviewPosition`
 * on the raw `pointermove`, so this drag already moved the feature and a test
 * here would have passed for the wrong reason; the gate moved that write into the
 * frame, and the `flush()` at the top of `_onEditPointerUp` is what keeps it
 * passing.
 */
describe('the ellipse tool, handle drag inside one frame', () => {
    /** The horizontal-resize handle, as `queryRenderedFeatures` returns it. */
    const resizeHandle = {
        properties: { role: 'handle', handleType: 'vertex', handleId: 'horizontal-resize', user_isEditingHandle: true },
    };

    async function setup() {
        const { default: AddEllipseControl } = await import('../../src/js/draw_tools/ellipse_tool/add_ellipse_control.js');
        const feature = {
            type: 'Feature',
            properties: { id: 'ellipse-1', source: 'ellipse', center: [0, 0], majorRadius: 100, minorRadius: 60, bearing: 0 },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        };
        const built = buildControl(
            AddEllipseControl,
            {
                normalizeCenter: (center) => center,
                createHandles: () => ([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]),
                calculatePreview: () => ({
                    geometry: {},
                    handlePositions: { horizontal: [0, 0], vertical: [0, 0], rotation: [0, 0] },
                }),
                // The real one needs a position to have any radius at all, and
                // the control refuses a result under the 0.01 floor: a drag that
                // never moved must not write. The radii follow the dragged
                // position so the source write can be checked against it.
                updateFromHandle: (type, position) => (position
                    ? {
                        majorRadius: position[0] * 100,
                        minorRadius: position[0] * 60,
                        bearing: 30,
                        geometry: { type: 'Polygon', coordinates: [[position, [1, 1], position]] },
                    }
                    : null),
            },
            { ellipses: { type: 'FeatureCollection', features: [structuredClone(feature)] } },
        );
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [resizeHandle];
        return { ...built, feature };
    }

    it('resizes the ellipse when down, ONE move and up land before any frame runs', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 5, clientY: 5 });
        await control._onEditPointerUp({ pointerId: 1 });

        // The end handler had to deliver the parked pointer itself: the frame
        // that would have delivered it never ran, and must not run later.
        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('ellipse-1');
        expect(clock.frame()).toBe(0);

        const mainWrites = written.filter(write => write.name === 'ellipses');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.majorRadius).toBe(500);
        expect(mainWrites[0].data.features[0].geometry.coordinates[0][0]).toEqual([5, 5]);
    });

    it('still resizes when the frame DID run before the pointerup', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 7, clientY: 7 });
        expect(clock.frame()).toBe(1);
        await control._onEditPointerUp({ pointerId: 1 });

        // The flush over an empty gate resolves no second snap and loses nothing.
        expect(snapping.resolveCalls).toHaveLength(1);
        const mainWrites = written.filter(write => write.name === 'ellipses');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.majorRadius).toBe(700);
    });

    it('writes nothing when the drag never moved at all', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        await control._onEditPointerUp({ pointerId: 1 });

        expect(written.filter(write => write.name === 'ellipses')).toHaveLength(0);
    });
});

/**
 * The sector drags one of TWO handles (radius and aperture), named by
 * `activeHandleId` at `pointerdown`, and its end handler is a pointer event on
 * the canvas container rather than a MapLibre `mouseup`. The radius handle also
 * carries the BEARING: dragging it turns the slice as well as resizing it, so
 * the write is checked on both numbers, and a drag that lost its position would
 * keep the old azimuth on a sector the user already turned.
 */
describe('the sector tool, handle drag inside one frame', () => {
    /** The radius handle, as `queryRenderedFeatures` returns it. */
    const radiusHandle = {
        properties: { role: 'handle', handleType: 'vertex', handleId: 'radius', user_isEditingHandle: true },
    };

    async function setup() {
        const { default: AddSectorControl } = await import('../../src/js/draw_tools/sector_tool/add_sector_control.js');
        const feature = {
            type: 'Feature',
            properties: { id: 'sector-1', source: 'sector', center: [0, 0], radius: 100, bearing: 0, aperture: 60 },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        };
        const built = buildControl(
            AddSectorControl,
            {
                normalizeCenter: (center) => center,
                createHandles: () => [],
                calculatePreview: () => ({ geometry: {}, handles: [[0, 0], [0, 0]] }),
                // The real one returns null below the 10 m floor, and there is no
                // radius at all without a position: a drag that never moved must
                // not write. Radius and bearing follow the dragged position so
                // the source write can be checked against it.
                updateFromHandle: (handleId, position) => (position
                    ? {
                        radius: position[0] * 100,
                        bearing: position[1] * 10,
                        aperture: 60,
                        geometry: { type: 'Polygon', coordinates: [[position, [1, 1], position]] },
                    }
                    : null),
            },
            { setores: { type: 'FeatureCollection', features: [structuredClone(feature)] } },
        );
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [radiusHandle];
        return { ...built, feature };
    }

    it('resizes and turns the sector when down, ONE move and up land before any frame runs', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 5, clientY: 5 });
        await control._onEditPointerUp({ pointerId: 1 });

        // The end handler had to deliver the parked pointer itself: the frame
        // that would have delivered it never ran, and must not run later.
        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('sector-1');
        expect(clock.frame()).toBe(0);

        const mainWrites = written.filter(write => write.name === 'setores');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.radius).toBe(500);
        expect(mainWrites[0].data.features[0].properties.bearing).toBe(50);
        expect(mainWrites[0].data.features[0].geometry.coordinates[0][0]).toEqual([5, 5]);
    });

    it('still resizes when the frame DID run before the pointerup', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 7, clientY: 7 });
        expect(clock.frame()).toBe(1);
        await control._onEditPointerUp({ pointerId: 1 });

        // The flush over an empty gate resolves no second snap and loses nothing.
        expect(snapping.resolveCalls).toHaveLength(1);
        const mainWrites = written.filter(write => write.name === 'setores');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.radius).toBe(700);
    });

    it('writes nothing when the drag never moved at all', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        await control._onEditPointerUp({ pointerId: 1 });

        expect(written.filter(write => write.name === 'setores')).toHaveLength(0);
    });
});

/**
 * The brush needs NO flush, and this is the measure that says so instead of an
 * argument: its gate parks no pointer at all, because the stroke is accumulated
 * on the raw event and the frame only redraws `this.points`. A stroke that
 * begins and ends inside one frame therefore reaches `finishDrawing` whole.
 */
describe('the brush tool, stroke inside one frame', () => {
    it('commits every point of a stroke that never saw a frame', async () => {
        const { default: AddBrushControl } = await import('../../src/js/draw_tools/brush_tool/add_brush_control.js');
        const { control } = buildControl(AddBrushControl, { isPixelDistanceSufficient: () => true });
        let committed = null;
        control.createFeature = async () => { committed = [...control.points]; };
        control.isActive = true;

        control._onPointerDown({ isPrimary: true, clientX: 1, clientY: 1, pointerId: 1, preventDefault: () => {} });
        control._onPointerMove({ isPrimary: true, clientX: 6, clientY: 6, pointerId: 1 });
        await control._onPointerUp({ pointerId: 1 });

        expect(committed).toEqual([[1, 1], [6, 6]]);
        // The pending frame is dropped by `clearPreview`, not left to redraw a
        // stroke that is already finished.
        expect(clock.frame()).toBe(0);
    });
});

/**
 * The rectangle drags a WIDTH, HEIGHT or ROTATION handle, and the handle it is
 * dragging is fixed by `activeHandleType` on the `pointerdown`. Its end handler
 * is a pointer event on the canvas container, like the circle's.
 *
 * The position it commits is `currentMousePosition`, which the raw `pointermove`
 * used to write and the gate now writes inside the frame. That is why the
 * `flush()` at the top of `_onEditPointerUp` is what keeps a drag born and dead
 * inside one frame landing on the position the user let go of: without it the
 * commit falls back to the position of the `pointerdown`, which is a WRITE at
 * the WRONG place and not a missing write.
 */
describe('the rectangle tool, handle drag inside one frame', () => {
    /** The width handle, as `queryRenderedFeatures` returns it. */
    const widthHandle = {
        properties: { role: 'handle', handleType: 'vertex', handleId: 'width-resize', user_isEditingHandle: true },
    };

    async function setup() {
        const { default: AddRectangleControl } = await import('../../src/js/draw_tools/rectangle_tool/add_rectangle_control.js');
        const feature = {
            type: 'Feature',
            properties: {
                id: 'rectangle-1', source: 'rectangle', center: [0, 0],
                width: 500, height: 300, bearing: 0, borderRadius: 0,
                corner1: [1, 1], corner2: [-1, -1],
            },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        };
        const built = buildControl(
            AddRectangleControl,
            {
                normalizeCenter: (center) => center,
                normalizeCorner: (corner) => corner,
                createHandlesFromGeometry: () => ([
                    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
                ]),
                calculatePreview: () => ({
                    geometry: {},
                    handlePositions: { width: [0, 0], height: [0, 0], rotation: [0, 0] },
                }),
                // The real one returns null without a position, and the control
                // only writes above the 10 m floor. The width follows the
                // dragged position so the source write can be checked against it.
                updateFromHandle: (type, position) => (position
                    ? {
                        corner1: position,
                        corner2: [-position[0], -position[1]],
                        center: [0, 0],
                        width: position[0] * 100,
                        height: 300,
                        bearing: 0,
                        geometry: { type: 'Polygon', coordinates: [[position, [1, 1], position]] },
                    }
                    : null),
            },
            { rectangles: { type: 'FeatureCollection', features: [structuredClone(feature)] } },
        );
        built.control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        built.map.queryRenderedFeatures = () => [widthHandle];
        return { ...built, feature };
    }

    it('resizes the rectangle when down, ONE move and up land before any frame runs', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 5, clientY: 5 });
        await control._onEditPointerUp({ pointerId: 1 });

        // The end handler had to deliver the parked pointer itself: the frame
        // that would have delivered it never ran, and must not run later.
        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('rectangle-1');
        expect(clock.frame()).toBe(0);

        const mainWrites = written.filter(write => write.name === 'rectangles');
        expect(mainWrites).toHaveLength(1);
        // 500 is the position of the MOVE. The position of the `pointerdown`
        // would give 100, which is the failure this case exists to catch.
        expect(mainWrites[0].data.features[0].properties.width).toBe(500);
        expect(mainWrites[0].data.features[0].geometry.coordinates[0][0]).toEqual([5, 5]);
    });

    it('still resizes when the frame DID run before the pointerup', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        control._onEditPointerMove({ isPrimary: true, pointerId: 1, clientX: 7, clientY: 7 });
        expect(clock.frame()).toBe(1);
        await control._onEditPointerUp({ pointerId: 1 });

        // The flush over an empty gate resolves no second snap and loses nothing.
        expect(snapping.resolveCalls).toHaveLength(1);
        const mainWrites = written.filter(write => write.name === 'rectangles');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.width).toBe(700);
    });

    it('commits the position of the pointerdown when the drag never moved', async () => {
        const { control, written } = await setup();

        control._onEditPointerDown({ isPrimary: true, pointerId: 1, clientX: 1, clientY: 1, preventDefault: () => {} });
        await control._onEditPointerUp({ pointerId: 1 });

        // The rectangle differs from the circle here, and the difference is the
        // `pointerdown` writing `currentMousePosition`: the circle reaches the
        // end with no position and writes NOTHING, this one commits the handle
        // where the user grabbed it. Kept as it was; the case is here so a port
        // cannot change it in silence.
        const mainWrites = written.filter(write => write.name === 'rectangles');
        expect(mainWrites).toHaveLength(1);
        expect(mainWrites[0].data.features[0].properties.width).toBe(100);
        expect(snapping.resolveCalls).toHaveLength(0);
    });
});

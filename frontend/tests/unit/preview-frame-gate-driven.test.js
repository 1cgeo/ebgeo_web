// Path: tests/unit/preview-frame-gate-driven.test.js

import { beforeAll, describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The tools, DRIVEN, not read as text.
 *
 * `tests/unit/preview-timer-regua.test.js` proves the shape of the source. This
 * file proves the behaviour that shape exists for: a burst of pointer events
 * inside one frame resolves the snap ONCE, builds the geometry ONCE, and does it
 * with the LAST position of the burst. The controls import cleanly on `node`
 * (nothing in their chain touches `document` at module scope), so they can be
 * built against a fake map and a hand-driven `requestAnimationFrame`.
 *
 * The geometry helper is replaced by a recorder: what is under test is HOW MANY
 * times and with WHAT the preview is rebuilt, not the turf maths, which has its
 * own tests.
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
        showIndicator: (map, snap, type) => snapping.indicatorCalls.push({ snap, type }),
        hideIndicator: () => { snapping.hideCalls += 1; },
    }),
    SnappingService: class {},
}));

/**
 * The first import of a control pulls the whole store graph, and on a loaded machine that
 * costs more than the 5 s a test gets. Paid inside the first test it kills it, and the
 * timed-out test then leaks its late async work into the next one, which fails on a count
 * that has nothing to do with the code. Measured here on 2026-09-04: two runs in three
 * failed that way while another job held the machine, zero after this hook. A hook has its
 * own budget, so the cost is paid once and out of the measurement.
 */
const MODULOS_PESADOS = [
    '../../src/js/draw_tools/line_tool/add_line_control.js',
    '../../src/js/draw_tools/polygon_tool/add_polygon_control.js',
    '../../src/js/draw_tools/brush_tool/add_brush_control.js',
    '../../src/js/military_tools/arrow_tool/add_arrow_control.js',
    '../../src/js/military_tools/occupied_front_tool/add_occupied_front_control.js',
    '../../src/js/military_tools/boundary_tool/add_boundary_control.js',
    '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js',
    '../../src/js/analysis_tools/los_tool/add_los_control.js',
    '../../src/js/analysis_tools/visibility_tool/add_visibility_control.js',
];

beforeAll(async () => {
    for (const modulo of MODULOS_PESADOS) await import(/* @vite-ignore */ modulo);
}, 120000);

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
 * @param {Function} Control - The control class
 * @param {Object} geometry - The recorder to install
 * @param {Function} [prepare] - Runs on the control before `onAdd`, for the one
 *   tool whose `onAdd` builds DOM (the visibility modal), which `node` has not got
 * @returns {Promise<Object>} The control, the map and the recorded writes
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

/** `n` mousemove events inside one frame, ending on `[last, last]`. */
function burst(handler, count) {
    for (let i = 1; i <= count; i += 1) {
        handler({ point: { x: i, y: i }, lngLat: { lng: i, lat: i } });
    }
}

/**
 * The same burst as pointer events, for the drags that read the canvas instead
 * of MapLibre's own `point` / `lngLat`. The fake canvas sits at (0, 0) and the
 * fake `unproject` is the identity, so event `i` lands on `[i, i]` either way.
 */
function pointerBurst(handler, count) {
    for (let i = 1; i <= count; i += 1) {
        handler({ isPrimary: true, clientX: i, clientY: i, pointerId: 1 });
    }
}

describe('the line tool preview', () => {
    async function setup() {
        const { default: AddLineControl } = await import('../../src/js/draw_tools/line_tool/add_line_control.js');
        const generated = [];
        const built = buildControl(AddLineControl, {
            generate: (coordinates) => {
                generated.push(coordinates);
                return { type: 'LineString', coordinates };
            },
        });
        return { ...built, generated };
    }

    it('resolves the snap once per frame, with the last position of the frame', async () => {
        const { control, generated, written } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 10);

        // Nothing happened on the raw events: that is the whole point.
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(generated).toHaveLength(0);

        expect(clock.frame()).toBe(1);

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 10, lat: 10 });
        expect(snapping.resolveCalls[0].point).toEqual({ x: 10, y: 10 });
        expect(generated).toEqual([[[0, 0], [10, 10]]]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('line-feedback');
    });

    it('the pre-click indicator has its own gate, and coalesces too', async () => {
        const { control } = await setup();

        burst(control._onPreClickMouseMove, 6);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 6, lat: 6 });
        // Not snapped in this fake, so the indicator is hidden, not shown.
        expect(snapping.indicatorCalls).toHaveLength(0);
        expect(snapping.hideCalls).toBe(1);
    });

    it('the handle drag rides the same gate and excludes the dragged feature', async () => {
        const { control, generated } = await setup();
        const feature = { properties: { id: 'line-1', baseCoordinates: [[0, 0], [1, 1]] }, geometry: {} };
        control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        control.geometry.calculatePreview = () => ({ geometry: {}, handles: [] });
        control.isDraggingHandle = true;
        control.activeHandleType = 'vertex';
        control.activeHandleIndex = 0;

        burst(control.onEditMouseMove, 8);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('line-1');
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 8, lat: 8 });
        // A drag redraws from the feature, so the drawing generate never ran.
        expect(generated).toHaveLength(0);
    });

    it('cancelPendingUpdates drops the frame, so nothing is drawn after it', async () => {
        const { control, generated } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 3);
        control.cancelPendingUpdates();

        expect(clock.frame()).toBe(0);
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(generated).toHaveLength(0);
    });

    it('a move after the frame buys a new frame', async () => {
        const { control, generated } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 2);
        clock.frame();
        burst(control.handlePreviewMouseMove, 4);
        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(2);
        expect(generated).toEqual([[[0, 0], [2, 2]], [[0, 0], [4, 4]]]);
    });
});

describe('the polygon tool preview', () => {
    async function setup() {
        const { default: AddPolygonControl } = await import('../../src/js/draw_tools/polygon_tool/add_polygon_control.js');
        const generated = [];
        const built = buildControl(AddPolygonControl, {
            generate: (coordinates) => {
                generated.push(coordinates);
                return { type: 'Polygon', coordinates: [coordinates] };
            },
        });
        return { ...built, generated };
    }

    it('resolves the snap once per frame, with the last position of the frame', async () => {
        const { control, generated, written } = await setup();
        control.drawPoints = [[0, 0], [1, 0]];

        burst(control.handlePreviewMouseMove, 7);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 7, lat: 7 });
        expect(generated).toEqual([[[0, 0], [1, 0], [7, 7]]]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('polygon-feedback');
    });

    it('draws the two-point segment as a line, still once per frame', async () => {
        const { control, generated, written } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 5);
        clock.frame();

        // Two points is a segment, not a polygon: no geometry build at all.
        expect(generated).toHaveLength(0);
        expect(written).toHaveLength(1);
        expect(written[0].data.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [5, 5]] });
    });

    it('the pre-click indicator has its own gate, and coalesces too', async () => {
        const { control } = await setup();

        burst(control._onPreClickMouseMove, 4);
        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 4, lat: 4 });
    });
});

describe('the arrow tool preview', () => {
    async function setup() {
        const { default: AddArrowControl } = await import('../../src/js/military_tools/arrow_tool/add_arrow_control.js');
        const generated = [];
        const built = buildControl(AddArrowControl, {
            generate: (coordinates, properties) => {
                generated.push({ coordinates, width: properties?.width });
                return { type: 'Polygon', coordinates: [coordinates] };
            },
        });
        return { ...built, generated };
    }

    it('builds the polygon once per frame, from the last position of the frame', async () => {
        const { control, generated, written } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 9);
        // The arrow does not snap, so the raw event has nothing to do at all.
        expect(generated).toHaveLength(0);

        clock.frame();

        expect(generated).toHaveLength(1);
        expect(generated[0].coordinates).toEqual([[0, 0], [9, 9]]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('arrow-feedback');
        // The old code put a setTimeout inside this frame, so nothing was drawn
        // until a timer fired. Nothing is pending now.
        expect(clock.frame()).toBe(0);
        expect(generated).toHaveLength(1);
    });

    it('the handle drag rides the same gate and leaves the drawing spine alone', async () => {
        const { control, generated } = await setup();
        const feature = { properties: { id: 'arrow-1', airmobile: false }, geometry: {} };
        control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        const previews = [];
        control.geometry.calculatePreview = (type, position) => {
            previews.push(position);
            return { geometry: {}, handles: [] };
        };
        control.drawPoints = [[0, 0]];
        control.lastPreviewPoints = [[0, 0], [1, 1]];
        control.isDraggingHandle = true;
        control.activeHandleType = 'vertex';

        for (let i = 1; i <= 6; i += 1) {
            control._onEditPointerMove({ isPrimary: true, clientX: i, clientY: i, pointerId: 1 });
        }
        expect(previews).toHaveLength(0);

        clock.frame();

        expect(previews).toHaveLength(1);
        // The spine is the drawing path's state; a drag must not rewrite it.
        expect(control.lastPreviewPoints).toEqual([[0, 0], [1, 1]]);
        expect(generated).toHaveLength(0);
    });
});

describe('the occupied front tool preview', () => {
    async function setup() {
        const { default: AddOccupiedFrontControl } = await import(
            '../../src/js/military_tools/occupied_front_tool/add_occupied_front_control.js'
        );
        const generated = [];
        const built = buildControl(AddOccupiedFrontControl, {
            generate: (coordinates) => {
                generated.push(coordinates);
                return { type: 'LineString', coordinates };
            },
            calculateDistance: () => 1000,
            calculateBearing: () => 0,
            destination: () => [99, 99],
        });
        return { ...built, generated };
    }

    it('builds the geometry once per frame, from the last position of the frame', async () => {
        const { control, generated, written } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 5);
        expect(generated).toHaveLength(0);

        clock.frame();

        expect(generated).toEqual([[[0, 0], [5, 5], [99, 99]]]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('occupied-front-feedback');
        // No timer left inside the frame.
        expect(clock.frame()).toBe(0);
        expect(generated).toHaveLength(1);
    });

    it('draws nothing below the 10 m floor, exactly as before', async () => {
        const { control, generated } = await setup();
        control.geometry.calculateDistance = () => 9;
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 3);
        clock.frame();

        expect(generated).toHaveLength(0);
    });

    it('the handle drag rides the same gate and leaves the drawing centre alone', async () => {
        const { control } = await setup();
        const feature = {
            properties: { id: 'of-1', baseCoordinates: [[0, 0], [1, 1], [2, 2]] },
            geometry: {},
        };
        control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        const fromHandle = [];
        control.geometry.updateFromHandle = (type, position) => {
            fromHandle.push(position);
            return { baseCoordinates: [[0, 0], [1, 1], [2, 2]], geometry: {} };
        };
        control.geometry.createHandles = () => [];
        control.isDraggingHandle = true;
        control.activeHandleType = 'p2';

        for (let i = 1; i <= 4; i += 1) {
            control._onEditPointerMove({ isPrimary: true, clientX: i, clientY: i, pointerId: 1 });
        }
        expect(fromHandle).toHaveLength(0);

        clock.frame();

        expect(fromHandle).toHaveLength(1);
        expect(control.lastPreviewCenter).toBeNull();
    });
});

describe('the boundary tool preview', () => {
    async function setup() {
        const { default: AddBoundaryControl } = await import(
            '../../src/js/military_tools/boundary_tool/add_boundary_control.js'
        );
        const generated = [];
        const built = buildControl(AddBoundaryControl, {
            // The boundary builds from a PROPERTY BAG, not a coordinate list.
            generate: (properties) => {
                generated.push(properties.baseCoordinates);
                return { type: 'LineString', coordinates: properties.baseCoordinates };
            },
            normalizeBaseCoordinates: (coordinates) => coordinates,
            createHandles: () => [],
        });
        return { ...built, generated };
    }

    it('resolves the snap once per frame, with the last position of the frame', async () => {
        const { control, generated, written } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 7);

        expect(snapping.resolveCalls).toHaveLength(0);
        expect(generated).toHaveLength(0);

        expect(clock.frame()).toBe(1);

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 7, lat: 7 });
        expect(snapping.resolveCalls[0].point).toEqual({ x: 7, y: 7 });
        expect(generated).toEqual([[[0, 0], [7, 7]]]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('boundary-feedback');
        // The old code put a setTimeout(..., 8) inside this frame, so nothing
        // was drawn until a timer fired. Nothing is pending now.
        expect(clock.frame()).toBe(0);
        expect(generated).toHaveLength(1);
    });

    it('the pre-click indicator has its own gate, and coalesces too', async () => {
        const { control } = await setup();

        burst(control._onPreClickMouseMove, 5);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
        expect(snapping.hideCalls).toBe(1);
    });

    it('the handle drag rides the same gate and excludes the dragged feature', async () => {
        const { control, generated, written } = await setup();
        const feature = { properties: { id: 'boundary-1', baseCoordinates: [[0, 0], [1, 1]] }, geometry: {} };
        control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        const fromHandle = [];
        control.geometry.updateFromHandle = (type, position) => {
            fromHandle.push(position);
            return { geometry: {}, properties: {} };
        };
        control.isDraggingHandle = true;
        control.activeHandleType = 'vertex';
        control.activeHandleIndex = 0;

        pointerBurst(control._onEditPointerMove, 6);
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(fromHandle).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('boundary-1');
        expect(fromHandle).toEqual([[6, 6]]);
        // A drag redraws from the feature, so the drawing generate never ran.
        expect(generated).toHaveLength(0);
        expect(written.map(write => write.name)).toEqual(['boundary-feedback', 'boundary-edit-handles']);
    });

    it('cancelPendingUpdates drops the frame, so nothing is drawn after it', async () => {
        const { control, generated } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 3);
        control.cancelPendingUpdates();

        expect(clock.frame()).toBe(0);
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(generated).toHaveLength(0);
    });
});

describe('the coordination line preview', () => {
    async function setup() {
        const { default: AddCoordinationLineControl } = await import(
            '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js'
        );
        const generated = [];
        const built = buildControl(AddCoordinationLineControl, {
            generate: (properties) => {
                generated.push(properties.baseCoordinates);
                return { type: 'LineString', coordinates: properties.baseCoordinates };
            },
            normalizeBaseCoordinates: (coordinates) => coordinates,
            createHandles: () => [],
        });
        return { ...built, generated };
    }

    it('resolves the snap once per frame, with the last position of the frame', async () => {
        const { control, generated, written } = await setup();
        control.drawPoints = [[0, 0]];

        burst(control.handlePreviewMouseMove, 9);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 9, lat: 9 });
        expect(generated).toEqual([[[0, 0], [9, 9]]]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('coordination-line-feedback');
    });

    it('the handle drag rides the same gate and excludes the dragged feature', async () => {
        const { control, generated, written } = await setup();
        const feature = { properties: { id: 'cl-1', baseCoordinates: [[0, 0], [1, 1]] }, geometry: {} };
        control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        const fromHandle = [];
        control.geometry.updateFromHandle = (type, position) => {
            fromHandle.push(position);
            return { geometry: {}, properties: {} };
        };
        control.isDraggingHandle = true;
        control.activeHandleType = 'vertex';
        control.activeHandleIndex = 0;

        // This is the case `KNOWN_RAW_RESOLVE` used to allow: every one of these
        // six events resolved a snap of its own.
        pointerBurst(control._onEditPointerMove, 6);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('cl-1');
        expect(fromHandle).toEqual([[6, 6]]);
        expect(generated).toHaveLength(0);
        expect(written.map(write => write.name))
            .toEqual(['coordination-line-feedback', 'coordination-line-edit-handles']);
    });
});

describe('the LOS tool preview', () => {
    async function setup() {
        const { default: AddLOSControl } = await import('../../src/js/analysis_tools/los_tool/add_los_control.js');
        const generated = [];
        const built = buildControl(AddLOSControl, {
            generate: (coordinates) => {
                generated.push(coordinates);
                return { type: 'LineString', coordinates };
            },
            isTerrainAvailable: () => true,
        });
        return { ...built, generated };
    }

    it('resolves the snap once per frame, with the last position of the frame', async () => {
        const { control, generated, written } = await setup();
        control.isActive = true;
        control.startPoint = [0, 0];

        burst(control.handleMouseMove, 8);
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(generated).toHaveLength(0);

        expect(clock.frame()).toBe(1);

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 8, lat: 8 });
        expect(generated).toEqual([[[0, 0], [8, 8]]]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('los-feedback');
        // No timer left inside the frame.
        expect(clock.frame()).toBe(0);
        expect(generated).toHaveLength(1);
    });

    it('the pre-click indicator has its own gate, and coalesces too', async () => {
        const { control } = await setup();

        burst(control._onPreClickMouseMove, 6);
        expect(snapping.resolveCalls).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 6, lat: 6 });
    });
});

describe('the visibility tool preview', () => {
    async function setup() {
        const { default: AddVisibilityControl } = await import(
            '../../src/js/analysis_tools/visibility_tool/add_visibility_control.js'
        );
        const sectors = [];
        const built = buildControl(
            AddVisibilityControl,
            {
                isTerrainAvailable: () => true,
                calculateSectorPreview: (center, position, aperture) => {
                    sectors.push({ center, position, aperture });
                    return [center, position, center];
                },
            },
            // `onAdd` builds the progress modal out of `document`, which `node`
            // has not got; the modal is not what is under test here.
            (control) => { control.createProgressModal = () => {}; },
        );
        return { ...built, sectors };
    }

    it('resolves the snap once per frame, with the last position of the frame', async () => {
        const { control, sectors, written } = await setup();
        control.isActive = true;
        control.startPoint = [0, 0];

        burst(control.handleMouseMove, 10);
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(sectors).toHaveLength(0);

        expect(clock.frame()).toBe(1);

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 10, lat: 10 });
        expect(sectors).toHaveLength(1);
        expect(sectors[0].center).toEqual([0, 0]);
        expect(sectors[0].position).toEqual([10, 10]);
        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('visibility-feedback');
    });

    it('the handle drag rides the same gate and excludes the dragged feature', async () => {
        const { control, sectors } = await setup();
        const feature = { properties: { id: 'vis-1', center: [0, 0] }, geometry: {} };
        control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
        control.geometry.normalizeFeatureProperties = (properties) => properties;
        const previews = [];
        control.geometry.calculatePreview = (handleId, position) => {
            previews.push(position);
            return { geometry: {}, handles: [[1, 1], [2, 2], [0, 0]] };
        };
        control.isDraggingHandle = true;
        control.activeHandleId = 'radius';

        pointerBurst(control._onEditPointerMove, 7);
        expect(snapping.resolveCalls).toHaveLength(0);
        expect(previews).toHaveLength(0);

        clock.frame();

        expect(snapping.resolveCalls).toHaveLength(1);
        expect(snapping.resolveCalls[0].excludeFeatureId).toBe('vis-1');
        expect(previews).toEqual([[7, 7]]);
        // A drag draws the handle preview, never the drawing sector.
        expect(sectors).toHaveLength(0);
    });
});

describe('the brush tool preview', () => {
    async function setup() {
        const { default: AddBrushControl } = await import('../../src/js/draw_tools/brush_tool/add_brush_control.js');
        return buildControl(AddBrushControl, {
            // The real one drops moves under a pixel floor; the burst below is
            // about coalescing, so every event counts as a point here.
            isPixelDistanceSufficient: () => true,
        });
    }

    it('keeps every point of the burst and writes the source once', async () => {
        const { control, written } = await setup();
        control.isActive = true;
        control.isDrawing = true;
        control.points = [[0, 0]];
        control.lastPixelPoint = null;

        pointerBurst(control._onPointerMove, 9);

        // The stroke IS the sequence of positions: the accumulation is on the
        // raw event on purpose, and only the drawing is coalesced.
        expect(control.points).toHaveLength(10);
        expect(control.points[9]).toEqual([9, 9]);
        expect(written).toHaveLength(0);

        expect(clock.frame()).toBe(1);

        expect(written).toHaveLength(1);
        expect(written[0].name).toBe('brush-feedback');
        expect(written[0].data.geometry.coordinates).toHaveLength(10);
        expect(written[0].data.geometry.coordinates[9]).toEqual([9, 9]);
        // One frame, one write: nothing is left pending.
        expect(clock.frame()).toBe(0);
        expect(written).toHaveLength(1);
    });

    it('clearPreview drops the frame, so the stroke is not redrawn after it', async () => {
        const { control, written } = await setup();
        control.isActive = true;
        control.isDrawing = true;
        control.points = [[0, 0]];
        control.lastPixelPoint = null;

        pointerBurst(control._onPointerMove, 4);
        control.clearPreview();

        expect(clock.frame()).toBe(0);
        // Only the clear itself wrote, and it wrote an empty collection.
        expect(written).toHaveLength(1);
        expect(written[0].data.features).toEqual([]);
    });
});

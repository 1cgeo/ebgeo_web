// Path: tests/unit/force-update-during-drag-military.test.js

import { beforeAll, describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * THE MEASUREMENT BEHIND THE DEAD DRAG GUARD.
 *
 * Four military controls carried `if (this.uiManager && this.uiManager.isDragging) return;`
 * at the top of the forced source write. `this.uiManager` is never assigned, not
 * by the class and not by `BaseControl`, so the guard never fired: a dead guard
 * that reads as protection. Before deciding whether to REPAIR it (reach the real
 * one through `selectionManager.uiManager`) or DELETE it, this file measures the
 * thing it claims to protect.
 *
 * Part 1 drives `MoveHandler`, which is what owns the feature drag. Its drag
 * frame shifts the SELECTION BOXES and touches no feature source at all, and the
 * geometry is written in `_endDrag`, after `isDragging` is already false. So the
 * source never holds a partial drag position, and a forced write landing during
 * a drag has nothing to roll back.
 *
 * Part 2 drives the four controls with a drag flagged on the real path
 * (`selectionManager.uiManager.isDragging`), a source holding the position the
 * drag started from, and a forced write carrying a new property. Nothing
 * retrocedes, in every one of the four.
 *
 * Hence the decision recorded in the sources: DELETE the guard. A live guard here
 * would be worse than none, because nothing reapplies a write it swallowed.
 *
 * The static side of the rule (no `this.uiManager` left in these files) is
 * `tests/unit/ui-manager-guard-regua-military.test.js`.
 */

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
        resolve: (map, point, lngLat) => ({ lng: lngLat.lng, lat: lngLat.lat, snapped: false }),
        showIndicator: () => {},
        hideIndicator: () => {},
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
    '../../src/js/tool_manager/move_handler.js',
    '../../src/js/military_tools/arrow_tool/add_arrow_control.js',
    '../../src/js/military_tools/occupied_front_tool/add_occupied_front_control.js',
    '../../src/js/military_tools/boundary_tool/add_boundary_control.js',
    '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js',
];

beforeAll(async () => {
    for (const modulo of MODULOS_PESADOS) await import(/* @vite-ignore */ modulo);
}, 120000);

/**
 * THE SECOND SPELLING OF THE DRAG FLAG, and the one this branch actually carried.
 *
 * The boundary and the coordination line had replaced the dead `this.uiManager` read with a
 * LIVE `_isDragging()` going to the state manager (`ui.isDragging`), which is where
 * `move_handler.js` and `ui_manager.js` really write it. A test that flags the drag only on
 * `selectionManager.uiManager` never touches that axis, and an axis not exercised comes back
 * approved by omission: it would pass on a control that DROPS the write.
 *
 * Mocking the store barrel to reach `getStateManager` costs the whole IndexedDB module graph
 * on import, which is what part 1 cannot afford, so the flag is held UP on the control's own
 * reader instead. `flagDragOnEveryReader` also asserts the reader is still there when the
 * tool declares one, so renaming `_isDragging` out from under this file reports missing
 * instead of quietly skipping the axis.
 */
function flagDragOnEveryReader(control) {
    const readers = [];

    control.selectionManager.uiManager = { isDragging: true };
    readers.push('selectionManager.uiManager.isDragging');

    if (typeof control._isDragging === 'function') {
        control._isDragging = () => true;
        readers.push('_isDragging()');
    }

    return readers;
}

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

beforeEach(() => { clock.install(); });

afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
});

// ===========================================================================
// PART 1: what the feature drag writes while it lasts
// ===========================================================================

describe('the feature drag of the move handler', () => {
    /**
     * A `MoveHandler` built WITHOUT its constructor, so the drag can be driven on
     * `node`: the constructor wires map listeners, and `isDragging` is a
     * StateManager accessor on the prototype, which an own data property shadows.
     * @returns {Promise<Object>} The handler and the recorders
     */
    async function buildMoveHandler() {
        const { default: MoveHandler } = await import('../../src/js/tool_manager/move_handler.js');

        const sourcesAsked = [];
        const uiCalls = [];
        const draggingWhenToolWrote = [];

        const canvas = { style: {} };
        const map = {
            getZoom: () => 10,
            getCanvas: () => canvas,
            getSource: (name) => { sourcesAsked.push(name); return { setData: () => {} }; },
            dragPan: { enable() {}, disable() {} },
        };

        const handler = Object.create(MoveHandler.prototype);
        Object.defineProperty(handler, 'isDragging', { value: true, writable: true });

        handler.map = map;
        handler.rafId = null;
        handler.pendingUpdate = false;
        handler.cachedPosition = { lng: 0, lat: 0 };
        handler.cachedDelta = { dx: 0, dy: 0 };
        handler.coordsPool = { lng: 0, lat: 0 };
        handler.tempCoords = { lng: 0, lat: 0 };
        handler.initialCoordinates = { lng: 0, lat: 0 };

        handler.uiManager = {
            setDragging: (value) => uiCalls.push(`setDragging(${value})`),
            shiftSelectionBoxes: (dx, dy, save = false) => uiCalls.push(`shiftSelectionBoxes(${save})`),
            updatePanels: () => uiCalls.push('updatePanels'),
        };

        const feature = {
            properties: { id: 'boundary-1', source: 'boundary', baseCoordinates: [[0, 0], [1, 1]] },
            geometry: {},
        };
        const control = {
            calculateMoveOffset: () => [0, 0],
            canMove: () => true,
            updateFeatureForMove: (moved, dx, dy) => {
                // The question the guard exists for: is the drag still flagged
                // when the moved geometry is handed over?
                draggingWhenToolWrote.push(handler.isDragging);
                return {
                    ...moved,
                    properties: {
                        ...moved.properties,
                        baseCoordinates: moved.properties.baseCoordinates.map(
                            ([lng, lat]) => [lng + dx, lat + dy],
                        ),
                    },
                };
            },
        };

        handler.selectionManager = {
            controls: new Map([['boundary', control]]),
            updateSelectedFeatures: async () => {},
            updateProfile: () => {},
        };
        handler.selectedFeatures = [feature];
        handler.offsets = new Map([['boundary-1', { offset: [0, 0] }]]);
        handler._updateSelectionManagerFeatures = () => {};
        handler._syncEditHandlesForMovedFeatures = async () => {};
        handler._updateMeasurementsForMovedFeatures = () => {};

        return { handler, sourcesAsked, uiCalls, draggingWhenToolWrote };
    }

    it('touches no feature source while the drag lasts', async () => {
        const { handler, sourcesAsked, uiCalls } = await buildMoveHandler();

        handler._scheduleDragUpdate({ lng: 3, lat: 4 });
        expect(clock.frame()).toBe(1);

        // The moved position lives in the selection boxes, an overlay. The
        // feature source is not read and not written, so it still holds the
        // position the drag started from.
        expect(uiCalls).toEqual(['shiftSelectionBoxes(false)']);
        expect(sourcesAsked).toEqual([]);
    });

    it('clears the drag flag BEFORE the moved geometry is written', async () => {
        const { handler, draggingWhenToolWrote } = await buildMoveHandler();

        handler._scheduleDragUpdate({ lng: 3, lat: 4 });
        await handler._endDrag({ lng: 3, lat: 4 });

        expect(draggingWhenToolWrote).toEqual([false]);
    });
});

// ===========================================================================
// PART 2: a forced write while a feature drag is flagged
// ===========================================================================

/** Where the source says the feature is when the forced write arrives. */
const AT_REST = [[0, 0], [1, 1]];

/**
 * A control wired to a fake map whose sources hold real data, so a forced write
 * can be read back instead of only being seen to happen.
 * @param {Function} Control - The control class
 * @param {Object} geometry - The geometry recorder
 * @param {string} sourceName - The main source this tool writes
 * @param {Object} storedFeature - What the source holds before the write
 * @returns {Object} The control and the source's current data
 */
function buildControlWithSource(Control, geometry, sourceName, storedFeature) {
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

    const store = new Map([[sourceName, { type: 'FeatureCollection', features: [storedFeature] }]]);
    const map = {
        getZoom: () => 10,
        getSource: (name) => {
            if (!store.has(name)) store.set(name, { type: 'FeatureCollection', features: [] });
            return {
                getData: async () => store.get(name),
                setData: (data) => store.set(name, data),
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
    // Every reader of the drag flag this control has, held UP.
    const readers = flagDragOnEveryReader(control);
    return { control, readers, read: () => store.get(sourceName).features[0] };
}

const TOOLS = [
    {
        name: 'arrow',
        path: '../../src/js/military_tools/arrow_tool/add_arrow_control.js',
        source: 'arrows',
    },
    {
        name: 'occupied front',
        path: '../../src/js/military_tools/occupied_front_tool/add_occupied_front_control.js',
        source: 'occupied_fronts',
    },
    {
        name: 'boundary',
        path: '../../src/js/military_tools/boundary_tool/add_boundary_control.js',
        source: 'boundarys',
    },
    {
        name: 'coordination line',
        path: '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js',
        source: 'coordination_lines',
    },
];

describe.each(TOOLS)('the forced source write of the $name', ({ path, source }) => {
    async function setup() {
        const { default: Control } = await import(path);
        const stored = {
            type: 'Feature',
            properties: { id: 'f-1', baseCoordinates: AT_REST, color: '#000000' },
            geometry: { type: 'LineString', coordinates: AT_REST },
        };
        return buildControlWithSource(
            Control,
            {
                generate: () => ({ type: 'LineString', coordinates: AT_REST }),
                normalizeBaseCoordinates: (coordinates) => coordinates,
                createHandles: () => [],
            },
            source,
            stored,
        );
    }

    it('lands while a feature drag is flagged, and moves nothing backwards', async () => {
        const { control, read, readers } = await setup();

        // Every drag reader this control owns is UP, which is what makes the
        // write below a measurement and not a coincidence.
        expect(readers).toContain('selectionManager.uiManager.isDragging');

        await control.forceUpdateMainSource({
            type: 'Feature',
            properties: { id: 'f-1', baseCoordinates: AT_REST, color: '#ff0000' },
            geometry: { type: 'LineString', coordinates: AT_REST },
        });

        const after = read();
        // The new property is in, and the geometry is where the source already
        // had it: the drag holds its position in the selection boxes, never here.
        expect(after.properties.color).toBe('#ff0000');
        expect(after.geometry.coordinates).toEqual(AT_REST);
        expect(after.properties.baseCoordinates).toEqual(AT_REST);
    });

    it('writes the same thing with no drag flagged at all, so the case above is not vacuous', async () => {
        const { control, read } = await setup();
        control.selectionManager.uiManager = { isDragging: false };
        if (typeof control._isDragging === 'function') control._isDragging = () => false;

        await control.forceUpdateMainSource({
            type: 'Feature',
            properties: { id: 'f-1', baseCoordinates: AT_REST, color: '#00ff00' },
            geometry: { type: 'LineString', coordinates: AT_REST },
        });

        expect(read().properties.color).toBe('#00ff00');
    });
});

/**
 * The state-manager reader, on the two tools that declared one.
 *
 * This is the axis the ported file could not see: `_isDragging()` was the LIVE guard the
 * boundary and the coordination line carried in the forced write, and the case above stubs it
 * to true. This one names the tools that must still expose it, so a rename makes the stub
 * above stop being a stub and this file says so out loud.
 */
describe('the live drag reader of the zoom pass', () => {
    const WITH_LIVE_READER = TOOLS.filter(tool => tool.name === 'boundary' || tool.name === 'coordination line');

    it.each(WITH_LIVE_READER)('$name still exposes _isDragging, which the zoom pass keeps using', async ({ path }) => {
        const { default: Control } = await import(path);
        expect(typeof Control.prototype._isDragging).toBe('function');
    });
});

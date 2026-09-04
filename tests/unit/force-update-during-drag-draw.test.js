// Path: tests/unit/force-update-during-drag-draw.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * THE MEASUREMENT BEHIND THE DEAD DRAG GUARD.
 *
 * Six drawing controls carried `if (this.uiManager && this.uiManager.isDragging) return;`
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
 * Part 2 drives the six controls with a drag flagged on the real path
 * (`selectionManager.uiManager.isDragging`), a source holding the position the
 * drag started from, and a forced write carrying a new property. The write lands
 * and nothing retrocedes, in every one of the six.
 *
 * Hence the decision recorded in the sources: DELETE the guard. A live guard here
 * would be worse than none, because nothing reapplies a write it swallowed.
 *
 * The static side of the rule (no `this.uiManager` left in these files) is
 * `tests/unit/ui-manager-guard-regua-draw.test.js`.
 */

vi.mock('../../src/js/snapping/snapping.service.js', () => ({
    getSnappingService: () => null,
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
            properties: { id: 'line-1', source: 'line', baseCoordinates: AT_REST },
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
            controls: new Map([['line', control]]),
            updateSelectedFeatures: async () => {},
            updateProfile: () => {},
        };
        handler.selectedFeatures = [feature];
        handler.offsets = new Map([['line-1', { offset: [0, 0] }]]);
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
        // position the drag started from. This is the measure that decides the
        // guard: there is no partial position for a forced write to undo.
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

/** The six drawing controls that own a main source, and the source each writes. */
const TOOLS = [
    { name: 'line', path: '../../src/js/draw_tools/line_tool/add_line_control.js', source: 'lines' },
    { name: 'polygon', path: '../../src/js/draw_tools/polygon_tool/add_polygon_control.js', source: 'polygons' },
    { name: 'circle', path: '../../src/js/draw_tools/circle_tool/add_circle_control.js', source: 'circles' },
    { name: 'ellipse', path: '../../src/js/draw_tools/ellipse_tool/add_ellipse_control.js', source: 'ellipses' },
    { name: 'rectangle', path: '../../src/js/draw_tools/rectangle_tool/add_rectangle_control.js', source: 'rectangles' },
    { name: 'sector', path: '../../src/js/draw_tools/sector_tool/add_sector_control.js', source: 'setores' },
];

/** Where the source says the feature is when the forced write arrives. */
const AT_REST = [[0, 0], [1, 1]];
/** Somewhere else entirely, for the one test about the write's own mechanics. */
const ELSEWHERE = [[9, 9], [9, 10]];

/**
 * A control whose main source holds real data, so a forced write can be read
 * back instead of only being seen to happen.
 *
 * @param {Function} Control - The control class
 * @param {string} sourceId - The main source id
 * @param {Array} storedCoordinates - What the source holds before the write
 * @param {boolean} isDragging - What `selectionManager.uiManager` reports
 * @returns {Object} The control, the live sources and the write log
 */
function buildControl(Control, sourceId, storedCoordinates, isDragging) {
    const sources = new Map([[sourceId, {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { id: 'f-1', nome: 'velho' },
            geometry: { type: 'LineString', coordinates: storedCoordinates },
        }],
    }]]);
    const writes = [];
    const control = new Control({
        selectionManager: {
            getSelectedFeaturesByType: () => [],
            uiManager: { isDragging },
        },
    });
    control.onAdd({
        getZoom: () => 10,
        getSource: (name) => {
            if (!sources.has(name)) return null;
            return {
                setData: (data) => { sources.set(name, data); writes.push(name); },
                getData: async () => sources.get(name),
            };
        },
        on: () => {},
        off: () => {},
    });
    return { control, sources, writes };
}

/** The update a handle end or a vertex removal pushes: new property, same place. */
const UPDATE = {
    type: 'Feature',
    properties: { id: 'f-1', nome: 'novo', baseCoordinates: AT_REST },
    geometry: { type: 'LineString', coordinates: AT_REST },
};

describe('forceUpdateMainSource while a feature drag is flagged', () => {
    it.each(TOOLS)('$name lands the write, and moves nothing backwards', async (tool) => {
        const { default: Control } = await import(tool.path);
        const { control, sources, writes } = buildControl(Control, tool.source, AT_REST, true);

        await control.forceUpdateMainSource(UPDATE);

        // No guard swallows this. Part 1 measured why: the drag holds its
        // position in the selection boxes, so the source is where the caller
        // last saw it and the write puts the feature back nowhere.
        expect(writes).toEqual([tool.source]);
        const after = sources.get(tool.source).features[0];
        expect(after.properties.nome).toBe('novo');
        expect(after.geometry.coordinates).toEqual(AT_REST);
    });
});

describe('forceUpdateMainSource, the write itself', () => {
    it.each(TOOLS)('$name replaces the geometry, it does not merge properties only', async (tool) => {
        const { default: Control } = await import(tool.path);
        const { control, sources } = buildControl(Control, tool.source, ELSEWHERE, false);

        await control.forceUpdateMainSource(UPDATE);

        // Kept as the reason the guard was once thought necessary: the write is
        // wholesale, so a source holding a NEWER position would go back. Part 1
        // is what settles it, by showing the source never holds one.
        const after = sources.get(tool.source).features[0];
        expect(after.geometry.coordinates).toEqual(AT_REST);
        expect(after.properties.nome).toBe('novo');
    });
});

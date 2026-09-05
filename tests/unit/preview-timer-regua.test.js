// Path: tests/unit/preview-timer-regua.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @fileoverview How every drawing tool builds its preview, in one place.
 *
 * THE TWO RULES, both measured on the port of 2026-09-04 and 2026-09-05:
 *
 * 1. NO TIMER INSIDE A PREVIEW METHOD. The preview already runs inside a
 *    `requestAnimationFrame` gate, so a `setTimeout(..., 8)` (or 12) around the
 *    drawing coalesces nothing: 8 and 12 ms are both under the 16.7 ms of a
 *    frame. It only pushes the drawing one timer late. The `clearTimeout` half
 *    of the debounce counts too: leaving it behind means the timer is still there.
 *
 * 2. NO `snapping.resolve` ON A RAW MOTION EVENT. `resolve` is a
 *    rendered-feature query, and a mouse fires several `mousemove` events inside
 *    one frame while only the last one is ever drawn. The motion handler parks
 *    the pointer; the frame callback resolves it once. Measured on the
 *    coordination line, 2026-09-04: with snapping on and 4 moves per frame,
 *    `map.project()` fell from 35.718 to 10.420 calls in 3 s. Measured again on
 *    the circle, 2026-09-05, with 8 moves per frame: `snapping.resolve` fell
 *    from 1.448 to 180 calls in 3 s, one per frame, and the timers armed during
 *    the gesture fell from 233 to 55, of which zero are shorter than a frame.
 *
 * THREE PARTS, and each one catches what the others cannot:
 *
 * - Part 1 reads the SOURCE of all thirteen controls. It is the only way to
 *   reach a path no test drives: a touch handler, a second debounce hidden in a
 *   method the happy case never enters.
 * - Part 2 DRIVES the four shapes against a fake map, a hand-driven rAF and
 *   frozen fake timers. Text cannot prove that five moves produce one resolve
 *   and one write; only running it can. (The nine line tools have the same
 *   treatment in `tests/unit/preview-frame-gate-driven.test.js`, which is older
 *   and stays where it is.)
 * - Part 3 proves both rules against the degenerate sources they exist to
 *   reject, axis by axis, including the exact shape each of the thirteen
 *   controls had before it was ported.
 *
 * This file is the merge of three: the original ruler over the nine line tools,
 * plus `preview-um-quadro-formas` and `preview-sem-timer-formas`, which covered
 * the four shapes while they arrived one lot at a time. Nothing was dropped.
 */

// ==========================================================================
// PART 1 -- the source, read as text
// ==========================================================================

/**
 * Every tool that builds a preview from pointer motion. The anchors are the
 * members each file must still have: a splitter that stopped matching would
 * report zero violations everywhere and read as a clean bill of health, so each
 * file names the members it is checked through.
 */
const ANCHORS = {
    'src/js/draw_tools/line_tool/add_line_control.js':
        ['handlePreviewMouseMove', 'performPreviewUpdate', 'onEditMouseMove', 'cancelPendingUpdates'],
    'src/js/draw_tools/polygon_tool/add_polygon_control.js':
        ['handlePreviewMouseMove', 'performPreviewUpdate', 'onEditMouseMove', 'cancelPendingUpdates'],
    'src/js/military_tools/arrow_tool/add_arrow_control.js':
        ['handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'cancelPendingUpdates'],
    'src/js/military_tools/occupied_front_tool/add_occupied_front_control.js':
        ['handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'cancelPendingUpdates'],
    'src/js/military_tools/coordination_line_tool/add_coordination_line_control.js':
        ['handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'cancelPendingUpdates'],
    'src/js/military_tools/boundary_tool/add_boundary_control.js':
        ['handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'cancelPendingUpdates'],
    'src/js/analysis_tools/los_tool/add_los_control.js':
        ['handleMouseMove', 'performPreviewUpdate', '_onPreClickMouseMove', 'cancelPendingUpdates'],
    'src/js/analysis_tools/visibility_tool/add_visibility_control.js':
        ['handleMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'cancelPendingUpdates'],
    // The brush has no snap and no `performPreviewUpdate`: its stroke IS the
    // sequence of raw positions, so it parks no pointer and only its feedback
    // drawing rides a frame. It is listed because the timer axis still applies.
    'src/js/draw_tools/brush_tool/add_brush_control.js':
        ['_onPointerMove', 'updatePreview', 'clearPreview'],
    // The four shapes, ported 2026-09-05. Each one carries a pre-click
    // indicator, a drawing preview and a handle drag, and each names the
    // `update*Preview` that used to hold the second 8 ms debounce.
    'src/js/draw_tools/circle_tool/add_circle_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateRadiusPreview', 'cancelPendingUpdates'],
    'src/js/draw_tools/ellipse_tool/add_ellipse_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateEllipsePreview', 'cancelPendingUpdates'],
    'src/js/draw_tools/sector_tool/add_sector_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateHandlePreview', 'cancelPendingUpdates'],
    'src/js/draw_tools/rectangle_tool/add_rectangle_control.js':
        ['_onPreClickMouseMove', 'handlePreviewMouseMove', 'performPreviewUpdate', '_onEditPointerMove', 'updateRectanglePreview', 'cancelPendingUpdates'],
};

const CONTROLS = Object.keys(ANCHORS);

/**
 * Where `snapping.resolve` is still allowed to run on a raw motion event.
 *
 * EMPTY, and it must stay empty. It is written as an exact expectation rather
 * than an allowance, so a tool that regresses fails instead of being waved
 * through by a list nobody prunes.
 */
const KNOWN_RAW_RESOLVE = [];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A timer call, whatever the delay, and both halves of a debounce. */
const TIMER = /\b(?:setTimeout|clearTimeout)\s*\(/;

/** `snapping.resolve(this.map, ...)`, the rendered-feature query. */
const RAW_RESOLVE = /\.resolve\(\s*this\.map\b/;

/** A method that builds or clears a preview. */
const PREVIEW_METHOD = /Preview/;

/** A handler fed straight by `mousemove` / `pointermove` / `touchmove`. */
const MOTION_HANDLER = /(MouseMove|PointerMove|TouchMove)$/;

/**
 * Class members in this codebase sit at four spaces, either as an arrow-function
 * field (`name = (e) => {`) or as a plain method (`name(e) {`).
 */
const METHOD_HEADER = /^ {4}(?:static\s+)?(?:async\s+)?(#?[A-Za-z_$][\w$]*)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)\s*\{)/;

function readSource(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** Comments are prose, not behaviour: a rule that reads them reports the past. */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter(line => !/^\s*\/\//.test(line))
        .join('\n');
}

/**
 * Split a control into `{ name, body }` blocks, one per class member.
 * @param {string} source - The file's text
 * @returns {Array<{name: string, body: string}>} The members, in file order
 */
function methods(source) {
    const lines = source.split('\n');
    const blocks = [];
    let current = { name: '<file scope>', lines: [] };

    for (const line of lines) {
        const header = METHOD_HEADER.exec(line);
        if (header) {
            blocks.push(current);
            current = { name: header[1], lines: [] };
        }
        current.lines.push(line);
    }
    blocks.push(current);

    return blocks.map(block => ({ name: block.name, body: stripComments(block.lines.join('\n')) }));
}

/** `file#method` for every member that breaks a rule, so the failure names it. */
function violations(relativePath, source, nameRule, bodyRule) {
    return methods(source)
        .filter(method => nameRule.test(method.name) && bodyRule.test(method.body))
        .map(method => `${relativePath}#${method.name}`);
}

const timerViolations = (relativePath, source) => violations(relativePath, source, PREVIEW_METHOD, TIMER);
const resolveViolations = (relativePath, source) => violations(relativePath, source, MOTION_HANDLER, RAW_RESOLVE);

describe('no timer inside a preview method', () => {
    it.each(CONTROLS)('%s', (relativePath) => {
        expect(timerViolations(relativePath, readSource(relativePath))).toEqual([]);
    });
});

describe('no snapping.resolve on a raw motion event', () => {
    it.each(CONTROLS)('%s', (relativePath) => {
        const found = resolveViolations(relativePath, readSource(relativePath));
        const allowed = KNOWN_RAW_RESOLVE.filter(entry => entry.startsWith(`${relativePath}#`));
        expect(found).toEqual(allowed);
    });
});

describe('every tool drives its preview through the shared rAF gate', () => {
    it.each(CONTROLS)('%s', (relativePath) => {
        const source = readSource(relativePath);
        expect(source, relativePath).toMatch(/import \{ createPreviewScheduler \} from/);
        expect(source, relativePath).toMatch(/createPreviewScheduler\(\{/);
        expect(source, relativePath).toMatch(/_previewScheduler\.request\(/);
        expect(source, relativePath).toMatch(/_previewScheduler\.cancel\(\)/);
    });

    it.each(CONTROLS)('%s no longer keeps the hand-rolled gate', (relativePath) => {
        // The trio the old block was built from. Leaving one behind means a
        // second gate racing the scheduler on the same preview.
        const source = stripComments(readSource(relativePath));
        expect(source, `${relativePath} previewRafId`).not.toMatch(/\bpreviewRafId\b/);
        expect(source, `${relativePath} pendingPreviewUpdate`).not.toMatch(/\bpendingPreviewUpdate\b/);
        expect(source, `${relativePath} geometryDebounceTimer`).not.toMatch(/\bgeometryDebounceTimer\b/);
    });
});

describe('the ruler reads real files, and finds the members it claims to read', () => {
    it('every control is on disk and long enough to be the real one', () => {
        expect(CONTROLS).toHaveLength(13);
        for (const relativePath of CONTROLS) {
            expect(readSource(relativePath).length).toBeGreaterThan(20000);
        }
    });

    it('the splitter finds the preview methods and the motion handlers it filters by', () => {
        // A splitter that matched nothing would report zero violations for every
        // file and look like a clean bill of health.
        for (const relativePath of CONTROLS) {
            const names = methods(readSource(relativePath)).map(method => method.name);
            expect(names.filter(name => PREVIEW_METHOD.test(name)).length, relativePath).toBeGreaterThanOrEqual(2);
            expect(names.filter(name => MOTION_HANDLER.test(name)).length, relativePath).toBeGreaterThanOrEqual(1);
            for (const anchor of ANCHORS[relativePath]) {
                expect(names, `${relativePath}#${anchor}`).toContain(anchor);
            }
        }
    });
});

// ==========================================================================
// PART 2 -- the four shapes, DRIVEN
// ==========================================================================

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

/**
 * A control wired to a fake map, with its geometry replaced by a recorder. What
 * is under test is HOW MANY times and WITH WHAT the preview is rebuilt, not the
 * turf maths, which has its own tests.
 *
 * @param {Function} Control - The control class
 * @param {Object} geometry - The recorder to install
 * @returns {Object} The control, the map and the recorded writes
 */
function buildControl(Control, geometry) {
    const written = [];
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

    const map = {
        getZoom: () => 10,
        getSource: (name) => ({ setData: (data) => written.push({ name, data }) }),
        getCanvas: () => canvas,
        getCanvasContainer: () => canvas,
        unproject: ([x, y]) => ({ lng: x, lat: y }),
        queryRenderedFeatures: () => [],
        dragPan: { enable() {}, disable() {} },
        on: () => {},
        off: () => {},
    };
    control.onAdd(map);
    return { control, map, written };
}

/** `n` mousemove events inside one frame, ending on `[n, n]`. */
function burst(handler, count) {
    for (let i = 1; i <= count; i += 1) {
        handler({ point: { x: i, y: i }, lngLat: { lng: i, lat: i } });
    }
}

/** The same burst as pointer events, for the handle drag. */
function pointerBurst(handler, count) {
    for (let i = 1; i <= count; i += 1) {
        handler({ isPrimary: true, clientX: i, clientY: i, pointerId: 1 });
    }
}

/**
 * The geometry recorder of a centre-and-radius shape.
 * @param {Array} calls - Where the `generate` calls are noted
 * @returns {Object} The recorder
 */
function centreAndRadiusGeometry(calls) {
    return {
        calculateDistance: () => 1000,
        calculateBearing: () => 45,
        normalizeCenter: (center) => center,
        generate: (...args) => {
            calls.push(args);
            return { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] };
        },
        calculatePreview: (center, position) => ({
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            handlePosition: position,
        }),
        createHandles: () => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }),
    };
}

/**
 * The ELLIPSE recorder.
 *
 * The ellipse is not a centre-and-radius shape: the drawing preview comes out of
 * `calculateInitialDimensions`, and the drag returns THREE handle positions
 * (horizontal, vertical and rotation), which the control writes to the handle source.
 *
 * @param {Array} calls - Where the `generate` calls are noted
 * @returns {Object} The recorder
 */
function ellipseGeometry(calls) {
    return {
        normalizeCenter: (center) => center,
        calculateInitialDimensions: () => ({ majorRadius: 1000, minorRadius: 600, bearing: 45 }),
        generate: (...args) => {
            calls.push(args);
            return { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] };
        },
        calculatePreview: (handleType, position) => ({
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            handlePositions: { horizontal: position, vertical: position, rotation: position },
        }),
        createHandles: () => ([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]),
    };
}

/**
 * The SECTOR recorder, which does not fit the centre-and-radius one.
 *
 * The slice takes four arguments in `generate` (centre, radius, bearing and
 * aperture), and its `calculatePreview` receives the HANDLE ID first and returns
 * `handles` with BOTH points (radius and aperture), not a `handlePosition`. A
 * centre-and-radius recorder would return `undefined` there and the drag preview
 * would come out silent, approved by omission.
 *
 * @param {Array} calls - Where the `generate` calls are noted
 * @returns {Object} The recorder
 */
function sectorGeometry(calls) {
    return {
        calculateDistance: () => 1000,
        calculateBearing: () => 45,
        normalizeCenter: (center) => center,
        generate: (...args) => {
            calls.push(args);
            return { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] };
        },
        calculatePreview: (handleId, position) => ({
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            handles: [position, position],
            radius: 1000,
            bearing: 45,
            aperture: 60,
        }),
        createHandles: () => [],
    };
}

/**
 * The RECTANGLE recorder.
 *
 * The rectangle's drawing has no centre and no radius: the two clicks are
 * opposite CORNERS, and the 10 m floor is charged against the width and the
 * height that `calculateDimensionsFromCorners` returns. The handle drag returns
 * THREE positions (width, height and rotation), which the control writes to the
 * handle source in a single write.
 *
 * @param {Array} calls - Where the `generate` calls are noted
 * @returns {Object} The recorder
 */
function rectangleGeometry(calls) {
    return {
        normalizeCenter: (center) => center,
        normalizeCorner: (corner) => corner,
        // Above the 10 m floor, otherwise the drawing preview does not come out
        // and the case would pass for having measured nothing.
        calculateDimensionsFromCorners: () => ({ center: [0, 0], width: 1000, height: 800 }),
        generate: (...args) => {
            calls.push(args);
            return { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] };
        },
        calculatePreview: (handleType, position) => ({
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
            handlePositions: { width: position, height: position, rotation: position },
        }),
        createHandlesFromGeometry: () => ([{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }]),
    };
}

/**
 * The shapes under the driven ruler.
 *
 * `prepareDrawing` puts the control in the state of the case; `feedback` and
 * `handles` are the sources the shape writes.
 */
const SHAPES = [
    {
        name: 'circle',
        load: () => import('../../src/js/draw_tools/circle_tool/add_circle_control.js'),
        feedback: 'circle-feedback',
        handles: 'circle-edit-handles',
        geometry: centreAndRadiusGeometry,
        featureId: 'circle-1',
        // The centre already clicked, which is the state the radius preview lives in.
        prepareDrawing: (control) => { control.drawPoints = [[0, 0]]; },
        // What the handle drag needs: a selected feature with a centre.
        feature: () => ({
            type: 'Feature',
            properties: { id: 'circle-1', source: 'circle', center: [0, 0], radius: 500 },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        }),
        moveDrawing: (control) => control.handlePreviewMouseMove,
        movePreClick: (control) => control._onPreClickMouseMove,
        moveHandle: (control) => control._onEditPointerMove.bind(control),
    },
    {
        name: 'ellipse',
        load: () => import('../../src/js/draw_tools/ellipse_tool/add_ellipse_control.js'),
        feedback: 'ellipse-feedback',
        handles: 'ellipse-edit-handles',
        geometry: ellipseGeometry,
        featureId: 'ellipse-1',
        prepareDrawing: (control) => { control.drawPoints = [[0, 0]]; },
        feature: () => ({
            type: 'Feature',
            properties: { id: 'ellipse-1', source: 'ellipse', center: [0, 0], majorRadius: 500, minorRadius: 300, bearing: 0 },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        }),
        moveDrawing: (control) => control.handlePreviewMouseMove,
        movePreClick: (control) => control._onPreClickMouseMove,
        // The ellipse has THREE handles, and the preview only knows which one to
        // move from the `activeHandleType` the `pointerdown` fixes. The case
        // drives `pointermove` directly, so the case's handle is chosen here.
        moveHandle: (control) => {
            control.activeHandleType = 'horizontal-resize';
            return control._onEditPointerMove.bind(control);
        },
    },
    {
        name: 'sector',
        load: () => import('../../src/js/draw_tools/sector_tool/add_sector_control.js'),
        // The map source is called `setores`, in Portuguese; the feedback and
        // handle prefixes stay in English.
        feedback: 'sector-feedback',
        handles: 'sector-edit-handles',
        geometry: sectorGeometry,
        featureId: 'sector-1',
        // The centre already clicked. The second click gives radius and bearing
        // at once, and the aperture comes from DEFAULT_PROPERTIES, so the
        // sector's preview lives with ONE point stored, like the circle's.
        prepareDrawing: (control) => { control.drawPoints = [[0, 0]]; },
        feature: () => ({
            type: 'Feature',
            properties: { id: 'sector-1', source: 'sector', center: [0, 0], radius: 500, bearing: 0, aperture: 60 },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        }),
        moveDrawing: (control) => control.handlePreviewMouseMove,
        movePreClick: (control) => control._onPreClickMouseMove,
        // The sector has TWO handles (radius and aperture), and
        // `updateHandlePreview` leaves by the back door without the
        // `activeHandleId` the `pointerdown` fixes. Without this line the drag
        // case would pass with zero writes.
        moveHandle: (control) => {
            control.activeHandleId = 'radius';
            return control._onEditPointerMove.bind(control);
        },
    },
    {
        name: 'rectangle',
        load: () => import('../../src/js/draw_tools/rectangle_tool/add_rectangle_control.js'),
        feedback: 'rectangle-feedback',
        handles: 'rectangle-edit-handles',
        geometry: rectangleGeometry,
        featureId: 'rectangle-1',
        // The first CORNER already clicked: the rectangle's preview lives
        // between the two clicks, like the others, only the stored point is a corner.
        prepareDrawing: (control) => { control.drawPoints = [[0, 0]]; },
        feature: () => ({
            type: 'Feature',
            properties: {
                id: 'rectangle-1', source: 'rectangle', center: [0, 0],
                width: 500, height: 300, bearing: 0, borderRadius: 0,
                corner1: [1, 1], corner2: [-1, -1],
            },
            geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] },
        }),
        moveDrawing: (control) => control.handlePreviewMouseMove,
        movePreClick: (control) => control._onPreClickMouseMove,
        // The rectangle has THREE handles (width, height and rotation), and
        // `updateRectanglePreview` stays silent without the `activeHandleType`
        // the `pointerdown` fixes. Without this line the drag case would pass
        // with zero writes, approved by omission.
        moveHandle: (control) => {
            control.activeHandleType = 'width-resize';
            return control._onEditPointerMove.bind(control);
        },
    },
];

describe('the four shapes, driven', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;

    beforeEach(() => {
        snapping.reset();
        clock.install();
        // Fake timers, NEVER advanced: a `setTimeout` in the preview path shows
        // up as a write that did not happen plus a pending timer.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    describe.each(SHAPES)('$name: one frame, one resolve, one write', (shape) => {
        async function setup() {
            const module = await shape.load();
            const Control = module.default;
            const generated = [];
            const built = buildControl(Control, shape.geometry(generated));
            return { ...built, generated };
        }

        it('resolves the snap ONCE per frame, with the last position of the burst', async () => {
            const { control, written, generated } = await setup();
            shape.prepareDrawing(control);

            burst(shape.moveDrawing(control), 5);

            // Nothing happened on the raw event: that is the whole point.
            expect(snapping.resolveCalls).toHaveLength(0);
            expect(written).toHaveLength(0);

            expect(clock.frame()).toBe(1);

            expect(snapping.resolveCalls).toHaveLength(1);
            expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
            expect(snapping.resolveCalls[0].point).toEqual({ x: 5, y: 5 });
            expect(generated).toHaveLength(1);
            // The geometry came from the clicked centre, not from an intermediate position.
            expect(generated[0][0]).toEqual([0, 0]);
        });

        it('writes the feedback INSIDE the frame, with no timer in the path', async () => {
            const { control, written } = await setup();
            shape.prepareDrawing(control);

            burst(shape.moveDrawing(control), 5);
            clock.frame();

            // With fake timers and a frozen clock, a write deferred by
            // `setTimeout(..., 8)` would come out as zero writes and a pending timer.
            const onFeedback = written.filter((write) => write.name === shape.feedback);
            expect(onFeedback).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);
            // And the next frame redraws nothing on its own.
            expect(clock.frame()).toBe(0);
        });

        it('the indicator before the first click coalesces too', async () => {
            const { control, written } = await setup();

            burst(shape.movePreClick(control), 5);
            expect(snapping.resolveCalls).toHaveLength(0);

            clock.frame();

            expect(snapping.resolveCalls).toHaveLength(1);
            expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
            // There is nothing to draw before the first click.
            expect(written).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('the handle drag rides the same frame and excludes its own feature', async () => {
            const { control, written } = await setup();
            const feature = shape.feature();
            control.selectionManager.getSelectedFeaturesByType = () => [{ feature }];
            control.isDraggingHandle = true;

            pointerBurst(shape.moveHandle(control), 5);
            expect(snapping.resolveCalls).toHaveLength(0);

            clock.frame();

            expect(snapping.resolveCalls).toHaveLength(1);
            expect(snapping.resolveCalls[0].excludeFeatureId).toBe(shape.featureId);
            expect(snapping.resolveCalls[0].lngLat).toEqual({ lng: 5, lat: 5 });
            expect(written.filter((write) => write.name === shape.feedback)).toHaveLength(1);
            expect(written.filter((write) => write.name === shape.handles)).toHaveLength(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('cancelPendingUpdates drops the frame, and nothing is drawn after it', async () => {
            const { control, written, generated } = await setup();
            shape.prepareDrawing(control);

            burst(shape.moveDrawing(control), 3);
            control.cancelPendingUpdates();

            expect(clock.frame()).toBe(0);
            expect(snapping.resolveCalls).toHaveLength(0);
            expect(generated).toHaveLength(0);
            expect(written).toHaveLength(0);
            expect(vi.getTimerCount()).toBe(0);
        });

        it('a move after the frame buys a new frame', async () => {
            const { control } = await setup();
            shape.prepareDrawing(control);

            burst(shape.moveDrawing(control), 2);
            clock.frame();
            burst(shape.moveDrawing(control), 4);
            clock.frame();

            expect(snapping.resolveCalls).toHaveLength(2);
            expect(snapping.resolveCalls.map((call) => call.lngLat.lng)).toEqual([2, 4]);
        });
    });

    describe('the driven ruler covers the shapes it claims to cover', () => {
        it('the four shapes are on the list', () => {
            expect(SHAPES.map((shape) => shape.name)).toEqual(['circle', 'ellipse', 'sector', 'rectangle']);
            // A `describe.each` over an empty list runs no case at all and passes silently.
            expect(SHAPES.length).toBeGreaterThanOrEqual(4);
        });

        it('each shape declares the three preview paths the ruler drives', () => {
            for (const shape of SHAPES) {
                expect(typeof shape.prepareDrawing, shape.name).toBe('function');
                expect(typeof shape.moveDrawing, shape.name).toBe('function');
                expect(typeof shape.movePreClick, shape.name).toBe('function');
                expect(typeof shape.moveHandle, shape.name).toBe('function');
                expect(shape.feedback, shape.name).toMatch(/-feedback$/);
                expect(shape.handles, shape.name).toMatch(/-edit-handles$/);
            }
        });

        it('the driven rAF does not run on its own, or the burst would never sit in one frame', () => {
            clock.install();
            let ran = false;
            globalThis.requestAnimationFrame(() => { ran = true; });
            expect(ran).toBe(false);
            expect(clock.frame()).toBe(1);
            expect(ran).toBe(true);
        });

        it('every driven shape is also read as text by Part 1', () => {
            // The two halves must cover the same four files. A shape driven here
            // and absent from ANCHORS would keep its touch handler unchecked.
            for (const shape of SHAPES) {
                const expected = `src/js/draw_tools/${shape.name}_tool/add_${shape.name}_control.js`;
                expect(CONTROLS, shape.name).toContain(expected);
            }
        });
    });
});

// ==========================================================================
// PART 3 -- the degenerate sources both rules exist to reject
// ==========================================================================

/**
 * Each axis gets its own worst case, and each worst case is also run past the
 * OTHER axis, so neither rule is seen to pass by omission.
 */
describe('the rules reject the state they exist to catch', () => {
    /**
     * One old member, caught by NAME and by the right axis only.
     *
     * `toHaveLength(1)` would pass on a rule that named the wrong member, and a
     * source seen to break one axis has to be seen NOT to break the other, or a
     * rule that fired on everything would look like two rules working.
     *
     * @param {string} label - `tool#member`, the member being reproved
     * @param {string} source - The degenerate source
     * @param {Function} rule - The axis that must catch it
     */
    function expectCaughtByName(label, source, rule) {
        const member = label.split('#')[1];
        const other = rule === timerViolations ? resolveViolations : timerViolations;
        expect(rule('old.js', source), label).toEqual([`old.js#${member}`]);
        expect(other('old.js', source), `${label} (outro eixo)`).toEqual([]);
    }

    const TIMER_IN_PREVIEW = [
        'class Bad {',
        '    updateDrawingPreview = () => {',
        '        clearTimeout(this.geometryDebounceTimer);',
        '        this.geometryDebounceTimer = setTimeout(() => {',
        '            this.showPreview(this.geometry.generate(coords));',
        '        }, 8);',
        '    }',
        '}',
    ].join('\n');

    const RESOLVE_ON_RAW_EVENT = [
        'class Bad {',
        '    handlePreviewMouseMove = (e) => {',
        '        const snapping = getSnappingService();',
        '        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;',
        '        this.lastPreviewPosition = [snap.lng, snap.lat];',
        '        if (!this.pendingPreviewUpdate) {',
        '            this.pendingPreviewUpdate = true;',
        '            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);',
        '        }',
        '    }',
        '}',
    ].join('\n');

    it('reproves an 8 ms timer inside a preview method', () => {
        expect(timerViolations('bad.js', TIMER_IN_PREVIEW)).toEqual(['bad.js#updateDrawingPreview']);
        // ...and the other axis is silent on it, which is why both are needed.
        expect(resolveViolations('bad.js', TIMER_IN_PREVIEW)).toEqual([]);
    });

    it('reproves a resolve on the raw mousemove', () => {
        expect(resolveViolations('bad.js', RESOLVE_ON_RAW_EVENT)).toEqual(['bad.js#handlePreviewMouseMove']);
        expect(timerViolations('bad.js', RESOLVE_ON_RAW_EVENT)).toEqual([]);
    });

    it('reproves a pointermove handler too, not only a mousemove one', () => {
        const source = [
            'class Bad {',
            '    _onEditPointerMove(e) {',
            '        const snap = snapping?.resolve(this.map, point, lngLat, id) ?? lngLat;',
            '    }',
            '}',
        ].join('\n');
        expect(resolveViolations('bad.js', source)).toEqual(['bad.js#_onEditPointerMove']);
    });

    it('reproves a TOUCH handler, which no driven test exercises', () => {
        // The reason a source-reading ruler exists: a path only a touch device
        // walks comes out approved by omission in the driven test.
        const source = 'class Bad {\n    _onTouchMove(e) {\n        const snap = snapping?.resolve(this.map, p, l) ?? l;\n    }\n}';
        expect(resolveViolations('bad.js', source)).toEqual(['bad.js#_onTouchMove']);
    });

    it('reproves a timer with any delay, not just the 8 ms one', () => {
        for (const delay of [1, 12, 16, 250]) {
            const source = `class Bad {\n    updateArrowPreview = () => {\n        setTimeout(() => this.draw(), ${delay});\n    }\n}`;
            expect(timerViolations('bad.js', source)).toEqual(['bad.js#updateArrowPreview']);
        }
    });

    it('reproves any delay on a shape preview too, 8 ms included', () => {
        for (const delay of [1, 8, 12, 16, 250]) {
            const source = `class Bad {\n    updateSectorPreview = () => {\n        setTimeout(() => this.draw(), ${delay});\n    }\n}`;
            expect(timerViolations('bad.js', source)).toEqual(['bad.js#updateSectorPreview']);
        }
    });

    it('reproves a lone clearTimeout, which is the other half of the debounce', () => {
        const source = 'class Bad {\n    clearPreview = () => {\n        clearTimeout(this.geometryDebounceTimer);\n    }\n}';
        expect(timerViolations('bad.js', source)).toEqual(['bad.js#clearPreview']);
    });

    it('does not fire on the shapes that are FINE, so it is not a blanket ban', () => {
        // A timer outside a preview method: the vertex-removal toast, the drag
        // recalculation. Both are real and must stay.
        const timerElsewhere = [
            'class Fine {',
            '    showVertexRemovalWarning() {',
            '        setTimeout(() => warning.remove(), 2000);',
            '    }',
            '}',
        ].join('\n');
        expect(timerViolations('fine.js', timerElsewhere)).toEqual([]);

        // A resolve on a CLICK: one per click, not per frame, and the click is
        // what decides the vertex, so it cannot wait for a frame.
        const resolveOnClick = [
            'class Fine {',
            '    handleMapClick = (e) => {',
            '        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;',
            '    }',
            '    performPreviewUpdate = (pointer) => {',
            '        const snap = snapping?.resolve(this.map, pointer.point, pointer.lngLat) ?? pointer.lngLat;',
            '    }',
            '}',
        ].join('\n');
        expect(resolveViolations('fine.js', resolveOnClick)).toEqual([]);

        // The right-click finish resolves once too, and it is not motion.
        const resolveOnRightClick = [
            'class Fine {',
            '    handleRightClick = async (e) => {',
            '        const snap = snapping?.resolve(this.map, screenPoint, coordinates) ?? coordinates;',
            '    }',
            '}',
        ].join('\n');
        expect(resolveViolations('fine.js', resolveOnRightClick)).toEqual([]);
    });

    it('reads code, not comments: a rule that read prose would report the past', () => {
        const commentOnly = [
            'class Fine {',
            '    updateDrawingPreview = () => {',
            '        /* the setTimeout(..., 8) this used to carry coalesced nothing */',
            '        // setTimeout(() => this.draw(), 8);',
            '        this.showPreview(this.geometry.generate(coords));',
            '    }',
            '}',
        ].join('\n');
        expect(timerViolations('fine.js', commentOnly)).toEqual([]);

        // And the stripper does not eat the code around the comment.
        const commentPlusCode = commentOnly.replace(
            '        this.showPreview(this.geometry.generate(coords));',
            '        setTimeout(() => this.showPreview(1), 8);',
        );
        expect(timerViolations('bad.js', commentPlusCode)).toEqual(['bad.js#updateDrawingPreview']);
    });

    it('reads code, not comments, on a shape preview as well', () => {
        const commentOnly = [
            'class Fine {',
            '    updateRadiusPreview = () => {',
            '        /* o setTimeout(..., 8) que morava aqui nao coalescia nada */',
            '        // clearTimeout(this.geometryDebounceTimer);',
            '        this.showPreview(this.geometry.generate(center, radius));',
            '    }',
            '}',
        ].join('\n');
        expect(timerViolations('fine.js', commentOnly)).toEqual([]);

        const commentPlusCode = commentOnly.replace(
            '        this.showPreview(this.geometry.generate(center, radius));',
            '        setTimeout(() => this.showPreview(1), 8);',
        );
        expect(timerViolations('bad.js', commentPlusCode)).toEqual(['bad.js#updateRadiusPreview']);
    });

    it('reproves the version of each of the five that the second round replaced', () => {
        // Copied verbatim from the shape each file had before 2026-09-04. The
        // brush is absent on purpose and is covered below: it carried neither
        // defect, so these two rules had nothing to say about it.
        const oldShapes = [
            ['boundary#_onPreClickMouseMove', 'class C {\n    _onPreClickMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['boundary#handlePreviewMouseMove', 'class C {\n    handlePreviewMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat, this._extending?.featureId) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['boundary#_onEditPointerMove', 'class C {\n    _onEditPointerMove(e) {\n        const snap = snapping?.resolve(this.map, point, lngLat, excludeId) ?? lngLat;\n    }\n}', resolveViolations],
            ['boundary#performPreviewUpdate', 'class C {\n    performPreviewUpdate = () => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
            ['boundary#updateBoundaryPreview', 'class C {\n    updateBoundaryPreview = (newPosition) => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
            ['boundary#_updateExtensionPreview', 'class C {\n    _updateExtensionPreview = () => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
            ['coordination#_onEditPointerMove', 'class C {\n    _onEditPointerMove(e) {\n        const snap = snapping?.resolve(this.map, point, lngLat, selectedFeature.properties?.id) ?? lngLat;\n    }\n}', resolveViolations],
            ['los#_onPreClickMouseMove', 'class C {\n    _onPreClickMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['los#handleMouseMove', 'class C {\n    handleMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['los#performPreviewUpdate', 'class C {\n    performPreviewUpdate = () => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
            ['visibility#_onPreClickMouseMove', 'class C {\n    _onPreClickMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['visibility#handleMouseMove', 'class C {\n    handleMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['visibility#_onEditPointerMove', 'class C {\n    _onEditPointerMove(e) {\n        const snap = snapping?.resolve(this.map, { x: point.x, y: point.y }, lngLat, excludeId) ?? lngLat;\n    }\n}', resolveViolations],
        ];

        for (const [label, source, rule] of oldShapes) {
            expectCaughtByName(label, source, rule);
        }
    });

    it('says nothing about the brush, which is why the DRIVEN ruler exists', () => {
        // The brush's old shape: no snap at all, no timer, a hand-rolled gate.
        // Both rules pass on it, and neither would have caught a regression that
        // dropped points or wrote the source once per event. Only
        // `preview-frame-gate-driven.test.js` pins that, and this test records
        // the blind spot instead of leaving it to be discovered.
        const oldBrush = [
            'class C {',
            '    _onPointerMove(e) {',
            '        this.points.push([lngLat.lng, lngLat.lat]);',
            '        if (!this.pendingPreviewUpdate) {',
            '            this.pendingPreviewUpdate = true;',
            '            this.previewRafId = requestAnimationFrame(this.updatePreview);',
            '        }',
            '    }',
            '    updatePreview = () => {',
            '        this.map.getSource("brush-feedback").setData({});',
            '    }',
            '}',
        ].join('\n');

        expect(timerViolations('old.js', oldBrush)).toEqual([]);
        expect(resolveViolations('old.js', oldBrush)).toEqual([]);
    });

    it('reproves the version of each of the four that the first round replaced', () => {
        // The old shapes, one line each, in the exact form they had at HEAD
        // before 2026-09-04. Every one of them must be caught.
        const oldShapes = [
            ['line#updateDrawingPreview', 'class C {\n    updateDrawingPreview = () => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
            ['line#_onPreClickMouseMove', 'class C {\n    _onPreClickMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['polygon#onEditMouseMove', 'class C {\n    onEditMouseMove = (e) => {\n        const snap = snapping?.resolve(this.map, e.point, e.lngLat, id) ?? e.lngLat;\n    }\n}', resolveViolations],
            ['arrow#performPreviewUpdate', 'class C {\n    performPreviewUpdate = () => {\n        this.geometryDebounceTimer = setTimeout(() => {}, isAirmobile ? 12 : 8);\n    }\n}', timerViolations],
            ['occupied#updateOccupiedFrontPreview', 'class C {\n    updateOccupiedFrontPreview = (p) => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
        ];

        for (const [label, source, rule] of oldShapes) {
            expectCaughtByName(label, source, rule);
        }
    });

    it('reproves the version of each of the four SHAPES that the third round replaced', () => {
        // Copied from the circle at c5eb5046, which the other three matched line
        // for line: a pre-click resolve, a drawing resolve, a drag resolve, and
        // the two 8 ms debounces (the drawing one and the handle one).
        const oldShapes = [
            ['circle#_onPreClickMouseMove', [
                'class C {',
                '    _onPreClickMouseMove = (e) => {',
                '        const snapping = getSnappingService();',
                '        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;',
                '        if (snap.snapped) {',
                '            snapping.showIndicator(this.map, snap, snap.snapType);',
                '        }',
                '    }',
                '}',
            ].join('\n'), resolveViolations],
            ['circle#handlePreviewMouseMove', [
                'class C {',
                '    handlePreviewMouseMove = (e) => {',
                '        const snap = snapping?.resolve(this.map, e.point, e.lngLat) ?? e.lngLat;',
                '        this.lastPreviewPosition = [snap.lng, snap.lat];',
                '        if (!this.pendingPreviewUpdate) {',
                '            this.pendingPreviewUpdate = true;',
                '            this.previewRafId = requestAnimationFrame(this.performPreviewUpdate);',
                '        }',
                '    }',
                '}',
            ].join('\n'), resolveViolations],
            ['circle#_onEditPointerMove', [
                'class C {',
                '    _onEditPointerMove(e) {',
                '        const snap = snapping?.resolve(this.map, point, lngLat, excludeId) ?? lngLat;',
                '    }',
                '}',
            ].join('\n'), resolveViolations],
            ['circle#performPreviewUpdate', [
                'class C {',
                '    performPreviewUpdate = () => {',
                '        const radius = this.geometry.calculateDistance(center, this.lastPreviewPosition);',
                '        if (radius >= 10) {',
                '            clearTimeout(this.geometryDebounceTimer);',
                '            this.geometryDebounceTimer = setTimeout(() => {',
                '                this.showPreview(this.geometry.generate(center, radius));',
                '            }, 8);',
                '        }',
                '    }',
                '}',
            ].join('\n'), timerViolations],
            ['circle#updateRadiusPreview', [
                'class C {',
                '    updateRadiusPreview = (newPosition) => {',
                '        clearTimeout(this.geometryDebounceTimer);',
                '        this.geometryDebounceTimer = setTimeout(() => {',
                '            this.map.getSource("circle-feedback").setData({});',
                '        }, 8);',
                '    }',
                '}',
            ].join('\n'), timerViolations],
            ['ellipse#updateEllipsePreview', 'class C {\n    updateEllipsePreview = (p) => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
            ['rectangle#updateRectanglePreview', 'class C {\n    updateRectanglePreview = (p) => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
            ['sector#updateHandlePreview', 'class C {\n    updateHandlePreview = (p) => {\n        this.geometryDebounceTimer = setTimeout(() => {}, 8);\n    }\n}', timerViolations],
        ];

        for (const [label, source, rule] of oldShapes) {
            expectCaughtByName(label, source, rule);
        }
    });
});

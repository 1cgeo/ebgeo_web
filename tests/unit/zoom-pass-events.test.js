// Path: tests/unit/zoom-pass-events.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The driven blocks below `import()` seven control module graphs, and the first
// test to reach one pays the whole transform for it. Alone the file runs in
// about 3 s; inside `npx vitest run`, with 140 files competing for the same
// transform pipeline, that first import alone crossed the 5 s default and timed
// out the point tool's first test (measured 2026-09-04, when the boundary block
// was added). The budget is the instrument here, not the code under test.
vi.setConfig({ testTimeout: 20000 });

/**
 * Which map event each tool's JavaScript zoom pass hangs off.
 *
 * The layers derive the zoom-scaled size on the GPU now
 * (`src/js/layers/styles/zoom-expression.js`), so the JavaScript pass no longer
 * feeds the drawing: it only refreshes the stored `calculated*` properties for
 * the consumers outside it (export, selection box, feature header). That is
 * worth doing ONCE per gesture, on `zoomend`, instead of on every frame of it.
 *
 * The exception is geometry expressed in DEGREES. A feature whose zoom
 * correction is OFF keeps a constant size on the screen, so its `selectionBox`
 * (and, for text, its background polygon) covers a different patch of ground at
 * every zoom step, and no style expression can rewrite it. Those tools keep a
 * per-frame `zoom` handler restricted to exactly those features, next to the
 * full pass on `zoomend`.
 *
 * The two lists below are the contract. This file reads the controls as text
 * because instantiating them needs `document`, and this suite runs on `node`.
 *
 * NOT listed on purpose: `tool_manager/managers/selection-highlight.manager.js`,
 * which rebuilds geometry on every frame by design and stays on `zoom`.
 */
const ZOOMEND_ONLY = [
    'src/js/military_tools/declination_tool/add_declination_control.js',
    'src/js/draw_tools/brush_tool/add_brush_control.js',
    'src/js/draw_tools/circle_tool/add_circle_control.js',
    'src/js/draw_tools/ellipse_tool/add_ellipse_control.js',
    'src/js/draw_tools/polygon_tool/add_polygon_control.js',
    'src/js/draw_tools/rectangle_tool/add_rectangle_control.js',
    'src/js/draw_tools/sector_tool/add_sector_control.js',
];

/**
 * Tools that support features with the zoom correction disabled AND recompute
 * ground geometry for them, so they need both handlers.
 */
const ZOOM_AND_ZOOMEND = [
    'src/js/draw_tools/point_tool/add_point_control.js',
    'src/js/draw_tools/text_tool/add_text_control.js',
    'src/js/draw_tools/image_tool/add_image_control.js',
    'src/js/military_tools/military_symbol_tool/add_military_symbol_control.js',
    'src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js',
    // The coordination line's ground geometry is its DIAMONDS: a line pinned to
    // the screen sizes them in kilometres from the zoom, so they are rebuilt per
    // frame while its stroke width comes from the layer's expression.
    'src/js/military_tools/coordination_line_tool/add_coordination_line_control.js',
    // The boundary's is its ECHELON, sized in kilometres the same way, along with
    // the circles and labels placed at a distance from it. Its three pixel sizes
    // (line, label, circle stroke) come from the layers' expressions.
    'src/js/military_tools/boundary_tool/add_boundary_control.js',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `.on('zoom'` / `.on("zoom"`, and NOT `.on('zoomend'`: the closing quote decides. */
const PER_FRAME_ZOOM = /\.on\(\s*(['"])zoom\1/;
const END_OF_GESTURE_ZOOM = /\.on\(\s*(['"])zoomend\1/;

/** A registration, with the event and the handler expression it was given. */
const ON_ZOOM_HANDLER = /\.on\(\s*(['"])(zoom|zoomend)\1\s*,\s*([\w.#]+)\s*\)/g;
const OFF_ZOOM_HANDLER = /\.off\(\s*(['"])(zoom|zoomend)\1\s*,\s*([\w.#]+)\s*\)/g;

function readSource(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** The set of `event|handler` pairs a regex finds, sorted for comparison. */
function registrations(source, regex) {
    const found = new Set();
    for (const match of source.matchAll(regex)) {
        found.add(`${match[2]}|${match[3]}`);
    }
    return [...found].sort();
}

describe('the JavaScript zoom passes hang off zoomend', () => {
    it.each(ZOOMEND_ONLY)('%s registers zoomend and never zoom', (relativePath) => {
        const source = readSource(relativePath);

        expect(PER_FRAME_ZOOM.test(source)).toBe(false);
        expect(END_OF_GESTURE_ZOOM.test(source)).toBe(true);
        expect(registrations(source, ON_ZOOM_HANDLER)).toEqual(
            registrations(source, OFF_ZOOM_HANDLER),
        );
    });

    it.each(ZOOM_AND_ZOOMEND)('%s registers both zoom and zoomend', (relativePath) => {
        const source = readSource(relativePath);

        expect(PER_FRAME_ZOOM.test(source)).toBe(true);
        expect(END_OF_GESTURE_ZOOM.test(source)).toBe(true);

        const on = registrations(source, ON_ZOOM_HANDLER);
        const off = registrations(source, OFF_ZOOM_HANDLER);
        expect(on).toEqual(off);
        // Two distinct events, each with its own handler: a file that registered
        // the same function twice would pass the two `test` calls above.
        expect(on.filter(entry => entry.startsWith('zoom|'))).toHaveLength(1);
        expect(on.filter(entry => entry.startsWith('zoomend|'))).toHaveLength(1);
        expect(new Set(on.map(entry => entry.split('|')[1])).size).toBe(2);
    });
});

describe('the rules above reject the state they exist to catch', () => {
    it('flags the old per-frame registration, in either quote style', () => {
        expect(PER_FRAME_ZOOM.test("map.on('zoom', this.handleZoomChange)")).toBe(true);
        expect(PER_FRAME_ZOOM.test('this.map.on("zoom", this.handleZoomChange)')).toBe(true);
        expect(PER_FRAME_ZOOM.test('map.on(  "zoom" , this.#handleZoom)')).toBe(true);
    });

    it('does not mistake zoomend for zoom, in either direction', () => {
        expect(PER_FRAME_ZOOM.test("map.on('zoomend', this.handleZoomChange)")).toBe(false);
        expect(END_OF_GESTURE_ZOOM.test("map.on('zoom', this.handleZoomChange)")).toBe(false);
    });

    it('flags a registration left without its off, and a mismatched handler', () => {
        const noOff = "map.on('zoomend', this.handleZoomChange);";
        expect(registrations(noOff, ON_ZOOM_HANDLER)).not.toEqual(
            registrations(noOff, OFF_ZOOM_HANDLER),
        );

        const wrongHandler = `
            map.on('zoomend', this.handleZoomEnd);
            map.off('zoomend', this.handleZoomChange);
        `;
        expect(registrations(wrongHandler, ON_ZOOM_HANDLER)).not.toEqual(
            registrations(wrongHandler, OFF_ZOOM_HANDLER),
        );

        const missingSecondOff = `
            map.on('zoom', this.handleZoomChange);
            map.on('zoomend', this.handleZoomEnd);
            map.off('zoom', this.handleZoomChange);
        `;
        expect(registrations(missingSecondOff, ON_ZOOM_HANDLER)).not.toEqual(
            registrations(missingSecondOff, OFF_ZOOM_HANDLER),
        );
    });

    it('flags a file that registers one handler on both events', () => {
        const sameHandlerTwice = `
            map.on('zoom', this.handleZoomChange);
            map.on('zoomend', this.handleZoomChange);
        `;
        const on = registrations(sameHandlerTwice, ON_ZOOM_HANDLER);
        // Both `test` calls of the two-handler check would pass on this string;
        // the handler count is what reproves it.
        expect(PER_FRAME_ZOOM.test(sameHandlerTwice)).toBe(true);
        expect(END_OF_GESTURE_ZOOM.test(sameHandlerTwice)).toBe(true);
        expect(new Set(on.map(entry => entry.split('|')[1])).size).toBe(1);
    });

    it('reads real files, not an empty list', () => {
        expect(ZOOMEND_ONLY.length + ZOOM_AND_ZOOMEND.length).toBe(14);
        for (const relativePath of [...ZOOMEND_ONLY, ...ZOOM_AND_ZOOMEND]) {
            expect(readSource(relativePath).length).toBeGreaterThan(1000);
        }
    });
});

/**
 * The point tool, driven for real.
 *
 * `add_point_control.js` imports cleanly on the `node` environment (nothing in
 * its chain touches `document` at module scope), so the two handlers can be
 * fired against a fake map instead of being read as text. This is the part the
 * regexes above cannot see: WHICH features each pass touches.
 */
describe('the point tool split, driven', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;

    /** rAF that runs the callback on the microtask queue and lets the test await it. */
    function installRaf(pending) {
        let id = 0;
        globalThis.requestAnimationFrame = (callback) => {
            pending.push(Promise.resolve().then(callback));
            return ++id;
        };
        globalThis.cancelAnimationFrame = () => {};
    }

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    function makePoint(id, overrides) {
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-53.8, -29.9] },
            properties: {
                id,
                size: 10,
                lineWidth: 0,
                sizeCreatedAtZoom: 10,
                calculatedSize: 10,
                sizeZoomCorrectionEnabled: true,
                selectionBox: null,
                ...overrides,
            },
        };
    }

    function makeMap(features) {
        const collection = { type: 'FeatureCollection', features };
        const source = {
            setDataCalls: 0,
            serialize: () => ({ data: collection }),
            setData(data) {
                collection.features = data.features;
                this.setDataCalls += 1;
            },
        };
        const listeners = new Map();
        return {
            zoom: 10,
            source,
            collection,
            listeners,
            getZoom() { return this.zoom; },
            getSource: (name) => (name === 'points' ? source : undefined),
            getCanvas: () => ({ style: {} }),
            on(event, handler) { listeners.set(event, handler); },
            off(event, handler) {
                if (listeners.get(event) === handler) listeners.delete(event);
            },
            fire(event) { listeners.get(event)?.(); },
        };
    }

    async function newControl(features) {
        const { default: AddPointControl } = await import(
            '../../src/js/draw_tools/point_tool/add_point_control.js'
        );
        const uiManager = { invalidateCache: () => {}, updateSelectionHighlight: () => {} };
        const control = new AddPointControl({
            selectionManager: { getSelectedFeaturesByType: () => [], uiManager },
        });
        const map = makeMap(features);
        control.onAdd(map);
        return { control, map };
    }

    it('the per-frame pass touches only the features with the correction off', async () => {
        const fixed = makePoint('fixed', { sizeZoomCorrectionEnabled: false, size: 20, calculatedSize: 20 });
        const scaled = makePoint('scaled', { showLabel: true, labelSize: 14 });
        const pending = [];
        installRaf(pending);

        const { map } = await newControl([fixed, scaled]);
        expect(map.listeners.has('zoom')).toBe(true);
        expect(map.listeners.has('zoomend')).toBe(true);

        map.zoom = 12;
        map.fire('zoom');
        await Promise.all(pending);

        // The fixed-size point got its ground geometry back...
        expect(fixed.properties.selectionBox).not.toBeNull();
        expect(fixed.properties.selectionBox.type).toBe('Polygon');
        expect(fixed.properties.calculatedSize).toBe(20);
        // ...and the corrected one was left alone: its size is the expression's job,
        // and its label anchor is the end-of-gesture pass's job.
        expect(scaled.properties.calculatedSize).toBe(10);
        expect(scaled.properties.labelCreatedAtZoom).toBeUndefined();
        expect(map.source.setDataCalls).toBe(1);
    });

    it('the per-frame pass writes nothing when no feature has the correction off', async () => {
        const scaled = makePoint('scaled', {});
        const pending = [];
        installRaf(pending);

        const { map } = await newControl([scaled]);
        map.zoom = 13;
        map.fire('zoom');
        await Promise.all(pending);

        expect(map.source.setDataCalls).toBe(0);
        expect(scaled.properties.calculatedSize).toBe(10);
    });

    it('the zoomend pass is the full one, sizes and lazy label anchor included', async () => {
        const fixed = makePoint('fixed', { sizeZoomCorrectionEnabled: false, size: 20, calculatedSize: 20 });
        const scaled = makePoint('scaled', { showLabel: true, labelSize: 14 });
        const pending = [];
        installRaf(pending);

        const { map } = await newControl([fixed, scaled]);
        map.zoom = 12;
        map.fire('zoomend');
        await Promise.all(pending);

        // 10 px anchored at zoom 10, seen at zoom 12: 10 * 2^2.
        expect(scaled.properties.calculatedSize).toBe(40);
        expect(scaled.properties.labelCreatedAtZoom).toBe(12);
        expect(scaled.properties.labelCalculatedSize).toBe(14);
        expect(fixed.properties.calculatedSize).toBe(20);
        expect(fixed.properties.selectionBox).not.toBeNull();
        expect(map.source.setDataCalls).toBe(1);
    });

    it('onRemove takes both handlers off the map', async () => {
        const pending = [];
        installRaf(pending);

        const { control, map } = await newControl([makePoint('scaled', {})]);
        control.onRemove();

        expect(map.listeners.has('zoom')).toBe(false);
        expect(map.listeners.has('zoomend')).toBe(false);
    });
});

/**
 * The other four splits, driven the same way.
 *
 * These controls also import cleanly on `node`. Their geometry helper is
 * replaced by a recorder: what is under test is WHICH features each pass
 * touches and whether it writes at all, not the selection-box maths, which has
 * its own tests.
 */
const DRIVEN_TOOLS = [
    {
        label: 'text',
        modulePath: '../../src/js/draw_tools/text_tool/add_text_control.js',
        sourceName: 'texts',
        extraSources: ['text-backgrounds'],
        featureType: 'text',
        baseProperties: { text: 'x', size: 16, rotation: 0, createdAtZoom: 10, calculatedSize: 16 },
        sizeAtZoom12: 64,
    },
    {
        label: 'image',
        modulePath: '../../src/js/draw_tools/image_tool/add_image_control.js',
        sourceName: 'images',
        extraSources: [],
        featureType: 'image',
        baseProperties: { width: 100, height: 100, size: 1, rotation: 0, createdAtZoom: 10, calculatedSize: 1 },
        sizeAtZoom12: 4,
    },
    {
        label: 'military symbol',
        modulePath: '../../src/js/military_tools/military_symbol_tool/add_military_symbol_control.js',
        sourceName: 'military_symbols',
        extraSources: [],
        featureType: 'military_symbol',
        baseProperties: { width: 100, height: 100, size: 1, rotation: 0, createdAtZoom: 10, calculatedSize: 1 },
        sizeAtZoom12: 4,
    },
    {
        label: 'coordination measure',
        modulePath: '../../src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js',
        sourceName: 'coordination_measures',
        extraSources: [],
        featureType: 'coordination_measure',
        baseProperties: { width: 100, height: 100, size: 1, rotation: 0, anchor: 'center', createdAtZoom: 10, calculatedSize: 1 },
        sizeAtZoom12: 4,
    },
];

describe.each(DRIVEN_TOOLS)('the $label split, driven', (tool) => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    let pending;

    beforeEach(() => {
        pending = [];
        let id = 0;
        globalThis.requestAnimationFrame = (callback) => {
            pending.push(Promise.resolve().then(callback));
            return ++id;
        };
        globalThis.cancelAnimationFrame = () => {};
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    function makeFeature(id, overrides) {
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-53.8, -29.9] },
            properties: {
                id,
                ...tool.baseProperties,
                zoomCorrectionEnabled: true,
                showBackground: true,
                selectionBox: null,
                ...overrides,
            },
        };
    }

    function makeSource(features) {
        const collection = { type: 'FeatureCollection', features };
        return {
            setDataCalls: 0,
            serialize: () => ({ data: collection }),
            setData(data) {
                collection.features = data.features;
                this.setDataCalls += 1;
            },
        };
    }

    async function setup(features) {
        const { default: Control } = await import(/* @vite-ignore */ tool.modulePath);
        const uiManager = { invalidateCache: () => {}, updateSelectionHighlight: () => {} };
        const control = new Control({
            selectionManager: { getSelectedFeaturesByType: () => [], uiManager },
        });

        const boxCalls = [];
        control.geometry = {
            calculateSelectionBoxGeometry: (coordinates) => {
                boxCalls.push(coordinates);
                return { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] };
            },
        };

        const sources = { [tool.sourceName]: makeSource(features) };
        for (const name of tool.extraSources) sources[name] = makeSource([]);

        const listeners = new Map();
        const map = {
            zoom: 10,
            sources,
            listeners,
            getZoom() { return this.zoom; },
            getSource: (name) => sources[name],
            getCanvas: () => ({ style: {} }),
            on(event, handler) { listeners.set(event, handler); },
            off(event, handler) {
                if (listeners.get(event) === handler) listeners.delete(event);
            },
            fire(event) { listeners.get(event)?.(); },
        };
        control.onAdd(map);
        return { control, map, boxCalls, source: sources[tool.sourceName] };
    }

    it('the per-frame pass rebuilds only the fixed-size features', async () => {
        const fixed = makeFeature('fixed', { zoomCorrectionEnabled: false });
        const scaled = makeFeature('scaled', {});
        const { map, boxCalls, source } = await setup([fixed, scaled]);

        expect(map.listeners.has('zoom')).toBe(true);
        expect(map.listeners.has('zoomend')).toBe(true);

        map.zoom = 12;
        map.fire('zoom');
        await Promise.all(pending);

        expect(boxCalls).toHaveLength(1);
        expect(fixed.properties.selectionBox).not.toBeNull();
        expect(fixed.properties.calculatedSize).toBe(tool.baseProperties.size);
        // The corrected feature keeps the value it came in with: its drawn size is
        // the style expression's job now, and the stored one waits for `zoomend`.
        expect(scaled.properties.calculatedSize).toBe(tool.baseProperties.calculatedSize);
        expect(source.setDataCalls).toBe(1);
    });

    it('the per-frame pass writes nothing with no fixed-size feature', async () => {
        const scaled = makeFeature('scaled', {});
        const { map, boxCalls, source } = await setup([scaled]);

        map.zoom = 13;
        map.fire('zoom');
        await Promise.all(pending);

        expect(boxCalls).toHaveLength(0);
        expect(source.setDataCalls).toBe(0);
        expect(scaled.properties.calculatedSize).toBe(tool.baseProperties.calculatedSize);
    });

    it('the zoomend pass recalculates the corrected features', async () => {
        const scaled = makeFeature('scaled', {});
        const { map, source } = await setup([scaled]);

        map.zoom = 12;
        map.fire('zoomend');
        await Promise.all(pending);

        expect(scaled.properties.calculatedSize).toBe(tool.sizeAtZoom12);
        expect(source.setDataCalls).toBe(1);
    });
});

describe('the text per-frame pass also refreshes the background polygons', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    it('writes the fixed-size text box into the text-backgrounds source', async () => {
        const pending = [];
        let id = 0;
        globalThis.requestAnimationFrame = (callback) => {
            pending.push(Promise.resolve().then(callback));
            return ++id;
        };
        globalThis.cancelAnimationFrame = () => {};

        const { default: AddTextControl } = await import(
            '../../src/js/draw_tools/text_tool/add_text_control.js'
        );
        const uiManager = { invalidateCache: () => {}, updateSelectionHighlight: () => {} };
        const control = new AddTextControl({
            selectionManager: { getSelectedFeaturesByType: () => [], uiManager },
        });
        control.geometry = {
            calculateSelectionBoxGeometry: () => ({
                type: 'Polygon',
                coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
            }),
        };

        const texts = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-53.8, -29.9] },
                properties: {
                    id: 'fixed', text: 'x', size: 16, rotation: 0, createdAtZoom: 10,
                    calculatedSize: 16, zoomCorrectionEnabled: false, showBackground: true,
                    backgroundBorderWidth: 1, selectionBox: null,
                },
            }],
        };
        const backgrounds = [];
        const listeners = new Map();
        const map = {
            getZoom: () => 12,
            getSource: (name) => {
                if (name === 'texts') {
                    return { serialize: () => ({ data: texts }), setData: (d) => { texts.features = d.features; } };
                }
                if (name === 'text-backgrounds') {
                    return { serialize: () => ({ data: { type: 'FeatureCollection', features: [] } }), setData: (d) => backgrounds.push(d) };
                }
                return undefined;
            },
            getCanvas: () => ({ style: {} }),
            on: (event, handler) => listeners.set(event, handler),
            off: (event) => listeners.delete(event),
        };
        control.onAdd(map);

        listeners.get('zoom')();
        await Promise.all(pending);

        expect(backgrounds).toHaveLength(1);
        expect(backgrounds[0].features).toHaveLength(1);
        expect(backgrounds[0].features[0].properties.id).toBe('fixed_bg');
        expect(backgrounds[0].features[0].geometry).toEqual(texts.features[0].properties.selectionBox);
    });
});

/**
 * The coordination line split, driven.
 *
 * Its "ground geometry" is the diamonds, which a SCREEN-pinned line sizes in
 * kilometres from the zoom, so the per-frame pass rebuilds those and nothing
 * else; the stroke width comes from the layer expression
 * (`buildCoordinationLineWidthExpression`) and the stored `calculated*` are
 * refreshed once per gesture. The geometry helper is replaced by a recorder:
 * WHICH features each pass touches is the point, and the turf maths has its own
 * tests.
 */
describe('the coordination line split, driven', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    let pending;

    beforeEach(() => {
        pending = [];
        let id = 0;
        globalThis.requestAnimationFrame = (callback) => {
            pending.push(Promise.resolve().then(callback));
            return ++id;
        };
        globalThis.cancelAnimationFrame = () => {};
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    function makeLine(id, overrides) {
        return {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[-53.8, -29.9], [-53.7, -29.8]] },
            properties: {
                id,
                lineWidth: 4,
                symbol_size: 0.5,
                symbol_spacing: 1.5,
                createdAtZoom: 10,
                zoomCorrectionEnabled: true,
                calculatedLineWidth: 4,
                calculatedSymbolSize: 0.5,
                calculatedSymbolSpacing: 1.5,
                baseCoordinates: [[-53.8, -29.9], [-53.7, -29.8]],
                ...overrides,
            },
        };
    }

    async function setup(features) {
        const { default: AddCoordinationLineControl } = await import(
            '../../src/js/military_tools/coordination_line_tool/add_coordination_line_control.js'
        );
        const control = new AddCoordinationLineControl({
            selectionManager: { getSelectedFeaturesByType: () => [], uiManager: {} },
        });

        const generated = [];
        control.geometry = {
            generate: (properties) => {
                generated.push(properties.id);
                return { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
            },
        };

        const collection = { type: 'FeatureCollection', features };
        const source = {
            setDataCalls: 0,
            serialize: () => ({ data: collection }),
            setData(data) {
                collection.features = data.features;
                this.setDataCalls += 1;
            },
        };

        const listeners = new Map();
        const map = {
            zoom: 10,
            listeners,
            getZoom() { return this.zoom; },
            getSource: (name) => (name === 'coordination_lines' ? source : undefined),
            getCanvas: () => ({ style: {} }),
            on(event, handler) { listeners.set(event, handler); },
            off(event, handler) {
                if (listeners.get(event) === handler) listeners.delete(event);
            },
            fire(event) { listeners.get(event)?.(); },
        };
        control.onAdd(map);
        return { control, map, source, generated };
    }

    it('the per-frame pass rebuilds only the screen-pinned lines', async () => {
        const pinned = makeLine('pinned', { zoomCorrectionEnabled: false });
        const scaled = makeLine('scaled', {});
        const { map, source, generated } = await setup([pinned, scaled]);

        expect(map.listeners.has('zoom')).toBe(true);
        expect(map.listeners.has('zoomend')).toBe(true);

        map.zoom = 12;
        map.fire('zoom');
        await Promise.all(pending);

        expect(generated).toEqual(['pinned']);
        // 0.5 km anchored at zoom 10, seen at 12: 0.5 / 2^2.
        expect(pinned.properties.calculatedSymbolSize).toBeCloseTo(0.125, 10);
        // The terrain-pinned line was left ALONE: its width is the layer
        // expression's job now, and the stored copy waits for `zoomend`.
        expect(scaled.properties.calculatedLineWidth).toBe(4);
        expect(scaled.properties.calculatedSymbolSize).toBe(0.5);
        expect(source.setDataCalls).toBe(1);
    });

    it('the per-frame pass writes nothing when no line is pinned to the screen', async () => {
        const scaled = makeLine('scaled', {});
        const { map, source, generated } = await setup([scaled]);

        map.zoom = 13;
        map.fire('zoom');
        await Promise.all(pending);

        expect(generated).toEqual([]);
        expect(source.setDataCalls).toBe(0);
        expect(scaled.properties.calculatedLineWidth).toBe(4);
    });

    it('the zoomend pass is the full one, derived widths included', async () => {
        const pinned = makeLine('pinned', { zoomCorrectionEnabled: false });
        const scaled = makeLine('scaled', {});
        const { map, source, generated } = await setup([pinned, scaled]);

        map.zoom = 12;
        map.fire('zoomend');
        await Promise.all(pending);

        // 4 px anchored at zoom 10, seen at 12: 4 * 2^2.
        expect(scaled.properties.calculatedLineWidth).toBe(16);
        expect(pinned.properties.calculatedLineWidth).toBe(4);
        expect(pinned.properties.calculatedSymbolSize).toBeCloseTo(0.125, 10);
        expect(generated).toEqual(['pinned']);
        expect(source.setDataCalls).toBe(1);
    });
});

/**
 * The boundary split, driven.
 *
 * Its "ground geometry" is the ECHELON, which a SCREEN-pinned boundary sizes in
 * kilometres from the zoom, plus the circles and labels placed at a distance
 * from it (also in km). The per-frame pass rebuilds those and nothing else; the
 * three pixel sizes come from the layers' expressions
 * (`buildBoundaryLineWidthExpression` and its two siblings) and the stored
 * `calculated*` are refreshed once per gesture. The geometry helper is replaced
 * by a recorder: WHICH features each pass touches is the point, and the turf
 * maths has its own tests.
 */
describe('the boundary split, driven', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    let pending;

    beforeEach(() => {
        pending = [];
        let id = 0;
        globalThis.requestAnimationFrame = (callback) => {
            pending.push(Promise.resolve().then(callback));
            return ++id;
        };
        globalThis.cancelAnimationFrame = () => {};
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    function makeBoundary(id, overrides) {
        return {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[-53.8, -29.9], [-53.7, -29.8]] },
            properties: {
                id,
                lineWidth: 4,
                text_size: 35,
                symbol_size: 1,
                echelon: 'XXX',
                createdAtZoom: 10,
                zoomCorrectionEnabled: true,
                calculatedLineWidth: 4,
                calculatedTextSize: 35,
                calculatedStrokeWidth: 2,
                calculatedSymbolSize: 1,
                baseCoordinates: [[-53.8, -29.9], [-53.7, -29.8]],
                ...overrides,
            },
        };
    }

    /** A label of the boundary's text source, carrying its own copy of the anchor. */
    const makeText = (parent) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-53.75, -29.85] },
        properties: {
            parent, text: 'A', text_size: 35, calculatedTextSize: 35,
            createdAtZoom: 10, zoomCorrectionEnabled: true,
        },
    });

    /** A circle of the echelon, carrying its own `strokeWidth` base. */
    const makeCircle = (parent) => ({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
        properties: {
            parent, strokeWidth: 2, calculatedStrokeWidth: 2,
            createdAtZoom: 10, zoomCorrectionEnabled: true,
        },
    });

    function makeSource(features) {
        const collection = { type: 'FeatureCollection', features };
        return {
            setDataCalls: 0,
            collection,
            serialize: () => ({ data: collection }),
            getData: async () => collection,
            setData(data) {
                collection.features = data.features;
                this.setDataCalls += 1;
            },
        };
    }

    async function setup(boundaries, texts = [], circles = []) {
        const { default: AddBoundaryControl } = await import(
            '../../src/js/military_tools/boundary_tool/add_boundary_control.js'
        );
        const control = new AddBoundaryControl({
            selectionManager: { getSelectedFeaturesByType: () => [], uiManager: {} },
        });

        const generated = [];
        control.geometry = {
            generate: (properties) => {
                generated.push(properties.id);
                return { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
            },
            generateBoundaryCircles: () => [],
            generateBoundaryTexts: () => [],
        };

        const sources = {
            boundarys: makeSource(boundaries),
            'boundary-texts': makeSource(texts),
            'boundary-circles': makeSource(circles),
            // Not read by either zoom pass; `deactivate` clears them on removal.
            'boundary-feedback': makeSource([]),
            'boundary-edit-handles': makeSource([]),
        };

        const listeners = new Map();
        // One canvas object, not a fresh one per call: `deactivate` removes the
        // contextmenu listener it added, and that needs the same node back.
        const canvas = { style: {}, addEventListener() {}, removeEventListener() {} };
        const map = {
            zoom: 10,
            listeners,
            getZoom() { return this.zoom; },
            getSource: (name) => sources[name],
            getCanvas: () => canvas,
            getCanvasContainer: () => canvas,
            dragPan: { enable() {}, disable() {} },
            on(event, handler) { listeners.set(event, handler); },
            off(event, handler) {
                if (listeners.get(event) === handler) listeners.delete(event);
            },
            fire(event) { listeners.get(event)?.(); },
        };
        control.onAdd(map);
        return { control, map, sources, generated };
    }

    it('the per-frame pass rebuilds only the screen-pinned boundaries', async () => {
        const pinned = makeBoundary('pinned', { zoomCorrectionEnabled: false });
        const scaled = makeBoundary('scaled', {});
        const { map, sources, generated } = await setup(
            [pinned, scaled], [makeText('scaled')], [makeCircle('scaled')],
        );

        expect(map.listeners.has('zoom')).toBe(true);
        expect(map.listeners.has('zoomend')).toBe(true);

        map.zoom = 12;
        map.fire('zoom');
        await Promise.all(pending);

        expect(generated).toEqual(['pinned']);
        // 1 km anchored at zoom 10, seen at 12: 1 / 2^2.
        expect(pinned.properties.calculatedSymbolSize).toBeCloseTo(0.25, 10);
        // The terrain-pinned boundary was left ALONE: its three pixel sizes are
        // the layers' job now, and the stored copies wait for `zoomend`.
        expect(scaled.properties.calculatedLineWidth).toBe(4);
        expect(scaled.properties.calculatedTextSize).toBe(35);
        expect(scaled.properties.calculatedStrokeWidth).toBe(2);
        expect(sources.boundarys.setDataCalls).toBe(1);
        // The dependent sources are rewritten once, for the pinned boundary whose
        // children moved; the other boundary's label and circle keep their values.
        expect(sources['boundary-texts'].setDataCalls).toBe(1);
        expect(sources['boundary-circles'].setDataCalls).toBe(1);
        expect(sources['boundary-texts'].collection.features[0].properties.calculatedTextSize).toBe(35);
        expect(sources['boundary-circles'].collection.features[0].properties.calculatedStrokeWidth).toBe(2);
    });

    it('the per-frame pass writes nothing when no boundary is pinned to the screen', async () => {
        const scaled = makeBoundary('scaled', {});
        const { map, sources, generated } = await setup(
            [scaled], [makeText('scaled')], [makeCircle('scaled')],
        );

        map.zoom = 13;
        map.fire('zoom');
        await Promise.all(pending);

        expect(generated).toEqual([]);
        expect(sources.boundarys.setDataCalls).toBe(0);
        expect(sources['boundary-texts'].setDataCalls).toBe(0);
        expect(sources['boundary-circles'].setDataCalls).toBe(0);
        expect(scaled.properties.calculatedLineWidth).toBe(4);
    });

    it('the zoomend pass is the full one, all three derived sizes included', async () => {
        const pinned = makeBoundary('pinned', { zoomCorrectionEnabled: false });
        const scaled = makeBoundary('scaled', {});
        const text = makeText('scaled');
        const circle = makeCircle('scaled');
        const { map, sources, generated } = await setup([pinned, scaled], [text], [circle]);

        map.zoom = 12;
        map.fire('zoomend');
        await Promise.all(pending);

        // 4 px, 35 px and 2 px anchored at zoom 10, seen at 12: times 2^2.
        expect(scaled.properties.calculatedLineWidth).toBe(16);
        expect(scaled.properties.calculatedTextSize).toBe(140);
        expect(scaled.properties.calculatedStrokeWidth).toBe(8);
        // The screen-pinned one keeps its pixels and moves its kilometres.
        expect(pinned.properties.calculatedLineWidth).toBe(4);
        expect(pinned.properties.calculatedSymbolSize).toBeCloseTo(0.25, 10);
        expect(generated).toEqual(['pinned']);
        // The sibling sources get the same treatment, each on its own property.
        expect(text.properties.calculatedTextSize).toBe(140);
        expect(circle.properties.calculatedStrokeWidth).toBe(8);
        expect(sources.boundarys.setDataCalls).toBe(1);
    });

    it('onRemove takes both handlers off the map', async () => {
        const { control, map } = await setup([makeBoundary('scaled', {})]);
        control.onRemove();

        expect(map.listeners.has('zoom')).toBe(false);
        expect(map.listeners.has('zoomend')).toBe(false);
    });
});

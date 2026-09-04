// Path: tests/unit/zoom-pass-events.test.js

/**
 * @fileoverview Which map event each tool's JavaScript zoom pass hangs off, and what the
 * per-frame half is allowed to cost.
 *
 * The layers derive the zoom-scaled size on the GPU now (`src/js/layers/styles/zoom-expression.js`),
 * so the JavaScript pass no longer feeds the drawing: it only refreshes the stored `calculated*`
 * properties for the consumers outside it (export, selection box, feature header). That is worth
 * doing ONCE per gesture, on `zoomend`, instead of on every frame of it.
 *
 * The exception is geometry expressed in DEGREES. A feature whose zoom correction is OFF keeps a
 * constant size on the screen, so its `selectionBox` covers a different patch of ground at every
 * zoom step, and no style expression can rewrite it. Those tools keep a per-frame `zoom` handler
 * restricted to exactly those features, next to the full pass on `zoomend`.
 *
 * THE SECOND RULE IS THE ONE THIS BRANCH NEEDED. Sixteen sources are written through
 * `layers/geojson-dispatcher.js`, and reading one of them back with `getData()` is a round trip
 * to the worker with a structured clone of the whole collection. A per-frame pass that calls
 * `getData()` therefore pays that per FRAME of a gesture, with nothing drawn and nothing to
 * write, which is exactly the cost the bench measured before this port. So the per-frame pass is
 * held to the synchronous read (`utilities/geojson-source.js`) and this file reproves any
 * per-frame handler that reaches for `getData`. The end-of-gesture pass may use it freely: it
 * runs once.
 *
 * The lists below are the contract. This file reads the controls as text because instantiating
 * them needs `document`, and this suite runs on `node`; the point tool, which does import cleanly,
 * is driven for real at the bottom.
 *
 * NOT listed on purpose:
 * - `tool_manager/managers/selection-highlight.manager.js` and `presence/remote-selections.layer.js`,
 *   which rebuild geometry on every frame by design and stay on `zoom`.
 * - `military_tools/coordination_line_tool/add_coordination_line_control.js`, which has its own
 *   ruler in `coordination-line-passe-de-zoom.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Tools whose whole pass is end-of-gesture: nothing they derive is expressed in degrees. */
const ZOOMEND_ONLY = [
    'src/js/draw_tools/brush_tool/add_brush_control.js',
    'src/js/draw_tools/circle_tool/add_circle_control.js',
    'src/js/draw_tools/ellipse_tool/add_ellipse_control.js',
    'src/js/draw_tools/polygon_tool/add_polygon_control.js',
    'src/js/draw_tools/rectangle_tool/add_rectangle_control.js',
    'src/js/draw_tools/sector_tool/add_sector_control.js',
];

/**
 * Tools that support features with the zoom correction disabled AND recompute ground geometry
 * for them, so they need both handlers.
 *
 * `declination` is here and not in the list above, which is where the main branch put it: on
 * this branch the diagram carries a `selectionBox` in degrees like the other five, so switching
 * it to `zoomend` alone would leave a fixed-size diagram with a stale box for the whole gesture.
 */
const ZOOM_AND_ZOOMEND = [
    'src/js/draw_tools/point_tool/add_point_control.js',
    'src/js/draw_tools/text_tool/add_text_control.js',
    'src/js/draw_tools/image_tool/add_image_control.js',
    'src/js/military_tools/military_symbol_tool/add_military_symbol_control.js',
    'src/js/military_tools/coordination_measure_tool/add_coordination_measure_control.js',
    'src/js/military_tools/declination_tool/add_declination_control.js',
    'src/js/military_tools/boundary_tool/add_boundary_control.js',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `.on('zoom'` / `.on("zoom"`, and NOT `.on('zoomend'`: the closing quote decides. */
const PER_FRAME_ZOOM = /\.on\(\s*(['"])zoom\1/;
const END_OF_GESTURE_ZOOM = /\.on\(\s*(['"])zoomend\1/;

/** A registration, with the event and the handler expression it was given. */
const ON_ZOOM_HANDLER = /\.on\(\s*(['"])(zoom|zoomend)\1\s*,\s*([\w.#]+)\s*\)/g;
const OFF_ZOOM_HANDLER = /\.off\(\s*(['"])(zoom|zoomend)\1\s*,\s*([\w.#]+)\s*\)/g;

/**
 * @param {string} relativePath - Path under the frontend root
 * @returns {string} File contents
 */
function readSource(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/**
 * The set of `event|handler` pairs a regex finds, sorted for comparison.
 * @param {string} source - File contents
 * @param {RegExp} regex - Global regex with the event in group 2 and the handler in group 3
 * @returns {string[]} Sorted `event|handler` pairs
 */
function registrations(source, regex) {
    const found = new Set();
    for (const match of source.matchAll(regex)) {
        found.add(`${match[2]}|${match[3]}`);
    }
    return [...found].sort();
}

/**
 * The body of a class field holding a function, by brace matching from its `{`.
 *
 * Brace matching, and not a regex, because the bodies here are long, nested and full of object
 * literals; a regex that stopped at the first `}` would happily approve a `getData` two lines
 * further down. It is deliberately literal about strings and comments: braces inside them are
 * skipped, so a `'}'` in a message cannot end the body early.
 *
 * @param {string} source - File contents
 * @param {string} name - Field name, `#` included for a private one
 * @returns {?string} The body between the outermost braces, or null when the field is absent
 */
function fieldBody(source, name) {
    const declaration = new RegExp(`(^|\\s)${name.replace('#', '\\#')}\\s*=`, 'm');
    const found = declaration.exec(source);
    if (!found) return null;

    const open = source.indexOf('{', found.index + found[0].length);
    if (open === -1) return null;

    let depth = 0;
    let index = open;
    let mode = 'code';
    let quote = '';

    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];

        if (mode === 'code') {
            if (char === '/' && next === '/') { mode = 'line'; index += 2; continue; }
            if (char === '/' && next === '*') { mode = 'block'; index += 2; continue; }
            if (char === '\'' || char === '"' || char === '`') { mode = 'string'; quote = char; index += 1; continue; }
            if (char === '{') depth += 1;
            if (char === '}') {
                depth -= 1;
                if (depth === 0) return source.slice(open + 1, index);
            }
        } else if (mode === 'line') {
            if (char === '\n') mode = 'code';
        } else if (mode === 'block') {
            if (char === '*' && next === '/') { mode = 'code'; index += 2; continue; }
        } else if (mode === 'string') {
            if (char === '\\') { index += 2; continue; }
            if (char === quote) mode = 'code';
        }
        index += 1;
    }
    return null;
}

/**
 * THE FRAME ITSELF: the body of the per-frame handler plus the body of the method it hands to
 * `requestAnimationFrame`, which is where six of the seven tools put the work. Nothing deeper.
 *
 * @param {string} source - File contents
 * @returns {string} The concatenated bodies
 * @throws {Error} When the chain cannot be resolved, which is a broken ruler, not a pass
 */
function perFrameBody(source) {
    const registration = /\.on\(\s*(['"])zoom\1\s*,\s*this\.([\w#]+)\s*\)/.exec(source);
    if (!registration) throw new Error('nenhum registro de `zoom` por quadro encontrado');

    const handler = registration[2];
    const body = fieldBody(source, handler);
    if (body === null) throw new Error(`corpo de ${handler} nao encontrado`);

    const scheduled = [...body.matchAll(/requestAnimationFrame\(\s*this\.([\w#]+)\s*\)/g)];
    const bodies = [body];
    for (const match of scheduled) {
        const scheduledBody = fieldBody(source, match[1]);
        if (scheduledBody === null) throw new Error(`corpo de ${match[1]} nao encontrado`);
        bodies.push(scheduledBody);
    }
    return bodies.join('\n');
}

/**
 * The frame plus ONE call hop: the bodies of the own methods the frame calls by name. The
 * boundary keeps its collection read in a helper (`_collectScreenAnchoredWork`), so the rule
 * that the read is synchronous has to look one level down; the rule that the frame itself does
 * not go to the worker deliberately does not.
 *
 * A name with no field body in this file (a plain method, an inherited one) is skipped rather
 * than raised: this hop is a widening, and a miss makes the check weaker, never wrong.
 *
 * @param {string} source - File contents
 * @returns {string} The concatenated bodies
 */
function perFrameChain(source) {
    const frame = perFrameBody(source);
    const bodies = [frame];
    for (const match of frame.matchAll(/this\.([\w#]+)\s*\(/g)) {
        const body = fieldBody(source, match[1]);
        if (body !== null) bodies.push(body);
    }
    return bodies.join('\n');
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
        // Two distinct events, each with its own handler: a file that registered the same
        // function twice would pass the two `test` calls above.
        expect(on.filter(entry => entry.startsWith('zoom|'))).toHaveLength(1);
        expect(on.filter(entry => entry.startsWith('zoomend|'))).toHaveLength(1);
        expect(new Set(on.map(entry => entry.split('|')[1])).size).toBe(2);
    });
});

describe('the per-frame pass never goes to the worker', () => {
    it.each(ZOOM_AND_ZOOMEND)('%s: the frame itself calls no getData', (relativePath) => {
        expect(perFrameBody(readSource(relativePath))).not.toMatch(/getData\s*\(/);
    });

    it.each(ZOOM_AND_ZOOMEND)('%s: the frame reads the collection synchronously', (relativePath) => {
        // A pass that read NOTHING would also pass the rule above, and would be a pass that had
        // stopped working. One call hop, because the boundary keeps its read in a helper.
        expect(perFrameChain(readSource(relativePath))).toMatch(/readGeoJSONSourceData\s*\(/);
    });

    it('the boundary is the one tool that can still reach getData in a frame, and only past its gate', () => {
        // Honest exception, stated rather than hidden. A boundary pinned to the SCREEN has its
        // echelon rebuilt per frame, and its circles and labels hang off that geometry in
        // kilometres, so refreshing them needs their two sibling collections. That path is
        // behind `if (pending.length === 0) return;`, and with the zoom correction ON, which is
        // the default, `pending` is always empty: the frame ends before any of it.
        const source = readSource('src/js/military_tools/boundary_tool/add_boundary_control.js');
        const frame = perFrameBody(source);

        const gate = frame.indexOf('if (pending.length === 0) return;');
        const dependents = frame.indexOf('_updateDependentFeaturesUnlocked');
        expect(gate).toBeGreaterThan(-1);
        expect(dependents).toBeGreaterThan(gate);

        // And the collection that decides the gate is read without the worker.
        const collect = fieldBody(source, '_collectScreenAnchoredWork');
        expect(collect).toMatch(/readGeoJSONSourceData\s*\(/);
        expect(collect).not.toMatch(/getData\s*\(/);
    });

    it('the end-of-gesture pass is free to use getData, and does', () => {
        // The other half of the contract. If this ever stopped being true, the rules above would
        // be enforcing a cost that had simply moved somewhere else.
        const withGetData = ZOOM_AND_ZOOMEND.filter(p => /getData\s*\(/.test(readSource(p)));
        expect(withGetData.length).toBeGreaterThanOrEqual(5);
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
        // Both `test` calls of the two-handler check would pass on this string; the handler
        // count is what reproves it.
        expect(PER_FRAME_ZOOM.test(sameHandlerTwice)).toBe(true);
        expect(END_OF_GESTURE_ZOOM.test(sameHandlerTwice)).toBe(true);
        expect(new Set(on.map(entry => entry.split('|')[1])).size).toBe(1);
    });

    // THE WORST CASE THE getData RULE EXISTS FOR, built here rather than waited for: the shape
    // every one of these controls had before this port, a per-frame handler whose scheduled
    // method drains the dispatcher and reads the whole collection back from the worker.
    const CONTROLE_POR_QUADRO = `
        setupZoomListener = () => {
            this.map.on('zoom', this.handleZoomChange);
        }

        handleZoomChange = () => {
            if (this.pendingZoomUpdate) return;
            this.pendingZoomUpdate = true;
            this.zoomRafId = requestAnimationFrame(this.updateAllSizes);
        }

        updateAllSizes = async () => {
            const dispatcher = thingsSource(this.map);
            await dispatcher.flush();
            // Um comentario com } dentro, e uma string com '}' tambem.
            const data = await this.map.getSource('things').getData();
            if (data?.features?.length) dispatcher.setData(data);
        }
    `;

    it('reproves a per-frame pass that calls getData, following the rAF hop', () => {
        const body = perFrameBody(CONTROLE_POR_QUADRO);

        expect(body).toMatch(/getData\s*\(/);
        expect(body).not.toMatch(/readGeoJSONSourceData\s*\(/);
        expect(() => expect(body).not.toMatch(/getData\s*\(/)).toThrow();
    });

    it('the brace matcher does not stop at a brace inside a comment or a string', () => {
        // The reason the extractor is not a regex. Both traps are in the fixture above, and a
        // matcher that fell for either would cut the body before the `getData` line.
        const body = perFrameBody(CONTROLE_POR_QUADRO);
        expect(body).toContain('Um comentario com } dentro');
        expect(body).toContain('dispatcher.setData(data)');
    });

    it('a broken chain is an error, not a silent pass', () => {
        expect(() => perFrameBody("map.on('zoomend', this.handleZoomEnd);")).toThrow(/nenhum registro/);
        expect(() => perFrameBody("map.on('zoom', this.naoExiste);")).toThrow(/corpo de naoExiste/);
    });

    it('reads real files, not an empty list', () => {
        expect(ZOOMEND_ONLY.length + ZOOM_AND_ZOOMEND.length).toBe(13);
        for (const relativePath of [...ZOOMEND_ONLY, ...ZOOM_AND_ZOOMEND]) {
            expect(readSource(relativePath).length).toBeGreaterThan(1000);
        }
    });
});

/**
 * The point tool, driven for real.
 *
 * `add_point_control.js` imports cleanly on the `node` environment (nothing in its chain touches
 * `document` at module scope), so the two handlers can be fired against a fake map instead of
 * being read as text. This is the part the regexes above cannot see: WHICH features each pass
 * touches, and how many times it reaches the worker.
 *
 * The dispatcher is replaced by a recorder. What is under test here is the split, not the diff
 * coalescing, which has its own suite (`despachante-*.test.js`).
 */
vi.mock('@layers/geojson-dispatcher.js', () => {
    const calls = { patch: [], setData: [], flush: 0 };
    const dispatcher = {
        patch: (id, changes) => { calls.patch.push({ id, changes }); },
        add: (features) => { calls.setData.push(features); },
        setData: (data) => { calls.setData.push(data); },
        flush: async () => { calls.flush += 1; },
    };
    return {
        __calls: calls,
        getGeoJsonDispatcher: () => dispatcher,
        destroyGeoJsonDispatcher: () => {},
    };
});

describe('the point tool split, driven', () => {
    const originalRaf = globalThis.requestAnimationFrame;
    const originalCancelRaf = globalThis.cancelAnimationFrame;
    let pending;
    let calls;

    beforeEach(async () => {
        pending = [];
        let id = 0;
        globalThis.requestAnimationFrame = (callback) => {
            pending.push(Promise.resolve().then(callback));
            return ++id;
        };
        globalThis.cancelAnimationFrame = () => {};
        ({ __calls: calls } = await import('@layers/geojson-dispatcher.js'));
        calls.patch.length = 0;
        calls.setData.length = 0;
        calls.flush = 0;
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRaf;
        globalThis.cancelAnimationFrame = originalCancelRaf;
    });

    /**
     * @param {string} id - Feature id
     * @param {Object} overrides - Property overrides
     * @returns {Object} A point feature
     */
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

    /**
     * A map whose `points` source counts every worker read. `serialize()` is the synchronous
     * read the per-frame pass uses; `getData()` is the round trip the end-of-gesture pass uses,
     * and it returns a CLONE, like the real one.
     * @param {Array} features - Point features
     * @returns {Object} The map double
     */
    function makeMap(features) {
        const collection = { type: 'FeatureCollection', features };
        const source = {
            getDataCalls: 0,
            serialize: () => ({ type: 'geojson', data: collection }),
            async getData() {
                this.getDataCalls += 1;
                return JSON.parse(JSON.stringify(collection));
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

    /**
     * @param {Array} features - Point features
     * @returns {Promise<{control: Object, map: Object}>} A control added to a fake map
     */
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

    it('the per-frame pass touches only the features with the correction off, and never the worker', async () => {
        const fixed = makePoint('fixed', { sizeZoomCorrectionEnabled: false, size: 20, calculatedSize: 20 });
        const scaled = makePoint('scaled', { showLabel: true, labelSize: 14 });

        const { map } = await newControl([fixed, scaled]);
        expect(map.listeners.has('zoom')).toBe(true);
        expect(map.listeners.has('zoomend')).toBe(true);

        map.zoom = 12;
        map.fire('zoom');
        await Promise.all(pending);

        // One patch, for the fixed-size point, carrying its rebuilt ground geometry...
        expect(calls.patch).toHaveLength(1);
        expect(calls.patch[0].id).toBe('fixed');
        expect(calls.patch[0].changes.setProps.selectionBox.type).toBe('Polygon');
        expect(calls.patch[0].changes.setProps.calculatedSize).toBe(20);
        // ...the corrected one was left alone: its size is the expression's job, and its label
        // anchor is the end-of-gesture pass's job...
        expect(calls.setData).toHaveLength(0);
        expect(scaled.properties.calculatedSize).toBe(10);
        expect(scaled.properties.labelCreatedAtZoom).toBeUndefined();
        // ...and the collection was read without going to the worker.
        expect(map.source.getDataCalls).toBe(0);
    });

    it('the per-frame pass writes nothing, and reads nothing from the worker, with no fixed point', async () => {
        const scaled = makePoint('scaled', {});

        const { map } = await newControl([scaled]);
        map.zoom = 13;
        map.fire('zoom');
        await Promise.all(pending);

        expect(calls.patch).toHaveLength(0);
        expect(calls.setData).toHaveLength(0);
        expect(calls.flush).toBe(0);
        expect(map.source.getDataCalls).toBe(0);
        expect(scaled.properties.calculatedSize).toBe(10);
    });

    it('ninety frames of a gesture cost the worker nothing', async () => {
        // The measured shape of the old pass: one `getData` per frame, with nothing to do. The
        // bench counted 90 frames in a 1.5 s gesture on this machine.
        const { map } = await newControl([makePoint('scaled', {})]);

        for (let frame = 0; frame < 90; frame++) {
            map.zoom = 10 + frame / 90;
            map.fire('zoom');
        }
        await Promise.all(pending);

        expect(map.source.getDataCalls).toBe(0);
        expect(calls.setData).toHaveLength(0);
    });

    it('the zoomend pass is the full one, sizes and lazy label anchor included', async () => {
        const fixed = makePoint('fixed', { sizeZoomCorrectionEnabled: false, size: 20, calculatedSize: 20 });
        const scaled = makePoint('scaled', { showLabel: true, labelSize: 14 });

        const { map } = await newControl([fixed, scaled]);
        map.zoom = 12;
        map.fire('zoomend');
        await Promise.all(pending);

        // One whole-collection write, through the dispatcher, and one worker read to build it.
        expect(calls.setData).toHaveLength(1);
        expect(map.source.getDataCalls).toBe(1);

        const written = calls.setData[0].features;
        const byId = Object.fromEntries(written.map(f => [f.properties.id, f.properties]));
        // 10 px anchored at zoom 10, seen at zoom 12: 10 * 2^2.
        expect(byId.scaled.calculatedSize).toBe(40);
        expect(byId.scaled.labelCreatedAtZoom).toBe(12);
        expect(byId.scaled.labelCalculatedSize).toBe(14);
        expect(byId.fixed.calculatedSize).toBe(20);
        expect(byId.fixed.selectionBox).not.toBeNull();
    });

    it('onRemove takes both handlers off the map', async () => {
        const { control, map } = await newControl([makePoint('scaled', {})]);
        control.onRemove();

        expect(map.listeners.has('zoom')).toBe(false);
        expect(map.listeners.has('zoomend')).toBe(false);
    });
});

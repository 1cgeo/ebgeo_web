// Path: tests/unit/preview-timer-regua.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Two rules about how a drawing tool builds its preview, read off the source.
 *
 * 1. NO TIMER INSIDE A PREVIEW METHOD. The preview already runs inside a
 *    `requestAnimationFrame` gate, so a `setTimeout(..., 8)` (or 12) around the
 *    drawing coalesces nothing: 8 and 12 ms are both under the 16.7 ms of a
 *    frame. It only pushes the drawing one timer late.
 *
 * 2. NO `snapping.resolve` ON A RAW MOTION EVENT. `resolve` is a
 *    rendered-feature query, and a mouse fires several `mousemove` events inside
 *    one frame while only the last one is ever drawn. The motion handler parks
 *    the pointer; the frame callback resolves it once. Measured on the
 *    coordination line, 2026-09-04: with snapping on and 4 moves per frame,
 *    `map.project()` fell from 35.718 to 10.420 calls in 3 s.
 *
 * The file reads the controls as TEXT because instantiating them needs
 * `document`, and this suite runs on `node`. That is also why the rules are
 * proved against degenerate sources at the bottom, one per axis, instead of only
 * being seen to pass on the good ones.
 *
 * Every tool that builds a preview from pointer motion is listed. The anchors
 * below are the members each file must still have: a splitter that stopped
 * matching would report zero violations everywhere and read as a clean bill of
 * health, so each file names the members it is checked through.
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

/** A timer call, whatever the delay. */
const TIMER = /\bsetTimeout\s*\(/;

/** `snapping.resolve(this.map, ...)`, the rendered-feature query. */
const RAW_RESOLVE = /\.resolve\(\s*this\.map\b/;

/** A method that builds or clears a preview. */
const PREVIEW_METHOD = /Preview/;

/** A handler fed straight by `mousemove` / `pointermove`. */
const MOTION_HANDLER = /(MouseMove|PointerMove)$/;

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

describe('the ruler reads real files, and finds the members it claims to read', () => {
    it('every control is on disk and long enough to be the real one', () => {
        expect(CONTROLS).toHaveLength(9);
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

    it('every tool drives its preview through the shared rAF gate', () => {
        for (const relativePath of CONTROLS) {
            const source = readSource(relativePath);
            expect(source, relativePath).toMatch(/createPreviewScheduler\(\{/);
            expect(source, relativePath).toMatch(/_previewScheduler\.request\(/);
            expect(source, relativePath).toMatch(/_previewScheduler\.cancel\(\)/);
        }
    });

    it('the hand-rolled gate state is gone from every one of them', () => {
        // The pair the old block was built from. Leaving one behind means a
        // second gate racing the scheduler on the same preview.
        for (const relativePath of CONTROLS) {
            const source = stripComments(readSource(relativePath));
            expect(source, `${relativePath} previewRafId`).not.toMatch(/\bpreviewRafId\b/);
            expect(source, `${relativePath} pendingPreviewUpdate`).not.toMatch(/\bpendingPreviewUpdate\b/);
            expect(source, `${relativePath} geometryDebounceTimer`).not.toMatch(/\bgeometryDebounceTimer\b/);
        }
    });
});

/**
 * The degenerate sources both rules exist to reject.
 *
 * Each axis gets its own worst case, and each worst case is also run past the
 * OTHER axis, so neither rule is seen to pass by omission.
 */
describe('the rules reject the state they exist to catch', () => {
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

    it('reproves a timer with any delay, not just the 8 ms one', () => {
        for (const delay of [1, 12, 16, 250]) {
            const source = `class Bad {\n    updateArrowPreview = () => {\n        setTimeout(() => this.draw(), ${delay});\n    }\n}`;
            expect(timerViolations('bad.js', source)).toEqual(['bad.js#updateArrowPreview']);
        }
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
            expect(rule('old.js', source), label).toHaveLength(1);
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

    it('reproves the version of each of the four that this work replaced', () => {
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
            expect(rule('old.js', source), label).toHaveLength(1);
        }
    });
});

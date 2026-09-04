// Path: tests/unit/ui-manager-guard-regua-draw.test.js

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * A control has no `uiManager` of its own.
 *
 * `BaseControl` keeps `toolManager`, `selectionManager` and `isActive`, and
 * nothing anywhere assigns `control.uiManager`. The UIManager is reached through
 * `selectionManager.uiManager`, which `setUIManager` fills in
 * (tool_manager/selection_manager.js) and which the coordination line already
 * reads. So `this.uiManager` inside a control is always `undefined`: a guard
 * written on it is dead, and a guard is worse than no guard when it is the thing
 * that makes a reviewer believe the case is handled.
 *
 * This is a STATIC ruler, on the source text, because the failure it catches is
 * a name that never throws and never logs.
 */

const here = dirname(fileURLToPath(import.meta.url));
const drawTools = resolve(here, '../../src/js/draw_tools');

/** The seven drawing controls this ruler covers. */
const CONTROLS = [
    'line_tool/add_line_control.js',
    'polygon_tool/add_polygon_control.js',
    'circle_tool/add_circle_control.js',
    'ellipse_tool/add_ellipse_control.js',
    'rectangle_tool/add_rectangle_control.js',
    'sector_tool/add_sector_control.js',
    'brush_tool/add_brush_control.js',
];

/**
 * Blank out comments, line and block, so the rule reads CODE. The newlines are
 * kept, so the line numbers of what survives still point at the file.
 * @param {string} source - The file text
 * @returns {string} The same text with every comment blanked
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
        .replace(/\/\/.*$/gm, '');
}

/**
 * Every line that READS a `uiManager` the control has not got.
 *
 * `this.selectionManager.uiManager` and `this.selectionManager?.uiManager` are
 * the live path and are left alone; only `this.uiManager` is rejected. Comments
 * are blanked first, so the removal can be explained in prose where it happened
 * without the prose failing the rule.
 *
 * @param {string} source - The file text
 * @returns {Array<{line: number, text: string}>} The offending lines
 */
function deadUiManagerReads(source) {
    const offenders = [];
    const lines = source.split(/\r?\n/);
    stripComments(source).split(/\r?\n/).forEach((code, index) => {
        if (/(?<!selectionManager[?.]?\.)\bthis\.uiManager\b/.test(code)) {
            offenders.push({ line: index + 1, text: lines[index].trim() });
        }
    });
    return offenders;
}

describe('the ruler itself, against the worst case it exists to catch', () => {
    it('rejects the dead guard exactly as the tools carried it', () => {
        // The shape every one of the six main-source writers had at 2ffc92b9.
        const degenerate = [
            'forceUpdateMainSource = async (feature) => {',
            '    if (this.uiManager && this.uiManager.isDragging) {',
            '        return;',
            '    }',
            '}',
        ].join('\n');

        const offenders = deadUiManagerReads(degenerate);
        expect(offenders).toHaveLength(1);
        expect(offenders[0].line).toBe(2);
    });

    it('rejects the one-line form, the bare read and a read wearing a comment', () => {
        expect(deadUiManagerReads('if (this.uiManager?.isDragging) return;')).toHaveLength(1);
        expect(deadUiManagerReads('const dragging = this.uiManager.isDragging;')).toHaveLength(1);
        expect(deadUiManagerReads('if (this.uiManager.isDragging) return; // skip during drag')).toHaveLength(1);
    });

    it('still finds the read when the same file explains the removal in a JSDoc', () => {
        // The blanking of comments must not blank the code that follows them.
        const mixed = [
            '/**',
            ' * No drag guard. The one that stood here tested `this.uiManager`.',
            ' */',
            'forceUpdateMainSource = async (feature) => {',
            '    if (this.uiManager.isDragging) return;',
            '}',
        ].join('\n');

        const offenders = deadUiManagerReads(mixed);
        expect(offenders).toHaveLength(1);
        expect(offenders[0].line).toBe(5);
    });

    it('lets the live path through, so it is not just rejecting the word', () => {
        expect(deadUiManagerReads('if (this.selectionManager?.uiManager?.isDragging) return;')).toHaveLength(0);
        expect(deadUiManagerReads('this.selectionManager.uiManager.updatePanels();')).toHaveLength(0);
        // The parameter of createAttributePanel is a different binding entirely.
        expect(deadUiManagerReads('createAttributePanel(container, features, selectionManager, uiManager) {')).toHaveLength(0);
        // And prose about the bug it catches is prose, not a read.
        expect(deadUiManagerReads('// The guard read `this.uiManager`, which nothing assigns.')).toHaveLength(0);
        expect(deadUiManagerReads('/**\n * No drag guard, `this.uiManager` was never assigned.\n */')).toHaveLength(0);
    });
});

describe('the drawing controls', () => {
    it.each(CONTROLS)('%s reads no uiManager of its own', (relative) => {
        const source = readFileSync(resolve(drawTools, relative), 'utf8');
        const offenders = deadUiManagerReads(source);

        expect(
            offenders,
            `${relative} reads \`this.uiManager\`, which no control and no BaseControl assigns. `
            + 'Use `this.selectionManager?.uiManager?.isDragging` instead:\n'
            + offenders.map(o => `  line ${o.line}: ${o.text}`).join('\n'),
        ).toEqual([]);
    });
});

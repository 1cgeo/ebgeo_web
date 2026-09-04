// Path: tests/unit/ui-manager-guard-regua-military.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ONE RULE, read off the source: a military control never reads `this.uiManager`.
 *
 * A control is handed a `selectionManager` and nothing else. `BaseControl` does
 * not assign `uiManager`, and neither does any of these classes, so
 * `this.uiManager` is always `undefined` and every test of it is dead: the
 * guard `if (this.uiManager && this.uiManager.isDragging) return;` reads as
 * protection and protects nothing. The live object is `selectionManager.uiManager`.
 *
 * The rule is written as an absence rather than as "use the other spelling"
 * because `tests/unit/force-update-during-drag-military.test.js` measured what
 * the guard was for and found nothing to protect: the feature drag keeps its
 * position in the selection boxes and clears the flag before the geometry is
 * written. A guard reinstated on the live path would drop writes that nothing
 * reapplies. So the correct count of both spellings in the forced write is zero,
 * and this file only has to catch the dead one coming back.
 *
 * Comments are stripped before matching, so a comment may name the dead guard to
 * explain why it went; code may not.
 *
 * The anchors are the members each file must still have. A splitter that stopped
 * matching, or a method renamed out from under the rule, would report zero
 * violations and read as a clean bill of health.
 */
const ANCHORS = {
    'src/js/military_tools/arrow_tool/add_arrow_control.js':
        ['forceUpdateMainSource', 'updateFeaturesProperty'],
    'src/js/military_tools/occupied_front_tool/add_occupied_front_control.js':
        ['forceUpdateMainSource', 'updateFeaturesProperty'],
    'src/js/military_tools/boundary_tool/add_boundary_control.js':
        ['forceUpdateMainSource', '_forceUpdateMainSourceUnlocked', 'updateFeaturesProperty'],
    'src/js/military_tools/coordination_line_tool/add_coordination_line_control.js':
        ['forceUpdateMainSource', '_forceUpdateMainSourceUnlocked', 'updateFeaturesProperty'],
};

const CONTROLS = Object.keys(ANCHORS);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The dead read: the control's own `uiManager`, which is never assigned. */
const DEAD_GUARD = /\bthis\.uiManager\b/;

/**
 * Drop line and block comments, so the rule reads CODE.
 * @param {string} source - File text
 * @returns {string} The same text with comments blanked out
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
        .replace(/([^:])\/\/.*$/gm, '$1');
}

/**
 * The lines of `source` that read `this.uiManager` outside a comment.
 * @param {string} source - File text
 * @returns {Array<string>} The offending lines, trimmed
 */
function deadGuardLines(source) {
    return stripComments(source)
        .split('\n')
        .filter(line => DEAD_GUARD.test(line))
        .map(line => line.trim());
}

describe('the dead uiManager guard', () => {
    it.each(CONTROLS)('%s still has the members the rule is read through', (file) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        for (const anchor of ANCHORS[file]) {
            expect(source, `${file} lost the anchor ${anchor}`).toContain(anchor);
        }
    });

    it.each(CONTROLS)('%s never reads this.uiManager', (file) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
        expect(deadGuardLines(source)).toEqual([]);
    });

    // The rule proved against the worst case it exists to catch, BEFORE it is
    // trusted on the real files: a rule only ever seen to pass has not been seen
    // to work. Both axes are exercised, because an axis left out comes back
    // approved by omission.
    describe('proved against a degenerate source', () => {
        const WITH_DEAD_GUARD = [
            'forceUpdateMainSource = async (feature) => {',
            '    if (this.uiManager && this.uiManager.isDragging) {',
            '        return;',
            '    }',
            '}',
        ].join('\n');

        it('reproves the guard exactly as it was written in the three tools', () => {
            expect(deadGuardLines(WITH_DEAD_GUARD)).toEqual([
                'if (this.uiManager && this.uiManager.isDragging) {',
            ]);
        });

        it('reproves the optional-chaining spelling of the same dead read', () => {
            expect(deadGuardLines('if (this.uiManager?.isDragging) return;')).toHaveLength(1);
        });

        it('lets the live path through, which is the read that is NOT dead', () => {
            expect(deadGuardLines('if (this.selectionManager?.uiManager?.isDragging) return;')).toEqual([]);
        });

        it('does not fire on a comment that names the guard it removed', () => {
            const source = [
                '// The old guard tested `this.uiManager`, which is never assigned.',
                '/* this.uiManager was dead here too. */',
                'const data = await source.getData(); // this.uiManager is gone',
            ].join('\n');
            expect(deadGuardLines(source)).toEqual([]);
        });

        it('fires on a file that has the anchors and the guard together', () => {
            const source = `forceUpdateMainSource = async () => {\n${
                '    if (this.uiManager && this.uiManager.isDragging) return;\n'
            }}\nupdateFeaturesProperty = async () => {}\n`;
            expect(source).toContain('forceUpdateMainSource');
            expect(source).toContain('updateFeaturesProperty');
            expect(deadGuardLines(source)).toHaveLength(1);
        });
    });
});

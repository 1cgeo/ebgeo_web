import { describe, it, expect } from 'vitest';
import { TOOL_GROUPS } from '../../src/js/toolbar/toolbar.constants.js';
import { SHORTCUTS_DATA } from '../../src/js/modals/shortcuts.modal.js';

/**
 * The toolbar, the keyboard handler and the "Atalhos" panel are three hand-kept
 * lists of the same thing. This test holds the two that are pure data
 * (TOOL_GROUPS and SHORTCUTS_DATA) to each other: every tool the toolbar
 * exposes with a control has a shortcut, no letter is given twice, and the
 * panel documents the same key. It was written on 2026-09-04 because the
 * coordination line tool had no shortcut and nothing said so.
 */
describe('toolbar shortcuts', () => {
    const tools = Object.values(TOOL_GROUPS).flatMap((group) => group.tools.filter((t) => t.controlKey));
    const panelKeys = Object.values(SHORTCUTS_DATA).flatMap((section) => section.shortcuts.map((s) => s.key.toUpperCase()));

    it('every toolbar tool with a control has a shortcut', () => {
        const without = tools.filter((t) => !t.shortcut).map((t) => t.id);
        expect(without).toEqual([]);
    });

    it('no shortcut letter is given to two tools', () => {
        const seen = new Map();
        for (const t of tools) {
            if (!t.shortcut) continue;
            const key = t.shortcut.toUpperCase();
            expect(seen.get(key), `${key} is used by ${seen.get(key)} and ${t.id}`).toBeUndefined();
            seen.set(key, t.id);
        }
    });

    it('the Atalhos panel documents every toolbar shortcut', () => {
        const missing = tools.filter((t) => t.shortcut && !panelKeys.includes(t.shortcut.toUpperCase())).map((t) => `${t.id}:${t.shortcut}`);
        expect(missing).toEqual([]);
    });
});

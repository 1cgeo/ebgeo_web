// Path: js/context-menu/clipboard-menu-actions.js

/**
 * @fileoverview WHICH copy/paste commands the map's context menu offers, as a PURE
 * decision. The sibling of `sidebar/tabs/map-menu-actions.js`, and it follows that file's
 * shape deliberately: one table, one returned list, no DOM.
 *
 * ONE IMPORT, and it is a leaf: `LOCKED_MAP_NOTICE`. Writing a fourth sentence for the
 * same state is how a product ends up telling one person "Este mapa está bloqueado" and
 * another "Mapa bloqueado" about the identical padlock.
 *
 * ================= THE DEFECT IT CLOSES ======================================
 *
 * `_addDefaultOptions` consulted `hasSelected` and `locked` and NO permission at all. A
 * Leitor on a remote atlas was offered "Duplicar Seleção", which is `copy()` + `paste()`,
 * which reaches `addFeatures`, which fails its `guardWrite(CREATE_FEATURE)` and returns
 * `undefined` in silence. Nothing read that return: the paste went on to update the map
 * sources, auto-select the "pasted" features and show a SUCCESS toast, right beside the
 * refusal toast from `store-error-listener.js`. On F5 the features were gone. That is the
 * class the constitution names first ("a UI promete o que o servidor recusa"), and the
 * new "Colar Aqui" would have been a second door into it, which is why its gate and
 * Duplicar's are decided HERE, together, rather than one per render site.
 *
 * ================= THE RULE, AND WHY IT IS NOT UNIFORM =======================
 *
 * TWO KINDS OF BLOCK, TWO TREATMENTS (owner's decision, 2026-08-24):
 *
 *   - RANK hides the command. A Leitor cannot become an Editor from this menu, and a dead
 *     row reading "exige Editor" turns the menu into a catalogue of what you are not.
 *   - STATE (the map is locked) DRAWS the command and refuses the CLICK, naming the state.
 *     The lock is reversible, and the person right-clicking may well be the owner who can
 *     reverse it; the click is the only place that reason can reach them.
 *
 * COPYING IS NOT GATED BY RANK, and that is not an oversight. Copy writes nothing: it
 * fills a clipboard held in `StateManager`. A Leitor may legitimately copy from an atlas
 * they can only read and paste into their own local one. Gating it would refuse a
 * capability the person demonstrably has.
 *
 * COPYING IS ALSO NOT BLOCKED BY THE LOCK, for the same reason: a locked map is read-only,
 * and reading is exactly what a copy does.
 *
 * ================= WHAT THIS TABLE DOES NOT DECIDE ============================
 *
 * A LOCKED LAYER. `layers.locked` is a client convention the store's `guardWrite` never
 * consults and the server never enforces (`.claude/rules/architecture.md`, §Sync). Adding
 * a refusal here and nowhere else would make the menu stricter than Ctrl+V for the same
 * gesture, which is the asymmetry that teaches people the menu is broken. Declared, not
 * forgotten.
 *
 * FAIL CLOSED: `can` is consulted for every ranked command, and a predicate that throws or
 * returns a non-true value hides it. Losing a click costs less than offering an action the
 * store refuses.
 */

import { LOCKED_MAP_NOTICE } from '@sidebar/tabs/map-menu-actions.js';

/**
 * The commands this block can contain.
 *
 * DUPLICATE_SELECTION is here even though the menu draws it OUTSIDE the clipboard block
 * (it keeps its historical slot right under "Zoom para Seleção"). It belongs to this table
 * because it IS a copy followed by a paste: it needs the same rank and refuses on the same
 * state, and the whole cost of the defect above was that the two were decided apart.
 * @readonly @enum {string}
 */
export const ClipboardMenuAction = Object.freeze({
    DUPLICATE_SELECTION: 'duplicate-selection',
    COPY_SELECTION: 'copy-selection',
    COPY_UNDER_CURSOR: 'copy-under-cursor',
    PASTE_HERE: 'paste-here'
});

/**
 * The `GuardAction` key each command needs. A command ABSENT from this table needs no
 * rank at all, which is the honest way to say "this one writes nothing" — a `null` entry
 * would be indistinguishable from a key someone forgot to fill in.
 *
 * Both writers ask for CREATE_FEATURE and not something finer, because that is what the
 * store gate they will actually hit consults (`addFeatures` → `guardWrite`). A client gate
 * finer than the one it stands in front of can only refuse work the store would accept.
 * @type {Object<string, string>}
 */
export const CLIPBOARD_MENU_CAPABILITY = Object.freeze({
    [ClipboardMenuAction.DUPLICATE_SELECTION]: 'CREATE_FEATURE',
    [ClipboardMenuAction.PASTE_HERE]: 'CREATE_FEATURE'
});

/**
 * Commands a LOCKED map refuses. Still drawn; the click is what refuses.
 * @type {Set<string>}
 */
const BLOCKED_BY_LOCK = new Set([
    ClipboardMenuAction.DUPLICATE_SELECTION,
    ClipboardMenuAction.PASTE_HERE
]);

/**
 * THE COMMANDS THIS PERSON SEES, in table order.
 *
 * The caller renders DUPLICATE_SELECTION in its own slot and the other three as one block;
 * order within each is this list's order.
 *
 * @param {Object} context
 * @param {function(string): boolean} context.can - Capability predicate, given a
 *   `GuardAction` key. Inject `(k) => checkPermission(k).allowed`.
 * @param {boolean} [context.locked] - Is the current map locked?
 * @param {number} [context.selectedCount] - How many features are selected.
 * @param {boolean} [context.hasFeatureUnderCursor] - Is there a copiable feature under the
 *   point the menu was opened at? Only consulted when nothing is selected.
 * @param {number} [context.clipboardCount] - How many features the clipboard holds.
 * @returns {Array<{id: string, count: number|null, blocked: string|null}>} A fresh array.
 *   `count` is the number the label shows, or null for a label that carries none.
 *   `blocked` is null when the command is live, or the sentence the click must show.
 */
export function clipboardMenuActions({
    can,
    locked = false,
    selectedCount = 0,
    hasFeatureUnderCursor = false,
    clipboardCount = 0
} = {}) {
    const allows = (id) => {
        const capability = CLIPBOARD_MENU_CAPABILITY[id];
        if (!capability) return true;
        try {
            return can(capability) === true;
        } catch {
            return false;
        }
    };

    const order = [
        ClipboardMenuAction.DUPLICATE_SELECTION,
        ClipboardMenuAction.COPY_SELECTION,
        ClipboardMenuAction.COPY_UNDER_CURSOR,
        ClipboardMenuAction.PASTE_HERE
    ];

    const out = [];
    for (const id of order) {
        // Commands with nothing to act on are ABSENT, not blocked: there is no state to
        // explain and no rank to reach. "Copiar Feição" and "Copiar Feições" are mutually
        // exclusive on purpose — with a selection the cursor is irrelevant, and offering
        // both would make the person guess which one their right-click meant.
        if (id === ClipboardMenuAction.DUPLICATE_SELECTION && selectedCount <= 0) continue;
        if (id === ClipboardMenuAction.COPY_SELECTION && selectedCount <= 0) continue;
        if (id === ClipboardMenuAction.COPY_UNDER_CURSOR
            && (selectedCount > 0 || !hasFeatureUnderCursor)) continue;
        if (id === ClipboardMenuAction.PASTE_HERE && clipboardCount <= 0) continue;

        // RANK: hidden.
        if (!allows(id)) continue;

        // STATE: drawn, and the click carries the reason.
        const blocked = (locked && BLOCKED_BY_LOCK.has(id)) ? LOCKED_MAP_NOTICE : null;

        let count = null;
        if (id === ClipboardMenuAction.COPY_SELECTION) count = selectedCount;
        else if (id === ClipboardMenuAction.PASTE_HERE) count = clipboardCount;

        out.push({ id, count, blocked });
    }
    return out;
}

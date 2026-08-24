// Path: js/sidebar/tabs/map-menu-actions.js

/**
 * @fileoverview WHICH commands the per-map context menu offers, as a PURE decision.
 *
 * The sibling of `atlas-actions.js`, and for the same reason: the question "what does THIS
 * person see for THIS map" was answerable only by reading `maps.tab.js`, which imports Sortable,
 * the store barrel and MapLibre-bound helpers and therefore does not load in this package's
 * node-only test environment. Here it is three plain inputs and a returned list.
 *
 * ZERO IMPORTS, by contract. The capability check arrives as an injected predicate (`can`)
 * rather than as an import of `permission-guard.js`, which would drag the store in.
 *
 * ================= THE DEFECT IT CLOSES ======================================
 *
 * The menu was built from TWO reads, `isMapLocked` and the map list, and consulted no permission
 * at all. A Leitor was offered Salvar posição, Duplicar, Renomear, Puxar outros mapas and
 * Deletar; an Editor was offered Deletar and Puxar outros mapas, both of which need `manage`
 * (`GuardAction.DELETE_MAP` and `GuardAction.COMBINE_MAPS`). This is the class the constitution
 * names first, "a UI promete o que o servidor recusa", and the one that froze the outbound queue
 * here twice. The model for doing it right, `cardMenuActions`, lives in the same product.
 *
 * ================= THE RULE, AND WHY IT IS NOT UNIFORM =======================
 *
 * TWO KINDS OF BLOCK, TWO TREATMENTS, decided by the owner on 2026-08-24:
 *
 *   - RANK (`Leitor não deleta mapa`) HIDES the command. The block is permanent while the role
 *     is what it is; there is nothing the person can do about it from this menu, and a dead row
 *     that says "exige Gestor" turns every menu into a catalogue of what you are not.
 *   - STATE (`this map is locked`) SHOWS the command and refuses the CLICK, naming the state.
 *     The block is reversible and the person may well be the one who can reverse it, so the
 *     affordance is the only place the reason can reach them.
 *
 * That asymmetry is the whole design. Before it, both kinds hid, which made a Leitor's menu and
 * an owner's menu on a LOCKED map identical, and neither person learned anything: one could not
 * act at all, the other only had to click the padlock.
 *
 * FAIL CLOSED: `can` is consulted for every ranked command, and a predicate that throws or
 * returns a non-true value hides the command. Losing a click costs less than offering an action
 * the server refuses.
 */

/**
 * The commands the menu can contain, in the order they are rendered.
 * @readonly @enum {string}
 */
export const MapMenuAction = Object.freeze({
    SAVE_POSITION: 'save-position',
    CLEAR_POSITION: 'clear-position',
    DUPLICATE: 'duplicate',
    RENAME: 'rename',
    COMBINE: 'combine',
    DELETE: 'delete'
});

/**
 * The `GuardAction` key each command needs, which is what makes this table auditable: the answer
 * to "why is this hidden" is one lookup, not a hunt through render code.
 *
 * DUPLICATE needs CREATE_MAP and not "nothing". The old code called duplicating a "read-only
 * operation", which reads the source map and then WRITES a whole new one; a Leitor was offered
 * it and the write died in the store.
 *
 * COMBINE is DELETE_MAP and not an edit key, matching both `GuardAction.COMBINE_MAPS` and the
 * server (`POST /maps/:id/merge` requires `manage`): combining EMPTIES the source maps and which
 * feature came from where is recorded nowhere.
 * @type {Object<string, string>}
 */
export const MAP_MENU_CAPABILITY = Object.freeze({
    [MapMenuAction.SAVE_POSITION]: 'UPDATE_MAP',
    [MapMenuAction.CLEAR_POSITION]: 'UPDATE_MAP',
    [MapMenuAction.DUPLICATE]: 'CREATE_MAP',
    [MapMenuAction.RENAME]: 'UPDATE_MAP',
    [MapMenuAction.COMBINE]: 'COMBINE_MAPS',
    [MapMenuAction.DELETE]: 'DELETE_MAP'
});

/**
 * Commands a LOCKED map refuses. The lock is a state, so these are still drawn; the click is
 * what refuses. Duplicating a locked map is allowed on purpose: it reads the source and writes
 * somewhere else, so the lock on the source is not in the way.
 * @type {Set<string>}
 */
const BLOCKED_BY_LOCK = new Set([
    MapMenuAction.SAVE_POSITION,
    MapMenuAction.CLEAR_POSITION,
    MapMenuAction.RENAME,
    MapMenuAction.COMBINE,
    MapMenuAction.DELETE
]);

/** The sentence shown when a drawn command refuses because of the map's state. */
export const LOCKED_MAP_NOTICE = 'Este mapa está bloqueado. Destrave-o para fazer esta alteração.';

/**
 * The sentence shown when the LAST remaining map is the delete target. It is a state, not a
 * rank, so the command is drawn and the click explains: hiding it made "Deletar" flicker in and
 * out of the menu as maps were created and removed, with no reason ever given.
 */
export const LAST_MAP_NOTICE = 'Este é o único mapa do atlas, e um atlas precisa de pelo menos um.';

/**
 * THE COMMANDS THIS PERSON SEES FOR THIS MAP, in menu order.
 *
 * @param {Object} context
 * @param {function(string): boolean} context.can - Capability predicate, given a `GuardAction`
 *   key. Inject `(k) => checkPermission(k).allowed`.
 * @param {boolean} [context.locked] - Is this map locked?
 * @param {boolean} [context.isActiveMap] - Is this the map currently open? Position commands act
 *   on the live camera, so they are meaningless for a map that is not on screen.
 * @param {boolean} [context.hasSavedPosition] - Does it already have a saved position?
 * @param {boolean} [context.isLastMap] - Is it the only map left in the atlas?
 * @returns {Array<{id: string, blocked: string|null}>} A fresh array. `blocked` is null when the
 *   command is live, or the sentence to show when the click must be refused.
 */
export function mapMenuActions({
    can,
    locked = false,
    isActiveMap = false,
    hasSavedPosition = false,
    isLastMap = false
} = {}) {
    const allows = (id) => {
        try {
            return can(MAP_MENU_CAPABILITY[id]) === true;
        } catch {
            return false;
        }
    };

    const order = [
        MapMenuAction.SAVE_POSITION,
        MapMenuAction.CLEAR_POSITION,
        MapMenuAction.DUPLICATE,
        MapMenuAction.RENAME,
        MapMenuAction.COMBINE,
        MapMenuAction.DELETE
    ];

    const out = [];
    for (const id of order) {
        // Commands that are meaningless in this context are absent, not blocked: there is no
        // state to explain and no rank to reach.
        if (id === MapMenuAction.SAVE_POSITION && !isActiveMap) continue;
        if (id === MapMenuAction.CLEAR_POSITION && (!isActiveMap || !hasSavedPosition)) continue;

        // RANK: hidden.
        if (!allows(id)) continue;

        // STATE: drawn, and the click carries the reason.
        let blocked = null;
        if (locked && BLOCKED_BY_LOCK.has(id)) blocked = LOCKED_MAP_NOTICE;
        else if (id === MapMenuAction.DELETE && isLastMap) blocked = LAST_MAP_NOTICE;

        out.push({ id, blocked });
    }
    return out;
}

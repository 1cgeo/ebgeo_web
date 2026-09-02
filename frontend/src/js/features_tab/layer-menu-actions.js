// Path: js/features_tab/layer-menu-actions.js

/**
 * @fileoverview WHICH commands the per-layer "more actions" menu offers, as a PURE decision.
 *
 * The sibling of `sidebar/tabs/map-menu-actions.js`, and for the same reason: the question
 * "what does THIS person see for THIS layer" would otherwise be answerable only by reading
 * `layer-list.component.js`, which imports the `@store` and `@modals` barrels and therefore
 * does not load in this package's node-only test environment. Here it is four plain inputs
 * and a returned list.
 *
 * ZERO IMPORTS, by contract. The capability check arrives as an injected predicate (`can`)
 * rather than as an import of `permission-guard.js`, which would drag the store in.
 *
 * ================= THE RULE, AND WHY IT IS NOT UNIFORM =======================
 *
 * TWO KINDS OF BLOCK, TWO TREATMENTS, decided by the owner on 2026-08-24:
 *
 *   - RANK hides the command. The block is permanent while the role is what it is, and a
 *     dead row that says "exige Editor" turns the menu into a catalogue of what you are not.
 *   - STATE shows the command and refuses the CLICK, naming the state. The block is
 *     reversible and the person may well be the one who can reverse it (unlock the map,
 *     unlock the layer, create a second map), so the affordance is the only place the
 *     reason can reach them.
 *
 * THE SHAPE IS THE SIBLING'S SHAPE, `{ id, blocked }` with `blocked` carrying the SENTENCE
 * or null, and not a boolean plus a separate field. Two menus in the same product answering
 * the same question in two shapes is how one of them ends up read wrong.
 *
 * ================= WHY MOVE NEEDS TWO CAPABILITIES ===========================
 *
 * Copying only WRITES into the destination, so `CREATE_FEATURE` is the whole gate. Moving
 * also EMPTIES the source, so it needs `DELETE_FEATURE` as well, which is a different flag
 * on a different rung. Offering "Mover" to somebody who can create but not delete produces
 * exactly the failure the house names first: the UI promises what the store refuses, and
 * here it would refuse HALFWAY, with the layer already duplicated at the destination.
 *
 * FAIL CLOSED: `can` is consulted for every ranked command, and a predicate that throws or
 * returns a non-true value hides the command. Losing a click costs less than offering an
 * action the store refuses.
 */

/**
 * The commands the menu can contain, in the order they are rendered.
 * @readonly @enum {string}
 */
export const LayerMenuAction = Object.freeze({
    MOVE: 'move-to-map',
    COPY: 'copy-to-map'
});

/**
 * The `GuardAction` keys each command needs, ALL of them. A list and not a single key,
 * because the move is the one command in this menu that writes on both sides.
 * @type {Object<string, string[]>}
 */
export const LAYER_MENU_CAPABILITY = Object.freeze({
    [LayerMenuAction.MOVE]: Object.freeze(['CREATE_FEATURE', 'DELETE_FEATURE']),
    [LayerMenuAction.COPY]: Object.freeze(['CREATE_FEATURE'])
});

/** Commands a locked SOURCE (map or layer) refuses. A copy reads and never writes there. */
const BLOCKED_BY_SOURCE_LOCK = new Set([LayerMenuAction.MOVE]);

/** The sentence shown when the command refuses because the current map is locked. */
export const LOCKED_SOURCE_MAP_NOTICE =
    'Este mapa está travado. Destrave-o para mover a camada, ou copie-a.';

/** The sentence shown when the command refuses because the layer itself is locked. */
export const LOCKED_LAYER_NOTICE =
    'Esta camada está travada. Destrave-a para movê-la, ou copie-a.';

/**
 * The sentence shown when the atlas has a single map.
 *
 * It is a STATE and not a rank, so both commands are drawn and the click explains: hiding
 * them would make the whole menu blink in and out as maps are created and deleted, with no
 * reason ever given.
 */
export const NO_OTHER_MAP_NOTICE =
    'Este atlas só tem um mapa. Crie outro para receber a camada.';

/**
 * THE COMMANDS THIS PERSON SEES FOR THIS LAYER, in menu order.
 *
 * @param {Object} context - The decision inputs
 * @param {function(string): boolean} context.can - Capability predicate, given a
 *   `GuardAction` key. Inject `(k) => checkPermission(k).allowed`.
 * @param {boolean} [context.sourceLocked] - Is the CURRENT map locked?
 * @param {boolean} [context.layerLocked] - Is this layer locked?
 * @param {boolean} [context.hasOtherMaps] - Is there any other map to send it to?
 * @returns {Array<{id: string, blocked: string|null}>} A fresh array. `blocked` is null
 *   when the command is live, or the sentence to show when the click must be refused.
 */
export function layerMenuActions({
    can,
    sourceLocked = false,
    layerLocked = false,
    hasOtherMaps = true
} = {}) {
    const allows = (id) => {
        try {
            return LAYER_MENU_CAPABILITY[id].every(key => can(key) === true);
        } catch {
            return false;
        }
    };

    const order = [LayerMenuAction.MOVE, LayerMenuAction.COPY];

    const out = [];
    for (const id of order) {
        // RANK: hidden.
        if (!allows(id)) continue;

        // STATE: drawn, and the click carries the reason.
        //
        // "NO OTHER MAP" WINS, and the precedence is the whole subtlety here. Both lock
        // sentences end with "or copy it", which is only useful advice when copying is
        // possible; with a single map in the atlas it is not, so a locked map in a one-map
        // atlas would tell the person to do the very thing the row below it refuses. The
        // destination is the first thing missing, so it is the first thing said.
        let blocked = null;
        if (!hasOtherMaps) blocked = NO_OTHER_MAP_NOTICE;
        else if (sourceLocked && BLOCKED_BY_SOURCE_LOCK.has(id)) blocked = LOCKED_SOURCE_MAP_NOTICE;
        else if (layerLocked && BLOCKED_BY_SOURCE_LOCK.has(id)) blocked = LOCKED_LAYER_NOTICE;

        out.push({ id, blocked });
    }
    return out;
}

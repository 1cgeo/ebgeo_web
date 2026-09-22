// Path: js/snapping/snap-availability.js

/**
 * @fileoverview WHEN THE SNAP EXISTS, and what it does while it does not.
 *
 * ZERO IMPORTS, on purpose: the snapping service runs on every mousemove of every drawing tool
 * and is loaded by suites that run in plain node, and nothing reachable from here may drag the
 * store in behind it. The answer about editing arrives as DATA (the object that
 * `edicaoIndisponivelSync` returns), never as an import.
 *
 * THE OWNER'S DECISION (2026-09-22, recorded in `docs/decisions/decisions-2026.md`): the snap
 * toggle is HIDDEN for Leitor and Comentarista on a connected server atlas (POSTO) and ALSO on a
 * locked map (ESTADO). The second half departs from the house rule that a blocked-by-state
 * command is drawn and refuses the click naming the state, and it departs deliberately, for the
 * reason the line-continuation handle already wrote down (`.claude/rules/architecture.md`,
 * section on continuing a linear feature): the snap is a MODIFIER of drawing, not a command of
 * its own. On a locked map every tool it modifies is gone (the draw, military and analysis
 * groups are hidden by the lock pass of the toolbar), so a snap button drawn with
 * `aria-disabled` would be the only "actionable" surface of an inert toolbar, and its click
 * would teach nothing the missing tools do not already say. Do not "fix" it back to
 * draw-and-refuse.
 *
 * WHERE THE HIDING HAPPENS, which is not here: the toolbar marks the toggle `edit-affordance`
 * (`css/view-mode.css` hides it by POSTO) and hides it in its lock pass (ESTADO), exactly as it
 * already did for undo and redo; the table flag that drives both is `requiresEdit` in
 * `toolbar/toolbar.constants.js`. What lives here is the rule those two passes implement, so the
 * SERVICE can obey the same rule without a button to look at.
 *
 * WHILE HIDDEN THE SNAP IS OFF, AND THE PREFERENCE SURVIVES. `ui.snapping.enabled` is the
 * person's choice and nothing writes it on their behalf: {@link isSnapEffective} answers false
 * while the snap is unavailable, Ctrl included (holding Ctrl with the global toggle off is a
 * temporary snap, and it would otherwise stay reachable with the button gone). When the
 * condition falls, the button comes back showing the state the person left it in, and the snap
 * works again with no second click.
 */

/**
 * Whether the snap is available under an answer from `edicaoIndisponivelSync`.
 *
 * POSITIVE FORM, and that is the point of writing it here: only an answer that says, in so many
 * words, that nothing blocks editing makes the snap available. A missing or malformed answer
 * fails CLOSED, so a future change to the shape of that object hides a drawing modifier instead
 * of showing it to a reader.
 *
 * Both axes hide it, POSTO (`motivo: 'permissao'`) and ESTADO (`motivo: 'map_locked'`); that is
 * the owner's decision described in the file overview.
 *
 * @param {{bloqueado?: boolean}|null|undefined} edicao - What `edicaoIndisponivelSync()` returned.
 * @returns {boolean}
 */
export function isSnapAvailable(edicao) {
    return edicao?.bloqueado === false;
}

/**
 * The effective snap state: the global toggle XOR Ctrl held, and only while available.
 *
 * `isAvailable` is a THUNK and it is consulted LAST, only when the XOR would snap: `resolve` runs
 * on every mousemove and the common case is snap off, so asking about permission and lock there
 * would be work for an answer that cannot change the outcome. A missing thunk means "no rule
 * given" and counts as available, which keeps a service built without one (the node suites, any
 * page with no store) behaving exactly as before.
 *
 * @param {Object} state
 * @param {boolean} state.preferred - The person's global toggle (`ui.snapping.enabled`).
 * @param {boolean} state.ctrlHeld - Whether Ctrl is held right now.
 * @param {(() => boolean)|null} [state.isAvailable] - Whether the snap may act at all.
 * @returns {boolean}
 */
export function isSnapEffective({ preferred, ctrlHeld, isAvailable = null }) {
    if (!!preferred === !!ctrlHeld) return false;
    if (typeof isAvailable !== 'function') return true;
    return isAvailable() === true;
}

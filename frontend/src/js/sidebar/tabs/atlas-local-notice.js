// Path: js/sidebar/tabs/atlas-local-notice.js

/**
 * @fileoverview WHERE THE WORK LIVES, said out loud, in the Maps tab.
 *
 * WHY IT EXISTS. On a LOCAL atlas the only claim the map ever made about the nature of the work
 * was the `title` attribute of the origin chip ("Atlas local, só neste navegador") plus the word
 * "Local" inside it. A `title` does not exist on touch, does not exist for a screen reader in
 * several contexts, and does not exist for anyone who never hovers that exact span. So a visitor
 * who opens the bare URL, draws for an afternoon and closes the browser was never told, in words
 * they could read, that nothing was stored anywhere. That is the precondition for losing the work,
 * even though no code path destroys it.
 *
 * WHY IT IS A MODULE AND NOT A STRING IN THE TAB. `maps.tab.js` imports Sortable, the store barrel
 * and MapLibre-bound helpers, so it does not load in the node-only test environment of this
 * package: a sentence written there can only be verified by parsing the file as text. Here the
 * question "what does this state promise the person" is a function of one plain value.
 *
 * ZERO IMPORTS, ON PURPOSE. The state keys below are the values of `AtlasTabState`
 * (`sidebar/tabs/atlas-actions.js`), and they are written out rather than imported so this file
 * stays a leaf. `tests/unit/aviso-de-atlas-local.test.js` imports BOTH modules and asserts that
 * every state the enum declares has an entry here, which is what keeps the two from drifting.
 *
 * THE SENTENCE ENDS IN AN ACTION, and the action differs by state, which is the whole reason
 * there are two of them. A signed-in user working locally is in the same exposure as the anonymous
 * one (the bytes are in this browser and nowhere else), but they have "Enviar ao servidor" in the
 * actions grid and the anonymous one does not: `save-server` is absent from the `local-anon` row of
 * `ACTIONS_BY_STATE`, and `AccountControl` hides the command without a session. Naming a command
 * the tab does not draw is the failure this whole line of work exists to remove.
 *
 * The wording names the buttons LITERALLY as the grid labels them ("Exportar", "Enviar ao
 * servidor"), so the sentence can be followed by reading the screen instead of guessing.
 */

/**
 * The notice each tab state shows, keyed by `AtlasTabState`. `null` means the tab says nothing:
 * on a SERVER atlas the claim would be false, and there is nothing to warn about.
 * @type {Object<string, string|null>}
 */
export const ATLAS_LOCAL_NOTICE = Object.freeze({
    'local-anon': 'Guardado neste navegador. Nada vai para o servidor. '
        + 'Use Exportar para levar uma cópia.',
    'local-signed-in': 'Guardado neste navegador. Nada vai para o servidor. '
        + 'Use Enviar ao servidor para publicá-lo, ou Exportar para levar uma cópia.',
    remote: null,
});

/**
 * THE NOTICE FOR THIS STATE, or `null` when the tab should stay silent.
 *
 * FAILS CLOSED ON AN UNKNOWN STATE. A state this build has never heard of returns `null` rather
 * than the local sentence: promising "nothing goes to the server" about a situation nobody
 * classified is the one failure mode worse than saying nothing at all.
 *
 * `Object.hasOwn` and not a bare lookup: `atlasLocalNotice('toString')` would otherwise hand the
 * caller a FUNCTION, which `textContent` would happily stringify onto the screen.
 * @param {string} [state] - A value of `AtlasTabState`.
 * @returns {string|null}
 */
export function atlasLocalNotice(state) {
    if (typeof state !== 'string') return null;
    if (!Object.hasOwn(ATLAS_LOCAL_NOTICE, state)) return null;
    return ATLAS_LOCAL_NOTICE[state] ?? null;
}

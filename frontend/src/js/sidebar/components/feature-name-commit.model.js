// Path: js/sidebar/components/feature-name-commit.model.js

/**
 * @fileoverview WHAT CONFIRMING THE NAME FIELD OF THE FEATURE PANEL MEANS, decided against the
 * STORE and never against the copy the panel holds.
 *
 * Until 2026-09-22 Enter (and blur) only STAGED the name: `onNameChange` reached the tool's
 * `updateFeaturesProperty`, which writes the MapLibre source and the in-memory feature and
 * nothing else, and the store write waited for the panel's "Salvar" (or for the deselect that
 * presses it). The staged name was lost, silently, whenever the panel that held the edit was
 * replaced before anything saved it: the rebuild of `_showFeatureContent` saves the OUTGOING
 * content when it STARTS, and an edit made on that content while the new one is still being
 * built was never saved by anybody. The new content's baseline (`createInitialPropertiesMap`)
 * may even absorb the edit, and from then on the divergence is STICKY: memory and source show
 * the new name, the store keeps the old one, and retyping the same name wrote nothing, because
 * the field compared with memory and the panel compared with its own baseline. Measured by
 * `frontend/tests/helpers/main-round-trip.mjs` on 2026-09-22 (panel with the new name, disk
 * with the default one, forty iterations later).
 *
 * The rule now: confirming the field is a store write of its own, like the description's
 * "Salvar" in the same component. Everything here compares with the STORED feature, which is
 * what makes the sticky state repair itself (the same name typed again is a write when the
 * store does not have it).
 *
 * Pure leaf, zero imports: runs in node (`tests/unit/nome-de-feicao-no-painel.repro.test.js`).
 */

/** What the panel shows for a feature without a name. Also what an emptied field stores. */
export const UNNAMED_LABEL = 'Sem nome';

/**
 * @private
 * @param {*} name
 * @returns {boolean} True when there is no name worth keeping.
 */
function isBlankName(name) {
    return name === null || name === undefined || String(name).trim() === '';
}

/**
 * The name a confirmation asks for, or `null` when it asks for nothing.
 *
 * An emptied field keeps storing `UNNAMED_LABEL`, as it always did. The one case that changed:
 * opening the field of a feature that never had a name and leaving it empty asks for NOTHING.
 * Deciding against the store would otherwise turn every open-and-leave of an unnamed feature
 * into a write of the placeholder text.
 *
 * @param {*} typed - Raw value of the input.
 * @param {*} currentName - The name the field was opened with (`properties.nome` in memory).
 * @returns {string|null}
 */
export function requestedFeatureName(typed, currentName) {
    const trimmed = typeof typed === 'string' ? typed.trim() : '';
    if (trimmed === '' && isBlankName(currentName)) return null;
    return trimmed || UNNAMED_LABEL;
}

/**
 * The text of the name display. Same fallback the component always had (`nome || 'Sem nome'`),
 * so a name made of spaces is shown as it is stored, and an imported numeric name is shown too.
 * @param {*} name
 * @returns {string}
 */
export function displayedFeatureName(name) {
    return name ? String(name) : UNNAMED_LABEL;
}

/**
 * What the commit does with a request, once the STORED feature has been read.
 *
 * - `none`: nothing was asked, or the store already has exactly that name.
 * - `stale`: the current map is no longer the map the panel was built on. Writing would target
 *   whatever feature carries that id in the OTHER map, or ask the lock of a map the memory does
 *   not describe (the lock set is complete only for the current map in a local atlas).
 * - `missing`: the feature is gone from the store (deleted here or by a peer).
 * - `write`: the store has another name.
 *
 * @param {{requested: string|null, stored: Object|null|undefined, sameMap: boolean}} args
 * @returns {'none'|'stale'|'missing'|'write'}
 */
export function nameCommitAction({ requested, stored, sameMap }) {
    if (requested === null) return 'none';
    if (!sameMap) return 'stale';
    if (!stored) return 'missing';
    return stored.properties?.nome === requested ? 'none' : 'write';
}

/**
 * Whether the store kept the requested name, read BACK after the write.
 *
 * `updateFeature` returns `undefined` on every path, a refusal by the permission or lock guard
 * included, so the only proof of a write is the re-read. `name` is what the screen must show
 * when the write did not land: the store's value, or `fallback` when the feature is gone.
 *
 * @param {string} requested
 * @param {Object|null|undefined} reread - The stored feature after the write.
 * @param {*} fallback - What to show when there is nothing to read back.
 * @returns {{committed: boolean, name: *}}
 */
export function nameCommitOutcome(requested, reread, fallback) {
    if (!reread) return { committed: false, name: fallback };
    const name = reread.properties?.nome;
    return { committed: name === requested, name };
}

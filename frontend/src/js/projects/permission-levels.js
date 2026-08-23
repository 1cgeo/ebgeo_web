// Path: js/projects/permission-levels.js

/**
 * @fileoverview Canonical atlas permission ladder for the UI: FIVE levels,
 * `read < comment < write < manage < owner`, with their pt-BR labels.
 *
 * The labels for the four GRANTABLE levels are copied verbatim from the sharing
 * modal's dropdown (`modals/sharing.modal.js`), so the two screens never call the
 * same level by two different names; `owner` is not grantable there (it is the
 * atlas creator), and keeps the Drive's own 'Proprietário'.
 *
 * PURE DATA MODULE, deliberately dependency-free. It is consumed by
 * `projects/atlas-drive.js`, the body of `atlas.html`, a page that boots
 * WITHOUT the map, without `@store` and without `initServices()`. Importing
 * anything here that reaches the store (the `@utils` or `@modals` barrels do, via
 * transitive paths) would drag the whole map bundle, an order of magnitude heavier
 * than this page, into it. The absolute figures are deliberately not written here:
 * they moved twice already and nobody re-measures a number in a header. Keep the
 * import list of this file empty.
 *
 * Gate access by RANK, never by a closed list: `perm === 'write' || perm === 'owner'`
 * silently excludes `manage`, which sits ABOVE write, and that exact bug already
 * shipped twice in this repo.
 */

/** The ladder, ascending. Index = rank. */
export const PERMISSION_ORDER = Object.freeze(['read', 'comment', 'write', 'manage', 'owner']);

/** pt-BR label per level (the four lowest match the sharing modal verbatim). */
export const PERMISSION_LABELS = Object.freeze({
    read: 'Leitura',
    comment: 'Comentário',
    write: 'Edição',
    manage: 'Gestão',
    owner: 'Proprietário',
});

/**
 * Whether `level` is one of the five canonical levels.
 * @param {*} level
 * @returns {boolean}
 */
export function isKnownPermission(level) {
    return typeof level === 'string' && Object.hasOwn(PERMISSION_LABELS, level);
}

/**
 * Rank of a level on the ladder; -1 for anything unknown (so an unrecognized
 * level compares BELOW `read` and can never accidentally grant access).
 * @param {*} level
 * @returns {number}
 */
export function permissionRank(level) {
    return isKnownPermission(level) ? PERMISSION_ORDER.indexOf(level) : -1;
}

/**
 * Hierarchy gate: does `level` reach at least `required`?
 * @param {*} level - the user's permission on the atlas
 * @param {string} required - the minimum level the action needs
 * @returns {boolean}
 */
export function hasAtLeast(level, required) {
    const min = permissionRank(required);
    if (min < 0) return false;
    return permissionRank(level) >= min;
}

/**
 * Display label for a level. An UNKNOWN level falls back to its own raw value
 * (trimmed) instead of `undefined`: a badge reading `superuser` is a legible
 * surprise, while no badge at all is the silent failure this module exists to
 * prevent. Only empty/absent input yields an empty string.
 * @param {*} level
 * @returns {string} label, raw value, or '' when there is no level at all
 */
export function getPermissionLabel(level) {
    if (isKnownPermission(level)) return PERMISSION_LABELS[level];
    if (typeof level === 'string') return level.trim();
    return '';
}

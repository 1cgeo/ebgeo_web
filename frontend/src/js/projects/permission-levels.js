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
 * WITHOUT the map, without `@store` and without `initServices()`, and (since
 * 2026-08-23) by `modals/sharing.modal.js` and `modals/create-atlas.modal.js`, the
 * second of which `atlas-drive.js` also imports, so it reaches the same page.
 * Importing anything here that reaches the store (the `@utils` or `@modals` barrels
 * do, via transitive paths) would drag the whole map bundle, an order of magnitude
 * heavier than this page, into it. The absolute figures are deliberately not written
 * here: they moved twice already and nobody re-measures a number in a header. Keep
 * the import list of this file empty.
 *
 * IT IS THE SINGLE SOURCE for three things, and the third is the one that was
 * copied around: the ladder, the pt-BR labels, and the GRANTABLE subset that every
 * sharing dropdown offers ({@link GRANTABLE_PERMISSIONS}). Until 2026-08-23 that
 * subset lived as a hand-written `PERMISSION_LEVELS` array in four places (both
 * modals plus two copies of the validation list in `applyAtlasSharing`), none of
 * them derived from `PERMISSION_ORDER`, and two of them did rank arithmetic with
 * `findIndex` over their own copy. Add a rung to the ladder here and the dropdowns
 * follow; `frontend/tests/unit/permission-levels-derivacao.test.js` asserts the
 * resulting list ABSOLUTELY, so a new rung reproves instead of shipping silently.
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

/**
 * The levels a share can be GRANTED at: every rung strictly BELOW `owner`.
 *
 * DERIVED, never hand-written. `owner` is out because it is not a share at all: it
 * is the `atlas.owner_id` column, handed over by the transfer route and by nothing
 * else. Every sharing dropdown offers exactly this list, in this order, so a rung
 * added to {@link PERMISSION_ORDER} reaches all of them at once.
 * @type {ReadonlyArray<string>}
 */
export const GRANTABLE_PERMISSIONS = Object.freeze(
    PERMISSION_ORDER.filter((level) => permissionRank(level) < permissionRank('owner')),
);

/**
 * Whether `level` is one a share can be granted at (a known level, and not `owner`).
 *
 * This is the guard that keeps `owner` from leaking into a dropdown or into a
 * "your group gives you more" badge: an unknown value and `owner` are both answered
 * `false`, which is the fail-closed direction for both.
 * @param {*} level
 * @returns {boolean}
 */
export function isGrantablePermission(level) {
    return isKnownPermission(level) && GRANTABLE_PERMISSIONS.includes(level);
}

/**
 * The rows of a permission `<select>`: `{ value, label }`, in ladder order.
 *
 * A fresh array on every call, so a caller may sort or filter it without poisoning
 * the next one (same contract as `adminAudience().tabIds`).
 * @returns {Array<{value: string, label: string}>}
 */
export function grantablePermissionOptions() {
    return GRANTABLE_PERMISSIONS.map((value) => ({ value, label: PERMISSION_LABELS[value] }));
}

/**
 * The per-atlas role values the server resolves to `owner` on THIS atlas.
 *
 * Kept as data rather than inlined into the predicate so the count is visible: there
 * are TWO, and the second one is the whole point.
 * @type {ReadonlyArray<string>}
 */
const ATLAS_OWNER_ROLES = Object.freeze(['owner', 'admin']);

/**
 * WHOM THE SERVER TREATS AS THE OWNER OF THIS ATLAS.
 *
 * The server answers this in `requireAtlasPermission` (`backend/src/middleware/
 * permissions.js`): a GLOBAL `admin` short-circuits to `req.atlasPermission =
 * 'owner'` on every atlas, with no share row anywhere, and only then does the
 * `owner_id` comparison run for everybody else. So `POST /atlas/:atlasId/transfer`,
 * gated on `requireAtlasPermission('owner')`, accepts a global administrator.
 *
 * On the client the same two cases arrive as ONE string, because `toFrontendRole`
 * (`backend/src/utils/roles.js`) folds the global `admin` into the per-atlas ladder
 * before the role reaches `sessionContext.role`. That is why the answer is
 * `owner || admin` and not `owner` alone: `sharing.modal.js` asked for `owner`
 * only, and hid a "Tornar dono" button from a principal the server would have
 * obeyed, while `account.control.js` next door already answered `owner || admin`
 * for the same server gate. Two closed lists for one gate, divergent.
 *
 * `producer` and `credenciado` do NOT short-circuit (`toFrontendRole` folds only
 * `admin`), so they fall on the ladder as ordinary accounts. Completing this list
 * with them is the error the `fileoverview` of `roles.js` exists to prevent.
 *
 * Safe for either vocabulary: `admin` is not a value of the server's five-level
 * `permission`, so a raw `permission` string lands on the same answer. The one
 * thing it is NOT is a security boundary: the server re-decides on every request.
 *
 * @param {*} role - `sessionContext.role` (a `UserRole`), or a raw server permission.
 * @returns {boolean}
 */
export function serverTreatsAsAtlasOwner(role) {
    return typeof role === 'string' && ATLAS_OWNER_ROLES.includes(role);
}

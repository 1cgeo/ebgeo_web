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
 * The CLIENT vocabulary of the per-atlas axis, translated to the SERVER's ladder.
 *
 * TWO VOCABULARIES, ONE AXIS, and this map is the only place the second turns into the
 * first. `sessionContext.role` (a `UserRole`, `store/sync/session-context.js`) carries
 * SIX values because `toFrontendRole` (`backend/src/utils/roles.js`) folds the GLOBAL
 * `admin` into the per-atlas ladder before the role reaches the client; the server's
 * `permission`, which is what `user_permission` and every share row carry, has FIVE and
 * is the ladder {@link PERMISSION_ORDER} implements.
 *
 * This map is the exact INVERSE of `toFrontendRole`, and the two must move together.
 * Written as data rather than as a chain of `if`s so a value added on either side shows
 * up as a missing KEY here, not as a branch nobody noticed.
 *
 * `producer` and `credenciado` are deliberately ABSENT: `toFrontendRole` folds only
 * `admin`, so those two reach the client already resolved onto the ladder as ordinary
 * accounts, and giving them a key here would invent a short-circuit the server does not
 * have. That is the error the `fileoverview` of `roles.js` exists to prevent.
 * @type {Readonly<Object<string, string>>}
 */
const ROLE_TO_PERMISSION = Object.freeze({
    admin: 'owner',
    owner: 'owner',
    manager: 'manage',
    editor: 'write',
    commenter: 'comment',
    viewer: 'read',
});

/**
 * The server `permission` a per-atlas role stands for, or `null` for anything unknown.
 *
 * Accepts EITHER vocabulary: a raw `permission` (already a rung) comes back unchanged, a
 * client `UserRole` is translated. That is what lets a single gate serve both kinds of
 * call site, and it is safe because the two vocabularies overlap on `owner` alone, where
 * they agree.
 * @param {*} role - a `UserRole` or a raw server `permission`
 * @returns {string|null}
 */
export function toAtlasPermission(role) {
    if (isKnownPermission(role)) return role;
    if (typeof role === 'string' && Object.hasOwn(ROLE_TO_PERMISSION, role)) {
        return ROLE_TO_PERMISSION[role];
    }
    return null;
}

/**
 * THE GATE FOR `sessionContext.role`: does this role reach at least `required`?
 *
 * {@link hasAtLeast} speaks the server's five-value vocabulary and answers `false` for
 * `manager`, `editor`, `commenter` and `viewer`, which is why screens holding a
 * `UserRole` kept writing closed lists instead of using it: `role === 'owner' || role
 * === 'manager' || role === 'admin'` was what a Gestor gate looked like in three places,
 * and `[UserRole.OWNER, UserRole.ADMIN]` was a fourth. Each was correct against the six
 * values of the day and wrong the moment a rung appears, which is the bug that already
 * shipped twice in this repository.
 *
 * FAIL-CLOSED IN BOTH DIRECTIONS: an unrecognized role resolves to `null`, ranks below
 * `read` and reaches nothing; an unrecognized `required` returns `false` instead of
 * letting a typo open the gate.
 *
 * @param {*} role - `sessionContext.role`, or a raw server `permission`
 * @param {string} required - the minimum SERVER rung the action needs ('manage', ...)
 * @returns {boolean}
 */
export function atlasRoleHasAtLeast(role, required) {
    return hasAtLeast(toAtlasPermission(role), required);
}

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
 * Safe for either vocabulary, because {@link atlasRoleHasAtLeast} normalizes first: a
 * raw `permission` string lands on the same answer. It is a NAMED case of the ladder,
 * not a second implementation of it, which is why it is defined in terms of the gate
 * rather than as its own pair of literals. The one thing it is NOT is a security
 * boundary: the server re-decides on every request.
 *
 * @param {*} role - `sessionContext.role` (a `UserRole`), or a raw server permission.
 * @returns {boolean}
 */
export function serverTreatsAsAtlasOwner(role) {
    return atlasRoleHasAtLeast(role, 'owner');
}

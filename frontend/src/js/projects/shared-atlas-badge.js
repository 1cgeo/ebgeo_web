// Path: js/projects/shared-atlas-badge.js

/**
 * @fileoverview The arithmetic of "what is NEW in Compartilhados comigo", as pure functions.
 *
 * ZERO IMPORTS, like `admin/group-phrases.js`, and here it is doubly load-bearing: this module is
 * reached from `atlas.html`, the page that boots WITHOUT the store. A single import of a barrel
 * would drag the store back in through the transitive path.
 *
 * WHY A BADGE AT ALL. Nothing told a person that an atlas had been shared with them. They found
 * out sideways, or by accident. The two ways out were a silent badge and an invitation e-mail;
 * the owner chose the badge, because it solves the common case without depending on the mail
 * relay being up.
 *
 * ================================================================================
 * "NEW" RELATIVE TO WHAT — the measurement, because this is the whole design problem
 * ================================================================================
 *
 * Measured on 2026-08-23 against the backend of this repository:
 *
 *   - `GET /atlas` (`LIST_USER_ATLAS`) returns the atlas row plus `owner_nome`, `owner_username`
 *     and `user_permission`. Its two timestamps, `created_at` and `updated_at`, belong to the
 *     ATLAS: `updated_at` moves whenever ANYBODY edits it. Neither says when the atlas reached
 *     this person.
 *   - `GET /atlas/overview` projects five fields (`id`, `member_count`, `members`, `has_cover`,
 *     `cover_updated_at`). Its only timestamp is the date of the COVER PICTURE.
 *   - `atlas_shares.added_at` DOES exist in the database, and it is exactly the fact wanted:
 *     when the share was created. It leaves the server through ONE door, `GET /atlas/:id/sharing`,
 *     which is per atlas and gated at `manage`. Unusable here twice over: it would be one request
 *     per card, and the ordinary reader (`read`, `comment`, `write`) does not pass the gate on an
 *     atlas shared WITH them.
 *   - "user X opened atlas Y" is recorded NOWHERE. `presence` is in-memory and only says who is
 *     connected right now; `audit_trail` records writes, never reads. There is no `last_access`
 *     column and no endpoint that would report one.
 *
 * So the server has no notion of read or unread, and the honest mark of what has been seen has to
 * live on the client. That is `localStorage`, keyed per user, and the costs are real and must be
 * said rather than discovered:
 *
 *   1. IT DOES NOT CROSS BROWSERS. Seeing the tab on the desktop leaves the phone's badge lit.
 *   2. IT DIES WITH SITE DATA. Clearing the browser, or a private window, resets the mark.
 *   3. A BROWSER THAT NEVER SAW THIS PERSON HAS NO MARK AT ALL, which is the case below.
 *
 * The fix for all three is a server column (`atlas_shares.seen_at`, or `added_at` exposed on the
 * list plus a per-user last-visit). That is backend work and is not in this change. Until it
 * exists, the badge is a per-browser convenience and nothing more.
 *
 * ================================================================================
 * THE FIRST VISIT IS ADOPTED, NOT ANNOUNCED
 * ================================================================================
 *
 * With no stored mark, the naive reading is "nothing has been seen", so every atlas is new. A
 * person with ten long-standing shared atlases would open the page and be told ten things are
 * new, none of which is. That badge is worse than no badge: it is wrong ten times, it teaches
 * that the number means nothing, and the one time it is right nobody looks.
 *
 * So the absence of a mark is treated as "this browser is meeting this person now": the current
 * shared list is adopted as the baseline SILENTLY and the badge shows zero. The cost is stated
 * plainly: an atlas shared while this browser had no mark is never counted. It is the error in
 * the direction that does not lie.
 *
 * A mark that exists but is CORRUPT (hand-edited, half-written, from a future schema) is a
 * different case and is treated the same way, for the same reason: an unreadable mark carries no
 * evidence about what was seen, so inventing "nothing was seen" from it is the same fabrication.
 *
 * An EMPTY mark is a third case and is NOT adoption: `{ ids: [] }` is a real statement, written
 * by a person who visited the tab when nothing was shared with them yet. The first atlas that
 * arrives afterwards is genuinely new and must count. Collapsing empty into absent would silently
 * swallow exactly the first invitation the feature exists to announce.
 *
 * ================================================================================
 * IT CLEARS ON SEEING THE TAB, NOT ON OPENING THE ATLAS
 * ================================================================================
 *
 * The badge answers "is there something here I have not looked at", and looking at the list IS
 * the act it tracks. Requiring the atlas to be opened would keep the number lit over an
 * invitation the person read and deliberately ignored, and a counter that will not go down is a
 * counter people learn to cover up.
 */

/** Schema version of the stored mark. A mark of any other version is unreadable, hence adopted. */
export const SEEN_MARK_VERSION = 1;

/** Never draw a number wider than the tab. Past this the badge says "9+". */
export const BADGE_MAX_COUNT = 9;

/**
 * The `localStorage` key holding one person's seen-set.
 *
 * PER USER, not per browser: two people sharing a machine must not clear each other's badge, and
 * a single blob keyed by user id would also work but grows without bound as accounts come and go.
 * The `ebgeo_` prefix follows `ebgeo_auth` / `ebgeo_trace`; the `:` separator follows `tab-lock.js`.
 * @param {*} userId
 * @returns {string|null} `null` when there is no account, which is the anonymous visitor: no
 *   account means no share can point at them, so there is nothing to store and nothing to badge.
 */
export function seenMarkStorageKey(userId) {
    const id = String(userId ?? '').trim();
    return id ? `ebgeo_shared_atlas_seen:${id}` : null;
}

/**
 * Ids as a clean, de-duplicated, non-empty list of strings.
 * @param {*} value
 * @returns {string[]}
 */
function normalizeIds(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    const seen = new Set();
    for (const raw of value) {
        // Numbers and `null` are coerced deliberately: the id crosses the wire as a UUID string
        // today, and a comparison that mixed 3 with '3' would silently count an atlas twice.
        const id = String(raw ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
}

/**
 * Reads a stored mark back.
 *
 * EVERY unreadable shape collapses to `null`, which means "absent", which means adoption. That is
 * the safe direction: see the file header.
 * @param {*} raw - The raw string out of `localStorage`, or `null`/`undefined` when there is none.
 * @returns {{ids: string[]}|null} `null` when absent or unreadable.
 */
export function parseSeenMark(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.v !== SEEN_MARK_VERSION) return null;
    if (!Array.isArray(parsed.ids)) return null;
    return { ids: normalizeIds(parsed.ids) };
}

/**
 * Serializes a mark for storage.
 * @param {Array<*>} ids
 * @returns {string}
 */
export function serializeSeenMark(ids) {
    return JSON.stringify({ v: SEEN_MARK_VERSION, ids: normalizeIds(ids) });
}

/**
 * The shared atlases, from a raw `GET /atlas` list.
 *
 * The predicate mirrors the "Compartilhados comigo" tab: an atlas that reached this person by
 * anything OTHER than owning it. It is intentionally NOT a closed list of permission values
 * (`'write' || 'owner'` is the shape the constitution forbids, and which already caused a real bug
 * twice): a level this file has never heard of still means somebody shared something.
 * @param {Array<*>} projects
 * @returns {string[]} Ids, in list order.
 */
export function sharedAtlasIds(projects) {
    if (!Array.isArray(projects)) return [];
    return normalizeIds(
        projects
            .filter((p) => p?.user_permission && p.user_permission !== 'owner')
            .map((p) => p?.id)
    );
}

/**
 * What is new: shared now, and not in the seen-set.
 * @param {Array<*>} shared - Ids currently in the tab.
 * @param {Array<*>} seen - Ids of the stored mark.
 * @returns {string[]} In the order they appear in `shared`.
 */
export function newSharedAtlasIds(shared, seen) {
    const seenSet = new Set(normalizeIds(seen));
    return normalizeIds(shared).filter((id) => !seenSet.has(id));
}

/**
 * The mark to write once the person has looked at the tab.
 *
 * PRUNED to what is currently shared, and that is not housekeeping. An atlas somebody took back
 * and later shared again IS new the second time, and keeping the old id would swallow the second
 * invitation exactly as it swallows the first. The blob also stops growing forever, which is the
 * lesser reason.
 * @param {Array<*>} shared
 * @returns {string[]}
 */
export function nextSeenIds(shared) {
    return normalizeIds(shared);
}

/**
 * THE WHOLE DECISION IN ONE PLACE: how many to show, and what to store.
 *
 * Written as one function precisely so the first-visit rule cannot be applied in one call site and
 * forgotten in the next. Callers do storage; this does the thinking.
 * @param {{projects?: Array<*>, storedMark?: {ids: string[]}|null}} input
 * @returns {{count: number, newIds: string[], adopt: boolean, seenIds: string[]}}
 *   `adopt` is true on the first visit (or an unreadable mark): the caller should write `seenIds`
 *   right away and show no number.
 */
export function resolveSharedBadge(input) {
    const shared = sharedAtlasIds(input?.projects);
    const mark = input?.storedMark;
    const hasMark = !!mark && Array.isArray(mark.ids);
    if (!hasMark) {
        return { count: 0, newIds: [], adopt: true, seenIds: shared };
    }
    const newIds = newSharedAtlasIds(shared, mark.ids);
    return { count: newIds.length, newIds, adopt: false, seenIds: shared };
}

/**
 * The number printed inside the badge. Capped, because the tab is a tab and not a column.
 * @param {*} count
 * @returns {string} Empty string for zero or nonsense, so the caller renders no badge at all.
 */
export function badgeText(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return '';
    const whole = Math.trunc(n);
    if (whole <= 0) return '';
    return whole > BADGE_MAX_COUNT ? `${BADGE_MAX_COUNT}+` : String(whole);
}

/**
 * What a screen reader says, which is NOT the digit.
 *
 * A bare "3" beside a tab name is meaningless out of visual context, and per the house contract
 * important information never lives in `title`. The plural agrees, and "atlas" is invariant in
 * pt-BR.
 * @param {*} count
 * @returns {string} Empty string for zero, matching `badgeText`.
 */
export function badgeAccessibleLabel(count) {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return '';
    const whole = Math.trunc(n);
    if (whole <= 0) return '';
    if (whole === 1) return '1 atlas novo compartilhado com você';
    return `${whole} atlas novos compartilhados com você`;
}

/**
 * WHAT THIS BADGE DOES NOT KNOW, for the empty state of the tab itself.
 *
 * Without it the absence of a number reads as "nobody ever shared anything with me", and on a
 * fresh browser that is a conclusion the screen never actually asserted. Same choice, same reason,
 * as `groupPhrases.participatingReachUnknownNotice`.
 * @returns {string}
 */
export function badgeScopeNotice() {
    return 'A marca do que você já viu fica neste navegador: ela não acompanha você em outro '
        + 'aparelho e some se os dados do site forem limpos. Num navegador novo, o que já estava '
        + 'compartilhado não conta como novidade.';
}

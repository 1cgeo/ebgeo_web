// Path: js/store/sync/resource-scope.js

/**
 * @fileoverview The IDENTITY of the access scope a server answer was decided under.
 *
 * Every private resource this client sees was decided from exactly two inputs: WHO is asking (the
 * session) and WHICH atlas is in focus (the borrowing arm of the server predicate, which only
 * yields a resource while that atlas is the one being asked about). An answer fetched under one
 * pair may NOT be reused under another — that is the whole invariant, and a module-global cache in
 * the client is the cheapest way to break it: an atlas that LENDS a private 360 project warms the
 * projects list, the user leaves that atlas, and the search bar, the briefing validator and the 2D
 * marker layer keep serving the borrowed project outside the only place it was ever authorized.
 * The server would refuse it; nobody asks the server again.
 *
 * WHY A STAMP COMPARED ON READ, AND NOT A `clear()` CALLED ON DISCONNECT. Clearing works only for
 * as long as every cache is on the disconnect call list, and the next module-global cache someone
 * writes will not be on it — the failure is silent and shows up as stale data, not as an error.
 * A stamp compared at READ time fails closed for caches nobody remembered to register: a cache
 * whose stamp does not match the current scope is simply a miss.
 *
 * DELIBERATELY A LEAF (zero imports). Its reader is the 360 client, which lives in a lazy chunk;
 * asking one question must not pull the api client, the session context or the store in behind it.
 * `resource-access.service.js` is the only WRITER — it is the module that decides the scope of the
 * additive payload, so the scope stamp and the payload can never disagree.
 */

/** The scope of a client that has asked for nothing yet: no session, no atlas. */
const ANONYMOUS_SCOPE = 'anon|';

/** @type {string} The scope in force right now. */
let _scope = ANONYMOUS_SCOPE;

/**
 * The opaque stamp of an access scope. Pure, and exported so a cache can build the key it stores
 * from the same recipe the writer uses.
 *
 * `atlasId` is part of the key BECAUSE OF THE BORROWING ARM: the same user, in two atlases, is two
 * different visibility sets. `userId` is part of it because a logout does not merely narrow the set,
 * it changes who is asking.
 * @param {string|number|null} [userId]
 * @param {string|null} [atlasId]
 * @returns {string}
 */
export function resourceScopeKey(userId, atlasId) {
    return `${userId ?? 'anon'}|${atlasId ?? ''}`;
}

/** @returns {string} The scope stamp in force. */
export function currentResourceScope() {
    return _scope;
}

/**
 * The atlas half of the scope in force, or null.
 *
 * Exists so that a caller who has to SEND the atlas to the server does not parse the opaque
 * stamp itself. The one that needs it is the 3D asset route: since F11 the bytes of a private
 * model are gated, and the borrowing arm of the server predicate only yields the model while
 * that atlas is the one being asked about — so the request has to name it. Reading it from
 * here rather than from the sync engine is what keeps the two from disagreeing: this is the
 * atlas under which the private catalog entries currently in `config` were actually granted.
 *
 * The atlas UUID is NOT a credential and this function does not treat it as one: the server
 * runs `requireAtlasPermission('read')` on whatever arrives.
 * @returns {string|null}
 */
export function currentResourceAtlasId() {
    const atlasId = _scope.slice(_scope.indexOf('|') + 1);
    return atlasId || null;
}

/**
 * Declares the scope in force. Called BEFORE the additive payload is fetched, on purpose: the scope
 * changes when the caller says it changed, not when the network agrees. A fetch that fails must not
 * leave the previous scope's caches readable.
 * @param {string} key - A stamp from {@link resourceScopeKey}.
 * @returns {void}
 */
export function setResourceScope(key) {
    _scope = key || ANONYMOUS_SCOPE;
}

/** Back to the anonymous scope (logout, disconnect, return to the local store). @returns {void} */
export function resetResourceScope() {
    _scope = ANONYMOUS_SCOPE;
}

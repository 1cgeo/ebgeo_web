// Path: js/deep-link/atlas-link.js

/**
 * @module deep-link/atlas-link
 * @description URL deep-link for a remote atlas + map: `?atlas=<uuid>&map=<uuid>`. The atlas
 * determines the project; the optional `map` points at a specific map inside it. The query params
 * (`?atlas`/`?map`) are ORTHOGONAL to the 3D/360 viewer hash (`#view=…`) — they never conflict.
 *
 * Both ids are UUIDs (stable; names can repeat/change). The `map` id resolves to a name internally
 * via the map-resolver when the atlas is activated.
 *
 * Pure parse/build helpers are exported for unit testing; the window/history wrappers call them.
 */

import { isValidUUID } from '@utils/uuid.js';

const ATLAS_PARAM = 'atlas';
const MAP_PARAM = 'map';

/**
 * Parses a query string into an atlas deep link, or null when there is no valid `?atlas=<uuid>`.
 * An invalid (non-UUID) atlas id yields null; an invalid map id is dropped (atlas still opens).
 * @param {string} search - A `location.search`-style string (may include the leading '?').
 * @returns {{ atlasId: string, mapId: string|null } | null}
 */
export function parseAtlasParams(search) {
    const params = new URLSearchParams(search || '');
    const atlasId = params.get(ATLAS_PARAM);
    if (!atlasId || !isValidUUID(atlasId)) return null;
    const rawMap = params.get(MAP_PARAM);
    const mapId = rawMap && isValidUUID(rawMap) ? rawMap : null;
    return { atlasId, mapId };
}

/**
 * Builds the next query string for an atlas/map, dropping the one-shot/anonymous params
 * (`atlasPublico`, `verify`) and preserving any unrelated params already present.
 * A falsy `mapId` PRESERVES any existing map param rather than deleting it — the live current-map
 * id briefly resolves to a name (not a UUID) before the map-resolver populates, and we must not
 * downgrade a good `?map=<uuid>` to a name. Pass a falsy `atlasId` to clear both (logout/disconnect).
 * @param {string} search - Current `location.search`.
 * @param {string} atlasId
 * @param {string|null} mapId
 * @returns {string} A query string beginning with '?' (or '' when atlasId is falsy).
 */
export function buildAtlasSearch(search, atlasId, mapId) {
    const params = new URLSearchParams(search || '');
    if (!atlasId) {
        // Clearing (logout/disconnect): drop ONLY atlas/map. Must NOT strip `atlasPublico` — an
        // anonymous public-atlas viewer fires these same events and would lose their shareable link.
        params.delete(ATLAS_PARAM);
        params.delete(MAP_PARAM);
    } else {
        // Writing an atlas link supersedes the one-shot/anonymous params.
        params.delete('atlasPublico');
        params.delete('verify');
        params.set(ATLAS_PARAM, atlasId);
        if (mapId) params.set(MAP_PARAM, mapId); // else: keep the existing map param
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

/** Reads the current atlas deep link from the address bar. @returns {{atlasId,mapId}|null} */
export function parseAtlasLink() {
    return parseAtlasParams(window.location.search);
}

/**
 * Reflects `?atlas=&map=` in the address bar via history.replaceState (no reload), preserving the
 * hash. replaceState — NOT pushState — because the URL is a mirror of the current atlas/map for
 * reload/bookmark/share; there is no popstate handler, so pushing an entry per map switch would only
 * pile up history and trap the Back button. No-op when the URL already reflects this atlas/map.
 * @param {string} atlasId
 * @param {string|null} [mapId]
 */
export function writeAtlasUrl(atlasId, mapId = null) {
    if (!atlasId) return;
    const nextSearch = buildAtlasSearch(window.location.search, atlasId, mapId);
    if (nextSearch === window.location.search) return;
    const url = window.location.pathname + nextSearch + window.location.hash;
    window.history.replaceState({}, '', url);
}

/**
 * Removes the atlas/map params from the address bar (on disconnect/logout). Preserves the hash.
 * Uses replaceState — clearing is not a navigable state.
 */
export function clearAtlasUrl() {
    const nextSearch = buildAtlasSearch(window.location.search, null, null);
    if (nextSearch === window.location.search) return;
    const url = window.location.pathname + nextSearch + window.location.hash;
    window.history.replaceState({}, '', url);
}

// ===== Pending link (login resume) =====
// A `?atlas=` hit while logged out is remembered here and consumed right after login, so the user
// lands on the atlas they asked for instead of the generic picker. Module-scoped: boot and login
// happen in the same page session (no reload between them).
let _pendingLink = null;

/** @param {{atlasId:string, mapId:string|null}|null} link */
export function setPendingAtlasLink(link) {
    _pendingLink = link;
}

/** Returns the pending link and clears it (one-shot). @returns {{atlasId,mapId}|null} */
export function consumePendingAtlasLink() {
    const link = _pendingLink;
    _pendingLink = null;
    return link;
}

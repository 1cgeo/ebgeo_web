// Path: js/street_view_tool/streetview-api.service.js
/**
 * @module street_view_tool/streetview-api.service
 * @description Centralized API client for the Street View 360 service.
 * Replaces direct fetch calls to the static file server.
 * All street view data access goes through this module.
 */

import config from '../config.js';
import { currentResourceAtlasId, currentResourceScope } from '@store/sync/resource-scope.js';
import { apiClient } from '@store/sync/api-client.js';
import { stampAtlasOnTiles, stampAtlasOnUrl } from './tile-scope.js';

// ============================================================
// Configuration
// ============================================================

function getServiceUrl() {
  return config.streetView360.serviceUrl;
}

/**
 * Returns a MapLibre vector-source spec with ABSOLUTE tile URLs.
 *
 * `/api/config` serves the 360 tile template RELATIVE (`/api/v1/sv360/tiles/...`),
 * which is right for this module's own `fetch()` calls: those run in the window
 * context and resolve against the document base. MapLibre does NOT — it fetches
 * tiles inside a Web Worker booted from a blob: URL, which has no usable base, so a
 * relative template dies with "Failed to construct 'Request': Failed to parse URL"
 * and the 360 photo layer simply never appears on the 2D map.
 *
 * String concatenation, NOT `new URL()`: the URL constructor percent-encodes the
 * braces of the `{z}/{x}/{y}` placeholders, and MapLibre substitutes them by literal
 * string replacement — `%7Bz%7D` would never be replaced, trading this bug for a
 * subtler one. An already-absolute template (SV360_SERVICE_URL pointing at another
 * origin) is passed through untouched.
 * @param {Object} source - a MapLibre vector source spec from config.streetView360
 * @returns {Object} the same spec with absolute `tiles[]`
 */
export function withAbsoluteTiles(source) {
  if (!Array.isArray(source?.tiles) || source.tiles.length === 0) return source;
  return {
    ...source,
    tiles: source.tiles.map((t) =>
      typeof t === 'string' && t.startsWith('/') ? `${window.location.origin}${t}` : t
    ),
  };
}

/**
 * The atlas in focus, or null — the ONE source of truth for it, not a second one.
 *
 * It comes from `store/sync/resource-scope.js`, the same stamp `adoptCurrentScope()` below
 * compares to invalidate this module's caches and the same one `store/sync/assets3d-request.js`
 * reads to scope the 3D asset bytes. Its only WRITER is `resource-access.service.js`, which
 * declares the scope BEFORE fetching the additive payload — so the atlas named here is always
 * the atlas the private catalog entries currently in `config` were granted under.
 *
 * The atlas UUID is NOT a credential. Naming it tells the server which loan to consider; the
 * server still runs `requireAtlasPermission('read')` and answers 404 when the caller cannot
 * reach that atlas.
 * @returns {string|null}
 */
export function sv360AtlasScope() {
  return currentResourceAtlasId();
}

/**
 * The vector-source spec MapLibre should be given for the 360 tiles: absolute template, plus the
 * atlas in focus.
 *
 * The two rewrites are separate functions and composed here because they answer different
 * questions ({@link withAbsoluteTiles} answers "can a Web Worker resolve this?",
 * `stampAtlasOnTiles` answers "which atlas is lending?"), and because the atlas half must stay
 * testable without a window.
 *
 * `atlasId` is an ARGUMENT with a default, not a lookup inside: the caller reads the scope once
 * and uses the same value both for the spec and for the stamp it records, so the spec on the map
 * and the caller's idea of which atlas built it cannot disagree.
 * @param {Object} source - A vector source spec from `config.streetView360`.
 * @param {string|null} [atlasId] - The atlas in focus; defaults to {@link sv360AtlasScope}.
 * @returns {Object} The spec to hand to `map.addSource`.
 */
export function sv360TileSource(source, atlasId = sv360AtlasScope()) {
  return stampAtlasOnTiles(withAbsoluteTiles(source), atlasId);
}

/**
 * The address of ONE read of the 360 service, with the atlas in focus already on it.
 *
 * EVERY READ IN THIS MODULE GOES THROUGH HERE, and that is the whole correction. The server has
 * honoured `?atlasId=` on all fourteen read routes since 2026-08-18, but the client stamped it on
 * the MVT template alone — which is the most misleading half to ship: the 2D layer drew the dot of
 * a borrowed private panorama (tiles carried the scope) and every other surface refused it. The
 * click called `/photos/nearest` unscoped, took the 404 as "nothing nearby", and opened nothing;
 * the project was absent from the catalog and from the search. The map proved the resource existed
 * and the interface denied it.
 *
 * A SECOND `?atlasId=` WRITTEN BY HAND SOMEWHERE ELSE IS THE DEFECT COMING BACK, so the stamp is
 * not written here either: it is {@link stampAtlasOnUrl}, the same function the tile templates go
 * through and the same one `calibration/api.js` builds its reads with.
 *
 * NO ATLAS IN FOCUS PRODUCES TODAY'S URL, character for character — no `atlasId=`, no
 * `atlasId=undefined`. That is not a nicety: the field is validated as a GUID, so either of those
 * is a 422 for the anonymous visitor and the local map, who are the majority of readers.
 *
 * `atlasId` is an ARGUMENT with a default so the caller that also has to REMEMBER which atlas it
 * used (the projects cache) reads the scope once and passes the same value here.
 * @param {string} path - Path under the service root, leading slash included (`/projects`).
 * @param {string|null} [atlasId] - The atlas in focus; defaults to {@link sv360AtlasScope}.
 * @returns {string} The URL to fetch.
 */
export function sv360ReadUrl(path, atlasId = sv360AtlasScope()) {
  return stampAtlasOnUrl(`${getServiceUrl()}${path}`, atlasId);
}

// ============================================================
// MapLibre credential stamping (the 360 tiles)
// ============================================================

/**
 * The 360 service base as a parsed URL, or null when it cannot be parsed.
 *
 * `config.streetView360.serviceUrl` is served by `/api/config` and defaults to the
 * RELATIVE `/api/v1/sv360`, so it is resolved against the page origin. When
 * `SV360_SERVICE_URL` points at ANOTHER origin it is already absolute and the base
 * is ignored. Empty config (before the runtime merge) yields null, and null stamps
 * nothing — the anonymous request is the pre-existing behaviour, never a new leak.
 * @returns {URL|null}
 */
function sv360Base() {
  const raw = config.streetView360?.serviceUrl;
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

/**
 * Whether a URL addresses the 360 service, compared by ORIGIN and by PATH BOUNDARY.
 *
 * NEVER BY STRING PREFIX, and this is the whole point of the function. With the
 * service at `https://sv360.example.mil.br/api/v1/sv360`, a plain `startsWith`
 * accepts `https://sv360.example.mil.br.evil.example/...` and
 * `https://sv360.example.mil.br@evil.example/...` — the first is a different
 * registrable domain, the second resolves to `evil.example` with the service name
 * demoted to userinfo. Both would hand the user's access token to a third party,
 * which is strictly worse than the silent feature loss this stamping exists to fix.
 * `URL.origin` answers scheme+host+port and cannot be fooled by either.
 *
 * The path boundary is the second half: on the DEFAULT same-origin deploy the whole
 * app shares one origin, so origin alone would stamp the token onto every basemap
 * tile and every glyph range the same host serves. `/api/v1/sv360` matches, and so
 * does `/api/v1/sv360/tiles/...`; `/api/v1/sv360extra` does not.
 * @param {string} url - the fully substituted URL MapLibre is about to request
 * @returns {boolean}
 */
export function isSv360Url(url) {
  const base = sv360Base();
  if (!base || typeof url !== 'string' || url === '') return false;

  let alvo;
  try {
    alvo = new URL(url, window.location.origin);
  } catch {
    return false;
  }
  // `origin` is the opaque string "null" for blob:/data:, which equals no http(s)
  // origin and therefore never matches the service.
  if (alvo.origin !== base.origin || alvo.origin === 'null') return false;

  const raiz = base.pathname.replace(/\/+$/, '');
  if (raiz === '') return true;
  return alvo.pathname === raiz || alvo.pathname.startsWith(`${raiz}/`);
}

/**
 * The MapLibre `transformRequest` that keeps a LOGGED-IN user's private 360 projects
 * visible when the service is served from another origin.
 *
 * WHY IT IS NEEDED. The MVT route (`/tiles/:z/:x/:y.pbf`) is `flexibleAuth`: with no
 * principal it does not answer 401, it answers HTTP 200 with the PUBLIC subset —
 * `sv360AccessPredicate` is fed by `readScope(user, atlasId)`. Today the request
 * carries the session cookie only by accident: MapLibre builds its tile fetch as
 * `new Request(url, { credentials: t.credentials, ... })` with `t.credentials`
 * undefined, so the Fetch default `same-origin` applies. Point `SV360_SERVICE_URL`
 * at another origin — which `backend/src/config.js` supports on purpose — and the
 * cookie stops travelling, the tile still returns 200, and the user's own private
 * projects simply disappear from the 2D layer with nothing in the console.
 *
 * WHY BEARER AND NOT `credentials: 'include'`. The session cookie is minted with
 * `sameSite: 'strict'` in production (`backend/src/utils/environment.js`), so the
 * browser withholds it from a cross-SITE request no matter what the fetch asks for.
 * `include` would therefore fix nothing in the deploy that needs fixing. The Bearer
 * token is the mechanism the rest of the app already uses for exactly this shape of
 * problem (`store/sync/assets3d-request.js`, which stamps Cesium's `Resource`), and
 * `flexibleAuth` accepts it on the same route.
 *
 * SYNCHRONOUS, because MapLibre's `transformRequest` is. So it reads the token from
 * memory (`apiClient.getAccessToken()`) instead of `apiClient.authHeader()`, which
 * awaits a refresh. That costs nothing here: the token is read at REQUEST time, not
 * at map-creation time, and the boot sequence restores it from localStorage
 * (`restoreSessionFromStorage`) before `createMap()` runs.
 *
 * A falsy return is MapLibre's "leave it alone" — it falls back to `{ url }`. So a
 * basemap tile, a glyph range or a BDGEx WMS call comes out of here untouched, and
 * the default same-origin deploy keeps working exactly as it does today (there the
 * cookie still travels; `flexibleAuth` reads the cookie FIRST, so the added header
 * changes no answer).
 * @param {string} url - the URL MapLibre wants
 * @returns {{url: string, headers: Object}|undefined}
 */
export function sv360TransformRequest(url) {
  if (!isSv360Url(url)) return undefined;
  const token = apiClient?.getAccessToken?.();
  if (!token) return undefined;
  return { url, headers: { Authorization: `Bearer ${token}` } };
}

// Canonical UUID shape, ANY version: the job here is to tell a photo id apart
// from a legacy filename, not to validate a version. Pinning the version nibble
// to 4 was wrong — the studio mints photo ids as **v5** and the backend validates
// them as such (`.guid({ version: ['uuidv5'] })` in sv360.schemas.js,
// sv360.write.schemas.js and sv360.admin.schemas.js), so every real id failed
// this test and both call sites below took the legacy-filename branch.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks if a string has the canonical UUID shape (any version).
 * @param {string} str - String to check
 * @returns {boolean}
 */
export function isUUID(str) {
  return UUID_RE.test(str);
}

// ============================================================
// Photo metadata
// ============================================================

/**
 * Builds the metadata URL for a photo identifier, picking the route by SHAPE.
 * Single source for that choice so the read and the existence check cannot drift
 * apart — they took different routes once and only one of them worked.
 * @param {string} photoIdOrName - Photo UUID or original filename
 * @returns {string} absolute-or-relative metadata URL
 */
function photoMetadataUrl(photoIdOrName) {
  const path = isUUID(photoIdOrName)
    ? `/photos/${photoIdOrName}`
    : `/photos/by-name/${encodeURIComponent(photoIdOrName)}`;
  return sv360ReadUrl(path);
}

/**
 * Fetches metadata for a photo by UUID **or** by original filename.
 * Returns the same shape as the legacy JSON files so the viewer
 * needs minimal changes.
 *
 * ROUTES BY SHAPE, and must: the viewer navigates by the target's `img`
 * (`original_name`), not by its `id` — `navigateToTarget` → `loadPhoto` →
 * `loadMetadataWithCache` all thread a NAME. Sending that name to
 * `/photos/:uuid` fails the uuid param guard with a 422, so every in-viewer jump
 * to an adjacent panorama died once the archive was real. `/photos/by-name/:nome`
 * exists precisely for this and returns the IDENTICAL frozen metadata shape (both
 * routes end in the backend's `buildPhotoMetadata`), so dispatching here costs one
 * request — resolving the name to a uuid first would cost two.
 * @param {string} photoIdOrName - Photo UUID or original filename
 * @returns {Promise<Object>} Metadata with camera and targets
 */
export async function fetchPhotoMetadata(photoIdOrName) {
  const response = await fetch(photoMetadataUrl(photoIdOrName));
  if (!response.ok) {
    throw new Error(`Photo not found: ${photoIdOrName} (HTTP ${response.status})`);
  }
  return response.json();
}

/**
 * Fetches the photo closest to a coordinate, anywhere in the archive.
 *
 * WHY THIS IS AN API CALL AND NOT A MAP QUERY. The map used to answer this with
 * querySourceFeatures over the vector tiles it had already loaded, which tied
 * the answer to what happened to be drawn: below the source's minimum zoom no
 * tile exists, so clicking a trajectory line simply opened nothing. The service
 * answers from the spatial index, so it works at every zoom and returns the
 * photo that is really closest, not the closest among the survivors of tile
 * thinning.
 *
 * NOTHING NEARBY IS A 404, not a fault, and it lands on the same null as a
 * network error: the caller only decides whether to open the viewer. THAT
 * TOLERANCE IS WHY THE ATLAS SCOPE MATTERS MOST HERE: an unscoped request for a
 * panorama borrowed by the atlas in focus is also a 404, so it arrived as "nada
 * por perto" and the click on a dot the 2D layer had just drawn did nothing at
 * all, with a clean console.
 *
 * @param {number} lon - Longitude of the clicked point
 * @param {number} lat - Latitude of the clicked point
 * @returns {Promise<Object|null>} Photo with id, img, lon, lat, projectSlug,
 *   floor_level and distance, or null when there is none
 */
export async function fetchNearestPhoto(lon, lat) {
  try {
    const response = await fetch(sv360ReadUrl(`/photos/nearest?lon=${lon}&lat=${lat}`));
    if (!response.ok) return null;
    const data = await response.json();
    return data.photo ?? null;
  } catch (error) {
    console.error('[streetview-api] fetchNearestPhoto failed:', error);
    return null;
  }
}

/**
 * Fetches the floors of a project, top floor first.
 *
 * AN EMPTY ARRAY IS THE NORMAL ANSWER, not a failure: it means the project has
 * no floors, which is the case for every outdoor survey in the archive. The
 * route answers HTTP 200 with `{ floors: [] }` in that case, never 404, so a
 * non-ok response here really is a fault and also lands on the empty array.
 * The caller uses the empty array to draw no floor selector at all.
 *
 * Each floor carries `level` (ordered, 0 = ground), `label`, `photoCount` and
 * `plan`, a GeoJSON FeatureCollection of lines, or null where no plan was
 * drawn for that level.
 *
 * @param {string} slug - Project slug
 * @returns {Promise<Array<Object>>} Floors, or [] when the project has none
 */
export async function fetchProjectFloors(slug) {
  if (!slug) return [];
  try {
    const response = await fetch(sv360ReadUrl(`/projects/${encodeURIComponent(slug)}/floors`));
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.floors) ? data.floors : [];
  } catch (error) {
    // Sem andares a interface fica igual ao que era. Falhar aqui nao pode
    // derrubar a abertura do 360, que funciona sem o seletor.
    console.error(`[streetview-api] fetchProjectFloors failed for "${slug}":`, error);
    return [];
  }
}

/**
 * Validates that a photo exists (HEAD request, no body).
 * @param {string} photoId - Photo UUID
 * @returns {Promise<boolean>}
 */
export async function validatePhoto(photoId) {
  try {
    // Same shape-based routing as fetchPhotoMetadata: a briefing slide stores
    // whatever the viewer had as its current photo, and that is an original_name,
    // so a uuid-only URL reported every legacy slide as a missing photo.
    const response = await fetch(photoMetadataUrl(photoId), { method: 'HEAD' });
    return response.ok;
  } catch (error) {
    console.error(`[streetview-api] validatePhoto failed for "${photoId}":`, error);
    return false;
  }
}

// ============================================================
// Image URLs
// ============================================================

/**
 * Returns the URL for a photo image at a given quality.
 *
 * The bytes are gated like the metadata (`/photos/:uuid/image` runs the same
 * `liftOptionalAtlasId` → `requireAtlasScopeWhenPresent` pair), so the atlas in
 * focus goes on this address too — an unscoped one 404s for a borrowed private
 * panorama and the viewer opens on a blank sphere.
 * @param {string} photoId - Photo UUID
 * @param {'full'|'preview'} [quality='full'] - Image quality variant
 * @returns {string} Image URL
 */
export function getPhotoImageUrl(photoId, quality = 'full') {
  return sv360ReadUrl(`/photos/${photoId}/image?quality=${quality}`);
}

// ============================================================
// Display name resolution
// ============================================================

/** @type {Map<string, string>} Cache: photo UUID → display name */
const _displayNameCache = new Map();

/**
 * Resolves a photo UUID to its display name.
 * Uses cached metadata when available. Returns the UUID as fallback.
 * @param {string} photoId - Photo UUID
 * @returns {Promise<string>} Display name or UUID as fallback
 */
export async function getPhotoDisplayName(photoId) {
  if (!isUUID(photoId)) return photoId;
  adoptCurrentScope();
  if (_displayNameCache.has(photoId)) return _displayNameCache.get(photoId);

  try {
    const data = await fetchPhotoMetadata(photoId);
    const name = data.camera?.display_name || photoId;
    _displayNameCache.set(photoId, name);
    return name;
  } catch (error) {
    console.error(`[streetview-api] getPhotoDisplayName failed for "${photoId}":`, error);
    return photoId;
  }
}

// ============================================================
// Projects
// ============================================================

/** @type {Array|null} Cached projects list (populated on first fetchProjects call) */
let _projectsCache = null;

/** @type {string|null} The access scope the caches above were filled under. */
let _cacheScope = null;

/**
 * Drops every cache in this module that was filled under a DIFFERENT access scope, and adopts the
 * current one.
 *
 * WHY THIS EXISTS. `GET /sv360/projects` is decided per caller: global role, personal grant and —
 * once an atlas is in focus — what that atlas LENDS. The answer is therefore only valid inside the
 * scope it was fetched under, while these caches are module-global and outlive it. Warmed inside a
 * lending atlas, they would keep handing the borrowed project to the search bar, the briefing
 * validator, the catalog and the 2D marker layer after the user left that atlas — which is exactly
 * the invariant the server's borrowing arm exists to enforce, defeated on the client side.
 *
 * The scope stamp is compared HERE, on every read, instead of being cleared from the disconnect
 * path: a clear only reaches the caches someone remembered to register, and this module is a lazy
 * chunk the sync engine has no reason to import. A mismatch is simply a miss, which costs one
 * request and cannot serve the wrong scope.
 *
 * The display-name cache goes with it for the same reason and not for a weaker one: those names
 * come from photo metadata of projects that may be private.
 *
 * IT RETURNS BOTH HALVES OF THE SCOPE, and that is not convenience. Until the reads carried
 * `?atlasId=`, a scope change here only bought a refetch of the SAME answer, because the request
 * did not name the atlas; now the atlas half decides what comes back, and the caller has to stamp
 * the URL with the very atlas it will label the answer with. Reading the scope for the stamp and
 * again for the label would be two reads of a value that changes under both.
 * @returns {{scope: string, atlasId: string|null}} The scope now in force, and its atlas half.
 */
function adoptCurrentScope() {
  const scope = currentResourceScope();
  // Two reads of the same module-global, with no `await` between them: they cannot interleave.
  const atlasId = currentResourceAtlasId();
  if (_cacheScope === scope) return { scope, atlasId };
  _projectsCache = null;
  _displayNameCache.clear();
  _cacheScope = scope;
  return { scope, atlasId };
}

/**
 * Normalizes a projects API response into a plain array.
 * Accepts both the bare-array shape (`GET /sv360/projects`) and the
 * legacy `{ projects: [...] }` envelope. Always returns an array.
 * @param {*} data - Parsed JSON response body
 * @returns {Array} Array of project objects (empty if none)
 */
export function normalizeProjects(data) {
  return Array.isArray(data) ? data : (data?.projects ?? []);
}

/**
 * Fetches all projects from the service with caching.
 * First call fetches from API; subsequent calls return the cache.
 * @param {boolean} [forceRefresh=false] - Force a fresh API call
 * @returns {Promise<Array>} Array of project objects
 */
export async function fetchProjects(forceRefresh = false) {
  const { scope, atlasId } = adoptCurrentScope();
  if (_projectsCache && !forceRefresh) return _projectsCache;

  // The atlas that decides the answer is the one the stamp above adopted, never a fresh lookup:
  // the URL and the label of the answer have to name the same atlas.
  const response = await fetch(sv360ReadUrl('/projects', atlasId));
  if (!response.ok) {
    throw new Error(`Failed to fetch projects (HTTP ${response.status})`);
  }
  const data = await response.json();
  // Stamped with the scope read BEFORE the request, not after: a scope change that landed while
  // this request was in flight must not be able to label this answer as belonging to the new one.
  // Re-reading here would do exactly that, and the next reader would trust it.
  _projectsCache = normalizeProjects(data);
  _cacheScope = scope;
  return _projectsCache;
}

/**
 * Returns the cached projects array synchronously.
 * Returns null if fetchProjects() hasn't been called yet — or if what it cached was decided under
 * a DIFFERENT access scope (see {@link adoptCurrentScope}), which every caller already handles as
 * "not fetched yet".
 * @returns {Array|null}
 */
export function getCachedProjects() {
  adoptCurrentScope();
  return _projectsCache;
}

/**
 * Preflight check: verifies the Street View 360 service is available
 * and has at least one project. Populates the projects cache on success.
 * @returns {Promise<boolean>} true if service is available with projects
 */
export async function preflightCheck() {
  try {
    const projects = await fetchProjects(true);
    return Array.isArray(projects) && projects.length > 0;
  } catch (error) {
    console.error('[streetview-api] preflightCheck failed:', error);
    return false;
  }
}

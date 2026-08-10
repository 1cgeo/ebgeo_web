// Path: js/street_view_tool/streetview-api.service.js
/**
 * @module street_view_tool/streetview-api.service
 * @description Centralized API client for the Street View 360 service.
 * Replaces direct fetch calls to the static file server.
 * All street view data access goes through this module.
 */

import config from '../config.js';

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
  return `${getServiceUrl()}${path}`;
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
 * network error: the caller only decides whether to open the viewer.
 *
 * @param {number} lon - Longitude of the clicked point
 * @param {number} lat - Latitude of the clicked point
 * @returns {Promise<Object|null>} Photo with id, img, lon, lat, projectSlug,
 *   floor_level and distance, or null when there is none
 */
export async function fetchNearestPhoto(lon, lat) {
  try {
    const response = await fetch(`${getServiceUrl()}/photos/nearest?lon=${lon}&lat=${lat}`);
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
    const response = await fetch(`${getServiceUrl()}/projects/${encodeURIComponent(slug)}/floors`);
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
 * @param {string} photoId - Photo UUID
 * @param {'full'|'preview'} [quality='full'] - Image quality variant
 * @returns {string} Image URL
 */
export function getPhotoImageUrl(photoId, quality = 'full') {
  return `${getServiceUrl()}/photos/${photoId}/image?quality=${quality}`;
}

// ============================================================
// Backward compatibility: original name → UUID resolution
// ============================================================

/**
 * Resolves a legacy original filename to a UUID.
 * Used for backward compat with old deep links and saved data.
 * @param {string} originalName - Original photo filename (e.g., "MULTICAPTURA_0466_001369")
 * @returns {Promise<string|null>} UUID or null if not found
 */
export async function resolveOriginalName(originalName) {
  try {
    const response = await fetch(`${getServiceUrl()}/photos/by-name/${encodeURIComponent(originalName)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.id;
  } catch (error) {
    console.error(`[streetview-api] resolveOriginalName failed for "${originalName}":`, error);
    return null;
  }
}

/**
 * Resolves a photo identifier to a UUID.
 * If the input is already a UUID, returns it as-is.
 * If it's a legacy filename, resolves it via the API.
 * @param {string} photoIdOrName - UUID or original filename
 * @returns {Promise<string|null>} UUID or null if not found
 */
export async function resolveToUUID(photoIdOrName) {
  if (isUUID(photoIdOrName)) return photoIdOrName;
  return resolveOriginalName(photoIdOrName);
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
  if (_projectsCache && !forceRefresh) return _projectsCache;

  const response = await fetch(`${getServiceUrl()}/projects`);
  if (!response.ok) {
    throw new Error(`Failed to fetch projects (HTTP ${response.status})`);
  }
  const data = await response.json();
  _projectsCache = normalizeProjects(data);
  return _projectsCache;
}

/**
 * Returns the cached projects array synchronously.
 * Returns null if fetchProjects() hasn't been called yet.
 * @returns {Array|null}
 */
export function getCachedProjects() {
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

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

// UUID v4 regex for detecting UUIDs vs legacy filenames
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Checks if a string is a valid UUID v4.
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
 * Fetches metadata for a photo by UUID.
 * Returns the same shape as the legacy JSON files so the viewer
 * needs minimal changes.
 * @param {string} photoId - Photo UUID
 * @returns {Promise<Object>} Metadata with camera and targets
 */
export async function fetchPhotoMetadata(photoId) {
  const response = await fetch(`${getServiceUrl()}/photos/${photoId}`);
  if (!response.ok) {
    throw new Error(`Photo not found: ${photoId} (HTTP ${response.status})`);
  }
  return response.json();
}

/**
 * Validates that a photo exists (HEAD request, no body).
 * @param {string} photoId - Photo UUID
 * @returns {Promise<boolean>}
 */
export async function validatePhoto(photoId) {
  try {
    const response = await fetch(`${getServiceUrl()}/photos/${photoId}`, { method: 'HEAD' });
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

// Path: js/store/sync/runtime-config.js

/**
 * @fileoverview Runtime config bridge: pulls `GET /api/config` from the backend and
 * deep-merges it INTO the static config object (mutated in place across the app).
 *
 * The static `config` binding is imported everywhere and mutated in place — it is
 * never replaced. This module merges backend values over the static defaults
 * key-by-key: backend values win where present, static keys the backend omits are
 * preserved. Failure (offline / no backend) is non-fatal: the static config is left
 * untouched and `{ applied: false, error }` is returned.
 */

import config from '../../config.js';
import { apiClient as defaultApiClient } from './api-client.js';

/**
 * Returns the backend API base URL, honoring a global test/E2E override.
 * @returns {string} The base URL (e.g. a `globalThis.__EBGEO_BACKEND_URL__` override
 *   or the same-origin default `/api/v1`).
 */
export function resolveBackendBaseUrl() {
    return globalThis.__EBGEO_BACKEND_URL__ || '/api/v1';
}

/**
 * Whether a value is a plain object (mergeable), excluding arrays and null.
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursively merges `source` INTO `target` in place. Plain-object branches are
 * merged key-by-key; every other value type (primitives, arrays) is overwritten by
 * the source value. Keys absent from `source` are preserved on `target`.
 * @param {Object} target - Mutated in place.
 * @param {Object} source - Backend-provided overrides.
 */
function deepMergeInto(target, source) {
    for (const key of Object.keys(source)) {
        const sourceValue = source[key];
        const targetValue = target[key];
        if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
            deepMergeInto(targetValue, sourceValue);
        } else {
            target[key] = sourceValue;
        }
    }
}

/**
 * Fetches `GET /api/config` and deep-merges it into the static config object in place.
 * Fail-safe: on any error the static config is left untouched.
 * @param {Object} [deps]
 * @param {{ getConfig: () => Promise<Object> }} [deps.apiClient] - Injectable client.
 * @returns {Promise<{ applied: boolean, error?: Error }>} `{ applied: true }` on success,
 *   `{ applied: false, error }` if the fetch failed or returned a non-object.
 */
export async function applyRuntimeConfig({ apiClient = defaultApiClient } = {}) {
    try {
        const remote = await apiClient.getConfig();
        if (!isPlainObject(remote)) {
            return { applied: false, error: new Error('Invalid config payload') };
        }
        deepMergeInto(config, remote);
        return { applied: true };
    } catch (error) {
        return { applied: false, error };
    }
}

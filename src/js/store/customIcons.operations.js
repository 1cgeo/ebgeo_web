// Path: js/store/customIcons.operations.js

/**
 * @fileoverview Custom point-icon registry operations.
 *
 * Custom icons are part of the current project: their normalized PNG blobs live
 * in the shared image store (`ebgeo_images`, keyed by icon id), and a lightweight
 * registry of metadata ({ id, name, thumbnail, type, createdAt }) is persisted as
 * an app setting. The registry feeds the marker picker; the blobs are rendered on
 * the map and embedded in `.ebgeo` exports.
 *
 * The registry is lazy-loaded into memory on first access, so no startup wiring is
 * required — the picker/export await `getCustomIcons()`, while map rendering reads
 * blobs directly by id via `getCustomIconBlob()`.
 */

import { generateUUID } from '../utilities/uuid.js';
import {
    getSettingCompat,
    setSettingCompat,
    saveImageCompat,
    getImageCompat,
    deleteImageCompat,
} from './repositories/index.js';
import { getEventBus } from './services.js';
import { EventTypes } from '../events/event_types.js';

const SETTING_KEY = 'custom_icons';

/** In-memory registry cache. `null` until first load. */
let registry = null;
let loadPromise = null;
let eventSubscribed = false;

/**
 * Reset the cache so the next access reloads from storage. Subscribed to
 * ALL_DATA_CLEARED so a project switch / "new project" / non-additive import
 * does not leave a stale previous-project registry in memory (mirrors the
 * color-picker cache reset). Idempotent.
 */
function subscribeToDataCleared() {
    if (eventSubscribed) return;
    try {
        getEventBus().on(EventTypes.ALL_DATA_CLEARED, () => {
            registry = null;
            loadPromise = null;
        });
        eventSubscribed = true;
    } catch {
        // EventBus not ready yet — will retry on the next registry access.
    }
}

/**
 * Ensure the registry is loaded into memory (once).
 * @returns {Promise<Array>} The registry array
 */
async function ensureLoaded() {
    subscribeToDataCleared();
    if (registry !== null) return registry;
    if (!loadPromise) {
        loadPromise = getSettingCompat(SETTING_KEY);
    }
    try {
        const value = await loadPromise;
        registry = Array.isArray(value) ? value : [];
        return registry;
    } catch (error) {
        // Transient read failure: don't cache an empty registry — allow a retry
        // on the next access instead of hiding saved icons for the whole session.
        console.warn('Failed to load custom icons registry:', error);
        loadPromise = null;
        return [];
    }
}

/**
 * Get the project's custom icons (loads the registry if needed).
 * @returns {Promise<Array<{id: string, name: string, thumbnail: string, type: string, createdAt: number}>>}
 */
export async function getCustomIcons() {
    return [...(await ensureLoaded())];
}

/**
 * Add a custom icon: store its blob and register its metadata.
 * @param {Object} params
 * @param {string} params.name - Display name
 * @param {Blob} params.blob - Normalized PNG blob
 * @param {string} params.thumbnail - Small data URL preview for the picker
 * @param {string} [params.type='image/png'] - MIME type of the stored blob
 * @returns {Promise<Object>} The created registry entry
 */
export async function addCustomIcon({ name, blob, thumbnail, type = 'image/png' }) {
    await ensureLoaded();
    const id = generateUUID();
    await saveImageCompat(id, blob);

    const entry = { id, name: name || 'Ícone', thumbnail, type, createdAt: Date.now() };
    const next = [...registry, entry];
    try {
        await setSettingCompat(SETTING_KEY, next);
    } catch (error) {
        // Roll back the orphaned blob so storage and the in-memory registry
        // stay consistent if the registry commit fails.
        await deleteImageCompat(id).catch(() => {});
        throw error;
    }
    registry = next;
    return entry;
}

/**
 * Remove a custom icon from the registry and delete its blob.
 * @param {string} id - Icon id
 * @returns {Promise<void>}
 */
export async function removeCustomIcon(id) {
    await ensureLoaded();
    registry = registry.filter((entry) => entry.id !== id);
    await setSettingCompat(SETTING_KEY, registry);
    await deleteImageCompat(id);
}

/**
 * Get the stored blob for a custom icon (used by the map renderer).
 * @param {string} id - Icon id
 * @returns {Promise<Blob|null>}
 */
export async function getCustomIconBlob(id) {
    return getImageCompat(id);
}

/**
 * Snapshot of the registry for export. Loads it if needed.
 * @returns {Promise<Array>}
 */
export async function getCustomIconsForExport() {
    return [...(await ensureLoaded())];
}

/**
 * Restore custom icon metadata on project import. Blobs are restored separately
 * from the archive's `images/` folder.
 * @param {Array} entries - Registry entries from the imported project
 * @param {Object} [options]
 * @param {boolean} [options.replace=false] - Replace the registry (non-additive import) vs merge (additive)
 * @returns {Promise<void>}
 */
export async function restoreCustomIconsFromImport(entries, { replace = false } = {}) {
    subscribeToDataCleared();
    const incoming = Array.isArray(entries) ? entries.filter((e) => e && e.id) : [];

    if (replace) {
        registry = incoming;
    } else {
        await ensureLoaded();
        const byId = new Map(registry.map((e) => [e.id, e]));
        for (const entry of incoming) {
            if (!byId.has(entry.id)) byId.set(entry.id, entry);
        }
        registry = Array.from(byId.values());
    }

    await setSettingCompat(SETTING_KEY, registry);
}

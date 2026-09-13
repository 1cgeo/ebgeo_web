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
import { uploadImageBlob, fetchImageBlob } from './sync/image-sync.js';
import { OperationType } from './sync/operation-dispatcher.js';
// Leaf module (zero imports): the vocabulary, not the barrel.
import { EntityType } from './sync/operation-types.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { runTransaction } from './store-transaction.js';
import { resolveAtlasSettingId } from './atlas-setting-target.js';

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
 * Invalidate the in-memory registry cache so the next access reloads from storage.
 * Used by the remote sync handler (datamodel-14) after it writes a synced
 * `custom_icons` list to storage, so getCustomIcons() returns the synced value
 * instead of a stale cache. Mirrors the ALL_DATA_CLEARED reset.
 */
export function invalidateCustomIconsCache() {
    registry = null;
    loadPromise = null;
}

/**
 * Add a custom icon: store its blob and register its metadata.
 *
 * ONLY THE REGISTRY WRITE IS INSIDE THE TRANSACTION, and the split is the whole design. The
 * upload and the local blob are NOT reversible by the journal: an op describes the registry
 * list, never the bytes, so there is nothing for a replay to redo and nothing for a rollback to
 * undo. They run before, in the open, and the only recovery they get is the manual one below.
 *
 * @param {Object} params
 * @param {string} params.name - Display name
 * @param {Blob} params.blob - Normalized PNG blob
 * @param {string} params.thumbnail - Small data URL preview for the picker
 * @param {string} [params.type='image/png'] - MIME type of the stored blob
 * @returns {Promise<Object|null>} The created registry entry, or null when the atlas
 *   permission refuses the write (a blocked operation, not an error)
 */
export async function addCustomIcon({ name, blob, thumbnail, type = 'image/png' }) {
    // The tail enqueues an `atlas.settings.customIcons` op, refused by the server from a reader,
    // and a refused op stalls the outbound queue. Gate FIRST, before the upload: without this
    // the blob would already be on the server by the time the registry write is refused.
    const perm = checkPermission(GuardAction.UPDATE_ATLAS_SETTINGS);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'addCustomIcon',
            reason: perm.reason,
            required: perm.required
        });
        return null;
    }

    await ensureLoaded();
    // §17.19: the icon id is MINTED HERE and no longer depends on the upload landing.
    //
    // It used to be the id the server minted, with a local UUID as the fallback on failure, and
    // the comment here promised a reconciliation "on a later sync" that existed nowhere: the icon
    // drew for its author and a collaborator asking the server for that id got a 404 forever. The
    // blob now travels through the durable queue (`sync/blob-upload-queue.js`), which registers
    // the pendency before the first byte leaves and sends by the bulk route, the only one that
    // keeps the id — so the same id is valid whether the transfer lands now or after a
    // reconnection.
    //
    // THE REGISTRY OP IS NOT HELD BY THE BLOB, and the asymmetry with the image FEATURE is
    // deliberate. The feature's operation carries the id of its own blob, so holding it holds
    // exactly what is incomplete; the icon travels as one `atlas.settings.customIcons` operation
    // that carries the WHOLE list, and holding it would stall the outbound queue of the atlas for
    // every other icon and setting too. An icon whose bytes are still pending draws for its
    // author and falls back to the placeholder on the peer, which is degraded and not corrupting.
    const id = generateUUID();
    await saveImageCompat(id, blob);
    await uploadImageBlob(blob, id, { origem: 'icone-personalizado' });

    const entry = { id, name: name || 'Ícone', thumbnail, type, createdAt: Date.now() };
    const previous = [...registry];
    const next = [...registry, entry];
    try {
        await runTransaction(async (tx) => {
            // datamodel-14: the icon REGISTRY (the metadata list) travels to the atlas as one
            // `setting` op, journaled BEFORE the local key is written; the blobs travel apart,
            // through the images endpoint. The backend replaces atlas.settings.customIcons
            // wholesale with this full list.
            tx.recordOperation(EntityType.SETTING, OperationType.UPDATE,
                await resolveAtlasSettingId(tx.scope), null,
                { customIcons: next }, { customIcons: previous });
            // The module cache only moves after the key is on disk: a registry in memory that
            // the disk does not have makes the picker offer an icon that dies at the next F5.
            tx.deferSync(() => { registry = next; });
            return () => setSettingCompat(SETTING_KEY, next);
        });
    } catch (error) {
        // Roll back the orphaned blob so storage and the in-memory registry stay consistent when
        // the registry write (or its journal) fails. It runs HERE, outside the transaction, and
        // not in a deferred effect: `runTransaction` only defers what happens AFTER a successful
        // persistence, so a failure has no hook of its own, and this is the compensation for the
        // two steps that ran before the transaction began.
        await deleteImageCompat(id).catch(() => {});
        throw error;
    }
    return entry;
}

/**
 * Get the stored blob for a custom icon (used by the map renderer).
 * @param {string} id - Icon id
 * @returns {Promise<Blob|null>}
 */
export async function getCustomIconBlob(id) {
    const local = await getImageCompat(id);
    if (local) return local;
    // §17.19: a collaborator may reference an icon uploaded by someone else that is
    // not cached locally — fetch it from the backend by id and cache it for next time.
    const remote = await fetchImageBlob(id);
    if (remote) {
        await saveImageCompat(id, remote).catch(() => {});
    }
    return remote;
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

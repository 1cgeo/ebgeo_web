// Path: js/account/open-atlas.service.js

/**
 * @fileoverview Shared "open a remote atlas" flow. Opening (or switching to) a server atlas replaces
 * the local store and connects: warn if there is unsaved local work, close any previous socket, wipe
 * local, mark the origin REMOTE (durable intent before the snapshot pull), connect + initial-pull,
 * activate the atlas map, and resume auto-flush. Used by the URL deep-link boot path and the
 * post-login resume; the project picker keeps its own wrapper (with success toast) but the steps match.
 *
 * The address-bar `?atlas=&map=` is kept in sync REACTIVELY (atlas-url-sync.js, on connection/map
 * events) — NOT here — so every open path (picker, URL, resume, reconnect) updates the URL uniformly.
 */

import { syncEngine } from '@store/sync/sync-engine.js';
import { startAutoFlush, stopAutoFlush } from '@store/sync/sync-flush.js';
import {
    clearAllDataStore,
    markStoreRemote,
    markStoreLocal,
    isRemoteStoreSync,
    hasAnyMapFeatures,
    activateAtlasInitialMap,
} from '@store/store.js';
import { showConfirm } from '@modals/confirm.modal.js';

/**
 * Opens a remote atlas, optionally landing on a specific map.
 *
 * Replaces the local store, so it first warns (download `.ebgeo`) when the current store is the user's
 * own LOCAL workspace with unsaved work — the same guard the project picker enforces. If the user
 * declines, nothing is wiped and it returns false.
 *
 * @param {string} atlasId - Atlas UUID.
 * @param {{ mapId?: string|null }} [options] - mapId: a specific map UUID to activate (else initial/last).
 * @returns {Promise<boolean>} true when the atlas was opened; false when the user cancelled the
 *   "replace local work" confirmation.
 * @throws Propagates a connect/permission error (e.g. 403/404) so callers can message the user; on
 *   such a failure the durable origin is reverted to LOCAL so a reload does not retry the dead atlas.
 */
export async function openRemoteAtlas(atlasId, { mapId = null } = {}) {
    // Opening a remote atlas REPLACES the local store. If the current store is the user's own LOCAL
    // workspace with work in it, warn before wiping — mirrors openProjectPicker's inv-6 guard so the
    // deep-link boot + post-login resume paths can't destroy unsaved local work silently.
    if (!isRemoteStoreSync() && await hasAnyMapFeatures()) {
        const proceed = await showConfirm(
            'Abrir um projeto do servidor vai substituir os dados locais atuais. Se quiser guardá-los, baixe um arquivo .ebgeo antes. Deseja continuar?',
            { destructive: true, confirmText: 'Continuar' },
        );
        if (!proceed) return false;
    }

    // Switching atlases: close any previous server connection first (one socket per atlas — the
    // server has no "switch"), then wipe local + connect the new one.
    if (syncEngine.atlasId) {
        stopAutoFlush();
        syncEngine.disconnect();
    }
    await clearAllDataStore();
    // Mark REMOTE before connecting (durable intent): if the tab dies mid-pull, the boot guard sees
    // 'remote' and discards the partial data instead of mislabeling it as a permanent local atlas.
    await markStoreRemote(atlasId);
    try {
        await syncEngine.connect(atlasId, { initialPull: true });
        // Land on the atlas's map (the requested one when given), not the local default.
        await activateAtlasInitialMap(mapId);
    } catch (error) {
        // Connect failed (e.g. 403/404 or a backend hiccup): the local store is already blank and the
        // origin is durably 'remote' pointing at an atlas we cannot open. Revert the origin to LOCAL
        // so the boot reconnect (which reads the origin) does not keep retrying the dead atlas on F5.
        await markStoreLocal();
        throw error;
    }
    startAutoFlush();
    return true;
}

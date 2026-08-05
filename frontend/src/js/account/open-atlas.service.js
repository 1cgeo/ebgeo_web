// Path: js/account/open-atlas.service.js

/**
 * @fileoverview Shared "open a remote atlas" flow. Opening (or switching to) a server atlas replaces
 * the local store and connects: resolve what happens to unsaved local work, close any previous
 * socket, wipe local, mark the origin REMOTE (durable intent before the snapshot pull), connect +
 * initial-pull, activate the atlas map, and resume auto-flush.
 *
 * This is the SINGLE place the local-work guard lives. It used to be duplicated in
 * `AccountControl.openProjectPicker`, which fired it when the picker OPENED — i.e. right after every
 * login, before the user had chosen anything, warning about a replacement that might never happen.
 * The guard belongs to the act, not to the browsing.
 *
 * The address-bar `?atlas=&map=` is kept in sync REACTIVELY (atlas-url-sync.js, on connection/map
 * events) — NOT here — so every open path (picker, URL, resume, reconnect) updates the URL uniformly.
 */

import { syncEngine } from '@store/sync/sync-engine.js';
import { getControl } from '@store';
import { apiClient } from '@store/sync/api-client.js';
import { startAutoFlush, stopAutoFlush } from '@store/sync/sync-flush.js';
import {
    clearAllDataStore,
    markStoreRemote,
    markStoreLocal,
    isRemoteStoreSync,
    hasAnyMapFeatures,
    activateAtlasInitialMap,
} from '@store/store.js';
import { showChoice } from '@modals/confirm.modal.js';
import { showPrompt } from '@modals/prompt.modal.js';
import { saveLocalAtlasToServer } from '@js/import_export/save-local-atlas.service.js';
import { showSuccess, showError } from '@utils/toast_service.js';

/** Default name offered when saving the local workspace before opening something else. */
function defaultLocalAtlasName() {
    return `Trabalho local — ${new Date().toLocaleDateString('pt-BR')}`;
}

/**
 * Uploads the current LOCAL store as a NEW server atlas, so it survives being replaced. Asks for a
 * name (pre-filled with today's date) — the user is about to lose sight of this data, and an
 * auto-generated name would make it unfindable in the project list later.
 * @returns {Promise<boolean>} true when the work is safely on the server; false if the user backed
 *   out of the name prompt or the upload failed (in which case NOTHING must be wiped).
 */
async function saveLocalWorkToServer() {
    const exportService = getControl('exportImport');
    if (!exportService) {
        showError('Serviço de exportação indisponível — não foi possível salvar o trabalho local.');
        return false;
    }
    const name = await showPrompt('Salvar o trabalho local como', defaultLocalAtlasName());
    if (name == null || !name.trim()) return false;
    try {
        const { stats, imageStats } = await saveLocalAtlasToServer(apiClient, exportService, { name: name.trim() });
        const lost = (imageStats.skipped || 0) + (imageStats.failed || 0);
        showSuccess(
            `Trabalho local salvo como "${name.trim()}" (${stats.maps} mapa(s), ${stats.features} feição(ões))`
            + (lost > 0 ? ` — ${lost} imagem(ns) não enviada(s)` : '')
        );
        return true;
    } catch (error) {
        console.error('[openRemoteAtlas] saving local work failed:', error);
        showError('Falha ao salvar o trabalho local. Nada foi substituído.');
        return false;
    }
}

/**
 * Opens a remote atlas, optionally landing on a specific map.
 *
 * Replaces the local store, so when the current store is the user's own LOCAL workspace with unsaved
 * work it first asks what to do with it: cancel, save it to the server first, or discard it. If the
 * user cancels (or the save fails), nothing is wiped and it returns false.
 *
 * @param {string} atlasId - Atlas UUID.
 * @param {{ mapId?: string|null }} [options] - mapId: a specific map UUID to activate (else initial/last).
 * @returns {Promise<boolean>} true when the atlas was opened; false when the user declined to
 *   replace the local work.
 * @throws Propagates a connect/permission error (e.g. 403/404) so callers can message the user; on
 *   such a failure the durable origin is reverted to LOCAL so a reload does not retry the dead atlas.
 */
export async function openRemoteAtlas(atlasId, { mapId = null } = {}) {
    // Opening a remote atlas REPLACES the local store. When that store is the user's own LOCAL
    // workspace with work in it, the honest answer set has three members — a two-button confirm
    // would hide the one people actually want ("keep it AND open the project").
    if (!isRemoteStoreSync() && await hasAnyMapFeatures()) {
        const choice = await showChoice('Você tem trabalho local não salvo', {
            message: 'Abrir este projeto do servidor substitui os dados que estão abertos agora.',
            choices: [
                { id: 'cancel', label: 'Cancelar', variant: 'ghost' },
                { id: 'save', label: 'Salvar e continuar', variant: 'primary' },
                { id: 'discard', label: 'Descartar e abrir', variant: 'danger' },
            ],
        });
        // Dismissing (Esc/backdrop) resolves null and must behave exactly like Cancelar.
        if (choice !== 'save' && choice !== 'discard') return false;
        if (choice === 'save' && !(await saveLocalWorkToServer())) return false;
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
    // Render the now-current atlas map (base layer + feature sources + client-generated rasters). The
    // open path sets the current map but, unlike a UI map switch, never ran setupMapFeatures for it —
    // so military-symbol/coordination/declination rasters intermittently 404'd → error icon. After the
    // try/catch so a render error can't revert the (successfully opened) atlas origin.
    await getControl('BaseLayerControl')?.switchMap?.(false);
    startAutoFlush();
    return true;
}

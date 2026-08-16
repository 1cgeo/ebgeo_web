// Path: js/deep-link/pending-import.js

/**
 * @module deep-link/pending-import
 * @description The map's half of "Abrir arquivo .ebgeo": consume the archive that `projetos.html`
 * left in the global database, or decline and hand the boot back to the ordinary routing chain.
 *
 * IT LIVES HERE, out of `index.js`, for the reason `route-decision.js` states about its own rule:
 * `index.js` calls `initApp()` at import time, so nothing inside it can be exercised by a test. And
 * this one has a property worth a guard that no eye catches on review — the hand-over is REMOVED
 * from the global database on every path, the failed import included. The global database is the
 * one no wipe in this codebase reaches (`atlas-namespace.js`, `GlobalKey.PENDING_IMPORT`), so a
 * record kept "until the import succeeds" is megabytes surviving forever and re-failing on every
 * reload. One attempt is the right number: the user still has the file on disk.
 *
 * The effects the map owns (the importer control and the toast) arrive as arguments; the reading
 * and the erasing do not, and that is deliberate — they ARE the subject, and injecting
 * `takePendingImport` would let this pass against a producer that never erases.
 */

import { getActiveScope, takePendingImport, StoreScopeKind } from '@store/atlas-namespace.js';

/**
 * Imports the `.ebgeo` that "Seus atlas" left in the global database, if there is one.
 *
 * THE PAGE CANNOT IMPORT, AND THE MAP CANNOT CHOOSE. `projetos.html` has no store and no importer
 * (loading either is what makes it a ~140 kB page instead of a 3,3 MB one), so it creates the local
 * slot, points at it, parks the bytes under `GlobalKey.PENDING_IMPORT` and navigates. This is the
 * other half. The importer is the one that already exists — nothing about the archive is parsed
 * twice.
 *
 * AND IT REFUSES MORE THAN IT ACCEPTS, because a non-additive import REPLACES the atlas it lands
 * in. It runs only into the LOCAL slot the page created for this very file; a deep link, a remote
 * scope, or a tab that ended up somewhere else all decline, say so, and leave the boot to the
 * ordinary chain. Whatever the branch, the record is already gone by then.
 *
 * @param {Object} options
 * @param {boolean} options.hasDeepLink - Whether the URL names a server atlas (`?atlas` /
 *   `?atlasPublico`).
 * @param {() => ({processFileDirectly: Function}|null|undefined)} options.getImporter - Resolves the
 *   import/export service. A function, not the service: the control registry is only populated once
 *   the map's controls exist.
 * @param {(message: string, level: string) => void} options.notify - Toast sink.
 * @returns {Promise<boolean>} True when this boot WAS the import (the routing chain must not run).
 */
export async function consumePendingEbgeoImport({ hasDeepLink, getImporter, notify }) {
    let pending = null;
    try {
        pending = await takePendingImport();
    } catch (error) {
        console.warn('[boot] reading the pending .ebgeo failed:', error);
        return false;
    }
    if (!pending) return false;

    const scope = getActiveScope();
    const landed = scope?.kind === StoreScopeKind.LOCAL && scope.atlasId === pending.atlasId;
    if (hasDeepLink || !landed) {
        notify(
            'O arquivo .ebgeo escolhido em "Seus atlas" não foi aberto porque esta aba entrou em '
            + 'outro projeto. Escolha o arquivo novamente.',
            'warning'
        );
        return false;
    }

    const service = getImporter();
    if (!service) {
        notify('Não foi possível abrir o arquivo .ebgeo escolhido em "Seus atlas".', 'error');
        return false;
    }
    try {
        // Rebuilt as a `File` with its name: the importer derives the atlas name from it on the
        // path that leaves a server atlas, and a bare Blob would arrive there nameless.
        await service.processFileDirectly(new File([pending.data], `${pending.name}.ebgeo`), false);
    } catch (error) {
        // `handleImport` reports its own failures; this covers the ones it cannot (a File the
        // browser refuses to build, a service that throws before it starts).
        console.error('[boot] pending .ebgeo import failed:', error);
        notify('Não foi possível abrir o arquivo .ebgeo.', 'error');
    }
    return true;
}

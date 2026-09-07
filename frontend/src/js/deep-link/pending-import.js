// Path: js/deep-link/pending-import.js

/**
 * @module deep-link/pending-import
 * @description The map's half of "Abrir arquivo .ebgeo": consume the archive that `atlas.html`
 * left in the global database, or decline and hand the boot back to the ordinary routing chain.
 *
 * IT LIVES HERE, out of `index.js`, for the reason `route-decision.js` states about its own rule:
 * `index.js` calls `initApp()` at import time, so nothing inside it can be exercised by a test. And
 * this one has a property worth a guard that no eye catches on review — the hand-over is REMOVED
 * from the global database on every path this function returns through, the failed import included.
 * The global database is the one no wipe in this codebase reaches (`atlas-namespace.js`,
 * `GlobalKey.PENDING_IMPORT`), so a record kept "until the import succeeds" is megabytes surviving
 * forever and re-failing on every reload. One attempt is the right number: the user still has the
 * file on disk. The single exception is a record addressed to ANOTHER tab, which this boot never
 * touches and never reads the bytes of (`PendingImportOutcome.OTHER_TAB`).
 *
 * AND EVERY LOSS IS SAID OUT LOUD, since 2026-08-17. `takePendingImport` used to answer four
 * different questions with one `null` — nothing was there, the record was from another deploy, it
 * had expired, it is somebody else's — and only the first is ordinary. The other three are a file
 * the user chose and did not get, and they went by in silence: the boot fell through to the routing
 * chain, landed the tab on some atlas, and never mentioned the file. The outcome is now named, and
 * the two that mean "your file is gone" get a sentence.
 *
 * The effects the map owns (the importer control, the toast, and the creation of the atlas) arrive
 * as arguments; the reading and the erasing do not, and that is deliberate — they ARE the subject,
 * and injecting `takePendingImport` would let this pass against a producer that never erases.
 * `createAtlas` is injected for a second reason on top of that one: the pipeline behind it
 * (`account/open-atlas.service.js`) imports the whole store, and this module is unit-tested in bare
 * node against a doubled `localforage`.
 */

import { takePendingImport, PendingImportOutcome } from '@store/atlas-namespace.js';

/** Said when a `?atlas=` deep link wins over the file. */
const RECUSA_DEEP_LINK = 'O arquivo .ebgeo escolhido em "Seus atlas" não foi aberto porque esta '
    + 'aba abriu outro atlas. Escolha o arquivo novamente.';

/**
 * Said when the hand-over was found but could not be used: it expired (the tab that asked for it
 * never came back within the day), or it was written by another version of the app.
 *
 * IT DOES NOT EXPLAIN WHICH, on purpose. The two causes are the same event for the person reading
 * it — the file did not open — and the only useful half of the sentence is the instruction. The
 * distinction is in the console-free path above and in `PendingImportOutcome`, for whoever is
 * reading the code.
 */
const RECUSA_ENTREGA_PERDIDA = 'O arquivo .ebgeo escolhido em "Seus atlas" não chegou a ser '
    + 'aberto. Escolha o arquivo novamente.';

/** Said when the map booted without its import/export control. */
const RECUSA_SEM_IMPORTADOR = 'Não foi possível abrir o arquivo .ebgeo escolhido em "Seus atlas".';

/** Last-resort text for a creation that failed without a sentence of its own. */
const RECUSA_SEM_SLOT = 'Não foi possível criar um atlas local para este arquivo .ebgeo.';

/**
 * Reads the archive far enough to know whether this build can import it, and says why when it
 * cannot.
 *
 * BY `import()`, and it matters here more than anywhere else in this module: the gate carries
 * JSZip, and this file is imported by `index.js`, i.e. it is on the boot path of EVERY page load
 * of the map. Loading a zip library into that path for the rare boot that carries a file would pay
 * on every other boot. The dynamic import is resolved only when a hand-over actually exists.
 *
 * THE ARCHIVE IS OPENED TWICE on this path (here, and again by the importer). That is the price of
 * deciding before spending one of the ten slots, and it is paid on a file the person just chose.
 * The alternative was a second copy of the reader, which is the one thing that must not exist: the
 * gate module is the same one `export-import.service.js` reads through.
 *
 * THE SENTENCE OF A BROKEN FILE IS THE IMPORTER'S OWN, prefix included, so that refusing earlier
 * does not also mean saying it differently.
 *
 * @param {File} file - The `.ebgeo` rebuilt from the hand-over.
 * @returns {Promise<string|null>} The pt-BR refusal, or null when the file may be imported.
 */
async function refusalForFile(file) {
    try {
        const { readEbgeoArchive, importVersionRefusal } =
            await import('@js/import_export/ebgeo-file-gate.js');
        const { data } = await readEbgeoArchive(file);
        return importVersionRefusal(data);
    } catch (error) {
        console.warn('[boot] the pending .ebgeo could not be read:', error);
        return `Erro ao carregar o arquivo: ${error.message}`;
    }
}

/**
 * Imports the `.ebgeo` that "Seus atlas" left in the global database, if there is one.
 *
 * THE PAGE CANNOT IMPORT, AND THE PAGE MUST NOT SPEND A SLOT. `atlas.html` has no store and no
 * importer (loading either is what makes it a ~140 kB page instead of a 3,3 MB one), so it parks
 * the bytes under `GlobalKey.PENDING_IMPORT` and navigates. This is the other half. The importer is
 * the one that already exists — nothing about the archive is parsed twice.
 *
 * THE ATLAS IS CREATED HERE, AND THAT IS THE WHOLE ORDERING DECISION. Until 2026-08-16 the page
 * created the local slot before navigating, and every branch below that DECLINES left it behind:
 * not empty either, because the store boot writes a blank `Principal` into whatever scope is
 * mounted before this function is ever reached, so no "delete it if it is empty" guard could ever
 * fire. Deleting it from here is worse still — with two tabs, the tab that declines is not the tab
 * that owns the slot, and `deleteLocalAtlas` announces a teardown that freezes the owner. Creating
 * the slot at the last possible moment removes the orphan instead of cleaning up after it, and it
 * reuses the pipeline that already owns "which atlas this tab holds" (`switchToNewLocalAtlas`),
 * which is also what makes importing over an open SERVER atlas safe: it disconnects, mounts the new
 * slot and wipes THAT one.
 *
 * SO THE STEPS ARE ORDERED BY WHAT THEY COST. Reading and erasing the hand-over first (it is the
 * one thing that must happen on every path that reads the bytes); then the outcomes that are not an
 * import at all (somebody else's file, a lost one); then the two refusals that cost nothing (a deep
 * link, a missing importer); then the FILE ITSELF, judged by the version gate; and the creation
 * LAST, because it is the only step that consumes one of the ten local slots. A refused creation
 * (the cap) imports nothing and says why.
 *
 * THE GATE WAS THE STEP MISSING FROM THAT ORDER until 2026-09-07, and its absence had a price the
 * ordering above was written to avoid: the importer parses and refuses (a file from a newer build,
 * a corrupt archive, a `data.json` that is not there), but it only ran AFTER the creation, so every
 * refusal left behind an empty atlas named after the file, the person standing inside it, and one
 * of the ten slots spent on an import that never happened. Ten tries and no atlas can be created at
 * all. See {@link refusalForFile}, and `tests/unit/import-recusado-nao-gasta-vaga.test.js`, which
 * counts the registry before and after with the real creator.
 *
 * @param {Object} options
 * @param {boolean} options.hasDeepLink - Whether the URL names a server atlas (`?atlas` /
 *   `?atlasPublico`). A file must never be imported into one.
 * @param {() => ({processFileDirectly: Function}|null|undefined)} options.getImporter - Resolves the
 *   import/export service. A function, not the service: the control registry is only populated once
 *   the map's controls exist.
 * @param {(name: string) => Promise<{ok: boolean, message?: string, atlas?: Object}>}
 *   options.createAtlas - Creates the local atlas this file will land in AND leaves the store
 *   mounted on it. `switchToNewLocalAtlas` in production.
 * @param {(message: string, level: string) => void} options.notify - Toast sink.
 * @returns {Promise<boolean>} True when this boot WAS the import (the routing chain must not run).
 */
export async function consumePendingEbgeoImport({ hasDeepLink, getImporter, createAtlas, notify }) {
    let outcome = PendingImportOutcome.NONE;
    let pending = null;
    try {
        ({ outcome, record: pending } = await takePendingImport());
    } catch (error) {
        console.warn('[boot] reading the pending .ebgeo failed:', error);
        return false;
    }

    // A file that another tab is coming for. This boot never saw its bytes and must not report on
    // it: the tab it belongs to is about to, and two toasts for one file is one too many.
    if (outcome === PendingImportOutcome.OTHER_TAB) return false;
    if (outcome === PendingImportOutcome.STALE || outcome === PendingImportOutcome.UNREADABLE) {
        notify(RECUSA_ENTREGA_PERDIDA, 'warning');
        return false;
    }
    if (outcome !== PendingImportOutcome.TAKEN || !pending) return false;

    if (hasDeepLink) {
        notify(RECUSA_DEEP_LINK, 'warning');
        return false;
    }

    // BEFORE the creation, deliberately: a slot spent on a boot that cannot import is the orphan
    // this whole shape exists to prevent.
    const service = getImporter();
    if (!service) {
        notify(RECUSA_SEM_IMPORTADOR, 'error');
        return false;
    }

    // O ARQUIVO É JULGADO ANTES DE O ATLAS EXISTIR, e esta é a etapa que faltava. O importador
    // parseia e recusa (versão de uma build mais nova, zip corrompido, `data.json` ausente), mas
    // ele só é chamado DEPOIS da criação, então cada recusa deixava para trás um atlas vazio com o
    // nome do arquivo, a pessoa dentro dele, e uma das dez vagas gasta por um import que não
    // aconteceu. O `@fileoverview` já dizia que a criação vem por último "porque é o único passo
    // que consome uma vaga"; faltava-lhe alguém decidindo antes.
    const arquivo = new File([pending.data], `${pending.name}.ebgeo`);
    const recusa = await refusalForFile(arquivo);
    if (recusa) {
        notify(recusa, 'error');
        return false;
    }

    let created;
    try {
        created = await createAtlas(pending.name);
    } catch (error) {
        // A persistence failure inside the switch (mount or wipe). The boot goes back to the
        // ordinary chain, which lands the tab on a local map rather than on a half-mounted one.
        console.error('[boot] creating the local atlas for the pending .ebgeo failed:', error);
        notify(RECUSA_SEM_SLOT, 'error');
        return false;
    }
    if (!created?.ok) {
        // The cap of ten. It carries its own pt-BR sentence, written next to the rule that refused.
        notify(created?.message || RECUSA_SEM_SLOT, 'error');
        return false;
    }

    try {
        // O MESMO `File` que passou pelo portão, com o nome: o importador deriva o nome do atlas
        // dele no caminho que sai de um atlas de servidor, e um Blob nu chegaria lá sem nome.
        await service.processFileDirectly(arquivo, false);
    } catch (error) {
        // `handleImport` reports its own failures; this covers the ones it cannot (a File the
        // browser refuses to build, a service that throws before it starts).
        console.error('[boot] pending .ebgeo import failed:', error);
        notify('Não foi possível abrir o arquivo .ebgeo.', 'error');
    }
    return true;
}

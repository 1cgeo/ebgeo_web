// Path: js/session/unsynced-work-exit.js

/**
 * @fileoverview Leaving the account without destroying work the server never received.
 *
 * WHAT MOVED HERE, AND WHY. The rescue (`preserveUnsyncedWorkAsLocal`) and the preserve/wipe
 * decision (`shouldPreserveLocalWork`) were written inside `account/account.control.js`, which is a
 * MapLibre `IControl` and therefore exists only on the map page. The session also ends on
 * `atlas.html` and on `admin.html` (their `endSession`, reached from the app bar's "Sair" and from
 * the idle watch), and there the only thing that happened was `apiClient.logout()` plus a
 * navigation: the destruction was deferred to the next boot's logged-out guard, which is precisely
 * the sweep that deletes the namespace holding the unsent operations. Those two pages cannot import
 * the account control (it would drag the store barrel and MapLibre into a page that boots neither),
 * so the mechanism moved down here, next to `idle-watch.js`, which those pages already import.
 * `account.control.js` re-exports the three public symbols, so its own call sites and the tests
 * that address them are unchanged.
 *
 * THE IMPORTS ARE BY FILE, NEVER BY BARREL, and that is what keeps this module usable from a page
 * without a map: `@store/store-origin.js`, `@store/local-atlas.api.js`, `@store/remote-atlas.api.js`
 * and `@store/atlas-namespace.js` are leaves that `projects-page.js` already reaches. Importing
 * `@store/store.js` here would undo the whole point.
 *
 * NOBODY IS ASKED ANY MORE, AND THAT IS A PRODUCT DECISION (2026-08-23). This module used to carry
 * a second entry point, `guardUnsyncedWorkOnExit`, which counted the queue and opened a three-way
 * dialog for the VOLUNTARY exit. The owner refused the question with the argument that decides the
 * design: sync always runs, so the queue only holds something when it FAILED to go up, never
 * because somebody chose not to send it. There being no intent to respect, the voluntary exit now
 * does what the involuntary one always did (rescue in silence and inform), the guard and its dialog
 * were removed rather than left unreferenced, and with them went the import of
 * `@modals/confirm.modal.js` — which is a second, structural gain, since this module is reached
 * from two pages that boot no modal system at all.
 *
 * WHAT SURVIVES OF THE TEARDOWN SPLIT. `AccountControl._handleLogout` is still the primitive that
 * executes the teardown with the decision already made; what changed is that the decision no longer
 * comes from a human.
 */

import { markStoreLocal, loadStoreOrigin, StoreOriginKind } from '@store/store-origin.js';
import { adoptRemoteAtlasAsLocal } from '@store/local-atlas.api.js';
import {
    remoteScope,
    readLocalAtlasRegistry,
    getStoreFor,
    StoreName,
} from '@store/atlas-namespace.js';
import {
    retainRemoteAtlasForRescue,
    releaseRemoteAtlasRescueVeto,
    remoteAtlasRescueVetoSince,
    RESCUE_VETO_GRACE_MS,
} from '@store/remote-atlas.api.js';
import { operationQueue, operationBelongsToScope } from '@store/sync/operation-queue.js';
import {
    ExitOutcome,
    exitPreservedSummary,
    exitPreserveFailedNotice,
} from './unsynced-work-phrases.js';

/**
 * The outcome vocabulary, RE-EXPORTED from the pure module where it now lives.
 *
 * It moved because the map reads it off a query string and must key its sentences by the same
 * frozen object, and the map's phrase module has zero imports on purpose. The re-export keeps the
 * two pages that already import it from here working, and keeps this module the single address a
 * caller of the exit guard has to know.
 */
export { ExitOutcome };
// Re-exportado, e não importado de novo lá: `account.control.js` monta as MESMAS frases, e o prazo
// precisa vir da mesma constante que este módulo já usa. Um segundo caminho até
// `@store/remote-atlas.api.js` é o que faz duas cópias de um número divergirem.
export { RESCUE_VETO_GRACE_MS };

/**
 * Whether a teardown must PRESERVE the local data instead of wiping it.
 *
 * A logout the user CLICKED is a decision: the remote data goes, as it always did. A teardown the
 * user did not ask for (`handleSessionLost`, reached from a failed token refresh) is a network
 * accident, and wiping IndexedDB there turned a transient 429/5xx into the irreversible loss of
 * whatever had not yet been drained from the operation queue. Keeping data nobody asked to keep is
 * recoverable; deleting work is not.
 *
 * An UNKNOWN pending count (the queue read failed — NaN/undefined) preserves too: the whole point
 * is to not destroy on the strength of something that just went wrong.
 *
 * `chosePreserve` IS THE VOLUNTARY PATH, and it comes as its own field rather than as
 * `involuntary: true`. The two are different facts about the same teardown: one says nobody asked,
 * the other says the click path already decided to keep the work. Folding the second into the first
 * would have made the toast announce a session that "terminou" to a person who had just clicked
 * "Sair". (It no longer means "the user was asked": since 2026-08-23 nobody is asked, and the click
 * path sets it because it has ALREADY performed the rescue.)
 *
 * Pure — no I/O, no module state.
 * @param {Object} params
 * @param {boolean} [params.involuntary=false] - True when the session ended without a user gesture.
 * @param {number} [params.pendingOps=0] - Operations still queued for the server.
 * @param {boolean} [params.chosePreserve=false] - The click path already kept the work.
 * @returns {boolean}
 */
export function shouldPreserveLocalWork({
    involuntary = false,
    pendingOps = 0,
    chosePreserve = false,
} = {}) {
    if (chosePreserve) return true;
    if (!involuntary) return false;
    if (!Number.isFinite(pendingOps)) return true;
    return pendingOps > 0;
}

/**
 * Name the rescued atlas takes in the LOCAL registry.
 *
 * The atlas name is what the user recognises, so it is preferred; the dated fallback exists
 * because the cached name can be missing (a session lost before the atlas metadata was read),
 * and an atlas called "undefined" in the local list is a rescue the user cannot identify.
 *
 * Pure — no I/O, no module state.
 * @param {string|null|undefined} atlasName - Name of the server atlas, when known.
 * @returns {string} A non-empty pt-BR name.
 */
export function rescuedAtlasName(atlasName) {
    const trimmed = typeof atlasName === 'string' ? atlasName.trim() : '';
    if (trimmed.length > 0) return trimmed;
    return `Trabalho recuperado em ${new Date().toLocaleDateString('pt-BR')}`;
}

/**
 * THE RESCUE. Keeps the unsynced work of a session by moving its namespace from the REMOTE
 * registry to the LOCAL one, and only then marking the store LOCAL.
 *
 * WHY IT IS NOT JUST `markStoreLocal()` ANY MORE. It used to be, and that was correct while
 * local and remote data shared one set of databases: flipping the marker was enough to make the
 * boot guard keep the data. Every server atlas now owns a namespace (`atlas-namespace.js`
 * Decision 1) that `purgeAllRemoteAtlases` DELETES whenever nobody is authenticated, which is
 * precisely the state this path leaves the app in. Without the adoption the preserved work would
 * be erased by the very next boot, with the warning toast still promising it was kept.
 *
 * THE ORDER IS THE CONTRACT, and it is the adoption's own (see `adoptRemoteAtlasAsLocal`): the
 * local claim is written first, so a crash mid-flight leaves the namespace claimed by BOTH
 * registries, which the purge resolves in favour of the local one. Marking the store LOCAL last
 * is the same rule one level up: a marker that says LOCAL over a namespace no local atlas claims
 * is data the purge deletes while the boot guard believes it is safe.
 *
 * A failure to adopt is logged and swallowed on purpose: the caller is a logout, and throwing
 * here would abort the teardown (the lock retraction, the intent reset, the re-render) over a
 * rescue that has already failed.
 *
 * AND A FAILURE NO LONGER MEANS THE WORK DIES. Returning false stopped the toast from lying, and
 * that was only half of it: nobody claimed the namespace, so the next logged-out sweep destroyed
 * the only copy of work the server never received, and the user was accurately informed of a loss
 * instead of being deceived about it. Every exit that fails now VETOES that destruction
 * (`retainRemoteAtlasForRescue`), which keeps the namespace for a bounded time so the login the
 * error toast asks for still finds the work. The veto is recorded outside IndexedDB on purpose,
 * and its deadline is not optional; the reasoning for both is in `remote-atlas.api.js`.
 *
 * @param {string|null} atlasId - Server atlas whose namespace holds the work, or null when this
 *   tab had none mounted (then there is nothing to adopt and only the marker changes).
 * @param {string|null} [atlasName] - Display name of that atlas, for the local registry.
 * @returns {Promise<boolean>} True when the work is on record as a LOCAL atlas.
 */
export async function preserveUnsyncedWorkAsLocal(atlasId, atlasName = null) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) {
        // Nada de remoto montado, logo nada a resgatar: o estado final já é o correto e
        // nenhum trabalho está em risco. Marcar LOCAL aqui é o comportamento de sempre.
        await markStoreLocal();
        return true;
    }

    try {
        await adoptRemoteAtlasAsLocal(atlasId, rescuedAtlasName(atlasName));
    } catch (error) {
        // NÃO MARCA LOCAL, e é aqui que estava a perda. O catch existia e engolia; o
        // `markStoreLocal()` rodava logo abaixo, incondicional. O resultado era o pior
        // estado possível: o marcador dizia LOCAL sobre um namespace que NENHUM atlas local
        // reivindica, então a próxima varredura de deslogado o destruía — e o usuário já
        // tinha lido "suas alterações foram mantidas neste computador".
        //
        // Deixando o marcador em REMOTE, o namespace continua reivindicado pelo registro
        // remoto e o próximo boot ainda pode tentar de novo. Perder o trabalho é
        // irreversível; deixar dado remoto um boot a mais no disco não é.
        console.error('[unsynced-work] rescuing unsynced work as a local atlas failed:', error);
        return failedRescueKeepsNamespace(atlasId);
    }

    // READ-BACK, do DISCO, antes de declarar sucesso. `adoptRemoteAtlasAsLocal` não lançar
    // não é a mesma coisa que a entrada ter sido persistida: a escrita do registro pode ter
    // falhado por cota sem rejeitar de forma que este caminho perceba, e o espelho em memória
    // concordaria com o otimismo em vez de com o disco.
    const { dbSuffix } = remoteScope(atlasId);
    const adotado = (await readLocalAtlasRegistry()).some(e => e.dbSuffix === dbSuffix);
    if (!adotado) {
        console.error('[unsynced-work] rescue reported success but the slot is not on disk');
        return failedRescueKeepsNamespace(atlasId);
    }

    // The work IS a local atlas now, so the namespace is claimed by the local registry and the
    // sweep skips it on that account. A veto left over from an earlier failed attempt would only
    // add a second, weaker reason to keep databases that are no longer server data at all.
    releaseRemoteAtlasRescueVeto(atlasId);
    await markStoreLocal();
    return true;
}

/**
 * The one exit of a FAILED rescue: keep the namespace instead of letting the next sweep destroy
 * the only copy of unsent work, and always answer false.
 *
 * It exists as a function because the rescue fails in two different places (the adoption throwing,
 * and the read-back finding no slot on disk) and both have to take this exit. When they returned a
 * bare false, the second one was the easy one to forget, and forgetting it loses exactly the data
 * the read-back was added to protect.
 *
 * @param {string} atlasId - Server atlas whose namespace holds the unsynced work.
 * @returns {Promise<false>} Always false: the caller must not mark the store LOCAL nor tell the
 *   user the work was kept as a project. Retention buys time for a retry, it is not a rescue.
 */
async function failedRescueKeepsNamespace(atlasId) {
    if (!await retainRemoteAtlasForRescue(atlasId)) {
        // No storage to record the veto in, so the next logged-out sweep WILL destroy the work.
        // Said out loud because the alternative is the class this whole path exists to remove: a
        // guard that fails silently in the one moment it is needed.
        console.error(
            `[unsynced-work] the unsynced work of atlas ${atlasId} could not be protected `
            + 'from the next logged-out sweep'
        );
    }
    return false;
}

/**
 * Whether a rescue veto is on record for this atlas, which decides WHICH failure sentence the user
 * reads (see {@link exitPreserveFailedNotice}).
 * @param {string|null} atlasId
 * @returns {boolean}
 */
export function rescueVetoRecorded(atlasId) {
    return typeof atlasId === 'string' && remoteAtlasRescueVetoSince(atlasId) > 0;
}

/**
 * Reads the pending-operation count of the ACTIVE scope without ever throwing. NaN means
 * "unknown", which {@link shouldPreserveLocalWork} treats as a reason to act as if there were work.
 * @returns {Promise<number>}
 */
export async function countPendingOperations() {
    try {
        const count = await operationQueue.count();
        return Number.isFinite(count) ? count : NaN;
    } catch (error) {
        console.warn('[unsynced-work] pending operation count failed:', error);
        return NaN;
    }
}

/**
 * The key prefix the queue writes, MIRRORED from `operation-queue.js` (`KEY_PREFIX`), which does
 * not export it.
 *
 * A DRIFT HERE FAILS IN THE DANGEROUS DIRECTION, which is why the mirror is asserted rather than
 * trusted: a prefix that stops matching makes every count come back 0, and 0 is precisely the
 * answer that authorises the teardown without asking. The guard is in
 * `tests/unit/saida-voluntaria-trabalho-nao-enviado.test.js`, which reads the queue's own source.
 * @type {string}
 */
const QUEUE_KEY_PREFIX = 'op_';

/**
 * How many envelopes {@link countPendingOperationsFor} reads at the same time.
 *
 * It mirrors `COUNT_BATCH_SIZE` of `operation-queue.js` in intent, and it is a SEPARATE
 * constant rather than an import on purpose: importing a third symbol from the queue module
 * would break every test that doubles that module with a two-symbol factory, and a drift here
 * costs latency, never correctness. That is the opposite of {@link QUEUE_KEY_PREFIX}, whose
 * drift makes the count answer 0, which is why only that one is asserted against the source.
 * @type {number}
 */
const COUNT_BATCH_SIZE = 200;

/**
 * The pending-operation count of a NAMED server atlas, for a page that has no map and therefore no
 * remote scope mounted.
 *
 * IT READS, IT DOES NOT MOUNT, and that distinction is a gate this repository enforces:
 * `activateScope` has exactly four authorised owners (`tests/unit/portao-de-montagem.test.js`), and
 * this is not one of them. Pointing the factory at the atlas to reuse `operationQueue.count()` was
 * the first version and the gate refused it, correctly: mounting decides where every SUBSEQUENT
 * write lands, and a page that already has a local slot mounted would have had its next write
 * silently redirected if anything threw between the swap and the restore. `getStoreFor` addresses
 * one database without moving the pointer at all.
 *
 * The scope filter is the queue's OWN predicate (`operationBelongsToScope`), not a second rule: an
 * operation stamped for another address lives in the wrong database and must not be counted as
 * something this atlas would lose. IT READS THE VALUES, IT NEVER COUNTS THE KEYS, for the same
 * reason `operationQueue.count()` does: counting too much preserves work that was not at risk,
 * counting too little authorises the teardown that destroys it.
 *
 * The reads go out TOGETHER, in batches of {@link COUNT_BATCH_SIZE}, because this is the first
 * blocking step after the click on "Sair" and one round trip per operation is a wait paid for a
 * number. A rejection inside a batch aborts the whole count and lands in the `catch` below, which
 * answers NaN ("unknown") — and unknown preserves. Answering 0 there would authorise destruction.
 *
 * @param {string|null} atlasId - Server atlas UUID.
 * @returns {Promise<number>} The count, or NaN when it could not be measured.
 */
export async function countPendingOperationsFor(atlasId) {
    if (typeof atlasId !== 'string' || atlasId.length === 0) return NaN;
    try {
        const scope = remoteScope(atlasId);
        const store = getStoreFor(StoreName.OPERATION_QUEUE, scope);
        const keys = (await store.keys())
            .filter(key => typeof key === 'string' && key.startsWith(QUEUE_KEY_PREFIX));
        if (keys.length === 0) return 0;

        let total = 0;
        for (let i = 0; i < keys.length; i += COUNT_BATCH_SIZE) {
            const lote = keys.slice(i, i + COUNT_BATCH_SIZE);
            const envelopes = await Promise.all(lote.map(key => store.getItem(key)));
            for (const operation of envelopes) {
                if (operation && operationBelongsToScope(operation, scope.dbSuffix)) total += 1;
            }
        }
        return total;
    } catch (error) {
        console.warn('[unsynced-work] scoped pending operation count failed:', error);
        return NaN;
    }
}

/**
 * @typedef {Object} ExitGuardResult
 * @property {number} pendingOps - What was counted; NaN when it could not be measured.
 * @property {boolean} preserved - Whether the work is now on record as a LOCAL atlas.
 * @property {string} outcome - One of {@link ExitOutcome}. IT IS NOT DERIVABLE from `preserved`
 *   alone, and that is the whole reason it is here: "nothing was at stake" and "there was work and
 *   the rescue failed" both come back with `preserved: false`, and they are opposite facts.
 *   `message` distinguishes them for a caller that can show a toast; a page that NAVIGATES cannot
 *   (the toast dies with the document), so it needs a value it can put on the query string and
 *   have the destination rebuild the sentence from.
 * @property {string|null} atlasId - The server atlas the guard looked at.
 * @property {string|null} message - What to tell the user about what actually happened, or null
 *   when nothing was at stake. Delivered by the caller, because a page that navigates away cannot
 *   show a toast.
 *
 * THE FIELDS `proceed` AND `asked` WERE REMOVED with the dialog. The first was false only when the
 * user cancelled, and nobody is asked any more, so it was a constant `true` inviting call sites to
 * write a branch that can never run; the second answered a question that is never posed.
 */

/**
 * THE ONLY EXIT GUARD, for a caller that ends the session outside the map (`endSession` in
 * `projects/projects-page.js` and in `admin/admin-page.js`) and for every session that ends without
 * anybody asking: the idle watch expiring, or `setAuthLostHandler` firing after a refresh that
 * finally failed.
 *
 * IT NEVER ASKS. The name still says `OnLostSession` because that was the only path that reached it
 * until 2026-08-23, when the owner's decision made the voluntary exit behave identically (see the
 * fileoverview). It applies `shouldPreserveLocalWork` with `involuntary: true` and rescues in
 * silence: an unknown count preserves, zero does not, and the caller gets back a sentence to
 * deliver plus a code it can put on a URL.
 *
 * It exists because the alternative was telling each page to compose three calls
 * (`countPendingOperationsFor`, `shouldPreserveLocalWork`, `preserveUnsyncedWorkAsLocal`) in the
 * right order, and the one that is easy to drop is the last, which is the one that keeps the data.
 *
 * IT LOOKS AT THE MOUNTED SERVER ATLAS AND NOTHING ELSE, and the limit is worth stating: the
 * logged-out sweep destroys EVERY registered remote namespace on this machine, but the rescue
 * adopts ONE (a namespace can only be one local slot). So a queue left behind in a third atlas by
 * a tab that crashed is outside this guard's reach, and calling it does not promise otherwise.
 *
 * @param {Object} [params]
 * @param {string|null} [params.atlasId] - Server atlas to inspect; defaults to the origin marker,
 *   which is where a page without a map learns what the map tab had mounted.
 * @param {string|null} [params.atlasName]
 * @returns {Promise<ExitGuardResult>}
 */
export async function preserveUnsyncedWorkOnLostSession({ atlasId = null, atlasName = null } = {}) {
    const alvo = atlasId ?? await mountedRemoteAtlasFromDisk();
    const nada = {
        pendingOps: 0, preserved: false, outcome: ExitOutcome.NADA, atlasId: alvo, message: null,
    };
    if (!alvo) return nada;

    const pendingOps = await countPendingOperationsFor(alvo);
    if (!shouldPreserveLocalWork({ involuntary: true, pendingOps })) {
        return { ...nada, pendingOps };
    }

    const preserved = await preserveUnsyncedWorkAsLocal(alvo, atlasName);
    return {
        pendingOps,
        preserved,
        // O DESFECHO É O QUE VIAJA NA URL, então ele não pode ser deduzido de `preserved` no
        // destino: fila vazia e resgate que falhou chegam os dois como falso, e são o silêncio e o
        // alarme. Quem mediu a diferença é aqui, e é aqui que ela vira um valor.
        outcome: preserved ? ExitOutcome.GUARDADO : ExitOutcome.FALHOU,
        atlasId: alvo,
        message: preserved
            ? exitPreservedSummary(rescuedAtlasName(atlasName))
            : exitPreserveFailedNotice({ retained: rescueVetoRecorded(alvo), graceMs: RESCUE_VETO_GRACE_MS }),
    };
}

/**
 * The server atlas this installation has mounted, read from the persisted origin marker.
 *
 * A page without a map has no live sync engine to ask, and the marker is the only durable answer.
 * @returns {Promise<string|null>}
 */
async function mountedRemoteAtlasFromDisk() {
    try {
        const origin = await loadStoreOrigin();
        return origin?.kind === StoreOriginKind.REMOTE ? (origin.atlasId ?? null) : null;
    } catch (error) {
        console.warn('[unsynced-work] reading the store origin failed:', error);
        return null;
    }
}

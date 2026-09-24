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
 * Since 2026-09-12, voluntary logout is handled by `confirm-logout.js`: pending remote work is
 * discarded only after confirmation. This module still rescues involuntary session loss.
 */

import { markStoreLocal, loadStoreOrigin, StoreOriginKind } from '@store/store-origin.js';
import { adoptRemoteAtlasAsLocal, MAX_LOCAL_ATLASES } from '@store/local-atlas.api.js';
import {
    remoteScope,
    readLocalAtlasRegistry,
    getStoreFor,
    StoreName,
    ATLAS_RECORD_KEY,
    reconcileDurablePointers,
    getActiveScope,
    atlasMountLockName,
    hasMountLockSupport,
} from '@store/atlas-namespace.js';
import {
    retainRemoteAtlasForRescue,
    releaseRemoteAtlasRescueVeto,
    remoteAtlasRescueVetoSince,
    listRemoteAtlases,
    RESCUE_VETO_GRACE_MS,
} from '@store/remote-atlas.api.js';
import { operationQueue, operationBelongsToScope } from '@store/sync/operation-queue.js';
import {
    ExitOutcome,
    exitPreservedSummary,
    exitPreserveFailedNotice,
    otherAtlasesRescueNotice,
    OtherAtlasesOutcome,
} from './unsynced-work-phrases.js';
import { remoteWritesDiscarded } from '@store/remote-write-fence.js';
// Direto, nunca pelo barril `@utils`: esta folha é lida pelas páginas sem mapa.
import { otherClientHoldsLock } from '@utils/tab-lock.js';

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
 * `chosePreserve` forces preservation when a caller already chose a rescue. The voluntary
 * gesture no longer sets it: since 2026-09-12 it confirms and discards pending remote work.
 *
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
 *
 * IT SUMS THE THREE STATES, and must: what decides a rescue is everything the teardown would
 * destroy, not what the flush could still send. A refused operation, the work blocked behind it
 * and an intention whose projection is not materialized are all work the server never received,
 * and `count()` answers only the sendable share of that.
 * @returns {Promise<number>}
 */
export async function countPendingOperations() {
    try {
        const census = await operationQueue.countByState();
        const count = census.pendentes + census.preparadas + census.problemas;
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
 * The name a server atlas carries in its own namespace, read from disk without mounting anything.
 * @param {string} atlasId
 * @returns {Promise<string|null>} The name, or null when it cannot be read.
 */
async function atlasNameOnDisk(atlasId) {
    try {
        const scope = remoteScope(atlasId);
        // The generation pointer lives in `localStorage`; a lost pointer would read the atlas record
        // of no generation at all and answer "no name" for an atlas that has one.
        await reconcileDurablePointers(scope);
        const record = await getStoreFor(StoreName.ATLAS, scope).getItem(ATLAS_RECORD_KEY);
        const name = typeof record?.name === 'string' ? record.name.trim() : '';
        return name.length > 0 ? name : null;
    } catch (error) {
        console.warn('[unsynced-work] reading the name of a server atlas failed:', error);
        return null;
    }
}

/**
 * @typedef {Object} OtherAtlasesRescue
 * @property {Array<{atlasId: string, name: string}>} rescued - Now LOCAL atlases; `name` is the
 *   one the local list shows.
 * @property {Array<{atlasId: string, name: string|null, remainingMs: number}>} retained - Kept by
 *   the retention veto, because they could not become local atlases; `remainingMs` is what is LEFT
 *   of `RESCUE_VETO_GRACE_MS` (the veto keeps its first stamp, it is never extended).
 * @property {Array<{atlasId: string, name: string|null}>} lost - Neither adopted nor under a live
 *   veto (none could be recorded, or the one on record expired): the sweep that follows this call
 *   destroys them.
 * @property {number} pendingOps - Operations found across all of them; NaN when any count failed.
 */

/**
 * Whether ANOTHER live client has this namespace mounted, asked of the mount lock, which is the
 * arbiter the sweep itself uses to spare a namespace (`purgeAllRemoteAtlases`). Null (no lock
 * manager, plain HTTP) answers false: there is nobody to ask, and the sweep will not spare either.
 * @param {string} dbSuffix
 * @returns {Promise<boolean>}
 */
async function mountedByAnotherClient(dbSuffix) {
    if (!hasMountLockSupport()) return false;
    const selfHolds = getActiveScope()?.dbSuffix === dbSuffix ? 1 : 0;
    const answer = await otherClientHoldsLock(globalThis.navigator?.locks, atlasMountLockName(dbSuffix), selfHolds);
    return answer === true;
}

/**
 * THE RESCUE OF THE ATLASES THIS TAB LEFT, for every involuntary end of a session.
 *
 * WHY IT EXISTS. The rescue of `preserveUnsyncedWorkAsLocal` adopts ONE namespace, the mounted one,
 * and the logged-out sweep destroys EVERY registered remote namespace. A switch of atlas keeps the
 * queue of the atlas left behind for its next opening (`openRemoteAtlas` empties nothing, and
 * `switchToExistingLocalAtlas` says so), so the ordinary path "edit A with a bad network, open B,
 * the session expires" reached the sweep with A's work inside and destroyed it, silently. Measured
 * in `tests/e2e-ui/sessao-perdida-poupa-fila-de-outro-atlas.repro.spec.js`.
 *
 * THE RULES, each one a condition of the decision of 2026-09-23 (coordinator, proposal R):
 *   - the same predicate as the mounted atlas (`shouldPreserveLocalWork`, involuntary): zero does
 *     not enter, an UNKNOWN count does;
 *   - an atlas already claimed by a local slot is skipped, so a session that falls twice never
 *     rescues the same namespace twice; so is one whose discard the person already confirmed, by
 *     the registry mark or by the discard fence (`remoteWritesDiscarded`);
 *   - an atlas ANOTHER LIVE TAB has mounted is skipped (the idle watch is per tab): adopting it
 *     would turn that tab's live server atlas into a local one under its feet, its next flush would
 *     drain the queue anyway, and its own teardown would empty the slot. That tab's exit rescues it;
 *   - the local cap (`MAX_LOCAL_ATLASES`) is respected here, unlike the mounted rescue: an atlas that
 *     does not fit is NOT discarded, it takes the retention veto, and the caller says so by name,
 *     with the time LEFT; a veto that already expired protects nothing and is reported as lost;
 *   - the slot is adopted with `makeCurrent: false`, so the next boot still lands where the person
 *     was working.
 *
 * IT MUST RUN BEFORE ANY SWEEP OF THE SAME EXIT, and every caller places it there: the map's
 * involuntary logout, the exit guard of the pages without a map, and the logged-out boot guard.
 *
 * @param {{ exceptAtlasId?: string|null }} [params] - The mounted atlas, rescued by its own path.
 * @returns {Promise<OtherAtlasesRescue>} Never rejects.
 */
export async function preserveUnsyncedWorkOfOtherAtlases({ exceptAtlasId = null } = {}) {
    const result = { rescued: [], retained: [], lost: [], pendingOps: 0 };
    let entries;
    let claimed;
    let localCount;
    try {
        entries = await listRemoteAtlases();
        const registry = await readLocalAtlasRegistry();
        claimed = new Set(registry.map(entry => entry?.dbSuffix));
        localCount = registry.length;
    } catch (error) {
        console.warn('[unsynced-work] listing the atlases to rescue failed:', error);
        return { ...result, pendingOps: NaN };
    }

    for (const entry of entries) {
        if (entry.atlasId === exceptAtlasId || claimed.has(entry.dbSuffix) || entry.discardRequested) continue;
        if (remoteWritesDiscarded(remoteScope(entry.atlasId))) continue;
        if (await mountedByAnotherClient(entry.dbSuffix)) continue;
        const pendingOps = await countPendingOperationsFor(entry.atlasId);
        if (!shouldPreserveLocalWork({ involuntary: true, pendingOps })) continue;
        result.pendingOps += pendingOps;

        const name = await atlasNameOnDisk(entry.atlasId);
        let slot = null;
        if (localCount < MAX_LOCAL_ATLASES) {
            try {
                const adopted = await adoptRemoteAtlasAsLocal(
                    entry.atlasId, rescuedAtlasName(name), { makeCurrent: false }
                );
                // Read back from the disk, as the mounted rescue does: not throwing is not the same
                // as the entry being on disk.
                const onDisk = (await readLocalAtlasRegistry()).some(e => e.dbSuffix === entry.dbSuffix);
                if (adopted?.ok && onDisk) slot = adopted.atlas;
            } catch (error) {
                console.error(`[unsynced-work] rescuing the work of atlas ${entry.atlasId} failed:`, error);
            }
        }
        if (slot) {
            releaseRemoteAtlasRescueVeto(entry.atlasId);
            localCount += 1;
            claimed.add(entry.dbSuffix);
            result.rescued.push({ atlasId: entry.atlasId, name: slot.name });
        } else if (await retainRemoteAtlasForRescue(entry.atlasId) && vetoRemainingMs(entry.atlasId) > 0) {
            result.retained.push({ atlasId: entry.atlasId, name, remainingMs: vetoRemainingMs(entry.atlasId) });
        } else {
            console.error(`[unsynced-work] the unsent work of atlas ${entry.atlasId} could not be protected`);
            result.lost.push({ atlasId: entry.atlasId, name });
        }
    }
    return result;
}

/**
 * What is left of the retention veto of an atlas, in milliseconds (0 when none or expired).
 * @param {string} atlasId
 * @returns {number}
 */
function vetoRemainingMs(atlasId) {
    const since = remoteAtlasRescueVetoSince(atlasId);
    if (!(since > 0)) return 0;
    return Math.max(0, RESCUE_VETO_GRACE_MS - (Date.now() - since));
}

/**
 * What to tell the person about {@link preserveUnsyncedWorkOfOtherAtlases}, or null.
 * @param {OtherAtlasesRescue} rescue
 * @returns {{message: string, tone: string}|null}
 */
export function otherAtlasesRescueMessage(rescue) {
    const semNome = 'um atlas do servidor';
    return otherAtlasesRescueNotice({
        rescued: (rescue?.rescued ?? []).map(r => r.name),
        retained: (rescue?.retained ?? []).map(r => r.name ?? semNome),
        lost: (rescue?.lost ?? []).map(r => r.name ?? semNome),
        // The SHORTEST time left, so the sentence never promises more than the first to expire.
        graceMs: Math.min(...(rescue?.retained ?? []).map(r => r.remainingMs), RESCUE_VETO_GRACE_MS),
    });
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
 * until 2026-08-23, when voluntary exit also used it. Since 2026-09-12 only involuntary exits
 * use this function. It applies `shouldPreserveLocalWork` with `involuntary: true` and rescues in
 * silence: an unknown count preserves, zero does not, and the caller gets back a sentence to
 * deliver plus a code it can put on a URL.
 *
 * It exists because the alternative was telling each page to compose three calls
 * (`countPendingOperationsFor`, `shouldPreserveLocalWork`, `preserveUnsyncedWorkAsLocal`) in the
 * right order, and the one that is easy to drop is the last, which is the one that keeps the data.
 *
 * IT LOOKS AT EVERY REGISTERED SERVER ATLAS, since 2026-09-23: the mounted one through
 * `preserveUnsyncedWorkAsLocal`, and the ones the tab left (or another tab left, and nobody holds
 * any more) through {@link preserveUnsyncedWorkOfOtherAtlases}. It said "the mounted atlas and
 * nothing else" until then, and the logged-out sweep of the map this page navigates to destroyed
 * the rest. An atlas another live tab still has mounted is left to that tab's own exit.
 *
 * @param {Object} [params]
 * @param {string|null} [params.atlasId] - Server atlas to inspect; defaults to the origin marker,
 *   which is where a page without a map learns what the map tab had mounted.
 * @param {string|null} [params.atlasName]
 * @returns {Promise<ExitGuardResult>}
 */
export async function preserveUnsyncedWorkOnLostSession({ atlasId = null, atlasName = null } = {}) {
    const alvo = atlasId ?? await mountedRemoteAtlasFromDisk();
    // THE OTHER ATLASES FIRST, and whatever the mounted one holds: the map this page navigates to
    // boots logged out and its sweep destroys every registered namespace nobody claimed.
    const outros = await preserveUnsyncedWorkOfOtherAtlases({ exceptAtlasId: alvo });
    const principal = await preserveMountedAtlas(alvo, atlasName);
    return combineExitResults(principal, outros);
}

/**
 * The exit guard of ONE server atlas, the mounted one; what `preserveUnsyncedWorkOnLostSession`
 * was before it also covered the atlases the tab left.
 * @param {string|null} alvo
 * @param {string|null} atlasName
 * @returns {Promise<ExitGuardResult>}
 */
async function preserveMountedAtlas(alvo, atlasName) {
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
 * One exit result out of the mounted atlas's and the others'.
 *
 * EACH ATLAS KEEPS ITS OWN OUTCOME. `outcome` and `pendingOps` stay the MOUNTED atlas's, and the
 * others travel apart in `others` (the `OtherAtlasesOutcome` codes present, for `?outros=` on the
 * URL), because one code for both made "mounted rescued, another retained" read as a failure of the
 * mounted atlas, with its count. The names only reach a caller that can show a toast (`message`).
 * @param {ExitGuardResult} principal
 * @param {OtherAtlasesRescue} outros
 * @returns {ExitGuardResult & { others: string[] }}
 */
function combineExitResults(principal, outros) {
    const others = [];
    if (outros.rescued.length > 0) others.push(OtherAtlasesOutcome.GUARDADO);
    if (outros.retained.length > 0) others.push(OtherAtlasesOutcome.RETIDO);
    if (outros.lost.length > 0) others.push(OtherAtlasesOutcome.PERDIDO);
    const aviso = otherAtlasesRescueMessage(outros);
    const message = [principal.message, aviso?.message].filter(Boolean).join(' ') || null;
    return { ...principal, others, message };
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

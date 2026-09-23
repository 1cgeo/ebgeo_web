// Path: js/session/confirm-logout.js
import { registrarUso, anunciarSaidaDaConta } from '@js/session/uso-lote.js';
import { EventoDeUso, PropDeUso } from '@js/session/eventos-de-uso.js';
import { showConfirm } from '@modals/confirm.modal.js';
/** Voluntary logout: confirm the loss across every remote namespace on this browser. */
import {
    listRemoteAtlases,
    requestRemoteAtlasDiscard,
    noteRemoteNamespaceTeardown
} from '@store/remote-atlas.api.js';
import { readLocalAtlasRegistry, getActiveScope, remoteScope } from '@store/atlas-namespace.js';
import { pauseStoreWrites, holdLogoutBarriers } from '@store/write-coordinator.js';
import { pauseAutoFlush } from '@store/sync/auto-flush-pause.js';
import { announceTabLockTeardown } from '@utils/tab-lock.js';
import { countPendingOperationsFor } from './unsynced-work-exit.js';
import { countQuarantine } from '@store/sync/quarantine-registry.js';
import { pendingWorkSummary, quarantineKeptNotice } from './unsynced-work-phrases.js';

/** A failed or stalled census must ask, never silently treat an unreadable queue as empty. */
async function pendingCount(entries) {
    let timer;
    try {
        return await Promise.race([
            Promise.all(entries.map(e => countPendingOperationsFor(e.atlasId)))
                .then(counts => counts.reduce((sum, n) => sum + n, 0)),
            new Promise(resolve => { timer = setTimeout(() => resolve(NaN), 3000); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * How much of that work is QUARANTINE: refused by the server, or written by a protocol this build
 * will not replay.
 *
 * IT IS A DIFFERENT QUESTION FROM THE CENSUS ABOVE, not a second reading of the same number. The
 * quarantine is what `requestRemoteAtlasDiscard` copies out of the namespace before it is
 * destroyed, so it is the part the dialog can promise will still be there afterwards, and the
 * dialog said the opposite of that until 2026-09-13.
 *
 * A FAILURE HERE COSTS THE SECOND HALF OF THE SENTENCE, NEVER THE WARNING. It answers NaN, the
 * phrase falls back to the pending total alone, and the confirmation still happens: the decision
 * being taken is about destruction, and an unreadable quarantine must not make it look smaller.
 * @param {Array<{atlasId: string}>} entries - Server atlases about to be discarded.
 * @returns {Promise<number>} The count, or NaN when it could not be measured.
 */
async function quarantineCount(entries) {
    let timer;
    try {
        return await Promise.race([
            Promise.all(entries.map(e => countQuarantine(e.atlasId)))
                .then(counts => counts.reduce((sum, n) => sum + n, 0)),
            new Promise(resolve => { timer = setTimeout(() => resolve(NaN), 3000); }),
        ]);
    } catch (error) {
        console.warn('[logout] could not count quarantined work:', error);
        return NaN;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The server namespaces this exit would discard: everything the registry knows minus what a LOCAL
 * atlas claims. It is the SAME list the census counts and `requestRemoteAtlasDiscard` marks, which
 * is why the barrier is taken over it and not over the active scope alone.
 *
 * NULL IS NOT AN EMPTY LIST. A registry that could not be read must leave the census unknown rather
 * than silently report zero pending work, which is the direction every count in this file degrades
 * in.
 * @returns {Promise<Array<{atlasId: string, dbSuffix: string}>|null>}
 */
async function remoteEntriesToDiscard() {
    try {
        const claimed = new Set((await readLocalAtlasRegistry()).map(e => e.dbSuffix));
        return (await listRemoteAtlases()).filter(e => !claimed.has(e.dbSuffix));
    } catch (error) {
        console.warn('[logout] could not list the remote namespaces to discard:', error);
        return null;
    }
}

/**
 * Scopes the barrier has to cover, from the discard list plus the ACTIVE scope.
 *
 * The active one stays in even when a local atlas claims its namespace (a rescued slot), because
 * THIS document writes there and the pause above is per tab. A list that could not be read leaves
 * only the active scope, which is the coverage this dialog had before 2026-09-19.
 * @param {Array<{atlasId: string, dbSuffix: string}>|null} entries - Discard list, or null.
 * @param {{kind: string, dbSuffix: string}|null} active - Active remote scope, or null.
 * @returns {Array<{kind: string, dbSuffix: string}>}
 */
function barrierScopesFor(entries, active) {
    const scopes = [];
    const seen = new Set();
    for (const entry of entries ?? []) {
        if (!entry?.atlasId || seen.has(entry.dbSuffix)) continue;
        try {
            scopes.push(remoteScope(entry.atlasId));
            seen.add(entry.dbSuffix);
        } catch (error) {
            // An id the scope factory refuses names no reachable namespace, so it cannot be written
            // to either. Skipping it loudly keeps one corrupt entry from costing the whole barrier.
            console.warn(`[logout] registry entry "${entry.atlasId}" has no usable scope:`, error);
        }
    }
    if (active && !seen.has(active.dbSuffix)) scopes.push(active);
    return scopes;
}

/**
 * Returns false on cancellation. No session, queue or registry changes precede confirmation.
 * Records the accepted discard before teardown so a reload cannot replay an abandoned queue.
 */
export async function confirmLogoutWithPendingWork() {
    const scope = getActiveScope();
    const remote = scope?.kind === 'remote' ? scope : null;
    // THE ORDER IS THE POINT. The per-tab pause is synchronous, so it stops this document's writers
    // before anything else runs; the barrier is a Web Lock, so merely ASKING for it exclusively
    // already refuses every sibling tab's next write, and being GRANTED it is the evidence that
    // their in-flight writes finished. Taking it after the local pause means no write of THIS tab
    // can slip in between the two.
    const writes = pauseStoreWrites(remote);
    const sends = pauseAutoFlush();
    // THE LIST IS READ BEFORE THE BARRIER, and it has to be: the barrier must cover exactly what
    // the census counts and the discard marks, and neither is known until the registries are read.
    // The window this opens is bounded by the same reads the census would do anyway, and the count
    // still happens AFTER the grant, which is the ordering that makes it believable.
    const entries = await remoteEntriesToDiscard();
    const barrier = await holdLogoutBarriers(barrierScopesFor(entries, remote));
    try {
        return await confirmAndPrepareLogout(
            Promise.all([writes.settled, sends.settled]),
            barrier.drained,
            entries
        );
    } catch (error) {
        console.error('[logout] could not prepare remote discard:', error);
        const { showError } = await import('@utils/toast_service.js');
        showError('Não foi possível concluir a saída da conta. Tente sair novamente.');
        return false;
    } finally {
        writes.resume();
        sends.resume();
        // CANCELLING RELEASES IT, and so does confirming: the barrier's job ends when the namespaces
        // are marked and the peers are frozen, and from there the write epoch fence is what refuses
        // a late write. A barrier left held would refuse every edit in every tab until this document
        // died.
        await barrier.release();
    }
}

/**
 * @param {Promise<*>} settled - Completion of the writers and sends this DOCUMENT had in flight.
 * @param {boolean} drained - Whether the cross-tab barrier proved that every OTHER tab's writers
 *   finished, over EVERY namespace this exit would discard. False means the deadline expired with
 *   a sibling still writing somewhere, and the census that follows cannot be believed: the count
 *   stays unknown, which is the sentence the dialog already had for an unreadable queue.
 * @param {Array<{atlasId: string, dbSuffix: string}>|null} entries - The discard list the barrier
 *   was taken over. Null when the registries could not be read, and then nothing is counted.
 * @returns {Promise<boolean>}
 */
async function confirmAndPrepareLogout(settled, drained = true, entries = null) {
    let pendingOps = NaN;
    let quarantined = NaN;
    try {
        let timer;
        try {
            const idle = await Promise.race([
                settled.then(() => true),
                new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); }),
            ]);
            if (idle && drained && entries) pendingOps = await pendingCount(entries);
        } finally { clearTimeout(timer); }
        if (!Number.isFinite(pendingOps) || pendingOps > 0) quarantined = await quarantineCount(entries ?? []);
    } catch (error) {
        console.warn('[logout] could not count remote pending work:', error);
    }
    if (!Number.isFinite(pendingOps) || pendingOps > 0) {
        const confirmed = await showConfirm('Sair com alterações pendentes?', {
            message: `${pendingWorkSummary(pendingOps, quarantined)} Se sair agora, as alterações `
                + 'pendentes dos atlas do servidor serão descartadas deste navegador, inclusive das '
                + 'outras abas, sem como recuperar. '
                + quarantineKeptNotice(quarantined)
                + 'Seus atlas locais e o que já chegou ao servidor continuam salvos. '
                + 'O que já estava a caminho ainda pode chegar.',
            confirmText: 'Sair e descartar pendências',
            cancelText: 'Continuar no EBGeo',
            destructive: true,
        });
        if (!confirmed) return false;
    }
    // Read the registry again: another tab may have mounted an atlas while the dialog was open.
    // Local claims are checked again inside the mutation, including rescued local atlases.
    const discarded = await requestRemoteAtlasDiscard();
    const addresses = discarded.map(e => e.dbSuffix);
    // THE REPORT IS LEFT BEHIND, not thrown away, and it is the evidence the destruction needs: the
    // sweep that actually deletes these databases runs later (this page's `purgeAllRemoteAtlases`,
    // or the next logged-out boot), and only "every live peer answered" licenses it to take a
    // namespace a sibling still has mounted. Without the note it would either destroy blind or pay
    // a second round of acks.
    noteRemoteNamespaceTeardown(addresses, await announceTabLockTeardown(addresses));
    if (!Number.isFinite(pendingOps) || pendingOps > 0) {
        if (Number.isFinite(pendingOps)) registrarUso(EventoDeUso.LOGOUT_DESCARTE, PropDeUso.DESCARTE_PENDENCIAS);
        else registrarUso(EventoDeUso.LOGOUT_DESCARTE, PropDeUso.DESCARTE_DESCONHECIDO);
    }
    // EVERY confirmed Sair passes here, on the four pages, and nothing else does: this is where the
    // account's pending usage batches are marked for erasure (owner, 2026-09-23), after a flush
    // that still carries the account's token. See `anunciarSaidaDaConta`.
    anunciarSaidaDaConta();
    return true;
}

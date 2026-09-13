// Path: js/session/confirm-logout.js
import { registrarUso, descarregarUso } from '@js/session/uso-lote.js';
import { EventoDeUso, PropDeUso } from '@js/session/eventos-de-uso.js';
/** Voluntary logout: confirm the loss across every remote namespace on this browser. */
import {
    listRemoteAtlases,
    requestRemoteAtlasDiscard,
    noteRemoteNamespaceTeardown
} from '@store/remote-atlas.api.js';
import { readLocalAtlasRegistry, getActiveScope } from '@store/atlas-namespace.js';
import { pauseStoreWrites, holdLogoutBarrier } from '@store/write-coordinator.js';
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
 * Returns false on cancellation. No session, queue or registry changes precede confirmation.
 * Records the accepted discard before teardown so a reload cannot replay an abandoned queue.
 */
export async function confirmLogoutWithPendingWork() {
    const scope = getActiveScope();
    const remote = scope?.kind === 'remote' ? scope : null;
    // THE ORDER IS THE POINT. The per-tab pause is synchronous, so it stops this document's writers
    // before anything else runs; the barrier is a Web Lock, so merely ASKING for it exclusively
    // already refuses every sibling tab's next write, and being GRANTED it is the evidence that
    // their in-flight writes finished. Taking it after the local pause means no write can slip in
    // between the two.
    const writes = pauseStoreWrites(remote);
    const sends = pauseAutoFlush();
    const barrier = await holdLogoutBarrier(remote);
    try {
        return await confirmAndPrepareLogout(
            Promise.all([writes.settled, sends.settled]),
            barrier.drained
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
 * @param {boolean} drained - Whether the cross-tab barrier proved every OTHER tab's writers
 *   finished. False means the deadline expired with a sibling still writing, and the census that
 *   follows cannot be believed: the count stays unknown, which is the sentence the dialog already
 *   had for an unreadable queue.
 * @returns {Promise<boolean>}
 */
async function confirmAndPrepareLogout(settled, drained = true) {
    let entries;
    let pendingOps = NaN;
    let quarantined = NaN;
    try {
        const claimed = new Set((await readLocalAtlasRegistry()).map(e => e.dbSuffix));
        entries = (await listRemoteAtlases()).filter(e => !claimed.has(e.dbSuffix));
        let timer;
        try {
            const idle = await Promise.race([
                settled.then(() => true),
                new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); }),
            ]);
            if (idle && drained) pendingOps = await pendingCount(entries);
        } finally { clearTimeout(timer); }
        if (!Number.isFinite(pendingOps) || pendingOps > 0) quarantined = await quarantineCount(entries);
    } catch (error) {
        console.warn('[logout] could not count remote pending work:', error);
    }
    if (!Number.isFinite(pendingOps) || pendingOps > 0) {
        const { showConfirm } = await import('@modals/confirm.modal.js');
        const confirmed = await showConfirm('Sair com alterações pendentes?', {
            message: `${pendingWorkSummary(pendingOps, quarantined)} Ao sair, as alterações `
                + 'pendentes dos atlas do servidor neste navegador, inclusive em outras abas, '
                + 'serão descartadas e não poderão ser recuperadas. '
                + quarantineKeptNotice(quarantined)
                + 'Seus atlas locais e os dados já enviados ao servidor serão mantidos. '
                + 'Uma solicitação já recebida pelo servidor pode concluir mesmo após a saída.',
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
        descarregarUso();
    }
    return true;
}

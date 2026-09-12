// Path: js/session/confirm-logout.js
import { registrarUso, descarregarUso } from '@js/session/uso-lote.js';
import { EventoDeUso, PropDeUso } from '@js/session/eventos-de-uso.js';
/** Voluntary logout: confirm the loss across every remote namespace on this browser. */
import { listRemoteAtlases, requestRemoteAtlasDiscard } from '@store/remote-atlas.api.js';
import { readLocalAtlasRegistry, getActiveScope } from '@store/atlas-namespace.js';
import { pauseStoreWrites } from '@store/write-coordinator.js';
import { pauseAutoFlush } from '@store/sync/auto-flush-pause.js';
import { announceTabLockTeardown } from '@utils/tab-lock.js';
import { countPendingOperationsFor } from './unsynced-work-exit.js';
import { pendingOpsLabel } from './unsynced-work-phrases.js';

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
 * Returns false on cancellation. No session, queue or registry changes precede confirmation.
 * Records the accepted discard before teardown so a reload cannot replay an abandoned queue.
 */
export async function confirmLogoutWithPendingWork() {
    const scope = getActiveScope();
    const writes = pauseStoreWrites(scope?.kind === 'remote' ? scope : null);
    const sends = pauseAutoFlush();
    try {
        return await confirmAndPrepareLogout(Promise.all([writes.settled, sends.settled]));
    } catch (error) {
        console.error('[logout] could not prepare remote discard:', error);
        const { showError } = await import('@utils/toast_service.js');
        showError('Não foi possível concluir a saída da conta. Tente sair novamente.');
        return false;
    } finally {
        writes.resume();
        sends.resume();
    }
}

async function confirmAndPrepareLogout(settled) {
    let entries;
    let pendingOps = NaN;
    try {
        const claimed = new Set((await readLocalAtlasRegistry()).map(e => e.dbSuffix));
        entries = (await listRemoteAtlases()).filter(e => !claimed.has(e.dbSuffix));
        let timer;
        try {
            const idle = await Promise.race([
                settled.then(() => true),
                new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); }),
            ]);
            if (idle) pendingOps = await pendingCount(entries);
        } finally { clearTimeout(timer); }
    } catch (error) {
        console.warn('[logout] could not count remote pending work:', error);
    }
    if (!Number.isFinite(pendingOps) || pendingOps > 0) {
        const { showConfirm } = await import('@modals/confirm.modal.js');
        const message = Number.isFinite(pendingOps)
            ? `Há ${pendingOpsLabel(pendingOps)} com envio pendente ao servidor.`
            : 'Não foi possível verificar se existem alterações ainda não enviadas ao servidor.';
        const confirmed = await showConfirm('Sair com alterações pendentes?', {
            message: `${message} Ao sair, as alterações pendentes dos atlas do servidor neste navegador, `
                + 'inclusive em outras abas, serão descartadas e não poderão ser recuperadas. '
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
    await announceTabLockTeardown(discarded.map(e => e.dbSuffix));
    if (!Number.isFinite(pendingOps) || pendingOps > 0) {
        if (Number.isFinite(pendingOps)) registrarUso(EventoDeUso.LOGOUT_DESCARTE, PropDeUso.DESCARTE_PENDENCIAS);
        else registrarUso(EventoDeUso.LOGOUT_DESCARTE, PropDeUso.DESCARTE_DESCONHECIDO);
        descarregarUso();
    }
    return true;
}

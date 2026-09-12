// Path: js/session/confirm-logout.js
/** Voluntary logout: confirm the loss across every remote namespace on this browser. */
import { listRemoteAtlases, requestRemoteAtlasDiscard } from '@store/remote-atlas.api.js';
import { readLocalAtlasRegistry } from '@store/atlas-namespace.js';
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
    try {
        return await confirmAndPrepareLogout();
    } catch (error) {
        console.error('[logout] could not prepare remote discard:', error);
        const { showError } = await import('@utils/toast_service.js');
        showError('Não foi possível concluir a saída da conta. Tente sair novamente.');
        return false;
    }
}

async function confirmAndPrepareLogout() {
    let entries;
    let pendingOps = NaN;
    try {
        const claimed = new Set((await readLocalAtlasRegistry()).map(e => e.dbSuffix));
        entries = (await listRemoteAtlases()).filter(e => !claimed.has(e.dbSuffix));
        pendingOps = await pendingCount(entries);
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
                + 'Seus atlas locais e os dados já enviados ao servidor serão mantidos.',
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
    return true;
}

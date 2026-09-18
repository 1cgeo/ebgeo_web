// Path: js/ui/migration-recovery.js
import { registrarUso, descarregarUso } from '@js/session/uso-lote.js';
import { EventoDeUso, PropDeUso } from '@js/session/eventos-de-uso.js';
import { relatarErro } from '@js/session/erro-telemetria.js';
import { OrigemDeErro } from '@js/session/origens-de-erro.js';
import { instalarMonitoramentoDePendencias } from '@js/session/pendencias-monitoramento.js';
import { createTabLock, noneKey } from '../utilities/tab-lock.js';
import { prepareLegacyTransition, legacyHasChanged, restartLegacyCopy } from '../store/migration/legacy-transition.js';
import { describeLegacySource, dropLegacySource, pruneAbandonedCopies } from '../store/migration/legacy-cleanup.js';
import {
    DROP_SOURCE_CANCEL_LABEL, DROP_SOURCE_CONFIRM_LABEL, DROP_SOURCE_LABEL, DROP_SOURCE_RUNNING,
    dropSourceConfirmation, dropSourceDenial, dropSourceDone
} from './migration-recovery-phrases.js';
import { MigrationRecoveryError } from '../store/migration/transition-state.js';

let screen = null;
let covered = [];
let watching = false;

function closeScreen() {
    screen?.remove();
    screen = null;
    for (const [element, inert] of covered) element.inert = inert;
    covered = [];
}

function makeScreen(title, message) {
    closeScreen();
    document.getElementById('initial-loader')?.remove();
    screen = document.createElement('div');
    screen.className = 'ebgeo-unavailable';
    screen.dataset.testid = 'migration-recovery';
    screen.setAttribute('role', 'alert');
    const card = document.createElement('div');
    card.className = 'ebgeo-unavailable__card';
    const heading = document.createElement('h1');
    heading.className = 'ebgeo-unavailable__title';
    heading.textContent = title;
    const text = document.createElement('p');
    text.className = 'ebgeo-unavailable__msg';
    text.textContent = message;
    card.append(heading, text);
    screen.append(card);
    for (const element of document.body.children) {
        covered.push([element, element.inert]);
        element.inert = true;
    }
    document.body.append(screen);
    return { card, text };
}

function button(card, label, action, text) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'ebgeo-unavailable__btn';
    element.textContent = label;
    element.addEventListener('click', async () => {
        element.disabled = true;
        try { await action(); } catch (error) { text.textContent = error.message; } finally { element.disabled = false; }
    });
    card.append(element);
    return element;
}

/**
 * Draws the one destructive command of this screen: deleting the copy the previous version left.
 *
 * THE COMMAND IS ALWAYS DRAWN AND THE CLICK IS WHAT REFUSES, which is the house rule for a block
 * by STATE (`.claude/rules/architecture.md`, §UI Architecture): every reason it can refuse is
 * reversible, and the person reading the refusal is usually the one who reverses it. So it
 * carries `aria-disabled` and NEVER the `disabled` property, because a disabled button fires no
 * click and the click is how the reason reaches the person.
 *
 * IT ASKS TWICE, and the second question names the SIZE. The count comes from the inventory read
 * at that instant, not from the journal, so the number on the screen is the number on the disk.
 *
 * @param {HTMLElement} card - Card of the recovery screen.
 * @param {HTMLElement} text - Paragraph the screen speaks through.
 * @returns {HTMLButtonElement} The command, for a caller that wants to observe it.
 */
function dropSourceCommand(card, text) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'ebgeo-unavailable__btn';
    element.dataset.testid = 'drop-legacy-source';
    element.textContent = DROP_SOURCE_LABEL;
    element.setAttribute('aria-disabled', 'true');
    let asking = null;

    const refresh = async () => {
        const { reason } = await describeLegacySource();
        element.setAttribute('aria-disabled', reason === 'ok' ? 'false' : 'true');
        return reason;
    };

    element.addEventListener('click', async () => {
        if (asking) return;
        try {
            // ASKED AGAIN AT THE MOMENT OF THE ACT: a legacy window can write between the read
            // that decided how this button looks and the click that acts on it.
            const reason = await refresh();
            if (reason !== 'ok') {
                text.textContent = dropSourceDenial(reason) ?? DROP_SOURCE_LABEL;
                return;
            }
            asking = await askToDropSource(card, text, element, () => { asking = null; });
        } catch (failure) {
            text.textContent = dropSourceDenial(failure.code) ?? failure.message;
        }
    });

    card.append(element);
    refresh().catch(() => element.setAttribute('aria-disabled', 'true'));
    return element;
}

/**
 * The second step: the size, the warning, and the two ways out.
 *
 * @param {HTMLElement} card - Card of the recovery screen.
 * @param {HTMLElement} text - Paragraph the screen speaks through.
 * @param {HTMLButtonElement} command - The command that opened this step.
 * @param {() => void} done - Called when the step closes, either way.
 * @returns {Promise<HTMLElement>} The row holding the two buttons.
 */
async function askToDropSource(card, text, command, done) {
    const { records } = await describeLegacySource();
    const previous = text.textContent;
    text.textContent = dropSourceConfirmation(records);
    const row = document.createElement('div');
    row.dataset.testid = 'drop-legacy-source-confirm';
    card.append(row);
    const close = () => { row.remove(); done(); };

    button(row, DROP_SOURCE_CONFIRM_LABEL, async () => {
        text.textContent = DROP_SOURCE_RUNNING;
        try {
            const result = await dropLegacySource();
            text.textContent = dropSourceDone(result.records);
            command.setAttribute('aria-disabled', 'true');
        } catch (failure) {
            text.textContent = dropSourceDenial(failure.code) ?? failure.message;
        }
        close();
    }, text);
    button(row, DROP_SOURCE_CANCEL_LABEL, () => {
        text.textContent = previous;
        close();
    }, text);
    return row;
}

export function showMigrationRecovery(error = {}) {
    const code = error.code;
    const message = code === 'legacy_tab'
        ? 'Salve o trabalho e feche a janela que está usando a versão antiga. Depois, tente novamente aqui.'
        : code === 'legacy_changes'
            ? 'A versão antiga gravou alterações. Você pode recuperá-las em outro atlas sem substituir o trabalho atualizado.'
            : error.name === 'QuotaExceededError' || error.cause?.name === 'QuotaExceededError'
                ? 'Não há espaço para concluir a atualização. Salve uma cópia de recuperação; não apague os dados deste site.'
                : 'Não foi possível abrir o acervo com segurança. Os dados disponíveis continuam neste computador. Você pode tentar novamente ou salvar uma cópia de recuperação.';
    const { card, text } = makeScreen('Recuperar seus dados', message);
    button(card, 'Tentar novamente', () => window.location.reload(), text);
    button(card, 'Salvar cópia de recuperação', async () => {
        text.textContent = 'Preparando a cópia dos dados locais…';
        const { buildRecoveryArchive } = await import('../store/migration/recovery-archive.js');
        const blob = await buildRecoveryArchive();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ebgeo-recuperacao-${new Date().toISOString().slice(0, 10)}.zip`;
        card.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        text.textContent = 'Cópia preparada para download. Guarde o arquivo; seus dados locais continuam preservados.';
    }, text);
    if (code === 'source_changed' || code === 'copy_failed') {
        button(card, 'Preparar uma nova cópia', async () => {
            await restartLegacyCopy();
            window.location.reload();
        }, text);
    }
    if (code === 'legacy_changes') {
        button(card, 'Recuperar alterações em outro atlas', async () => {
            const { recoverLateLegacyChanges } = await import('../store/migration/recovery-archive.js');
            const entry = await recoverLateLegacyChanges();
            text.textContent = `O atlas “${entry.name}” foi recuperado. Reabra o EBGeo para acessá-lo em Meus Atlas.`;
        }, text);
    }
    const file = document.createElement('input');
    file.type = 'file'; file.accept = '.zip'; file.hidden = true;
    card.append(file);
    button(card, 'Abrir cópia de recuperação', () => file.click(), text);
    // LAST, AND DELIBERATELY: it is the only command here that destroys anything, so every way
    // of saving the data comes before it on the screen.
    dropSourceCommand(card, text);
    file.addEventListener('change', async () => {
        if (!file.files?.[0]) return;
        try {
            const { readRecoveryArchive, restoreRecoveryArchive } = await import('../store/migration/recovery-archive.js');
            const archive = await readRecoveryArchive(file.files[0]);
            const select = document.createElement('select');
            select.setAttribute('aria-label', 'Acervo para recuperar');
            archive.scopes.forEach((scope, index) => {
                const option = document.createElement('option');
                option.value = String(index); option.textContent = scope.label;
                select.append(option);
            });
            card.append(select);
            button(card, 'Restaurar como outro atlas', async () => {
                const entry = await restoreRecoveryArchive(archive, Number(select.value));
                text.textContent = `O atlas “${entry.name}” foi restaurado. Reabra o EBGeo para acessá-lo em Meus Atlas.`;
            }, text);
        } catch (failure) { text.textContent = failure.message; }
    });
}

/**
 * The boot sweep of decision D8: the abandoned copies go, the origin stays.
 *
 * IT RUNS ONLY AFTER THE GATE SUCCEEDED, and it never fails the boot. A copy that could not be
 * deleted keeps its entry and the next boot retries, so the whole cost of a failure here is disk,
 * while raising would cost the user the map over housekeeping.
 *
 * @returns {Promise<void>}
 */
async function sweepAbandonedCopies() {
    try {
        const report = await pruneAbandonedCopies();
        if (report.copies.length || report.recoveries.length || report.blocked.length) {
            console.info('Poda das cópias da atualização:', JSON.stringify(report));
        }
    } catch (error) {
        console.warn('Poda das cópias da atualização adiada:', error);
    }
}

export async function runLegacyUpgradeGate() {
    registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_INICIO);
    descarregarUso();
    const progress = makeScreen('Preparando seus dados', 'Verificando a atualização dos dados locais…');
    const probe = createTabLock({ key: noneKey(), overlayHost: null, autoPulse: false });
    try {
        await probe.acquire(noneKey(), { settleMs: 100 });
        if (probe.legacyPeerDetected) throw new MigrationRecoveryError('legacy_tab', 'Há uma janela da versão antiga aberta.');
        await prepareLegacyTransition({ onProgress: ({ copied, total }) => {
            progress.text.textContent = `Copiando e verificando seus dados: ${copied} de ${total} registros. Aguarde a conclusão.`;
        } });
        closeScreen();
        registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_SUCESSO);
        descarregarUso();
        instalarMonitoramentoDePendencias();
        await sweepAbandonedCopies();
        return true;
    } catch (error) {
        if (error.code === 'legacy_tab') registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_ABA_ANTIGA);
        else if (error instanceof MigrationRecoveryError) registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_FALHA);
        else registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_STORAGE_ERROR);
        descarregarUso();
        relatarErro(new Error(error.code === 'legacy_tab' ? 'Atualização local: versão antiga aberta' : 'Atualização local interrompida'), { origem: OrigemDeErro.BOOT });
        console.warn('Atualização local interrompida:', error.name, error.code || 'storage_error');
        showMigrationRecovery(error);
        return false;
    } finally { probe.destroy(); }
}

export function watchLegacyChanges() {
    if (watching) return;
    watching = true;
    let running = false;
    const check = async () => {
        if (running || screen || document.visibilityState === 'hidden') return;
        running = true;
        try {
            if (await legacyHasChanged()) showMigrationRecovery({ code: 'legacy_changes' });
        } catch (error) { showMigrationRecovery(error); } finally { running = false; }
    };
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
}

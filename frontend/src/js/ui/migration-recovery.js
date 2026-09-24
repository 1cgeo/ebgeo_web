// Path: js/ui/migration-recovery.js
import { registrarUso, descarregarUso } from '@js/session/uso-lote.js';
import { EventoDeUso, PropDeUso } from '@js/session/eventos-de-uso.js';
import { relatarErro } from '@js/session/erro-telemetria.js';
import { OrigemDeErro } from '@js/session/origens-de-erro.js';
import { instalarMonitoramentoDePendencias } from '@js/session/pendencias-monitoramento.js';
import { createTabLock, noneKey } from '../utilities/tab-lock.js';
import { LateResult, absorbLateLegacyChangesNow, legacyHasChanged } from '../store/migration/legacy-transition.js';
import {
    ReparoAutomatico, prepareLegacyTransitionResiliente, recuperarAlteracoesTardias
} from '../store/migration/transicao-resiliente.js';
// Direct, never through `@utils`: the barrel drags the store into the three pages that boot without it.
import { showToast } from '../utilities/toast_service.js';
import { pruneAbandonedCopies } from '../store/migration/legacy-cleanup.js';
import { apontarParaORecuperado } from '../store/migration/abrir-recuperado.js';
import {
    APAGANDO, BAIXANDO, BAIXAR_LABEL, CONTINUAR_CANCELAR_LABEL, CONTINUAR_CONFIRMAR_LABEL,
    CONTINUAR_LABEL, SAIDAS, alteracoesGuardadasEm, apagarBloqueado, apagarConcluido,
    apagarConfirmacao, baixarFalhou, baixouComoCopiaBruta, baixouComoEbgeo, causaDaFalha
} from './migration-recovery-phrases.js';
import { MigrationRecoveryError } from '../store/migration/transition-state.js';
import { createDeferredScreen } from './deferred-screen.js';

let screen = null;
let covered = [];
let watching = false;

/**
 * How long the notice about a rescued atlas stays on screen.
 *
 * FOUR TIMES THE DEFAULT, and the number comes from what it replaced: until 2026-09-22 this fact
 * was a screen that stopped the boot until the person acted on it. A toast that says where their
 * work went has to outlive the map finishing its first draw, or the one thing they needed to read
 * is gone before there is anything to read it against.
 * @type {number}
 */
const AVISO_DE_RESGATE_MS = 12000;

/**
 * The boot curtain (`#initial-loader`) a screen of this module took down, and where it stood.
 *
 * THE PROGRESS CARD IS A PAUSE IN THE BOOT, NOT ITS END. The curtain covers the page until the
 * page itself says it is ready: on the map that is `renderBootMap` (`map_sig.js`), after
 * `switchMap` has created the feature sources. Until 2026-09-23 the card removed it for good, so
 * when the gate SUCCEEDED the rest of the boot ran uncovered, with the toolbar live and no feature
 * source yet: a point drawn in that window vanished, silently or under a false "the map is no
 * longer open" notice. The copy of a `main` archive always shows the card, so every person
 * arriving with data went through it. The recovery screen never gives the curtain back, because
 * that boot stops there. Guard: `tests/e2e-ui/migracao-cortina-do-boot.repro.spec.js`.
 * @type {{ element: Element, parent: Node, next: Node|null }|null}
 */
let bootCurtain = null;

function takeDownBootCurtain() {
    const loader = document.getElementById('initial-loader');
    if (!loader) return;
    bootCurtain = { element: loader, parent: loader.parentNode, next: loader.nextSibling };
    loader.remove();
}

function restoreBootCurtain() {
    const saved = bootCurtain;
    bootCurtain = null;
    if (!saved?.parent) return;
    const next = saved.next?.parentNode === saved.parent ? saved.next : null;
    saved.parent.insertBefore(saved.element, next);
}

function closeScreen() {
    screen?.remove();
    screen = null;
    for (const [element, inert] of covered) element.inert = inert;
    covered = [];
}

function makeScreen(title, message) {
    closeScreen();
    takeDownBootCurtain();
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

function button(card, label, action, text, extraClass = '') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = extraClass ? `ebgeo-unavailable__btn ${extraClass}` : 'ebgeo-unavailable__btn';
    element.textContent = label;
    element.addEventListener('click', async () => {
        element.disabled = true;
        try { await action(); } catch (error) { text.textContent = error.message; } finally { element.disabled = false; }
    });
    card.append(element);
    return element;
}

/**
 * Hands a blob to the browser as a download, from inside the card.
 * @param {HTMLElement} card - Card of the recovery screen.
 * @param {Blob} blob - Bytes to save.
 * @param {string} nome - File name, which is what tells the person WHICH of the two they got.
 */
function entregarArquivo(card, blob, nome) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    card.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * "Baixar meus dados": the `.ebgeo` when this computer holds one atlas, the raw copy otherwise.
 *
 * THE ORDER IS THE DECISION, and it is the half of the owner's rule that is easy to lose. The
 * `.ebgeo` is a file the person can reopen by themselves, in Importar atlas; the raw copy is not,
 * and since this screen stopped offering to restore one, handing it over silently would leave
 * them holding a file only the EBGeo team can read. So the `.ebgeo` is tried FIRST, and when it
 * is not possible the sentence says which one arrived and why the other did not.
 *
 * @param {HTMLElement} card - Card of the recovery screen.
 * @param {HTMLElement} text - Paragraph the screen speaks through.
 * @returns {Promise<void>}
 */
async function baixarMeusDados(card, text) {
    text.textContent = BAIXANDO;
    let motivo = 'leitura_falhou';
    try {
        const { construirEbgeoDeRecuperacao } = await import('../store/migration/ebgeo-de-recuperacao.js');
        const { blob, nome } = await construirEbgeoDeRecuperacao();
        entregarArquivo(card, blob, nome);
        text.textContent = baixouComoEbgeo(nome);
        return;
    } catch (falha) {
        motivo = falha?.code ?? 'leitura_falhou';
        console.warn('Recuperação: o arquivo .ebgeo não pôde ser montado.', motivo, falha?.message);
    }
    try {
        const { buildRecoveryArchive } = await import('../store/migration/recovery-archive.js');
        const blob = await buildRecoveryArchive();
        const nome = `ebgeo-recuperacao-${new Date().toISOString().slice(0, 10)}.zip`;
        entregarArquivo(card, blob, nome);
        text.textContent = baixouComoCopiaBruta(nome, motivo);
    } catch (falha) {
        text.textContent = baixarFalhou(falha?.message ?? String(falha));
    }
}

/**
 * Draws the one destructive command of this screen: emptying this computer so the product opens.
 *
 * THE COMMAND IS ALWAYS DRAWN AND THE CLICK IS WHAT REFUSES, which is the house rule for a block
 * by STATE (`.claude/rules/architecture.md`, §UI Architecture): the only reason it can refuse is
 * another window holding a database open, which is reversible by the person reading the refusal.
 * So it never carries the `disabled` property as a gate, because a disabled button fires no click
 * and the click is how the reason reaches the person.
 *
 * IT ASKS ONCE, and the question names the SIZE. The count comes from the inventory read at that
 * instant, not from the journal, so the number on the screen is the number on the disk. It used to
 * ask twice, for a gesture that deleted only the old copy; the owner's rule of 2026-09-22 made it
 * the whole origin and a single question, because two questions in front of the only way forward
 * is a toll, not a safeguard.
 *
 * @param {HTMLElement} card - Card of the recovery screen.
 * @param {HTMLElement} text - Paragraph the screen speaks through.
 * @returns {HTMLButtonElement} The command, for a caller that wants to observe it.
 */
function continuarCommand(card, text) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'ebgeo-unavailable__btn ebgeo-unavailable__btn--danger';
    element.dataset.testid = 'migration-continue';
    element.textContent = CONTINUAR_LABEL;
    let asking = null;

    element.addEventListener('click', async () => {
        if (asking) return;
        // WHILE THE QUESTION IS ON SCREEN THE COMMAND STEPS ASIDE: the confirmation row draws its
        // own red button, and two red buttons one above the other read as two different acts
        // (seen on the 2026-09-22 capture). Hidden, not removed, so the cancel puts it back.
        element.hidden = true;
        try {
            asking = await askToWipe(card, text, () => { asking = null; element.hidden = false; });
        } catch (failure) {
            asking = null;
            element.hidden = false;
            text.textContent = failure.message;
        }
    });

    card.append(element);
    return element;
}

/**
 * The second step: the size, the warning, and the two ways out.
 *
 * @param {HTMLElement} card - Card of the recovery screen.
 * @param {HTMLElement} text - Paragraph the screen speaks through.
 * @param {() => void} done - Called when the step closes, either way.
 * @returns {Promise<HTMLElement>} The row holding the two buttons.
 */
async function askToWipe(card, text, done) {
    const { inventarioParaApagar } = await import('../store/migration/apagar-acervo-local.js');
    const inventario = await inventarioParaApagar();
    const previous = text.textContent;
    text.textContent = apagarConfirmacao(inventario);
    const row = document.createElement('div');
    row.dataset.testid = 'migration-continue-confirm';
    card.append(row);
    const close = () => { row.remove(); done(); };

    button(row, CONTINUAR_CONFIRMAR_LABEL, async () => {
        text.textContent = APAGANDO;
        try {
            const { apagarAcervoLocal } = await import('../store/migration/apagar-acervo-local.js');
            const resultado = await apagarAcervoLocal();
            if (resultado.bloqueados.length > 0) {
                text.textContent = apagarBloqueado(resultado.bloqueados.length);
                close();
                return;
            }
            text.textContent = apagarConcluido(resultado);
            close();
            window.location.reload();
        } catch (failure) {
            text.textContent = failure.message;
            close();
        }
    }, text, 'ebgeo-unavailable__btn--danger');
    button(row, CONTINUAR_CANCELAR_LABEL, () => {
        text.textContent = previous;
        close();
    }, text);
    return row;
}

/**
 * THE SCREEN IS ONE AND HAS TWO COMMANDS (owner's decision, 2026-09-22).
 *
 * Every `code` keeps its own cause sentence, because what happened is the only part the person can
 * act on; what they may DO is always the same two things. What left: "Tentar novamente" (the
 * repairs it stood for are now automatic, so a retry that changes nothing is a button that teaches
 * people to press buttons), "Preparar uma nova cópia" and "Recuperar alterações em outro atlas"
 * (taken by the code, before this screen is drawn), "Salvar cópia de recuperação" (absorbed by
 * "Baixar meus dados", which tries the `.ebgeo` first), and "Abrir cópia de recuperação" with
 * "Restaurar como outro atlas" (the owner was told the price: restoring a raw copy is no longer
 * self-service).
 *
 * @param {{ code?: string, name?: string, cause?: { name?: string } }} [error] - What sent us here.
 */
export function showMigrationRecovery(error = {}) {
    const quota = error.name === 'QuotaExceededError' || error.cause?.name === 'QuotaExceededError';
    const causa = causaDaFalha(quota ? 'quota' : error.code);
    const { card, text } = makeScreen('Recuperar seus dados', `${causa} ${SAIDAS}`);
    button(card, BAIXAR_LABEL, () => baixarMeusDados(card, text), text);
    // LAST, AND DELIBERATELY: it is the only command here that destroys anything, so the way of
    // saving the data comes before it on the screen.
    continuarCommand(card, text);
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

/**
 * Says what an automatic repair did, once the boot is through.
 *
 * ONLY THE RESCUE SPEAKS. A copy that was redone by itself is not news: the person asked for the
 * product to open and it opened, with nothing moved and nothing named differently. A rescue IS
 * news, because their work is safe somewhere they did not put it.
 *
 * THE RESCUED ATLAS IS WHAT OPENS (owner's decision, 2026-09-23): the boot is pointed at it
 * (`store/migration/abrir-recuperado.js`) before the store mounts anything, so the map comes up on
 * the work the person did in the old version instead of leaving them to find it in the list.
 *
 * @param {Array<{ kind: string, entry?: { id?: string, name?: string } }>|undefined} reparos - What was repaired.
 * @param {{ mapa?: boolean }} [opcoes] - `mapa` when this page is the map, the one page that opens it.
 */
async function reportRepairs(reparos, { mapa = false } = {}) {
    for (const reparo of reparos || []) {
        if (reparo.kind !== ReparoAutomatico.ALTERACOES_RECUPERADAS) continue;
        registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_CONFLITO);
        descarregarUso();
        let apontado = false;
        try {
            apontado = await apontarParaORecuperado(reparo.entry);
        } catch (falha) {
            // The rescue itself is done and safe; failing to point at it costs only the shortcut.
            console.warn('Atualização local: o atlas recuperado não pôde ser aberto direto.', falha?.message);
        }
        showToast(alteracoesGuardadasEm(reparo.entry?.name ?? 'recuperado', { aberto: apontado && mapa }),
            'info', { duration: AVISO_DE_RESGATE_MS });
    }
}

/**
 * @param {{ mapa?: boolean }} [opcoes] - `mapa` on the map page (`index.js`): the rescued atlas
 *   opens there, and the notice says so. The other three pages only move the pointer.
 * @returns {Promise<boolean>}
 */
export async function runLegacyUpgradeGate({ mapa = false } = {}) {
    registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_INICIO);
    descarregarUso();
    // ARMED, not drawn: on a machine with nothing to migrate this gate settles in a fraction of a
    // second, and the card used to flash on every boot. See `deferred-screen.js`.
    const progress = createDeferredScreen({
        message: 'Verificando a atualização dos dados locais…',
        show: (message) => makeScreen('Preparando seus dados', message),
    });
    const probe = createTabLock({ key: noneKey(), overlayHost: null, autoPulse: false });
    try {
        await probe.acquire(noneKey(), { settleMs: 100 });
        if (probe.legacyPeerDetected) throw new MigrationRecoveryError('legacy_tab', 'Há uma janela da versão antiga aberta.');
        // RESILIENTE: the repairs this screen used to ask the person to choose are taken here,
        // within a budget, and the screen below is what is left when they did not work. See
        // `store/migration/transicao-resiliente.js`.
        const result = await prepareLegacyTransitionResiliente({ onProgress: ({ copied, total }) => {
            progress.setText(`Copiando e verificando seus dados: ${copied} de ${total} registros. Aguarde a conclusão.`);
            // A copy tick means the wait is REAL: the person's data is being rewritten, so say so now.
            progress.showNow();
        } });
        // Cancel BEFORE anything else awaits: a timer firing during the sweep below would draw the
        // progress card over a boot that already succeeded.
        progress.cancel();
        closeScreen();
        // The boot goes on from here, so it goes on covered, as it would had the card never shown.
        restoreBootCurtain();
        await reportRepairs(result?.reparos, { mapa });
        reportLateOutcome(result?.late);
        registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_SUCESSO);
        descarregarUso();
        instalarMonitoramentoDePendencias();
        await sweepAbandonedCopies();
        return true;
    } catch (error) {
        // Same reason, other exit: a late timer would REPLACE the recovery screen drawn below.
        progress.cancel();
        if (error.code === 'legacy_tab') registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_ABA_ANTIGA);
        else if (error.code === 'legacy_changes') registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_CONFLITO);
        else if (error instanceof MigrationRecoveryError) registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_FALHA);
        else registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_STORAGE_ERROR);
        descarregarUso();
        relatarErro(new Error(error.code === 'legacy_tab' ? 'Atualização local: versão antiga aberta' : 'Atualização local interrompida'), { origem: OrigemDeErro.BOOT });
        console.warn('Atualização local interrompida:', error.name, error.code || 'storage_error');
        showMigrationRecovery(error);
        return false;
    } finally { probe.destroy(); }
}

/**
 * The notice for late legacy changes that could not be absorbed YET is said once per page, until
 * an absorption happens: the watcher runs on every focus, and repeating the toast would turn a
 * fact into noise.
 */
let deferredNoticeShown = false;

/**
 * What the person hears about an absorption of late legacy changes (`absorbLateLegacyChanges`).
 *
 * ABSORBED IS SILENT ON PURPOSE, apart from the telemetry: the owner's rule is that the trivial case
 * resolves itself, and the evidence of it is the map showing the work, not a message about it.
 * DEFERRED speaks, because the change is real and is not on screen yet: the atlas is open in a tab
 * (possibly this one) and writing under a running editor would be undone by its next save.
 *
 * @param {{ outcome: string }|undefined} late - The outcome, when there was a late change at all.
 */
function reportLateOutcome(late) {
    if (!late) return;
    if (late.outcome === LateResult.ABSORBED) {
        deferredNoticeShown = false;
        registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_JUNCAO);
        descarregarUso();
    } else if (late.outcome === LateResult.DEFERRED && !deferredNoticeShown) {
        deferredNoticeShown = true;
        showToast('A versão antiga gravou alterações. Elas entram neste atlas ao recarregar a página, desde que nenhuma outra aba esteja com ele aberto.', 'info');
    }
}

/**
 * @param {{ abrirAtlas?: (atlasId: string) => Promise<{ ok?: boolean }> }} [opcoes] - On the map
 *   page, how to switch to the rescued atlas LIVE (`switchAtlas`, which this module cannot import:
 *   it would drag the store into the three pages that boot without it). Without it, the pointer
 *   moves and the rescued atlas is what the map opens next.
 */
export function watchLegacyChanges({ abrirAtlas = null } = {}) {
    if (watching) return;
    watching = true;
    let running = false;
    const check = async () => {
        if (running || screen || document.visibilityState === 'hidden') return;
        running = true;
        try {
            if (!await legacyHasChanged()) return;
            const late = await absorbLateLegacyChangesNow();
            if (late.outcome === LateResult.CONFLICT) {
                // THE SAME REPAIR THE BOOT TAKES, and for the same reason: the conservative answer
                // is the only one that never loses work, so it is taken instead of offered. The
                // screen is what is left when taking it did not work.
                registrarUso(EventoDeUso.MIGRACAO_RESULTADO, PropDeUso.MIGRACAO_CONFLITO);
                descarregarUso();
                let entry;
                try {
                    entry = await recuperarAlteracoesTardias();
                } catch (falha) {
                    console.warn('Atualização local: não foi possível guardar as alterações da versão antiga.', falha?.message);
                    showMigrationRecovery({ code: 'legacy_changes' });
                    return;
                }
                // THE RESCUED ATLAS OPENS (owner's decision, 2026-09-23), live on the map, by
                // pointer elsewhere. A failure here costs the shortcut, never the rescue.
                let aberto = false;
                try {
                    if (abrirAtlas) aberto = (await abrirAtlas(entry.id))?.ok === true;
                    else await apontarParaORecuperado(entry);
                } catch (falha) {
                    console.warn('Atualização local: o atlas recuperado não pôde ser aberto direto.', falha?.message);
                }
                showToast(alteracoesGuardadasEm(entry?.name ?? 'recuperado', { aberto }), 'info', { duration: AVISO_DE_RESGATE_MS });
                // AFTER the switch: the Recuperado this one superseded was just unmounted, and the
                // sweep drops it only if nobody worked in it (`legacy-cleanup.js`).
                await sweepAbandonedCopies();
                return;
            }
            reportLateOutcome(late);
        } catch (error) { showMigrationRecovery(error); } finally { running = false; }
    };
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
}

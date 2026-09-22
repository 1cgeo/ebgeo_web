// Path: js/ui/migration-recovery-phrases.js

/**
 * @fileoverview The words of the recovery screen, which since 2026-09-22 has TWO commands and
 * many causes (owner's decision of that date, which supersedes the seven-command screen of D8).
 *
 * THE SCREEN IS ONE, THE SENTENCES ARE SEVERAL. Every way the local upgrade can end on this
 * screen keeps its own cause sentence, because "what happened" is the only thing the person can
 * act on; what they may DO about it is always the same two things, so the labels are constants
 * and not a table. Before this, each cause grew its own command and the screen reached seven,
 * of which four asked the person to choose between repairs they had no way to judge.
 *
 * A LEAF WITH ZERO IMPORTS, like every other phrase module of a destructive act in this
 * repository (`producer-scope-phrases.js` and its siblings under `admin/`), so the wording is
 * testable in node without a screen, a store or a browser.
 *
 * THE RULE THAT BINDS THE DESTRUCTIVE HALF: the number the confirmation says is the number the
 * inventory just counted, never an estimate and never a rounding. "Continuar" is the only gesture
 * in the product that deletes an acervo the person cannot get back, and a confirmation that names
 * a wrong size is the one thing worse than no confirmation at all.
 *
 * THE RULE THAT BINDS THE OTHER HALF: the sentence names WHICH of the two files was delivered and
 * why the other one was not. The `.ebgeo` is the one the person can open by themselves; the raw
 * copy is not, and a screen that hands over the second while sounding like the first teaches them
 * that they are safe when they are not.
 */

/** Label of the command that saves, which always comes first. */
export const BAIXAR_LABEL = 'Baixar meus dados';

/** Label of the destructive command, which always comes last. */
export const CONTINUAR_LABEL = 'Continuar';

/** Label of the second, irreversible step. */
export const CONTINUAR_CONFIRMAR_LABEL = 'Apagar e abrir o EBGeo';

/** Label of the way out of the second step. */
export const CONTINUAR_CANCELAR_LABEL = 'Manter meus dados';

/** What the screen says while the file is being prepared. */
export const BAIXANDO = 'Preparando o arquivo com os seus dados…';

/** What the screen says while the deletion runs. */
export const APAGANDO = 'Apagando os dados deste computador…';

/**
 * The fixed second paragraph: the two ways out, named in the order they appear on the card.
 *
 * It is separate from the cause so that the cause table stays a table of FACTS. A sentence that
 * mixed "what happened" with "what you can do" would have to be rewritten in twelve places the
 * day a command changes, which is how the old screen ended up promising a button it no longer had.
 */
export const SAIDAS = 'Há duas saídas: baixar uma cópia dos seus dados para guardar, '
    + 'ou continuar, o que apaga os dados deste computador e abre o EBGeo limpo.';

/**
 * Why the screen is here, by the `code` of the error that reached it.
 *
 * `api_unavailable` is in the table although it is not a failure of the update: it is the code
 * the unavailable screen uses when the person asks to recover the data of this computer, and a
 * screen that switched voices between "the update broke" and "the server did not answer" would
 * be describing a defect that is not there.
 */
const CAUSAS = Object.freeze({
    legacy_tab: 'Há uma janela do EBGeo com a versão antiga aberta neste computador, e ela pode '
        + 'gravar por cima da atualização. Feche a outra janela e recarregue esta página: nada '
        + 'precisa ser apagado para isso.',
    legacy_changes: 'A versão antiga gravou alterações que não puderam ser guardadas sozinhas em '
        + 'outro atlas. Baixe seus dados antes de continuar.',
    source_changed: 'Os dados antigos mudaram durante a atualização, e refazer a cópia não bastou. '
        + 'Em geral é outra janela do EBGeo gravando neste computador.',
    copy_failed: 'A cópia dos seus dados não passou na verificação, mesmo depois de ser refeita.',
    lock_unavailable: 'Este navegador não permite coordenar a atualização entre janelas com '
        + 'segurança. Abrir o EBGeo por localhost ou por HTTPS costuma resolver.',
    migration_failed: 'A atualização dos dados não pôde ser concluída.',
    unknown_version: 'Não foi possível identificar a versão dos dados guardados neste computador.',
    unsupported_version: 'Os dados guardados neste computador são de uma versão que esta '
        + 'instalação não sabe atualizar.',
    unreadable: 'O registro da atualização está ilegível, então não dá para saber em que ponto '
        + 'ela parou.',
    ambiguous_registry: 'Mais de um atlas aponta para os mesmos dados antigos, e não dá para '
        + 'decidir qual deles é o seu.',
    drop_blocked: 'Outra janela do EBGeo ainda mantém estes dados abertos.',
    quota: 'Não há espaço neste computador para concluir a atualização. Baixe seus dados e '
        + 'libere espaço antes de continuar.',
    api_unavailable: 'O servidor do EBGeo não respondeu, então o mapa não abre. Os dados deste '
        + 'computador continuam aqui.'
});

/** What the screen says when it does not recognise the code it was given. */
const CAUSA_DESCONHECIDA = 'Não foi possível abrir o acervo com segurança. '
    + 'Os dados deste computador continuam aqui.';

/**
 * @param {string} code - Code of the `MigrationRecoveryError`, or `'quota'` for a storage quota.
 * @returns {string} The cause sentence, never empty: an unrecognised code falls back to the
 *   generic one instead of leaving the card mute. Read with `Object.hasOwn`, because the value
 *   comes from outside: `CAUSAS[code]` answers `Object.prototype.toString` for a code named
 *   `toString`, and `Object.freeze` does not protect against that.
 */
export function causaDaFalha(code) {
    return Object.hasOwn(CAUSAS, code) ? CAUSAS[code] : CAUSA_DESCONHECIDA;
}

/**
 * @param {number} registros - How many records the acervo holds.
 * @returns {string} The plural-aware count.
 */
function contagemDeRegistros(registros) {
    return registros === 1 ? '1 registro' : `${registros} registros`;
}

/**
 * @param {number} atlas - How many local atlas slots are registered.
 * @returns {string} The plural-aware count.
 */
function contagemDeAtlas(atlas) {
    return atlas === 1 ? '1 atlas' : `${atlas} atlas`;
}

/**
 * The sentence the person reads BEFORE the irreversible step.
 *
 * @param {Object} inventario - What the inventory just counted.
 * @param {number} inventario.registros - Records across every acervo on this origin.
 * @param {number} inventario.atlas - Local atlas slots that will go with them.
 * @returns {string} Confirmation naming the size, and that there is no undo.
 */
export function apagarConfirmacao({ registros, atlas } = {}) {
    const semNumero = !Number.isFinite(registros) || registros < 0;
    if (semNumero) {
        return 'Isto apaga os dados do EBGeo guardados neste computador, e não há como desfazer. '
            + 'Baixe seus dados antes, se ainda não baixou.';
    }
    if (registros === 0) {
        return 'Não há registros do EBGeo para apagar neste computador. '
            + 'Continuar apenas abre o EBGeo limpo.';
    }
    const onde = Number.isFinite(atlas) && atlas > 0
        ? `, em ${contagemDeAtlas(atlas)},`
        : '';
    return `Isto apaga ${contagemDeRegistros(registros)}${onde} deste computador, e não há como `
        + 'desfazer. Baixe seus dados antes, se ainda não baixou.';
}

/**
 * @param {Object} resultado - What the deletion reported.
 * @param {number} resultado.registros - Records that were deleted.
 * @returns {string} What the screen says afterwards, naming the same number.
 */
export function apagarConcluido({ registros } = {}) {
    if (!Number.isFinite(registros) || registros <= 0) {
        return 'Os dados do EBGeo saíram deste computador. Abrindo o EBGeo…';
    }
    return `${contagemDeRegistros(registros)} saíram deste computador. Abrindo o EBGeo…`;
}

/**
 * @param {number} bancos - How many databases refused to be deleted.
 * @returns {string} Why nothing was opened, and what the person can do about it. The command stays
 *   on the screen, because the state is reversible by the person reading this.
 */
export function apagarBloqueado(bancos) {
    const quantos = Number.isFinite(bancos) && bancos > 0
        ? (bancos === 1 ? '1 banco de dados' : `${bancos} bancos de dados`)
        : 'algum banco de dados';
    return `Outra janela do EBGeo ainda mantém ${quantos} aberto neste computador, então nada foi `
        + 'apagado. Feche as outras janelas do EBGeo e clique de novo.';
}

/**
 * @param {string} nome - File name that was downloaded.
 * @returns {string} What the screen says when the person got the file they can reopen themselves.
 */
export function baixouComoEbgeo(nome) {
    return `Seus dados foram baixados como “${nome}”. Esse arquivo é um atlas do EBGeo: guarde-o, `
        + 'e depois abra-o pelo próprio produto, em Importar atlas.';
}

/**
 * Why a `.ebgeo` could not be built, by the code `construirEbgeoDeRecuperacao` refused with.
 *
 * Each sentence is a CLAUSE, lowercase and ending in a period, because it is read inside the
 * sentence below and never on its own.
 */
const SEM_EBGEO = Object.freeze({
    varios_acervos: 'há mais de um atlas neste computador, e um arquivo .ebgeo guarda um atlas só.',
    sem_acervo: 'não há um atlas legível neste computador.',
    leitura_falhou: 'a leitura do atlas falhou.'
});

/**
 * @param {string} motivo - Code of the refusal.
 * @returns {string} The clause, falling back to the generic one for a code this module does not
 *   know. Read with `Object.hasOwn`, for the reason given in {@link causaDaFalha}.
 */
export function motivoSemEbgeo(motivo) {
    return Object.hasOwn(SEM_EBGEO, motivo) ? SEM_EBGEO[motivo] : SEM_EBGEO.leitura_falhou;
}

/**
 * @param {string} nome - File name that was downloaded.
 * @param {string} motivo - Code of the refusal that sent the person here.
 * @returns {string} What the screen says when only the raw copy was possible. IT SAYS THE RAW COPY
 *   IS NOT SELF-SERVICE, because since this screen stopped offering to restore one, a person who
 *   reads it as "my atlas, saved" would be keeping a file they cannot open.
 */
export function baixouComoCopiaBruta(nome, motivo) {
    return `Não deu para montar um arquivo .ebgeo: ${motivoSemEbgeo(motivo)} `
        + `Seus dados foram baixados como “${nome}”, uma cópia bruta que preserva tudo, mas que `
        + 'só a equipe do EBGeo consegue reabrir. Guarde o arquivo.';
}

/**
 * What the person hears when the late changes of the old version were moved on their behalf.
 *
 * IT NAMES THE ATLAS, and that is the whole reason it is a sentence and not a silence: the work is
 * safe but it is no longer where the person left it, and an atlas they cannot name is an atlas
 * they will not look for. Before 2026-09-22 this was a screen that stopped the boot to ask.
 *
 * @param {string} nome - Name of the local atlas that was created.
 * @returns {string}
 */
export function alteracoesGuardadasEm(nome) {
    return `As alterações feitas na versão antiga foram guardadas no atlas “${nome}”. `
        + 'Ele está na sua lista, em Seus atlas.';
}

/**
 * @param {string} mensagem - Message of the failure, for the person to relay.
 * @returns {string} What the screen says when NEITHER file could be produced.
 */
export function baixarFalhou(mensagem) {
    return 'Não foi possível preparar nenhum arquivo com os seus dados neste computador. '
        + `Anote o que segue antes de continuar: ${mensagem}`;
}

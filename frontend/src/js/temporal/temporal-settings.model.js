// Path: js/temporal/temporal-settings.model.js

/**
 * @fileoverview AS DECISÕES PURAS DA ENGRENAGEM TEMPORAL: a janela que a pessoa digitou é
 * aceitável, e o "Reagendar" ganhou o direito de gravar o novo Dia D.
 *
 * POR QUE ELAS SAÍRAM DO MODAL. As duas moravam dentro de `temporal-settings.modal.js`, que só é
 * alcançável com DOM e com o barril da store, então nenhuma delas tinha teste em node e as duas
 * estavam erradas de formas que um teste pegaria na primeira linha:
 *
 * 1. `fim <= inicio` era consertado em SILÊNCIO no modo relativo e gravado CRU no absoluto, com o
 *    modal fechando como se tivesse salvo nos dois casos. Uma janela invertida gravada some a
 *    feição do 3D, do 360 e da legenda do PDF, porque nenhum cursor passa no predicado. Aqui a
 *    inversão é RECUSADA nos dois modos, nomeando o campo, e quem chama mantém a tela aberta.
 * 2. "Reagendar" gravava a nova origem INCONDICIONALMENTE, ignorando o retorno do deslocamento
 *    das feições. Num mapa travado nenhuma feição andava e o Dia D andava para todos, com o aviso
 *    na tela dizendo que a escrita tinha sido recusada. `decisaoDoReagendamento` é quem responde
 *    se a origem pode ser gravada, e ela responde a partir do que o deslocamento DE FATO fez.
 *
 * O VOCABULÁRIO DOS TRÊS DESFECHOS DO DESLOCAMENTO vem de `TemporalControl.shiftFeatureTimes`, que
 * devolve `{changed, hadCandidates}` justamente porque zero tem DUAS causas: o mapa não tinha nada
 * cronometrado, ou a escrita foi recusada (papel baixo ou mapa travado). Confundi-las é o defeito
 * que esta separação existe para impedir.
 *
 * ZERO IMPORTS além das constantes de modo (que por sua vez não importam nada): é o que mantém
 * este arquivo carregável em node puro, sem store, sem DOM e sem MapLibre.
 */

import { TEMPORAL_MODES } from './temporal.constants.js';

/** Por que o deslocamento das feições terminou como terminou. */
export const MOTIVO_REAGENDAMENTO = Object.freeze({
    /** O controle temporal não estava montado: nada foi sequer tentado. */
    SEM_CONTROLE: 'sem-controle',
    /** Havia feição cronometrada e nenhuma andou: a store recusou a escrita. */
    RECUSADO: 'recusado',
    /** Feições andaram no tempo. */
    DESLOCADAS: 'deslocadas',
    /** O mapa não tinha nada cronometrado: mover o Dia D é só trocar a lente. */
    NADA_A_DESLOCAR: 'nada-a-deslocar',
});

/**
 * Normaliza para epoch ms ou ausência. `null`, `undefined`, `NaN` e `Infinity` são todos
 * "não informado": `x ?? null` deixaria `NaN` passar, e `NaN` grava uma janela que nenhum
 * predicado aceita.
 * @param {*} valor - Candidato a instante.
 * @returns {number|null}
 * @private
 */
function instanteOuNulo(valor) {
    return Number.isFinite(valor) ? valor : null;
}

/**
 * Decide o patch de configuração que "Salvar" deve gravar, ou recusa nomeando o campo.
 *
 * As bordas absolutas são a fonte da verdade nos DOIS modos; os offsets D+N do modo relativo são
 * lente, e por isso o que se valida é sempre o par (inicio, fim) em epoch ms. Campo em branco é
 * legítimo (significa "automático a partir das feições"), então a inversão só é acusada quando os
 * DOIS lados existem.
 *
 * @param {{modo: string, unidade: string, inicio: (number|null), fim: (number|null), dDate: (number|null)}} pendente
 *   O que está na tela.
 * @param {{origemFallback: (number|null), unitMs: number}} contexto - A origem a usar quando a
 *   pessoa não informou "Data de D", e o tamanho da unidade em ms (para a janela padrão).
 * @returns {{ok: true, patch: Object}|{ok: false, campo: string, mensagem: string}}
 */
export function resolverPatchDaConfig(pendente, { origemFallback = null, unitMs = 0 } = {}) {
    const modo = pendente?.modo === TEMPORAL_MODES.RELATIVO
        ? TEMPORAL_MODES.RELATIVO
        : TEMPORAL_MODES.ABSOLUTO;
    const unidade = pendente?.unidade;

    if (modo === TEMPORAL_MODES.RELATIVO) {
        // A origem é obrigatória no relativo: ela é o zero do eixo D+N.
        const origem = instanteOuNulo(pendente?.dDate) ?? instanteOuNulo(origemFallback);
        if (origem === null) {
            return {
                ok: false,
                campo: 'origem',
                mensagem: 'Informe a "Data de D (origem)" para usar o modo relativo.',
            };
        }
        const passo = Number.isFinite(unitMs) && unitMs > 0 ? unitMs : 0;
        const inicio = instanteOuNulo(pendente?.inicio) ?? origem;
        const fim = instanteOuNulo(pendente?.fim) ?? (origem + 30 * passo);
        if (fim <= inicio) {
            return {
                ok: false,
                campo: 'fim',
                mensagem: 'O "Fim" precisa ser posterior ao "Início". Ajuste o offset antes de salvar.',
            };
        }
        return { ok: true, patch: { modo, unidade, inicio, fim, origem } };
    }

    const inicio = instanteOuNulo(pendente?.inicio);
    const fim = instanteOuNulo(pendente?.fim);
    if (inicio !== null && fim !== null && fim <= inicio) {
        return {
            ok: false,
            campo: 'fim',
            mensagem: 'O "Fim do mapa" precisa ser posterior ao "Início do mapa".',
        };
    }
    return { ok: true, patch: { modo, unidade, inicio, fim } };
}

/**
 * Lê o retorno do deslocamento das feições e decide se a nova origem pode ser gravada.
 *
 * A REGRA: a origem só anda se as feições andaram, OU se não havia feição nenhuma para andar. O
 * caso do meio (havia candidata e nenhuma andou) é a recusa da store, e gravar a origem ali faz
 * todo rótulo D+N mentir pelo delta.
 *
 * @param {{changed: number, hadCandidates: boolean}|null|undefined} resultado - O que
 *   `TemporalControl.shiftFeatureTimes` devolveu.
 * @returns {{gravarOrigem: boolean, motivo: string, reagendadas: number}}
 */
export function decisaoDoReagendamento(resultado) {
    if (!resultado || typeof resultado !== 'object') {
        return { gravarOrigem: false, motivo: MOTIVO_REAGENDAMENTO.SEM_CONTROLE, reagendadas: 0 };
    }
    const reagendadas = Number.isFinite(resultado.changed) && resultado.changed > 0
        ? resultado.changed
        : 0;
    if (reagendadas > 0) {
        return { gravarOrigem: true, motivo: MOTIVO_REAGENDAMENTO.DESLOCADAS, reagendadas };
    }
    if (resultado.hadCandidates === true) {
        return { gravarOrigem: false, motivo: MOTIVO_REAGENDAMENTO.RECUSADO, reagendadas: 0 };
    }
    return { gravarOrigem: true, motivo: MOTIVO_REAGENDAMENTO.NADA_A_DESLOCAR, reagendadas: 0 };
}

/**
 * A frase do reagendamento, que só pode ser escrita depois de a gravação da origem ter desfecho.
 *
 * `gravou` é `null` quando a gravação nem foi tentada (a decisão já dizia que não), `true` quando
 * a config foi persistida e `false` quando a store a recusou. O par (motivo, gravou) é o que
 * separa "reagendado" de "metade reagendada", e era essa metade que o aviso anterior não tinha
 * como dizer, porque ele era escrito antes de a gravação acontecer.
 *
 * @param {{gravarOrigem: boolean, motivo: string, reagendadas: number}} decisao
 * @param {{gravou: (boolean|null)}} [desfecho]
 * @returns {{tipo: string, texto: string}} `tipo` é 'success' | 'warning' | 'info'.
 */
export function avisoDoReagendamento(decisao, { gravou = null } = {}) {
    const motivo = decisao?.motivo;
    const n = decisao?.reagendadas ?? 0;
    const plural = n === 1 ? 'feição reagendada' : 'feições reagendadas';

    if (motivo === MOTIVO_REAGENDAMENTO.SEM_CONTROLE) {
        return {
            tipo: 'warning',
            texto: 'O controle temporal não está disponível: nenhuma feição foi reagendada.',
        };
    }
    if (motivo === MOTIVO_REAGENDAMENTO.RECUSADO) {
        return {
            tipo: 'warning',
            texto: 'Nenhuma feição foi reagendada: a escrita foi recusada (permissão insuficiente ou mapa bloqueado). O Dia D continua onde estava.',
        };
    }
    if (motivo === MOTIVO_REAGENDAMENTO.DESLOCADAS) {
        return gravou === true
            ? { tipo: 'success', texto: `${n} ${plural} para o novo Dia D.` }
            : { tipo: 'warning', texto: `${n} ${plural}, mas o novo Dia D não pôde ser salvo.` };
    }
    return gravou === true
        ? { tipo: 'info', texto: 'Nenhuma feição temporal para reagendar; apenas o Dia D foi atualizado.' }
        : { tipo: 'warning', texto: 'Nenhuma feição temporal para reagendar, e o novo Dia D não pôde ser salvo.' };
}

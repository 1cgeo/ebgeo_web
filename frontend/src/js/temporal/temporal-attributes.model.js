// Path: js/temporal/temporal-attributes.model.js

/**
 * @fileoverview The DECISIONS of the temporal attribute panel, as pure functions.
 *
 * The panel itself is DOM: it can only be exercised in a browser, which is why for
 * a long time none of its rules had a guard. Everything here is data in, data out,
 * so each rule is pinned by a node test and the panel keeps only the wiring:
 *
 *  - {@link validarJanela}: an end BEFORE the start is refused (M6/E6). Nothing else
 *    in the product refuses it, and the feature then disappears from the 3D, the 360
 *    and the PDF legend forever, because those three test the cursor against
 *    `inicio <= cursor <= fim` and no cursor satisfies an inverted window.
 *  - {@link decidirTrocaDeInstante}: a keypoint time edit that would change WHICH
 *    keypoint is the anchor is refused (E4). The anchor is the earliest keypoint and
 *    it is bound 1:1 to the feature's start position (`trajectory-anchor.js`), so
 *    re-timing point 3 to before point 1 moves the departure without moving any
 *    geometry, and the next map interaction teleports the feature there.
 *  - {@link derivarCamposDtg}: the auto GDH/DTG amplifiers, INCLUDING the erase
 *    (E8). Deriving only when the instant is finite leaves the previous GDH printed
 *    on a symbol whose window was cleared. It does NOT know about the display lens,
 *    and the note on the function says why that mattered enough to be written down.
 *  - the phrases, so the refusal names the field / the state instead of failing
 *    silently, and so the same sentence can be asserted without a browser.
 *
 * Formatting of an epoch into a human label stays OUT: it depends on the active time
 * lens (absolute date vs D+N offset), which is panel state. The callers pass an
 * already-formatted label into the phrase builders.
 */

import { normalizeTrajectory } from './temporal-model.js';
import { formatDTG } from './temporal.utils.js';

/** The pt-BR names of the two validity bounds, as the panel labels them. */
const ROTULO = Object.freeze({ temporalInicio: 'Início', temporalFim: 'Fim' });

/** A decision that lets the edit through. Frozen: callers only read it. */
const ACEITA = Object.freeze({ aceita: true });

/**
 * Decides whether a validity-window edit may be stored.
 *
 * Clearing a bound is ALWAYS allowed (an empty field means "open on that side", i.e.
 * permanent), and an instantaneous window (`inicio === fim`) is allowed too: it is
 * visible at exactly one instant, which is a legitimate thing to author. Only a
 * strictly inverted window is refused.
 *
 * @param {('temporalInicio'|'temporalFim')} prop - Which bound is being edited.
 * @param {(number|null)} epoch - The proposed value (epoch ms), or null to clear.
 * @param {{temporalInicio: (number|null), temporalFim: (number|null)}} atual - The
 *   window as currently stored (the other bound is read from here).
 * @returns {{aceita: boolean, campo?: string, oposto?: string, limite?: number}}
 *   `aceita: true`, or the refusal with the edited field, the field that conflicts
 *   and the conflicting instant (so the caller can format it under its own lens).
 */
export function validarJanela(prop, epoch, atual) {
    if (!Number.isFinite(epoch)) return ACEITA;
    if (prop !== 'temporalInicio' && prop !== 'temporalFim') return ACEITA;

    const outraProp = prop === 'temporalInicio' ? 'temporalFim' : 'temporalInicio';
    const limite = atual?.[outraProp];
    if (!Number.isFinite(limite)) return ACEITA;

    const invertida = prop === 'temporalInicio' ? epoch > limite : epoch < limite;
    if (!invertida) return ACEITA;

    return { aceita: false, campo: ROTULO[prop], oposto: ROTULO[outraProp], limite };
}

/**
 * The sentence for a refused validity edit. Names the FIELD and the instant that
 * conflicts, because "valor inválido" would send the person looking at the field
 * they just typed instead of at the other one.
 * @param {{campo: string, oposto: string}} decisao - A refusal from {@link validarJanela}.
 * @param {string} rotuloDoLimite - The conflicting instant, already formatted.
 * @returns {string}
 */
export function fraseDeJanelaInvertida(decisao, rotuloDoLimite) {
    const ordem = decisao.campo === 'Início' ? 'depois do' : 'antes do';
    return `${decisao.campo} recusado: ficaria ${ordem} ${decisao.oposto} (${rotuloDoLimite}). `
        + `Ajuste o ${decisao.oposto} primeiro.`;
}

/**
 * The anchor that a trajectory would have if `alvo` were re-timed to `novoInstante`.
 * Mirrors `normalizeTrajectory` on purpose (same filter, same sort over the RAW
 * order, so ties resolve by array position exactly as the real one does) and returns
 * the keypoint OBJECT, which is what identity comparison needs.
 * @param {Array<Object>} trajetoria - The raw keypoint array.
 * @param {Object} alvo - The keypoint being re-timed.
 * @param {number} novoInstante - Its proposed time.
 * @returns {Object|null}
 */
function ancoraDepoisDaTroca(trajetoria, alvo, novoInstante) {
    const candidatos = [];
    for (const kp of trajetoria) {
        if (!kp) continue;
        const t = kp === alvo ? novoInstante : kp.t;
        if (!Number.isFinite(t) || !Number.isFinite(kp.lng) || !Number.isFinite(kp.lat)) continue;
        candidatos.push({ kp, t });
    }
    candidatos.sort((a, b) => a.t - b.t);
    return candidatos[0]?.kp ?? null;
}

/**
 * Decides whether a keypoint may be re-timed to `novoInstante`.
 *
 * REFUSED when the edit would hand the anchor role to another keypoint, in either
 * direction: a later point pulled in front of point 1, or point 1 itself pushed past
 * point 2. The anchor is the feature's departure position, and only the map owns
 * that move (dragging the anchor vertex relocates the feature with it). Re-timing
 * moves the role without moving one metre of geometry, so the feature keeps drawing
 * where it was until the next map interaction persists the trajectory and the
 * feature jumps to the new anchor's coordinates.
 *
 * Takes the keypoint OBJECT, not its row index: the panel deliberately does not
 * re-sort its rows while the person types, so an index captured at render time can
 * already point at another row.
 *
 * @param {Array<Object>|undefined} trajetoria - The raw keypoint array.
 * @param {Object} alvo - The keypoint being edited (an element of `trajetoria`).
 * @param {number} novoInstante - Proposed epoch ms.
 * @returns {{aceita: boolean, causa?: string, motivo?: string}}
 */
export function decidirTrocaDeInstante(trajetoria, alvo, novoInstante) {
    if (!Array.isArray(trajetoria) || !alvo) return ACEITA;
    if (!Number.isFinite(novoInstante)) return ACEITA;

    const ordenada = normalizeTrajectory(trajetoria);
    if (ordenada.length < 2) return ACEITA; // a lone keypoint is always its own anchor

    const posicao = ordenada.indexOf(alvo);
    if (posicao < 0) return ACEITA; // not part of this trajectory: nothing to decide

    const ancoraAtual = ordenada[0];
    const ancoraNova = ancoraDepoisDaTroca(trajetoria, alvo, novoInstante);
    if (ancoraNova === ancoraAtual) return ACEITA;

    const causa = alvo === ancoraAtual ? 'abandonaria_ancora' : 'assumiria_ancora';
    const inicio = causa === 'assumiria_ancora'
        ? `Instante recusado: o ponto ${posicao + 1} ficaria à frente do ponto 1`
        : 'Instante recusado: o ponto 1 deixaria de ser o primeiro';
    return {
        aceita: false,
        causa,
        motivo: `${inicio}, e o ponto 1 é a partida da feição. `
            + 'Para mudar a partida, mova a feição ou arraste o ponto 1 no mapa.',
    };
}

/** The GDH properties each symbol type derives, and the bound each one reads. */
const CAMPOS_DTG = Object.freeze({
    military_symbol: Object.freeze([['dateTimeGroup', 'temporalInicio', 'military']]),
    coordination_measure: Object.freeze([
        ['gdhIni', 'temporalInicio', 'coordination'],
        ['gdhFim', 'temporalFim', 'coordination'],
    ]),
});

/**
 * Derives the auto GDH/DTG amplifiers from a feature's validity window.
 *
 * A INVARIANTE É UMA SÓ: `autoDtg` ligado significa GDH IGUAL À JANELA, sob qualquer
 * lente. Daí a forma: um limite não finito rende a STRING VAZIA em vez de nenhuma
 * entrada (E8), porque apagar o "Início" de um símbolo cujo GDH está vinculado a ele
 * tem de apagar o GDH, senão o símbolo segue imprimindo (e gravando) um grupo
 * data-hora de uma janela que não existe mais.
 *
 * **ESTA FUNÇÃO NÃO CONHECE A LENTE, e isso é a correção de 2026-09-21.** Entre a
 * manhã e a tarde daquele dia ela teve um ramo `relativo` que PAUSAVA a derivação,
 * para casar com o que a caixa da tela dizia. O ramo criava um defeito maior do que o
 * desalinho que consertava: o "Reagendar" só existe no modo RELATIVO (a engrenagem só
 * o desenha ali), então no ÚNICO caminho de produção em que o espelho de
 * `store/feature.operations.js` roda, a rederivação nunca acontecia e o símbolo ficava
 * com o GDH VELHO depois de a janela andar. Um GDH absoluto fresco num mapa D+N é no
 * máximo estranho; um GDH velho é dado ERRADO impresso no símbolo. E o modelo de LENTE
 * PURA da casa já dizia qual das duas vale: `modo`, `unidade` e `origem` são exibição e
 * nunca mudam o comportamento do dado. O que o modo relativo impede é LIGAR ou DESLIGAR
 * o vínculo pela tela ({@link GDH_LIGA_SO_NO_ABSOLUTO}), nunca o vínculo já ligado.
 *
 * Um terceiro argumento é IGNORADO de propósito: era ali que morava `{ relativo }`, e
 * um chamador antigo que ainda o passe não deve reviver a pausa em silêncio.
 *
 * @param {Object} props - Feature properties (autoDtg, temporalInicio, temporalFim).
 * @param {string} featureType - Source type ('military_symbol' / 'coordination_measure').
 * @returns {Object<string, string>} Property → value to write (may be empty).
 */
export function derivarCamposDtg(props, featureType) {
    const p = props || {};
    if (p.autoDtg !== true) return {};
    const defs = CAMPOS_DTG[featureType];
    if (!defs) return {};

    const campos = {};
    for (const [prop, bound, estilo] of defs) {
        const epoch = p[bound];
        campos[prop] = Number.isFinite(epoch) ? formatDTG(epoch, estilo) : '';
    }
    return campos;
}

/**
 * A recusa de ESTADO da caixa de GDH automático sob a lente relativa. O que o modo
 * trava é a TROCA do vínculo, e a frase diz exatamente isso: a derivação em si
 * continua valendo, porque o GDH acompanha a janela sob qualquer lente (ver
 * {@link derivarCamposDtg}). Ela nomeia o estado e a saída, porque o estado é
 * reversível pela própria pessoa: trocar a linha do tempo para o modo absoluto.
 */
export const GDH_LIGA_SO_NO_ABSOLUTO = 'Ligar ou desligar o GDH automático só no modo absoluto. '
    + 'Troque o modo na engrenagem da barra temporal; o vínculo já ligado continua valendo.';

/** The suffix the state-locked binding carries in its own label. */
export const GDH_SUFIXO_SO_ABSOLUTO = '(liga só no modo absoluto)';

/**
 * The confirmation for "Limpar" (E2): clearing a trajectory removes the whole route
 * in one click, so the question has to say how much is leaving.
 *
 * A ÚLTIMA FRASE DIZ QUE DÁ PARA DESFAZER, e ela mudou em 2026-09-21. Até aquele dia
 * ela dizia o contrário ("Esta ação não tem desfazer"), o que era verdade enquanto
 * `updateFeatureProperty` não registrava desfazer; com o `recordUndo` do `persist()`
 * da trajetória, a mesma frase virou mentira. Ficar CALADO sobre o desfazer era a
 * outra saída, e foi recusada: a pergunta chega no instante da hesitação, e quem
 * hesita diante de um diálogo destrutivo presume o pior. Nomear a volta é a
 * informação que falta ali, e ela cita as DUAS portas porque num tablet não há
 * teclado (`map/undo-redo.runner.js` e o botão "Desfazer" da barra existem por isso).
 * A confirmação CONTINUA, porque apagar a rota inteira segue sendo destrutivo e um
 * desfazer que a pessoa não sabe usar não é uma rede.
 *
 * @param {number} quantidade - Keypoints that would be removed.
 * @returns {{titulo: string, mensagem: string}}
 */
export function fraseDeLimpezaDeTrajetoria(quantidade) {
    const n = Number.isFinite(quantidade) && quantidade > 0 ? Math.trunc(quantidade) : 0;
    const pontos = n === 1 ? '1 ponto-chave' : `${n} pontos-chave`;
    return {
        titulo: 'Limpar a trajetória?',
        mensagem: `Isto remove ${pontos} desta feição, que volta a ser estática. `
            + 'Dá para desfazer com Ctrl+Z ou pelo botão Desfazer.',
    };
}

/**
 * The hint that replaced `min`/`max` on the date fields (E11). The old code bounded
 * the native calendar to the timeline window and the comment called it a
 * "highlight": the browser refuses anything outside, so a feature could not be dated
 * outside the extent of the features that already exist, which is precisely the
 * first feature of a new period. The window is information, not a fence.
 * @param {(string|null)} rotuloInicio - Timeline start, already formatted.
 * @param {(string|null)} rotuloFim - Timeline end, already formatted.
 * @returns {string}
 */
export function fraseDaJanelaDaRegua(rotuloInicio, rotuloFim) {
    const base = 'Data e hora exatas.';
    if (rotuloInicio && rotuloFim) {
        return `${base} A linha do tempo vai de ${rotuloInicio} a ${rotuloFim}; fora dela também vale.`;
    }
    if (rotuloInicio) return `${base} A linha do tempo começa em ${rotuloInicio}; antes dela também vale.`;
    if (rotuloFim) return `${base} A linha do tempo termina em ${rotuloFim}; depois dela também vale.`;
    return base;
}

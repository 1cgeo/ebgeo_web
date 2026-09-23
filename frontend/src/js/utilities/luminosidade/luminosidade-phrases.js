// Path: js/utilities/luminosidade/luminosidade-phrases.js

/**
 * @fileoverview Every sentence the light panel and its saved table put on screen.
 *
 * A leaf with ZERO imports. The name ends in `-phrases.js` on purpose: that puts every literal here
 * under `tests/unit/avisos-de-tela-estilo.test.js`.
 *
 * THE LABELS ARE THE MANUAL'S, AS THEY ARE (principle U1 of the proposal): "ICMN", "FCVN", "Fase
 * lunar", "Ini Luar", "Fim do luar", with Quadro 4-5's own capitalization, and the product name
 * of Quadro 2-1, "Matriz das condições meteorológicas". The three twilight tooltips are the text of
 * EB70-MC-10.336 item 4.3.3.3.3 a, VERBATIM: it is the sentence that turns a time into a decision.
 */

/** The panel's title, and the context menu item. */
export const TITULO_DO_PAINEL = 'Luminosidade';
export const ROTULO_DO_ITEM_DE_MENU = 'Luminosidade neste ponto';

/** The table caption, which a screen reader announces first. */
export const LEGENDA_DO_QUADRO = 'Dados de luminosidade (PITCIC, Quadro 4-5)';

/** The two row groups of Quadro 4-5. */
export const GRUPO_SOLAR = 'Dados solares';
export const GRUPO_LUNAR = 'Dados lunares';

/**
 * The five doctrinal fields, in Quadro 4-5's order.
 * @type {ReadonlyArray<{chave: string, grupo: string, rotulo: string, expansao: string}>}
 */
export const CAMPOS_DO_QUADRO = Object.freeze([
    Object.freeze({ chave: 'icmn', grupo: GRUPO_SOLAR, rotulo: 'ICMN', expansao: 'Início do Crepúsculo Matutino Náutico' }),
    Object.freeze({ chave: 'fcvn', grupo: GRUPO_SOLAR, rotulo: 'FCVN', expansao: 'Fim do Crepúsculo Vespertino Náutico' }),
    Object.freeze({ chave: 'fase', grupo: GRUPO_LUNAR, rotulo: 'Fase lunar', expansao: 'Fase da Lua no meio da noite de D, pela janela de sete dias da Fig 4-11' }),
    Object.freeze({ chave: 'nasce', grupo: GRUPO_LUNAR, rotulo: 'Ini Luar', expansao: 'Nascer da Lua que ilumina a noite de D' }),
    Object.freeze({ chave: 'poe', grupo: GRUPO_LUNAR, rotulo: 'Fim do luar', expansao: 'Ocaso da mesma passagem da Lua' }),
]);

/** The collapsible block with the whole of Fig 4-10. */
export const TITULO_DA_FIG_4_10 = 'Crepúsculos e claridade (Fig 4-10)';

/**
 * The eight rows of Fig 4-10, keyed like the model's Sun events, with the twilight each row opens
 * (morning) or closes (evening), which picks its tooltip.
 * @type {Readonly<Object<string, {rotulo: string, crepusculo: string|null}>>}
 */
export const LINHAS_DA_FIG_4_10 = Object.freeze({
    primeiraClaridade: Object.freeze({ rotulo: 'Primeira claridade (Sol a −18°)', crepusculo: 'astronomico' }),
    icmn: Object.freeze({ rotulo: 'ICMN (−12°)', crepusculo: 'nautico' }),
    inicioCivil: Object.freeze({ rotulo: 'Início do crepúsculo civil (−6°)', crepusculo: 'civil' }),
    nascer: Object.freeze({ rotulo: 'Nascer do Sol', crepusculo: null }),
    por: Object.freeze({ rotulo: 'Pôr do Sol', crepusculo: null }),
    fimCivil: Object.freeze({ rotulo: 'Fim do crepúsculo civil (−6°)', crepusculo: 'civil' }),
    fcvn: Object.freeze({ rotulo: 'FCVN (−12°)', crepusculo: 'nautico' }),
    ultimaClaridade: Object.freeze({ rotulo: 'Última claridade (Sol a −18°)', crepusculo: 'astronomico' }),
});

/**
 * EB70-MC-10.336, 4.3.3.3.3 a, verbatim (the extraction's dashes restored as the manual's own).
 * @type {Readonly<Object<string, string>>}
 */
export const TEXTO_DOS_CREPUSCULOS = Object.freeze({
    astronomico: 'Crepúsculo astronômico: a luminosidade oferecida é tão reduzida que, para fins '
        + 'militares, pode ser considerado como obscuridade (PITCIC 4.3.3.3.3 a).',
    nautico: 'Crepúsculo náutico: proporciona luminosidade suficiente para a realização dos '
        + 'movimentos terrestres, aplicando-se os dados relativos aos movimentos diurnos; a '
        + 'visibilidade fica limitada a um máximo de 400 metros, permitindo o emprego do armamento '
        + 'até esse alcance e a progressão com relativa coberta da observação inimiga; conforme a '
        + 'situação, permite a observação dos fogos da artilharia e das operações aéreas diurnas '
        + '(PITCIC 4.3.3.3.3 a).',
    civil: 'Crepúsculo civil: proporciona luminosidade suficiente para as atividades diurnas '
        + 'normais, permitindo operações militares de qualquer tipo (PITCIC 4.3.3.3.3 a).',
});

/** Rise and set are the upper limb, not the centre, and the tooltip says so. */
export const DICA_DO_NASCER_E_POR = 'Borda superior do disco no horizonte, com a refração padrão.';

/** The auxiliary block, which never mixes with the doctrinal table (principle U4). */
export const TITULO_DO_AUXILIAR = 'Cálculo auxiliar, fora do PITCIC';
export const ROTULO_DA_ILUMINACAO = 'Iluminação da Lua, meio da noite';
export const DICA_DA_ILUMINACAO = 'Fração iluminada do disco no meio da noite de D. '
    + 'O manual trata a Lua por fase nomeada; o percentual desfaz a ambiguidade entre convenções.';

/** What an empty cell says. ABSENCE never becomes `00:00`. */
export const TEXTO_NAO_OCORRE = 'não ocorre';
export const TEXTO_SEM_LUAR = 'sem luar';
export const TEXTO_SEM_NOITE = 'sem noite';
export const TEXTO_ANTES = 'antes';
export const TEXTO_DEPOIS = 'depois';

export const DICA_SEM_LUAR = 'A Lua fica abaixo do horizonte durante toda a noite.';
export const DICA_SEM_NOITE = 'O Sol não se põe nesta data.';
export const DICA_NASCEU_ANTES = 'A Lua nasceu mais de um dia antes e segue acima do horizonte.';
export const DICA_POE_DEPOIS = 'A Lua segue acima do horizonte por mais de um dia.';

/**
 * Why a Sun field is null, in the screen's words.
 * @param {number} angulo - the Sun's altitude that defines the field (−18, −12, −6, −0.833)
 * @param {string} motivo - `nunca-desce` or `nunca-sobe` (the model's `MotivoSolar`)
 * @returns {string}
 */
export function motivoSolarPorExtenso(angulo, motivo) {
    const horizonte = angulo > -1;
    if (motivo === 'nunca-desce') {
        return horizonte
            ? 'O Sol não se põe nesta data.'
            : `O Sol não desce ${Math.abs(angulo)}° abaixo do horizonte nesta data.`;
    }
    return horizonte
        ? 'O Sol não nasce nesta data.'
        : `O Sol não sobe acima de −${Math.abs(angulo)}° nesta data.`;
}

/**
 * The note under the table when the night of D was not bounded by the nautical twilights.
 * @param {string} criterio - the model's `CriterioDaNoite`
 * @returns {string|null}
 */
export function notaDoCriterioDaNoite(criterio) {
    if (criterio === 'civil') {
        return 'Sem crepúsculo náutico nesta data: a noite de D vai do fim do crepúsculo civil ao início do civil seguinte.';
    }
    if (criterio === 'horizonte') {
        return 'Sem crepúsculo náutico nem civil nesta data: a noite de D vai do pôr ao nascer do Sol.';
    }
    if (criterio === 'noite-polar') {
        return 'O Sol não nasce nesta data: a noite de D vai de um meio-dia solar ao seguinte.';
    }
    return null;
}

/** The validity condition of every number, as a VISIBLE footer (principle U7). */
export const RESSALVA_DO_HORIZONTE = 'Horizonte teórico ao nível do mar. Relevo, nuvens e chuva não '
    + 'entram no cálculo (PITCIC 4.3.3.3.4 c).';

/** The same condition on one line, for the saved table. */
export const RESSALVA_CURTA = 'Horizonte teórico ao nível do mar; relevo, nuvens e chuva não entram no cálculo.';

/** Where day D came from; the header says which one it is. */
export const ORIGEM_DO_DIA_D = Object.freeze({
    painel: 'D escolhido no painel',
    hoje: 'D = hoje',
});

/** Controls. */
export const ROTULO_DIA_ANTERIOR = 'Dia anterior';
export const ROTULO_DIA_SEGUINTE = 'Dia seguinte';
export const ROTULO_DATA_D = 'Dia D';
export const ROTULO_SALVAR = 'Salvar tabela';
export const DICA_SALVAR = 'Salva a tabela em CSV, com o ponto, o fuso e a ressalva do horizonte.';
export const ROTULO_FECHAR = 'Fechar';

/** Toasts. */
export const AVISO_SALVO = 'Tabela de luminosidade salva.';
export const AVISO_FALHA_AO_SALVAR = 'Não foi possível salvar a tabela. Tente de novo.';
export const AVISO_FALHA_NO_CALCULO = 'Não foi possível calcular a luminosidade deste ponto. '
    + 'Tente de novo. Se continuar, avise o administrador.';

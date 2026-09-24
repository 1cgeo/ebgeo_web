// Path: js/utilities/meteorologia/meteorologia-phrases.js

/**
 * @fileoverview Every sentence the weather panel and its saved table put on screen.
 *
 * A leaf with ZERO imports, read statically by the context menu for its label. The name ends in
 * `-phrases.js` on purpose: that puts every literal here under
 * `tests/unit/avisos-de-tela-estilo.test.js`.
 *
 * THE ROW NAMES ARE QUADRO 4-5's (EB70-MC-10.336, "Previsão de tempo para 3 dias"): Previsão de
 * tempo, Precipitação, Temperatura, Ventos, Umidade, Visibilidade. Where the manual's row carries
 * two numbers (máx/mín), the panel gives each its own row, because a cell with two numbers and no
 * label reads either way.
 */

/** The panel's title, and the context menu item. */
export const TITULO_DO_PAINEL = 'Meteorologia';
export const ROTULO_DO_ITEM_DE_MENU = 'Meteorologia neste ponto';
export const ROTULO_DA_ALCA = 'Expandir ou recolher o painel de meteorologia';

/** The table caption, which a screen reader announces first. */
export const LEGENDA_DO_QUADRO = 'Previsão meteorológica (PITCIC, Quadro 4-5)';

/**
 * The rows of the main table, in Quadro 4-5's order.
 * @type {ReadonlyArray<{chave: string, rotulo: string, expansao: string, quebra?: boolean}>}
 */
export const LINHAS_PRINCIPAIS = Object.freeze([
    Object.freeze({ chave: 'tempo', rotulo: 'Previsão de tempo', expansao: 'A condição mais severa do dia, pelo código de tempo da OMM', quebra: true }),
    Object.freeze({ chave: 'precipitacao', rotulo: 'Precipitação', expansao: 'Total previsto no dia' }),
    Object.freeze({ chave: 'probabilidade', rotulo: 'Prob. de chuva', expansao: 'Maior probabilidade horária de precipitação no dia' }),
    Object.freeze({ chave: 'temperaturaMax', rotulo: 'Temperatura máx.', expansao: 'Temperatura máxima do dia, a 2 m' }),
    Object.freeze({ chave: 'temperaturaMin', rotulo: 'Temperatura mín.', expansao: 'Temperatura mínima do dia, a 2 m' }),
    Object.freeze({ chave: 'vento', rotulo: 'Ventos', expansao: 'Direção predominante (média vetorial) e velocidade média do dia, a 10 m' }),
    Object.freeze({ chave: 'rajada', rotulo: 'Rajada máx.', expansao: 'Maior rajada do dia, a 10 m' }),
    Object.freeze({ chave: 'umidadeMax', rotulo: 'Umidade máx.', expansao: 'Umidade relativa máxima do dia' }),
    Object.freeze({ chave: 'umidadeMin', rotulo: 'Umidade mín.', expansao: 'Umidade relativa mínima do dia' }),
    Object.freeze({ chave: 'visibilidade', rotulo: 'Visibilidade mín.', expansao: 'Menor visibilidade prevista no dia' }),
]);

/** The collapsible block with the two elements of item 3.2.7 that Quadro 4-5 does not show. */
export const TITULO_DO_AUXILIAR = 'Nebulosidade e pressão (PITCIC 3.2.7)';
export const LINHAS_AUXILIARES = Object.freeze([
    Object.freeze({ chave: 'nebulosidade', rotulo: 'Nebulosidade média', expansao: 'Cobertura de nuvens média do dia' }),
    Object.freeze({ chave: 'pressao', rotulo: 'Pressão média', expansao: 'Pressão média do dia, reduzida ao nível do mar' }),
]);

/**
 * The WMO weather codes the source uses, in the screen's words. The day's code is the most severe of
 * its hours, which is the source's own daily rule.
 * @type {Readonly<Object<number, string>>}
 */
export const TEMPO_POR_CODIGO_OMM = Object.freeze({
    0: 'Céu limpo',
    1: 'Predominantemente limpo',
    2: 'Parcialmente nublado',
    3: 'Nublado',
    45: 'Nevoeiro',
    48: 'Nevoeiro com geada',
    51: 'Garoa fraca',
    53: 'Garoa moderada',
    55: 'Garoa forte',
    56: 'Garoa congelante fraca',
    57: 'Garoa congelante forte',
    61: 'Chuva fraca',
    63: 'Chuva moderada',
    65: 'Chuva forte',
    66: 'Chuva congelante fraca',
    67: 'Chuva congelante forte',
    71: 'Neve fraca',
    73: 'Neve moderada',
    75: 'Neve forte',
    77: 'Grãos de neve',
    80: 'Pancadas de chuva fracas',
    81: 'Pancadas de chuva moderadas',
    82: 'Pancadas de chuva fortes',
    85: 'Pancadas de neve fracas',
    86: 'Pancadas de neve fortes',
    95: 'Trovoada',
    96: 'Trovoada com granizo fraco',
    99: 'Trovoada com granizo forte',
});

/**
 * @param {number} codigo
 * @returns {string}
 */
export function tempoPorExtenso(codigo) {
    return TEMPO_POR_CODIGO_OMM[codigo] ?? `Código de tempo ${codigo}`;
}

/** What an empty cell says. ABSENCE never becomes zero. */
export const TEXTO_CARREGANDO = '…';
export const TEXTO_SEM_PREVISAO = 'sem previsão';
export const TEXTO_SEM_DADO = 'sem dado';
export const TEXTO_CALMO = 'calmo';
export const DICA_SEM_PREVISAO = 'Fora do alcance da previsão: de 90 dias atrás até 14 dias à frente de hoje.';
export const DICA_SEM_DADO = 'A fonte não entregou este valor para todas as horas do dia.';
export const DICA_CALMO = 'Sem vento o dia todo: não há direção predominante.';

/** The states of a panel that reads from the network. */
export const ESTADO_CONSULTANDO = 'Consultando a previsão…';
export const ESTADO_INDISPONIVEL = 'Previsão indisponível';
export const ACAO_INDISPONIVEL = 'Verifique sua conexão e tente de novo. Se continuar, avise o administrador.';
export const ESTADO_FORA_DO_ALCANCE = 'Sem previsão para estes dias';
export const ACAO_FORA_DO_ALCANCE = 'A previsão cobre de 90 dias atrás até 14 dias à frente de hoje. '
    + 'Escolha uma data dentro desse intervalo.';
export const ROTULO_TENTAR_DE_NOVO = 'Tentar de novo';

/**
 * The HTTP code, when there is one, goes at the END of the action, never as the headline.
 * @param {number|null} status
 * @returns {string}
 */
export function acaoIndisponivel(status) {
    return Number.isInteger(status) ? `${ACAO_INDISPONIVEL} Código: ${status}` : ACAO_INDISPONIVEL;
}

/** The model and the licence the data carries. */
export const NOME_DO_MODELO = 'GFS (NOAA)';
export const ATRIBUICAO = 'Dados: Open-Meteo.com, licença CC BY 4.0.';

/** The validity condition of every number, as a VISIBLE footer. */
export const RESSALVA_DO_MODELO = 'Previsão de modelo global, com resolução de cerca de 13 km: neblina de vale e de '
    + 'costa não aparecem nela (PITCIC 4.3.3.3.5 b).';

/** The same condition on one line, for the saved table. */
export const RESSALVA_CURTA = 'Modelo global de cerca de 13 km; neblina de vale e de costa não aparece.';

/** "Salvar tabela". */
export const DICA_SALVAR = 'Salva a tabela em CSV, com o ponto, o fuso, o modelo e a rodada.';
export const AVISO_SALVO = 'Tabela de meteorologia salva.';
export const AVISO_FALHA_AO_SALVAR = 'Não foi possível salvar a tabela. Tente de novo.';
export const AVISO_AINDA_CHEGANDO = 'A previsão ainda não chegou. Tente salvar depois que a tabela aparecer.';
export const AVISO_SEM_PREVISAO_PARA_SALVAR = 'Não há previsão na tela para salvar. Escolha outra data ou tente de novo.';

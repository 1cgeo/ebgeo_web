// Path: js/utilities/meteorologia/quadro-meteorologico.js

/**
 * @fileoverview THE WEATHER QUADRO as text: the source's forecast turned into the cells the screen
 * and the saved file write. Pure, testable in node.
 *
 * ONE place decides what a cell says, so the two outputs cannot drift: the panel renders these rows
 * into a semantic table, and "Salvar tabela" writes the same cells into a CSV. The shape of a row
 * and a cell is the point panels' shell's (`LinhaDoPainel`, `Celula`), shared with the light panel.
 *
 * EACH COLUMN SAYS WHY IT IS EMPTY, and there are three reasons that must not look alike: the
 * forecast is still coming ("…"), the day is out of the forecast's reach ("sem previsão"), or the
 * source did not give every hour of that value ("sem dado").
 */

import { escapeCsvCell } from '@utils/csv-escape.js';
import {
    ROTULO_FUSO_BRASILIA,
    dataCivilP,
    dataPorExtenso,
    diaMes,
    diasEntre,
    horaMinutoP,
    rotuloDoDia,
    rotuloRelativo,
} from '@utils/hora-brasilia.js';
import { agregarDia, rumoDe } from './agregacao-meteorologica.js';
import {
    ATRIBUICAO,
    DICA_CALMO,
    DICA_SEM_DADO,
    DICA_SEM_PREVISAO,
    LEGENDA_DO_QUADRO,
    LINHAS_AUXILIARES,
    LINHAS_PRINCIPAIS,
    NOME_DO_MODELO,
    RESSALVA_CURTA,
    TEXTO_CALMO,
    TEXTO_CARREGANDO,
    TEXTO_SEM_DADO,
    TEXTO_SEM_PREVISAO,
    TITULO_DO_AUXILIAR,
    tempoPorExtenso,
} from './meteorologia-phrases.js';

/** GFS reports visibility capped at about 24 km (15 miles); at the cap, "or more" is the truth. */
const TETO_DA_VISIBILIDADE_M = 24000;

/**
 * A number in pt-BR with a fixed number of decimals, never "-0".
 * @param {number} valor
 * @param {number} casas
 * @returns {string}
 */
export function numero(valor, casas) {
    const texto = valor.toFixed(casas);
    const limpo = /^-0(\.0+)?$/.test(texto) ? texto.slice(1) : texto;
    return limpo.replace('.', ',');
}

/**
 * @param {string} texto
 * @param {string|null} [dica]
 * @returns {import('@utils/painel-de-ponto/painel-de-ponto.js').Celula}
 */
function celula(texto, dica = null) {
    return { texto, marca: '', textoLido: texto, dica, vazia: false };
}

/**
 * @param {string} texto
 * @param {string|null} dica
 * @returns {import('@utils/painel-de-ponto/painel-de-ponto.js').Celula}
 */
function celulaVazia(texto, dica) {
    return { texto, marca: '', textoLido: texto, dica, vazia: true };
}

/**
 * "Às 14:00h." of an hour in P, for a tooltip.
 * @param {number} instanteMs
 * @returns {string}
 */
function dicaDeHora(instanteMs) {
    return `Às ${horaMinutoP(instanteMs)}h.`;
}

/** @param {number} mm @returns {string} */
export function textoDePrecipitacao(mm) {
    if (Math.round(mm * 10) === 0) return '0 mm';
    return mm < 10 ? `${numero(mm, 1)} mm` : `${numero(mm, 0)} mm`;
}

/** @param {number} metros @returns {string} */
export function textoDeVisibilidade(metros) {
    if (metros >= TETO_DA_VISIBILIDADE_M) return '24 km ou mais';
    if (metros >= 10000) return `${numero(metros / 1000, 0)} km`;
    if (metros >= 1000) return `${numero(metros / 1000, 1)} km`;
    return `${Math.round(metros)} m`;
}

/**
 * The cell of one row for one aggregated day.
 * @param {string} chave
 * @param {import('./agregacao-meteorologica.js').DiaMeteorologico} dia
 * @returns {import('@utils/painel-de-ponto/painel-de-ponto.js').Celula}
 */
function celulaDoDia(chave, dia) {
    const campo = {
        tempo: dia.codigoDeTempo,
        precipitacao: dia.precipitacao,
        probabilidade: dia.probabilidade,
        temperaturaMax: dia.temperaturaMax,
        temperaturaMin: dia.temperaturaMin,
        vento: dia.vento,
        rajada: dia.rajada,
        umidadeMax: dia.umidadeMax,
        umidadeMin: dia.umidadeMin,
        visibilidade: dia.visibilidade,
        nebulosidade: dia.nebulosidade,
        pressao: dia.pressao,
    }[chave];
    if (chave === 'vento' && campo.motivo === 'calmo') return celula(TEXTO_CALMO, DICA_CALMO);
    if (campo.valor === null) return celulaVazia(TEXTO_SEM_DADO, DICA_SEM_DADO);
    const v = campo.valor;
    switch (chave) {
        case 'tempo': return celula(tempoPorExtenso(v));
        case 'precipitacao': return celula(textoDePrecipitacao(v));
        case 'probabilidade': return celula(`${Math.round(v)}%`);
        case 'temperaturaMax':
        case 'temperaturaMin': return celula(`${numero(v, 0)} °C`);
        case 'vento': return celula(`${rumoDe(v.direcao)} ${numero(v.velocidade, 1)} m/s`);
        case 'rajada': return celula(`${numero(v.velocidade, 1)} m/s`, dicaDeHora(v.instanteMs));
        case 'umidadeMax':
        case 'umidadeMin': return celula(`${Math.round(v)}%`);
        case 'visibilidade': return celula(
            textoDeVisibilidade(v.metros),
            v.metros >= TETO_DA_VISIBILIDADE_M ? null : dicaDeHora(v.instanteMs),
        );
        case 'nebulosidade': return celula(`${Math.round(v)}%`);
        case 'pressao': return celula(`${numero(v, 1)} hPa`);
        default: throw new Error(`linha desconhecida: ${chave}`);
    }
}

/**
 * @typedef {Object} QuadroMeteorologico
 * @property {string} dataD
 * @property {Array<{relativo: string, dia: string, data: string}>} colunas
 * @property {import('@utils/painel-de-ponto/painel-de-ponto.js').LinhaDoPainel[]} principais
 * @property {import('@utils/painel-de-ponto/painel-de-ponto.js').LinhaDoPainel[]} auxiliares
 * @property {Array<import('./agregacao-meteorologica.js').DiaMeteorologico|null>} dias - one per
 *   column, null when the column has no forecast
 */

/**
 * The quadro for day D and its columns.
 * @param {Object} entrada
 * @param {string} entrada.dataD
 * @param {string[]} entrada.datas - the columns' civil dates (D, D+1, D+2)
 * @param {import('./fonte-meteorologica.js').Previsao|null} entrada.previsao - null while it comes
 * @returns {QuadroMeteorologico}
 */
export function montarQuadro({ dataD, datas, previsao }) {
    const colunas = datas.map((data) => ({
        relativo: rotuloRelativo(diasEntre(dataD, data)),
        dia: rotuloDoDia(data),
        data,
    }));
    const dias = datas.map((data) => {
        if (!previsao?.serie || !previsao.noAlcance.includes(data)) return null;
        return agregarDia(previsao.serie, data);
    });
    const celulaDaColuna = (chave, i) => {
        if (!previsao) return celulaVazia(TEXTO_CARREGANDO, null);
        if (!dias[i]) return celulaVazia(TEXTO_SEM_PREVISAO, DICA_SEM_PREVISAO);
        return celulaDoDia(chave, dias[i]);
    };
    const linhas = (definicoes) => definicoes.map((d) => ({
        chave: d.chave,
        rotulo: d.rotulo,
        expansao: d.expansao,
        quebra: !!d.quebra,
        celulas: datas.map((_, i) => celulaDaColuna(d.chave, i)),
    }));
    return { dataD, colunas, principais: linhas(LINHAS_PRINCIPAIS), auxiliares: linhas(LINHAS_AUXILIARES), dias };
}

/**
 * The phone's peek line for day D: "Chuva moderada · 13 a 25 °C" and "Ventos NE 1,8 m/s · 0,2 mm".
 * @param {QuadroMeteorologico} quadro
 * @returns {{tempo: string, vento: string}|null} null when day D has no forecast
 */
export function resumoDaEspiada(quadro) {
    const dia = quadro.dias[0];
    if (!dia) return null;
    const texto = (chave) => celulaDoDia(chave, dia).texto;
    const min = dia.temperaturaMin.valor;
    const max = dia.temperaturaMax.valor;
    const faixa = min === null || max === null ? TEXTO_SEM_DADO : `${numero(min, 0)} a ${numero(max, 0)} °C`;
    const vento = dia.vento.motivo === 'calmo' ? 'Vento calmo' : `Ventos ${texto('vento')}`;
    return {
        tempo: `${texto('tempo')} · ${faixa}`,
        vento: `${vento} · ${texto('precipitacao')}`,
    };
}

/**
 * The stamp under the table: the model, its run and the point that was actually queried.
 * @param {import('./fonte-meteorologica.js').Previsao} previsao
 * @returns {string}
 */
export function carimboDaFonte(previsao) {
    const rodada = previsao.rodada
        ? `rodada de ${diaMes(dataCivilP(previsao.rodada.inicioMs))} às ${horaMinutoP(previsao.rodada.inicioMs)}h P`
        : 'rodada não informada pela fonte';
    const { lat, lng } = previsao.celula;
    const altitude = Number.isFinite(previsao.serie?.elevacao)
        ? `, altitude de referência ${Math.round(previsao.serie.elevacao)} m`
        : '';
    return `Modelo ${NOME_DO_MODELO}, ${rodada}. Ponto consultado: ${lat.toFixed(1)}, ${lng.toFixed(1)} `
        + `(arredondado a 0,1°)${altitude}.`;
}

/**
 * A cell on one line, for the file output.
 * @param {{texto: string, marca: string}} c
 * @returns {string}
 */
function textoPlano(c) {
    return c.marca ? `${c.texto} ${c.marca}` : c.texto;
}

/**
 * What "Salvar tabela" writes: a CSV with the house's convention (comma, every cell through
 * `escapeCsvCell`, UTF-8 BOM added by the caller), carrying the point, the zone, the model, the run
 * and the licence INSIDE the file, as the light panel's does.
 * @param {QuadroMeteorologico} quadro
 * @param {Object} contexto
 * @param {{lat: number, lng: number}} contexto.ponto - the clicked point
 * @param {import('./fonte-meteorologica.js').Previsao} contexto.previsao
 * @param {string|null} [contexto.coordenada] - the point in the map's format, when not decimal
 * @returns {string} CSV text, without the BOM
 */
export function tabelaCsv(quadro, { ponto, previsao, coordenada = null }) {
    const cabecalho = ['', ...quadro.colunas.map((c) => `${c.relativo} ${dataPorExtenso(c.data)}`)];
    const linha = (l) => [l.rotulo, ...l.celulas.map(textoPlano)];
    const linhas = [
        [LEGENDA_DO_QUADRO],
        ['Latitude', ponto.lat.toFixed(6)],
        ['Longitude', ponto.lng.toFixed(6)],
        ...(coordenada ? [['Coordenada', coordenada]] : []),
        ['Fuso', ROTULO_FUSO_BRASILIA],
        ['Fonte', carimboDaFonte(previsao)],
        [ATRIBUICAO],
        [],
        cabecalho,
        ...quadro.principais.map(linha),
        [],
        [TITULO_DO_AUXILIAR],
        cabecalho,
        ...quadro.auxiliares.map(linha),
        [],
        [RESSALVA_CURTA],
    ];
    return `${linhas.map((l) => l.map(escapeCsvCell).join(',')).join('\n')}\n`;
}

/**
 * The file name: `meteorologia_2026-09-24_-15.78000_-47.92917.csv`, sortable by day and telling
 * the point apart without opening the file.
 * @param {string} dataD
 * @param {{lat: number, lng: number}} ponto
 * @returns {string}
 */
export function nomeDoArquivoCsv(dataD, ponto) {
    return `meteorologia_${dataD}_${ponto.lat.toFixed(5)}_${ponto.lng.toFixed(5)}.csv`;
}

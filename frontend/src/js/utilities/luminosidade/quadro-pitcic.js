// Path: js/utilities/luminosidade/quadro-pitcic.js

/**
 * @fileoverview THE QUADRO as text: the model's matrix turned into the cells the screen and the
 * saved file write. Pure, testable in node.
 *
 * ONE place decides what a cell says, so the two outputs cannot drift: the panel renders these
 * rows into a semantic table, and "Salvar tabela" writes the same cells into a CSV.
 */

import { escapeCsvCell } from '@utils/csv-escape.js';
import {
    ROTULO_FUSO_BRASILIA,
    celulaHoraria,
    dataPorExtenso,
    diasEntre,
    rotuloDoDia,
    rotuloRelativo,
    textoDaCelula,
} from '@utils/hora-brasilia.js';
import { EVENTOS_DO_SOL } from './matriz-pitcic.model.js';
import {
    CAMPOS_DO_QUADRO,
    DICA_DO_NASCER_E_POR,
    DICA_NASCEU_ANTES,
    DICA_POE_DEPOIS,
    DICA_SEM_LUAR,
    DICA_SEM_NOITE,
    GRUPO_LUNAR,
    GRUPO_SOLAR,
    LEGENDA_DO_QUADRO,
    LINHAS_DA_FIG_4_10,
    RESSALVA_CURTA,
    ROTULO_DA_ILUMINACAO,
    TITULO_DA_FIG_4_10,
    TITULO_DO_AUXILIAR,
    TEXTO_ANTES,
    TEXTO_DEPOIS,
    TEXTO_DOS_CREPUSCULOS,
    TEXTO_NAO_OCORRE,
    TEXTO_SEM_LUAR,
    TEXTO_SEM_NOITE,
    motivoSolarPorExtenso,
} from './luminosidade-phrases.js';

/**
 * @typedef {Object} Celula
 * @property {string} texto - what the cell shows ("05:03h", "cheia", "não ocorre")
 * @property {string} marca - the day mark ("(+1)"), empty on the same day
 * @property {string} textoLido - what a screen reader says instead of texto + marca
 * @property {string|null} dica - the tooltip; for an empty cell, WHY it is empty
 * @property {boolean} vazia - the phenomenon does not happen (or is out of the window)
 */

/**
 * @typedef {Object} LinhaDoQuadro
 * @property {string} chave
 * @property {string} grupo
 * @property {string} rotulo
 * @property {string} expansao
 * @property {Celula[]} celulas - one per column
 */

/**
 * @param {ReturnType<typeof celulaHoraria>} celula
 * @param {string|null} dica
 * @returns {Celula}
 */
function celulaDeHorario(celula, dica = null) {
    return {
        texto: celula.texto,
        marca: celula.marca,
        textoLido: celula.textoLido,
        dica,
        vazia: false,
    };
}

/**
 * @param {string} texto
 * @param {string|null} dica
 * @returns {Celula}
 */
function celulaVazia(texto, dica) {
    return { texto, marca: '', textoLido: texto, dica, vazia: true };
}

/**
 * A Sun cell (any of the eight events of Fig 4-10).
 * @param {Object} coluna - a model column
 * @param {string} chave
 * @param {string|null} dicaSeOcorre
 * @returns {Celula}
 */
function celulaSolar(coluna, chave, dicaSeOcorre) {
    const celula = celulaHoraria(coluna.sol.horarios[chave], coluna.data);
    if (celula) return celulaDeHorario(celula, dicaSeOcorre);
    const angulo = EVENTOS_DO_SOL.find((e) => e.chave === chave).angulo;
    return celulaVazia(TEXTO_NAO_OCORRE, motivoSolarPorExtenso(angulo, coluna.sol.motivos[chave]));
}

/**
 * A moonlight cell ("Ini Luar" or "Fim do luar").
 * @param {Object} coluna
 * @param {'nasce'|'poe'} chave
 * @returns {Celula}
 */
function celulaDoLuar(coluna, chave) {
    const { lua } = coluna;
    if (lua.semNoite) return celulaVazia(TEXTO_SEM_NOITE, DICA_SEM_NOITE);
    if (lua.semLuar) return celulaVazia(TEXTO_SEM_LUAR, DICA_SEM_LUAR);
    if (chave === 'nasce' && lua.nasceAntes) return celulaVazia(TEXTO_ANTES, DICA_NASCEU_ANTES);
    if (chave === 'poe' && lua.poeDepois) return celulaVazia(TEXTO_DEPOIS, DICA_POE_DEPOIS);
    return celulaDeHorario(celulaHoraria(lua[chave], coluna.data));
}

/**
 * The five doctrinal rows of Quadro 4-5.
 * @param {{colunas: Object[]}} matriz - `matrizPitcic` output
 * @returns {LinhaDoQuadro[]}
 */
export function linhasDoQuadro(matriz) {
    return CAMPOS_DO_QUADRO.map((campo) => ({
        ...campo,
        celulas: matriz.colunas.map((coluna) => {
            if (campo.chave === 'icmn' || campo.chave === 'fcvn') {
                return celulaSolar(coluna, campo.chave, TEXTO_DOS_CREPUSCULOS.nautico);
            }
            if (campo.chave === 'fase') {
                const nome = coluna.lua.fase ?? TEXTO_NAO_OCORRE;
                return { texto: nome, marca: '', textoLido: nome, dica: null, vazia: coluna.lua.fase === null };
            }
            return celulaDoLuar(coluna, campo.chave);
        }),
    }));
}

/**
 * The eight rows of Fig 4-10, in chronological order.
 * @param {{colunas: Object[]}} matriz
 * @returns {LinhaDoQuadro[]}
 */
export function linhasDaFig410(matriz) {
    return EVENTOS_DO_SOL.map(({ chave }) => {
        const { rotulo, crepusculo } = LINHAS_DA_FIG_4_10[chave];
        const dica = crepusculo ? TEXTO_DOS_CREPUSCULOS[crepusculo] : DICA_DO_NASCER_E_POR;
        return {
            chave,
            grupo: 'fig-4-10',
            rotulo,
            expansao: rotulo,
            celulas: matriz.colunas.map((coluna) => celulaSolar(coluna, chave, dica)),
        };
    });
}

/**
 * The auxiliary row: illumination at the middle of the night, with its trend.
 * @param {{colunas: Object[]}} matriz
 * @returns {LinhaDoQuadro}
 */
export function linhaDaIluminacao(matriz) {
    return {
        chave: 'iluminacao',
        grupo: 'auxiliar',
        rotulo: ROTULO_DA_ILUMINACAO,
        expansao: ROTULO_DA_ILUMINACAO,
        celulas: matriz.colunas.map(({ lua }) => {
            const seta = lua.crescente ? '↑' : '↓';
            const tendencia = lua.crescente ? 'crescendo' : 'minguando';
            return {
                texto: `${lua.iluminacaoPct}% ${seta}`,
                marca: '',
                textoLido: `${lua.iluminacaoPct} por cento, ${tendencia}`,
                dica: null,
                vazia: false,
            };
        }),
    };
}

/**
 * The column headers: "D" over "qui 24/09", relative to day D.
 * @param {{dataD: string, colunas: Object[]}} matriz
 * @returns {Array<{relativo: string, dia: string, data: string}>}
 */
export function cabecalhosDasColunas(matriz) {
    return matriz.colunas.map((c) => ({
        relativo: rotuloRelativo(diasEntre(matriz.dataD, c.data)),
        dia: rotuloDoDia(c.data),
        data: c.data,
    }));
}

/**
 * A cell on one line, for the file output.
 * @param {Celula} c
 * @returns {string}
 */
function textoPlano(c) {
    return c.marca ? `${c.texto} ${c.marca}` : c.texto;
}

/**
 * What "Salvar tabela" writes: a CSV with the house's convention (comma, every cell through
 * `escapeCsvCell`, UTF-8 BOM added by the caller), carrying the point, the zone and the horizon
 * caveat INSIDE the file. A number that leaves the screen without its zone is the screen that lies.
 *
 * THE POINT GOES AS TWO DECIMAL NUMBERS, always, and in the map's format only when that format is
 * not decimal. A decimal coordinate in the southern or western hemisphere starts with "-", and the
 * formula guard of `escapeCsvCell` would print it with a leading apostrophe; two plain numbers are
 * what a spreadsheet reads as numbers.
 *
 * Three blocks, in the panel's order, and the auxiliary one keeps its "fora do PITCIC" title: the
 * doctrinal table and the computed percentage never mix without marking (principle U4).
 * @param {{dataD: string, ponto: {lat: number, lng: number}, colunas: Object[]}} matriz
 * @param {{coordenada?: string|null}} [opcoes] - the point in the map's format, when not decimal
 * @returns {string} CSV text, one line per row, without the BOM (the caller adds it)
 */
export function tabelaCsv(matriz, { coordenada = null } = {}) {
    const cab = cabecalhosDasColunas(matriz);
    const cabecalho = ['', ...cab.map((c) => `${c.relativo} ${dataPorExtenso(c.data)}`)];
    const linha = (l) => [l.rotulo, ...l.celulas.map(textoPlano)];
    const doutrinarias = linhasDoQuadro(matriz);
    const linhas = [
        [LEGENDA_DO_QUADRO],
        ['Latitude', matriz.ponto.lat.toFixed(6)],
        ['Longitude', matriz.ponto.lng.toFixed(6)],
        ...(coordenada ? [['Coordenada', coordenada]] : []),
        ['Fuso', ROTULO_FUSO_BRASILIA],
        [],
        cabecalho,
        [GRUPO_SOLAR],
        ...doutrinarias.filter((l) => l.grupo === GRUPO_SOLAR).map(linha),
        [GRUPO_LUNAR],
        ...doutrinarias.filter((l) => l.grupo === GRUPO_LUNAR).map(linha),
        [],
        [TITULO_DA_FIG_4_10],
        cabecalho,
        ...linhasDaFig410(matriz).map(linha),
        [],
        [TITULO_DO_AUXILIAR],
        cabecalho,
        linha(linhaDaIluminacao(matriz)),
        [],
        [RESSALVA_CURTA],
    ];
    return `${linhas.map((l) => l.map(escapeCsvCell).join(',')).join('\n')}\n`;
}

/**
 * The file name: `luminosidade_2026-09-24_-15.78000_-47.92917.csv`, sortable by day and telling
 * the point apart without opening the file.
 * @param {{dataD: string, ponto: {lat: number, lng: number}}} matriz
 * @returns {string}
 */
export function nomeDoArquivoCsv(matriz) {
    return `luminosidade_${matriz.dataD}_${matriz.ponto.lat.toFixed(5)}_${matriz.ponto.lng.toFixed(5)}.csv`;
}

/**
 * The phone's peek line, which answers "when does it get dark here today, and will there be a
 * Moon?" without opening anything: "ICMN 05:13h · FCVN 18:54h" and "Lua cheia · luar 16:29h a
 * 05:04h (+1)".
 * @param {{colunas: Object[]}} matriz
 * @returns {{sol: string, lua: string}}
 */
export function resumoDaEspiada(matriz) {
    const coluna = matriz.colunas[0];
    const icmn = textoDaCelula(celulaHoraria(coluna.sol.horarios.icmn, coluna.data), TEXTO_NAO_OCORRE);
    const fcvn = textoDaCelula(celulaHoraria(coluna.sol.horarios.fcvn, coluna.data), TEXTO_NAO_OCORRE);
    const { lua } = coluna;
    let luar;
    if (lua.semNoite) {
        luar = TEXTO_SEM_NOITE;
    } else if (lua.semLuar) {
        luar = TEXTO_SEM_LUAR;
    } else {
        const nasce = textoPlano(celulaDoLuar(coluna, 'nasce'));
        const poe = textoPlano(celulaDoLuar(coluna, 'poe'));
        luar = `luar ${nasce} a ${poe}`;
    }
    return {
        sol: `ICMN ${icmn} · FCVN ${fcvn}`,
        lua: `Lua ${lua.fase ?? TEXTO_NAO_OCORRE} · ${luar}`,
    };
}

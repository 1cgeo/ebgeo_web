// Path: js/utilities/meteorologia/agregacao-meteorologica.js

/**
 * @fileoverview THE DAY'S VALUES: the hourly series of the source cut into civil days of P and
 * reduced to what Quadro 4-5 prints per day. Pure, testable in node.
 *
 * Every rule here reproduces the SOURCE'S OWN daily aggregates, and the test proves it by an
 * independent path: the same forecast asked with `daily=...` in Brasília's zone must equal what this
 * module computes from the hourly series (recorded 2026-09-23 in
 * `tests/fixtures/open-meteo-2026/`). Two rules that do not read off the code:
 *
 *   - THE DAY IS P's, cut here and never by the source (trap A2 of the proposal): the series comes
 *     in UTC, and a day cut in UTC moves three hours, which moves the night's rain and the dawn's
 *     minimum into the wrong column.
 *   - THE WIND DIRECTION IS A VECTOR MEAN WEIGHTED BY SPEED (trap A4). The arithmetic mean of 350°
 *     and 10° is 180°, the opposite bearing; and the unweighted vector mean missed the source's
 *     dominant direction by 28° on the first recorded day, because calm hours with a random
 *     bearing count as much as the windy ones.
 *
 * ABSENCE IS NULL WITH A REASON, AND NULL NEVER BECOMES ZERO (trap A5): "0 mm" is a dry forecast, a
 * missing hour is another thing. A field is computed only when the source gave all 24 hours of it.
 */

import { MS_POR_DIA, meiaNoiteP } from '@utils/hora-brasilia.js';

/** Hours of a civil day in P (fixed UTC−3, no daylight saving). */
export const HORAS_POR_DIA = 24;

/**
 * The 16 bearings, as Quadro 4-5 writes them ("Direção: N-NW").
 * @type {ReadonlyArray<string>}
 */
export const RUMOS = Object.freeze([
    'N', 'N-NE', 'NE', 'E-NE', 'E', 'E-SE', 'SE', 'S-SE',
    'S', 'S-SW', 'SW', 'W-SW', 'W', 'W-NW', 'NW', 'N-NW',
]);

/**
 * Why a field is null.
 * @enum {string}
 */
export const MotivoMeteorologico = Object.freeze({
    /** The source did not give this value for every hour of the day. */
    INCOMPLETO: 'incompleto',
    /** No wind at all during the day: there is no prevailing direction. */
    CALMO: 'calmo',
});

/**
 * The bearing name of a direction in degrees.
 * @param {number} graus - 0 to 360, where the wind COMES FROM
 * @returns {string}
 */
export function rumoDe(graus) {
    const i = Math.round((((graus % 360) + 360) % 360) / 22.5) % RUMOS.length;
    return RUMOS[i];
}

/**
 * The prevailing direction: vector mean of where the wind comes from, weighted by speed.
 * @param {number[]} direcoes - degrees
 * @param {number[]} velocidades - same length
 * @returns {number|null} degrees in [0, 360), or null when there is no wind at all
 */
export function direcaoPredominante(direcoes, velocidades) {
    let seno = 0;
    let cosseno = 0;
    for (let i = 0; i < direcoes.length; i++) {
        const rad = (direcoes[i] * Math.PI) / 180;
        seno += velocidades[i] * Math.sin(rad);
        cosseno += velocidades[i] * Math.cos(rad);
    }
    if (Math.hypot(seno, cosseno) < 1e-9) return null;
    const graus = (Math.atan2(seno, cosseno) * 180) / Math.PI;
    return ((graus % 360) + 360) % 360;
}

/**
 * @param {Array<number|null>} valores
 * @returns {boolean}
 */
function completo(valores) {
    return valores.length === HORAS_POR_DIA && valores.every((v) => v !== null && Number.isFinite(v));
}

/**
 * @template T
 * @param {Array<number|null>} valores
 * @param {(v: number[]) => T} reduzir
 * @returns {{valor: T|null, motivo: string|null}}
 */
function campo(valores, reduzir) {
    if (!completo(valores)) return { valor: null, motivo: MotivoMeteorologico.INCOMPLETO };
    return { valor: reduzir(valores), motivo: null };
}

/**
 * The index of the extreme hour, the FIRST one when there is a tie.
 * @param {number[]} valores
 * @param {(a: number, b: number) => boolean} melhor
 * @returns {number}
 */
function indiceDoExtremo(valores, melhor) {
    let i0 = 0;
    for (let i = 1; i < valores.length; i++) if (melhor(valores[i], valores[i0])) i0 = i;
    return i0;
}

const soma = (v) => v.reduce((a, b) => a + b, 0);
const media = (v) => soma(v) / v.length;

/**
 * @typedef {Object} CampoMeteorologico
 * @property {*} valor
 * @property {string|null} motivo - why the value is null ({@link MotivoMeteorologico})
 */

/**
 * @typedef {Object} DiaMeteorologico
 * @property {string} data - civil date in P
 * @property {boolean} completo - the series covers the 24 hours of the day
 * @property {CampoMeteorologico} codigoDeTempo - the most severe WMO code of the day
 * @property {CampoMeteorologico} precipitacao - mm, total of the day
 * @property {CampoMeteorologico} probabilidade - %, highest hourly
 * @property {CampoMeteorologico} temperaturaMax - °C
 * @property {CampoMeteorologico} temperaturaMin - °C
 * @property {CampoMeteorologico} vento - {velocidade: m/s mean, direcao: degrees|null}
 * @property {CampoMeteorologico} rajada - {velocidade: m/s max, instanteMs}
 * @property {CampoMeteorologico} umidadeMax - %
 * @property {CampoMeteorologico} umidadeMin - %
 * @property {CampoMeteorologico} visibilidade - {metros: min, instanteMs}
 * @property {CampoMeteorologico} nebulosidade - %, mean
 * @property {CampoMeteorologico} pressao - hPa, mean at sea level
 */

/**
 * The values of one civil day of P.
 * @param {import('./fonte-meteorologica.js').SerieHoraria} serie
 * @param {string} dataIso - civil date in P
 * @returns {DiaMeteorologico}
 */
export function agregarDia(serie, dataIso) {
    const inicio = meiaNoiteP(dataIso);
    const fim = inicio + MS_POR_DIA;
    const indices = [];
    serie.tempos.forEach((t, i) => {
        if (t >= inicio && t < fim) indices.push(i);
    });
    const de = (variavel) => indices.map((i) => serie.valores[variavel][i]);
    const tempos = indices.map((i) => serie.tempos[i]);

    const velocidades = de('wind_speed_10m');
    const direcoes = de('wind_direction_10m');
    let vento;
    if (!completo(velocidades) || !completo(direcoes)) {
        vento = { valor: null, motivo: MotivoMeteorologico.INCOMPLETO };
    } else {
        const direcao = direcaoPredominante(direcoes, velocidades);
        vento = { valor: { velocidade: media(velocidades), direcao }, motivo: direcao === null ? MotivoMeteorologico.CALMO : null };
    }

    const rajadas = de('wind_gusts_10m');
    const visibilidades = de('visibility');

    return {
        data: dataIso,
        completo: indices.length === HORAS_POR_DIA,
        codigoDeTempo: campo(de('weather_code'), (v) => Math.max(...v)),
        precipitacao: campo(de('precipitation'), soma),
        probabilidade: campo(de('precipitation_probability'), (v) => Math.max(...v)),
        temperaturaMax: campo(de('temperature_2m'), (v) => Math.max(...v)),
        temperaturaMin: campo(de('temperature_2m'), (v) => Math.min(...v)),
        vento,
        rajada: campo(rajadas, (v) => {
            const i = indiceDoExtremo(v, (a, b) => a > b);
            return { velocidade: v[i], instanteMs: tempos[i] };
        }),
        umidadeMax: campo(de('relative_humidity_2m'), (v) => Math.max(...v)),
        umidadeMin: campo(de('relative_humidity_2m'), (v) => Math.min(...v)),
        visibilidade: campo(visibilidades, (v) => {
            const i = indiceDoExtremo(v, (a, b) => a < b);
            return { metros: v[i], instanteMs: tempos[i] };
        }),
        nebulosidade: campo(de('cloud_cover'), media),
        pressao: campo(de('pressure_msl'), media),
    };
}

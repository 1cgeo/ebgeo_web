// Path: js/utilities/hora-brasilia.js

/**
 * @fileoverview BRASÍLIA TIME, the civil day, and the format of PITCIC's Quadro 4-5.
 *
 * A leaf with ZERO imports, testable in node, shared by the two point panels of the PITCIC matrix
 * (light and weather) and by their saved tables. It was born inside the light module and moved here
 * when the weather panel arrived, so that neither panel imports the other (decision D10 of the
 * weather proposal); the zero-import rule is the condition that move was made on. This is the only
 * place where the zone offset is written: before this file the code had no Brasília constant, no
 * letter P, and no −180 anywhere.
 *
 * ── WHY BRASÍLIA, AND NEITHER THE BROWSER NOR UTC ───────────────────────────────────────────
 *
 * A decision of the Chefe da DGEO (proposal of 2026-08-14), and the manual writes time this way:
 * Quadro An-6 of EB70-MC-10.336 reads "D+1/0000P", and P is UTC−3 in the military zone letters.
 * Brasília has been a fixed UTC−3 since Decreto 9.772/2019 ended daylight saving. If that changes,
 * ONE constant changes.
 *
 * BRASÍLIA IS THE REFERENCE, NOT THE LEGAL TIME OF THE POINT. In Manaus (Q, UTC−4) or Rio Branco
 * (R, UTC−5) the legal time differs, and the panel does not guess the zone of the area of
 * operations: it names the zone once, in its header, and warns when the computer is in another
 * one ({@link avisoDeFusoDoNavegador}).
 *
 * ── THE CIVIL DAY IS P's, NEVER UTC's NOR THE BROWSER's ─────────────────────────────────────
 *
 * The trap already bit this code base: the declination tool stores the UTC date of `new Date()`,
 * so after 21:00 in Brasília the feature records tomorrow's date. Here the civil date is always
 * derived from the instant plus P's offset, and a date is an `AAAA-MM-DD` string, never a `Date`
 * (a `Date` is an instant, and its day depends on who asks).
 *
 * EVERY INTERNAL COMPUTATION IS IN UTC milliseconds. Conversion to P happens only when formatting.
 */

/** Offset of Brasília (P) from UTC, in minutes. */
export const DESLOCAMENTO_BRASILIA_MIN = -180;

/** Brasília's letter in the military zone convention (Quadro An-6: "D+1/0000P"). */
export const LETRA_FUSO_BRASILIA = 'P';

/** The zone label, written ONCE in the panel header and in the saved table. */
export const ROTULO_FUSO_BRASILIA = `Hora de Brasília (${LETRA_FUSO_BRASILIA}, UTC−3)`;

/** Milliseconds in a 24 h day. */
export const MS_POR_DIA = 86400000;

const MS_POR_MINUTO = 60000;
const DESLOCAMENTO_MS = DESLOCAMENTO_BRASILIA_MIN * MS_POR_MINUTO;

/** Weekday abbreviations from Sunday, as the screen writes them. */
const DIAS_DA_SEMANA = Object.freeze(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']);

const RE_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {number} n
 * @returns {string}
 */
function doisDigitos(n) {
    return String(n).padStart(2, '0');
}

/**
 * Is it an `AAAA-MM-DD` string that exists in the calendar (2026-02-30 does not)?
 * @param {*} dataIso
 * @returns {boolean}
 */
export function dataIsoValida(dataIso) {
    if (typeof dataIso !== 'string') return false;
    const m = RE_DATA_ISO.exec(dataIso);
    if (!m) return false;
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * 00:00 UTC of the civil date, which is the date's LABEL in calendar arithmetic.
 * @param {string} dataIso
 * @returns {number} ms
 * @throws {Error} when the date is not a valid `AAAA-MM-DD` (caller bug)
 */
function meiaNoiteUtcDoRotulo(dataIso) {
    if (!dataIsoValida(dataIso)) throw new Error(`data inválida: ${String(dataIso)}`);
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    return Date.UTC(ano, mes - 1, dia);
}

/**
 * @param {number} rotuloMs - 00:00 UTC of a date label
 * @returns {string}
 */
function isoDoRotulo(rotuloMs) {
    const d = new Date(rotuloMs);
    return `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
}

/**
 * The civil date in P that contains the instant.
 * @param {number} instanteMs
 * @returns {string} `AAAA-MM-DD`
 */
export function dataCivilP(instanteMs) {
    return isoDoRotulo(instanteMs + DESLOCAMENTO_MS);
}

/**
 * The instant of midnight in P of the civil date (03:00 UTC).
 * @param {string} dataIso
 * @returns {number} ms
 */
export function meiaNoiteP(dataIso) {
    return meiaNoiteUtcDoRotulo(dataIso) - DESLOCAMENTO_MS;
}

/**
 * The civil date `n` days later (earlier when `n` is negative).
 * @param {string} dataIso
 * @param {number} n - integer
 * @returns {string}
 */
export function somarDias(dataIso, n) {
    return isoDoRotulo(meiaNoiteUtcDoRotulo(dataIso) + n * MS_POR_DIA);
}

/**
 * Civil days from `dataA` to `dataB` (positive when `dataB` is later).
 * @param {string} dataA
 * @param {string} dataB
 * @returns {number}
 */
export function diasEntre(dataA, dataB) {
    return Math.round((meiaNoiteUtcDoRotulo(dataB) - meiaNoiteUtcDoRotulo(dataA)) / MS_POR_DIA);
}

/**
 * Rounds the instant to the NEAREST minute, as USNO and the Almanaque Náutico publish.
 *
 * Truncating would bias every cell by half a minute; and rounding comes BEFORE the date, because
 * 23:59:40 becomes 00:00 of the next day, and that is what decides the "(+1)" mark.
 * @param {number} instanteMs
 * @returns {number}
 */
export function arredondarAoMinuto(instanteMs) {
    return Math.round(instanteMs / MS_POR_MINUTO) * MS_POR_MINUTO;
}

/**
 * `HH:MM` of the instant in P, rounded to the minute, with no suffix.
 * @param {number} instanteMs
 * @returns {string}
 */
export function horaMinutoP(instanteMs) {
    const d = new Date(arredondarAoMinuto(instanteMs) + DESLOCAMENTO_MS);
    return `${doisDigitos(d.getUTCHours())}:${doisDigitos(d.getUTCMinutes())}`;
}

/**
 * The day mark of a time that falls outside the column's date: "(+1)", "(−1)", "(+2)"; empty on
 * the same day. The minus is the typographic one (U+2212), as in the zone label.
 * @param {number} deslocamentoDias
 * @returns {string}
 */
export function marcaDeDia(deslocamentoDias) {
    if (!Number.isInteger(deslocamentoDias) || deslocamentoDias === 0) return '';
    return deslocamentoDias > 0 ? `(+${deslocamentoDias})` : `(−${-deslocamentoDias})`;
}

/**
 * What a screen reader says instead of the mark.
 * @param {number} deslocamentoDias
 * @returns {string}
 */
function marcaLida(deslocamentoDias) {
    if (deslocamentoDias === 1) return 'do dia seguinte';
    if (deslocamentoDias === -1) return 'do dia anterior';
    if (deslocamentoDias > 1) return `de ${deslocamentoDias} dias depois`;
    return `de ${-deslocamentoDias} dias antes`;
}

/**
 * A time cell of a matrix column, in Quadro 4-5's format (`06:09h`), with the day mark when the
 * time falls outside the column's date.
 *
 * @param {number|null} instanteMs - null when the phenomenon does not occur
 * @param {string} dataDaColuna - `AAAA-MM-DD`
 * @returns {{texto: string, marca: string, deslocamentoDias: number, textoLido: string}|null}
 *   null when the instant is null: ABSENCE never becomes `00:00`.
 */
export function celulaHoraria(instanteMs, dataDaColuna) {
    if (instanteMs === null || instanteMs === undefined || !Number.isFinite(instanteMs)) return null;
    const arredondado = arredondarAoMinuto(instanteMs);
    const hora = horaMinutoP(arredondado);
    const deslocamentoDias = diasEntre(dataDaColuna, dataCivilP(arredondado));
    const marca = marcaDeDia(deslocamentoDias);
    return {
        texto: `${hora}h`,
        marca,
        deslocamentoDias,
        textoLido: marca ? `${hora} ${marcaLida(deslocamentoDias)}` : hora,
    };
}

/**
 * The cell on one line: "05:03h (+1)".
 * @param {ReturnType<typeof celulaHoraria>} celula
 * @param {string} seNula - the absence text ("não ocorre", "sem luar")
 * @returns {string}
 */
export function textoDaCelula(celula, seNula) {
    if (!celula) return seNula;
    return celula.marca ? `${celula.texto} ${celula.marca}` : celula.texto;
}

/**
 * "24/09/2026".
 * @param {string} dataIso
 * @returns {string}
 */
export function dataPorExtenso(dataIso) {
    const [ano, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}/${ano}`;
}

/**
 * "24/09".
 * @param {string} dataIso
 * @returns {string}
 */
export function diaMes(dataIso) {
    const [, mes, dia] = dataIso.split('-');
    return `${dia}/${mes}`;
}

/**
 * "qui 24/09": the weekday of the civil date, then day and month.
 * @param {string} dataIso
 * @returns {string}
 */
export function rotuloDoDia(dataIso) {
    const semana = DIAS_DA_SEMANA[new Date(meiaNoiteUtcDoRotulo(dataIso)).getUTCDay()];
    return `${semana} ${diaMes(dataIso)}`;
}

/**
 * The column's relative label, in civil days: "D", "D+1", "D−1".
 * @param {number} n
 * @returns {string}
 */
export function rotuloRelativo(n) {
    if (n === 0) return 'D';
    return n > 0 ? `D+${n}` : `D−${-n}`;
}

/**
 * Day D of a point panel and where it came from: the date chosen in the panel (arrows or the date
 * field), or today. Both are civil dates in P, whatever the computer's zone. There is no link to the
 * map's timeline (owner, 2026-09-23).
 * @param {{escolhidoNoPainel: string|null, agoraMs: number}} entrada
 * @returns {{dataD: string, origem: 'painel'|'hoje'}}
 */
export function diaDoPainel({ escolhidoNoPainel, agoraMs }) {
    if (dataIsoValida(escolhidoNoPainel)) return { dataD: escolhidoNoPainel, origem: 'painel' };
    return { dataD: dataCivilP(agoraMs), origem: 'hoje' };
}

/**
 * "UTC−4", "UTC+5:30", "UTC" from an offset in minutes (positive east).
 * @param {number} minutos
 * @returns {string}
 */
export function rotuloUtc(minutos) {
    if (!Number.isFinite(minutos) || minutos === 0) return 'UTC';
    const sinal = minutos > 0 ? '+' : '−';
    const abs = Math.abs(minutos);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return m === 0 ? `UTC${sinal}${h}` : `UTC${sinal}${h}:${doisDigitos(m)}`;
}

/**
 * The line the panel shows when the computer is not in P.
 *
 * The offset is measured ON THE DATE BEING QUERIED, not today: a browser in a zone with daylight
 * saving sits at −180 in one month and −120 in another.
 *
 * @param {number} deslocamentoDoNavegadorMin - `-new Date(instant).getTimezoneOffset()`
 * @returns {string|null} null when the computer is in Brasília
 */
export function avisoDeFusoDoNavegador(deslocamentoDoNavegadorMin) {
    if (!Number.isFinite(deslocamentoDoNavegadorMin)) return null;
    if (deslocamentoDoNavegadorMin === DESLOCAMENTO_BRASILIA_MIN) return null;
    return `Este computador está em ${rotuloUtc(deslocamentoDoNavegadorMin)}. `
        + 'Os horários deste painel estão em Brasília.';
}

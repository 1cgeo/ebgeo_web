// Path: js/utilities/luminosidade/matriz-pitcic.model.js

/**
 * @fileoverview THE LIGHT MODEL of PITCIC: day D, the night of D, the lunar phase window and the
 * Moon's passage. Pure; it never imports the astronomy library.
 *
 * It answers, for a point and a civil day D in Brasília, the two rows that EB70-MC-10.336 reserves
 * for light in the "Matriz das condições meteorológicas" (Quadro 2-1; example filled in Quadro
 * 4-5): "Dados solares" (ICMN, FCVN) and "Dados lunares" (Fase lunar, Ini Luar, Fim do luar), for
 * D, D+1 and D+2. The ephemerides come in as an argument (`efemerides.js` in the app, the same
 * adapter in the tests), so this file is driven in node and the library can be swapped without
 * touching a line here.
 *
 * ── THE FOUR DEFINITIONS, and the reading each one settles (owner's decisions D1 to D3) ─────
 *
 *   1. DAY D is the civil date in P (`hora-brasilia.js`). "Dados solares de D" are the events of
 *      the Sun's solar day around the local noon of D. The library returns the solar day of the
 *      instant it gets, so this model passes the local MEAN solar noon of D
 *      ({@link instanteDoDiaSolar}). Passing midnight in P returned the PREVIOUS day in 365 of 365
 *      days at every point west of 45°W (Brasília, Boa Vista, Rio Branco), and the right day at
 *      Recife and Salvador: a test with only north-eastern coastal cities stays green with the bug.
 *   2. THE NIGHT OF D goes from the FCVN of D to the ICMN of D+1. Where the Sun never goes 12°
 *      below the horizon (Antarctica in summer), the night falls back to the civil twilights, then
 *      to sunset and sunrise, and {@link noiteDe} names the criterion it used.
 *   3. "INI LUAR" AND "FIM DO LUAR" are the rise and set of the Moon's passage that overlaps the
 *      night of D the most (Quadro 4-5: "Ini Luar 18:00h" comes BEFORE "FCVN 18:07h", and "Fim do
 *      luar 08:25h" is the next morning). Moonlight is not cut by twilight: a rise at 16:28 counts.
 *      When no passage touches the night, both fields say "sem luar". Measured at Porto Alegre in
 *      2026: 37 of 365 nights have no moonlight, and none has two passages, so the tie-break by
 *      overlap exists for completeness and produces no screen state.
 *   4. THE LUNAR PHASE is the window CENTRED on the principal phase (Fig 4-11: four groups of
 *      seven Moon positions, each centred on new, first quarter, full and last quarter). The cycle
 *      is 29.53 days, so each window is 7.38 days, and the border is the PHASE ANGLE (45°, 135°,
 *      225°, 315°), never a day count. It is evaluated at the middle of the night of D. The
 *      example in Quadro 4-5 follows the colloquial convention ("minguante" next to a moonrise at
 *      18:00, which is the centre of the LUA CHEIA group of Fig 4-11), and the two conventions
 *      name 135 of 365 nights of 2026 differently; the norm is the text and the figure.
 *
 * ABSENCE IS NULL, AND NULL NEVER BECOMES 00:00. A phenomenon that does not happen (the ICMN at
 * Ferraz station on 2026-12-21, where the Sun rises and sets but never sinks 12° below the
 * horizon) is null for that field alone, with a reason code, and never nulls the whole day.
 */

import { MS_POR_DIA, arredondarAoMinuto, dataIsoValida, somarDias } from '@utils/hora-brasilia.js';

// ============================================================================================
// THE VOCABULARY
// ============================================================================================

/** The four phase names, in cycle order starting at the new Moon. */
export const FASES_LUNARES = Object.freeze(['nova', 'crescente', 'cheia', 'minguante']);

/**
 * Half a window, as a fraction of the cycle: the windows are CENTRED on the principal phases, so
 * each one starts one eighth of a cycle (45°) before its phase.
 */
export const MEIA_JANELA_DE_FASE = 0.125;

/**
 * The Sun's times of Fig 4-10, in chronological order, with the altitude of the Sun's centre that
 * defines each one (the rise and set are the UPPER LIMB with standard refraction, −0.833°).
 * @type {ReadonlyArray<{chave: string, angulo: number, sobe: boolean}>}
 */
export const EVENTOS_DO_SOL = Object.freeze([
    Object.freeze({ chave: 'primeiraClaridade', angulo: -18, sobe: true }),
    Object.freeze({ chave: 'icmn', angulo: -12, sobe: true }),
    Object.freeze({ chave: 'inicioCivil', angulo: -6, sobe: true }),
    Object.freeze({ chave: 'nascer', angulo: -0.833, sobe: true }),
    Object.freeze({ chave: 'por', angulo: -0.833, sobe: false }),
    Object.freeze({ chave: 'fimCivil', angulo: -6, sobe: false }),
    Object.freeze({ chave: 'fcvn', angulo: -12, sobe: false }),
    Object.freeze({ chave: 'ultimaClaridade', angulo: -18, sobe: false }),
]);

/**
 * Why a Sun field is null.
 * @enum {string}
 */
export const MotivoSolar = Object.freeze({
    /** The Sun stays above that altitude all day (e.g. never 12° below in the polar summer). */
    NUNCA_DESCE: 'nunca-desce',
    /** The Sun stays below that altitude all day (polar winter). */
    NUNCA_SOBE: 'nunca-sobe',
});

/**
 * Which pair of Sun events bounded the night of D.
 * @enum {string}
 */
export const CriterioDaNoite = Object.freeze({
    NAUTICO: 'nautico',
    CIVIL: 'civil',
    HORIZONTE: 'horizonte',
    /** The Sun never rose: the night is solar noon to solar noon. */
    NOITE_POLAR: 'noite-polar',
});

// ============================================================================================
// THE POINT AND THE SOLAR DAY
// ============================================================================================

/**
 * Validates and normalizes a point. MapLibre's `unproject` returns longitudes beyond ±180 when the
 * world is repeated, so the longitude is wrapped; a latitude outside ±90 is a caller bug.
 * @param {{lat: number, lng: number}} ponto
 * @returns {{lat: number, lng: number}}
 * @throws {Error} when a coordinate is not a finite number, or the latitude is out of range
 */
export function normalizarPonto(ponto) {
    const lat = Number(ponto?.lat);
    const lng = Number(ponto?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error('luminosidade: ponto sem latitude e longitude numéricas');
    }
    if (lat < -90 || lat > 90) throw new Error(`luminosidade: latitude fora de ±90: ${lat}`);
    const lngNormalizada = ((((lng + 180) % 360) + 360) % 360) - 180;
    return { lat, lng: lngNormalizada === -180 && lng > 0 ? 180 : lngNormalizada };
}

/**
 * The local MEAN solar noon of the civil date `dataIso` at longitude `lng`, as epoch ms.
 *
 * It is the instant the model hands to the library's solar-day computation: the library rounds to
 * the solar day containing the instant, and noon is the only instant that is inside the right day
 * at EVERY longitude (see definition 1 in the file header).
 * @param {string} dataIso
 * @param {number} lng
 * @returns {number}
 */
export function instanteDoDiaSolar(dataIso, lng) {
    if (!dataIsoValida(dataIso)) throw new Error(`luminosidade: data inválida: ${String(dataIso)}`);
    const [ano, mes, dia] = dataIso.split('-').map(Number);
    return Date.UTC(ano, mes - 1, dia, 12) - (lng / 360) * MS_POR_DIA;
}

/**
 * The phase name of a phase fraction, by the centred windows of Fig 4-11.
 * @param {number} fase - 0 → 1: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
 * @returns {string|null} one of {@link FASES_LUNARES}; null for a non-finite input
 */
export function nomeDaFase(fase) {
    if (!Number.isFinite(fase)) return null;
    const f = ((fase % 1) + 1) % 1;
    const indice = Math.floor(((f + MEIA_JANELA_DE_FASE) % 1) * FASES_LUNARES.length);
    return FASES_LUNARES[Math.min(indice, FASES_LUNARES.length - 1)];
}

// ============================================================================================
// THE CALCULATOR (one per point, memoized)
// ============================================================================================

/**
 * @typedef {Object} Efemerides - The adapter `efemerides.js`, or a double with the same shape.
 * @property {(instanteMs: number, lat: number, lng: number) => Object} horariosDoSol
 * @property {(instanteMs: number, lat: number, lng: number) => number} alturaDoSol
 * @property {(diaUtcMs: number, lat: number, lng: number) => {nasce: number|null,
 *   poe: number|null, sempreAcima: boolean, sempreAbaixo: boolean}} eventosDaLuaNoDiaUtc
 * @property {(instanteMs: number) => {fracao: number, fase: number, crescente: boolean}}
 *   iluminacaoDaLua
 */

/**
 * @typedef {Object} DiaSolar
 * @property {string} data - the civil date D
 * @property {number} meioDia
 * @property {Object<string, number|null>} horarios - one entry per {@link EVENTOS_DO_SOL} key
 * @property {Object<string, string|null>} motivos - why each null entry is null
 * @property {number} alturaMaxima - the Sun's altitude at solar noon, degrees
 * @property {number} alturaMinima - the Sun's altitude at the following solar midnight, degrees
 */

/**
 * @typedef {Object} PassagemDaLua
 * @property {number|null} nasce - null when the Moon was already up before the scanned window
 * @property {number|null} poe - null when the Moon is still up after the scanned window
 */

/** Two library events of the same kind this close are the same event seen from two UTC days. */
const EVENTO_DUPLICADO_MS = 10 * 60000;

/**
 * Builds the memoized calculator for one point. Every function of this module that needs the
 * ephemerides goes through one, so a three-day matrix computes each solar day and each UTC day of
 * the Moon exactly once.
 * @param {{lat: number, lng: number}} pontoBruto
 * @param {Efemerides} efem
 */
export function criarCalculadora(pontoBruto, efem) {
    const ponto = normalizarPonto(pontoBruto);
    const { lat, lng } = ponto;
    const dias = new Map();
    const diasDaLua = new Map();

    /**
     * @param {string} dataIso
     * @returns {DiaSolar}
     */
    function diaSolar(dataIso) {
        const guardado = dias.get(dataIso);
        if (guardado) return guardado;

        const bruto = efem.horariosDoSol(instanteDoDiaSolar(dataIso, lng), lat, lng);
        const meioDia = bruto.meioDia;
        const alturaMaxima = efem.alturaDoSol(meioDia, lat, lng);
        const alturaMinima = efem.alturaDoSol(meioDia + MS_POR_DIA / 2, lat, lng);

        const horarios = {};
        const motivos = {};
        for (const { chave, angulo } of EVENTOS_DO_SOL) {
            const valor = Number.isFinite(bruto[chave]) ? bruto[chave] : null;
            horarios[chave] = valor;
            if (valor !== null) {
                motivos[chave] = null;
            } else {
                // Which side the Sun stayed on decides the sentence: "never 12° below" (polar
                // summer) and "never above −12°" (polar winter) are opposite situations.
                motivos[chave] = alturaMinima > angulo ? MotivoSolar.NUNCA_DESCE : MotivoSolar.NUNCA_SOBE;
            }
        }
        const dia = Object.freeze({ data: dataIso, meioDia, horarios, motivos, alturaMaxima, alturaMinima });
        dias.set(dataIso, dia);
        return dia;
    }

    /**
     * @param {number} indiceDoDia - days since the epoch, UTC
     */
    function luaNoDiaUtc(indiceDoDia) {
        const guardado = diasDaLua.get(indiceDoDia);
        if (guardado) return guardado;
        const r = efem.eventosDaLuaNoDiaUtc(indiceDoDia * MS_POR_DIA, lat, lng);
        diasDaLua.set(indiceDoDia, r);
        return r;
    }

    /**
     * The night of D: from the FCVN of D to the ICMN of D+1, with the fallbacks of definition 2.
     * @param {string} dataIso
     * @returns {{inicio: number, fim: number, criterio: string}|null} null when the Sun does not
     *   set at all (midnight sun): there is no night to overlap.
     */
    function noiteDe(dataIso) {
        const hoje = diaSolar(dataIso);
        const amanha = diaSolar(somarDias(dataIso, 1));
        const pares = [
            [CriterioDaNoite.NAUTICO, 'fcvn', 'icmn'],
            [CriterioDaNoite.CIVIL, 'fimCivil', 'inicioCivil'],
            [CriterioDaNoite.HORIZONTE, 'por', 'nascer'],
        ];
        for (const [criterio, chaveInicio, chaveFim] of pares) {
            const inicio = hoje.horarios[chaveInicio];
            const fim = amanha.horarios[chaveFim];
            if (inicio !== null && fim !== null && fim > inicio) return { inicio, fim, criterio };
        }
        if (hoje.alturaMaxima < EVENTOS_DO_SOL[3].angulo) {
            return { inicio: hoje.meioDia, fim: amanha.meioDia, criterio: CriterioDaNoite.NOITE_POLAR };
        }
        return null;
    }

    /**
     * The Moon's passages (above the horizon) that intersect [inicioMs, fimMs], scanning whole UTC
     * days from one day before to one day after.
     * @param {number} inicioMs
     * @param {number} fimMs
     * @returns {PassagemDaLua[]}
     */
    function passagensDaLua(inicioMs, fimMs) {
        const primeiro = Math.floor(inicioMs / MS_POR_DIA) - 1;
        const ultimo = Math.floor(fimMs / MS_POR_DIA) + 1;
        const eventos = [];
        let algumSempreAcima = false;
        for (let d = primeiro; d <= ultimo; d++) {
            const r = luaNoDiaUtc(d);
            if (r.nasce !== null) eventos.push({ tipo: 'nasce', t: r.nasce });
            if (r.poe !== null) eventos.push({ tipo: 'poe', t: r.poe });
            if (r.sempreAcima) algumSempreAcima = true;
        }
        eventos.sort((a, b) => a.t - b.t);
        const unicos = eventos.filter((e, i) => !eventos.slice(0, i).some(
            (o) => o.tipo === e.tipo && Math.abs(o.t - e.t) < EVENTO_DUPLICADO_MS));

        if (unicos.length === 0) return algumSempreAcima ? [{ nasce: null, poe: null }] : [];

        const passagens = [];
        let aberta = unicos[0].tipo === 'poe' ? { nasce: null, poe: null } : null;
        for (const e of unicos) {
            if (e.tipo === 'nasce') {
                if (!aberta) aberta = { nasce: e.t, poe: null };
            } else if (aberta) {
                aberta.poe = e.t;
                passagens.push(aberta);
                aberta = null;
            }
        }
        if (aberta) passagens.push(aberta);

        const desde = primeiro * MS_POR_DIA;
        const ate = (ultimo + 1) * MS_POR_DIA;
        return passagens.filter((p) => (p.poe ?? ate) > inicioMs && (p.nasce ?? desde) < fimMs);
    }

    return Object.freeze({ ponto, diaSolar, noiteDe, passagensDaLua, luaNoDiaUtc });
}

// ============================================================================================
// THE MATRIX
// ============================================================================================

/**
 * How long a passage and a night overlap, in ms (an open end counts as infinite).
 *
 * MEASURED AT THE SCREEN'S RESOLUTION: every instant is rounded to the minute first, because the
 * matrix writes minutes. Without it, a Moon rising 14 seconds before the ICMN of D+1 (Brasília,
 * night of 2026-07-12: rise 05:49:47, ICMN 05:50:01) "covered" the night and the panel printed
 * "Ini Luar 05:50h (+1)" next to "ICMN 05:50h", a moonlit night of zero minutes. Rounded, the
 * overlap is zero and the night says "sem luar", which is also what USNO's own minutes give.
 * @param {PassagemDaLua} passagem
 * @param {{inicio: number, fim: number}} noite
 * @returns {number}
 */
export function sobreposicao(passagem, noite) {
    const inicio = Math.max(
        passagem.nasce === null ? -Infinity : arredondarAoMinuto(passagem.nasce),
        arredondarAoMinuto(noite.inicio)
    );
    const fim = Math.min(
        passagem.poe === null ? Infinity : arredondarAoMinuto(passagem.poe),
        arredondarAoMinuto(noite.fim)
    );
    return Math.max(0, fim - inicio);
}

/**
 * The passage that overlaps the night the most; the earlier one on a tie.
 * @param {{inicio: number, fim: number}} noite
 * @param {PassagemDaLua[]} passagens
 * @returns {PassagemDaLua|null}
 */
export function passagemDaNoite(noite, passagens) {
    let melhor = null;
    let melhorSobreposicao = 0;
    for (const p of passagens) {
        const s = sobreposicao(p, noite);
        if (s > melhorSobreposicao) {
            melhor = p;
            melhorSobreposicao = s;
        }
    }
    return melhor;
}

/**
 * @typedef {Object} ColunaDaMatriz
 * @property {string} data
 * @property {DiaSolar} sol
 * @property {{inicio: number, fim: number, criterio: string}|null} noite
 * @property {Object} lua
 * @property {string|null} lua.fase - one of {@link FASES_LUNARES}
 * @property {number} lua.fracao - illuminated fraction at the middle of the night, 0..1
 * @property {number} lua.iluminacaoPct - rounded percentage
 * @property {boolean} lua.crescente - the illuminated fraction is growing
 * @property {number} lua.instanteDaFase - the instant the phase was evaluated at
 * @property {number|null} lua.nasce - "Ini Luar"
 * @property {number|null} lua.poe - "Fim do luar"
 * @property {boolean} lua.semLuar - no passage touches the night
 * @property {boolean} lua.semNoite - the Sun does not set: there is no night of D
 * @property {boolean} lua.nasceAntes - the passage started before the scanned window
 * @property {boolean} lua.poeDepois - the passage ends after the scanned window
 */

/**
 * One column (one civil day) of the matrix.
 * @param {ReturnType<typeof criarCalculadora>} calc
 * @param {string} dataIso
 * @returns {ColunaDaMatriz}
 */
export function colunaDaMatriz(calc, dataIso) {
    const sol = calc.diaSolar(dataIso);
    const noite = calc.noiteDe(dataIso);
    const instanteDaFase = noite ? (noite.inicio + noite.fim) / 2 : sol.meioDia + MS_POR_DIA / 2;
    return {
        data: dataIso,
        sol,
        noite,
        lua: luaDaNoite(calc, noite, instanteDaFase),
    };
}

/**
 * @param {ReturnType<typeof criarCalculadora>} calc
 * @param {{inicio: number, fim: number}|null} noite
 * @param {number} instanteDaFase
 */
function luaDaNoite(calc, noite, instanteDaFase) {
    const ilum = calc.iluminacao(instanteDaFase);
    const passagem = noite ? passagemDaNoite(noite, calc.passagensDaLua(noite.inicio, noite.fim)) : null;
    return {
        fase: nomeDaFase(ilum.fase),
        fracao: ilum.fracao,
        iluminacaoPct: Math.round(ilum.fracao * 100),
        crescente: ilum.crescente,
        instanteDaFase,
        nasce: passagem?.nasce ?? null,
        poe: passagem?.poe ?? null,
        semLuar: noite !== null && passagem === null,
        semNoite: noite === null,
        nasceAntes: passagem !== null && passagem.nasce === null,
        poeDepois: passagem !== null && passagem.poe === null,
    };
}

/**
 * The PITCIC light matrix: D, D+1, D+2 for one point.
 * @param {string} dataD - civil date D in P, `AAAA-MM-DD`
 * @param {{lat: number, lng: number}} ponto
 * @param {Efemerides} efem
 * @param {{dias?: number}} [opcoes]
 * @returns {{dataD: string, ponto: {lat: number, lng: number}, colunas: ColunaDaMatriz[]}}
 */
export function matrizPitcic(dataD, ponto, efem, { dias = 3 } = {}) {
    if (!dataIsoValida(dataD)) throw new Error(`luminosidade: data D inválida: ${String(dataD)}`);
    if (!Number.isInteger(dias) || dias < 1) throw new Error(`luminosidade: dias inválido: ${dias}`);
    const calc = comIluminacao(criarCalculadora(ponto, efem), efem);
    const colunas = [];
    for (let n = 0; n < dias; n++) colunas.push(colunaDaMatriz(calc, somarDias(dataD, n)));
    return { dataD, ponto: calc.ponto, colunas };
}

/**
 * The calculator plus the (point-independent) illumination, so {@link colunaDaMatriz} reads one
 * object.
 * @param {ReturnType<typeof criarCalculadora>} calc
 * @param {Efemerides} efem
 */
function comIluminacao(calc, efem) {
    return Object.freeze({ ...calc, iluminacao: (instanteMs) => efem.iluminacaoDaLua(instanteMs) });
}

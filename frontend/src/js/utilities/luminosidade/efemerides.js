// Path: js/utilities/luminosidade/efemerides.js

/**
 * @fileoverview The ADAPTER: the only file that calls the astronomy library.
 *
 * It translates SunCalc's vocabulary (`nauticalDawn`, `nightEnd`, Dates, absent keys) into the
 * model's (`icmn`, `primeiraClaridade`, epoch ms, explicit null), so that
 * `matriz-pitcic.model.js` never learns a library name. Swapping to `astronomy-engine` costs this
 * file and one run of the USNO reference table (`tests/unit/luminosidade-referencia-usno.test.js`).
 *
 * TWO LIBRARY FACTS THE MODEL DEPENDS ON, both measured against USNO over 2026 (see the wiki page
 * `docs/wiki/luminosidade-pitcic.md`):
 *
 *   - `getTimes` returns the solar day of the UTC-rounded instant it is given. Passing midnight in
 *     Brasília returns the PREVIOUS day at every point west of 45°W. The model passes the local
 *     mean solar noon of the civil date, and this adapter passes the instant through untouched.
 *   - `getMoonTimes` scans the UTC calendar day of the date, whatever its time of day. The model
 *     asks for whole UTC days and filters by the night of D in P.
 *
 * The Moon's rise and set are the UPPER LIMB on the horizon, with refraction and parallax; the
 * Sun's rise and set are at −0.833° (upper limb plus standard refraction); the twilights are the
 * Sun's CENTRE at −6°, −12° and −18°.
 */

import { getTimes, getMoonTimes, getMoonIllumination, getPosition } from '@js/vendor/suncalc.js';

/**
 * @param {Date|null|undefined} data
 * @returns {number|null}
 */
function ms(data) {
    return data instanceof Date && Number.isFinite(data.getTime()) ? data.getTime() : null;
}

/**
 * @typedef {Object} HorariosDoSol
 * @property {number} meioDia - Local solar noon (epoch ms).
 * @property {number|null} primeiraClaridade - Centre at −18°, rising.
 * @property {number|null} icmn - Centre at −12°, rising (nautical dawn).
 * @property {number|null} inicioCivil - Centre at −6°, rising.
 * @property {number|null} nascer - Upper limb on the horizon, rising.
 * @property {number|null} por - Upper limb on the horizon, setting.
 * @property {number|null} fimCivil - Centre at −6°, setting.
 * @property {number|null} fcvn - Centre at −12°, setting (nautical dusk).
 * @property {number|null} ultimaClaridade - Centre at −18°, setting.
 */

/**
 * The Sun's times of the solar day that contains `instanteMs`.
 * @param {number} instanteMs
 * @param {number} lat
 * @param {number} lng
 * @returns {HorariosDoSol}
 */
export function horariosDoSol(instanteMs, lat, lng) {
    const t = getTimes(new Date(instanteMs), lat, lng);
    return {
        meioDia: ms(t.solarNoon),
        primeiraClaridade: ms(t.nightEnd),
        icmn: ms(t.nauticalDawn),
        inicioCivil: ms(t.dawn),
        nascer: ms(t.sunrise),
        por: ms(t.sunset),
        fimCivil: ms(t.dusk),
        fcvn: ms(t.nauticalDusk),
        ultimaClaridade: ms(t.night),
    };
}

/**
 * The Sun's apparent altitude, in degrees.
 * @param {number} instanteMs
 * @param {number} lat
 * @param {number} lng
 * @returns {number}
 */
export function alturaDoSol(instanteMs, lat, lng) {
    return getPosition(new Date(instanteMs), lat, lng).altitude;
}

/**
 * The Moon's rise and set within ONE UTC calendar day.
 * @param {number} diaUtcMs - any instant of that UTC day
 * @param {number} lat
 * @param {number} lng
 * @returns {{nasce: number|null, poe: number|null, sempreAcima: boolean, sempreAbaixo: boolean}}
 */
export function eventosDaLuaNoDiaUtc(diaUtcMs, lat, lng) {
    const r = getMoonTimes(new Date(diaUtcMs), lat, lng);
    return {
        nasce: ms(r.rise),
        poe: ms(r.set),
        sempreAcima: r.alwaysUp === true,
        sempreAbaixo: r.alwaysDown === true,
    };
}

/**
 * The Moon's illumination at an instant (geocentric; the phase does not depend on the point).
 * @param {number} instanteMs
 * @returns {{fracao: number, fase: number, crescente: boolean}}
 *   `fase` goes 0 → 1: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
 */
export function iluminacaoDaLua(instanteMs) {
    const r = getMoonIllumination(new Date(instanteMs));
    return { fracao: r.fraction, fase: r.phase, crescente: r.waxing === true };
}

/**
 * The adapter as one object, which is what the model receives.
 * @type {Readonly<{horariosDoSol: typeof horariosDoSol, alturaDoSol: typeof alturaDoSol,
 *   eventosDaLuaNoDiaUtc: typeof eventosDaLuaNoDiaUtc, iluminacaoDaLua: typeof iluminacaoDaLua}>}
 */
export const efemerides = Object.freeze({
    horariosDoSol,
    alturaDoSol,
    eventosDaLuaNoDiaUtc,
    iluminacaoDaLua,
});

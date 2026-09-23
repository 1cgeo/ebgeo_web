// Path: js/vendor/suncalc.js

/**
 * @module vendor/suncalc
 * @description Single entry point of SunCalc (2.0.2), from npm, pinned to the EXACT version.
 *
 * It computes, in the browser and with no network, the Sun's times (rise, set and the three
 * twilights), the Moon's rise and set, and its illuminated fraction: the five fields of the "Dados
 * solares" and "Dados lunares" rows of the PITCIC weather matrix (EB70-MC-10.336, Quadro 4-5). Why
 * this library and not `astronomy-engine`, and the measurement that decided it, live in
 * `docs/wiki/luminosidade-pitcic.md`.
 *
 * Three rules, each measured on this tree:
 *
 * 1. **ONLY THROUGH `import()`.** This module is reached solely by the `import()` in
 *    `utilities/luminosidade/carregador.js`, and the package is listed in `EXTERNOS_SO_DINAMICOS`
 *    of `tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`, which fails a static import of it from
 *    anywhere. The LOADING model is Turf's, not the WMM's: the WMM reached the map's boot through
 *    the feature panel and nothing flagged it.
 *
 * 2. **ONE READER.** `utilities/luminosidade/efemerides.js` calls the library, and nobody else.
 *    Swapping libraries costs that file plus one run of the USNO reference table; a second reader
 *    would turn the swap into a hunt.
 *
 * 3. **NO GLOBAL, unlike Turf.** There is no legacy call site to serve, so the package is
 *    re-exported by name and nothing is written to `window`.
 *
 * The package manifest declares NO license (its LICENSE file is BSD-2-Clause, 2026), so an
 * automated license scan reports it as unknown. It was checked by hand, and the wiki page above
 * records it.
 */

export { getTimes, getMoonTimes, getMoonIllumination, getPosition, getMoonPosition } from 'suncalc';

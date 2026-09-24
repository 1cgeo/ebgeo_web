// Path: js/utilities/luminosidade/index.js

/**
 * @fileoverview The PUBLIC DOOR of the light module, and the root of its lazy chunk.
 *
 * Reached ONLY by the `import()` in `carregador.js`, never statically: this file pulls the astronomy
 * library through `efemerides.js`, and `tests/unit/teto-de-peso-da-pagina-do-mapa.test.js` fails a
 * static path to the package from the map's boot graph. The pure leaves (`matriz-pitcic.model.js`,
 * `quadro-pitcic.js`, `luminosidade-phrases.js`, and the shared `utilities/hora-brasilia.js`) carry
 * no library and may be imported directly where a caller needs them.
 */

import { efemerides } from './efemerides.js';
import { matrizPitcic } from './matriz-pitcic.model.js';
import { PainelLuminosidade } from './luminosidade.panel.js';
import { registrarUso } from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';

/** One panel per map. */
const paineis = new WeakMap();

/**
 * The PITCIC light matrix (D, D+1, D+2 by default) for a point.
 * @param {string} dataD - civil date in P, `AAAA-MM-DD`
 * @param {{lat: number, lng: number}} ponto
 * @param {{dias?: number}} [opcoes]
 */
export function calcularMatriz(dataD, ponto, opcoes) {
    return matrizPitcic(dataD, ponto, efemerides, opcoes);
}

/**
 * Opens the light panel on a point of the map (or moves the open one there).
 * @param {Object} opcoes
 * @param {Object} opcoes.map
 * @param {{lat: number, lng: number}} opcoes.ponto
 * @param {string} [opcoes.formato] - the map's current coordinate format id
 * @returns {PainelLuminosidade}
 */
export function abrirPainelLuminosidade({ map, ponto, formato }) {
    let painel = paineis.get(map);
    if (!painel) {
        painel = new PainelLuminosidade({
            map,
            calcular: (dataD, p) => calcularMatriz(dataD, p),
        });
        paineis.set(map, painel);
    }
    const jaAberto = painel.estaAberto();
    painel.abrir({ ponto, formato });
    // One count per OPENING, not per point change of an open panel: the number that decides whether
    // the entry is found is how often people come in, not how often they click around once inside.
    if (!jaAberto) registrarUso(EventoDeUso.LUMINOSIDADE_ABERTA);
    return painel;
}

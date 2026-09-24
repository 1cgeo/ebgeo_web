// Path: js/utilities/meteorologia/index.js

/**
 * @fileoverview The PUBLIC DOOR of the weather module, and the root of its lazy chunk.
 *
 * Reached ONLY by the `import()` in `carregador.js`, never statically, like the light module's.
 * There is no library to keep out of the boot graph here; what stays out is the panel, the source
 * and the aggregation, which nobody needs until the context menu is used.
 */

import config from '@js/config.js';
import { registrarUso } from '@js/session/uso-lote.js';
import { EventoDeUso } from '@js/session/eventos-de-uso.js';
import { criarFonteMeteorologica } from './fonte-meteorologica.js';
import { PainelMeteorologia } from './meteorologia.panel.js';

/** One panel per map. */
const paineis = new WeakMap();

/** One source per root: its memory cache is what spares a second request for the same cell. */
let fonte = null;
let raizDaFonte = null;

/**
 * @returns {ReturnType<typeof criarFonteMeteorologica>}
 */
function fonteAtual() {
    const raiz = config.services?.meteorologiaUrl ?? '';
    if (!fonte || raiz !== raizDaFonte) {
        fonte = criarFonteMeteorologica({ base: raiz });
        raizDaFonte = raiz;
    }
    return fonte;
}

/**
 * Opens the weather panel on a point of the map (or moves the open one there).
 * @param {Object} opcoes
 * @param {Object} opcoes.map
 * @param {{lat: number, lng: number}} opcoes.ponto
 * @param {string} [opcoes.formato] - the map's current coordinate format id
 * @returns {PainelMeteorologia}
 */
export function abrirPainelMeteorologia({ map, ponto, formato }) {
    let painel = paineis.get(map);
    if (!painel) {
        painel = new PainelMeteorologia({
            map,
            consultar: (p, datas) => fonteAtual().consultar(p, datas),
        });
        paineis.set(map, painel);
    }
    const jaAberto = painel.estaAberto();
    painel.abrir({ ponto, formato });
    // One count per OPENING, and never the point: a coordinate of interest is sensitive data.
    if (!jaAberto) registrarUso(EventoDeUso.METEOROLOGIA_ABERTA);
    return painel;
}

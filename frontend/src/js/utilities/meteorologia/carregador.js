// Path: js/utilities/meteorologia/carregador.js

/**
 * @fileoverview The ON-DEMAND DOOR of the weather module: the only static entry into it from the
 * map, and the one place that decides whether the context menu offers it.
 *
 * The light loader's shape (`utilities/luminosidade/carregador.js`), MINUS the warm-up: the light
 * panel warms up because it is worth the most to a unit with no network, and the weather panel is
 * worth nothing without one, so fetching its chunk ahead would only spend the network of whoever
 * never opens it. The census of doors (`tests/unit/carga-sob-demanda-portas.test.js`) lists this
 * file.
 */

import config from '@js/config.js';
import { carregarSobDemanda } from '@utils/carga-sob-demanda.js';

/** @type {Promise<Object>|null} */
let carregando = null;

/**
 * Is the weather panel offered in this deployment? It is ON by default (owner, 2026-09-23) and the
 * administrator can turn it off, because on, every browser that opens it sends a cell of the area
 * of interest to the source; an empty source root keeps it off whatever the flag says. This is
 * configuration of the deployment, not rank or state: when it is off the command is not drawn.
 * @param {Object} [cfg] - test seam
 * @returns {boolean}
 */
export function meteorologiaDisponivel(cfg = config) {
    return cfg?.features?.meteorologia === true && raizDaFonteValida(cfg?.services?.meteorologiaUrl);
}

/**
 * Is the source root an absolute http(s) address? The env path has no schema check (only the admin
 * panel's has), and the two wrong values fail badly: a root without a scheme makes `fetch` resolve
 * against the app's OWN origin, which puts the coordinate in our own proxy's access log, and an
 * `http://` root on an https page is blocked as mixed content and reads as "no connection".
 * @param {*} raiz
 * @returns {boolean}
 */
export function raizDaFonteValida(raiz) {
    if (typeof raiz !== 'string' || raiz.trim() === '') return false;
    try {
        const url = new URL(raiz.trim());
        return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
    } catch {
        return false;
    }
}

/**
 * Loads the weather module (the panel, the source and the aggregation).
 * @returns {Promise<typeof import('./index.js')>}
 */
export function carregarMeteorologia() {
    if (!carregando) {
        carregando = carregarSobDemanda(() => import('./index.js'))
            .catch((erro) => {
                carregando = null;
                throw erro;
            });
    }
    return carregando;
}

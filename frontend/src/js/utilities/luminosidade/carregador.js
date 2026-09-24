// Path: js/utilities/luminosidade/carregador.js

/**
 * @fileoverview The ON-DEMAND DOOR of the light module: the only static entry into it from the map.
 *
 * It is the Turf loader's shape (`utilities/turf-loader.js`): a memoized `import()` through
 * `carregarSobDemanda`, which retries once and then shows the notice with "Recarregar". The census
 * of doors (`tests/unit/carga-sob-demanda-portas.test.js`) lists this file.
 *
 * WHY A WARM-UP, which Turf deliberately does not have: the case where this tool is worth the most
 * is a unit with no network, and a chunk fetched only on first use fails if the network dropped
 * before it. So {@link aquecerLuminosidade} loads it once, in idle time, after the map is drawn.
 * The price is a few kilobytes fetched off the critical path on every map opening. Putting the
 * module in the eager graph instead would cost parse time at boot and fight the weight guard.
 *
 * The warm-up never shows the notice: nobody asked for anything yet. A failed warm-up forgets its
 * promise, so the person's own click tries again and, failing, speaks.
 */

import { carregarSobDemanda } from '@utils/carga-sob-demanda.js';

/**
 * The context menu item's label. It lives HERE, in the door, and not in `luminosidade-phrases.js`:
 * this file is the only piece of the module the map loads at boot, and importing the label from the
 * phrase leaf put every sentence of the panel in the boot payload to read one string.
 */
export const ROTULO_DO_ITEM_DE_MENU = 'Luminosidade neste ponto';

/** @type {Promise<Object>|null} */
let carregando = null;

/**
 * Loads the light module (the panel, the model and the astronomy library).
 * @param {{avisar?: boolean}} [opcoes] - `avisar: false` for a load nobody asked for
 * @returns {Promise<typeof import('./index.js')>}
 */
export function carregarLuminosidade({ avisar = true } = {}) {
    if (!carregando) {
        carregando = carregarSobDemanda(() => import('./index.js'), { avisar })
            .catch((erro) => {
                carregando = null;
                throw erro;
            });
    }
    return carregando;
}

/**
 * Warms the module up in idle time, once. Safe to call more than once.
 * @param {Object} [ambiente] - test seam
 * @returns {void}
 */
export function aquecerLuminosidade(ambiente = globalThis) {
    const carregar = () => {
        carregarLuminosidade({ avisar: false }).catch(() => {});
    };
    if (typeof ambiente.requestIdleCallback === 'function') {
        ambiente.requestIdleCallback(carregar, { timeout: 10000 });
    } else if (typeof ambiente.setTimeout === 'function') {
        // Safari has no requestIdleCallback; a few seconds after boot is the idle it gets.
        ambiente.setTimeout(carregar, 3000);
    }
}

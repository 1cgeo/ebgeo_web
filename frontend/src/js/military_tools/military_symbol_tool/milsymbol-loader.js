// Path: js/military_tools/military_symbol_tool/milsymbol-loader.js

/**
 * @fileoverview On-demand loader for the milsymbol global (`window.ms`).
 *
 * WHY THIS EXISTS. `milsymbol.min.js` is 855 kB and used to be an eager
 * `<script>` in `index.html`, 14,6% of the map page's eager JavaScript. Measured
 * with a Proxy on `window.ms` in a real browser: it is never read during boot,
 * not even on F5 with military symbols already on the map. The first read is the
 * first symbol drawn.
 *
 * THE RACE THIS CLOSES, and why the loader alone is not enough. `window.ms` is
 * not only read by a user gesture: `layers/layer_setup.js` regenerates symbol
 * PNGs when a remote atlas snapshot arrives, with nobody touching anything. If
 * the script were simply removed from `index.html`, that path would find `ms`
 * undefined. So the await belongs at the top of `generateSymbol`, the single
 * chokepoint every caller passes through — not at each call site, which is the
 * version that forgets one.
 *
 * A MECANICA MUDOU DE CASA em 2026-08-25, e o comportamento nao: memo da
 * PROMESSA (e nao da tag), `onload` que nao e prova de que o global existe, memo
 * limpo na falha e `src` derivado do `BASE_URL` vivem em
 * `utilities/vendor-loader.js`, com o porque de cada decisao. Este era o
 * primeiro dos tres carregadores identicos da casa; o terceiro (o do Turf) foi
 * o momento de parar de copiar. `tests/unit/milsymbol-loader.test.js` continua
 * sendo o contrato, e foi ele que provou a extracao.
 *
 * @module military_tools/military_symbol_tool/milsymbol-loader
 */

import { criarCarregadorDeVendor } from '@utils/vendor-loader.js';

const carregador = criarCarregadorDeVendor({
    caminho: 'vendors/milsymbol.min.js',
    nome: 'ms',
    pronto: () => (typeof globalThis.ms !== 'undefined' ? globalThis.ms : null),
});

/**
 * Ensures `window.ms` is available, loading the vendor bundle on first use.
 *
 * Safe to call on every symbol generation: after the first resolve it is a
 * property read.
 *
 * @returns {Promise<Object>} the milsymbol global
 * @throws {Error} when the bundle cannot be loaded, or loads without defining `ms`
 */
export function ensureMilsymbol() {
    return carregador.ensure();
}

/**
 * Test seam: forgets the memoized load.
 * @returns {void}
 */
export function resetMilsymbolLoader() {
    carregador.reset();
}

// Path: js/utilities/painel-de-ponto/painel-de-ponto-phrases.js

/**
 * @fileoverview The sentences of the SHELL that the point panels share (light and weather): the
 * day controls, the close and save buttons, and where day D came from.
 *
 * A leaf with ZERO imports. The name ends in `-phrases.js` on purpose: that puts every literal here
 * under `tests/unit/avisos-de-tela-estilo.test.js`. What a panel says about its own subject lives in
 * that panel's phrase leaf.
 */

/** Where day D came from; the header says which one it is. */
export const ORIGEM_DO_DIA_D = Object.freeze({
    painel: 'D escolhido no painel',
    hoje: 'D = hoje',
});

/** Controls. */
export const ROTULO_DIA_ANTERIOR = 'Dia anterior';
export const ROTULO_DIA_SEGUINTE = 'Dia seguinte';
export const ROTULO_DATA_D = 'Dia D';
export const ROTULO_SALVAR = 'Salvar tabela';
export const ROTULO_FECHAR = 'Fechar';

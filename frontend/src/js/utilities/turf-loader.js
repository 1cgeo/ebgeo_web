// Path: js/utilities/turf-loader.js

/**
 * @fileoverview Carregador sob demanda do global do Turf (`window.turf`).
 *
 * POR QUE ELE EXISTE. `turf.min.js` sao 619 kB e era uma tag `<script>` ansiosa
 * em `index.html`. MEDIDO no pacote de producao em 2026-08-25: a pagina do mapa
 * baixava 3749 kB de script no boot (fora o `prefetch` do Cesium), e o Turf era
 * o maior item depois do MapLibre. O MapLibre nao sai, porque o mapa E a pagina.
 * O Turf sai, porque nada no boot le uma unica funcao dele quando o mapa esta
 * vazio.
 *
 * O TURF E GLOBAL PURO: nao ha `import '@turf/...'` em lugar nenhum da arvore,
 * ele nao esta no `package.json`, e os 257 sitios de chamada em 35 arquivos
 * escrevem `turf.x(...)` ou `window.turf.x(...)` direto. Nao ha, portanto, um
 * unico ponto de entrada natural: e o oposto do milsymbol, que tinha
 * `generateSymbol` como funil.
 *
 * A CARGA E ESTRITAMENTE SOB DEMANDA, e a escolha e sobre o MODO DE FALHA, nao
 * sobre bytes. Se este modulo comecasse a baixar o Turf no boot "em segundo
 * plano", um sitio de chamada esquecido quase sempre encontraria o Turf ja
 * pronto, e falharia so as vezes — na maquina lenta, na rede ruim, no primeiro
 * clique rapido. Falha intermitente e silenciosa custa semanas. Sem aquecimento,
 * um sitio esquecido quebra ALTO, na hora, no primeiro teste que o exercita.
 *
 * OS DOIS FUNIS QUE COBREM A MAIORIA DOS SITIOS, e por que sao dois:
 *
 *   1. `tool_manager/tool-registry.js:ensureControl` — TODO gesto que ativa uma
 *      ferramenta passa por ele (barra, grupo da barra, atalho de teclado), e ele
 *      e memoizado. Uma linha ali cobre as dezesseis ferramentas tardias E as
 *      seis ansiosas, que continuam no payload do boot por causa do
 *      `applyZoomCorrections` sincrono de `layers/styles/*.js`.
 *   2. `tool_manager/selection_manager.js:getCompleteFeatureFromSource` — toda
 *      SELECAO passa por ele, local ou remota, e a selecao e o que dispara
 *      `createSelectionBox` (que le `turf.bbox`) em vinte e quatro controles.
 *
 * O que sobra fora dos dois funis esta listado no relatorio da onda, e cada um
 * ganhou o seu proprio `await ensureTurf()` no ponto de entrada.
 *
 * A MECANICA (memo da promessa, `onload` que nao e prova, memo limpo na falha,
 * `src` derivado do `BASE_URL`) vive em `utilities/vendor-loader.js`, com o
 * porque de cada uma. Este arquivo so diz QUAL vendor e POR QUE ele saiu do boot.
 *
 * @module utilities/turf-loader
 */

import { criarCarregadorDeVendor } from './vendor-loader.js';

const carregador = criarCarregadorDeVendor({
    caminho: 'vendors/turf.min.js',
    nome: 'turf',
    pronto: () => (typeof globalThis.turf !== 'undefined' ? globalThis.turf : null),
});

/**
 * Garante que `window.turf` existe, baixando o pacote no primeiro uso.
 *
 * Barato de chamar em todo gesto: depois do primeiro resolve e uma leitura de
 * propriedade dentro de uma promessa ja resolvida.
 *
 * @returns {Promise<Object>} o global do Turf
 * @throws {Error} quando o pacote nao carrega, ou carrega sem definir `turf`
 */
export function ensureTurf() {
    return carregador.ensure();
}

/**
 * Costura de teste: esquece a carga memoizada.
 * @returns {void}
 */
export function resetTurfLoader() {
    carregador.reset();
}

// Path: js/vendor/milsymbol.js

/**
 * @module vendor/milsymbol
 * @description Ponto único de carga do milsymbol (3.0.4), vindo do npm.
 *
 * Até 2026-09-14 o milsymbol era `frontend/public/vendors/milsymbol.min.js`, um bundle servido de
 * `public/` e injetado como tag `<script>` em runtime por
 * `military_tools/military_symbol_tool/milsymbol-loader.js`. Aquele arquivo era a **3.0.3**
 * (resolvido por hash; o banner do jsDelivr dizia 3.0.3 e o `getVersion()` interno dizia 3.0.2,
 * divergência do próprio upstream, registrada na wiki do inventário). A forma deste arquivo é a
 * mesma do MapLibre, do Three e do Turf: um módulo de `src/js/vendor/` é o único lugar do
 * repositório que nomeia o especificador do pacote.
 *
 * Quatro cuidados, cada um medido nesta árvore:
 *
 * 1. **A CARGA CONTINUA SOB DEMANDA.** O milsymbol saiu do boot do mapa por medição (855 kB,
 *    14,6% do JavaScript inicial daquela página, com um Proxy sobre `window.ms` provando que nada
 *    o lê durante o boot). A migração troca o TRANSPORTE, de tag `<script>` para `import()` do
 *    bundler, e não o momento: este módulo é alcançado apenas pelo `import()` do carregador, e um
 *    import estático dele devolveria os 855 kB ao payload do boot.
 *
 * 2. **`default`, e não namespace: aqui ele é o oposto do MapLibre e do Three.** O pacote tem
 *    `exports["."].import` apontando `index.js`, que monta o objeto `ms` (é ele que registra os
 *    seis conjuntos de ícones, de APP6-B a 2525E) e o exporta como `default`. O namespace do
 *    módulo tem exatamente UMA chave, `default` (medido). Quem escrever `import * as ms` recebe o
 *    invólucro e `new ms.Symbol(...)` morre com "is not a constructor", que foi o primeiro erro
 *    desta migração.
 *
 * 3. **O global `ms` é a interface, e ele fica.** O único leitor é `generateSymbol`
 *    (`military_symbol_tool/military_symbol_generator.js`), que é o funil por onde todo chamador
 *    passa, gesto de usuário ou regeneração de PNG na chegada de um snapshot remoto.
 *
 * 4. **A escrita do global é guardada por `typeof window`,** como nos irmãos: a suíte roda em
 *    `environment: 'node'`, onde não existe `window`.
 *
 * O QUE MUDOU DA 3.0.3 PARA A 3.0.4, medido contra o bundle que saiu:
 *
 *   - **os 43 membros do objeto são os MESMOS**, nenhum a mais e nenhum a menos;
 *   - `getVersion()` passou a dizer a verdade (3.0.4 contra os 3.0.2 que a 3.0.3 reportava);
 *   - o SVG é **byte a byte idêntico** para símbolo sem rótulo, inclusive com seta de direção;
 *   - **com QUALQUER rótulo de texto a caixa delimitadora encolheu** (medido com
 *     `uniqueDesignation`: 129,50 -> 104,77 de largura, 19% mais estreita; o mesmo com
 *     `additionalInformation` e `higherFormation`). A âncora do octógono NÃO se move, então o
 *     símbolo continua no mesmo ponto do mapa; o que mudou é a estimativa de largura do texto.
 *     Isso alcança o produto porque `generateSymbol` deriva o tamanho do PNG do fator de
 *     crescimento entre a viewBox com e sem texto: o PNG de um símbolo rotulado passa a ser mais
 *     justo. Como a viewBox e a caixa vêm as duas do milsymbol, elas continuam consistentes entre
 *     si, e o texto não é cortado.
 */

import ms from 'milsymbol';

// Global de compatibilidade: é por ele que `generateSymbol` alcança a biblioteca (nota 3).
if (typeof window !== 'undefined') window.ms = ms;

export default ms;
export { ms };

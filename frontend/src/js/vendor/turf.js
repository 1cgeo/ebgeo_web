// Path: js/vendor/turf.js

/**
 * @module vendor/turf
 * @description Ponto único de carga do Turf.js (7.4.0), vindo do npm.
 *
 * Até 2026-09-14 o Turf era `frontend/public/vendors/turf.min.js`, um bundle UMD servido de
 * `public/` e injetado como tag `<script>` em runtime por `utilities/turf-loader.js`. Ele não
 * declarava versão em lugar nenhum: foi resolvido POR HASH contra as versões publicadas e é a
 * **7.0.0** (`sha256Lf 2c69ba91...`, conferido nesta árvore antes da troca). A forma deste arquivo
 * é a mesma que o MapLibre ganhou em 2026-09-04 (`src/js/map/maplibre.js`) e o Three.js em
 * 2026-09-14 (`src/js/vendor/three.js`), que são os dois modelos.
 *
 * Cinco cuidados, cada um medido nesta árvore e não suposto:
 *
 * 1. **A CARGA CONTINUA SOB DEMANDA, e essa é a decisão que a troca NÃO desfaz.** O
 *    `@fileoverview` de `utilities/turf-loader.js` registra por que o Turf saiu do boot em
 *    2026-08-25 (619 kB, o maior item depois do MapLibre no payload ansioso do mapa) e por que não
 *    há aquecimento em segundo plano: sem ele, um sítio de chamada esquecido quebra ALTO no
 *    primeiro teste que o exercita, em vez de falhar só na máquina lenta. O que mudou é o
 *    TRANSPORTE, de tag `<script>` para `import()` do bundler; quem espera continua sendo
 *    `ensureTurf()`. Por isso este módulo é alcançado APENAS por aquele `import()` dinâmico, e
 *    nunca por import estático do entry do mapa: um import estático aqui devolveria os 531 kB ao
 *    boot e desfaria a onda inteira, sem que o produto parecesse diferente.
 *
 * 2. **O global é a interface, e ele não vai embora.** São 352 sítios de chamada em 48 arquivos de
 *    `src/js/` (medido em 2026-09-14; o cabeçalho do carregador dizia 257 em 35, de uma medição
 *    anterior), todos escrevendo `turf.x(...)` ou `window.turf.x(...)` direto. Reescrevê-los para
 *    import nomeado é outra decisão, de outro tamanho, e não é esta: aqui a troca é de ONDE a
 *    biblioteca vem, e a superfície que os 352 sítios leem fica byte a byte a mesma.
 *
 * 3. **O pacote INTEIRO, e não os 31 submódulos usados: a escolha tem número dos dois lados.**
 *    Medido com esbuild sobre esta árvore, minificado: o pacote inteiro dá 531 kB (143 kB gzip) e
 *    só as 31 funções que os 352 sítios chamam dariam 396 kB (103 kB gzip), 135 kB a menos. Ainda
 *    assim o inteiro ganha, por DUAS razões e não uma. A primeira é que a lista de 31 nomes
 *    escrita à mão é exatamente a lista fechada que a constituição proíbe, e ela falha ABERTO da
 *    pior forma: um sítio novo que chame uma função de fora da lista não acusa no lint nem no
 *    build, só em runtime, e só quando alguém ativar aquela ferramenta. A segunda é que a troca já
 *    emagrece sem isso: o UMD de 7.0.0 que sai tinha 634 kB (163 kB gzip), então o pacote inteiro
 *    de 7.4.0 entra 103 kB (20 kB gzip) MENOR que o arquivo que substitui. Os 135 kB do recorte
 *    ficam escritos aqui para que a próxima decisão tenha o número sem remedir, e ela só se toma
 *    junto com um censo estrutural que derive a lista da árvore.
 *
 * 4. **Namespace, nunca default.** O pacote exporta 184 nomes e nenhum `default` (medido:
 *    `'default' in m === false`), como o MapLibre 6.x e o Three. Daí `export *`, e daí o global ser
 *    montado a partir do namespace do próprio módulo.
 *
 * 5. **A escrita do global é guardada por `typeof window`.** A suíte roda em `environment: 'node'`
 *    (`vitest.config.js`), onde não existe `window`. É a mesma guarda de `map/maplibre.js`, e pela
 *    mesma razão: sem ela, todo teste que alcançasse este módulo morreria num `ReferenceError`
 *    antes do primeiro caso, o que é falha de ambiente com cara de falha de código.
 *
 * O QUE MUDOU DE 7.0.0 PARA 7.4.0, medido função a função contra o bundle que saiu (26 funções
 * comparadas sobre entradas reais, as três diferenças abaixo e mais nada):
 *
 *   - `nearestPointOnLine` devolve um SUPERCONJUNTO de propriedades. As três que o produto lê
 *     (`index`, `location`, `dist`) continuam lá, com a mesma semântica; ao lado delas nasceram
 *     sete (`lineStringIndex`, `segmentIndex`, `totalDistance`, `lineDistance`, `segmentDistance`,
 *     `pointDistance`, `multiFeatureIndex`). Os valores andaram 0,02% (17577,0 m -> 17580,5 m numa
 *     linha de 17,5 km), que é a passada geodésica ficando mais precisa.
 *   - `pointToLineDistance` anda na mesma ordem (1511,9 m -> 1508,7 m, 0,2%). O único sítio é a
 *     largura do corpo da seta durante o arrasto.
 *   - `ellipse` desenha a MESMA elipse começando por outro vértice e com o sentido invertido
 *     (antihorário -> horário). Mesma contagem de vértices (65), mesma bbox até o quinto decimal
 *     (~2 m), área 0,08% diferente. O único sítio devolve a geometria para um preenchimento, que
 *     não lê sentido nem índice de vértice.
 *
 * Nenhuma das 31 funções usadas sumiu. Saiu do pacote um nome só, `GeojsonEquality`, que este
 * repositório nunca citou; entraram quatro (`azimuthToBearing`, `directionalMean`,
 * `pointToPolygonDistance`, `removeBbox`). As duas mudanças de aridade (`lineOffset` 3 -> 2,
 * `lineSliceAlong` 4 -> 3) são opções que ganharam valor padrão: os onze sítios do produto passam
 * `{ units: 'meters' }` explicitamente e não dependem do padrão.
 */

import * as turf from '@turf/turf';

// Global de compatibilidade: é por ele que os 352 sítios de chamada alcançam a biblioteca (nota 2).
if (typeof window !== 'undefined') window.turf = turf;

export default turf;
export { turf };
export * from '@turf/turf';

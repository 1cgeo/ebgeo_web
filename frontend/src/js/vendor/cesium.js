// Path: js/vendor/cesium.js

/**
 * @module vendor/cesium
 * @description Ponto único de carga do CesiumJS (1.145.0), vindo do npm.
 *
 * Até 2026-09-14 o Cesium era uma cópia versionada de 14 MB em `frontend/public/vendors/cesium/`,
 * na 1.138.0, carregada por uma tag `<script>` que `map_3d.js` injetava em runtime
 * (`loadScript('./vendors/cesium/Cesium.js')` mais uma espera pelo global). O custo era o mesmo
 * das outras cópias podadas neste plano: 391 arquivos que nenhum `npm audit` alcança, sem canal a
 * que perguntar por aviso, e um `<script>` que o grafo do bundler não enxerga, de modo que nenhuma
 * das guardas de peso deste repositório media aqueles bytes. A forma é a mesma que o MapLibre
 * ganhou em 2026-09-04 (`frontend/src/js/map/maplibre.js`) e o Three.js em 2026-09-14
 * (`frontend/src/js/vendor/three.js`).
 *
 * Cinco cuidados, cada um com a razão medida nesta árvore:
 *
 * 1. **O NAMESPACE DO MÓDULO NÃO É EXTENSÍVEL, e escrever nele falha CALADO.** Medido:
 *    `Object.isExtensible(await import('cesium')) === false`, 1352 exportações, nenhuma `default`.
 *    Eram TRÊS os consumidores que precisavam escrever no objeto que chamam de `Cesium`; desde
 *    2026-09-15 (decisão D15) sobrou **um**, e ele basta para a cópia continuar existindo:
 *    `map_3d.js` substitui `Cesium.RequestScheduler.request` para bloquear o Ion. Os outros dois
 *    eram do viewshed de terceiro, que foi apagado: o polyfill de `Cesium.defaultValue` (removido
 *    do Cesium na 1.134 e exigido por um plugin construído para a ~1.100) e o próprio plugin
 *    pendurando `ViewShed3D` e `RectangularSensorPrimitive` ali. Por isso o que se publica e se
 *    exporta daqui continua sendo uma CÓPIA rasa e extensível do namespace: as 1352 exportações
 *    são classes e constantes que o pacote nunca reatribui, então a cópia guarda as mesmas
 *    referências e remendar um protótipo através dela continua remendando a classe real.
 *
 * 2. **O global continua, e é contrato com DOIS públicos.** Eram três até 2026-09-15: o primeiro
 *    era `cesium-viewshed.js`, UMD cujo ramo de navegador era literalmente
 *    `self['space'] = factory(self['Cesium'])`, isto é, ele LIA o global e só existia depois dele.
 *    Aquele arquivo foi apagado (D15) e o motor do viewshed virou um módulo como outro qualquer.
 *    Os dois que ficam: nove módulos de `src/js/` que
 *    alcançam a biblioteca pelo identificador solto `Cesium` (as quatro ferramentas 3D,
 *    `cesium-measure.js`, `cesium-color.js`) ou por `window.Cesium` explícito
 *    (`briefing/presentation/transition.service.js`, `briefing/editor/briefing-editor.control.js`,
 *    `deep-link/deep-link.js`), e estes três últimos moram no grafo ANSIOSO da página do mapa:
 *    fazê-los importar este arquivo arrastaria 4 MB de motor para o payload de boot. Eles leem o
 *    global dentro de funções, depois de o visualizador 3D estar aberto, que é exatamente quando
 *    este módulo já avaliou. E os specs de Playwright, que rodam `page.evaluate` dentro da página
 *    e não têm grafo de import próprio. A ordem não mudou em relação ao
 *    `<script>`: antes o global aparecia quando a tag carregava, hoje aparece quando o chunk
 *    `cesium-integration` carrega, e nos dois casos isso é antes de `initCesiumMap`.
 *
 * 3. **A base dos ativos estáticos é posta ANTES, pelo import da linha seguinte.** Ver o cabeçalho
 *    de `frontend/src/js/vendor/cesium-base-url.js`: o `import` é içado, então a única forma de
 *    escrever `window.CESIUM_BASE_URL` antes de o grafo do Cesium avaliar é um módulo importado
 *    primeiro. Não reordene as duas primeiras linhas deste arquivo.
 *
 * 4. **A folha de estilo dos widgets entra por aqui, e não mais por `<link>` no `index.html`.**
 *    Ela é a única parte do `Widgets/` que a página precisa ter antes de desenhar, e importá-la
 *    daqui a faz viajar com o chunk lazy: quem nunca abre o visualizador 3D não a baixa. Medido:
 *    `cesium/Build/Cesium/Widgets/widgets.css` tem 30 kB e UM `url()`, já em `data:`, então o
 *    bundler não precisa reescrever referência nenhuma. O resto de `Widgets/` continua sendo
 *    servido por URL, porque o `InfoBox` injeta a folha dele dentro do próprio iframe.
 *
 * 5. **A escrita do global é guardada por `typeof window`.** A suíte roda em `environment: 'node'`
 *    (`vitest.config.js`). É a mesma guarda, pela mesma razão, do ponto único do MapLibre.
 *
 * 6. **`__esModule: true` PERDEU O BENEFICIÁRIO EM 2026-09-15, E FICA, com a razão trocada.** Ele
 *    foi posto aqui porque um namespace de módulo ES não carrega essa marca e a distribuição
 *    oficial sempre carregou (é o helper `__toCommonJS` do esbuild, no fim do bundle). Sem ela, o
 *    interop de webpack DENTRO de `cesium-viewshed.js` lia todo símbolo do Cesium como `undefined`
 *    sem lançar em nenhum, o plugin não definia `ViewShed3D`, e a análise de visibilidade deixava
 *    de existir sem uma linha de erro em lugar nenhum. Foi o único defeito que a migração ao npm
 *    produziu, e quem o achou foi uma captura de tela, não a suíte.
 *
 *    A decisão D15 apagou aquele arquivo, então hoje **nenhum consumidor deste repositório lê a
 *    marca**. Ela continua porque o objeto publicado aqui é o que o produto inteiro chama de
 *    `Cesium`, inclusive em `page.evaluate` de spec e em console de depuração, e porque a
 *    distribuição oficial a publica: tirá-la faria esta cópia divergir do que um
 *    `<script>` de Cesium sempre entregou, para ganhar zero byte. Se alguém a remover um dia, o
 *    que precisa acompanhar é esta nota, não um teste: não há teste, porque não há mais leitor.
 */

import './cesium-base-url.js';
import * as CesiumNS from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

/**
 * A cópia extensível do namespace (nota 1 acima). Tudo o que o produto chama de `Cesium` é ESTE
 * objeto: o global, o valor exportado daqui e o argumento que `cesium-compat.js` remenda.
 *
 * `__esModule` é a única propriedade sintética. A nota 6 conta por que ela entrou, e por que ela
 * deixou de ter leitor quando o viewshed de terceiro saiu.
 */
const Cesium = { ...CesiumNS, __esModule: true };

if (typeof window !== 'undefined') window.Cesium = Cesium;

export default Cesium;
export { Cesium };

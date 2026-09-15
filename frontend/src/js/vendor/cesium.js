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
 *    Três consumidores PRECISAM escrever no objeto que chamam de `Cesium`, e os três são
 *    obrigatórios para o visualizador 3D: `polyfillDefaultValue` repõe `Cesium.defaultValue`
 *    (removido na 1.134, exigido pelo `cesium-viewshed` que foi construído para a ~1.100),
 *    `map_3d.js` substitui `Cesium.RequestScheduler.request` para bloquear o Ion, e o próprio
 *    `cesium-viewshed.js` pendura `ViewShed3D` e `RectangularSensorPrimitive` ali. O que torna
 *    isso perigoso é o MODO da falha, e ele é diferente dos dois lados: de dentro de um módulo ES
 *    (código estrito) a escrita LANÇA, mas `cesium-viewshed.js` é `<script>` clássico, portanto
 *    não estrito, e ali a escrita é um NO-OP SILENCIOSO. O resultado seria `Cesium.ViewShed3D`
 *    `undefined`, a ferramenta de viewshed morta e nenhum erro em lugar nenhum. Por isso o que se
 *    publica e se exporta daqui é uma CÓPIA rasa e extensível do namespace: as 1352 exportações
 *    são classes e constantes que o pacote nunca reatribui, então a cópia guarda as mesmas
 *    referências e remendar um protótipo através dela continua remendando a classe real.
 *
 * 2. **O global continua, e é contrato com três públicos.** O primeiro é `cesium-viewshed.js`,
 *    que é UMD e cujo ramo de navegador é literalmente `self['space'] = factory(self['Cesium'])`:
 *    ele LÊ o global e só existe depois dele. O segundo são nove módulos de `src/js/` que
 *    alcançam a biblioteca pelo identificador solto `Cesium` (as quatro ferramentas 3D,
 *    `cesium-measure.js`, `cesium-color.js`) ou por `window.Cesium` explícito
 *    (`briefing/presentation/transition.service.js`, `briefing/editor/briefing-editor.control.js`,
 *    `deep-link/deep-link.js`), e estes três últimos moram no grafo ANSIOSO da página do mapa:
 *    fazê-los importar este arquivo arrastaria 4 MB de motor para o payload de boot. Eles leem o
 *    global dentro de funções, depois de o visualizador 3D estar aberto, que é exatamente quando
 *    este módulo já avaliou. O terceiro são os specs de Playwright, que rodam `page.evaluate`
 *    dentro da página e não têm grafo de import próprio. A ordem não mudou em relação ao
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
 * 6. **`__esModule: true` NÃO É ADORNO: sem ele o viewshed nasce morto, e em silêncio.** Foi o
 *    único defeito que esta migração produziu, e ele foi achado pela captura do Playwright, não
 *    pela suíte. `cesium-viewshed.js` é um bundle de webpack cujo `Cesium` é um EXTERNAL, e o
 *    interop de webpack para um external que não se declara módulo ES constrói um namespace
 *    sintético em volta do valor e expõe nele apenas `default`. O efeito é que TODA leitura de
 *    símbolo (`Cesium.Matrix3`, `Cesium.ShaderSource`, as vinte e tantas do cabeçalho do plugin)
 *    devolve `undefined` sem lançar, e o primeiro `new` sobre um deles explode com uma mensagem
 *    que nomeia uma variável ofuscada (medido: `TypeError: _0x2866d1 is not a constructor`, em
 *    `cesium-viewshed.js:1177`, onde `_0x2866d1` é `Cesium.Matrix3`). Daí para baixo tudo é mudo:
 *    o plugin não define `Cesium.ViewShed3D`, `applyCesiumPostLoadPatches` pula a classe ausente
 *    pelo `if (!CesiumNS[className]) continue`, e `viewshed_tool_3d.js` desiste no próprio guarda
 *    `!Cesium.ViewShed3D`. O visualizador 3D continua abrindo e desenhando o modelo; só a análise
 *    de visibilidade deixa de existir, sem um aviso em lugar nenhum.
 *
 *    A distribuição oficial SEMPRE publicou essa marca, e é por isso que o `<script>` funcionava:
 *    `node_modules/cesium/Build/Cesium/Cesium.js` termina no helper `__toCommonJS` do esbuild, que
 *    põe `__esModule: true` no objeto exportado (medido no bundle, e medido no navegador: o global
 *    da distribuição responde `__esModule === true`, o do namespace do npm responde `undefined`).
 *    Um namespace de módulo ES não a carrega porque não precisa: quem consome por `import` sabe o
 *    que ele é. Quem consome pelo global, não.
 *
 *    A PROVA É UM A/B, não o raciocínio acima: com a linha, o viewshed calcula e desenha; sem ela,
 *    o mesmo spec falha no mesmo ponto. E o controle NEGATIVO dessa medição foi rodar o caminho
 *    antigo (`<script>` da distribuição) no mesmo spec e ver o viewshed funcionar, que é o que
 *    separou "regressão desta migração" de "defeito que já existia".
 */

import './cesium-base-url.js';
import * as CesiumNS from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

/**
 * A cópia extensível do namespace (nota 1 acima). Tudo o que o produto chama de `Cesium` é ESTE
 * objeto: o global, o valor exportado daqui e o argumento que `cesium-compat.js` remenda.
 *
 * `__esModule` é a única propriedade sintética, e a nota 6 é o que ela vale: sem ela o
 * `cesium-viewshed.js` nasce morto, em silêncio. Não a remova por parecer resto de bundler.
 */
const Cesium = { ...CesiumNS, __esModule: true };

if (typeof window !== 'undefined') window.Cesium = Cesium;

export default Cesium;
export { Cesium };

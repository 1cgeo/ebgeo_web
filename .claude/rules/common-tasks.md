# Common Tasks

O que sobra aqui é o passo que **não se descobre lendo o código vizinho**: o registro esquecido, o contador que precisa ser incrementado junto, o efeito colateral que não tem erro quando falta. Receita cujo próximo passo é óbvio a partir do anterior saiu.

## Adding a New Draw Tool

Use a skill `new-tool`. Esta seção já teve uma cópia resumida do procedimento e a cópia era **pior**: mandava "registrar em `map_sig.js`" quando são QUATRO sítios de edição lá dentro, dois deles literais `controls:` gêmeos que nada prende um ao outro, e um `registerControl()` sozinho não faz o botão da toolbar funcionar. A lista dos quatro está na skill, e só lá de propósito: duas versões da mesma receita divergem com o tempo, e a incompleta é a que causa o bug. (Esta linha disse "três registries" pelo tempo em que os dois gêmeos foram contados como um.)

## Adding a Processing Algorithm

1. Criar `src/js/processing/algorithms/<name>.algorithm.js`.
2. Campos da definição: `id`, `name`, `description`, `icon`, `category`,
   `supportedGeometryTypes` (array), `createPanel(deps)`, `execute(features, params)`.
   Typedef completo em `frontend/src/js/processing/algorithms/algorithm.interface.js`, exemplo em
   `frontend/src/js/processing/algorithms/buffer.algorithm.js`.
   **Nenhum deles é imposto, salvo o `id`, e um não é lido por ninguém.**
   `registerAlgorithm` (`frontend/src/js/processing/processing.constants.js`) valida
   presença e unicidade do `id` e nada mais: os demais faltam em silêncio, e o sintoma
   aparece só na tela que consome o campo (o cartão da aba lê `name`, `description` e
   `icon`; o executor lê `supportedGeometryTypes` e `execute`; o painel lê `createPanel`).
   `category` é o que não tem leitor: nada em `frontend/src/js/processing/` o lê. Preencha
   por convenção, e não gaste tempo procurando o agrupamento que ele deveria dirigir.
3. Chamar `registerAlgorithm({...})` no load do módulo **e** adicionar o import de
   efeito colateral `import './<name>.algorithm.js';` em `frontend/src/js/processing/algorithms/index.js`.
   Sem o segundo passo o módulo nunca é carregado e o registro nunca roda: não há
   erro, o algoritmo apenas não aparece.
4. Nada mais muda em lugar nenhum.

## Adding a Schema Migration

1. Criar `store/migration/v<from>-to-v<to>.migration.js`. Repare no nome real da
   função exportada: `migrateToV2_1`, `migrateToV2_2`, com **underscore**, não
   `migrateToV21`. Migrações existentes: `v1-to-v2`, `v2-to-v2.1`, `v2.1-to-v2.2`,
   `v2.2-to-v2.3` (esta última é a que criou o registro de atlas locais e adotou os
   bancos sem sufixo como slot #1; ver §Atlas, namespace e tab-lock em
   [`architecture.md`](architecture.md)).
2. Em `migration.service.js`, importar e adicionar a chamada condicional dentro de
   `safelyMigrate()`. O encadeamento é por número de versão, não por registry.
3. **A migração recebe o ESCOPO como argumento**, e ignorar isso re-ancora o degrau
   nos nomes de banco pré-namespace, que podem não ser os do atlas montado. São dois
   alvos e dois trabalhos diferentes: `safelyMigrate(scope)` com o default
   `legacyScope()` é o upgrade da INSTALAÇÃO, e `migrateActiveSlot()` é o upgrade de
   UM SLOT namespaced. Ele sai cedo, com `reason` nomeado, antes mesmo de perguntar ao
   detector, em quatro casos e não três: sem escopo ativo (`'no-scope'`), escopo remoto
   (`'remote'`), escopo legado (`'pre-namespace'`) e slot virgem (`'empty'`). Os quatro
   degraus antigos já recebem o escopo; um novo que abra `localforage.createInstance`
   por nome fixo migra o banco errado em silêncio, e é isso que
   `frontend/tests/unit/repository-namespace.test.js` reprova. O guarda está FECHADO:
   `atlas-namespace.js` é o único chamador autorizado, a allowlist que abria exceção para
   estas quatro migrações saiu quando elas passaram a receber o escopo, e a varredura cobre
   `src/js` inteiro, não só o store. Exceção nova se escreve lá, com o motivo, na hora.
4. **Subir `ATLAS_SCHEMA_VERSION` (`frontend/src/js/store/atlas/atlas.entity.js`)**, hoje
   `'2.3'`. Este é o passo que falta com mais facilidade e falha em silêncio:
   `detectMigrationNeeded()` compara a versão do repositório com essa constante e devolve
   `needed: false` se ela não subiu, então `safelyMigrate()` nunca é chamado. A
   migração nova simplesmente não roda, sem erro. (Esta linha chamou a função de
   `needsMigration` até 2026-07-25; esse nome nunca existiu no código, e procurá-lo
   por grep não devolve nada, o que faz parecer que o guarda não existe. E citou os dois
   trechos por `arquivo:linha` até 2026-08-15, quando o segundo já apontava para outra
   função: é a razão de a convenção pedir SÍMBOLO, que tem guarda, e não número de linha,
   que não tem.)
5. Roda sozinha no próximo startup, pelos dois caminhos de `initializeRepository`.

## PDF Export

**São DUAS saídas de PDF, por DOIS motores, no mesmo painel**, e essa é a coisa que a aba
não anuncia. `isMosaic` (`rows * cols > 1`) decide qual roda:

- **Folha única: GDAL.** O mapa vira PNG e `gdal_translate` o converte com `-a_ullr` e
  `-a_srs`, então a saída é PDF **georreferenciado**. GDAL é pré-inicializado ao abrir a
  aba, não no primeiro uso.
- **Mosaico R×C: jsPDF, sem GDAL nenhum.** `pdf-export.tab.js` faz `import()` dinâmico de
  `frontend/src/js/import_export/pdf-mosaic-export.js`, que monta folhas A4 full-bleed a
  partir de um único mapa oculto reusado por tile, todas no MESMO zoom e com os centros
  espaçados pela extensão Mercator exata de uma página (é o que faz a costura ser contínua).
  O documento sai como capa, visão geral e um par (mapa, verso) por tile, nessa ordem,
  para que cada par caia numa folha física duplex. A saída **não** é georreferenciada:
  jsPDF não faz GeoPDF.

Duas armadilhas do mosaico que não se deduzem lendo o vizinho: a sobreposição de costura
(`MOSAIC_OVERLAP_MM`) é DERIVADA, não escolhida, do dobro da soma entre a margem não
imprimível assumida e a folga de corte, e o valor anterior usava o orçamento errado e
deixava uma tira branca em toda costura; e a grade impressa no verso já sai ESPELHADA
(`mirrorAssemblyPosition`), porque o operador monta as folhas de face para baixo e vira o
bloco colado no fim.

Os arquivos: `pdf-export.tab.js` (painel, modal de progresso, caminho GDAL),
`pdf-cartographic-elements.js` (grades, legenda, escala, rosa dos ventos, e o
`composeLayout` que assa as margens na tela), `pdf-export.constants.js` (o que os dois
motores compartilham), e o trio do mosaico: `pdf-mosaic-export.js` (orquestração),
`pdf-mosaic-geometry.js` (matemática pura, node-testável) e `pdf-mosaic-pages.js`
(desenho vetorial de capa, visão geral e verso).

DPI 150/200/300; elementos cartográficos escalam por `uiScale = dpi / 200`.

## Street View 360 Navigation

**A projeção não usa distância nem altura.** O marcador recebe do mundo só uma direção:
o alvo é projetado no HORIZONTE da câmera pelo azimute, e a altura acima da linha vem da
posição na fila daquela direção (`elevationDeg(rank)`), não da geometria. A distância só
decide a ORDEM ao longo da direção. Altura de câmera, terreno e `distance_scale` não estão
apenas sem uso, foram removidos do cliente. O `fileoverview` de `projectOnHorizon` é onde
isso está dito por extenso.

Consequência prática: `override_height` e `override_distance` sobrevivem como colunas do
backend (`sv360`), chegam ao cliente no payload de alvos e não têm leitor nenhum nele.
Procurar por elas para ajustar o alinhamento é perseguir um botão que não está mais ligado
em nada. **O terceiro override tem leitor, e ele não faz o que o nome sugere:**
`frontend/src/js/calibration/minimap.js` lê `override_bearing` para pintar o alvo com raio
e cor próprios no minimapa do operador. É realce de tela, não entrada da projeção (o
azimute servido é derivado da geometria por `ST_Azimuth`). O que corrige alinhamento é a
rotação de malha da calibração, que nivela a esfera antes de qualquer desenho.

**O acoplamento que importa agora é interno, e é de PASTA, não de arquivo.**
`frontend/src/js/calibration/` carrega uma cópia da navegação de
`frontend/src/js/street_view_tool/navigation/`, e são CINCO pares, não um projetor:
`projector.js`, `renderer.js`, `constants.js`, `navigator.js` e `hit-tester.js`, com as
mesmas classes (`StreetViewProjector`, `StreetViewRenderer`, `StreetViewHitTester`) e as
mesmas funções exportadas (`pontosDaSeta`, `rotuloDeAndar`, `drawArmillarySphere`,
`rankOpacity`). São da ordem de duas mil linhas de cada lado, e esta seção já disse "dois
projetores", mandando conferir à mão um quinto da superfície que pode divergir.

A duplicação é deliberada: a calibração não pode arrastar a store nem o MapLibre do mapa.
O preço é que uma correção feita de um lado não chega ao outro, e o sintoma (o operador
calibra vendo um arranjo, o visualizador desenha outro) aparece longe da causa, com as
duas suítes verdes.

**As duas cópias JÁ divergiram, e parte da divergência é de propósito.** Só a calibração
tem `desenharDescricao`, `elevacaoDeVizinha` (com as constantes `ANDAR_PASSO_DEG` /
`ANDAR_DEGRAUS_MAX` que a alimentam), o módulo `descricao.js` e o cache de frame
`beginFrame`; só o visualizador tem `screenToSpherical` e as constantes de POI e de
etiqueta. Os dois `NAV_CONSTANTS` nem carregam o mesmo conjunto de chaves. Antes de
"sincronizar" um arquivo inteiro, saiba qual metade é decisão.

**O guarda existe e tem nome:** `frontend/tests/unit/calibracao-espelha-marcador-andar.test.js`
importa AS DUAS cópias e exige o mesmo número das duas. Ele também leva asserção
ABSOLUTA em cada bloco, porque comparar sozinho deixaria passar duas cópias erradas do
mesmo jeito. Rode-o ao tocar em qualquer um dos lados.

O que ele PRENDE (esta seção dizia "três coisas", e subdeclarar guarda custa igual a
superdeclarar: manda conferir na mão o que já está preso):

- as SEIS constantes de andar de `NAV_CONSTANTS`, com asserção de PRESENÇA antes da
  igualdade, senão `undefined === undefined` passaria verde com as duas ausentes;
- `elevacaoComAndar` sobre a grade inteira de posto por degrau, mais os degraus que não são
  número (`null`, `undefined`, `NaN`), com números de controle absolutos em graus e em
  pixels, e a folga de meio raio medida contra `angularRadiusDeg(0)`;
- `rotuloDeAndar` com o texto esperado caso a caso, dois algarismos e nível zero inclusive;
- `drawArmillarySphere` chamada por chamada, por um contexto de canvas espião comparado com
  `deepStrictEqual` em sete estados, mais o texto do destino e o recuo da seta em absoluto;
- o arranjo da fila (`layoutDirections`), com posto, raio e altura iguais dos dois lados,
  mais a asserção absoluta de que quem sobe fica acima da linha e quem desce abaixo.

O que ele NÃO alcança: `StreetViewHitTester`, `rankOpacity`, a classe `StreetViewRenderer`
e tudo em `projector.js` que não seja altura de andar. Fora do que está na lista acima, a
conferência ainda é o diff na mão, e ele tem cinco arquivos de cada lado.

(A regra anterior mandava sincronizar com `ebgeo_360/public/calibration/js/`, de outro
repositório. O estúdio foi portado para cá, então o alvo da conferência mudou de
repositório para pasta vizinha. Ver [[calibracao-e-grafo-360]] e [[streetview-360]].)

O dado do 360 vem do backend (módulo `streetview360`, schema `sv360`), não do repositório
externo.

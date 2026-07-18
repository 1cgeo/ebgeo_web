# Common Tasks

O que sobra aqui é o passo que **não se descobre lendo o código vizinho**: o registro esquecido, o contador que precisa ser incrementado junto, o efeito colateral que não tem erro quando falta. Receita cujo próximo passo é óbvio a partir do anterior saiu.

## Adding a New Draw Tool

Use a skill `new-tool`. Esta seção já teve uma cópia resumida do procedimento e a cópia era **pior**: mandava "registrar em `map_sig.js`" quando são três registries distintos, e um `registerControl()` sozinho não faz o botão da toolbar funcionar. Duas versões da mesma receita divergem com o tempo, e a incompleta é a que causa o bug.

## Adding a Processing Algorithm

1. Criar `src/js/processing/algorithms/<name>.algorithm.js`.
2. Campos obrigatórios da definição: `id`, `name`, `description`, `icon`, `category`,
   `supportedGeometryTypes` (array), `createPanel(deps)`, `execute(features, params)`.
   Typedef completo em `src/js/processing/algorithms/algorithm.interface.js`, exemplo em
   `src/js/processing/algorithms/buffer.algorithm.js`.
3. Chamar `registerAlgorithm({...})` no load do módulo **e** adicionar o import de
   efeito colateral `import './<name>.algorithm.js';` em `algorithms/index.js`.
   Sem o segundo passo o módulo nunca é carregado e o registro nunca roda: não há
   erro, o algoritmo apenas não aparece.
4. Nada mais muda em lugar nenhum.

## Adding a Schema Migration

1. Criar `store/migration/v<from>-to-v<to>.migration.js`. Repare no nome real da
   função exportada: `migrateToV2_1`, `migrateToV2_2`, com **underscore**, não
   `migrateToV21`. Migrações existentes: `v1-to-v2`, `v2-to-v2.1`, `v2.1-to-v2.2`.
2. Em `migration.service.js`, importar e adicionar a chamada condicional dentro de
   `safelyMigrate()`. O encadeamento é por número de versão, não por registry.
3. **Subir `ATLAS_SCHEMA_VERSION` em `src/js/store/atlas/atlas.entity.js:12`** (hoje
   `'2.2'`). Este é o passo que falta com mais facilidade e falha em silêncio:
   `needsMigration` compara a versão do repositório com essa constante
   (`migration.service.js:51`) e **retorna cedo** se ela não subiu, então
   `safelyMigrate()` nunca é chamado. A migração nova simplesmente não roda, sem erro.
4. Roda sozinha no próximo startup.

## PDF Export

`pdf-export.tab.js` + `pdf-cartographic-elements.js`. DPI 150/200/300; elementos
cartográficos escalam por `uiScale = dpi / 200`. GDAL é pré-inicializado ao abrir a
aba, não no primeiro uso.

## Street View 360 Navigation

Modelo de projeção em solo plano em `street_view_tool/navigation/`. A elevação do GPS
**não** entra na projeção e `override_height` default 0 (solo). As funções de projeção
precisam ficar em sincronia com `ebgeo_360/public/calibration/js/`, que é **outro
repositório**: nada aqui quebra se elas divergirem, e o sintoma aparece como
desalinhamento visual no 360, longe da causa.

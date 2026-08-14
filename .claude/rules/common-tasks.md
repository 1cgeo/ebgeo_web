# Common Tasks

O que sobra aqui é o passo que **não se descobre lendo o código vizinho**: o registro esquecido, o contador que precisa ser incrementado junto, o efeito colateral que não tem erro quando falta. Receita cujo próximo passo é óbvio a partir do anterior saiu.

## Adding a New Draw Tool

Use a skill `new-tool`. Esta seção já teve uma cópia resumida do procedimento e a cópia era **pior**: mandava "registrar em `map_sig.js`" quando são três registries distintos, e um `registerControl()` sozinho não faz o botão da toolbar funcionar. Duas versões da mesma receita divergem com o tempo, e a incompleta é a que causa o bug.

## Adding a Processing Algorithm

1. Criar `src/js/processing/algorithms/<name>.algorithm.js`.
2. Campos obrigatórios da definição: `id`, `name`, `description`, `icon`, `category`,
   `supportedGeometryTypes` (array), `createPanel(deps)`, `execute(features, params)`.
   Typedef completo em `frontend/src/js/processing/algorithms/algorithm.interface.js`, exemplo em
   `frontend/src/js/processing/algorithms/buffer.algorithm.js`.
3. Chamar `registerAlgorithm({...})` no load do módulo **e** adicionar o import de
   efeito colateral `import './<name>.algorithm.js';` em `frontend/src/js/processing/algorithms/index.js`.
   Sem o segundo passo o módulo nunca é carregado e o registro nunca roda: não há
   erro, o algoritmo apenas não aparece.
4. Nada mais muda em lugar nenhum.

## Adding a Schema Migration

1. Criar `store/migration/v<from>-to-v<to>.migration.js`. Repare no nome real da
   função exportada: `migrateToV2_1`, `migrateToV2_2`, com **underscore**, não
   `migrateToV21`. Migrações existentes: `v1-to-v2`, `v2-to-v2.1`, `v2.1-to-v2.2`.
2. Em `migration.service.js`, importar e adicionar a chamada condicional dentro de
   `safelyMigrate()`. O encadeamento é por número de versão, não por registry.
3. **Subir `ATLAS_SCHEMA_VERSION` em `frontend/src/js/store/atlas/atlas.entity.js:12`** (hoje
   `'2.2'`). Este é o passo que falta com mais facilidade e falha em silêncio:
   `detectMigrationNeeded()` compara a versão do repositório com essa constante
   (`frontend/src/js/store/migration/migration.service.js:50-52`) e devolve
   `needed: false` se ela não subiu, então `safelyMigrate()` nunca é chamado. A
   migração nova simplesmente não roda, sem erro. (Esta linha chamou a função de
   `needsMigration` até 2026-07-25; esse nome nunca existiu no código, e procurá-lo
   por grep não devolve nada, o que faz parecer que o guarda não existe.)
4. Roda sozinha no próximo startup.

## PDF Export

`pdf-export.tab.js` + `pdf-cartographic-elements.js`. DPI 150/200/300; elementos
cartográficos escalam por `uiScale = dpi / 200`. GDAL é pré-inicializado ao abrir a
aba, não no primeiro uso.

## Street View 360 Navigation

**A projeção não usa distância nem altura.** O marcador recebe do mundo só uma direção:
o alvo é projetado no HORIZONTE da câmera pelo azimute, e a altura acima da linha vem da
posição na fila daquela direção (`elevationDeg(rank)`), não da geometria. A distância só
decide a ORDEM ao longo da direção. Altura de câmera, terreno, `distance_scale` e os
overrides por alvo não estão apenas sem uso, foram removidos do cliente. O `fileoverview`
de `projectOnHorizon` é onde isso está dito por extenso.

Consequência prática: `override_height` sobrevive como coluna do backend (`sv360`) e não
tem nenhum leitor no frontend. Procurar por ele para ajustar o alinhamento é perseguir um
botão que não está mais ligado em nada. O que corrige alinhamento hoje é a rotação de
malha da calibração, que nivela a esfera antes de qualquer desenho.

**O acoplamento que importa agora é interno.** Existem DOIS projetores neste repositório,
e eles precisam concordar na matemática:

- `frontend/src/js/street_view_tool/navigation/projector.js` (o visualizador do mapa);
- `frontend/src/js/calibration/projector.js` (o estúdio, que virou a página `calibracao.html`).

A duplicação é deliberada: a calibração não pode arrastar a store nem o MapLibre do mapa.
O preço é que uma correção feita de um lado não chega ao outro, e o sintoma (o operador
calibra vendo um arranjo, o visualizador desenha outro) aparece longe da causa, com as
duas suítes verdes.

**O guarda existe e tem nome:** `frontend/tests/unit/calibracao-espelha-marcador-andar.test.js`
importa AS DUAS cópias e exige o mesmo número das duas. Ele também leva asserção
ABSOLUTA em cada bloco, porque comparar sozinho deixaria passar duas cópias erradas do
mesmo jeito. Rode-o ao tocar em qualquer um dos lados.

Saiba o alcance dele, que é estreito: cobre a altura do ícone na troca de andar, o rótulo
do andar de destino e o arranjo da fila. **Não** cobre o resto, e o resto já divergiu (só
a calibração tem o cache de frame `beginFrame` e as constantes `ANDAR_PASSO_DEG` /
`ANDAR_DEGRAUS_MAX`). Fora dos três itens medidos, a conferência ainda é o diff dos dois
arquivos na mão.

(A regra anterior mandava sincronizar com `ebgeo_360/public/calibration/js/`, de outro
repositório. O estúdio foi portado para cá, então o alvo da conferência mudou de
repositório para pasta vizinha. Ver [[calibracao-e-grafo-360]] e [[streetview-360]].)

O dado do 360 vem do backend (módulo `streetview360`, schema `sv360`), não do repositório
externo.

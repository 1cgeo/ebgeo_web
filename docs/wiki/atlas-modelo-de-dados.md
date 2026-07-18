# Atlas (modelo de dados)

O Atlas é o contêiner de topo do projeto EBGeo, atlas → mapas → camadas/grupos → feições (20 tipos, geometria em JSONB) + briefings/slides, comentários e side-stores 3D/360, um conceito de projeto nomeado que só existe plenamente no servidor.

## A hierarquia

```
atlas
 ├── maps (viewport, base_layer, notes, grid_style, temporal_config, locked)
 │    ├── layers            (name, visible, locked, sort_order, style, opacity)
 │    ├── groups            (aninháveis via parent_id) ─┐
 │    ├── features ─────── group_features (N:N) ────────┘
 │    ├── catalog_layers    (camadas externas do catálogo)
 │    ├── cesium3d_data     (marker | measurement | viewshed | camera_position)
 │    └── streetview360_data(orientation | marker)
 ├── comments               (raiz com lng/lat + respostas por parent_id)
 ├── images                 (blobs do atlas)
 ├── briefings → slides     (2d | 3d | 360)
 └── atlas_shares           (permissao por usuario)
```

Definição autoritativa do lado servidor: `backend/src/database/migrations/002_atlas.sql`. Tudo pende de `atlas_id`/`map_id` com `ON DELETE CASCADE`, mas o apagamento normal é **soft-delete** (`deleted_at`), porque o sync precisa propagar a exclusão. Ver [[tipos-entidade-sync]] e [[sync-lww-operacoes]].

## Duas entidades chamadas "Atlas"

Este é o erro mais comum: o objeto Atlas do cliente e a linha `atlas` do Postgres **não são o mesmo shape**, e ambos têm um campo `settings` com significados diferentes.

| | Cliente (`src/js/store/atlas/atlas.entity.js`) | Servidor (`002_atlas.sql`) |
|---|---|---|
| Campos | `id`, `name`, `sync`, `schemaVersion`, `mapOrder`, `lastActiveMapId`, `settings` | `id`, `name`, `description`, `owner_id`, `map_order`, `settings`, `is_public`, `public_link`, `version`, `min_version`, `current_version`, timestamps, `deleted_at` |
| `settings` | apenas `{ terrainExaggeration }`, default 1.5 (`atlas.entity.js:15,46`) | allowlist de capacidades: `features.{map_3d, panoramic_images, terrain_3d, data_layers, analysis_layers}`, `basemaps`, `default_basemap`, `bounds_2d`, `min_zoom`/`max_zoom`, `available_*` |
| Ordem de mapas | `mapOrder: string[]` | `map_order UUID[]` |
| Compartilhamento | não existe | `atlas_shares` + `is_public`/`public_link` |

O `settings` do servidor vira um **overlay que só restringe** sobre o `config` global (`src/js/store/sync/atlas-settings.service.js:6-16`): é a interseção entre o que o deploy permite e o que o atlas permite, nunca consegue reativar o que o deploy desligou (3D removido no build do GitHub Pages continua removido). Ao desconectar, `revertAtlasSettings()` restaura o baseline capturado. Ver [[atlas-settings]] e [[config-dinamico]].

O `mapOrder` do cliente é imutável por construção: `addMapToAtlas`/`removeMapFromAtlas`/`reorderAtlasMaps` devolvem um novo objeto (`atlas.entity.js:80-124`). `reorderAtlasMaps` **lança** se o conjunto de ids não for exatamente o mesmo (`atlas.entity.js:117-119`), e `removeMapFromAtlas` zera `lastActiveMapId` quando o mapa removido era o ativo (`atlas.entity.js:103`).

## Um atlas local, N atlas no servidor (P12)

No IndexedDB o Atlas é um **singleton**: uma instância LocalForage `ebgeo_atlas` com a chave fixa `current_atlas` (`src/js/store/repositories/local.repository.js:21,92,105,114`). Não há namespacing por atlas, e isso é deliberado (`docs/visao-e-principios.md` P12): local = 1 workspace + arquivos `.ebgeo`; atlas nomeado, selecionável e compartilhável é capacidade do servidor.

A separação local↔remoto é feita pelo marcador de origem `{ kind: 'local' | 'remote', atlasId }` (`src/js/store/store-origin.js:25-31`), que **default é `local`** e é ausente para todo usuário pré-existente, garantindo que a máquina remota nunca interfira em quem nunca logou. Trocar de atlas é destrutivo e ordenado: desconecta → `clearAllDataStore` (`local.repository.js:740-750` limpa atlas, mapas, imagens, app, grupos, layers, 3D, 360, briefings) → conecta. Ver [[store-origin-local-remoto]] e [[dominio-local-vs-remoto]].

Consequência prática: **dado de atlas remoto não sobrevive ao logout**. Para levar um atlas do servidor para o uso offline, exporte o `.ebgeo` antes de desconectar ([[formato-ebgeo-roundtrip]]).

## Feições: 20 tipos, geometria em JSONB

`features.geometry` e `features.properties` são JSONB no mesmo formato do IndexedDB, sem PostGIS no schema do atlas (as queries espaciais são desnecessárias porque o cliente carrega o mapa inteiro). O CHECK `valid_feature_type` aceita **20** tipos: os 18 tipos de ferramenta mais `processed_los` e `processed_visibility`.

> Atenção: o comentário acima da coluna em `002_atlas.sql` diz "18 valid feature types", mas o `CONSTRAINT valid_feature_type` no mesmo arquivo lista 20. O CHECK manda.

No cliente, `SOURCE_TYPES` tem 18 entradas (`src/js/store/store.constants.js:16-22`), porque `processed_los`/`processed_visibility` são **saídas** de análise e não ferramentas. Eles existem em `FEATURE_TYPE_MAPPINGS` com bucket igual ao próprio nome (`store.constants.js:93-98`): sem essas duas linhas o fallback `source + 's'` gerava `processed_loss`/`processed_visibilitys` e o resultado de processamento caía num bucket fantasma no peer receptor, sem nunca renderizar.

## Identidade de mapa: UUID vs nome (armadilha central)

Mapas de atlas remoto são chaveados por **UUID**; o mapa local padrão `Principal` é chaveado por **nome** e não tem UUID. Isso produz três regras que não podem ser quebradas:

1. Operação cujo `mapId` de contexto não é UUID é **descartada antes da fila** (`src/js/store/sync/operation-dispatcher.js:133-140`). Sem isso o Postgres rejeita com 22P02 e **uma** operação inválida derruba o lote inteiro do flush, travando toda a sincronização.
2. Operação de `SETTING` só passa com id UUID ou o sentinela literal `'atlas'` (`operation-dispatcher.js:120`), que é como as configurações de nível de atlas viajam ([[envelope-operacao]], [[fila-operacoes-outbound]]).
3. Ao ativar o mapa inicial de um atlas conectado, `activateAtlasInitialMap` **remove** todo mapa não-UUID (`src/js/store/map.operations.js:353-371`). Se o `Principal` local recriado no boot permanecesse, ele sombrearia por nome um mapa remoto homônimo e o usuário, inclusive o dono logo após "Salvar no servidor", cairia num mapa vazio.

`saveMap` registra o par nome↔UUID no `mapResolver` quando a chave é UUID (`local.repository.js:264-271`), para que a lista de mapas mostre o nome e não o UUID cru.

## O que sincroniza e o que é REST

Metadados de atlas (criar, listar, obter, compartilhar, link público, clonar, importar) são **REST**; feições, mapas, camadas, grupos, briefings, slides, 3D, 360 e comentários são **sync-only**, sem rota REST de escrita. Ver [[api-rest-atlas]], [[compartilhamento-atlas]], [[link-publico]], [[clone-atlas]], [[atlas-import-offline]] e [[sintese-rest-vs-sync]].

`EntityType.ATLAS` existe no enum de sync (`src/js/store/sync/operation-types.js:9`), mas o caminho corrente para mudanças de nível de atlas na prática é `SETTING` com id `'atlas'` (ver acima) mais o broadcast `atlas_settings_updated`. O `terrainExaggeration` é propriedade **do atlas**, não do mapa (`docs/acoes-interface-multiusuario.md`, item do modal de configurações).

Colunas de versão da linha `atlas`: `version` (versão da entidade), `min_version` e `current_version` (janela do log de operações usada por [[snapshot-e-pull-incremental]]). Conflito continua sendo LWW por ordem de chegada, não por timestamp ([[modelo-conflito-lww]], [[sintese-nao-e-crdt]]).

## Detalhes que costumam morder

- **`images` não tem `version` nem `deleted_at`.** É a única tabela filha do atlas fora do modelo de soft-delete/sync de entidades; blobs sobem por REST em lotes preservando o id (`INSERT_IMAGE_WITH_ID`), justamente para que as referências feição→imagem continuem válidas sem reescrita. Ver [[imagens-atlas]].
- **Comentários não vão para conexões `read`.** O filtro é de transmissão, no snapshot e no broadcast, e respostas são entidades próprias com `parent_id` para não haver clobber LWW numa thread. Ver [[comentario-espacial]].
- **Slides quebram sozinhos.** O trigger `trg_mark_slides_broken` marca `is_broken = TRUE`, `broken_reason = 'map_deleted'` e incrementa `version` quando o mapa referenciado é soft-deletado. Slide referencia modelo 3D por `model_id`, não por tileset.
- **`temporal_config` é JSONB por mapa** na tabela `maps`, não por atlas. No cliente vive em `temporal_<mapName>` no appStore. Ver [[modulo-temporal]].
- **`maps.locked` é aviso de UI, não lock de concorrência.** Ninguém bloqueia a edição de ninguém (P10).
- **`catalog_layers` é tabela própria E coluna legada.** A coluna `maps.catalog_layers` (array) permanece para clone/import e clientes antigos; a entidade por-camada é a que sincroniza.
- **`schemaVersion` do cliente é `'2.2'`** (`atlas.entity.js:12`) e as migrações são forward-only e aditivas. Atualizar o app nunca pode tornar inacessível um atlas já existente no IndexedDB.
- **Permissão é por atlas** (`read` < `comment` < `write` < `manage`, com `owner` sintetizado) e o gate de papel **só vale para atlas remoto conectado**: o store local é sempre editável, inclusive por usuário logado. Ver [[permissoes-atlas]] e [[permissao-vs-papel]].

## Ciclo de vida no cliente

Boot: config → restaura sessão → carrega store com o boot guard `enforceLocalStoreWhenLoggedOut` (descarta atlas remoto órfão, no-op para origem `local`) → reconecta o último atlas remoto. Ver [[sessao-boot-e-ciclo-de-vida]], [[websocket-collab]] e [[presenca-colaboracao]].

Ao abrir um atlas do servidor: fecha a conexão anterior (um socket por atlas), avisa se o store atual é local (risco de perda, ofereça `.ebgeo`), limpa o store, conecta, marca `remote` (`markStoreRemote`, `store-origin.js:87-89`). Invariante: abrir o atlas B nunca pode deixar visível qualquer feição, camada ou mapa do atlas A.

## Fontes

- `docs/visao-e-principios.md`: dois domínios de dados, marcador de origem, P3 (isolamento), P9/P11 (cobertura e round-trip), P12 (1 workspace local vs N atlas no servidor), ciclo de vida do boot, identidade de mapa UUID vs nome.
- `docs/guias/00-visao-geral.md`: papel do atlas no backend único, "features (20 tipos) em JSONB", separação REST vs Sync por tipo de dado, modos anônimo/autenticado/público, hierarquia de permissão por atlas.
- `docs/acoes-interface-multiusuario.md`: `atlas.settings.terrainExaggeration` como propriedade de atlas (não de mapa) e o efeito de deletar o atlas inteiro.
- `docs/ui-ux-ebgeo.md`: URL como fonte de verdade (`?atlas=`/`?atlasPublico=`), Drive de atlas, papéis na UI, overlay de `atlas-settings`.
- `backend/src/database/migrations/002_atlas.sql`: schema autoritativo (tabelas, CHECKs, soft-delete, trigger de slide quebrado, ausência de PostGIS no schema do atlas).
- `src/js/store/atlas/atlas.entity.js`, `src/js/store/store-origin.js`, `src/js/store/repositories/local.repository.js`, `src/js/store/map.operations.js`, `src/js/store/sync/operation-dispatcher.js`, `src/js/store/sync/atlas-settings.service.js`, `src/js/store/store.constants.js`: shape real no cliente, singleton `current_atlas`, guardas de UUID, overlay de settings, tipos de feição.

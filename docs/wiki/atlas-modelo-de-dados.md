# Atlas (modelo de dados)

O Atlas é o contêiner de topo do projeto EBGeo, atlas → mapas → camadas/grupos → feições (20 tipos, geometria em JSONB) + briefings/slides, comentários e side-stores 3D/360, e é ao mesmo tempo a unidade de isolamento de dados, permissão, tempo real e ordenação: um projeto nomeado que só existe plenamente no servidor.

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

Definição autoritativa do lado servidor: `ebgeo_backend/src/database/migrations/002_atlas.sql`. Tudo pende de `atlas_id`/`map_id` com `ON DELETE CASCADE`, mas o apagamento normal é **soft-delete** (`deleted_at`), porque o sync precisa propagar a exclusão. Ver [[tipos-entidade-sync]] e [[modelo-conflito-lww]].

## Por que o Atlas é a fronteira de tudo

Quase todo limite do sistema é desenhado por `atlas_id`:

- **Dados:** toda tabela de entidade pendura em `atlas` por FK (`maps.atlas_id`, as demais via `map_id`), e `operations.atlas_id` tem `ON DELETE CASCADE` (`003_sync.sql:16`).
- **Permissão:** `requireAtlasPermission(level)` resolve o nível a partir de `atlas.owner_id`, de `atlas_shares` e de `atlas.is_public` (`src/middleware/permissions.js:57`). Ver [[permissoes-atlas]].
- **Tempo real:** a sala WebSocket é literalmente `Map<atlasId, Set<WebSocket>>` (`src/modules/collab/collab.rooms.js:6`). Não existe broadcast entre atlas. Ver [[canal-collab-websocket]] e [[canal-collab-websocket]].
- **Ordenação:** o índice de idempotência é `(atlas_id, op_id)` e a ordem do LWW é `server_version` (`003_sync.sql:52`). Ver [[modelo-conflito-lww]] e [[tabela-operations]].
- **Cliente:** o IndexedDB **não** é namespaced por atlas; existe um único workspace local e quem diz "de quem são estes dados" é o marcador de origem. Ver [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]].

## O registro no servidor

Tabela `atlas` (`002_atlas.sql:10`):

| Coluna | Papel |
|---|---|
| `id` | UUID, chave de tudo |
| `name`, `description` | metadados editáveis por `write` |
| `owner_id` | FK `users(id)`, **única** fonte de `owner` (nunca vem de share) |
| `map_order` | `UUID[]`, ordem dos mapas na UI |
| `settings` | JSONB de **disponibilidade de recursos** (ver [[atlas-settings]]) |
| `is_public` / `public_link` | link público read-only (ver [[link-publico]]) |
| `version` | contador de metadados, `version = version + 1` a cada UPDATE REST (`atlas.queries.js:34,43,64,73,90`) |
| `min_version` | piso do log de operações; abaixo dele o pull devolve snapshot |
| `current_version` | último `server_version` de operação vista neste atlas |
| `deleted_at` | soft-delete |

### Os três contadores não são a mesma coisa

Armadilha número um do modelo:

- **`version`** conta edições de metadados via REST (nome, descrição, `map_order`, settings). Não tem relação com sync.
- **`current_version`** é o cursor do log de operações, mantido pelo trigger `trg_update_atlas_version` no INSERT em `operations` (`003_sync.sql:53-69`). É o que o cliente guarda como `lastVersion` para o pull incremental.
- **`min_version`** é o piso após poda do log (`sync.service.js:810`, ver [[sync-admin-operacoes]]). Pedir `GET /atlas/:id/sync/:v` com `v < min_version` força snapshot completo em vez de erro (`sync.service.js:767`). Ver [[snapshot-e-pull-incremental]].

`server_version` vem de `nextval('atlas_version_seq')`, uma sequência **global** compartilhada por todos os atlas (`003_sync.sql:12,31`). Dentro de um atlas ela é crescente mas **não contígua**: use apenas para ordenar, nunca para contar operações nem para calcular "quantas versões atrás".

Nota de precisão (conferido no código): guia *arquitetura-sync* (absorvido) §8.1 descreve o trigger como mantendo `current_version = MAX(server_version)`, mas `003_sync.sql:57-58` faz `SET current_version = NEW.server_version` sem `GREATEST`, ou seja, atribuição direta pelo último INSERT. Na prática coincide (sequência crescente, push transacional), mas não raciocine sobre inserções concorrentes assumindo máximo.

## Duas entidades chamadas "Atlas" (e dois `settings`)

O objeto Atlas do cliente e a linha `atlas` do Postgres **não são o mesmo shape**, e ambos têm um campo `settings` com significados diferentes.

| | Cliente (`src/js/store/atlas/atlas.entity.js`) | Servidor (`002_atlas.sql`) |
|---|---|---|
| Campos | `id`, `name`, `sync`, `schemaVersion`, `mapOrder`, `lastActiveMapId`, `settings` | `id`, `name`, `description`, `owner_id`, `map_order`, `settings`, `is_public`, `public_link`, `version`, `min_version`, `current_version`, timestamps, `deleted_at` |
| `settings` | apenas `{ terrainExaggeration }`, default 1.5 (`atlas.entity.js:15,46`) | allowlist de capacidades: `features.{map_3d, panoramic_images, terrain_3d, data_layers, analysis_layers}`, `basemaps`, `default_basemap`, `bounds_2d`, `min_zoom`/`max_zoom`, `available_*` |
| Ordem de mapas | `mapOrder: string[]` | `map_order UUID[]` |
| Compartilhamento | não existe | `atlas_shares` + `is_public`/`public_link` |

O `settings` do servidor vira um **overlay que só restringe** sobre o `config` global (`src/js/store/sync/atlas-settings.service.js:6-16`, `intersectAvailability` em `:73`): é a interseção entre o que o deploy permite e o que o atlas permite, nunca reativa o que o deploy desligou (3D removido no build do GitHub Pages continua removido). Ao desconectar, `revertAtlasSettings()` restaura o baseline capturado. Ver [[atlas-settings]] e [[config-dinamico]].

Operações de sync do tipo `setting` fazem merge whitelisted em `atlas.settings`, e as chaves de disponibilidade **nunca** são aceitas por esse caminho: só `PATCH /settings` com `manage` muda restrição.

O `mapOrder` do cliente é imutável por construção: `addMapToAtlas`/`removeMapFromAtlas`/`reorderAtlasMaps` devolvem um novo objeto (`atlas.entity.js:80-124`). `reorderAtlasMaps` **lança** se o conjunto de ids não for exatamente o mesmo (`atlas.entity.js:117-119`), e `removeMapFromAtlas` zera `lastActiveMapId` quando o mapa removido era o ativo (`atlas.entity.js:103`).

## Um atlas local, N atlas no servidor (P12)

No IndexedDB o Atlas é um **singleton**: uma instância LocalForage `ebgeo_atlas` com a chave fixa `current_atlas` (`src/js/store/repositories/local.repository.js:21,91,100,105,114`), portanto existe no máximo um Atlas materializado no navegador por vez. Não há namespacing por atlas, e isso é deliberado (guia *visao-e-principios* (absorvido) P12): local = 1 workspace (mapa `Principal` + arquivos `.ebgeo`); atlas nomeado, selecionável e compartilhável é capacidade do servidor. Ver [[formato-ebgeo-roundtrip]].

A separação local↔remoto é feita pelo marcador de origem `{ kind: 'local' | 'remote', atlasId }` (`src/js/store/store-origin.js:25-31` — o arquivo fica em `store/`, não em `store/sync/` como diz guia *arquitetura-sync* (absorvido) §14), que **default é `local`** e é ausente para todo usuário pré-existente, garantindo que a máquina remota nunca interfira em quem nunca logou.

Consequências que causam bug se ignoradas:

1. **Abrir um atlas do servidor apaga o store.** `open-atlas.service.js` faz `clearAllDataStore()` → `markStoreRemote(atlasId)` (`store-origin.js:87-89`) → `syncEngine.connect(atlasId, { initialPull: true })` → `startAutoFlush()` (`src/js/account/open-atlas.service.js:59,62,64,79`). Trocar de atlas é destrutivo por design, e antes disso a UI avisa se o store atual é local (risco de perda, ofereça `.ebgeo`). Invariante: abrir o atlas B nunca pode deixar visível qualquer feição, camada ou mapa do atlas A.
2. **`clearAllDataStore` limpa também o registro do atlas e a fila de operações** (`store.js:212`; `local.repository.js:740-750` limpa atlas, mapas, imagens, app, grupos, layers, 3D, 360, briefings), para settings remotos e ops não-flushadas não vazarem para o próximo atlas. Ver [[fila-operacoes-outbound]].
3. **Dado de atlas remoto não sobrevive ao logout.** A guarda de boot `enforceLocalStoreWhenLoggedOut()` (`src/js/store/store.js:137`) descarta tudo se a origem é `remote` e ninguém está autenticado. Para levar um atlas do servidor para o uso offline, exporte o `.ebgeo` antes de desconectar.

## Feições: 20 tipos, geometria em JSONB

`features.geometry` e `features.properties` são JSONB no mesmo formato do IndexedDB, sem PostGIS no schema do atlas (as queries espaciais são desnecessárias porque o cliente carrega o mapa inteiro). O CHECK `valid_feature_type` (`002_atlas.sql:186-192`) aceita **20** tipos: os 18 tipos de ferramenta mais `processed_los` e `processed_visibility`. O comentário acima da coluna diz "18 valid feature types" e está errado; o CHECK manda.

No cliente, `SOURCE_TYPES` tem 18 entradas (`src/js/store/store.constants.js:16-22`), porque `processed_los`/`processed_visibility` são **saídas** de análise e não ferramentas. Eles existem em `FEATURE_TYPE_MAPPINGS` com bucket igual ao próprio nome (`store.constants.js:93-98`): sem essas duas linhas o fallback `source + 's'` gerava `processed_loss`/`processed_visibilitys` e o resultado de processamento caía num bucket fantasma no peer receptor, sem nunca renderizar.

## Identidade de mapa: UUID vs nome (armadilha central)

Mapas de atlas remoto são chaveados por **UUID**; o mapa local padrão `Principal` é chaveado por **nome** e não tem UUID. Daí três regras que não podem ser quebradas:

1. Operação cujo `mapId` de contexto não é UUID é **descartada antes da fila** (`src/js/store/sync/operation-dispatcher.js:133-140`). Sem isso o Postgres rejeita com 22P02 e **uma** operação inválida derruba o lote inteiro do flush, travando toda a sincronização.
2. Operação de `SETTING` só passa com id UUID ou o sentinela literal `'atlas'` (`operation-dispatcher.js:120`), que é como as configurações de nível de atlas viajam ([[envelope-operacao]], [[fila-operacoes-outbound]]).
3. Ao ativar o mapa inicial de um atlas conectado, `activateAtlasInitialMap` **remove** todo mapa não-UUID (`src/js/store/map.operations.js:353-371`). Se o `Principal` local recriado no boot permanecesse, sombrearia por nome um mapa remoto homônimo e o usuário, inclusive o dono logo após "Salvar no servidor", cairia num mapa vazio.

`saveMap` registra o par nome↔UUID no `mapResolver` quando a chave é UUID (`local.repository.js:264-271`), para que a lista de mapas mostre o nome e não o UUID cru.

## Rotas REST

Metadados de atlas (criar, listar, obter, compartilhar, link público, clonar, importar) são **REST**; feições, mapas, camadas, grupos, briefings, slides, 3D, 360 e comentários são **sync-only**, sem rota REST de escrita (ver [[sintese-rest-vs-sync]] e [[envelope-operacao]]). Rotas em `src/modules/atlas/atlas.routes.js`:

| Rota | Gate | Nota |
|---|---|---|
| `GET /atlas` | auth | próprios + compartilhados, com `user_permission` |
| `POST /atlas` | auth | |
| `POST /atlas/import` | auth | cria atlas a partir de dump local, preserva UUIDs das entidades (`:22`) |
| `GET /atlas/public/:link` | nenhum (rate-limited) | devolve `publicToken` |
| `GET /atlas/trash` | auth | **precisa vir antes de `/:atlasId`**, literal vs param (`:25`) |
| `GET /atlas/:atlasId` | `read` | inclui array `maps` resumido |
| `PUT /atlas/:atlasId` | `write` | |
| `DELETE /atlas/:atlasId` | `owner` | soft-delete + `closeRoom` |
| `POST /atlas/:atlasId/restore` | checado no service | `requireAtlasPermission` só enxerga atlas vivo, então o gate de dono está dentro da query (`:29`, `atlas.service.js:91`) |
| `GET/PATCH /atlas/:atlasId/settings` | `read` / `manage` | |
| `POST /atlas/:atlasId/transfer` | `owner` | ex-dono vira `manage` |
| `POST /atlas/:atlasId/clone` | `read` | ver [[clone-atlas]] |
| `POST /atlas/:atlasId/maps/:mapId/duplicate` | `write` | dispara `map_duplicated` (re-pull, não op) |

Sub-routers montados sob o atlas: `sharing`, `images`, `sync`, `maps`, `briefings` (`:47`). Contratos em [[api-rest-atlas]], formato de erro em [[erros-api]], import offline em [[atlas-import-offline]]. guia *02-atlas-basico* (absorvido) documenta só listar/criar/obter/atualizar/deletar/settings/clone e omite `import`, `trash`, `restore`, `transfer` e `maps/:mapId/duplicate`, que existem no código (`atlas.routes.js:22,25,31,38,44`).

`EntityType.ATLAS` existe no enum de sync (`src/js/store/sync/operation-types.js:9`), mas o caminho corrente para mudanças de nível de atlas é `SETTING` com id `'atlas'` mais o broadcast `atlas_settings_updated`. O `terrainExaggeration` é propriedade **do atlas**, não do mapa. Conflito continua sendo LWW por ordem de chegada, não por timestamp ([[modelo-conflito-lww]], [[sintese-nao-e-crdt]]).

### Deleção é soft, e não cascateia de fato

`DELETE` marca `deleted_at` e incrementa `version` (`atlas.service.js:69`). As FKs dizem `ON DELETE CASCADE`, mas como não há hard-delete, **mapas, feições, briefings e o log de `operations` permanecem no banco**. O atlas some das listagens, a sala é fechada com `atlas_deleted`, e `GET /atlas/trash` + `POST /:id/restore` trazem tudo de volta intacto. Não assuma que deletar um atlas liberou espaço ou apagou dados de usuário.

## Permissões, sem pegadinha

Hierarquia `read < comment < write < manage < owner` (`permissions.js:12`, níveis numéricos 1..5). Resolução em `resolvePermission` (`:30`): dono → share → público → `null` (403). Atlas inexistente ou soft-deletado dá 404, não 403.

- **`owner` não é compartilhável.** O CHECK de `atlas_shares.permission` só aceita `read|comment|write|manage` (`002_atlas.sql:63`). Posse muda apenas por `POST /:id/transfer`.
- **`manage` está acima de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor silenciosamente. Compare sempre por nível numérico.
- **Admin global é owner em todo atlas.** `req.user.role === 'admin'` faz short-circuit antes de olhar shares (`permissions.js:82`). Ver [[gestao-usuarios]] e [[permissoes-atlas]].
- **O gate de papel só vale para atlas remoto conectado.** O store local é sempre editável, inclusive por usuário logado.

Papel de acesso do atlas e papel de identidade do frontend são vocabulários distintos: ver [[sintese-capacidades-por-papel]] e [[autenticacao-jwt]].

## Compartilhamento e link público

`atlas_shares` é a tabela de membership, com `UNIQUE(atlas_id, user_id)` (`002_atlas.sql:67`). Gerência exige `manage`. Ver [[compartilhamento-atlas]].

O link público (`POST/DELETE /:id/sharing/public`) liga `is_public` e gera `public_link`. `GET /atlas/public/:link` não pede auth e devolve um JWT efêmero (1h, `permission: 'read'`, identidade "Visitante") que serve tanto para pull quanto para o WebSocket. No cliente, `connectPublic()` conecta com **logging de operações desabilitado**: o visitante recebe tempo real e presença mas nunca enfileira op. Ver [[link-publico]].

O service de sharing devolve camelCase (`isPublic`, `publicLink`, `sharing.service.js:13`), que é o que `src/js/modals/sharing.modal.js:179` consome; o exemplo de guia *07-compartilhamento* (absorvido) §5.2 lê `is_public`/`public_link` e oferece só `read`/`write` no seletor, omitindo `comment` e `manage`.

## Ciclo de vida de uma sessão de atlas

Boot: config → restaura sessão → carrega store com o boot guard `enforceLocalStoreWhenLoggedOut` (descarta atlas remoto órfão, no-op para origem `local`) → reconecta o último atlas remoto. Ver [[sessao-boot-e-ciclo-de-vida]].

1. `GET /atlas/:id/sync/0` → snapshot completo, reconstruído **das tabelas de entidade**, não por replay do log (`sync.service.js:440`). Ver [[snapshot-e-pull-incremental]].
2. `applyRemoteSnapshot` grava no IndexedDB no mesmo shape do store (contrato congelado). Ver [[aplicacao-operacoes-remotas]].
3. WS `/api/v1/collab?atlasId=...&token=...&clientId=...` (um socket por atlas); o `connected` traz `permission`, `role` e o roster. Ver [[presenca-colaborativa]] e [[presenca-colaborativa]].
4. Mutações viram operações enfileiradas e empurradas por `POST /atlas/:id/sync`. Ver [[tipos-entidade-sync]] e [[modelo-conflito-lww]].
5. Reconexão manda `sync_request(lastVersion)`; pull incremental a partir de `current_version`.

Eventos que mudam o atlas **fora** do log de operações (`atlas_updated`, `map_duplicated`, `maps_merged`) forçam **re-pull de snapshot**, não apply de op. `atlas_deleted`, `atlas_owner_changed` e `atlas_settings_updated` têm handlers dedicados. Ao adicionar uma mutação REST no atlas, decida explicitamente em qual desses dois mundos ela cai. Imagens são o outro caminho fora do log: blobs por REST sob `/atlas/:id/images`, com a referência viajando pelo sync.

## Guardas anti-IDOR que dependem do atlas

- `applyOperation` faz `INSERT ... SELECT ... WHERE EXISTS (mapa pertence a ESTE atlas)`, então uma op com `mapId` de outro atlas não escreve nada em vez de escrever no lugar errado.
- O merge de mapas exige que destino e origens estejam no mesmo atlas, senão 404.
- O upgrade do WS valida `atlasId`, `token` e o formato de `clientId` (`^[a-zA-Z0-9_-]{8,64}$`), e **re-reconcilia a autorização a cada heartbeat**: share revogado ou atlas despublicado fecha o socket com código `4003`. Ver [[client-id-estavel]].

Para depurar convergência por atlas com correlação ponta a ponta, ver [[syncledger]] e [[idempotencia-e-convergence-guard]].

## Detalhes que costumam morder

- **`images` não tem `version` nem `deleted_at`.** É a única tabela filha do atlas fora do modelo de soft-delete/sync de entidades; blobs sobem por REST em lotes preservando o id (`INSERT_IMAGE_WITH_ID`), para que as referências feição→imagem continuem válidas sem reescrita. Ver [[imagens-atlas]].
- **Comentários não vão para conexões `read`.** O filtro é de transmissão, no snapshot e no broadcast, e respostas são entidades próprias com `parent_id` para não haver clobber LWW numa thread. Ver [[comentario-espacial]].
- **Slides quebram sozinhos.** O trigger `trg_mark_slides_broken` marca `is_broken = TRUE`, `broken_reason = 'map_deleted'` e incrementa `version` quando o mapa referenciado é soft-deletado. Slide referencia modelo 3D por `model_id`, não por tileset.
- **`temporal_config` é JSONB por mapa** na tabela `maps`, não por atlas. No cliente vive em `temporal_<mapName>` no appStore. Ver [[modulo-temporal]].
- **`maps.locked` é aviso de UI, não lock de concorrência.** Ninguém bloqueia a edição de ninguém (P10).
- **`catalog_layers` é tabela própria E coluna legada.** A coluna `maps.catalog_layers` (array) permanece para clone/import e clientes antigos; a entidade por-camada é a que sincroniza.
- **`schemaVersion` do cliente é `'2.2'`** (`atlas.entity.js:12`) e as migrações são forward-only e aditivas. Atualizar o app nunca pode tornar inacessível um atlas já existente no IndexedDB.

## Fontes

- guia *visao-e-principios* (absorvido): dois domínios de dados, marcador de origem, P3 (isolamento), P9/P11 (cobertura e round-trip), P12 (1 workspace local vs N atlas no servidor), ciclo de vida do boot, identidade de mapa UUID vs nome.
- guia *00-visao-geral* (absorvido): papel do atlas no backend único, "features (20 tipos) em JSONB", separação REST vs Sync, modos anônimo/autenticado/público.
- guia *02-atlas-basico* (absorvido), `03-sync-inicial.md`, `05-sync-crdt.md`, `07-compartilhamento.md`: CRUD REST, matriz de permissões, pull híbrido e `min_version`, push/pull por atlas e merge restrito ao mesmo atlas, `atlas_shares` e `publicToken` de 1h.
- guia *acoes-interface-multiusuario* (absorvido): `atlas.settings.terrainExaggeration` como propriedade de atlas (não de mapa) e o efeito de deletar o atlas inteiro.
- guia *ui-ux-ebgeo* (absorvido): URL como fonte de verdade (`?atlas=`/`?atlasPublico=`), Drive de atlas, papéis na UI, overlay de `atlas-settings`.
- guia *arquitetura-sync* (absorvido): contadores de versão, sala WS por atlas, marcador de origem, comportamentos por design.
- Código conferido (backend): `database/migrations/002_atlas.sql` e `003_sync.sql` (schema, CHECKs, trigger, sequência, soft-delete, slide quebrado, ausência de PostGIS), `modules/atlas/atlas.routes.js` e `atlas.service.js`, `middleware/permissions.js`, `modules/collab/collab.rooms.js`, `modules/sharing/sharing.service.js`.
- Código conferido (web): `src/js/store/atlas/atlas.entity.js`, `store-origin.js`, `store.js`, `repositories/local.repository.js`, `map.operations.js`, `store.constants.js`, `sync/operation-dispatcher.js`, `sync/atlas-settings.service.js`, `sync/api-client.js`, `account/open-atlas.service.js`, `modals/sharing.modal.js`.

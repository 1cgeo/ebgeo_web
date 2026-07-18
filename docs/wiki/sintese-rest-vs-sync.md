# Síntese: o que é REST e o que trafega por sync

Quadro de decisão que separa as duas superfícies de escrita do sistema, o atlas e suas settings/compartilhamentos/clone/imagens vivem no REST, enquanto mapas, features, layers, groups, briefings, slides e dados 3D/360 só mudam por operações de sync, e explica as consequências dessa fronteira.

## A regra em uma linha

O **contêiner** é REST. O **conteúdo** é sync.

O atlas é a única entidade com CRUD REST completo ([[api-rest-atlas]]). Tudo que vive *dentro* dele muda exclusivamente por operações no log ([[envelope-operacao]], [[tabela-operations]]). As rotas de mapas e briefings existem, mas são deliberadamente somente-leitura:

- `src/modules/maps/maps.routes.js:13-14` expõe apenas `GET /` e `GET /:mapId`.
- `src/modules/briefings/briefings.routes.js:11-12`, idem, com o comentário explícito "All write operations (create, update, delete) are managed via sync API".
- Não existe nenhuma rota REST para feature, layer ou group. Elas só aparecem no dispatch de `applyOperation` (`src/modules/sync/sync.service.js:1046-1150`).

## Tabela de decisão

| Objeto | Caminho de escrita | Gate | Onde |
|---|---|---|---|
| Atlas (criar/renomear/deletar/restaurar) | REST | `write` para PUT, `owner` para DELETE | `atlas.routes.js:21,27,28,31` |
| `atlas.settings` (recursos disponíveis) | REST `PATCH` | `manage` | `atlas.routes.js:35` |
| `atlas.settings` (preferências de app) | **sync**, op `setting` | `write` | `sync.service.js:1315` |
| Compartilhamento com usuários | REST | `manage` | `sharing.routes.js:15-20` |
| Link público | REST | `manage` | `sharing.routes.js:16-17` |
| Transferência de posse | REST | `owner` | `atlas.routes.js:38` |
| Clone / import de atlas | REST | `read` (clone) / autenticado (import) | `atlas.routes.js:41,22` |
| Blob de imagem | REST multipart | `write` | `images.routes.js:65-66` |
| Referência da imagem na feature | sync | `write` | via propriedade da feature |
| Map, feature, layer, group | sync | `write` (`owner` para deletar mapa/travar) | `sync.service.js:610-620` |
| Briefing, slide | sync | `write` | `sync.service.js:1086-1099` |
| Cesium 3D, StreetView 360, catálogo | sync | `write` | `sync.service.js:1104-1114` |
| Comentário espacial | sync | `comment` | `sync.service.js:606` |
| Duplicar mapa, mesclar mapas | **REST (exceção)** | `write` | `atlas.routes.js:44`, `maps.routes.js:17` |

Detalhes por entidade em [[tipos-entidade-sync]]; a hierarquia de papéis em [[permissoes-atlas]] e [[sintese-capacidades-por-papel]].

## Por que essa fronteira existe

Sync serve para mudanças **de granularidade fina, frequentes e concorrentes**, cujo mérito é convergir por [[modelo-conflito-lww]] (LWW por ordem de chegada no servidor, veja [[sintese-nao-e-crdt]]). Mover um vértice de polígono 30 vezes por segundo não cabe num `PUT`.

REST serve para mudanças **raras, estruturais e não concorrentes**, onde a semântica de "última escrita vence por feição" seria errada ou perigosa: quem pode ver o atlas, quais basemaps ele expõe, quem é o dono. Um op de sync com granularidade "atlas inteiro" reabriria a porta para um editor sobrescrever a lista de compartilhamentos.

O corolário de segurança: **o gate de escrita das duas superfícies é diferente de propósito**. Sync exige no mínimo `comment` na rota (`sync.routes.js:19`) e depois refina por op em `assertOperationAllowed` (`sync.service.js:600-620`); REST de sharing e settings exige `manage` na rota. Um usuário `write` nunca alcança a superfície REST de governança. Veja [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

## A armadilha central: `atlas.settings` tem dois donos

Este é o ponto que mais gera bug. A coluna `atlas.settings` é escrita pelos **dois** caminhos, particionada por chave:

- **REST `PATCH /atlas/:id/settings`** (`manage`) escreve as chaves de *disponibilidade de recurso*: `features.map_3d`, `basemaps`, `default_basemap`, `bounds_2d`, `min_zoom`/`max_zoom`, `available_*`. Veja [[atlas-settings]].
- **Op de sync `setting`** (`write`) escreve apenas uma **whitelist de preferências de app**: `terrainExaggeration`, `customIcons`, `mapOrder`, mais as chaves objeto `mapBadgeColors` e `colorUsage` (`sync.service.js:16` e `1315-1345`).

A whitelist não é cosmética, é a defesa: sem ela um usuário `write` reescreveria por sync quais camadas o atlas expõe, contornando o gate `manage` do REST. O comentário do código diz isso literalmente ("so a write user cannot rewrite which basemaps/layers the atlas exposes"). Se você adicionar uma chave nova a `settings`, **decida a qual lado ela pertence antes de escrever a primeira linha**, e nunca a inclua na whitelist do sync se ela controlar acesso a recurso.

Duas notas de implementação que economizam depuração:
- `mapBadgeColors` e `colorUsage` sofrem merge de um nível (`COALESCE(settings->key,'{}') || incoming`), justamente para que gravações concorrentes por mapa não se derrubem. As demais chaves são substituídas inteiras.
- No cliente, `logAtlasSetting` (`src/js/store/sync/operation-dispatcher.js:346-363`) usa o UUID do atlas quando consegue resolvê-lo e o sentinela literal `'atlas'` quando não. O backend escopa pelo atlas da **rota** e ignora o `entityId`, então o sentinela funciona. Um `entityId` que não seja UUID nem `'atlas'` é descartado antes do flush (`operation-dispatcher.js:120`), porque uma única op inválida faz o Postgres estourar `22P02` e **derruba o lote inteiro**, travando todo o sync.

## A exceção que confirma a regra: escritas REST estruturais

Três rotas REST escrevem entidades filhas apesar da regra:

- `POST /atlas/:atlasId/maps/:mapId/duplicate` (`atlas.routes.js:44`)
- `POST /atlas/:atlasId/maps/:mapId/merge` (`maps.routes.js:17`), que move em uma transação as linhas de `features`, `groups`, `layers`, `cesium3d_data`, `streetview360_data` e `catalog_layers` para o mapa destino (`maps.service.js:9-16,39-62`)
- `POST /atlas/:atlasId/clone` e `POST /atlas/import` ([[clone-atlas]], [[atlas-import-offline]])

Todas são **atômicas e estruturais**, cabem mal num log de ops (a mesclagem seria centenas de ops `update` sem atomicidade). O preço é real:

> **Elas não passam pela tabela `operations` e não incrementam `current_version`.** Um peer que fizer pull incremental (`GET /atlas/:id/sync/:version`) **nunca verá** essas mudanças, porque `pullOperations` só lê `operations` quando `sinceVersion > 0` (`sync.service.js:770-804`).

A compensação é uma notificação por WebSocket, não uma op: `broadcastToRoom(..., { type: 'map_duplicated' })` e `{ type: 'maps_merged' }` (`atlas.controller.js:71`, `maps.controller.js:19-23`). O cliente trata `atlas_updated`, `map_duplicated` e `maps_merged` como um único sinal `serverResync` (`src/js/store/sync/ws-client.js:352-358`), que dispara `syncEngine.resync()`, um `pullSync(atlasId, 0)` forçado, ou seja, **snapshot completo** (`sync-engine.js:332-347,493-500`). O comentário no `ws-client.js` documenta que antes esses frames caíam no `default` e a mudança sumia silenciosamente.

Consequência prática: quem estiver **offline** no momento do merge só converge quando voltar e receber um snapshot ([[snapshot-e-pull-incremental]]). Se você adicionar outra rota REST que escreva entidades filhas, **é obrigatório** emitir um broadcast que o cliente mapeie para `serverResync`, senão a mudança fica invisível para todo peer conectado.

> [!CONTRADICAO 2026-07-18] guia *02-atlas-basico* (absorvido):495-508` desenha "Map (via sync)" sem ressalva, mas `src/modules/maps/maps.routes.js:17` e `src/modules/atlas/atlas.routes.js:44` expõem `merge` e `duplicate` como escritas REST de mapa e seus filhos.

## Notificações REST que o WebSocket carrega

Mesmo quando a mudança é puramente do atlas, o REST avisa o [[canal-collab-websocket]] para que a UI não fique defasada. São **frames de notificação**, não ops, e não entram no log:

| Frame | Origem REST | Efeito no cliente |
|---|---|---|
| `atlas_updated` | `PUT /atlas/:id` | `serverResync` (re-pull de snapshot) |
| `atlas_settings_updated` | `PATCH /settings` | reaplica overlay de settings (`sync-engine.js:474`) |
| `atlas_deleted` | `DELETE /atlas/:id` | `closeRoom`, teardown e volta ao seletor |
| `atlas_owner_changed` | `POST /transfer` | re-resolve o papel local (`sync-engine.js:438`) |
| `sharing_updated` | rotas de sharing | atualiza o modal |
| `map_duplicated` / `maps_merged` | duplicate/merge | `serverResync` |

Referências: `atlas.controller.js:23,29,50,71,81` e `ws-client.js:343-361`. A distinção "op versus frame de notificação" é o eixo de [[sintese-rest-vs-websocket]]; o transporte em si está em [[canal-collab-websocket]].

## Imagens: o único objeto que atravessa as duas superfícies

O **blob** sobe por REST multipart (`POST /atlas/:id/images`, `write`, `images.routes.js:65`), com filtro de MIME para `png/jpeg/webp` e limite de tamanho do multer. A **referência** (o id retornado, gravado em `markerSymbol`/`photoId` da feature) viaja como parte da op de feature. Veja [[imagens-atlas]].

Ordem obrigatória: **suba o blob primeiro, só então grave a feição**. Se a op chegar ao peer antes do upload concluir, o peer resolve o id e recebe 404. `uploadImageBlob` é best-effort e retorna `null` em qualquer falha (`src/js/store/sync/image-sync.js:44-51`), caso em que o chamador cai para um id local, o que significa que **essa feição fica com uma imagem que nenhum peer consegue ver**. O clone de atlas herda o mesmo modelo: copia as referências, não duplica os arquivos.

## Pegadinhas do gate de permissão

- **`manage` está acima de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor em silêncio. O exemplo de frontend em guia *02-atlas-basico* (absorvido):420` (`['write','owner'].includes(msg.permission)`) tem exatamente esse defeito, e o próprio documento avisa disso logo abaixo (linha 409-411). Não copie o trecho.
- **`owner` nunca vem de `atlas_shares`.** É sintetizado de `atlas.owner_id`; o CHECK da tabela aceita apenas `read|comment|write|manage` (`sharing.routes.js:11-14`). A posse só muda pela rota de transferência.
- **Deletar mapa e travar/destravar mapa são `owner`**, embora sejam ops de sync, não REST. A checagem está em `assertOperationAllowed` (`sync.service.js:611-620`), inspecionando `op.type === 'delete'` e `changes.locked`.
- **O gate da rota de push é `comment`, não `write`**, de propósito, para que o Comentarista alcance a rota; o refinamento por op bloqueia tudo que não seja `target === 'comment'` (`sync.routes.js:19`, `sync.service.js:606`). Veja [[comentario-espacial]].
- Erros de ambas as superfícies seguem o mesmo envelope `{ error: { code, message } }`, veja [[erros-api]].

## Detalhe de resposta que quebra código

`GET /atlas/:id/sharing` responde em **camelCase** (`isPublic`, `publicLink`, `shares[].userId`), confirmado em `src/modules/sharing/sharing.service.js:13-20`. Já `POST /sharing/users` responde o registro cru da tabela em **snake_case** (`user_id`, `added_at`). O exemplo de modal em guia *07-compartilhamento* (absorvido):586,611` lê `data.data.is_public` e `share.user_id` sobre a resposta do `GET`, o que retorna `undefined`.

> [!CONTRADICAO 2026-07-18] guia *07-compartilhamento* (absorvido):586,611` acessa `is_public` e `user_id` na resposta de `GET /sharing`, mas `src/modules/sharing/sharing.service.js:13-20` devolve `isPublic` e `shares[].userId`.

## Detalhes que o código revela e a prosa não

- **`EntityType.ATLAS` existe mas é código morto.** Declarado em `src/js/store/sync/operation-types.js:9` e **não referenciado em nenhum lugar** do frontend. Atlas não é entidade de sync; use REST. Não "reative" essa constante achando que existe um caminho pronto.
- **`atlas.version` e `current_version` são contadores diferentes.** As escritas REST incrementam `version` (o versionamento otimista do atlas) e nunca tocam `current_version`, que é a ordem de chegada usada pelo sync. Ver [[modelo-conflito-lww]] e [[fila-operacoes-outbound]].
- **O `deleteAtlas` é soft-delete.** Marca `deleted_at`, incrementa `version`, fecha a sala. Mapas, features e briefings **permanecem no banco**, não há cascade. Por isso existe `GET /atlas/trash` e `POST /:id/restore` (`atlas.routes.js:25,31`), e por isso o restore é checado dentro do serviço, `requireAtlasPermission` só enxerga atlas vivos.
- **O snapshot filtra comentários por papel.** `pullOperations` remove ops de `comment` para quem é `read` (`sync.service.js:797-799`), tanto no incremental quanto no snapshot.
- **O acesso público usa um JWT temporário de 1h, read-only**, obtido em `GET /atlas/public/:link` sem autenticação, com rate limit próprio (`publicLinkLimiter`, `atlas.routes.js:23`). Ele serve tanto para REST quanto para o WebSocket. Veja [[link-publico]] e [[autenticacao-jwt]].

## Checklist ao adicionar uma escrita nova

1. É configuração do contêiner ou dado do conteúdo? Contêiner vai para REST, conteúdo vira op.
2. Se virou op, ela existe em `EntityType` (frontend) **e** no dispatch de `applyOperation` (backend)? Um tipo desconhecido cai no `default` do `remote-operation-handler.js:339` com apenas um `console.warn`.
3. Se foi para REST e altera dados que o peer renderiza, você emitiu um broadcast, e o `ws-client.js` mapeia esse `type`? Sem isso a mudança é invisível ao vivo e invisível no pull incremental.
4. Se toca `atlas.settings`, a chave é de disponibilidade de recurso (fica fora da whitelist de sync) ou preferência de app (entra)?
5. O gate corresponde à superfície? `manage` para governança, `write` para conteúdo, `owner` para posse/lock/delete de mapa.

## Ver também

[[atlas-modelo-de-dados]] · [[atlas-modelo-de-dados]] · [[aplicacao-operacoes-remotas]] · [[compartilhamento-atlas]] · [[dominio-local-vs-remoto]] · [[sintese-modulos-fora-do-sync]] · [[sintese-limites-collab]] · [[sync-admin-operacoes]] · [[formato-ebgeo-roundtrip]]

## Fontes

- guia *02-atlas-basico* (absorvido): CRUD REST do atlas, formato de settings, hierarquia e matriz de permissões, escopo do clone, diagrama "Atlas (REST) → filhos (sync)", envelope de erro.
- guia *07-compartilhamento* (absorvido): rotas de sharing e link público (todas `manage`), token público read-only de 1h, limitações do acesso público, formato das respostas.
- `ebgeo_backend/src/modules/atlas/atlas.routes.js` e `atlas.controller.js`: rotas REST reais, gates por rota, broadcasts `atlas_updated`/`atlas_settings_updated`/`atlas_deleted`/`map_duplicated`/`atlas_owner_changed`.
- `ebgeo_backend/src/modules/maps/maps.routes.js`, `maps.controller.js`, `maps.service.js`: rotas de mapa somente-leitura mais a exceção `merge` e as tabelas filhas que ela move.
- `ebgeo_backend/src/modules/briefings/briefings.routes.js`: briefings somente-leitura por REST.
- `ebgeo_backend/src/modules/sharing/{sharing.routes.js,sharing.service.js}`: gate `manage`, `owner` não concedível, formato camelCase da resposta.
- `ebgeo_backend/src/modules/sync/{sync.routes.js,sync.controller.js,sync.service.js}`: gate `comment` na rota, `assertOperationAllowed`, whitelist da op `setting`, `SETTING_OBJECT_KEYS`, dispatch por `target`, `pullOperations` snapshot versus incremental.
- `ebgeo_backend/src/modules/images/images.routes.js`: upload multipart, filtro de MIME, gate `write`.
- `ebgeo_web/src/js/store/sync/{ws-client.js,sync-engine.js,operation-dispatcher.js,operation-types.js,remote-operation-handler.js,image-sync.js}`: mapeamento de frames para `serverResync`, `resync()` com pull de snapshot, guardas de pré-flush, `EntityType.ATLAS` sem uso, upload best-effort de blobs.

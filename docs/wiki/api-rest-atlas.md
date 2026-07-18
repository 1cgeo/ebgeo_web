# API REST de Atlas (/api/v1/atlas)

Família de endpoints REST autenticados por Bearer JWT que cobre listagem, criação, leitura, atualização, deleção, settings, clone e compartilhamento de atlas, sempre com envelope `{ data }` e permissão mínima declarada por rota.

## Onde isso vive

Backend (`ebgeo_backend`): `src/modules/atlas/` (routes, controller, service, queries, schemas) e `src/modules/sharing/` montado como sub-router em `atlas.routes.js:47`. Cliente: `src/js/store/sync/api-client.js` no `ebgeo_web`.

Esta é a superfície **REST** do [[atlas-modelo-de-dados]]. Tudo que é conteúdo do atlas (mapas, feições, camadas, grupos, briefings, slides) NÃO tem rota REST de escrita: viaja como operação de sync. Ver [[sintese-rest-vs-sync]] e [[envelope-operacao]].

## Mapa de rotas (o que o código realmente expõe)

Fonte: `src/modules/atlas/atlas.routes.js:20-51`.

| Rota | Permissão mínima | Observação |
|---|---|---|
| `GET /atlas` | autenticado | lista atlas próprios + compartilhados |
| `POST /atlas` | autenticado | 201, cria com settings default do banco |
| `POST /atlas/import` | autenticado | 201, bulk import offline ([[atlas-import-offline]]) |
| `GET /atlas/public/:link` | **nenhuma** | rate-limited, devolve `publicToken` ([[link-publico]]) |
| `GET /atlas/trash` | autenticado | lixeira do próprio usuário |
| `GET /atlas/:atlasId` | `read` | inclui array `maps` |
| `PUT /atlas/:atlasId` | `write` | broadcast `atlas_updated` na sala |
| `DELETE /atlas/:atlasId` | `owner` | 204, soft-delete, fecha a sala |
| `POST /atlas/:atlasId/restore` | dono (checado no service) | não usa `requireAtlasPermission` |
| `GET /atlas/:atlasId/settings` | `read` | |
| `PATCH /atlas/:atlasId/settings` | `manage` | broadcast `atlas_settings_updated` |
| `POST /atlas/:atlasId/transfer` | `owner` | transfere posse |
| `POST /atlas/:atlasId/clone` | `read` | 201 ([[clone-atlas]]) |
| `POST /atlas/:atlasId/maps/:mapId/duplicate` | `write` | 201 |
| `/atlas/:atlasId/sharing/*` | `manage` | ver [[compartilhamento-atlas]] |
| `/atlas/:atlasId/images/*` | ver [[imagens-atlas]] | sub-router |
| `/atlas/:atlasId/sync/*` | ver [[snapshot-e-pull-incremental]] | sub-router |

> **Nota histórica.** guia *02-atlas-basico* (absorvido) documenta apenas 8 rotas (list, create, get, update, delete, settings x2, clone). O código em `src/modules/atlas/atlas.routes.js:22-44` expõe também `POST /import`, `GET /trash`, `POST /:atlasId/restore`, `POST /:atlasId/transfer` e `POST /:atlasId/maps/:mapId/duplicate`. O guia está incompleto, não errado.

## Ordem das rotas importa

`GET /atlas/trash` é declarada **antes** de `GET /atlas/:atlasId` (`atlas.routes.js:24-26`) porque Express casa na ordem: invertendo, `trash` seria capturado como `:atlasId` e viraria 404 (ou 422, dependendo do schema). O mesmo vale para `/public/:link`. Se você adicionar rota literal nova sob `/atlas`, coloque acima do param.

## Envelope e contrato de erro

Sucesso é sempre `{ "data": ... }`; 204 vem sem corpo. O cliente desembrulha em `api-client.js:_unwrap` (`src/js/store/sync/api-client.js:255-261`), com um passe-livre para contratos "nus" (arrays e o objeto de config, que não têm chave `data`).

Erro é `{ "error": { "code", "message" } }`. O `_request` (`api-client.js:228-241`) faz **um** refresh transparente em 401 e repete a chamada uma única vez (`_retry: false` na segunda), ver [[refresh-token-rotacao]] e [[autenticacao-jwt]]. Códigos e mapeamento HTTP em [[erros-api]] e [[sintese-contrato-erros-http]].

Armadilha de diagnóstico: **atlas inexistente ou soft-deletado retorna 404; atlas existente sem acesso retorna 403** (`src/middleware/permissions.js:73-74` e `:111-112`). Não trate 404 como "sem permissão".

## Resolução de permissão

O gate é `requireAtlasPermission(nivel)` (`src/middleware/permissions.js:57`). Hierarquia numérica em `permissions.js:12-18`:

```
read(1) < comment(2) < write(3) < manage(4) < owner(5)
```

Ordem de resolução (`resolvePermission`, `permissions.js:30-48`): dono do atlas → linha em `atlas_shares` → `is_public` vale `read` → senão `null` (403).

Três coisas que quebram implementações ingênuas:

1. **`manage` está ACIMA de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor em silêncio. Compare por nível, nunca por igualdade. Ver [[permissoes-atlas]] e [[permissoes-atlas]].
2. **Admin global tem bypass total.** `permissions.js:82-87`: `req.user.role === 'admin'` recebe `atlasPermission = 'owner'` em qualquer atlas, antes mesmo de consultar shares. Ver [[gestao-usuarios]] e [[auditoria]].
3. **Token público pula o lookup de share.** O `sub` de um token público é `public-<uuid>`, que não casa o `UUID_RE`, então a consulta a `atlas_shares` é ignorada (`permissions.js:92`) e a permissão cai em `is_public → read`.

O middleware deposita `req.atlasPermission`, `req.atlasId` e `req.atlasOwnerId` para o controller. `transferOwnership` depende disso: rebaixa `req.atlasOwnerId`, não `req.user.id`, justamente porque um admin global pode estar agindo sobre atlas alheio (`atlas.controller.js:76-78`).

## PUT /atlas/:atlasId — o COALESCE que impede apagar campos

`UPDATE_ATLAS` (`src/modules/atlas/atlas.queries.js:28-37`) usa `COALESCE($2, name)`, `COALESCE($3, description)`, `COALESCE($4::uuid[], map_order)`. O service converte campo ausente em `null` (`atlas.service.js:52-57`). Consequência prática: **é impossível limpar `description` para `null` via PUT**, enviar `description: null` é indistinguível de não enviar. Se precisar "apagar", envie string vazia.

Todo PUT incrementa `version` e atualiza `updated_at`. A resposta é o atlas completo, não um diff.

## PATCH /settings — merge é RASO

`UPDATE_ATLAS_SETTINGS` faz `settings = settings || $2::jsonb` (`atlas.queries.js:69-76`). O operador `||` do JSONB mescla **apenas o primeiro nível**: enviar `{ "features": { "map_3d": false } }` substitui o objeto `features` inteiro, zerando `panoramic_images`, `terrain_3d`, `data_layers` e `analysis_layers`.

> **Nota histórica.** guia *02-atlas-basico* (absorvido):291-300` mostra exatamente esse payload parcial e afirma "PATCH permite atualização parcial - apenas os campos enviados serão alterados". O código em `src/modules/atlas/atlas.queries.js:71` faz merge raso via `||`, então um `features` parcial descarta as demais flags.

O frontend já contorna isso: `src/js/modals/atlas-settings.modal.js:348-350` envia sempre o objeto `features` completo. Qualquer cliente novo deve fazer o mesmo (ler o settings atual, mesclar em memória, mandar o bloco inteiro). Detalhes de forma e validação em [[atlas-settings]].

A validação Joi (`atlas.schemas.js:19-48`) rejeita `min_zoom > max_zoom` e `default_basemap` fora de `basemaps`. O default do banco (`src/database/migrations/002_atlas.sql:19-36`) já traz as cinco flags de `features` como `true` e as listas de disponibilidade vazias, onde **lista vazia significa "sem restrição"**, não "nada permitido".

> **Nota histórica.** guia *02-atlas-basico* (absorvido):110-113` e a tabela de settings listam só três flags de `features` (`map_3d`, `panoramic_images`, `terrain_3d`). O schema em `src/modules/atlas/atlas.schemas.js:20-26` e o default em `002_atlas.sql:20-26` incluem também `data_layers` e `analysis_layers`.

## DELETE, lixeira e restore

`DELETE` é soft: marca `deleted_at`, incrementa `version` (`atlas.queries.js:39-46`) e o controller fecha a sala colaborativa com `atlas_deleted` (`atlas.controller.js:29`), o que derruba os pares conectados ([[canal-collab-websocket]]). Mapas, feições e briefings permanecem no banco, não há cascade.

`POST /:atlasId/restore` **não** usa `requireAtlasPermission` (`atlas.routes.js:29-31`) por um motivo concreto: o middleware só enxerga atlas com `deleted_at IS NULL`, então gatearia tudo em 404. A checagem de posse é feita atomicamente na própria query `RESTORE_ATLAS`, escopada a `(id, owner_id, deleted_at IS NOT NULL)` (`atlas.queries.js:60-67`); zero linhas vira 404. Não replique esse padrão em rotas de atlas vivo.

## Compartilhamento

Todas as rotas de `/sharing` exigem `manage`, não `owner` (`src/modules/sharing/sharing.routes.js:15-20`). O enum concedível é `read|comment|write|manage`; `owner` **não é concedível** (`sharing.schemas.js:6`), pois vem de `atlas.owner_id` e só muda pela rota de transferência.

Pontos de atenção:

- `POST /sharing/users` é **upsert**: `ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission` (`sharing.queries.js:26-31`). Reenviar para um usuário já compartilhado altera a permissão e ainda responde **201**, não 200 nem 409.
- `GET /sharing` retorna `{ isPublic, publicLink, owner, shares }`. O campo `owner` (`{ userId, username, nome }`) existe no código (`sharing.service.js:15-19`) e está **ausente** do exemplo do guia.
- Remover o dono é no-op: o dono não tem linha em `atlas_shares`, então `DELETE /sharing/users/:userId` sobre ele retorna 404 `Share`.
- Toda mutação de sharing faz broadcast `sharing_updated` na sala, carregando `role` já traduzido para o vocabulário de front (`sharing.controller.js:38`, `:57`), para o par conectado re-gatear a UI ao vivo sem reconectar. Ver [[canal-collab-websocket]] e [[sintese-capacidades-por-papel]].

> **Nota histórica.** guia *07-compartilhamento* (absorvido):32-53` documenta o retorno de `GET /sharing` sem a chave `owner`; `src/modules/sharing/sharing.service.js:15-19` a inclui.

## Transferência de posse

`POST /:atlasId/transfer` (owner-only) exige que o novo dono **já seja membro ativo** do atlas: a query junta `atlas_shares` com `users.is_active = true` (`atlas.service.js:511-519`). O motivo é evitar entregar um atlas a conta desativada, que não poderia mais deletá-lo nem transferi-lo, deixando o projeto órfão. Numa transação: troca `owner_id`, remove a linha de share do novo dono e rebaixa o ex-dono a `manage` (`atlas.service.js:521-540`). Auto-transferência retorna 400.

## Clone e duplicate

`cloneAtlas` (`atlas.service.js:270`) e `duplicateMap` (`atlas.service.js:401`) compartilham `cloneMapSubEntities` (`atlas.service.js:166`), que copia layers, groups (dois passes por causa de `parent_id`), features com `layer_id` remapeado, `group_features`, cesium3d e streetview360.

O clone **não** copia `is_public`/`public_link` (o INSERT simplesmente os omite, `atlas.service.js:283-292`), nem shares, nem histórico de operações. O nome default é `"<nome> (cópia)"`, não `"Cópia de <nome>"`.

Armadilha real: o INSERT de `maps` no clone e no duplicate (`atlas.service.js:306-307` e `:416-417`) **não inclui `grid_style` nem `temporal_config`**, colunas que o import preserva (`atlas.service.js:586`). Configuração de grade e do [[modulo-temporal]] por mapa se perde ao clonar ou duplicar.

## Acesso público

`GET /atlas/public/:link` é a única rota da família sem `auth`, protegida por `publicLinkLimiter` (`atlas.routes.js:23`, `src/middleware/rate-limit.js:39-47`) porque o link é enumerável. O link é 16 bytes hex (`atlas.service.js:453-455`) e a busca exige `is_public = true AND deleted_at IS NULL` (`atlas.queries.js:78-83`), logo desativar o link invalida o acesso na hora.

A resposta anexa um `publicToken`: JWT de 1 hora com `sub: public-<uuid>`, `atlasId`, `isPublic: true`, `permission: 'read'`, `nome: 'Visitante'` (`atlas.service.js:143-154`). Ele serve tanto para REST quanto para o WebSocket. Como expira em 1h sem refresh, o cliente precisa reobter o token pelo mesmo endpoint. Ver [[link-publico]] e [[hardening-borda-api]].

## Efeitos colaterais em tempo real

Vários endpoints REST empurram mensagem para a sala do WebSocket, e é por isso que "REST só de metadados" não significa "REST sem efeito colaborativo":

| Endpoint | Mensagem | Origem |
|---|---|---|
| `PUT /:atlasId` | `atlas_updated` | `atlas.controller.js:23` |
| `DELETE /:atlasId` | `atlas_deleted` (fecha a sala) | `atlas.controller.js:29` |
| `PATCH /:atlasId/settings` | `atlas_settings_updated` | `atlas.controller.js:50` |
| `POST /:atlasId/transfer` | `atlas_owner_changed` | `atlas.controller.js:81` |
| `POST /:atlasId/maps/:mapId/duplicate` | `map_duplicated` | `atlas.controller.js:71` |
| `/sharing/*` | `sharing_updated` | `sharing.controller.js:14,20,31,49,64` |

Ver [[sintese-rest-vs-websocket]] e [[presenca-colaborativa]].

## Import de atlas local

`POST /atlas/import` recebe `{ atlas, maps, briefings }` validado por `importSchema` (`atlas.schemas.js:183-191`) e **preserva os UUIDs de entidade enviados pelo cliente**, enquanto o atlas ganha id novo do servidor (`atlas.service.js:551`). É o caminho de "salvar atlas local no servidor", ligado ao marcador de origem descrito em [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]]. O enum de `feature_type` aceito precisa acompanhar o do frontend e o CHECK do banco (`atlas.schemas.js:73-83`). Cobertura de round-trip em [[formato-ebgeo-roundtrip]] e [[atlas-import-offline]].


## Shapes de request e response

## Shapes de request e response

As rotas de atlas devolvem **snake_case cru do Postgres** (`SELECT a.*`), ao contrário do sub-router de sharing, que devolve camelCase (`isPublic`, `publicLink`). Não compartilhe desserializador entre os dois.

### `GET /atlas` — listagem

`Authorization: Bearer <accessToken>`. Resposta 200:

```json
{
  "data": [
    {
      "id": "atlas-uuid-1",
      "name": "Operação Alfa",
      "description": "Atlas da operação",
      "owner_id": "user-uuid",
      "is_public": false,
      "public_link": null,
      "settings": { "features": { "map_3d": true } },
      "map_order": [],
      "version": 1,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z",
      "owner_nome": "João da Silva",
      "owner_username": "joao",
      "user_permission": "owner"
    }
  ]
}
```

Três detalhes do contrato que o exemplo do guia não mostra (`LIST_USER_ATLAS`, `atlas.queries.js:14-26`):

| Campo / comportamento | Valor |
|---|---|
| `user_permission` | `owner` (sintetizado de `owner_id`) ou o tier de `atlas_shares` (`read`/`comment`/`write`/`manage`) |
| `owner_nome`, `owner_username` | vêm do `JOIN users`, existem só na listagem e na lixeira — **não** no `GET /atlas/:atlasId` |
| Ordenação | `ORDER BY a.updated_at DESC`, não por nome |

A listagem é `a.*`: traz `settings`, `map_order`, `version`, `min_version` e `current_version` inteiros, não a projeção de 7 campos do exemplo. E o `WHERE` só casa `owner_id = $1 OR s.user_id = $1`: **um atlas público ao qual você não foi convidado nunca aparece aqui**, mesmo sendo legível — ele só chega por [[link-publico]].

### `POST /atlas` — criação

Request:

```json
{ "name": "Operação Beta", "description": "Descrição opcional" }
```

Resposta 201 com o atlas completo. O `INSERT` grava apenas `name`, `description`, `owner_id` (`atlas.queries.js:3-7`); todo o resto é default do schema — `is_public: false`, `public_link: null`, `map_order: []`, `version: 1` e o objeto `settings` default de `002_atlas.sql` (ver [[atlas-settings]]; lembre que `data_layers` e `analysis_layers` também estão lá, apesar de ausentes do exemplo do guia).

### `GET /atlas/:atlasId` — leitura

Além das colunas da linha `atlas`, a resposta **sempre** carrega um array `maps` com o resumo dos mapas não deletados (`GET_ATLAS_MAPS_SUMMARY`, `atlas.queries.js:95-100`):

```json
{
  "data": {
    "id": "atlas-uuid",
    "map_order": ["map-uuid-1", "map-uuid-2"],
    "version": 42,
    "maps": [
      {
        "id": "map-uuid-1",
        "name": "Mapa 1",
        "created_at": "2024-01-15T10:30:00.000Z",
        "updated_at": "2024-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

O resumo tem exatamente esses quatro campos — sem viewport, sem `locked`, sem `base_layer`. Vem `ORDER BY created_at`, **não** na ordem de `map_order`: quem exibe a lista de mapas precisa ordenar pelo `map_order` no cliente.

### `PUT /atlas/:atlasId` — atualização

Todos os campos são opcionais; envie só o que muda.

```json
{
  "name": "Operação Alfa - Atualizado",
  "description": "Nova descrição",
  "map_order": ["map-uuid-2", "map-uuid-1"]
}
```

A resposta é o **atlas completo** (com `version` já incrementada), não um diff nem só os campos enviados. Cuidado com a assimetria do service (`atlas.service.js:52-57`): `name` usa `data.name || null`, então `name: ""` vira `null` e o `COALESCE` **preserva o nome antigo em silêncio**; `description` usa `!== undefined`, então string vazia realmente limpa o campo.

### `DELETE /atlas/:atlasId`

`204 No Content`, sem corpo. O cliente precisa tolerar corpo vazio (`api-client.js:225` devolve `null`).


## POST /:atlasId/maps/:mapId/merge — contrato completo

## POST /:atlasId/maps/:mapId/merge — contrato completo

Exceção estrutural à regra "conteúdo de atlas só muda por sync" (ver [[sintese-rest-vs-sync]]). Move, **numa única transação**, as sub-entidades de um ou mais mapas de origem para o mapa de destino. Os mapas de origem **não são deletados**, apenas esvaziados. `:mapId` é o mapa de **destino**.

| | |
|---|---|
| Rota | `POST /api/v1/atlas/:atlasId/maps/:mapId/merge` |
| Permissão | `write` |
| Header | `Authorization: Bearer <accessToken>` |
| Fonte | `src/modules/maps/{maps.routes.js:17, maps.controller.js, maps.service.js}` |

### Request

```json
{ "sourceMapIds": ["map-origem-1", "map-origem-2"] }
```

- `sourceMapIds`: array de UUIDs, `.min(1)`, obrigatório.
- Destino e origens devem pertencer ao **mesmo atlas**; origem de outro atlas devolve **404** (guarda anti-IDOR, sem vazar existência).
- O próprio `:mapId` de destino é filtrado da lista de origens automaticamente — mandá-lo junto não é erro.

### Response (200)

```json
{
  "data": {
    "destMapId": "map-destino",
    "sourceMapIds": ["map-origem-1", "map-origem-2"],
    "moved": {
      "features": 12,
      "groups": 3,
      "layers": 2,
      "cesium3d_data": 1,
      "streetview360_data": 0,
      "catalog_layers": 4
    }
  }
}
```

`moved` traz a contagem de linhas movidas **por tabela filha**. As seis tabelas vêm de uma whitelist literal no código, nunca de input — adicionar uma tabela filha nova ao schema exige acrescentá-la ali, senão o conteúdo dela fica órfão no mapa de origem após o merge.

### Erros

| Status | Quando |
|---|---|
| `422` | `sourceMapIds` ausente, vazio ou com item não-UUID |
| `404` | Mapa de destino inexistente, ou alguma origem inexistente / fora do atlas |
| `403` | Sem permissão `write` |

### Broadcast e convergência dos pares

Após o COMMIT o servidor faz `broadcastToRoom` na sala do atlas:

```json
{ "type": "maps_merged", "destMapId": "map-destino", "sourceMapIds": ["map-origem-1", "map-origem-2"] }
```

O merge **não passa pela tabela `operations` e não incrementa `current_version`**, então pull incremental jamais o enxerga. O cliente mapeia `maps_merged` para `serverResync` → `pullSync(atlasId, 0)`, ou seja, snapshot completo. Quem estiver offline no momento do merge só converge no próximo snapshot. Ver [[sintese-rest-vs-sync]] e [[snapshot-e-pull-incremental]].


## Atlas Drive: ação de UI, rota REST e permissão

## Atlas Drive: ação de UI, rota REST e permissão

O seletor de projetos (`src/js/modals/project-picker.modal.js`, classe `AtlasDrive`) é a única superfície de UI que consome quase toda esta família de rotas. Ele é uma tela cheia, mas **preserva deliberadamente o contrato antigo do modal** (nome do arquivo, export `showProjectPickerModal`, testids e a API `onPick`/`onCreate`), para não quebrar os testes e2e existentes (`project-picker.modal.js:5-7`, `:65-71`).

### Abas e o predicado de cada uma

As abas são filtros client-side sobre a **mesma** resposta de `GET /atlas`, exceto a Lixeira, que tem endpoint próprio e carrega sob demanda na primeira abertura (`project-picker.modal.js:35-39`, `:221-237`, `:246-251`):

| Aba | Predicado | Origem dos dados |
|---|---|---|
| Recentes (default) | ordena por `updated_at` desc | `GET /atlas` |
| Meus | `user_permission === 'owner'` | `GET /atlas` |
| Compartilhados comigo | `user_permission` presente e `!== 'owner'` | `GET /atlas` |
| Públicos | `is_public === true` | `GET /atlas` |
| Lixeira | lista separada, só do dono | `GET /atlas/trash` (lazy, uma vez) |

O campo que sustenta três dos cinco filtros é o `user_permission` de `LIST_USER_ATLAS` (ver [[compartilhamento-atlas]]). A busca por nome é client-side e vale **em todas** as abas, inclusive a Lixeira (`project-picker.modal.js:268-269`).

### Ações do card e a rota que cada uma dispara

| Ação (menu ⋯) | Rota | Gate no cliente | Gate real no servidor |
|---|---|---|---|
| Abrir | fluxo `onPick` (connect) | nenhum | `read` |
| Renomear | `PUT /atlas/:id` | `user_permission ∈ {owner, write}` | `write` |
| Fazer uma cópia | `POST /atlas/:id/clone` | nenhum (aparece sempre) | `read` |
| Mover para a lixeira | `DELETE /atlas/:id` | `user_permission === 'owner'` | `owner` |
| Restaurar (card da Lixeira) | `POST /atlas/:id/restore` | só a Lixeira lista | posse checada na query |
| Novo projeto | `POST /atlas` via `onCreate` | nenhum | autenticado |

O nome default da cópia é montado **no cliente** como `"<nome> (cópia)"` (`project-picker.modal.js:446`), coincidindo com o default do servidor; ver [[clone-atlas]].

> **Nota histórica.** O gate de Renomear no Drive é `perm === 'owner' || perm === 'write'` (`src/js/modals/project-picker.modal.js:369-370`), exatamente a armadilha registrada nesta página e em [[permissoes-atlas]]: `manage` está **acima** de `write` e não bate em nenhum dos dois, então um co-Gestor não enxerga "Renomear" no card, embora o backend aceite o `PUT` dele (`atlas.routes.js:27`). guia *ui-ux-ebgeo* (absorvido) §2 descreve a ação como "gated por papel (renomear = Editor+)", que é a intenção, não o efeito.

### Testids congelados

São contrato de teste, não detalhe de implementação. Renomear qualquer um destes quebra os specs de e2e:

```
project-picker-modal      project-picker-list       project-picker-item
project-picker-search     project-picker-create     project-picker-cancel
project-picker-empty      project-picker-menu       project-picker-menu-popup
project-picker-rename     project-picker-duplicate  project-picker-trash
project-picker-trash-item project-picker-restore    project-picker-tab-<key>
```

`<key>` é uma das cinco chaves de aba (`recentes`, `meus`, `compartilhados`, `publicos`, `lixeira`).

Decisão de escopo correlata: **não há thumbnail nem snapshot do mapa** nos cards, a identidade visual é uma faixa colorida com iniciais, derivada de forma determinística do nome (ver [[sintese-decisoes-arquiteturais]]). Quando o Drive abre no boot e o que acontece com dado remoto órfão está em [[sessao-boot-e-ciclo-de-vida]].

## Fontes

- guia *02-atlas-basico* (absorvido): CRUD documentado, exemplos de payload/resposta, matriz de permissões, formato de erro, nota sobre `manage` acima de `write`, escopo do clone.
- guia *07-compartilhamento* (absorvido): rotas de sharing, enum de permissões concedíveis, fluxo de link público, forma e limitações do `publicToken`.
- `ebgeo_backend/src/modules/atlas/atlas.routes.js`: lista real de rotas e permissão mínima por rota.
- `ebgeo_backend/src/modules/atlas/atlas.controller.js`: códigos de status e broadcasts para a sala colaborativa.
- `ebgeo_backend/src/modules/atlas/atlas.service.js`: regras de update, restore, clone, transferência e import.
- `ebgeo_backend/src/modules/atlas/atlas.queries.js`: semântica de COALESCE no PUT e merge raso no PATCH de settings.
- `ebgeo_backend/src/modules/atlas/atlas.schemas.js`: validação Joi de create/update/settings/clone/transfer/import.
- `ebgeo_backend/src/modules/sharing/*`: rotas, upsert de share, forma do `GET /sharing`.
- `ebgeo_backend/src/middleware/permissions.js`: hierarquia, resolução, bypass de admin, tratamento de token público.
- `ebgeo_backend/src/database/migrations/002_atlas.sql`: default de `settings`.
- `ebgeo_web/src/js/store/sync/api-client.js`: desembrulho do envelope, refresh+retry em 401.
- `ebgeo_web/src/js/modals/atlas-settings.modal.js`: cliente envia `features` completo para contornar o merge raso.

# Atlas

Container de projeto no topo do modelo (mapas, briefings, settings, contadores de versão), dono via `owner_id`, compartilhado por `atlas_shares` e publicável por link, é também a unidade de isolamento do sync e da sala WebSocket.

## Por que o Atlas é a fronteira de tudo

Quase todo limite do sistema é desenhado por `atlas_id`:

- **Isolamento de dados:** toda tabela de entidade pendura em `atlas` por FK (`maps.atlas_id`, e as demais via `map_id`), e `operations.atlas_id` tem `ON DELETE CASCADE` (`ebgeo_backend/src/database/migrations/003_sync.sql:16`).
- **Isolamento de permissão:** `requireAtlasPermission(level)` resolve o nível a partir de `atlas.owner_id`, de `atlas_shares` e de `atlas.is_public` (`src/middleware/permissions.js:57`). Ver [[permissoes-atlas]].
- **Isolamento de tempo real:** a sala WebSocket é literalmente `Map<atlasId, Set<WebSocket>>` (`src/modules/collab/collab.rooms.js:6`). Não existe broadcast entre atlas. Ver [[canal-collab-websocket]] e [[websocket-collab]].
- **Isolamento de ordenação:** o índice de idempotência é `(atlas_id, op_id)` e a ordem do LWW é `server_version` (`003_sync.sql:52`). Ver [[modelo-conflito-lww]] e [[tabela-operations]].
- **Isolamento no cliente:** o IndexedDB **não** é namespaced por atlas. Existe um único workspace local, e o que diz "de quem são estes dados" é o marcador de origem. Ver [[store-origin-local-remoto]] e [[dominio-local-vs-remoto]].

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

Esta é a armadilha número um do modelo.

- **`version`** conta edições de metadados via REST (nome, descrição, `map_order`, settings). Não tem relação com sync.
- **`current_version`** é o cursor do log de operações, mantido pelo trigger `trg_update_atlas_version` no INSERT em `operations` (`003_sync.sql:66`). É o que o cliente guarda como `lastVersion` para o pull incremental.
- **`min_version`** é o piso após poda do log (`sync.service.js:810`, ver [[sync-admin-operacoes]]). Pedir `GET /atlas/:id/sync/:v` com `v < min_version` força snapshot completo em vez de erro (`sync.service.js:767`). Ver [[snapshot-e-pull-incremental]].

`server_version` vem de `nextval('atlas_version_seq')`, uma sequência **global** compartilhada por todos os atlas (`003_sync.sql:12,31`). Dentro de um atlas ela é crescente mas **não contígua**. Use apenas para ordenar, nunca para contar operações nem para calcular "quantas versões atrás".

> [!CONTRADICAO 2026-07-18] `docs/arquitetura-sync.md` §8.1 diz que o trigger mantém `atlas.current_version = MAX(server_version)`; o código em `ebgeo_backend/src/database/migrations/003_sync.sql:59` faz `SET current_version = NEW.server_version` sem `GREATEST`, ou seja, atribuição direta pelo último INSERT, não máximo. Na prática coincide (a sequência é crescente e o push é uma transação), mas não confie nisso para raciocinar sobre inserções concorrentes no mesmo atlas.

## Rotas REST

O Atlas é uma das poucas entidades com CRUD REST de verdade. Mapas, camadas, feições, grupos, briefings e slides **não têm rota de escrita**, viajam como operação de sync (ver [[sintese-rest-vs-sync]] e [[envelope-operacao]]). Rotas em `src/modules/atlas/atlas.routes.js`:

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

Sub-routers montados sob o atlas: `sharing`, `images`, `sync`, `maps`, `briefings` (`:47`). Detalhe dos contratos em [[api-rest-atlas]] e formato de erro em [[erros-api]].

> [!CONTRADICAO 2026-07-18] `docs/guias/02-atlas-basico.md` documenta apenas listar/criar/obter/atualizar/deletar/settings/clone; o código em `ebgeo_backend/src/modules/atlas/atlas.routes.js:22,25,31,38,44` expõe também `import`, `trash`, `restore`, `transfer` e `maps/:mapId/duplicate`. Ver [[atlas-import-offline]].

### Deleção é soft, e não cascateia de fato

`DELETE` marca `deleted_at` e incrementa `version` (`atlas.service.js:69`). As FKs dizem `ON DELETE CASCADE`, mas como não há hard-delete, **mapas, feições, briefings e o log de `operations` permanecem no banco**. O atlas some das listagens, a sala é fechada com `atlas_deleted`, e `GET /atlas/trash` + `POST /:id/restore` trazem tudo de volta intacto. Não escreva código assumindo que deletar um atlas liberou espaço ou apagou dados de usuário.

## Dois objetos chamados "atlas.settings"

Não confunda:

- **Servidor:** `atlas.settings` é a **disponibilidade de recursos** (`features.map_3d`, `basemaps`, `bounds_2d`, `available_3d_models`, ...). É restrição, aplicada como overlay client-side por `src/js/store/sync/atlas-settings.service.js` (`intersectAvailability`, `:73`) por cima do config vindo de `GET /api/config`. Ver [[atlas-settings]] e [[config-dinamico]].
- **Cliente local:** a entidade Atlas do frontend tem `settings: { terrainExaggeration }` e mais nada (`src/js/store/atlas/atlas.entity.js:46`). São shapes diferentes com o mesmo nome de campo.

Operações de sync do tipo `setting` fazem merge whitelisted em `atlas.settings`, e as chaves de disponibilidade **nunca** são aceitas por esse caminho: só `PATCH /settings` com `manage` muda restrição.

## O Atlas do lado do cliente

`src/js/store/atlas/atlas.entity.js` define o Atlas local: `{ id, name, sync, schemaVersion, mapOrder, lastActiveMapId, settings }`, com `ATLAS_SCHEMA_VERSION = '2.2'` (`:12`). Persiste como um único registro `current_atlas` no `atlasStore` (`repositories/local.repository.js:91,100`), portanto **existe no máximo um Atlas materializado no navegador por vez**.

Consequências que causam bug se ignoradas:

1. **Atlas nomeados são conceito de servidor.** Localmente há um workspace só (mapa `Principal` + arquivo `.ebgeo`). Ver [[formato-ebgeo-roundtrip]].
2. **Abrir um atlas do servidor apaga o store.** `open-atlas.service.js` faz `clearAllDataStore()` → `markStoreRemote(atlasId)` → `syncEngine.connect(atlasId, { initialPull: true })` → `startAutoFlush()` (`src/js/account/open-atlas.service.js:59,62,64,79`). Trocar de atlas é destrutivo por design.
3. **Dados de atlas remoto não sobrevivem a logout.** A guarda de boot `enforceLocalStoreWhenLoggedOut()` (`src/js/store/store.js:137`) descarta tudo se a origem é `remote` e ninguém está autenticado. Para levar um atlas remoto para offline, baixe o `.ebgeo`. Ver [[sessao-boot-e-ciclo-de-vida]].
4. **`clearAllDataStore` limpa o registro do atlas e a fila de operações** (`store.js:212`), justamente para settings remotos e ops não-flushadas não vazarem para o próximo atlas. Ver [[fila-operacoes-outbound]].

> [!CONTRADICAO 2026-07-18] `docs/arquitetura-sync.md` §14 lista `store-origin.js` no mapa de arquivos de `src/js/store/sync/`; o arquivo real é `src/js/store/store-origin.js` (fora de `sync/`).

## Permissões, sem pegadinha

Hierarquia `read < comment < write < manage < owner` (`permissions.js:12`). Resolução em `resolvePermission` (`:30`): dono → share → público → `null` (403). Atlas inexistente ou soft-deletado dá 404, não 403.

Três armadilhas:

- **`owner` não é compartilhável.** O CHECK de `atlas_shares.permission` só aceita `read|comment|write|manage` (`002_atlas.sql:63`). Posse muda apenas por `POST /:id/transfer`.
- **`manage` está acima de `write`.** Um gate escrito como `permission === 'write' || permission === 'owner'` exclui o co-Gestor silenciosamente. Sempre compare por nível numérico.
- **Admin global é owner em todo atlas.** `req.user.role === 'admin'` faz short-circuit antes de olhar shares (`permissions.js:82`). Ver [[gestao-usuarios]] e [[permissao-vs-papel]].

Papel de acesso do atlas e papel de identidade do frontend são vocabulários distintos: ver [[sintese-capacidades-por-papel]] e [[autenticacao-jwt]].

> [!CONTRADICAO 2026-07-18] `docs/guias/07-compartilhamento.md` §5.2 monta o modal lendo `data.data.is_public` / `data.data.public_link` / `share.user_id`; o service em `ebgeo_backend/src/modules/sharing/sharing.service.js:13` devolve camelCase (`isPublic`, `publicLink`), que é o que o cliente real consome em `src/js/modals/sharing.modal.js:179`. O mesmo exemplo do doc oferece só `read`/`write` no seletor, omitindo `comment` e `manage`.

## Compartilhamento e link público

`atlas_shares` é a tabela de membership, com `UNIQUE(atlas_id, user_id)` (`002_atlas.sql:67`). Gerência exige `manage`. Ver [[compartilhamento-atlas]].

O link público (`POST/DELETE /:id/sharing/public`) liga `is_public` e gera `public_link`. `GET /atlas/public/:link` não pede auth e devolve um JWT efêmero (1h, `permission: 'read'`, identidade "Visitante") que serve tanto para pull quanto para o WebSocket. No cliente, `connectPublic()` conecta com **logging de operações desabilitado**, então o visitante recebe tempo real e presença mas nunca enfileira op. Ver [[link-publico]].

## Ciclo de vida de uma sessão de atlas

1. `GET /atlas/:id/sync/0` → snapshot completo, reconstruído **das tabelas de entidade**, não por replay do log (`sync.service.js:440`). Ver [[snapshot-e-pull-incremental]].
2. `applyRemoteSnapshot` grava no IndexedDB no mesmo shape do store (contrato congelado). Ver [[aplicacao-operacoes-remotas]].
3. WS `/api/v1/collab?atlasId=...&token=...&clientId=...`; o `connected` traz `permission`, `role` e o roster. Ver [[presenca-colaborativa]].
4. Mutações viram operações enfileiradas e empurradas por `POST /atlas/:id/sync`. Ver [[tipos-entidade-sync]] e [[sync-lww-operacoes]].
5. Reconexão manda `sync_request(lastVersion)`; pull incremental a partir de `current_version`.

Eventos que mudam o atlas **fora** do log de operações (`atlas_updated`, `map_duplicated`, `maps_merged`) forçam **re-pull de snapshot**, não apply de op. `atlas_deleted`, `atlas_owner_changed` e `atlas_settings_updated` têm handlers dedicados. Se você adicionar uma mutação REST no atlas, precisa decidir explicitamente em qual desses dois mundos ela cai.

Imagens são o outro caminho fora do log: blobs por REST sob `/atlas/:id/images`, com a referência viajando pelo sync. Ver [[imagens-atlas]].

## Guardas anti-IDOR que dependem do atlas

- `applyOperation` faz `INSERT ... SELECT ... WHERE EXISTS (mapa pertence a ESTE atlas)`, então uma op com `mapId` de outro atlas não escreve nada em vez de escrever no lugar errado.
- O merge de mapas exige que destino e origens estejam no mesmo atlas, senão 404.
- O upgrade do WS valida `atlasId`, `token` e o formato de `clientId` (`^[a-zA-Z0-9_-]{8,64}$`), e **re-reconcilia a autorização a cada heartbeat**: share revogado ou atlas despublicado fecha o socket com código `4003`. Ver [[client-id-estavel]].

Para depurar convergência por atlas com correlação ponta a ponta, ver [[syncledger]] e [[idempotencia-e-convergence-guard]].

## Fontes

- `docs/guias/02-atlas-basico.md`: CRUD REST, shape de `settings`, matriz de permissões, escopo do clone, formato de erro.
- `docs/guias/07-compartilhamento.md`: `atlas_shares`, endpoints de sharing, link público e o `publicToken` de 1h read-only.
- `docs/guias/03-sync-inicial.md`: pull híbrido, shape do snapshot, papel de `min_version`.
- `docs/guias/05-sync-crdt.md`: push/pull por atlas, `serverVersion`, merge de mapas restrito ao mesmo atlas, rotas admin de sync.
- `docs/arquitetura-sync.md`: contadores de versão, sala WS por atlas, marcador de origem local/remoto, comportamentos por design.
- Código conferido: `ebgeo_backend/src/database/migrations/002_atlas.sql` e `003_sync.sql` (schema, trigger, sequência), `src/modules/atlas/atlas.routes.js` e `atlas.service.js` (rotas reais, soft-delete, trash/restore, clone), `src/middleware/permissions.js` (resolução e bypass de admin), `src/modules/collab/collab.rooms.js` (sala por atlasId), `src/modules/sharing/sharing.service.js` (camelCase da resposta); `ebgeo_web/src/js/store/atlas/atlas.entity.js`, `src/js/store/store-origin.js`, `src/js/store/store.js`, `src/js/store/repositories/local.repository.js`, `src/js/account/open-atlas.service.js`, `src/js/store/sync/atlas-settings.service.js`, `src/js/store/sync/api-client.js`.

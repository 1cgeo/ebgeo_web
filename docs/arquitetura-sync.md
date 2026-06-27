# EBGeo — Sincronização Multiusuário em Tempo Real: Arquitetura Ponta a Ponta

> **Escopo:** `ebgeo_web` (cliente, `src/js/store/sync/`) + `ebgeo_backend` (Express + PostgreSQL + `ws`).
> **Status:** sistema **implementado e em produção**. Este documento descreve **como o sync funciona hoje**, do gesto do usuário até a convergência nos peers.
> **Histórico:** este arquivo antes continha a *proposta* da camada de observabilidade (SyncLedger). O SyncLedger foi implementado e agora é a **§12** deste documento; o restante foi reescrito como referência de arquitetura do sync.
>
> Documentos irmãos: princípios e modelo operacional em [`docs/visao-e-principios.md`](./visao-e-principios.md); mapa de ações multiusuário por gesto em [`docs/acoes-interface-multiusuario.md`](./acoes-interface-multiusuario.md); resumo arquitetural em [`.claude/rules/architecture.md`](../.claude/rules/architecture.md) §Sync.

---

## Índice

1. [Visão geral e princípios](#1-visão-geral-e-princípios)
2. [Modelo mental em uma página](#2-modelo-mental-em-uma-página)
3. [O envelope de operação (a unidade de sincronização)](#3-o-envelope-de-operação-a-unidade-de-sincronização)
4. [Transporte: REST + WebSocket](#4-transporte-rest--websocket)
5. [Fluxo OUTBOUND (mutação local → servidor → peers)](#5-fluxo-outbound-mutação-local--servidor--peers)
6. [Fluxo INBOUND (servidor → store local → UI)](#6-fluxo-inbound-servidor--store-local--ui)
7. [Snapshot, pull incremental, boot e restore](#7-snapshot-pull-incremental-boot-e-restore)
8. [Persistência no backend e modelo de dados](#8-persistência-no-backend-e-modelo-de-dados)
9. [Identidade, sessão, conexão e papéis](#9-identidade-sessão-conexão-e-papéis)
10. [Presença e colaboração em tempo real](#10-presença-e-colaboração-em-tempo-real)
11. [Modelo de conflito: LWW, idempotência e guardas de convergência](#11-modelo-de-conflito-lww-idempotência-e-guardas-de-convergência)
12. [Observabilidade: o SyncLedger](#12-observabilidade-o-syncledger)
13. [Comportamentos por design (não são bugs)](#13-comportamentos-por-design-não-são-bugs)
14. [Mapa de arquivos para referência rápida](#14-mapa-de-arquivos-para-referência-rápida)

---

## 1. Visão geral e princípios

O EBGeo roda **100% offline/anônimo por padrão**. Um **backend opcional** (`ebgeo_backend`) adiciona login, atlas hospedados no servidor, compartilhamento e **colaboração multiusuário em tempo real**. A camada `store/sync/` no cliente está **totalmente conectada** ao backend; quando ninguém faz login, ela permanece inerte e o app funciona localmente sobre IndexedDB + arquivos `.ebgeo`.

Princípios que governam o desenho (detalhe em `docs/visao-e-principios.md`):

- **Offline-first.** Toda mutação é **persistência-primeiro**: grava no IndexedDB local e *só depois* dispara efeitos (incluindo enfileirar a operação de sync). Se a persistência falha, nada de sync acontece.
- **Operações, não estado.** Mutações de entidade viajam como **operações CRDT** (`create`/`update`/`delete`), nunca como "salvar o documento inteiro". Não existe rota REST de escrita para feature/map/layer/group/briefing/slide — escrita em runtime é **sync-only**.
- **Conflito = LWW por ordem de chegada ao servidor.** O vencedor é a operação com o maior `serverVersion` (ordem de chegada), **não** por `timestamp` de parede nem por relógio Lamport. Idempotência por `op_id`.
- **Separação local↔remoto por marcador de origem**, não por namespacing de IndexedDB por atlas. Há **um** workspace local (mapa `Principal` + `.ebgeo`); atlas nomeados são um conceito de servidor. Dados de atlas remoto são apagados no logout/disconnect.
- **Resiliência de rede.** Fila durável no cliente, reconexão com backoff, replay por versão, heartbeat.

---

## 2. Modelo mental em uma página

```
  CLIENTE A (autor)                  SERVIDOR (ebgeo_backend)              CLIENTE B (peer)
  ─────────────────                  ──────────────────────               ────────────────
  gesto do usuário
   │ runTransaction (persiste no IndexedDB PRIMEIRO; minta traceId)
   ▼
  logXxxOperation ── operation-dispatcher
   │ createOperation (op.id, lamport, clientId, traceId)
   ▼
  operation-queue  (IndexedDB 'ebgeo/operation_queue', compaction)
   │ sync-flush (1.5s / por evento, só se ONLINE)
   ▼
  POST /api/v1/atlas/:id/sync  {operations:[...]} ───────►  sync.service.pushOperations (1 tx)
                                                              │ INSERT operations  ON CONFLICT(atlas_id,op_id) DO NOTHING
                                                              │   server_version := nextval(atlas_version_seq)   ◄── verdade do LWW
                                                              │ applyOperation → escreve nas tabelas de entidade
   ◄──── resposta {results, acks, serverVersion} ────────────┤   (recordPushAcks: autor registra sua própria versão aplicada)
                                                              │
                                                              └─ broadcast WS p/ a sala (stamp serverVersion) ──►  ws-client._onMessage
                                                                                                                   │ type:'operation'
  (o autor também recebe o broadcast via WS,                                                                       ▼
   mas descarta pelo self-echo: op.clientId === meu)                                                        sync-gateway (gate online)
                                                                                                                   ▼
                                                                                                          remote-operation-handler
                                                                                                           applyRemoteOperation
                                                                                                           │ LWW por serverVersion
                                                                                                           │ persiste no repo + emite
                                                                                                           ▼ FEATURE_*/LAYERS_CHANGED
                                                                                                          MapLibre re-renderiza a fonte
```

**Resumo do caminho feliz:** o autor **empurra por HTTP** (`POST .../sync`); o servidor **persiste**, atribui `serverVersion` e **transmite por WebSocket** para a sala; cada peer **aplica** a operação no store local e **emite** o evento de ciclo de vida, que redesenha o mapa. O autor recebe o `ack` na resposta HTTP (e descarta o eco do próprio op que volta pelo WS).

---

## 3. O envelope de operação (a unidade de sincronização)

Toda mutação sincronizável vira um **envelope de operação**, criado em `operation-factory.js → createOperation()` (`src/js/store/sync/operation-factory.js:140`):

```jsonc
{
  "id":               "<uuid>",            // chave de junção primária; sobrevive a todo o pipeline
  "entityType":       "feature",           // feature|layer|map|group|briefing|comment|marker3d|... (ver EntityType)
  "operationType":    "create",            // create | update | delete
  "entityId":         "<uuid>",
  "mapId":            "<uuid>|null",        // contexto de mapa (UUID quando remoto)
  "data":             { ... } | null,      // payload da entidade (null em delete)
  "previousData":     { ... } | null,      // estado anterior, p/ undo local
  "timestamp":        1700000000000,        // Date.now() — DISPLAY apenas, nunca ordena entre máquinas
  "lamportTimestamp": 42,                   // relógio lógico (causalidade); persistido mas NÃO decide vencedor
  "clientId":         "<uuid persistente>", // identidade do autor (localStorage 'ebgeo_client_id')
  "traceId":          "<uuid do gesto>|null"// correlação de observabilidade (best-effort)
}
```

Operações em lote acrescentam `batchId` + `batchIndex` (`createBatchOperations`, `operation-factory.js:172`).

Pontos cruciais:

- **`serverVersion` NÃO é campo do cliente.** É carimbado pelo servidor (`nextval('atlas_version_seq')`) e volta nos `ack`/broadcast/pull. É a **única** chave de ordenação correta.
- **`op.id`** é a âncora de tudo: faz round-trip `push → INSERT → broadcast → apply` intacto e é a chave do índice de idempotência `(atlas_id, op_id)` no Postgres.
- **`clientId`** é estável por navegador (`localStorage['ebgeo_client_id']`, `getClientId()` em `operation-factory.js:41`); serve para **dedupe de eco** e **presença**. Não é credencial.
- **`lamportTimestamp`** avança em `max(local, remoto)+1` (`advanceLamportClock`, `operation-factory.js:85`) a cada apply remoto; é gravado, mas o reducer de conflito nunca o usa para eleger vencedor.

**Tipos de entidade** (`operation-types.js`, `EntityType`): `atlas, map, feature, layer, group, marker3d, measurement3d, viewshed3d, cameraPosition3d, orientation360, marker360, mapPosition, baseLayer, mapNotes, gridStyle, mapTemporal, catalogLayer, briefing, slide, comment, setting`. O backend mapeia os subtipos para tabelas genéricas (`marker3d/measurement3d/viewshed3d/cameraPosition3d → cesium3d`; `orientation360/marker360 → streetview360`; `mapPosition/baseLayer/mapNotes/gridStyle/mapTemporal → map` subtype; `catalogLayer → catalog_layer`) via `ENTITY_TYPE_MAP`, e desfaz no pull com `REVERSE_ENTITY_TYPE_MAP`.

---

## 4. Transporte: REST + WebSocket

São **dois canais complementares**, orquestrados por `sync-engine.js`:

- **REST `/api/v1`** (`api-client.js`) — login/refresh/logout, CRUD de atlas, compartilhamento, busca de usuários, **push** e **pull** de operações, imagens, config. Respostas vêm no envelope `{ data: ... }`.
- **WebSocket `/api/v1/collab`** (`ws-client.js`) — broadcast em tempo real das operações, presença (cursores, seleções, away/back), temporal, edição de briefing, e sinais de "re-sincronize" (atlas atualizado, mapa duplicado).

### 4.1 REST — endpoints principais

Base padrão `/api/v1` (resolvida por `runtime-config.resolveBackendBaseUrl()`; sobreescrevível por `globalThis.__EBGEO_BACKEND_URL__`).

| Método | Caminho | Função (`api-client.js`) | Observação |
|---|---|---|---|
| POST | `/auth/login` | `login` | retorna `{accessToken, refreshToken, user}` |
| POST | `/auth/refresh` | `refresh` | **rotação** de refresh token; single-flight |
| POST | `/auth/logout` | `logout` | revoga **só** aquele refresh token; 204 |
| GET | `/auth/me` | `getMe` | usado no restore do boot |
| GET | `/config` | `getConfig` | **sem auth**; backend é fonte da config |
| GET | `/atlas` | `listAtlas` | atlas onde o usuário é dono ou tem share |
| POST | `/atlas` | `createAtlas` | |
| GET | `/atlas/:id` | `getAtlas` | |
| DELETE | `/atlas/:id` | `deleteAtlas` | soft-delete; servidor faz `closeRoom` |
| GET | `/atlas/public/:link` | `getPublicAtlas` | sem auth; retorna `publicToken` efêmero |
| GET/PATCH | `/atlas/:id/settings` | `getAtlasSettings`/`updateAtlasSettings` | restrições por atlas (overlay client-side) |
| GET/POST/PUT/DELETE | `/atlas/:id/sharing/...` | sharing | gate `manage` |
| GET | `/users/search?q=` | `searchUsers` | mín. 2 chars |
| **GET** | **`/atlas/:id/sync/:version`** | **`pullSync`** | `version=0` ⇒ snapshot; senão incremental |
| **POST** | **`/atlas/:id/sync`** | **`pushOperations`** | corpo `{ operations: [...] }` |
| POST/GET/DELETE | `/atlas/:id/images...` | imagens | blobs sincronizados à parte (`image-sync.js`) |

Tokens ficam em memória **e** persistem em `localStorage['ebgeo_auth']` (`_persistTokens`/`loadStoredTokens`). Em `401` com refresh token disponível, `_request` chama `refresh()` uma vez e repete a chamada (`api-client.js:205`). Chamadas de boot têm timeout de 8s; **push/pull são propositalmente sem timeout**.

### 4.2 WebSocket — protocolo `/api/v1/collab`

URL montada por `api-client.wsUrl()`: `${wsBase}/collab?atlasId=<id>&token=<accessToken>&clientId=<id>` (http→ws). No servidor (`collab.gateway.js`), o upgrade valida path, `atlasId`, `token` (`jwt.verify`, HS256) e resolve a permissão; `clientId` é validado por `^[a-zA-Z0-9_-]{8,64}$` e, se ausente/inválido, o servidor gera um.

**Mensagens enviadas pelo cliente** (`ws-client.js`): `operation`, `operations`, `cursor`, `selection`, `temporal`, `briefing_edit_start`, `briefing_edit_end`, `sync_request {lastVersion}`, `ping`, `leave`.

**Mensagens recebidas pelo cliente** (switch em `ws-client._onMessage`, `:277`):

| `type` | Handler interno | Efeito |
|---|---|---|
| `connected` | `connected` | snapshot de presença inicial (`usersOnline`, `sessionId`, `permission`, `role`) |
| `operation` / `operations` | `operation` → `_applyInboundOps` | aplica op remota (com dedupe de eco) |
| `ack` / `ack_batch` | `ack` | autor lê `serverVersion`/`idempotent` |
| `sync_response` | `syncResponse` | replay (snapshot ou ops) após `sync_request` |
| `pong` | — | limpa heartbeat pendente |
| `cursor`/`selection`/`temporal` | `cursor`/`selection`/`temporal` | presença em tempo real |
| `user_joined`/`user_left`/`user_away`/`user_back` | `presence` | roster |
| `briefing_edit_started`/`briefing_edit_ended` | `briefingEdit` | awareness de edição de briefing |
| `adaptive-settings` | `adaptiveSettings` | qualidade de conexão → ajustes |
| `atlas_deleted`/`atlas_owner_changed`/`atlas_settings_updated` | handlers dedicados | mutações fora do log CRDT |
| `atlas_updated`/`map_duplicated`/`maps_merged` | `serverResync` | dispara **re-pull** de snapshot |
| `sharing_updated` | `sharingUpdated` | compartilhamento mudou |
| `error` / *desconhecido* | `error` / drop | erro tipado / `ws.inbound{dropped, unknown_type}` |

**Heartbeat:** cliente envia `ping` a cada 25s; servidor faz uma varredura a cada 30s (`config.ws.heartbeatIntervalMs`), termina sockets sem pong (`isAlive=false`) e **re-reconcilia a autorização** a cada tick (`reconcileAuthorization` — share revogado/atlas despublicado/org desativada fecha com código `4003`). **Reconexão:** backoff exponencial 1s→30s no cliente; ao reabrir, envia `sync_request(lastVersion)` para recuperar o que perdeu.

**Away/back:** fechamento anormal (código `1006`, não um `leave` explícito) marca o usuário como *away* e agenda a remoção após `awayGraceMs` (120s); reconectar com o mesmo `clientId` cancela o timer e emite `user_back`. `leave` explícito (`1000`) remove imediatamente.

---

## 5. Fluxo OUTBOUND (mutação local → servidor → peers)

1. **Gesto → transação.** A operação de store roda dentro de `runTransaction(workFn)` (`store/store-transaction.js:109`), que: minta `traceId = generateUUID()`, executa a **persistência primeiro** (`await persistFn()`), depois roda `deferSync` (efeitos de UI) e `deferAsync` (logging/sync). Se a persistência lança, **nenhum efeito roda** e nada é enfileirado.

2. **Log da operação.** No `deferAsync`, a op de feature/layer/etc. chama um `logXxxOperation` de `operation-dispatcher.js` (`logFeatureOperation`, `logLayerOperation`, `logMapOperation`, …). `logOperation` (`:105`):
   - dropa se o logging está desabilitado (não conectado) → span `preflush.drop{logging_disabled}`;
   - **anti-leak do `Principal`:** dropa op cujo `mapId` de contexto não é UUID (o mapa local default é keyed por nome) → `preflush.drop{non_uuid_mapId}`; idem `setting` sem id UUID/`'atlas'` → `non_uuid_setting_id`;
   - caso contrário chama `createOperation(...)` e enfileira.

3. **Fila durável.** `operationQueue.enqueue()` (`operation-queue.js`) grava em IndexedDB (`name:'ebgeo', storeName:'operation_queue'`, chave `op_{timestamp}_{id}`). A fila faz **compaction**: `CREATE+DELETE ⇒ remove ambos`; `CREATE+UPDATEs ⇒ um CREATE com o dado mais recente`; `UPDATEs(+DELETE) ⇒ mantém o último`. Auto-purge de ops com mais de 7 dias.

4. **Flush.** `sync-flush.js` drena a fila num **timer de 1,5s** e também a cada `FLUSH_TRIGGER_EVENTS` (FEATURE/LAYER/GROUP/MAP/BRIEFING created/modified/deleted + `REMOTE_OPERATION_APPLIED`). Só roda se `connectionState.isOnline()` e há itens. `flushOnce` é guardado contra concorrência (in-flight).

5. **Push.** `syncEngine.flush()` (`sync-engine.js:259`): faz `operationQueue.peek(100)`, chama `apiClient.pushOperations(atlasId, ops)` (`POST /atlas/:id/sync` com `{ operations }`). Em sucesso, `recordPushAcks` semeia a **própria versão aplicada** do autor (para os tipos sob *convergence guard*) e a fila faz `dequeue(opIds)`. Em falha, o lote **permanece na fila** (re-tentado no próximo flush) — nada é dequeueado.

6. **No servidor** (`sync.service.pushOperations`, uma única transação): por op → `normalizeOperation` → `assertOperationAllowed(op, permission)` → `INSERT_OPERATION` com `ON CONFLICT (atlas_id, op_id) DO NOTHING RETURNING *`. O `INSERT` atribui `server_version := nextval('atlas_version_seq')` e o trigger `trg_update_atlas_version` atualiza `atlas.current_version`. Se o op já existia (mesmo `op_id`) → **ack idempotente** sem reaplicar. Senão → `applyOperation(t, ...)` escreve nas tabelas de entidade e retorna `rowsAffected`.

7. **Broadcast.** O controller (`sync.controller.js`) carimba cada op com o `serverVersion` resultante e a transmite por WS para a sala (`broadcastOperations`), pulando: o **próprio autor** (quando aplicável), **sockets fechados** e **read-only** para ops de comentário (lotes mistos são divididos).

8. **Eco do autor.** Como o autor empurrou via HTTP, seu próprio socket WS também recebe o broadcast. O `ws-client` **descarta** pela regra de self-echo (`op.clientId === this._clientId`, `ws-client.js:392` → span `ws.self-echo`). Por isso o estado do autor não é sobrescrito por si mesmo.

---

## 6. Fluxo INBOUND (servidor → store local → UI)

1. **Recebimento.** `ws-client._onMessage` parseia o JSON e roteia por `type`. Para `operation`/`operations`, `_applyInboundOps` (`:370`) avança `_lastVersion` a partir de `op.serverVersion`, descarta eco próprio, e **serializa** os applies por uma cadeia de promessas (`_applyChain`) — evitando read-modify-write concorrente sobre o mesmo mapa no IndexedDB.

2. **Gate.** `sync-gateway.applyRemoteOperation` (`sync-gateway.js:39`) retorna cedo se `!connectionState.isOnline()` (span `gateway.gate{offline}`); senão `advanceLamportClock(op.lamportTimestamp)` e delega ao handler.

3. **Apply.** `remote-operation-handler.applyRemoteOperation` (`:256`):
   - **Convergence guard** para tipos guardados (`CONVERGENCE_GUARDED`: feature/layer/group/marker3d/measurement3d/viewshed3d/cameraPosition3d/orientation360/marker360): se há **edição local não-ackada** na mesma `entityId`, a op remota é **adiada** (`deferRemoteOp`) e reaplicada quando o ack do autor chega (`resolveLocalEdit`); senão, dropa se `!shouldApplyVersion` (**LWW por `serverVersion`**).
   - **Switch por `entityType`** roteia para o handler específico: `applyRemoteFeatureOp` (CREATE replace-by-id/push, UPDATE replace, DELETE varre todos os buckets), `applyRemoteLayerOp`, `applyRemoteMapOp`, `applyRemoteGroupOp`, `applyRemoteBriefingOp`, `applyRemoteCommentOp`, os de 3D/360 (`applyRemoteCesium3dEntityOp`/`applyRemoteCameraOp`/`applyRemoteOrientation360Op`/`applyRemoteMarker360Op` — persistem nos side-stores cesium3d/streetview360), `applyRemoteMapSettingOp`, `applyRemoteCatalogLayerOp`, `applyRemoteSettingOp`.
   - Cada handler **persiste via repo** e **emite o evento de ciclo de vida** (`FEATURE_CREATED/MODIFIED/DELETED` + `LAYERS_CHANGED`, etc.).
   - **Feature antes do mapa:** se a op de feature chega antes do CREATE/snapshot do mapa, ela é **bufferizada** (`bufferPendingFeatureOp`, cap 1000/mapa) e reaplicada por `drainPendingFeatureOps` quando o mapa aterrissa — não é perdida.

4. **Sinal final.** Após o handler, registra a versão aplicada e emite `EventTypes.REMOTE_OPERATION_APPLIED` (`{ operation }`) — que é também um gatilho de flush e a âncora "aplicado no peer".

5. **Render.** As camadas MapLibre reagem aos eventos de ciclo de vida e re-renderizam a fonte GeoJSON. O mapa do peer converge.

---

## 7. Snapshot, pull incremental, boot e restore

### 7.1 Pull híbrido (servidor)

`pullOperations(atlasId, sinceVersion, permission)` (`sync.service.js:726`):

- Se `sinceVersion === 0` **ou** `sinceVersion < atlas.min_version` ⇒ **snapshot completo** (`{ snapshot, currentVersion, isSnapshot: true }`).
- Senão ⇒ **incremental**: `SELECT * FROM operations WHERE atlas_id=$1 AND server_version > $2 ORDER BY server_version`, cada linha reformatada por `toFrontendOperation` (`{ ..., serverVersion }`). Viewers read-only têm ops de comentário filtradas.

O **snapshot** é reconstruído **a partir das tabelas de entidade** (não por replay do log), numa única `task` de leitura: metadados do atlas + mapas + (por mapa) features/cesium3d/streetview360/catalogLayers/layers/groups/groupFeatures + comments (omitidos para `read`) + briefings/slides. A resposta é mapeada para o **mesmo shape do IndexedDB** (contrato congelado): cada entidade carrega um objeto `sync` (`{createdAt, updatedAt, version, ownerId, dirty:false, deleted:false}`). Features viram coleções por tipo (`points[]`, `lines[]`, …) reembrulhadas como GeoJSON.

### 7.2 Aplicação no cliente

`remote-operation-handler.applyRemoteSnapshot(snapshot)` (`:1150`) distribui settings de app-state, e por mapa faz `reshapeSnapshotMap` (snake_case→camelCase + side-stores de notes/grid keyed por id, temporal/lock keyed por **nome**), `repo.saveMap`, `drainPendingFeatureOps`, persiste groups/layers/cesium3d/streetview360/comments, e por fim emite `LAYERS_CHANGED`/`GROUPS_CHANGED`/`COMMENT_UPDATED`. O mesmo caminho serve a resposta WS `sync_response`.

### 7.3 Lifecycle (`sync-engine.js`)

`login()` → `connect(atlasId, {initialPull})`: faz `pullSync(atlasId, 0)` → `applyRemoteSnapshot`, liga o image-sync do atlas, `enableOperationLogging()`, eleva o papel de owner cedo (do snapshot), `wsClient.connect`, aplica papel por-atlas e o overlay de settings do atlas. `connectPublic()` é igual mas com logging **desabilitado** e `setVisitorSession()`. `flush()`/`pull()`/`resync()` (snapshot fresco em `serverResync`). `disconnect()` reverte settings; `logoutAndDisconnect()` chama `apiClient.logout()`, `sessionContext.clearSession()`, desabilita logging e limpa `_atlasId`/`_lastVersion`.

### 7.4 Boot/restore (F5)

Em `index.js initApp`: instala o bridge de trace, configura o engine, aplica a config remota (`applyRuntimeConfig` → `GET /config`), `initServices()`, então **`restoreSessionFromStorage()`** (carrega tokens de `localStorage['ebgeo_auth']`, `getMe()`, `sessionContext.setSession`). Por fim, `openPublicAtlasFromUrl()` (`?atlasPublico=<link>`) **ou** `reconnectLastAtlas()` — que, se autenticado e `loadStoreOrigin()` for `{kind:'remote', atlasId}`, refaz `connect` + `markStoreRemote` + `startAutoFlush`. O caminho de refresh/401 é alcançável no boot. Dados de atlas remoto órfãos (encontrados deslogado) são descartados pela guarda de boot.

### 7.5 Marcador de origem e anti-leak do `Principal`

`store-origin.js` persiste `{kind, atlasId}` sob a chave `'__store_origin__'` (default LOCAL). `isRemoteStoreSync()` é o que o `permission-guard` consulta. O **anti-leak** do mapa local `Principal` (keyed por nome) vive no `operation-dispatcher`: ops com `mapId` não-UUID são dropadas pré-flush; no `connect`, `activateAtlasInitialMap` remove strays locais não-UUID para um mapa de mesmo nome no servidor não ser sombreado.

---

## 8. Persistência no backend e modelo de dados

PostgreSQL via `pg-promise` (sem ORM); geometria como **JSONB** no schema de atlas (sem PostGIS aqui). Migrations forward-only em `src/database/migrations/NNN_*.sql`.

### 8.1 A tabela `operations` (log CRDT append-only) — `003_sync.sql`

| Coluna | Tipo | Papel |
|---|---|---|
| `id` | `UUID PK` | id da linha no servidor |
| `atlas_id` | `UUID FK→atlas ON DELETE CASCADE` | |
| `op_type` | `VARCHAR(20)` CHECK create/update/delete | |
| `entity_type` | `VARCHAR(50)` | tipo genérico de backend |
| `entity_id` | `UUID` | |
| `map_id` | `UUID` (nullable) | |
| `changes` | `JSONB` | usado em updates |
| `data` | `JSONB` | usado em creates |
| `client_timestamp` | `BIGINT` | |
| `client_id` | `TEXT` | **TEXT**, string do frontend |
| **`server_version`** | `BIGINT DEFAULT nextval('atlas_version_seq')` | **ordem de chegada = chave do LWW** |
| `lamport_timestamp` | `BIGINT` (nullable) | ecoado no pull; não decide vencedor |
| `op_id` | `TEXT` (nullable) | chave de idempotência do cliente |
| `user_id` | `UUID FK→users` | auditoria |
| `created_at` | `TIMESTAMPTZ` | |

- **Idempotência:** `UNIQUE (atlas_id, op_id)` → `INSERT ... ON CONFLICT DO NOTHING`.
- **Ordenação:** índice `(atlas_id, server_version)`; trigger `update_atlas_current_version` mantém `atlas.current_version = MAX(server_version)`.
- ⚠️ `atlas_version_seq` é uma **sequência global** (compartilhada por todos os atlas): `server_version` é monotônico por atlas, mas **não contíguo** dentro de um atlas. Use-o só para **ordenar**, nunca para contar.

### 8.2 `applyOperation` — escrita nas tabelas de entidade (`sync.service.js:1237`)

- **Lock gate:** para alvos filhos (`feature/group/layer/cesium3d/streetview360/catalog_layer/group_feature`) com `mapId`, verifica `maps.locked`; se travado → `ConflictError('Map is locked')`.
- **`tableMap`:** `feature→features`, `layer→layers`, `group→groups`, `map/map_meta→maps`, `briefing→briefings`, `slide→slides`, `cesium3d→cesium3d_data`, `streetview360→streetview360_data`, `comment→comments`, `catalog_layer→catalog_layers`, `group_feature→group_features`.
- **create:** `INSERT ... SELECT ... WHERE EXISTS (mapa pertence a ESTE atlas)` (guarda anti-IDOR cross-atlas), `ON CONFLICT (id) DO NOTHING`.
- **update:** UPDATE dinâmico whitelisted por tipo, sempre incrementando `version` e setando `updated_at`.
- **delete:** soft-delete (`deleted_at = NOW()`) em tudo, exceto `group_feature` (hard delete). **Delete de layer cascateia** soft-delete às suas features.
- **setting:** merge whitelisted em `atlas.settings` JSONB (chaves de disponibilidade de recurso nunca são aceitas por aqui).

### 8.3 Tabelas de domínio — `001_core.sql` / `002_atlas.sql`

- **`users`** — `username` único (case-insensitive), `password_hash` (bcrypt, 12 rounds), `role` global (`user|admin`), `org_role` (`owner|admin|editor|viewer`), `organization_id`.
- **`refresh_tokens`** — guarda apenas o **sha256** do token; `revoked_at` para revogação/rotação.
- **`atlas`** — `owner_id`, `map_order UUID[]`, `settings JSONB` (disponibilidade de recursos restringível por atlas), `is_public`/`public_link`, e os contadores de sync `version`/`min_version`/`current_version`.
- **`atlas_shares`** — a tabela de membership: `(atlas_id, user_id)` único, `permission ∈ {read, comment, write, manage}` (**`owner` não é compartilhável**; vem de `atlas.owner_id`).
- Entidades (`maps`, `layers`, `groups`, `features`, `group_features`, `comments`, `catalog_layers`, `cesium3d_data`, `streetview360_data`, `images`, `briefings`, `slides`) — todas com `version` + soft-delete (`deleted_at`), geometria/props em JSONB.

### 8.4 Config como fonte única — `/api/config`

Montado em `/api/v1/config` e `/api/config` (sem auth). `getAppConfig()` (`config.service.js`) combina três fontes: a tabela **`resources`** (basemaps/analysisLayers/dataLayers/tilesets), URLs de ambiente, e defaults estáticos de UI. O frontend sobrescreve seu `config.js` com isso em **todo boot** (anônimo inclusive). A restrição **por atlas** vem separadamente de `GET /atlas/:id/settings`; o overlay (config ∩ settings do atlas → filtra catálogo) é feito **client-side** (`atlas-settings.service.js`).

---

## 9. Identidade, sessão, conexão e papéis

### 9.1 Dois vocabulários de papel

- **Tier de permissão do atlas** (modelo de acesso, no backend): `read < comment < write < manage < owner` (`middleware/permissions.js`). `comment` = Comentarista; `manage` = co-Gestor; `owner` vem de `atlas.owner_id`.
- **Papéis de identidade** (no frontend, `session-context.js`): `owner, admin, manager, editor, commenter, viewer`, mapeados para capacidades em `ROLE_PERMISSIONS` (`canEdit/canDelete/canComment/canManageUsers/canLockMaps`). A tradução é feita por `toFrontendRole()` (mensagem WS `connected`).

### 9.2 Estado de sessão (`session-context.js`)

`sessionContext` — `OFFLINE`/`ONLINE`; `setSession({userId, role, username})`, `setVisitorSession()` (público anônimo: ONLINE + VIEWER + `_isVisitor`), `clearSession()` (volta a OFFLINE com **permissões plenas locais**). Notifica via `SESSION_CHANGED`.

### 9.3 Máquina de conexão (`connection-state.js`)

`connectionState` — `OFFLINE → CONNECTING → ONLINE → RECONNECTING`. Transições válidas: `OFFLINE→[CONNECTING]`, `CONNECTING→[ONLINE,OFFLINE]`, `ONLINE→[RECONNECTING,OFFLINE]`, `RECONNECTING→[ONLINE,OFFLINE]` — transições ilegais lançam (registradas por `ws-client._safeTransition`). Notifica via `CONNECTION_STATE_CHANGED`. As pontes singleton→EventBus ficam em `event-bridges.js`.

### 9.4 Gate de permissão (`permission-guard.js`)

`checkPermission(action)` retorna **permitido** quando `sessionContext.isOffline() || !isRemoteStoreSync()` — ou seja, **o gate de papel só vale para um atlas remoto conectado**; o store local é sempre editável, mesmo logado. Conectado e remoto, mapeia a ação CRUD → capacidade e verifica `canPerformAction`.

### 9.5 Autenticação no backend

- **Login** com bcrypt (12 rounds) + comparação timing-safe contra `DUMMY_HASH` para não vazar existência de usuário.
- **JWT HS256**, claims `sub/username/nome/posto/role/organization_id/org_role` (+ aliases `org`/`login` para o `ebgeo_360`). TTL access **15m**, refresh **7d**.
- **Refresh com rotação** e detecção de reuso: um refresh token revogado reaparecendo revoga **toda a família** de tokens do usuário. **Logout** revoga só aquele token (o fechamento do socket collab é client-driven).
- **`flexibleAuth`** global nunca bloqueia (preserva anônimo); rotas estritas usam `auth()`. O WS autentica o `token` no upgrade e **re-reconcilia** a autorização a cada heartbeat.
- **Gate por atlas:** `requireAtlasPermission(level)` resolve `owner` (dono ou admin global) → `atlas_shares.permission` → `read` (público) → 403. Push exige `comment` (para Comentaristas chegarem), com `assertOperationAllowed` restringindo por op; pull exige `read`.

---

## 10. Presença e colaboração em tempo real

A presença é **só em memória** no servidor (a tabela `active_sessions` só registra connect/heartbeat). Tudo é keyed por `clientId`.

**Cliente (`src/js/presence/`):**

- `presence-bridge.js` (`startPresence({map})`, montado em `map_sig.js`) liga handlers WS → `presenceStore`: `connected`→`setInitial`; `presence`→join/left/away/back; `cursor`→`setCursor`; `selection`→`setSelection`; `temporal`→`setTemporal`; `briefingEdit`→roteamento de awareness. **Saída:** `mousemove` throttled (80ms) → `sendCursor`; mudança de mapa → cursor sem posição; seleção (StateManager + cliques 3D/360) → `sendSelection` (gated a editor+); cursor temporal → `sendTemporal`; início/fim de edição de briefing → `sendBriefingEditStart/End`.
- `presence-store.js` (`presenceStore`) — keyed por `clientId`; emite `PRESENCE_CHANGED`, `PRESENCE_CURSORS_CHANGED`, `PRESENCE_SELECTIONS_CHANGED`.
- **Render:** `OnlineUsersControl` (roster, avatares + dropdown de awareness, exclui self por `sessionContext.userId`), `RemoteCursorsLayer` (um `maplibregl.Marker` por peer no mapa ativo, cor de `getPresenceColor`), `RemoteSelectionsLayer`, e `SyncStatusControl` (luz de conexão — verde/amarelo/vermelho — oculta quando anônimo).

**Servidor (`collab.handlers.js`):** `cursor`/`temporal` são **ungated** (broadcast a todos menos o emissor); `selection` é **gated a write/owner**; `connection-quality` classifica RTT em bandas e responde `adaptive-settings`. Mensagens de presença servidor→cliente: `user_joined`/`user_left`/`user_away`/`user_back`, com o snapshot `connected` no join.

---

## 11. Modelo de conflito: LWW, idempotência e guardas de convergência

- **LWW por ordem de chegada.** O vencedor é a op com maior `serverVersion` (carimbado por `nextval('atlas_version_seq')`). No cliente, `remote-operation-handler` mantém `lastAppliedVersion` por entidade e dropa ops com versão inferior (`shouldApplyVersion`). **Nunca** ordene por `timestamp` (parede) ou `lamport` (causal).
- **Idempotência** por `(atlas_id, op_id)` no Postgres: reenvio do mesmo op → ack `{idempotent:true}` sem reaplicar efeito. No cliente, a fila só faz `dequeue` após o ack — reenvio seguro.
- **Convergence guard.** Para tipos guardados, uma op remota sobre uma entidade com **edição local ainda não-ackada** é **adiada** e reaplicada após o ack do autor (`deferRemoteOp`/`resolveLocalEdit`). O autor semeia sua própria `serverVersion` aplicada a partir do ack do push (`recordPushAcks`).
- **Buffering de feature-antes-do-mapa.** Ops de feature que chegam antes do mapa são bufferizadas e drenadas quando o mapa aterrissa — robustez contra ordem de chegada.
- **Serialização de apply.** Inbound é aplicado em cadeia (`_applyChain`) para evitar clobber concorrente do registro de mapa no IndexedDB.

> **Limite conhecido (corrida real, fora do escopo de observabilidade):** `applyRemoteFeatureOp` (UPDATE) faz `features[index] = data`; duas edições concorrentes na **mesma** feição podem, sob carga, deixar A com o valor de B e vice-versa sem reconvergência inbound. É uma corrida gerenciada hoje via `retries` nos testes e **depurável pelo SyncLedger**; candidata a correção em lógica core de sync.

---

## 12. Observabilidade: o SyncLedger

O **SyncLedger** é uma camada **aditiva, ligável por flag e test/dev-only** (nunca em produção) que torna o pipeline acima **visível e correlacionável de ponta a ponta**. Ela existe porque o pipeline atravessa 3 runtimes (browser A → servidor → browser B) e, sem correlação, falhas viram "buracos negros silenciosos" (estado final errado, sem sinal de **em qual estágio** morreu).

### 12.1 Ideia central

Carimba **uma** chave de correlação (`traceId`) no nascimento do gesto e costura-a pelos tokens que **já existem** (`op.id`/`clientId`/`lamport`/`serverVersion`) por A + servidor + B; emite **Spans** tipados para *ring buffers* por runtime, que se fundem num **Ledger** causal ordenado por `serverVersion`.

- **`op.id`** é a chave de junção primária (sempre funciona). **`traceId`** é enriquecimento best-effort (liga o gesto às ops e ao apply do peer); se algum hop o remover, o merge degrada para junção por `op.id`.
- Spans guardam **só escalares e contagens** — nunca geometria/payload/PII.

### 12.2 Contrato de estágios (espelhado FE/BE)

```
action.origin · enqueue · preflush.drop · flush.push · flush.skip · push.ack
server.inserted · server.applied · server.broadcast
ws.inbound · ws.self-echo · gateway.gate · apply.persist · remote.applied
render.source · presence · conn.transition
```

`outcome ∈ { ok, dropped, filtered, failed, idempotent, no-effect }`; `DropReason` nomeia o porquê (`logging_disabled`, `non_uuid_mapId`, `non_uuid_setting_id`, `batch_filtered`, `echo_self`, `offline`, `parse_error`, `unknown_type`).

### 12.3 Implementação (as-built)

**Frontend (`src/js/store/sync/diag/`):**

- `trace-stages.js` — contrato de estágios/outcomes/reasons (`SPAN_SCHEMA_VERSION=1`).
- `trace-core.js` — `record()` (early-return de custo zero quando desligado), ring `window.__ebgeoSyncTrace` (cap 5000), `byOpId`/`byTraceId`/`hasSpan`, e o flag-resolver (`?trace=sync` / `localStorage['ebgeo_trace']='1'` / init script de teste). Node-safe.
- `bus-tap.js` — `installSyncTrace(eventBus)` instala **um** `eventBus.onAny(...)` que registra `remote.applied` a partir de `REMOTE_OPERATION_APPLIED` e um probe `render.source` (opt-in via `globalThis.__EBGEO_TRACE_RENDER__`, para evitar leitura O(feições) por evento).
- `onAny()` de primeira classe em `events/event_emitter.js` (sem monkey-patch; wildcard error-isolado, coberto por teste).
- `traceId` mintado em `store/store-transaction.js` (gesto) e carimbado no envelope por `operation-factory.js`.
- **Spans instrumentados:** `operation-dispatcher.js` (`preflush.drop` + `enqueue`), `sync-engine.js` (`flush.push` + `push.ack` lendo a resposta antes ignorada), `ws-client.js` (`push.ack` do ack antes morto, `ws.inbound`/`ws.self-echo`/`conn.transition`), `sync-gateway.js` (`gateway.gate`). Instalação em `store/services.js` + `index.js`.

**Backend (`ebgeo_backend`):**

- `src/utils/sync-trace.js` — ring por atlas (cap 5000, máx 64 atlas), gated por `EBGEO_TRACE=1`/`NODE_ENV=test`; espelha o contrato de estágios (`server.inserted`/`server.applied`/`server.broadcast`).
- Emissão: `server.inserted` (op.id ↔ serverVersion) + `server.applied` (`rowsAffected`, `outcome:no-effect` quando 0) em `modules/sync/sync.service.js`; `server.broadcast` (`{sent, recipients, skipped*}`) em `modules/collab/collab.rooms.js` (que passou a **retornar** o fan-out).
- `traceId` explícito em `sync.schemas.js` (sobrevive à validação e ao broadcast). Endpoint `GET/DELETE /api/v1/debug/trace?atlasId=` (`modules/debug/debug.routes.js`), montado **só** com o tracer ligado e fora de produção.

**Testes:** helpers em `tests/e2e-ui/helpers/{trace-helpers,ledger}.js` (`waitForRemoteEntity`/`waitForStage`/`collectLedger`/`reduceLedger`); `collab-helpers.js` usa as esperas determinísticas por `remote.applied` (com fallback ao poll de store). `collectLedger` funde o ring do browser (`window.__ebgeoSyncTrace`) com o do backend (`GET /api/v1/debug/trace`) por `op.id`/`traceId`.

### 12.4 Invariantes verificáveis (o "gabarito")

| # | Invariante |
|---|---|
| I1 | Nada some em silêncio: todo `action.origin` com `mapId` UUID chega a `server.inserted` OU tem `preflush.drop`/`gateway.gate` com `reason`. |
| I2 | Ack implica efeito: nenhum `server.applied` com `rowsAffected===0` para create/update/delete ackado. |
| I3 | LWW por chegada: vencedor = `max(serverVersion)`; falha se a ordenação derivar de `timestamp`/`lamport`. |
| I5 | Eco exatamente-uma-vez: toda op aparece como `ws.self-echo` no autor e `remote.applied` uma vez em cada peer. |
| I6 | Paridade store↔render: para cada feature op aplicada, o `render.source` terminal tem `inSource===inStore`. |
| I7 | Broadcast completo: `recipients = membros − autor − fechados − (read-only p/ comment)`. |
| I9 | Transição legal: todo `conn.transition` ∈ transições válidas. |
| I10 | Exclusões by-design (ver §13) **não** são bug. |
| I11 | Monotonicidade Lamport: todo apply remoto avança o relógio local. |

### 12.5 Como ligar

- **Browser:** `?trace=sync` na URL, `localStorage.setItem('ebgeo_trace','1')`, ou init script de teste. Ring em `window.__ebgeoSyncTrace`.
- **Backend:** `EBGEO_TRACE=1` (ou `NODE_ENV=test`) e ler `GET /api/v1/debug/trace?atlasId=<id>`. Em produção é branch morto.

---

## 13. Comportamentos por design (não são bugs)

Pontos que parecem "op perdida" mas são intencionais — codificados como `outcome`/`reason` explícitos no SyncLedger:

- **Drop `non_uuid_mapId`** no mapa local `Principal` (anti-leak; ops de mapa keyed-por-nome não vão ao servidor).
- **Eco do próprio autor** filtrado por `clientId` (`ws.self-echo`).
- **Locks de camada/grupo/feição são advisory** no cliente; o servidor só barra escrita em **mapa** travado.
- **3D/360 e settings** persistem nos side-stores e convergem; `mapTemporal` é per-map config (emite op de `map` subtype).
- **Offline intencional:** sem login, `gateway.gate{offline}` / `preflush.drop{logging_disabled}` são o esperado — o app é offline-first.
- **`atlas_updated`/`map_duplicated`/`maps_merged`** mutam dados do servidor **fora** do log CRDT → o cliente faz **re-pull** de snapshot (`serverResync`), não apply de op.

---

## 14. Mapa de arquivos para referência rápida

### Frontend — `ebgeo_web/src/js/store/sync/`

| Arquivo | Responsabilidade |
|---|---|
| `api-client.js` | Transporte REST `/api/v1` + builder da URL WS |
| `ws-client.js` | WebSocket `/collab`; heartbeat, reconnect, dedupe de eco, máquina de conexão |
| `operation-factory.js` | Envelope de op, `clientId`, relógio Lamport, `traceId` ambiente |
| `operation-queue.js` | Fila durável IndexedDB (`ebgeo/operation_queue`), compaction, auto-purge |
| `operation-dispatcher.js` | `logXxxOperation`: mutação de store → fila; guardas de drop |
| `operation-types.js` | `EntityType`/`OperationType` |
| `sync-flush.js` | Auto-flush (1,5s + eventos), gated em online |
| `sync-engine.js` | Lifecycle: login/connect/flush/pull/disconnect/logout |
| `remote-operation-handler.js` | Apply inbound + snapshot; LWW, convergence guard, buffering |
| `sync-gateway.js` | Gate inbound (early-return offline) |
| `sync-scheduler.js` | No-op shell (outbound é do `sync-flush`) |
| `session-context.js` | OFFLINE/ONLINE + papel JWT → permissões |
| `connection-state.js` | Máquina OFFLINE→CONNECTING→ONLINE→RECONNECTING |
| `event-bridges.js` | Singletons → `SESSION_CHANGED`/`CONNECTION_STATE_CHANGED` |
| `permission-guard.js` | Gate de papel (só p/ atlas remoto conectado) |
| `store-origin.js` | Marcador local↔remoto (`'__store_origin__'`) |
| `runtime-config.js` | `GET /config` → mescla no `config` global |
| `image-sync.js` | Sync de blobs de imagem |
| `atlas-settings.service.js` | Overlay de restrições por atlas sobre o config |
| `diag/` | SyncLedger (§12) |

Relacionados: `store/store-transaction.js` (mint do `traceId`, persistência-primeiro), `presence/` (presença), `account/` (login/connect/logout + luz de sync).

### Backend — `ebgeo_backend/src/`

| Caminho | Responsabilidade |
|---|---|
| `modules/sync/sync.routes.js` | `POST /:atlasId/sync` (push), `GET /:atlasId/sync/:version` (pull) |
| `modules/sync/sync.service.js` | `pushOperations`, `pullOperations`, `getAtlasSnapshot`, `applyOperation` |
| `modules/sync/sync.queries.js` | SQL (INSERT_OPERATION, GET_OPERATIONS_SINCE_VERSION, snapshot) |
| `modules/sync/sync.schemas.js` | Joi do envelope (`.unknown(true)`, `traceId`, máx 500/push) |
| `modules/collab/collab.gateway.js` | WS upgrade/auth, heartbeat, away/back, router |
| `modules/collab/collab.handlers.js` | Handlers de mensagem (operation, cursor, selection, …) |
| `modules/collab/collab.rooms.js` | Salas + `broadcastOperations`/`broadcastToRoom`/`closeRoom` |
| `modules/collab/collab.service.js` | Sessões/presença (`active_sessions`) |
| `modules/auth/` | Login/refresh/logout, JWT, refresh tokens |
| `middleware/{auth,flexible-auth,permissions}.js` | Auth estrita/flexível + `requireAtlasPermission` |
| `modules/atlas/` + `modules/sharing/` | CRUD de atlas, settings, compartilhamento, transfer |
| `modules/config/` | `/api/config` (fonte única de config) |
| `utils/sync-trace.js` + `modules/debug/debug.routes.js` | SyncLedger backend (§12) |
| `database/migrations/00X_*.sql` | Schema (`operations`, `atlas`, `atlas_shares`, entidades, `resources`) |

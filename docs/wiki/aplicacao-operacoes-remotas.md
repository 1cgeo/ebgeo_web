# Fluxo Inbound: Aplicação de Operações Remotas

Como uma operação vinda do servidor atravessa ws-client, sync-gateway e remote-operation-handler até persistir no store local e emitir o evento de ciclo de vida que redesenha o mapa.

## O caminho, em quatro saltos

```
WS frame            ws-client._onMessage         → roteia por msg.type
  ↓                 ws-client._applyInboundOps   → avança _lastVersion, filtra self-echo, SERIALIZA
gate                sync-gateway.applyRemoteOperation → early-return se offline, avança Lamport
  ↓
apply               remote-operation-handler.applyRemoteOperation → convergence guard + switch(entityType)
  ↓
persist + emit      repo.saveXxx() → EventTypes.FEATURE_CREATED/... → LAYERS_CHANGED → REMOTE_OPERATION_APPLIED
```

O wiring é feito uma única vez em `sync-engine._wireOnce()`: `syncGateway.setRemoteOperationHandler(applyRemoteOperation)` (`src/js/store/sync/sync-engine.js:400`) e `wsClient.on('operation', (op) => syncGateway.applyRemoteOperation(op))` (`sync-engine.js:405`). Em paralelo, `services.js:88` também registra o handler no gateway, de modo que o caminho inbound funciona mesmo antes do engine conectar.

Ver [[canal-collab-websocket]] para o transporte e [[envelope-operacao]] para o formato do `op`.

## 1. ws-client: roteamento, cursor de versão, self-echo, serialização

`_onMessage` (`ws-client.js:273`) faz `JSON.parse` e roteia por `msg.type`. Só `operation` (uma op) e `operations` (lote) caem em `_applyInboundOps` (`ws-client.js:375`). `sync_response` é tratado separadamente pelo engine (ver seção 6).

Dentro de `_applyInboundOps`, por op e nesta ordem:

1. **Span `ws.inbound`** ([[syncledger]], só em dev/teste).
2. **Avanço do cursor**: `if (Number.isFinite(sv) && sv > this._lastVersion) this._lastVersion = sv` (`ws-client.js:392`). Armadilha documentada no próprio código: `server_version` vem de uma **sequência global compartilhada entre atlas**, então é monotônica mas **não contígua** por atlas. Um "buraco" é op de outro atlas, não op perdida. Tratar não-contiguidade como gap gerou tempestades de `sync_request` no passado. Perda real só ocorre em desconexão, e é recuperada pelo `sync_request(lastVersion)` do `_onConnected`.
3. **Self-echo**: `if (op.clientId && this._clientId && op.clientId === this._clientId) continue` (`ws-client.js:397`). O push é por HTTP e o broadcast do servidor não consegue excluir o remetente, então o autor recebe a própria op de volta e a descarta aqui. Isso depende do singleton carregar o `clientId` estável (`export const wsClient = new WsClient({ clientId: getClientId() })`, `ws-client.js:573`). Sem ele o dedupe fica desligado. Ver [[client-id-estavel]].
4. **Serialização**: cada apply é encadeado em `this._applyChain` (`ws-client.js:409`). Isto é obrigatório, não cosmético: os handlers fazem read-modify-write assíncrono do **registro inteiro do mapa** no IndexedDB. Applies concorrentes se sobrescrevem e todas as ops menos uma somem.

Consequência prática do ponto 3: **o autor nunca aprende a `serverVersion` da própria op pelo WS**. Quem a informa é o ack do push (seção 4).

## 2. sync-gateway: o portão

`syncGateway.applyRemoteOperation` (`sync-gateway.js:39`) faz duas coisas e delega:

- **Early-return se `!connectionState.isOnline()`** (span `gateway.gate{offline}`). `isOnline()` é estritamente o estado `ONLINE` (`connection-state.js:62`), não `RECONNECTING`. Ops que chegassem durante reconexão são descartadas de propósito; a recuperação é o `sync_request` do handshake.
- `advanceLamportClock(op.lamportTimestamp)`. O relógio de Lamport é **registrado, nunca usado para resolver conflito** (ver [[sintese-nao-e-crdt]] e [[modelo-conflito-lww]]).

O gate existe para que a janela disconnect→clear (logout, troca de atlas) não persista dados remotos num store sendo destruído. Ver [[dominio-local-vs-remoto]].

## 3. Convergence guard (antes do switch)

`applyRemoteOperation` (`remote-operation-handler.js:256`) aplica um guard **genérico** aos tipos que fazem substituição cega, listados em `CONVERGENCE_GUARDED` (`:115`): `feature`, `layer`, `group`, `marker3d`, `measurement3d`, `viewshed3d`, `cameraPosition3d`, `orientation360`, `marker360`. Os handlers de entidade não sabem que ele existe.

Dois testes, nesta ordem (`:266-272`):

1. **Defer**: se `pendingLocalEditCount.get(entityId) > 0`, a op remota é bufferizada em `deferredRemoteOps` e a função **retorna sem aplicar**. O contador é incrementado no caminho outbound, em `operation-dispatcher.js:147` (`markLocalEditPending`), para toda op local de tipo guardado. A razão: a edição otimista local ainda não tem `serverVersion`, então aplicar a op do peer poderia sobrescrever uma edição local mais nova e deixar os clientes divergentes.
2. **Drop por versão**: `shouldApplyVersion(entityId, serverVersion)` (`:128`) descarta op com versão **menor** que a última aplicada. `serverVersion == null` desliga o guard (legado / sem backend).

Depois do handler, `:346-349` registra a versão aplicada: `DELETE` **limpa** a entrada (`lastAppliedVersion.delete`) para que um re-create comece do zero; caso contrário `markAppliedVersion`.

**Como o defer é liberado.** No ack do push, `sync-engine.recordPushAcks` chama `recordLocalAppliedVersion(op.entityId, sv)` (`sync-engine.js:77`, alias de `resolveLocalEdit`, `remote-operation-handler.js:173`), que semeia a `serverVersion` do próprio autor, decrementa o contador e, quando chega a zero, **replaya as ops adiadas por `applyRemoteOperation`** (portanto pelo guard de versão). É isso que elimina a corrida ack-vs-peer.

**Auto-cura obrigatória.** O contador por-op vaza quando a simetria incremento/decremento quebra: compactação da fila, ops em lote, ack sem versão, batch envenenado. Um contador vazado deixaria aquela entidade **permanentemente adiada**, ou seja, divergência silenciosa. Por isso `reconcilePendingLocalEdits(remainingEntityIds)` (`:203`) roda **depois de todo flush** (`sync-engine._reconcileConvergenceGuard`, `:298`) usando a fila de operações como fonte de verdade: qualquer entidade guardada que não tenha mais op enfileirada tem o defer limpo e as ops replayadas. Ver [[fila-operacoes-outbound]] e [[ack-idempotencia]].

## 4. Switch por entityType: o que cada handler realmente faz

Regra invariável de todos: **persistir via repo E emitir o evento**. Emitir sem persistir é o bug clássico deste arquivo (a versão antiga do handler de layer e de group só emitia, e o peer ficava sem a camada porque **nenhum subscriber persiste eventos `LAYER_*`/`GROUP_*`**). Ver [[tipos-entidade-sync]].

| entityType | Persistência | Detalhe que morde |
|---|---|---|
| `feature` | dentro do registro do mapa (`mapData.features[storageType]`), `repo.saveMap` | CREATE é **idempotente por id** (replace-in-place se já existe, `:415`). UPDATE **substitui a feição inteira**; se o índice não existe, **não faz nada** (`:429`). DELETE **varre todos os buckets** por id, porque a op de delete não carrega `data` e o bucket não é derivável |
| `layer` | `repo.saveLayers` + `loadLayersToMemory` se for o mapa ativo | UPDATE faz **merge raso** (`{...l, ...data}`, `:493`), diferente do replace da feature. O refresh do cache em memória é essencial: o filtro de visibilidade lê `memoryStore`, não o repo, então sem ele as feições do peer numa camada nova ficam **filtradas para fora** até trocar de mapa |
| `map` | `reshapeSnapshotMap` → `repo.saveMap` + `mapResolver.registerMap` | CREATE chama `drainPendingFeatureOps(mapId)`. DELETE **preserva** a entrada do resolver de propósito (a aba Mapas ainda precisa resolver id→nome para o redirect) |
| `group` | `repo.saveGroups` (por id) **e** `memoryStore.groups[mapName]` (por nome) | Os dois destinos são obrigatórios; `getMapGroups` lê o cache por **nome** |
| `briefing` | `localRepository.saveBriefing` | — |
| `slide` | **nada** (`entityPersisted = false`, `:337`) | Slides convergem pela op `briefing` pai, que loga o array completo. A op de slide é redundante inbound |
| `comment` | `localRepository.saveMapComments` | Root e reply no mesmo store, por id. Ver [[comentario-espacial]] |
| 3D / 360 | `repo.saveCesium3d` / `saveStreetview360` + **invalidação** do cache canônico | O handler **não** sincroniza o cache à mão; ele invalida (`clearCesium3dCache`) e deixa o evento `*_CHANGED` forçar releitura do repo |
| `mapPosition`, `baseLayer`, `mapNotes`, `gridStyle`, `mapTemporal` | `applyRemoteMapSettingOp` (`:848`) | `baseLayer` emite o **id string**, não o objeto wrapper (emitir `data` fazia o seletor renderizar `[object Object]`). `mapTemporal` é chaveado por **nome** (`temporal_<nome>`) enquanto a op carrega o **UUID**, daí o `mapResolver.resolveToName` obrigatório. Ver [[modulo-temporal]] |
| `catalogLayer` | array `catalogLayers` dentro do registro do mapa | Replace-by-id / remove-by-id |
| `setting` | `terrainExaggeration`, `mapBadgeColors`, `colorUsage`, `customIcons`, `mapOrder` | Cada chave é escrita **exatamente na chave local que o setter local usa**; divergir aqui quebra silenciosamente a leitura |
| desconhecido | `console.warn` + `entityPersisted = false` | — |

**Chaveamento id vs nome**: as operações de 3D/360/comment resolvem UUID→nome antes de chamar o repo, enquanto o caminho de snapshot passa `map.id` direto. Os dois funcionam porque `local.repository._resolveMapKey` normaliza qualquer um dos dois (`local.repository.js:442`, `:530`, `:555`). Não confie nessa simetria em código novo; resolva explicitamente.

## 5. Feature antes do mapa: buffer, não drop

Cenário real: A cria um mapa e desenha imediatamente. A op `feature/create` pode chegar no peer antes de `map/create`. `applyRemoteFeatureOp` faz `repo.getMap(mapId)`; se não existe, **buffer** em `pendingFeatureOps` (cap `MAX_PENDING_PER_MAP = 1000`, `:45`) e **retorna `false`** (`:398`). Dropar seria perda de dados silenciosa.

O `false` é carregado até `:346`: um op apenas bufferizado **não** registra `serverVersion` no `lastAppliedVersion`, senão uma op legítima posterior seria descartada por `shouldApplyVersion`.

`drainPendingFeatureOps(mapId)` (`:59`) replaya na ordem de chegada, e é chamado em dois pontos: `applyRemoteMapOp` CREATE (`:551`) e por mapa em `applyRemoteSnapshot` (`:1172`). Como o replay **contorna** `applyRemoteOperation`, o guard de versão é reaplicado à mão dentro do drain (`:67`, `:78-79`).

> **Nota histórica.** guia *05-sync-crdt* (absorvido) §16 mostra `applyRemoteOperation` fazendo `mergeChanges(existing, op.changes)` no UPDATE e `store.delete(op.entityId)` num object store por entityType; o código em `src/js/store/sync/remote-operation-handler.js:431` faz `features[index] = data` (substituição cega da feição inteira, sem `op.changes` e sem criar quando ausente) e guarda as feições **dentro do registro do mapa**, não num store `features` separado. O pseudocódigo do guia é ilustrativo; a granularidade LWW é a feição inteira.

## 6. Snapshot e pull: o mesmo destino, outra porta

`applyRemoteSnapshot(snapshot)` (`:1150`) atende três chamadores: `connect({initialPull})`, `pull()` quando o servidor devolve snapshot em vez de ops (`sync-engine.js:316`), `resync()` (`:338`) e a resposta WS `sync_response` (`sync-engine.js:414`). Ver [[snapshot-e-pull-incremental]] e [[sessao-boot-e-ciclo-de-vida]].

Pontos que causam perda de dados se esquecidos:

- `reshapeSnapshotMap` (`:1087`) converte as colunas snake_case do backend (`base_layer`, `notes_title`, `grid_style`, `temporal_config`, `locked`) para o shape local e **redistribui** cada uma no side-store certo. Notes e grid por **id** (`map_notes_<id>`, `gridStyle_<id>`); temporal e lock por **nome** (`temporal_<nome>`, `mapLocked_<nome>`). Salvar a linha verbatim faria o loader camelCase perder `baseLayer` e os side-stores ficarem vazios.
- `locked` também alimenta `memoryStore.lockedMaps` e emite `MAP_LOCK_CHANGED` (`:1124-1126`): persistir só o setting fazia o lock valer no peer somente depois de trocar de mapa e voltar, porque o gate real de edição é `isCurrentMapLockedSync`, que lê a memória.
- Layers, cesium3d, streetview360, groups e comments vêm **inline** no mapa do snapshot, mas todo leitor os lê de **side-stores dedicados**. O snapshot precisa persistir cada um explicitamente (`:1177-1210`); sem isso um atlas puxado re-exporta sem camadas/3D/360 (P11, round-trip). Ver [[formato-ebgeo-roundtrip]].
- `comments` chega como **array** e precisa virar `{ [id]: comment }`. Ausente para viewers read-only (o servidor omite). Ver [[permissoes-atlas]].
- Groups chega como array e precisa ir para o group store (por id) **e** o cache em memória (por nome).

`atlas_updated`, `map_duplicated` e `maps_merged` (`ws-client.js:352-358`) existem porque essas mudanças acontecem **fora do log de ops** (clone/merge/rename via REST). Elas viram `serverResync` e disparam `syncEngine.resync()`, um snapshot fresco. Ver [[clone-atlas]] e [[api-rest-atlas]].

## 7. Sinal final e render

Ao fim de `applyRemoteOperation` (`:355-363`):

- span `apply.persist` (a "confirmação de escrita no IndexedDB do peer", elo final do full-chain), **pulado** quando a feature foi apenas bufferizada ou quando `entityPersisted === false` (slide, tipo desconhecido). O drain emite o `apply.persist` dele quando de fato escreve (`:72`).
- `emit(EventTypes.REMOTE_OPERATION_APPLIED, { operation })` **sempre**, inclusive para o caso bufferizado e para tipo desconhecido.

O redesenho não é feito aqui. As camadas MapLibre reagem aos eventos de ciclo de vida (`FEATURE_CREATED/MODIFIED/DELETED`, `LAYERS_CHANGED`) e reconstroem a fonte GeoJSON. `applyRemoteMapOp` emite `LAYERS_CHANGED` além de `MAP_*` justamente porque a lista de mapas, o card do mapa atual e o badge de recentes escutam `LAYERS_CHANGED`, não `MAP_*` (`:571-572`).

## Armadilhas ao mexer aqui

- **Nunca chame o guard de permissão, o log de operação ou o undo** no caminho inbound (contrato no cabeçalho do arquivo, `:11-15`). Logar geraria loop de feedback; o servidor já validou permissão; undo é local por usuário. Ver [[permissoes-atlas]].
- **Nunca aplique ops em paralelo.** Qualquer novo chamador de `applyRemoteOperation` fora do `_applyChain` (por exemplo um `for` com `Promise.all`) reintroduz o clobber de IndexedDB. `pull()` e `sync_response` usam `for ... await` sequencial de propósito (`sync-engine.js:318`, `:416`).
- **Persista sempre, não apenas emita.** Se você adicionar um `entityType`, escreva no mesmo store e com a mesma chave que o setter local usa, e confira se o consumidor lê por id ou por nome.
- **Não ordene por `timestamp` nem por `lamport`.** O vencedor é sempre `max(serverVersion)`. Ver [[modelo-conflito-lww]] e [[idempotencia-e-convergence-guard]].
- `applyRemoteFeatureOp` é declarada com 5 parâmetros (`opType, featureId, mapId, data, serverVersion`, `:389`) mas é chamada com 7 em `:282` e `:68` (passando `operation.id` e `operation.traceId`); os extras são ignorados. Em par com isso, `bufferPendingFeatureOp` guarda apenas `{opType, featureId, data, serverVersion}` (`:397`), então o `record(APPLY_PERSIST)` do drain lê `op.opId`/`op.traceId` como `undefined` (`:73`). Efeito limitado ao [[syncledger]] (dev/teste): o span do replay perde a chave de join. Se você for corrigir, propague os dois campos no objeto bufferizado.
- `applyRemoteFeatureOp` UPDATE **não cria** a feição ausente. Numa sequência em que o CREATE se perdeu, o UPDATE é engolido em silêncio; a recuperação é o `sync_request`/snapshot, não o handler.

## Fontes

- guia *arquitetura-sync* (absorvido) §6 (Fluxo INBOUND), §7 (snapshot/pull/boot), §"LWW por ordem de chegada" e a tabela de mensagens WS: a espinha do fluxo, o convergence guard e o mapa de responsabilidades por arquivo.
- guia *05-sync-crdt* (absorvido) §16 e §"Eco do autor": modelo conceitual de apply remoto (pseudocódigo divergente do código, ver contradição) e a regra de self-echo.
- guia *03-sync-inicial* (absorvido): contrato do pull híbrido (`sinceVersion = 0` → snapshot completo) e o fato de o snapshot já vir no shape do IndexedDB do frontend.
- `src/js/store/sync/remote-operation-handler.js`: convergence guard, buffer de feature-antes-do-mapa, todos os handlers por entidade, `reshapeSnapshotMap`, `applyRemoteSnapshot`.
- `src/js/store/sync/ws-client.js`: roteamento por `type`, cursor `_lastVersion`, filtro de self-echo, cadeia `_applyChain`.
- `src/js/store/sync/sync-gateway.js`: gate por `connectionState.isOnline()` e avanço do relógio de Lamport.
- `src/js/store/sync/sync-engine.js`: `_wireOnce`, `recordPushAcks` (semente da versão do próprio autor), `pull`/`resync`, `_reconcileConvergenceGuard`.
- `src/js/store/sync/operation-dispatcher.js`: `markLocalEditPending` no caminho outbound (a outra metade do guard).
- `src/js/store/repositories/local.repository.js`: `_resolveMapKey` normalizando chave por id ou por nome.

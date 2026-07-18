# Envelope de Operação

Unidade atômica de sincronização do EBGeo: um objeto `{id, entityType, operationType, entityId, mapId, data/changes, timestamp, lamportTimestamp, clientId, traceId}` criado por `operation-factory` e aceito pelo backend em dois vocabulários (frontend e legacy).

## Por que existe

Não há rota REST de escrita para entidades colaborativas (feição, camada, grupo, mapa, briefing, slide, 3D, 360). Toda mutação sincronizável vira uma operação e viaja por push HTTP ou pelo canal WS. Isso concentra ordenação, idempotência e permissão em um único ponto, e é o que permite o modo offline-first: a operação nasce no cliente, é persistida em IndexedDB e só depois sai pela rede (ver [[fila-operacoes-outbound]]).

## Shape real emitido pelo cliente

`createOperation()` (`src/js/store/sync/operation-factory.js:140-164`) devolve sempre:

```jsonc
{
  "id":               "<uuid>",             // generateUUID(); chave de idempotencia e de juncao
  "entityType":       "feature",            // ver EntityType em operation-types.js
  "operationType":    "create",             // create | update | delete
  "entityId":         "<uuid>",
  "mapId":            "<uuid>|null",        // contexto de mapa; null em ops de nivel atlas
  "data":             { ... } | null,       // payload (tambem no update, ver armadilha abaixo)
  "previousData":     { ... } | null,       // estado anterior, para undo LOCAL
  "timestamp":        1700000000000,        // Date.now()
  "lamportTimestamp": 42,                   // ++lamportClock
  "clientId":         "<uuid persistente>",
  "traceId":          "<uuid do gesto>|null"
}
```

Operações em lote (`createBatchOperations`, `operation-factory.js:172-192`) acrescentam `batchId` e `batchIndex`, e compartilham um único `timestamp` de parede; cada item ainda recebe `id` e `lamportTimestamp` próprios.

O envelope é gravado **verbatim** na fila e empurrado **verbatim** para o servidor: `flush()` faz `apiClient.pushOperations(atlasId, ops)` com os objetos da fila sem projeção (`sync-engine.js:262-291`, `api-client.js:841-843`). Ou seja, `previousData`, `lamportTimestamp`, `batchId` e `traceId` cruzam a rede; o Joi do backend usa `.unknown(true)`, então campos extras sobrevivem em vez de serem cortados.

## Campo a campo, e o que cada um NÃO faz

- **`id`** é a âncora de tudo: sobrevive intacto por `push → INSERT → broadcast → apply`, é a chave do índice `UNIQUE (atlas_id, op_id)` e a chave de junção do [[syncledger]]. Sem `id` o push é rejeitado com 422. Ver [[idempotencia-e-convergence-guard]] e [[ack-idempotencia]].
- **`entityType`** vem do enum `EntityType` (`operation-types.js:8-37`) e é validado na criação: tipo inválido faz `createOperation` lançar `Error`, não emitir silenciosamente. Lista e mapeamento para tabelas em [[tipos-entidade-sync]].
- **`entityId`** obrigatório; ausente lança `Error('Entity ID is required')`.
- **`mapId`** é o contexto, não o alvo. Ops de nível atlas (`map`, `briefing`, `setting`) passam `null`.
- **`timestamp`** é display e ordenação **local** da fila. Nunca ordena entre máquinas.
- **`lamportTimestamp`** avança em `max(local, remoto)+1` a cada apply remoto (`advanceLamportClock`, `operation-factory.js:85-87`, chamado em `sync-gateway.js:48-49`). É persistido e ecoado no pull, mas o reducer de conflito nunca o consulta: o vencedor é decidido por `serverVersion`. Ver [[modelo-conflito-lww]] e [[sintese-nao-e-crdt]].
- **`clientId`** é estável por navegador (`localStorage['ebgeo_client_id']`, `getClientId()` em `operation-factory.js:41-51`), com fallback em memória quando `localStorage` não existe ou lança (Node, iframe sandbox, modo privativo). Serve para dedupe do próprio eco e para presença. **Não é credencial** (ver [[client-id-estavel]]).
- **`traceId`** é ambiente: `runTransaction` minta um por gesto e o injeta via `setActionTraceId`, de modo que todas as ops do mesmo gesto compartilhem um id (`store-transaction.js:115-122`). É best-effort, `null` nunca quebra o sync.
- **`serverVersion` NÃO é campo do cliente.** É carimbado pelo servidor e volta no ack, no broadcast e no pull. É a única chave de ordenação correta ([[tabela-operations]]).

## Os dois vocabulários

O backend aceita o vocabulário frontend (`entityType` / `operationType` / `entityId`) e o legacy (`target` / `type` / `targetId`), normalizando entre eles; a validação exige apenas que pelo menos um de cada par esteja presente, então misturar campos é legal. Nas respostas de pull incremental os nomes voltam sempre no vocabulário frontend. Os dois vocabulários são [[sintese-contratos-congelados]]: remover o legacy quebraria clientes antigos, remover o frontend quebraria este cliente.

## Armadilhas

**1. O cliente nunca emite `changes`.** O guia descreve `changes` como o campo de update, mas `createOperation` só produz `data` (`operation-factory.js:151-163`); não há nenhuma ocorrência de `changes` em `src/js/store/sync/*.js`. O backend cobre isso: quando `changes` está ausente num `update`, ele usa `data` como `changes`. Se você ler o guia e esperar `changes` no envelope de saída, vai procurar um campo que não existe.

> [!CONTRADICAO 2026-07-18] docs/guias/05-sync-crdt.md §1 e §14 apresentam o "Formato Frontend" com `changes` no update e sem `previousData`/`lamportTimestamp`/`batchId`; o código em src/js/store/sync/operation-factory.js:151-163 sempre emite o payload em `data` e sempre inclui `previousData`, `lamportTimestamp` e `traceId`. O próprio §3 do guia ("Compatibilidade com o store do frontend") reconhece o comportamento as-built, mas a interface normativa do §1 continua desalinhada.

**2. `previousData` é local, não é um contrato de servidor.** Existe para undo no cliente. Ele viaja porque o envelope vai verbatim, não porque o backend precise dele. Não construa lógica de merge servidor-side em cima disso.

**3. Uma op malformada envenena o lote inteiro.** O push roda numa única transação: se uma operação falhar, o batch inteiro é revertido e nada é dequeued. Por isso o dispatcher dropa preventivamente, antes de enfileirar (`operation-dispatcher.js:105-139`): logging desabilitado, `SETTING` com `entityId` não-UUID que não seja o sentinel `'atlas'`, e qualquer op com `mapId` não-UUID (mapa local nome-chaveado, ex. `Principal`). Um `mapId` não-UUID faz o Postgres devolver 22P02 e trava todo o sync. Os motivos são registrados como span `preflush.drop` com `DropReason` (`diag/trace-stages.js:54-63`). Ver [[store-origin-local-remoto]].

**4. Compactação altera o envelope antes do envio.** Ao passar do teto da fila, `CREATE + DELETE` remove ambos e `CREATE + UPDATEs` vira um único `CREATE` com o `data` mais recente (`operation-queue.js:324-345`). O `id` que chega ao servidor pode não ser o `id` do gesto original: não assuma correspondência 1:1 entre gestos e linhas em `operations`.

**5. A ordem da fila vem do `timestamp`.** A chave de armazenamento é `${timestamp}_${id}` (`operation-queue.js:83-85`) e `peek` devolve por chave ordenada. Isso ordena bem dentro de um cliente, mas é irrelevante entre clientes: a ordem canônica é a de chegada ao servidor.

## Ciclo de vida

1. Mutação no store chama `logXxxOperation` dentro do `deferAsync` de `runTransaction` (persistência primeiro).
2. `logOperation` aplica os gates, cria o envelope, enfileira e marca edição local pendente para os tipos guardados (`operation-dispatcher.js:141-159`).
3. `sync-flush.js` drena a fila a cada 1,5s (e de forma oportunista em eventos de mudança), apenas quando `connectionState.isOnline()`.
4. `flush()` empurra em lotes de 100, registra `push.ack` por op e semeia o `serverVersion` do próprio autor no guard de convergência (`sync-engine.js:57-79`) — necessário porque o autor filtra o próprio eco WS e de outro modo nunca saberia sua ordem de chegada.
5. Servidor persiste, carimba `serverVersion` e faz broadcast; peers aplicam via [[aplicacao-operacoes-remotas]].

Em tempo real o mesmo envelope também sai pelo WS como `{ type: 'operation', op }` ou `{ type: 'operations', ops }` (`ws-client.js:161-172`); o push HTTP é o caminho de recuperação. Ver [[sintese-rest-vs-websocket]] e [[canal-collab-websocket]].

## Relacionados

[[tipos-entidade-sync]], [[fila-operacoes-outbound]], [[modelo-conflito-lww]], [[idempotencia-e-convergence-guard]], [[snapshot-e-pull-incremental]], [[tabela-operations]], [[permissoes-atlas]], [[syncledger]], [[sync-lww-operacoes]], [[atlas]].

## Fontes

- `docs/guias/05-sync-crdt.md`: contrato dos dois vocabulários, validação Joi (`id` obrigatório, máx. 500 ops/push, 422), tabela de entityTypes e sub-entidades de mapa, semântica de push/pull, idempotência por `op_id`, atomicidade do batch, geração de `clientId`.
- `docs/arquitetura-sync.md` §3: shape canônico do envelope, distinção `serverVersion` vs `timestamp` vs `lamportTimestamp`, papel do `op.id` como âncora, mapeamento de entityTypes no backend.
- `src/js/store/sync/operation-factory.js`: shape realmente emitido (`previousData`, `lamportTimestamp`, `traceId`, `batchId`/`batchIndex`), validação de tipos, `getClientId` com fallback, relógio Lamport.
- `src/js/store/sync/operation-dispatcher.js`: gates de pré-flush e seus motivos.
- `src/js/store/sync/operation-queue.js`: chave `timestamp_id`, ordem de peek, regras de compactação.
- `src/js/store/sync/sync-engine.js` / `sync-flush.js` / `api-client.js` / `ws-client.js`: push verbatim em lotes de 100, ack por op, gating por conexão, envio pelo WS.

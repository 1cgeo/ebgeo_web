# Idempotência por op_id e Convergence Guard

Dois mecanismos que tornam o reenvio seguro e a convergência estável: `UNIQUE(atlas_id, op_id)` + `ON CONFLICT DO NOTHING` no servidor, e o adiamento no cliente de ops remotas sobre entidades com edição local ainda não-ackada.

## Por que os dois existem

São problemas diferentes e independentes:

- **Idempotência (servidor)** resolve a *duplicação*: a rede não garante entrega exatamente-uma-vez, então a fila do cliente reenvia lotes inteiros após timeout ou reconexão. Sem chave de idempotência, cada reenvio criaria feições duplicadas.
- **Convergence guard (cliente)** resolve a *divergência*: o modelo é LWW por ordem de chegada ao servidor (ver [[modelo-conflito-lww]]), mas a edição local é otimista e ainda não tem `serverVersion`. Aplicar uma op remota nessa janela pode sobrescrever uma edição local mais nova e deixar os peers divergentes para sempre.

Nenhum dos dois é CRDT. O servidor define a ordem total; o `lamportTimestamp` viaja no envelope mas não decide nada (ver [[sintese-nao-e-crdt]] e [[envelope-operacao]]).

## Idempotência por op_id (servidor)

O `op.id` gerado pelo cliente ([[client-id-estavel]] é outra coisa: identifica o cliente, não a op) é gravado na coluna `op_id` da [[tabela-operations]], protegida por índice único:

- `ebgeo_backend/src/database/migrations/003_sync.sql:39` declara `op_id TEXT`, e `:52` cria `CREATE UNIQUE INDEX operations_atlas_op_id_uniq ON operations (atlas_id, op_id)`.
- `ebgeo_backend/src/modules/sync/sync.queries.js:3-8` (`INSERT_OPERATION`) faz `ON CONFLICT (atlas_id, op_id) DO NOTHING RETURNING *`.

O caminho de push (`sync.service.js`, `pushOperations`):

1. `pg_advisory_xact_lock(SYNC_PUSH_LOCK_NAMESPACE, hashtext(atlasId))` serializa pushes **por atlas** (`sync.service.js:650`), o que torna `server_version` um cursor de pull incremental confiável (ver [[snapshot-e-pull-incremental]]). Atlas diferentes seguem em paralelo.
2. `normalizeOperation` → `assertOperationAllowed(op, permission)` ([[permissoes-atlas]]).
3. `INSERT_OPERATION` (`sync.service.js:663`). Se `inserted` for `null`, a op já existia: o servidor busca `GET_OPERATION_BY_OP_ID` e devolve `{ idempotent: true, serverVersion, entityId }` **sem reaplicar o efeito** (`sync.service.js:685-706`).
4. Só quando o INSERT de fato aconteceu é que `applyOperation` escreve nas tabelas de entidade.

### Armadilhas

- **`op_id` sempre obrigatório.** `sync.schemas.js:14` exige `id: Joi.string().required()`, então uma op sem id é rejeitada na validação. Isso importa porque em Postgres `NULL` não colide em índice único: se um `op_id` nulo chegasse ao banco, cada reenvio inseriria uma linha nova e a idempotência sumiria silenciosamente. O schema é a única barreira, não relaxe.
- **`idempotent: true` não significa erro.** É informação, não falha. O cliente deve tratar `idempotent` `true` e `false` exatamente igual no dequeue da [[fila-operacoes-outbound]] (ver [[ack-idempotencia]]).
- **Idempotência é do log, não do efeito.** Ela impede reaplicar a *mesma* op. Duas ops **distintas** sobre a mesma entidade continuam sendo LWW por chegada, e a granularidade é a feição inteira.
- **`entity_id` é UUID NOT NULL no log.** Ops de nível atlas chegam com o sentinela não-UUID `'atlas'` e são registradas contra o id do próprio atlas (`sync.service.js:670-676`); o ack devolve `entityId` **como gravado** para que broadcast ao vivo e pull incremental concordem.

## Convergence guard (cliente)

Vive em `src/js/store/sync/remote-operation-handler.js` e é aplicado genericamente em `applyRemoteOperation`, de modo que cada handler de entidade permanece alheio a ele.

Três estruturas em memória:

- `lastAppliedVersion` (`remote-operation-handler.js:89`): maior `serverVersion` já aplicado por entidade.
- `pendingLocalEditCount` (`:101`): contagem de edições locais **não-ackadas** por entidade.
- `deferredRemoteOps` (`:104`): buffer de ops remotas adiadas, com teto `MAX_DEFERRED_PER_ENTITY = 200` (`:107`) para que uma edição que nunca receba ack não faça o buffer crescer sem limite.

Tipos guardados, `CONVERGENCE_GUARDED` (`:115-125`): `FEATURE`, `LAYER`, `GROUP`, `MARKER_3D`, `MEASUREMENT_3D`, `VIEWSHED_3D`, `CAMERA_POSITION_3D`, `ORIENTATION_360`, `MARKER_360`. São exatamente os tipos cujo UPDATE substitui em bloco. `MAP`, `BRIEFING`, `COMMENT`, `SETTING` e `SLIDE` ficam de fora (ver [[tipos-entidade-sync]]).

### Fluxo

1. **Saída.** `operation-dispatcher.js:147` chama `markLocalEditPending(entityId)` logo após o `enqueue`, para todo tipo guardado. A partir daí a entidade está "em edição local".
2. **Entrada.** Em `applyRemoteOperation` (`remote-operation-handler.js:265-272`): se `pendingLocalEditCount > 0`, a op remota é **adiada** (`deferRemoteOp`) e a função retorna; senão, é descartada quando `!shouldApplyVersion(entityId, serverVersion)`.
3. **Ack.** `recordPushAcks` (`sync-engine.js:60-79`) lê a resposta do push e chama `recordLocalAppliedVersion` (alias de `resolveLocalEdit`, `remote-operation-handler.js:224`) para cada op guardada. Isso semeia a própria `serverVersion` do autor, decrementa a contagem pendente e, quando ela zera, **replaya** as ops adiadas por `applyRemoteOperation` (agora sujeitas à guarda de versão).
4. **Registro.** Depois do handler rodar, `markAppliedVersion` grava a versão aplicada; um `DELETE` **apaga** a entrada (`:346-348`) para que um re-create comece do zero.

`shouldApplyVersion` (`:128`) retorna `true` quando `serverVersion == null` (op sem carimbo, cenário sem backend) e compara com `>=`, não `>`.

### Por que o autor precisa semear a própria versão

O cliente **filtra o próprio eco pelo `clientId`** no [[canal-collab-websocket]]. Sem `recordPushAcks`, o autor nunca saberia a ordem de chegada da própria op, e uma op **mais antiga** de um peer passaria por `shouldApplyVersion` e sobrescreveria o valor correto. O comentário em `sync-engine.js:73-77` documenta exatamente isso.

### Auto-cura pós-flush

A simetria increment/decrement vaza: compactação da fila (CREATE+DELETE remove ambas), ops em lote, acks sem versão, ou um lote envenenado. Uma contagem vazada deixaria a entidade com ops remotas **permanentemente adiadas**, ou seja, divergência silenciosa.

`reconcilePendingLocalEdits(remainingEntityIds)` (`remote-operation-handler.js:203`) reconcilia contra a **fila de operações, que é a fonte de verdade**: toda entidade guardada que já não tem op enfileirada tem o adiamento limpo e as ops adiadas replayadas. É chamada por `_reconcileConvergenceGuard` (`sync-engine.js:296-306`) **tanto no sucesso quanto na falha** do flush (`:275`, `:288`). Não confie só no par mark/resolve.

### Armadilhas

- **Só o ack HTTP semeia a versão do autor.** `ws-client.js:292-311` emite eventos `ack`/`ack_batch`, mas nenhum consumidor em `sync-engine.js`/`sync-flush.js` os assina. Todo o seeding vem de `recordPushAcks` no caminho `POST /atlas/:id/sync`. Se um dia o push migrar para o WebSocket, o guard quebra sem aviso (ver [[sintese-rest-vs-websocket]]).
- **Estado é in-memory e por aba.** `lastAppliedVersion` e amigos não são persistidos; F5 zera tudo. A reconciliação real após reload vem do snapshot / pull incremental.
- **Feição cujo mapa ainda não chegou é bufferizada, não aplicada.** `applyRemoteFeatureOp` devolve `false` e a op vai para `pendingFeatureOps` (`:397`). Nesse caso a versão **não** é registrada (`:345`), senão uma op legítima posterior seria descartada. `drainPendingFeatureOps` (`:59-82`) reaplica na ordem de chegada, repetindo a guarda de versão manualmente porque esse caminho **contorna** `applyRemoteOperation`. Ao mexer na guarda, lembre desse segundo ponto de aplicação.
- **`SLIDE` inbound é no-op**: slides convergem via a op de `BRIEFING` pai.

Cobertura: `tests/integration/remote-operation-handler.test.js` (bloco "Convergence guard, defer / ack-replay / self-heal", a partir de `:1157`).

## Contradições encontradas

Nenhuma divergência entre os documentos lidos e o código. Registro apenas duas notas de código:

- `applyRemoteFeatureOp` é declarada com 5 parâmetros (`remote-operation-handler.js:389`) mas chamada com 7 (`:68`, `:282`, passando `opId` e `traceId`); os dois extras são ignorados dentro da função e os spans de [[syncledger]] correspondentes são emitidos pelos chamadores.
- guia *arquitetura-sync* (absorvido):350` já corrige uma versão anterior de si mesmo que listava a convergência concorrente como "limite conhecido"; esse texto descrevia o estado pré-guard e não vale mais.

## Relacionados

[[envelope-operacao]], [[modelo-conflito-lww]], [[fila-operacoes-outbound]], [[aplicacao-operacoes-remotas]], [[tabela-operations]], [[ack-idempotencia]], [[snapshot-e-pull-incremental]], [[modelo-conflito-lww]], [[sintese-nao-e-crdt]], [[syncledger]].

## Fontes
- guia *05-sync-crdt* (absorvido): seção 12 (idempotência por `op_id`, ack `idempotent`, `op_id` nunca nulo por validação 422) e seção 15 (dispatcher, por que reenviar a fila inteira é seguro).
- guia *arquitetura-sync* (absorvido): §11 (LWW + idempotência + guardas de convergência), passo 5/6 do fluxo de push (`recordPushAcks`, `ON CONFLICT`), §tabela `operations`, lista `CONVERGENCE_GUARDED`.
- `src/js/store/sync/remote-operation-handler.js`: implementação do guard (defer, `shouldApplyVersion`, `resolveLocalEdit`, `reconcilePendingLocalEdits`, buffer de feições órfãs).
- `src/js/store/sync/sync-engine.js`: `recordPushAcks` e `_reconcileConvergenceGuard` no flush.
- `src/js/store/sync/operation-dispatcher.js`: ponto de `markLocalEditPending`.
- `src/js/store/sync/ws-client.js`: acks WS emitidos mas não consumidos.
- `ebgeo_backend/src/modules/sync/{sync.queries.js,sync.service.js,sync.schemas.js}` e `src/database/migrations/003_sync.sql`: índice único, `ON CONFLICT DO NOTHING`, advisory lock por atlas, `id` obrigatório.

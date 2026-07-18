# Ack de operação e idempotência

Cada operação enviada volta em `ack` (ou `ack_batch`) com um objeto `result` contendo `success`, `operationId`, `idempotent` e `currentVersion`, e `idempotent: true` deve ser tratado como sucesso para um dequeue confiável da fila offline.

## Onde a idempotência realmente mora

A garantia não está no cliente nem em lógica de aplicação: está em um índice único no banco.

```sql
CREATE UNIQUE INDEX operations_atlas_op_id_uniq ON operations (atlas_id, op_id);
```
(`ebgeo_backend/src/database/migrations/003_sync.sql:52`)

O insert do log de operações é `ON CONFLICT (atlas_id, op_id) DO NOTHING` (`sync.queries.js:3-8`). Se o insert não retorna linha, o servidor sabe que aquele `op_id` já foi registrado, busca a versão gravada com `GET_OPERATION_BY_OP_ID` e devolve o ack **sem reaplicar o efeito** (`sync.service.js:685-694`). Se retorna linha, a op é nova e só então `applyOperation` toca as tabelas de entidade.

Consequências diretas do formato da chave:

- A chave é **(atlas, op_id)**, não o `op_id` sozinho. A mesma operação replayada contra outro atlas é aplicada de novo. Ver [[tabela-operations]] e [[atlas-modelo-de-dados]].
- `op_id` é enviado como `rawOp.id ?? null` (`sync.service.js:668`). Em Postgres, `NULL` é distinto de `NULL` em índice único, então **uma op sem `id` nunca é deduplicada**. Emitir envelope sem `id` quebra silenciosamente a idempotência. Ver [[envelope-operacao]].
- A dedupe vive na tabela `operations`. Purga de log antiga (ver [[sync-admin-operacoes]]) remove o registro que servia de guarda, então um replay muito atrasado voltaria a aplicar.

## O shape do `result`

Um só código de servidor produz os acks e serve os três caminhos (REST, `ack` WS, `ack_batch` WS). `pushOperations` monta `acks[]` internos e projeta o contrato público em `results[]` (`sync.service.js:754-761`):

| Campo | Significado |
|---|---|
| `success` | Op registrada (aplicada **ou** reconhecida como duplicata) |
| `operationId` | O `op.id` enviado, a chave de idempotência |
| `idempotent` | `true` = já existia, efeito **não** reaplicado; `false` = aplicada agora |
| `currentVersion` | `server_version` daquela op, ou a versão atual do atlas como fallback |

O retorno é `{ results, acks, serverVersion }`. `acks[]` é o alias legado (`opId`/`serverVersion`/`entityId`); `results[]` é o contrato congelado. Prefira `results[]`, mas note que `acks[].entityId` carrega informação que `results[]` não tem (o `entity_id` **como gravado**, que difere do enviado em ops de nível atlas, cujo `targetId` sentinela `'atlas'` é regravado com o UUID do próprio atlas em `sync.service.js:664-673`).

Transportes:

- REST `POST /atlas/:id/sync` responde `{ data: { results, acks, serverVersion } }` (`sync.controller.js:39`).
- WS `operation` responde `{ type: 'ack', opId, serverVersion, result }`, com `result = results[0]` (`collab.handlers.js:131-140`).
- WS `operations` responde `{ type: 'ack_batch', opIds, serverVersion, results }`, com `results[i]` correspondendo a `ops[i]` na ordem enviada (`collab.handlers.js:184-191`).

Detalhes do canal em [[canal-collab-websocket]] e [[canal-collab-websocket]]; a divisão de responsabilidade entre os dois transportes em [[sintese-rest-vs-websocket]].

## Armadilha: `success` nunca é `false`

`results` é construído com `success: true` fixo (`sync.service.js:754-759`). Não existe falha parcial dentro de um push. Todo o lote roda em uma transação com advisory lock por atlas (`sync.service.js:634-654`); qualquer erro (permissão negada em `assertOperationAllowed` na linha 660, violação de FK, UUID inválido) faz **rollback do lote inteiro** e vira erro HTTP/`{type:'error'}`, não um `success:false` item a item.

Portanto:

- Não escreva lógica de retry por item baseada em `success`. Se você recebeu 200/`ack`, todos os itens daquele lote passaram.
- Um lote envenenado (uma op inválida) bloqueia todas as outras do lote. Trate o erro do push como "lote inteiro pendente", nunca como parcial. Ver [[erros-api]] e [[fila-operacoes-outbound]].
- Permissão é avaliada por operação dentro da transação, mas o efeito é de lote. Ver [[permissoes-atlas]].

O sinal real de "aplicou algo" não é `success`, é a combinação `idempotent === false` mais o `rowsAffected` que o [[syncledger]] registra no span `SERVER_APPLIED`: um update que casou zero linhas é "acked sem efeito", o invariante I2 (`sync.service.js:732-742`).

## Por que `idempotent: true` é sucesso

O cenário que motiva o campo: a fila outbound faz push, o servidor grava e commita, a resposta se perde na rede. O cliente reenvia. Se ele tratasse a segunda resposta como algo diferente de sucesso, a op ficaria presa na fila para sempre, sendo reenviada em loop. `idempotent: true` diz exatamente "está gravado, pode remover da fila, e não, não dupliquei o efeito".

O `currentVersion` que volta no caso idempotente é a versão **original** da gravação (de `prev.server_version`), não uma nova. Isso preserva a ordem de chegada que decide o LWW (ver [[modelo-conflito-lww]] e [[idempotencia-e-convergence-guard]]). Se `prev` não existir (log purgado), `serverVersion` vem `null` e o `results[]` cai para a versão atual do atlas (`sync.service.js:757`), o que degrada o cursor de pull incremental daquela op. Ver [[snapshot-e-pull-incremental]].

## O que o cliente EBGeo Web realmente faz

Aqui o código diverge da leitura ingênua dos guias, e vale saber antes de "consertar" algo que não está quebrado.

O outbound do frontend é **só REST**. `syncEngine.flush()` faz `apiClient.pushOperations` (`api-client.js:841`) e depois `operationQueue.dequeue(opIds)` usando os **ids que ele enviou**, não os ids que voltaram em `results[]` (`sync-engine.js:284-285`). Como não existe falha parcial, isso é correto: 200 significa lote inteiro aceito, e um throw pula o dequeue, deixando o lote para o próximo peek (`sync-engine.js:270-282`). Ver [[fila-operacoes-outbound]].

Os `results[]` são consumidos apenas para observabilidade: `recordPushAcks` (`sync-engine.js:60-72`) casa cada op ao seu `result` por `operationId` e emite o span `push.ack` com outcome `IDEMPOTENT` / `FAILED` / `OK`.

No caminho WebSocket, `ws-client.js:292-312` trata `ack` e `ack_batch`, grava spans `PUSH_ACK` e reemite um evento interno `'ack'` normalizado (`{opIds, serverVersion, results}`). Esse evento **não tem assinante** no app, e `sendOperation`/`sendOperations` (`ws-client.js:162,171`) não têm chamador fora do próprio módulo. Ou seja: o ack WS é um contrato de servidor plenamente implementado e um caminho cliente atualmente inerte. Se você passar a enviar ops por WS, aí sim o dequeue precisa consumir `results[]`, porque `ack` e `ack_batch` chegam assíncronos e fora de ordem em relação ao envio.

> **Nota histórica.** guia *08-offline-import* (absorvido):120-126` mostra o dequeue iterando `result.data.acks` e chamando `remove(ack.opId)`; o cliente real em `src/js/store/sync/sync-engine.js:285` faz `operationQueue.dequeue(opIds)` com os ids do lote enviado e ignora `results`/`acks` para fins de dequeue (usa-os só no SyncLedger, `sync-engine.js:284`).

## Regras práticas

1. Gere `op.id` uma vez, na criação da op, e **nunca** regenere em retry. Regerar o id destrói a idempotência e duplica o efeito.
2. Mantenha o `clientId` estável entre reconexões: ele participa do de-dupe de eco inbound e da continuidade de presença. Ver [[client-id-estavel]].
3. `idempotent: true` → remova da fila. `idempotent: false` → remova da fila. A distinção é diagnóstica, não de fluxo.
4. Erro no push → não remova nada e não fatie o lote por item.
5. `serverVersion` do ack é a ordem de chegada autoritativa; use-a como cursor, não o timestamp do cliente.

## Fontes
- guia *04-websocket-collab* (absorvido): protocolo `ack`/`ack_batch`, tabela de campos de `result`, contrato congelado `result` (objeto) vs `results[]` (array na ordem enviada), instrução de tratar `idempotent:true` como sucesso.
- guia *08-offline-import* (absorvido): fluxo de reconexão (pull então push), fila pendente em IndexedDB, exemplo de dequeue por acks (divergente do cliente real).
- `ebgeo_backend/src/modules/sync/sync.service.js`: `pushOperations`, insert idempotente, montagem de `acks[]`/`results[]`, spans do SyncLedger.
- `ebgeo_backend/src/modules/sync/sync.queries.js` e `src/database/migrations/003_sync.sql`: `ON CONFLICT (atlas_id, op_id) DO NOTHING` e o índice único que sustenta a dedupe.
- `ebgeo_backend/src/modules/collab/collab.handlers.js` e `src/modules/sync/sync.controller.js`: emissão de `ack`/`ack_batch` e da resposta REST.
- `ebgeo_web/src/js/store/sync/{sync-engine,ws-client,api-client,operation-queue}.js`: dequeue real por lote, consumo dos acks só em tracing, caminho WS inerte.

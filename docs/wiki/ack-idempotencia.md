# Ack de operação e idempotência

Cada op enviada volta em `results[]` (REST, `ack` e `ack_batch` usam o mesmo produtor, `backend/src/modules/sync/sync.service.js:754-761`), e `idempotent: true` é sucesso, não falha.

O mecanismo de dedupe em si (índice único `(atlas_id, op_id)` + `ON CONFLICT DO NOTHING`) está descrito em [[idempotencia-e-convergence-guard]]. Esta página trata do que o **ack devolve** e de como o cliente o consome.

## Por que `idempotent: true` conta como sucesso

O cenário que motivou o campo: o servidor grava e commita, a resposta se perde na rede, o cliente reenvia. Se a segunda resposta fosse tratada como qualquer coisa diferente de sucesso, a op ficaria presa na [[fila-operacoes-outbound]] em loop eterno. `idempotent: true` afirma duas coisas ao mesmo tempo: "está gravado" e "não dupliquei o efeito". Trate `true` e `false` de forma idêntica no dequeue; a distinção é diagnóstica.

## Armadilha: `success` nunca é `false`

`results` é montado com `success: true` literal (`backend/src/modules/sync/sync.service.js:755`). Não existe falha parcial dentro de um push: o lote inteiro roda em uma transação sob advisory lock por atlas (`backend/src/modules/sync/sync.service.js:650`), e qualquer erro (permissão em `assertOperationAllowed`, `backend/src/modules/sync/sync.service.js:660`, FK, UUID inválido) faz rollback do lote e vira erro HTTP ou `{type:'error'}`, nunca um item com `success:false`.

Portanto:

- Nunca escreva retry por item baseado em `success`. Recebeu 200 ou `ack`, passou tudo.
- Uma op envenenada bloqueia todas as outras do lote. O erro do push significa "lote inteiro pendente", jamais parcial. Ver [[erros-api]] e [[permissoes-atlas]].
- O sinal real de "aplicou algo" não é `success`: é `idempotent === false` somado ao `rowsAffected` do span `SERVER_APPLIED` (`backend/src/modules/sync/sync.service.js:732-742`, invariante I2 do [[syncledger]]). Um update que casou zero linhas é acked sem efeito.

## O ack não é só observabilidade (e a armadilha que nasce daí)

Ler `recordPushAcks` de relance sugere tracing puro. Não é: em `frontend/src/js/store/sync/sync-engine.js:76-77` o `currentVersion` de cada `result` é injetado em `recordLocalAppliedVersion` (alias de `resolveLocalEdit`, `frontend/src/js/store/sync/remote-operation-handler.js:224`). O autor filtra o próprio eco de WebSocket e por isso **só aprende a ordem de chegada da própria op pelo ack**. `currentVersion` é insumo de LWW, não um número informativo.

A consequência atravessa backend e frontend e não é visível em nenhum dos dois isoladamente:

> No caso idempotente com log purgado, `prev` não existe, `serverVersion` vem `null` e `currentVersion` cai para a **versão atual do atlas** (`backend/src/modules/sync/sync.service.js:758`). Esse valor é maior que a versão real da op e vai semear `lastAppliedVersion` inflado. A partir daí ops legítimas de peers, com serverVersion menor, são descartadas em silêncio pelo guard: divergência sem erro algum.

Ou seja, purgar o log de operações ([[sync-admin-operacoes]]) não só reabre a janela de replay: contamina o cursor de LWW de quem reenviar. Ver [[modelo-conflito-lww]] e [[snapshot-e-pull-incremental]].

## Contrato congelado

- `results[i]` corresponde a `ops[i]` **na ordem enviada**. Reordenar o lote no servidor quebra todo consumidor que casa por índice.
- `acks[]` é alias legado e não é redundante: carrega `entityId` **como gravado**, que `results[]` não expõe. Ops de nível atlas chegam com o sentinela `'atlas'` e são regravadas sob o UUID do próprio atlas (`backend/src/modules/sync/sync.service.js:664-673`), então broadcast ao vivo e pull incremental só concordam por causa desse campo. Ver [[tabela-operations]] e [[atlas-modelo-de-dados]].
- `op.id` é gerado uma vez na criação da op e **nunca** regenerado em retry. Regerar destrói a idempotência e duplica o efeito. Ver [[envelope-operacao]]; para o `clientId`, que é outra coisa, [[client-id-estavel]].

## O caminho WebSocket está implementado e inerte

O outbound do frontend é só REST. `frontend/src/js/store/sync/ws-client.js:292-312` trata `ack` e `ack_batch` e reemite um evento interno `'ack'` que **não tem assinante**; `sendOperation`/`sendOperations` (`frontend/src/js/store/sync/ws-client.js:161,170`) não têm chamador fora do módulo. Antes de migrar o outbound para WS: o dequeue por lote deixa de ser válido, porque `ack`/`ack_batch` chegam assíncronos e fora de ordem em relação ao envio, e aí `results[]` passa a ser obrigatório para decidir o que remover da fila. Ver [[canal-collab-websocket]] e [[sintese-rest-vs-websocket]].

> **Nota histórica.** guia *08-offline-import* (absorvido):120-126 mostra o dequeue iterando `result.data.acks` e chamando `remove(ack.opId)`. O cliente real (`frontend/src/js/store/sync/sync-engine.js:285`) faz `operationQueue.dequeue(opIds)` com os ids que enviou e ignora `results`/`acks` para fins de dequeue. Isso é correto **apenas** porque não existe falha parcial; se o servidor um dia admitir `success:false` por item, este dequeue passa a apagar ops não gravadas.

## Fontes
- `ebgeo_backend/src/modules/sync/sync.service.js` (`pushOperations`), `backend/src/modules/collab/collab.handlers.js`, `backend/src/modules/sync/sync.controller.js`.
- `ebgeo_web/src/js/store/sync/{sync-engine,ws-client,remote-operation-handler}.js`.
- guias absorvidos *04-websocket-collab* e *08-offline-import* (este último divergente do cliente real).

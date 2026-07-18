# Fluxo Outbound: Fila Durável, Compaction e Flush

Caminho de uma mutação local até o servidor: `runTransaction` persistência-primeiro, `logXxxOperation`, fila IndexedDB com compaction e auto-purge, flush de 1,5s gated em online e push HTTP com ack por operação.

## Visão geral do caminho

```
gesto do usuário
  └─ runTransaction (store-transaction.js:109)   persistência PRIMEIRO
       └─ deferAsync → logXxxOperation (operation-dispatcher.js)
            └─ createOperation (operation-factory.js:140)   envelope + Lamport + clientId + traceId
                 └─ operationQueue.enqueue (operation-queue.js:95)   IndexedDB 'ebgeo/operation_queue'
                      └─ sync-flush.js (timer 1,5s + eventos, só se ONLINE)
                           └─ syncEngine.flush (sync-engine.js:262)  peek(100) → POST /atlas/:id/sync → dequeue
```

Detalhe do envelope em [[envelope-operacao]]; o que o servidor faz depois em [[tabela-operations]] e [[modelo-conflito-lww]].

## 1. Transação persistência-primeiro

`runTransaction(workFn)` (`src/js/store/store-transaction.js:109`) recebe uma `workFn` que prepara dados, registra efeitos (`deferSync`/`deferAsync`) e **retorna** a função de persistência. A ordem é rígida:

1. `await persistFn()` grava no IndexedDB local;
2. `setActionTraceId(traceId)` e `tx.commit()`;
3. `deferSync` (UI, color tracking) e depois `deferAsync` (logging de sync).

Se a persistência lança, `tx.rollback()` descarta **todos** os efeitos e emite `STORE_PERSIST_ERROR` (`store-transaction.js:127-135`). **Consequência prática: nada entra na fila outbound se o dado não ficou durável localmente.** Não existe op sincronizada sem dado local correspondente.

O `traceId` é mintado por gesto (`store-transaction.js:116`) e lido de forma ambiente por `createOperation` (`operation-factory.js:162`). É seguro apesar de global porque não há `await` entre `setActionTraceId` e as chamadas síncronas de `createOperation` dentro do `commit`. Ele é enriquecimento best-effort, o `op.id` é a chave de correlação que sempre funciona ([[syncledger]]).

**Armadilha:** `commit()` roda os efeitos assíncronos em *fire-and-forget* (`store-transaction.js:73-81`). O `await runTransaction(...)` resolve **antes** de a op estar enfileirada. Teste de integração que verifica a fila logo após uma mutação precisa aguardar a microtask, não confiar no `await` da operação de store.

## 2. Dispatcher: onde as ops são descartadas de propósito

`logOperation` (`operation-dispatcher.js:105`) é o funil único. Ele descarta antes de enfileirar em três casos, cada um com um span `preflush.drop` nomeado:

| Guarda | Motivo | Linha |
|---|---|---|
| `enabled === false` | logging desligado (`connectPublic`, `logoutAndDisconnect`) | `:106-114` |
| `setting` com `entityId` que não é UUID nem `'atlas'` | chave de view por-cliente (`lastActiveMap`) nunca pode ir ao servidor | `:120-126` |
| `mapId` de contexto não-UUID | mapa local keyed por nome (o `Principal` default) | `:133-139` |

O motivo dessas guardas é um **poison pill**: o push HTTP roda numa única transação no servidor, então **uma** op com id inválido (Postgres `22P02`) derruba o lote inteiro e trava todo o sync indefinidamente, já que o lote rejeitado nunca é dequeueado. Por isso o filtro é no cliente, antes da fila, e `logBatchOperations` repete o mesmo filtro por item (`:192-198`). Isso também é o anti-leak do mapa local `Principal` descrito em [[store-origin-local-remoto]].

> [!CONTRADICAO 2026-07-18] `docs/arquitetura-sync.md:183` diz que `logOperation` "dropa se o logging está desabilitado (não conectado)", sugerindo que anônimo/offline não enfileira. O código chama `enableOperationLogging()` incondicionalmente em `initServices` (`src/js/store/services.js:81`), então o logging já está **ligado** no boot anônimo. Um usuário offline enfileira ops normalmente para qualquer mapa com id UUID. Quem contém a fila offline é a guarda de `mapId` não-UUID (que dropa tudo do `Principal`) e o auto-purge de 7 dias, não o flag de logging. `disableOperationLogging()` só é chamado em `sync-engine.js:227` (`connectPublic`) e `:375` (`logoutAndDisconnect`).

Ao enfileirar com sucesso, o dispatcher também marca edição local pendente para os tipos sob *convergence guard* (`operation-dispatcher.js:147`), que é o que faz a edição concorrente na mesma feição convergir. Ver [[idempotencia-e-convergence-guard]].

Há um circuit breaker: falha de enfileiramento emite `STORE_SYNC_ERROR` e reagenda um retry único em 2s, até 5 falhas consecutivas (`operation-dispatcher.js:69-90`).

## 3. Fila durável

Instância LocalForage dedicada `name:'ebgeo', storeName:'operation_queue'` (`operation-queue.js:17-20`). Chave `op_{timestamp}_{id}` (`:84`), o que dá ordenação cronológica por **sort lexicográfico** das chaves (`:224-229`). Isso funciona porque epoch em ms tem 13 dígitos e continuará tendo até 2286; qualquer mudança do formato da chave quebra a ordem silenciosamente.

Um índice reverso em memória `opId → chave` (`:46`) é construído preguiçosamente e mantido em `enqueue`/`dequeue`/`clear`, dando `dequeue` O(1) por op. Ele é reconstruído do zero depois de cada compaction (`:311-312`).

### Compaction

Regras em `_compactEntityOps` (`:324-350`), agrupando por `entityType:entityId` em ordem cronológica:

- `CREATE ... DELETE` → remove **ambos** (a entidade nasceu e morreu localmente, nunca precisa existir no servidor);
- `CREATE + UPDATEs` → um único `CREATE` com o `data` mais recente;
- `UPDATEs (+ DELETE)` → mantém apenas a **última** op.

**Armadilha maior desta página:** a compaction **só roda quando a fila passa de `MAX_QUEUE_SIZE = 10000`** (`:29`, gatilho em `:102` e `:121`, com o early-return em `:266`). Ela é uma válvula de sobrecarga, não uma otimização do caminho normal. Em uso corriqueiro, 40 arrastes de uma feição viram 40 `UPDATE`s empurrados um a um. Não escreva código assumindo que a fila "colapsa sozinha" os updates redundantes.

Segunda armadilha: no merge de `CREATE + UPDATEs`, só o campo `data` é atualizado (`:337-343`). O `timestamp`, o `lamportTimestamp` e o `id` permanecem os do `CREATE` original. A op resultante carrega um relógio mais antigo do que a edição que ela representa. Como o modelo é LWW por ordem de chegada no servidor e não por timestamp ([[sintese-nao-e-crdt]]), isso não corrompe a resolução de conflito, mas invalida qualquer raciocínio baseado no Lamport da op.

### Auto-purge

`purgeOldOperations(maxAgeMs = 7 dias)` (`:360`) e `startAutoPurge()` a cada 6 horas (`:378-392`), iniciado em `initServices` (`services.js:82`). Ops com mais de 7 dias são **removidas em silêncio**, sem log por op e sem evento de erro. Um usuário que trabalhou offline por mais de uma semana perde as ops antigas ao reconectar; o dado local persiste (foi gravado primeiro), mas ele não chega aos peers via op log. A recuperação nesse caso é um snapshot fresco ([[snapshot-e-pull-incremental]]), não a fila.

Ver também [[fila-operacoes-pendentes]] para a visão de contrato do backend.

## 4. Flush

`sync-flush.js` mantém **um** loop compartilhado por app (`state` de módulo, `:48-57`). `startAutoFlush(engine = syncEngine, { intervalMs = 1500 })` é idempotente: chamar duas vezes é no-op (`:127`). O timer é ligado/desligado pelo ciclo de conta em `account/account.control.js` e `account/open-atlas.service.js`.

`flushOnce` (`:75`) tem três portões, nesta ordem:

1. `state.inFlight` — nunca dois flushes sobrepostos;
2. `connectionState.isOnline()` — sem conexão ONLINE, nem consulta a fila (`:65`);
3. `operationQueue.count() > 0` — não faz push vazio (`:66-67`).

Erros são engolidos com `console.warn` (`:82-84`) para o loop não morrer. Como o lote falho não é dequeueado, o efeito é retry automático no próximo tick.

Além do timer, o flush é disparado por `FLUSH_TRIGGER_EVENTS` (`:28-45`): FEATURE/LAYER/GROUP/MAP/BRIEFING `CREATED|MODIFIED|DELETED` e `REMOTE_OPERATION_APPLIED`. **Note o que não está na lista:** comentários espaciais, ops 3D/360, catálogo, temporal, notas e grid não têm gatilho por evento, então dependem do tick de 1,5s. Se você adicionar um tipo de entidade cuja latência importa, adicione o evento aqui ([[tipos-entidade-sync]]).

`REMOTE_OPERATION_APPLIED` estar na lista é intencional: receber trabalho de um peer é um bom momento para empurrar o próprio ([[aplicacao-operacoes-remotas]]).

## 5. Push HTTP e ack

`syncEngine.flush()` (`sync-engine.js:262`) faz um laço:

```
peek(FLUSH_BATCH_SIZE=100) → pushOperations → recordPushAcks → dequeue(opIds) → peek de novo
```

O transporte é `POST /api/v1/atlas/:atlasId/sync` com `{ operations }` (`api-client.js:841-843`). Em falha, o span `flush.push{FAILED}` nomeia os `opIds` do lote envenenado e a exceção sobe **sem dequeue**, então os mesmos ops são re-peekados no próximo ciclo (`sync-engine.js:270-283`). Reenviar é seguro por causa da idempotência por `(atlas_id, op_id)` ([[ack-idempotencia]]).

`recordPushAcks` (`sync-engine.js:60-80`) faz mais do que observabilidade: ele **semeia a versão aplicada do próprio autor** (`recordLocalAppliedVersion`) para os tipos sob convergence guard. Isso é necessário porque o autor **descarta o próprio eco** do WebSocket (`ws-client.js:392`, regra `op.clientId === this._clientId`), e sem essa semente ele nunca saberia a ordem de chegada da própria op, permitindo que uma op concorrente mais antiga de um peer sobrescrevesse o valor correto. O ack aceita tanto `results[]` quanto o alias `acks[]`, e cai para `resp.serverVersion` quando não há versão por op (`:62-65`).

Depois do laço, `_reconcileConvergenceGuard()` (`sync-engine.js:298-306`) compara a fila remanescente com os contadores de edição pendente e cura vazamentos causados por compaction, lotes ou ack sem versão.

## 6. Por que HTTP e não WebSocket

Na prática deste cliente, **toda** op de entidade sai por HTTP. `wsClient.sendOperation` / `sendOperations` existem (`ws-client.js:161`, `:170`) mas não têm nenhum call site em `src/`, só em `tests/integration/ws-client.test.js`. O canal WS é usado para inbound de ops, presença, cursor, seleção e `sync_request` ([[canal-collab-websocket]], [[presenca-tempo-real]]).

> [!CONTRADICAO 2026-07-18] `docs/guias/05-sync-crdt.md:494-495` diz "Em tempo real, prefira o canal WebSocket; o push HTTP é o caminho de recuperação", e o pseudo-código do §15 (`docs/guias/05-sync-crdt.md:967-970`) envia a op por WS quando conectado, deixando o HTTP só para a fila. O cliente real nunca faz isso: `syncEngine.flush` (`src/js/store/sync/sync-engine.js:262-291`) empurra sempre por `POST /atlas/:id/sync`, e `wsClient.sendOperation` (`src/js/store/sync/ws-client.js:161`) não tem chamador em produção. O guia descreve um contrato de backend suportado, não o comportamento implementado.

A escolha tem uma consequência de projeto: como o broadcast do servidor não consegue excluir o autor num push HTTP, o autor recebe o próprio eco pelo WS e o filtra por `clientId` ([[client-id-estavel]]). Ver o trade-off em [[sintese-rest-vs-websocket]].

## 7. Checklist para não errar

- Toda nova mutação de store loga a op dentro do `deferAsync`, nunca antes da persistência.
- Entidade nova precisa de entrada em `EntityType` e de um `logXxxOperation` no dispatcher; sem isso a mutação é puramente local ([[tipos-entidade-sync]]).
- Se a op é escopada em mapa, o `mapId` **tem** que ser UUID; caso contrário ela é dropada pré-flush por design.
- Não presuma compaction: ela só existe acima de 10000 ops pendentes.
- Não presuma que a fila seja o único caminho de convergência: divergência longa se resolve por snapshot.
- Papel/permissão do usuário não é checada no dispatcher; o gate fino é do servidor por operação ([[permissoes-atlas]], [[permissao-vs-papel]]).
- Blobs de imagem não viajam na fila de ops, têm caminho próprio ([[imagens-atlas]]).
- Para depurar "editei e nada sincronizou", siga os spans `action.origin → enqueue → flush.push → push.ack` ([[syncledger]]).

## Fontes

- `docs/arquitetura-sync.md`: seção 5 (Fluxo OUTBOUND passo a passo), tabela de módulos do sync, nota de idempotência e do convergence guard, spans do SyncLedger.
- `docs/guias/05-sync-crdt.md`: contrato do `POST /atlas/:atlasId/sync` (request, `results[]`/`acks[]`, atomicidade do lote em transação única), idempotência por `op_id`, pseudo-código do dispatcher (§15, divergente do código).
- `src/js/store/store-transaction.js`: ordem persistência → deferSync → deferAsync, rollback, mint do `traceId`.
- `src/js/store/sync/operation-dispatcher.js`: guardas de drop pré-flush, circuit breaker, loggers por entidade.
- `src/js/store/sync/operation-queue.js`: chave, índice reverso, regras e gatilho de compaction, auto-purge de 7 dias.
- `src/js/store/sync/sync-flush.js`: timer de 1,5s, gates online/in-flight/fila vazia, lista de eventos gatilho.
- `src/js/store/sync/sync-engine.js`: laço de flush em lotes de 100, `recordPushAcks`, reconciliação do guard.
- `src/js/store/sync/operation-factory.js`, `api-client.js`, `ws-client.js`, `services.js`: envelope da op, endpoint de push, ausência de envio de op por WS, ativação do logging no boot.

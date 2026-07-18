# Fluxo Outbound: Fila Durável, Compaction, Flush e Reconexão

Caminho de uma mutação local até o servidor: `runTransaction` persistência-primeiro, `logXxxOperation`, fila IndexedDB com compaction e auto-purge, flush de 1,5s gated em online, push HTTP com ack por operação e, na queda de rede, acúmulo na fila até a reconexão do WebSocket com `sync_request`.

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

`logOperation` (`operation-dispatcher.js:105`) é o funil único de entrada. Ele descarta antes de enfileirar em três casos, cada um com um span `preflush.drop` nomeado, e cada um é uma armadilha clássica de "editei e nada sincronizou":

| Guarda | Motivo | Linha |
|---|---|---|
| `enabled === false` | logging desligado (`connectPublic`, `logoutAndDisconnect`) | `:106-114` |
| `setting` com `entityId` que não é UUID nem `'atlas'` | chave de view por-cliente (`lastActiveMap`) nunca pode ir ao servidor | `:120-126` |
| `mapId` de contexto não-UUID | mapa local keyed por nome (o `Principal` default) | `:133-139` |

O motivo das duas últimas guardas é um **poison pill**: o push HTTP roda numa única transação no servidor, então **uma** op com id inválido (Postgres `22P02`) derruba o lote inteiro e trava todo o sync indefinidamente, já que o lote rejeitado nunca é dequeueado. Por isso o filtro é no cliente, antes da fila, e `logBatchOperations` repete o mesmo filtro por item (`:192-198`). Isso também é o anti-leak do mapa local `Principal` descrito em [[dominio-local-vs-remoto]].

Sobre a primeira guarda: o módulo nasce com `enabled = false`, mas `initServices()` chama `enableOperationLogging()` no boot (`store/services.js:81`), então na prática o logging fica ligado desde o início. Só `connectPublic` e `logoutAndDisconnect` o desligam (`sync-engine.js:227,375`). **Consequência importante: `disconnect()` puro (queda de rede) NÃO desliga o logging**, é exatamente por isso que as operações continuam se acumulando durante a desconexão.

> **Nota histórica.** guia *arquitetura-sync* (absorvido):183` diz que `logOperation` "dropa se o logging está desabilitado (não conectado)", sugerindo que anônimo/offline não enfileira. Como o logging já está ligado no boot anônimo, um usuário offline enfileira ops normalmente para qualquer mapa com id UUID. Quem contém a fila offline é a guarda de `mapId` não-UUID (que dropa tudo do `Principal`) e o auto-purge de 7 dias, não o flag de logging.

Um projeto construído inteiramente offline e anônimo não sobe por essa fila, ele sobe por `POST /api/v1/atlas/import`. Ver [[atlas-import-offline]] e [[modos-operacao]].

Ao enfileirar com sucesso, o dispatcher também marca edição local pendente para os tipos sob *convergence guard* (`operation-dispatcher.js:147`), que é o que faz a edição concorrente na mesma feição convergir. Ver [[idempotencia-e-convergence-guard]].

Há um circuit breaker: falha de enfileiramento emite `STORE_SYNC_ERROR` e reagenda um retry único em 2s, até 5 falhas consecutivas (`operation-dispatcher.js:69-90`).

## 3. Fila durável

Instância LocalForage dedicada `name:'ebgeo', storeName:'operation_queue'` (`operation-queue.js:17-20`). Chave `op_{timestamp}_{id}` (`:26,83-85`), o que dá ordenação cronológica por **sort lexicográfico** das chaves (`:224-229`). Isso funciona porque epoch em ms tem 13 dígitos e continuará tendo até 2286; qualquer mudança do formato da chave quebra a ordem silenciosamente. O conteúdo de cada entrada é o envelope de [[envelope-operacao]].

Um índice reverso em memória `opId → chave` (`:46,64-75,142-155`) é construído preguiçosamente e mantido em `enqueue`/`dequeue`/`clear`, dando `dequeue` O(1) por op. Ele é reconstruído do zero depois de cada compaction (`:311-312`).

### Compaction

Regras em `_compactEntityOps` (`:324-350`), agrupando por `entityType:entityId` em ordem cronológica:

- `CREATE ... DELETE` → remove **ambos** (a entidade nasceu e morreu localmente, nunca precisa existir no servidor);
- `CREATE + UPDATEs` → um único `CREATE` com o `data` mais recente;
- `UPDATEs (+ DELETE)` → mantém apenas a **última** op.

**Armadilha maior desta página:** a compaction **só roda quando a fila passa de `MAX_QUEUE_SIZE = 10000`** (`:29`, gatilho em `:102-104` e `:121`, com o early-return em `:260-266`). Ela é uma válvula de sobrecarga, não uma otimização do caminho normal. Em uso corriqueiro, 40 arrastes de uma feição viram 40 `UPDATE`s empurrados um a um; e uma sessão offline longa empurra no reconnect um lote enorme e sequencial, 100 por requisição HTTP. Não escreva código assumindo que a fila "colapsa sozinha" os updates redundantes.

Segunda armadilha: no merge de `CREATE + UPDATEs`, só o campo `data` é atualizado (`:337-343`). O `timestamp`, o `lamportTimestamp` e o `id` permanecem os do `CREATE` original. A op resultante carrega um relógio mais antigo do que a edição que ela representa. Como o modelo é LWW por ordem de chegada no servidor e não por timestamp ([[sintese-nao-e-crdt]]), isso não corrompe a resolução de conflito, mas invalida qualquer raciocínio baseado no Lamport da op.

### Retenção e perda

- **Auto-purge de 7 dias.** `purgeOldOperations(maxAgeMs = 7 dias)` (`:360`) roda a cada 6 horas via `startAutoPurge()` (`:378-392`), iniciado em `initServices` (`services.js:82`). Ops antigas são **removidas em silêncio**, sem log por op e sem evento de erro. Um cliente que ficar mais de uma semana offline perde as edições mais antigas da fila; o dado local persiste (foi gravado primeiro), mas não chega aos peers via op log. A recuperação nesse caso é um snapshot fresco ([[snapshot-e-pull-incremental]]), não a fila.
- **Troca de atlas e logout limpam a fila.** `clearAllDataStore()` chama `operationQueue.clear()` (`store/store.js:154,202`), e `open-atlas.service.js` faz `stopAutoFlush()` + `syncEngine.disconnect()` + `clearAllDataStore()` antes de conectar no novo atlas. Ops pendentes não flushadas **morrem ali**, por desenho: elas pertencem ao atlas abandonado e vazariam para o atlas errado se sobrevivessem. Ver [[atlas-modelo-de-dados]] e [[dominio-local-vs-remoto]].

## 4. Flush

`sync-flush.js` mantém **um** loop compartilhado por app (`state` de módulo, `:48-57`). `startAutoFlush(engine = syncEngine, { intervalMs = 1500 })` é idempotente: chamar duas vezes é no-op (`:126-136`). O timer é ligado/desligado pelo ciclo de conta em `account/account.control.js` e `account/open-atlas.service.js`.

`flushOnce` (`:75`) tem três portões, nesta ordem:

1. `state.inFlight` — nunca dois flushes sobrepostos;
2. `connectionState.isOnline()` — sem conexão ONLINE, nem consulta a fila (`:65`). O gate é estrito (`connection-state.js:62-64`): o estado `RECONNECTING` **não** libera flush;
3. `operationQueue.count() > 0` — não faz push vazio (`:66-67`).

Erros são engolidos com `console.warn` (`:82-84`) para o loop não morrer. Como o lote falho não é dequeueado, o efeito é retry automático no próximo tick.

Além do timer, o flush é disparado oportunisticamente por `FLUSH_TRIGGER_EVENTS` (`:28-45`): FEATURE/LAYER/GROUP/MAP/BRIEFING `CREATED|MODIFIED|DELETED` e `REMOTE_OPERATION_APPLIED`. **Note o que não está na lista:** comentários espaciais, ops 3D/360, catálogo, temporal, notas e grid não têm gatilho por evento, então dependem do tick de 1,5s. Se você adicionar um tipo de entidade cuja latência importa, adicione o evento aqui ([[tipos-entidade-sync]]).

`REMOTE_OPERATION_APPLIED` estar na lista é intencional: receber trabalho de um peer é um bom momento para empurrar o próprio ([[aplicacao-operacoes-remotas]]).

## 5. Push HTTP e ack

`syncEngine.flush()` (`sync-engine.js:262-291`) faz um laço:

```
peek(FLUSH_BATCH_SIZE=100) → pushOperations → recordPushAcks → dequeue(opIds) → peek de novo
```

O transporte é `POST /api/v1/atlas/:atlasId/sync` com `{ operations }` (`api-client.js:841-843`). Em falha, o span `flush.push{FAILED}` nomeia os `opIds` do lote envenenado e a exceção sobe **sem dequeue**, então os mesmos ops são re-peekados no próximo ciclo (`sync-engine.js:270-283`). Reenviar é seguro por causa da idempotência por `(atlas_id, op_id)` ([[ack-idempotencia]]). Como o `peek` é sempre da cabeça da fila em ordem cronológica, um lote reprovado **bloqueia tudo o que vem depois**. Sem permissão de escrita no atlas o push é recusado pelo servidor e o lote fica preso; confira o papel antes de culpar a rede ([[permissoes-atlas]], [[permissoes-atlas]]).

**Armadilha:** o dequeue usa os ids enviados, não os acks (`sync-engine.js:285`). Se o servidor responder HTTP 200 com `results[i].success === false` para alguma op, ela é retirada da fila mesmo assim; a resposta só é lida para tracing e para semear versões. `idempotent: true` é tratado como sucesso, o que é correto.

`recordPushAcks` (`sync-engine.js:60-80`) faz mais do que observabilidade: ele **semeia a versão aplicada do próprio autor** (`recordLocalAppliedVersion`) para os tipos sob convergence guard. Isso é necessário porque o autor **descarta o próprio eco** do WebSocket (`ws-client.js:392`, regra `op.clientId === this._clientId`), e sem essa semente ele nunca saberia a ordem de chegada da própria op, permitindo que uma op concorrente mais antiga de um peer sobrescrevesse o valor correto. O ack aceita tanto `results[]` quanto o alias `acks[]`, e cai para `resp.serverVersion` quando não há versão por op (`:62-65`).

Depois do laço (e também no caminho de erro), `_reconcileConvergenceGuard()` (`sync-engine.js:289,298-306`) compara a fila remanescente com os contadores de edição pendente e cura vazamentos causados por compaction, lotes ou ack sem versão, evitando que um deferral vazado bloqueie ops remotas para sempre.

## 6. Reconexão: a ordem real dos passos

O código não segue o diagrama do guia. Ordem efetiva:

1. O socket cai. `_onClose` transita para `RECONNECTING` e agenda o retry (`ws-client.js:436-452`). Como não está `ONLINE`, o auto-flush para de empurrar; as ops seguem se acumulando no IndexedDB (o logging continua ligado).
2. Backoff exponencial `1000 * 2^tentativas`, teto de 30000 ms (`ws-client.js:32-33,462-476`), sempre com o **mesmo `clientId`** ([[client-id-estavel]]), o que preserva presença e idempotência e cancela o `away` dentro da janela de graça ([[presenca-colaborativa]]).
3. No frame `connected`, se o estado anterior era `RECONNECTING`, o cliente envia `sync_request(lastVersion)` (`ws-client.js:416-427`). O pull de recuperação portanto acontece **pelo WebSocket**, não por um GET REST.
4. O servidor responde `sync_response` com ops incrementais ou, se o cliente estiver muito defasado, um snapshot completo. O engine aplica um ou outro e avança `lastVersion` (`sync-engine.js:407-425`). Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]]. O `sync_response` é descartado se chegar depois de uma desconexão, para não persistir dados remotos num store sendo destruído (`sync-engine.js:407-412`).
5. Só quando a transição para `ONLINE` acontece o auto-flush volta a empurrar as pendentes. Conflitos com o que chegou do servidor são resolvidos por [[modelo-conflito-lww]].

`lastVersion` avança monotonicamente a partir do `server_version` de cada op inbound (`ws-client.js:384-394`) e do `currentVersion` do `sync_response` (`ws-client.js:314-316`). O comentário no código é explícito: buracos de numeração **não** são tratados como perda (isso gerava tempestades de `sync_request`); perda real só ocorre atravessando uma desconexão, e é justamente o `sync_request` da reconexão que a recupera.

> **Nota histórica.** guia *08-offline-import* (absorvido) §2.1 desenha o fluxo como `GET /atlas/:id/sync/:version` (pull REST) → merge → `POST /atlas/:id/sync` (push) → só então reconectar o WS. O código faz o inverso: `ws-client.js:462-476` reconecta o socket primeiro, `ws-client.js:424-427` só então pede o pull via `sync_request`, e `sync-flush.js:65` só libera o push depois da transição para `ONLINE`.

> **Nota histórica.** guia *08-offline-import* (absorvido) §2.2 descreve um `PendingOperationsManager` sobre o object store `pendingOperations` com campo `pendingSince`, removendo entradas por `ack.opId`. O código usa a instância LocalForage `ebgeo/operation_queue` com chaves `op_{timestamp}_{id}` e sem `pendingSince` (`operation-queue.js:17-20,83-85`), e remove pelos ids enviados (`sync-engine.js:285`). O trecho do guia é pseudocódigo ilustrativo, não o contrato.

### Sem replay, e por quê

O canal não guarda buffer por cliente desconectado ([[canal-collab-websocket]], [[canal-collab-websocket]]). Mensagens emitidas durante a queda simplesmente não são reenviadas; a recuperação é sempre `sync_request(lastVersion)`. A decisão evita estado durável por socket no servidor, que hoje é single-instance e mantém salas, presença e timers de `away` em memória ([[sintese-limites-collab]]). O preço é que o cliente **precisa** manter `lastVersion` correto: se ele zerar, o servidor devolve o snapshot inteiro em vez do incremento ([[sintese-rest-vs-websocket]]).

## 7. Por que HTTP e não WebSocket

Na prática deste cliente, **toda** op de entidade sai por HTTP. `wsClient.sendOperation` / `sendOperations` existem (`ws-client.js:161`, `:170`) mas não têm nenhum call site em `src/`, só em `tests/integration/ws-client.test.js`. O canal WS é usado para inbound de ops, presença, cursor, seleção e `sync_request` ([[canal-collab-websocket]], [[presenca-colaborativa]]).

> **Nota histórica.** guia *05-sync-crdt* (absorvido):494-495` diz "Em tempo real, prefira o canal WebSocket; o push HTTP é o caminho de recuperação", e o pseudo-código do §15 (`:967-970`) envia a op por WS quando conectado, deixando o HTTP só para a fila. O cliente real nunca faz isso: `syncEngine.flush` (`sync-engine.js:262-291`) empurra sempre por `POST /atlas/:id/sync`, e `wsClient.sendOperation` não tem chamador em produção. O guia descreve um contrato de backend suportado, não o comportamento implementado.

A escolha tem uma consequência de projeto: como o broadcast do servidor não consegue excluir o autor num push HTTP, o autor recebe o próprio eco pelo WS e o filtra por `clientId` ([[client-id-estavel]]). Ver o trade-off em [[sintese-rest-vs-websocket]] e [[sintese-rest-vs-sync]].

## 8. Checklist para não errar

- Toda nova mutação de store loga a op dentro do `deferAsync`, nunca antes da persistência.
- Entidade nova precisa de entrada em `EntityType` e de um `logXxxOperation` no dispatcher; sem isso a mutação é puramente local ([[tipos-entidade-sync]]).
- Se a op é escopada em mapa, o `mapId` **tem** que ser UUID; caso contrário ela é dropada pré-flush por design.
- Não presuma compaction: ela só existe acima de 10000 ops pendentes.
- Não presuma que a fila seja o único caminho de convergência: divergência longa se resolve por snapshot, e a fila não sobrevive a troca de atlas nem a 7 dias de idade.
- Papel/permissão do usuário não é checada no dispatcher; o gate fino é do servidor por operação ([[permissoes-atlas]], [[permissoes-atlas]]).
- Blobs de imagem não viajam na fila de ops, têm caminho próprio ([[imagens-atlas]]).
- Para depurar "editei e nada sincronizou", siga os spans `action.origin → preflush.drop | enqueue → flush.push → push.ack`, mais `ws.inbound` / `conn.transition` do ws-client ([[syncledger]]). Para o ciclo de sessão que envolve esse fluxo no boot e no F5, ver [[sessao-boot-e-ciclo-de-vida]].


## Ações de UI que geram lotes grandes de operações

## Ações de UI que geram lotes grandes de operações

A fila empurra lotes de até 100 ops e o lote é atômico no servidor, então vale saber de antemão quais gestos de interface produzem fan-out alto. Todos os itens abaixo são **N operações independentes**, não uma operação em lote: cada uma é sujeita a LWW individual e todas competem pelo mesmo caminho de flush.

| Ação na interface | Fan-out | Nota |
|---|---|---|
| Importar GeoJSON / SHP / KML / KMZ / GPX / CSV | 1 `layer` + 1 `feature` por feição | arquivo grande = milhares de ops enfileiradas de uma vez |
| Importar projeto `.ebgeo` no atlas atual | mapas + camadas + grupos + feições | merge; IDs duplicados precisam de UUID novo antes de enfileirar |
| Pontos por coordenadas (modal em lote) | 1 `feature` por ponto | |
| Colar seleção (Ctrl+V) e Duplicar seleção | 1 `feature` por cópia | |
| Deletar seleção múltipla | 1 `feature` delete por feição | |
| Ocultar/mostrar ou bloquear/desbloquear em lote na árvore | 1 `feature` update por feição | um toggle de grupo grande é um lote grande |
| Deletar camada | 1 `layer` delete; o cascade nas feições é feito **no servidor** | não enfileire as feições filhas manualmente |
| Deletar todas as feições de um tileset 3D ou de uma foto 360 | 1 op por marcador, medição, viewshed e orientação | tipos `marker3d`/`measurement3d`/`viewshed3d`/`orientation360`/`marker360` |
| Adicionar/deletar coluna de atributo na tabela | 1 `feature` update por feição da camada | altera todas as feições, não a camada |
| Reagendar (shift temporal em massa) | 1 `feature` update por feição do mapa | não desfazível; ver [[modulo-temporal]] |
| Executar algoritmo de processamento (Buffer, Voronoi, Convex Hull) | 1 `layer` + 1 `feature` por resultado | |

Consequências operacionais:

1. **A compactação não salva lote de create.** Ela agrupa por `entityType:entityId`; N feições novas são N entidades distintas e nada colapsa.
2. **Um lote envenenado trava tudo.** Se qualquer op do lote mirar um mapa travado por outro usuário, o push inteiro é rejeitado e re-peekado indefinidamente ([[sintese-limites-collab]]). Fan-out alto aumenta a chance de o gesto inteiro ficar preso.
3. **Atomicidade é só local.** O `runTransaction` garante um único persist no IndexedDB; para os pares, a importação ou o reagendamento chegam como ops independentes, possivelmente entremeadas com edições de terceiros.
4. **Purga de 7 dias.** Um lote grande gerado offline e não enviado em uma semana some da fila sem aviso; a recuperação é snapshot, não replay.

Ao desenhar uma ação nova de lote, prefira que o resultado seja alcançável por snapshot (uma escrita REST estrutural com broadcast de `serverResync`, ver [[sintese-rest-vs-sync]]) em vez de milhares de ops, sempre que a operação for estrutural e rara.

## Fontes

- guia *arquitetura-sync* (absorvido): seção 5 (Fluxo OUTBOUND passo a passo), tabela de módulos do sync, nota de idempotência e do convergence guard, spans do SyncLedger.
- guia *05-sync-crdt* (absorvido): contrato do `POST /atlas/:atlasId/sync` (request, `results[]`/`acks[]`, atomicidade do lote em transação única), idempotência por `op_id`, pseudo-código do dispatcher (§15, divergente do código).
- guia *08-offline-import* (absorvido): diagrama de reconexão (pull/merge/push/WS), gestão de operações pendentes, indicadores de status, modos anônimo/autenticado/público, import de atlas offline.
- guia *04-websocket-collab* (absorvido): `sync_request`/`sync_response` (§3.6), recuperação após reconexão (§9), ausência de replay e escala single-instance (§10), `clientId` estável, janela de graça `away`.
- `src/js/store/store-transaction.js`: ordem persistência → deferSync → deferAsync, rollback, mint do `traceId`.
- `src/js/store/sync/operation-dispatcher.js`: guardas de drop pré-flush, circuit breaker, loggers por entidade.
- `src/js/store/sync/operation-queue.js`: chave, índice reverso, regras e gatilho de compaction, auto-purge de 7 dias.
- `src/js/store/sync/sync-flush.js`: timer de 1,5s, gates online/in-flight/fila vazia, lista de eventos gatilho.
- `src/js/store/sync/sync-engine.js`: laço de flush em lotes de 100, dequeue pelos ids enviados, `recordPushAcks`, `pull()`, handler de `syncResponse`, reconciliação do guard, `logoutAndDisconnect`.
- `src/js/store/sync/ws-client.js`: backoff exponencial, `sync_request` no reconnect, avanço de `lastVersion`, filtro do próprio eco.
- `src/js/store/sync/operation-factory.js`, `api-client.js`, `connection-state.js`, `services.js`: envelope da op, endpoint de push, gate `isOnline()` estrito, ativação de logging e auto-purge no boot.
- `src/js/store/store.js`, `src/js/account/open-atlas.service.js`: limpeza da fila na troca de atlas e no logout.
